import {
  type BungieNotLinked,
  DamageType,
  GuardianClass,
  ItemLocation,
  ItemSlot,
  ItemTier,
  Plan,
  PlanAction,
  PlanFeatured,
  PlanKind,
  PlanPerk,
  PlanRow,
  PlanStat,
  Source,
} from "@ghost/contract"
import { Effect, Option, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { CurrentJob } from "../agent/current-job.ts"
import type { BungieError } from "../bungie/client.ts"
import { VAULT_CAPACITY, POSTMASTER_CAPACITY } from "../bungie/guardian.ts"
import { type Inventory, isArmor, isWeapon, type OwnedItem } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { JobsRepo } from "../db/jobs.ts"
import { checkRoll, perkMatcher, type RollMatch, recommendations } from "../wishlist/parse.ts"
import { Wishlist, WISHLIST_URL } from "../wishlist/wishlist.ts"

// These are the tools Claude sees. They read the cached inventory and the
// fetched reference data (manifest, community wishlist); none of them moves
// an item. Changes are proposed with present_plan and only run when the
// player confirms in the app.

const Json = Schema.String

const SourceInput = Schema.Struct({
  label: Schema.String,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  asOf: Schema.optional(Schema.NullOr(Schema.String)),
})

const GetCharacters = Tool.make("get_characters", {
  description:
    "The player's characters: class, light, subclass, element, stats, equipped items and postmaster contents, plus vault usage.",
  success: Json,
})

const SearchItems = Tool.make("search_items", {
  description:
    "Search owned items (vault, characters, postmaster). All filters are optional and combine. text matches name, type and perk names. Returns compact JSON rows; item ids are what present_plan and check_rolls take.",
  parameters: Schema.Struct({
    text: Schema.optional(Schema.String),
    category: Schema.optional(Schema.Literals(["weapon", "armor"])),
    slot: Schema.optional(ItemSlot),
    tier: Schema.optional(ItemTier),
    location: Schema.optional(ItemLocation),
    classType: Schema.optional(GuardianClass),
    damageType: Schema.optional(DamageType),
    duplicatesOnly: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number),
  }),
  success: Json,
})

const PresentPlan = Tool.make("present_plan", {
  description:
    "Show the player a plan to confirm. Nothing moves until they tap the confirm button; the server then runs the selected rows. Call it once per request, after deciding. Row actions: to_vault, to_character, pull_postmaster, equip, tag_junk, or none (shown for comparison only).",
  parameters: Schema.Struct({
    kind: PlanKind,
    title: Schema.String,
    subtitle: Schema.optional(Schema.String),
    note: Schema.optional(Schema.String),
    confirmLabel: Schema.String,
    stats: Schema.optional(
      Schema.Array(
        Schema.Struct({ label: Schema.String, value: Schema.Number, target: Schema.Boolean }),
      ),
    ),
    featured: Schema.optional(
      Schema.Struct({
        itemInstanceId: Schema.String,
        perks: Schema.Array(Schema.Struct({ name: Schema.String, good: Schema.Boolean })),
        stats: Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.Number })),
      }),
    ),
    rows: Schema.Array(
      Schema.Struct({
        itemInstanceId: Schema.String,
        action: PlanAction,
        characterId: Schema.optional(Schema.String),
        meta: Schema.optional(Schema.String),
        score: Schema.optional(Schema.Number),
        selected: Schema.optional(Schema.Boolean),
      }),
    ),
    sources: Schema.optional(Schema.Array(SourceInput)),
  }),
  success: Json,
})

const CheckRolls = Tool.make("check_rolls", {
  description:
    "Judge owned weapon rolls against the DIM community wishlist (curated, fetched data). For each item: its perks, wishlist rolls it fully matches (with curator notes, PvE/PvP tags, section title, url and date), the closest partial matches, a trash flag and a suggested 0-100 score with its basis.",
  parameters: Schema.Struct({ itemInstanceIds: Schema.Array(Schema.String) }),
  success: Json,
})

const RollRecommendations = Tool.make("roll_recommendations", {
  description:
    "Recommended perks for a weapon (by item hash) from the DIM community wishlist, grouped by curator note, with PvE/PvP tags, source section and date.",
  parameters: Schema.Struct({ itemHash: Schema.Number }),
  success: Json,
})

const DescribePlugs = Tool.make("describe_plugs", {
  description:
    "What perks, mods, fragments and aspects do, from the current patch's Bungie manifest. Pass names and/or hashes.",
  parameters: Schema.Struct({
    names: Schema.optional(Schema.Array(Schema.String)),
    hashes: Schema.optional(Schema.Array(Schema.Number)),
  }),
  success: Json,
})

const CiteSources = Tool.make("cite_sources", {
  description:
    "Record the sources your answer relies on (label, url, date as ISO). They are shown under the answer. Call it for everything you used: wishlist, manifest, articles, videos.",
  parameters: Schema.Struct({ sources: Schema.Array(SourceInput) }),
  success: Json,
})

export const GhostToolkit = Toolkit.make(
  GetCharacters,
  SearchItems,
  PresentPlan,
  CheckRolls,
  RollRecommendations,
  DescribePlugs,
  CiteSources,
)

const json = (value: unknown) => JSON.stringify(value)

const clip = (text: string | null, max: number) =>
  text === null || text.length <= max ? text : `${text.slice(0, max)}…`

// The model reads these, so failures come back as text it can relay
// instead of a tool error it cannot explain.
const explain = (error: BungieError | BungieNotLinked | { readonly message: string }) =>
  "_tag" in error && error._tag === "BungieNotLinked"
    ? "Error: the Bungie account is not linked yet. Tell the player to sign in with Bungie in the app."
    : `Error: ${"message" in error ? error.message : String(error)}`

const compact = (i: OwnedItem) => ({
  id: i.itemInstanceId,
  hash: i.itemHash,
  name: i.name,
  type: i.typeName,
  tier: i.tier,
  slot: i.slot,
  element: i.damageType,
  power: i.power,
  location: i.location,
  characterId: i.characterId,
  equipped: i.equipped,
  locked: i.locked,
  masterwork: i.masterwork,
  classType: i.classType ?? undefined,
  statTotal: i.statTotal ?? undefined,
  stats: i.armorStats ?? undefined,
  perks: i.perks.length > 0 ? i.perks : undefined,
  duplicates: i.duplicates,
  decision: i.decision ?? undefined,
})

type SearchFilters = (typeof SearchItems)["parametersSchema"]["Type"]

export const searchItems = (inv: Inventory, f: SearchFilters) => {
  const text = f.text?.toLowerCase()
  const limit = Math.min(Math.max(f.limit ?? 60, 1), 200)
  const matches = inv.items.filter(
    (i) =>
      (text === undefined ||
        i.name.toLowerCase().includes(text) ||
        i.typeName.toLowerCase().includes(text) ||
        i.perks.some((p) => p.toLowerCase().includes(text))) &&
      (f.category === undefined ||
        (f.category === "weapon" ? isWeapon(i.slot) : isArmor(i.slot))) &&
      (f.slot === undefined || i.slot === f.slot) &&
      (f.tier === undefined || i.tier === f.tier) &&
      (f.location === undefined || i.location === f.location) &&
      (f.classType === undefined || i.classType === f.classType) &&
      (f.damageType === undefined || i.damageType === f.damageType) &&
      (f.duplicatesOnly !== true || i.duplicates > 0),
  )
  return { total: matches.length, items: matches.slice(0, limit).map(compact) }
}

const DEFAULT_META: Record<PlanAction, (item: OwnedItem, className: string) => string> = {
  to_vault: (i) => `${i.typeName} → VAULT`,
  to_character: (i, c) => `${i.typeName} → ${c}`,
  pull_postmaster: (i, c) => `${i.typeName} · POSTMASTER → ${c}`,
  equip: (i, c) => `${i.typeName} · EQUIP ON ${c}`,
  tag_junk: (i) => `${i.typeName} · JUNK`,
  none: (i) => i.typeName,
}

// A full curated match is the strongest signal; "god" tags mark the
// curator's top pick. Partial matches scale with how many listed perks the
// roll has, and a trash match overrides everything.
const scoreFor = (
  full: ReadonlyArray<RollMatch>,
  partial: ReadonlyArray<RollMatch>,
  rolls: number,
) => {
  if (full.some((m) => m.roll.trash)) return { score: 10, basis: "matches a wishlist trash roll" }
  const keepers = full.filter((m) => !m.roll.trash)
  if (keepers.some((m) => m.roll.block.tags.some((t) => /god/i.test(t)))) {
    return { score: 95, basis: "fully matches a wishlist roll tagged god" }
  }
  if (keepers.length > 0) return { score: 85, basis: "fully matches a wishlist roll" }
  const best = partial[0]
  if (best !== undefined) {
    return {
      score: Math.round(40 + (40 * best.matched) / best.total),
      basis: `has ${best.matched} of ${best.total} perks of the closest wishlist roll`,
    }
  }
  if (rolls > 0) return { score: 30, basis: "has none of the wishlist's recommended perks" }
  return { score: null, basis: "the wishlist has no entries for this weapon" }
}

export const GhostToolkitHandlers = GhostToolkit.toLayer(
  Effect.gen(function* () {
    const profile = yield* ProfileStore
    const jobs = yield* JobsRepo
    const current = yield* CurrentJob
    const manifest = yield* Manifest
    const wishlist = yield* Wishlist

    const withInventory = (f: (inv: Inventory) => Effect.Effect<string>) =>
      profile.inventory.pipe(
        Effect.matchEffect({ onFailure: (e) => Effect.succeed(explain(e)), onSuccess: f }),
      )

    const toSources = (input: ReadonlyArray<typeof SourceInput.Type>) =>
      input.map((s) => new Source({ label: s.label, url: s.url ?? null, asOf: s.asOf ?? null }))

    const nameLookup = (hashes: Iterable<number>) =>
      Effect.map(manifest.lookup(hashes), (defs) => (hash: number) => defs.get(hash)?.name)

    const get_characters = () =>
      withInventory((inv) =>
        Effect.succeed(
          json({
            characters: inv.characters.map((c) => ({
              id: c.characterId,
              class: c.classType,
              light: c.light,
              subclass: c.subclass,
              element: c.element,
              stats: c.stats,
              equipped: inv.items
                .filter((i) => i.equipped && i.characterId === c.characterId)
                .map(compact),
              postmaster: {
                count: c.postmasterCount,
                capacity: POSTMASTER_CAPACITY,
                items: inv.items
                  .filter((i) => i.location === "postmaster" && i.characterId === c.characterId)
                  .map(compact),
              },
            })),
            vault: { count: inv.vaultCount, capacity: VAULT_CAPACITY },
          }),
        ),
      )

    const search_items = (filters: SearchFilters) =>
      withInventory((inv) => Effect.succeed(json(searchItems(inv, filters))))

    const present_plan = (input: (typeof PresentPlan)["parametersSchema"]["Type"]) =>
      Effect.gen(function* () {
        const job = yield* current.get
        if (Option.isNone(job)) {
          return "Error: no Ghost request is running, so there is nothing to attach a plan to."
        }
        return yield* withInventory((inv) =>
          Effect.gen(function* () {
            const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
            const classOf = new Map(inv.characters.map((c) => [c.characterId, c.classType]))
            const ids = input.rows.map((r) => r.itemInstanceId)
            if (input.featured !== undefined) ids.push(input.featured.itemInstanceId)
            const unknown = ids.filter((id) => !owned.has(id))
            if (unknown.length > 0) {
              return `Error: unknown item ids ${unknown.join(", ")}. Use ids from search_items or get_characters.`
            }
            const badCharacter = input.rows.find(
              (r) => r.characterId !== undefined && !classOf.has(r.characterId),
            )
            if (badCharacter !== undefined) {
              return `Error: unknown characterId ${badCharacter.characterId}. Use ids from get_characters.`
            }
            const fallback = job.value.characterId ?? inv.characters[0]?.characterId ?? null
            const rows = input.rows.map((r) => {
              const item = owned.get(r.itemInstanceId) as OwnedItem
              const characterId =
                r.action === "pull_postmaster"
                  ? item.characterId
                  : r.action === "to_character" || r.action === "equip"
                    ? (r.characterId ?? fallback)
                    : (r.characterId ?? null)
              const className = (classOf.get(characterId ?? "") ?? "character").toUpperCase()
              return new PlanRow({
                itemInstanceId: item.itemInstanceId,
                itemHash: item.itemHash,
                name: item.name,
                icon: item.icon,
                tier: item.tier,
                meta: r.meta ?? DEFAULT_META[r.action](item, className).toUpperCase(),
                power: item.power,
                score: r.score ?? null,
                action: r.action,
                characterId,
                selected: r.action === "none" ? false : (r.selected ?? true),
                outcome: null,
                error: null,
              })
            })
            const plan = new Plan({
              kind: input.kind,
              title: input.title,
              subtitle: input.subtitle ?? null,
              stats: (input.stats ?? []).map((s) => new PlanStat(s)),
              featured:
                input.featured === undefined
                  ? null
                  : new PlanFeatured({
                      itemInstanceId: input.featured.itemInstanceId,
                      perks: input.featured.perks.map((p) => new PlanPerk(p)),
                      stats: input.featured.stats.map((s) => new PlanStat({ ...s, target: false })),
                    }),
              rows,
              note: input.note ?? null,
              confirmLabel: input.confirmLabel,
              status: "proposed",
            })
            yield* jobs.setPlan(job.value.id, plan).pipe(Effect.orDie)
            if (input.sources !== undefined && input.sources.length > 0) {
              yield* jobs.addSources(job.value.id, toSources(input.sources)).pipe(Effect.orDie)
            }
            const actionable = rows.filter((r) => r.action !== "none").length
            return `Plan saved with ${rows.length} rows (${actionable} actionable). The player will see it under your answer and confirm in the app.`
          }),
        )
      })

    const check_rolls = ({
      itemInstanceIds,
    }: {
      readonly itemInstanceIds: ReadonlyArray<string>
    }) =>
      withInventory((inv) =>
        Effect.gen(function* () {
          const owned = new Map(inv.items.map((i) => [i.itemInstanceId, i]))
          const picked = itemInstanceIds.flatMap((id) => {
            const item = owned.get(id)
            return item === undefined ? [] : [item]
          })
          const unknown = itemInstanceIds.filter((id) => !owned.has(id))
          const rolls = yield* wishlist.rollsFor(picked.map((i) => i.itemHash))
          const hashes = new Set<number>()
          for (const item of picked) for (const h of item.plugHashes) hashes.add(h)
          for (const list of rolls.values())
            for (const r of list) for (const h of r.perkHashes) hashes.add(h)
          const nameOf = yield* nameLookup(hashes)
          const names = (list: ReadonlyArray<number>) => list.map((h) => nameOf(h) ?? `#${h}`)
          const describeMatch = (m: RollMatch, has: (hash: number) => boolean) => ({
            perks: names(m.roll.perkHashes),
            missing: m.full ? undefined : names(m.roll.perkHashes.filter((h) => !has(h))),
            notes: clip(m.roll.block.notes, 500),
            tags: m.roll.block.tags,
            section: m.roll.block.sectionTitle,
            url: m.roll.block.sectionUrl,
            date: m.roll.block.sectionDate,
          })
          const items = picked.map((item) => {
            const list = rolls.get(item.itemHash) ?? []
            const check = checkRoll(item.plugHashes, list, nameOf)
            const { score, basis } = scoreFor(check.full, check.partial, list.length)
            const has = perkMatcher(item.plugHashes, nameOf)
            return {
              id: item.itemInstanceId,
              name: item.name,
              perks: item.perks,
              plugs: names(item.plugHashes),
              wishlistRolls: list.length,
              trash: check.trash,
              fullMatches: check.full.slice(0, 5).map((m) => describeMatch(m, has)),
              partialMatches:
                check.full.length > 0 ? [] : check.partial.map((m) => describeMatch(m, has)),
              suggestedScore: score,
              scoreBasis: basis,
            }
          })
          return json({
            wishlist: { url: WISHLIST_URL, asOf: yield* wishlist.asOf },
            unknownIds: unknown.length > 0 ? unknown : undefined,
            items,
          })
        }).pipe(
          Effect.catchTag("WishlistError", (e) => Effect.succeed(explain(e))),
          Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))),
        ),
      )

    const roll_recommendations = ({ itemHash }: { readonly itemHash: number }) =>
      Effect.gen(function* () {
        const rolls = (yield* wishlist.rollsFor([itemHash])).get(itemHash) ?? []
        const hashes = new Set<number>([itemHash])
        for (const r of rolls) for (const h of r.perkHashes) hashes.add(h)
        const nameOf = yield* nameLookup(hashes)
        return json({
          item: nameOf(itemHash) ?? `#${itemHash}`,
          wishlist: { url: WISHLIST_URL, asOf: yield* wishlist.asOf },
          recommendations: recommendations(rolls, nameOf).map((r) => ({
            ...r,
            notes: clip(r.notes, 600),
          })),
        })
      }).pipe(
        Effect.catchTag("WishlistError", (e) => Effect.succeed(explain(e))),
        Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))),
      )

    const describe_plugs = (input: {
      readonly names?: ReadonlyArray<string> | undefined
      readonly hashes?: ReadonlyArray<number> | undefined
    }) =>
      Effect.gen(function* () {
        const byHash = yield* manifest.lookup(input.hashes ?? [])
        const byName = yield* manifest.findByName(input.names ?? [])
        const seen = new Set<string>()
        const plugs = [...byHash.values(), ...byName].flatMap((def) => {
          const key = `${def.name}\u0000${def.description}`
          if (seen.has(key)) return []
          seen.add(key)
          return [
            { hash: def.hash, name: def.name, type: def.typeName, description: def.description },
          ]
        })
        const found = new Set(plugs.map((p) => p.name.toLowerCase()))
        const missing = (input.names ?? []).filter((n) => !found.has(n.toLowerCase()))
        return json({
          source: "Bungie manifest (current patch)",
          plugs,
          notFound: missing.length > 0 ? missing : undefined,
        })
      }).pipe(Effect.catchTag("BungieError", (e) => Effect.succeed(explain(e))))

    const cite_sources = ({
      sources,
    }: {
      readonly sources: ReadonlyArray<typeof SourceInput.Type>
    }) =>
      Effect.gen(function* () {
        const job = yield* current.get
        if (Option.isNone(job)) return "Error: no Ghost request is running."
        yield* jobs.addSources(job.value.id, toSources(sources)).pipe(Effect.orDie)
        return `Recorded ${sources.length} source(s).`
      })

    return {
      get_characters,
      search_items,
      present_plan,
      check_rolls,
      roll_recommendations,
      describe_plugs,
      cite_sources,
    }
  }),
)
