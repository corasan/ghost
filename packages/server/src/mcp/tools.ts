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
import {
  type ArmorStats,
  type Inventory,
  isArmor,
  isWeapon,
  type OwnedItem,
  STAT,
} from "../bungie/inventory.ts"
import { Manifest, type ManifestItem } from "../bungie/manifest.ts"
import { ARMOR_STATS, armorStats, buildStats, withMasterworkTotals } from "../bungie/masterwork.ts"
import { describeLoadout, loadoutPlugHashes } from "../bungie/loadout.ts"
import {
  describeArmorMods,
  type ModSwap,
  planModSwaps,
  socketsNow,
  swapStatChange,
} from "../bungie/mods.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { CreatorNotes } from "../creators/creators.ts"
import { NOTE_MAX_AGE_DAYS } from "../creators/parse.ts"
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
    "Show the player a plan to confirm. Nothing moves until they tap the confirm button; the server then runs the selected rows. Call it once per request, after deciding. Row actions: to_vault, to_character, pull_postmaster, equip, tag_junk, or none (shown for comparison only). For a build, list the armor piece for every slot, including pieces that stay equipped (action none). The app works out the build's six stat totals itself from the pieces you equip, before and after, and what masterworking would add, so do not do that arithmetic or repeat those numbers in your reply. A build card also shows the super, aspects and fragments the character has slotted, read from the game; you cannot change the subclass, so if the build needs a different one, say so in your reply. For a build, also recommend armor mods in mods: one entry per mod to put in, naming the piece (it must be a row) and the mod exactly as list_armor_mods gives it, with replaces when the piece has no free socket of that kind. Only list mods that change; what is already slotted stays. The server checks sockets and energy and tells you what to fix. Pass stats only to mark the stats the player asked for: label Health, Melee, Grenade, Super, Class or Weapons with target true; the values are ignored for a build.",
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
    mods: Schema.optional(
      Schema.Array(
        Schema.Struct({
          itemInstanceId: Schema.String,
          mod: Schema.String,
          replaces: Schema.optional(Schema.String),
        }),
      ),
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

const ModSlot = Schema.Literals(["general", "helmet", "arms", "chest", "legs", "class"])

const GetArmorMods = Tool.make("get_armor_mods", {
  description:
    "What is slotted in owned armor pieces right now: each piece's energy (used and capacity) and its mod sockets, with the kind of mod each takes (general or the piece's slot), the mod in it, its energy cost and any stats it adds. Sockets of kind other (tuning, set bonuses) cannot be changed by a plan. Call it for the pieces of a build before recommending mods.",
  parameters: Schema.Struct({ itemInstanceIds: Schema.Array(Schema.String) }),
  success: Json,
})

const ListArmorMods = Tool.make("list_armor_mods", {
  description:
    "Armor mods from the current patch's Bungie manifest that can go in a build socket: name, the slot they fit (general fits every piece), energy cost, effect text and stat changes. artifactOnly mods work only while unlocked in the Seasonal Artifact, so prefer the others unless the player says they have them. Filter by slot and by words in the name or effect. Use these names exactly in present_plan mods.",
  parameters: Schema.Struct({
    slot: Schema.optional(ModSlot),
    text: Schema.optional(Schema.String),
  }),
  success: Json,
})

const SearchCreatorNotes = Tool.make("search_creator_notes", {
  description:
    "Recent advice from Destiny 2 YouTube creators: short claims summarized from their videos of the last 60 days, each with channel, video title, publish date and a link to the moment it is said. Gear names were checked against the manifest. Search by weapon, perk, exotic, subclass, activity or topic words; an empty query returns the newest notes.",
  parameters: Schema.Struct({
    query: Schema.String,
    limit: Schema.optional(Schema.Number),
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
  GetArmorMods,
  ListArmorMods,
  SearchCreatorNotes,
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

const named = (stats: ArmorStats) =>
  Object.fromEntries(ARMOR_STATS.map(([key, label]) => [label.toLowerCase(), stats[key]]))

const MOD_SLOTS: Record<string, typeof ModSlot.Type> = {
  "enhancements.v2_general": "general",
  "enhancements.v2_head": "helmet",
  "enhancements.v2_arms": "arms",
  "enhancements.v2_chest": "chest",
  "enhancements.v2_legs": "legs",
  "enhancements.v2_class_item": "class",
}

const modSlotOf = (category: string) => MOD_SLOTS[category]

const namedMods = (mods: Readonly<Record<string, number>>) => {
  const named = ARMOR_STATS.flatMap(([key, label]) => {
    const delta = mods[STAT[key]]
    return delta === undefined ? [] : [[label.toLowerCase(), delta] as const]
  })
  return named.length > 0 ? Object.fromEntries(named) : undefined
}

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
  stats: i.armorStats === null ? undefined : named(i.armorStats),
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
    const creators = yield* CreatorNotes

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
        Effect.map(manifest.capacities, (capacities) =>
          json({
            characters: inv.characters.map((c) => ({
              id: c.characterId,
              class: c.classType,
              light: c.light,
              subclass: c.subclass,
              element: c.element,
              stats: named(c.stats),
              equipped: inv.items
                .filter((i) => i.equipped && i.characterId === c.characterId)
                .map(compact),
              postmaster: {
                count: c.postmasterCount,
                capacity: capacities.postmaster,
                items: inv.items
                  .filter((i) => i.location === "postmaster" && i.characterId === c.characterId)
                  .map(compact),
              },
            })),
            vault: { count: inv.vaultCount, capacity: capacities.vault },
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
            const fallback = job.value.characterId || (inv.characters[0]?.characterId ?? null)
            const facts = yield* manifest.statFacts
            const slotted = input.rows.flatMap((r) =>
              (owned.get(r.itemInstanceId)?.modSockets ?? []).map((socket) => socket.plugHash),
            )
            const modDefs = yield* manifest
              .lookup(slotted)
              .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
            const modFacts = yield* manifest.plugFacts(slotted)
            const wanted = input.mods ?? []
            const stray = wanted.filter(
              (m) => !input.rows.some((r) => r.itemInstanceId === m.itemInstanceId),
            )
            if (stray.length > 0) {
              return `Error: mods name pieces that are not rows of the plan: ${stray.map((m) => m.itemInstanceId).join(", ")}. List each piece as a row (action none if it stays on).`
            }
            const catalog = wanted.length > 0 ? yield* manifest.armorMods : []
            const swapsFor = new Map<string, ReadonlyArray<ModSwap>>()
            const refused: Array<string> = []
            for (const r of input.rows) {
              const item = owned.get(r.itemInstanceId) as OwnedItem
              const requests = wanted.filter((m) => m.itemInstanceId === r.itemInstanceId)
              if (requests.length === 0) continue
              const planned = planModSwaps({
                item,
                sockets: socketsNow(item, modDefs, modFacts),
                catalog,
                requests,
              })
              refused.push(...planned.errors)
              swapsFor.set(r.itemInstanceId, planned.swaps)
            }
            if (refused.length > 0) {
              return `Error: ${refused.join(". ")}. Fix the mods and call present_plan again.`
            }
            const rows = input.rows.map((r) => {
              const item = owned.get(r.itemInstanceId) as OwnedItem
              const characterId =
                r.action === "pull_postmaster"
                  ? item.characterId
                  : r.action === "to_character" || r.action === "equip"
                    ? (r.characterId ?? fallback)
                    : (r.characterId ?? null)
              const className = (classOf.get(characterId ?? "") ?? "character").toUpperCase()
              const arrives = r.action === "equip" || r.action === "to_character"
              const origin = !arrives
                ? undefined
                : item.location !== "character"
                  ? item.location.toUpperCase()
                  : item.characterId !== characterId
                    ? classOf.get(item.characterId ?? "")?.toUpperCase()
                    : undefined
              const mods =
                item.armorStats === null
                  ? undefined
                  : describeArmorMods({
                      sockets: socketsNow(item, modDefs, modFacts),
                      swaps: swapsFor.get(item.itemInstanceId) ?? [],
                      facts,
                    })
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
                selected:
                  r.action === "none" && (swapsFor.get(item.itemInstanceId)?.length ?? 0) === 0
                    ? false
                    : (r.selected ?? true),
                outcome: null,
                error: null,
                ...(item.armorStats === null ? {} : { stats: armorStats(item) }),
                slot: item.slot,
                masterwork: item.masterwork,
                damageType: item.damageType,
                gearTier: item.gearTier ?? null,
                ...(mods === undefined
                  ? {}
                  : { armorMods: mods.armorMods, freeModSlots: mods.freeModSlots }),
                ...(item.energy === null || mods === undefined
                  ? {}
                  : { energy: { used: mods.energyUsed, capacity: item.energy.capacity } }),
                ...(origin === undefined ? {} : { origin }),
              })
            })
            const equipping = rows.filter((row) => row.action === "equip")
            const builtFor = inv.characters.find(
              (c) => c.characterId === (equipping[0]?.characterId ?? fallback),
            )
            const loadout =
              input.kind === "build" && builtFor !== undefined
                ? describeLoadout({
                    character: builtFor,
                    plugs: yield* manifest.plugFacts(loadoutPlugHashes(builtFor)),
                    facts,
                  })
                : undefined
            const modChange = swapStatChange([...swapsFor.values()].flat())
            const planStats =
              input.kind === "build" && builtFor !== undefined
                ? buildStats({
                    character: builtFor,
                    worn: inv.items.filter(
                      (i) =>
                        i.equipped && i.characterId === builtFor.characterId && isArmor(i.slot),
                    ),
                    incoming: equipping.map((row) => owned.get(row.itemInstanceId) as OwnedItem),
                    targets: (input.stats ?? []).filter((s) => s.target).map((s) => s.label),
                    facts,
                    modChange,
                  })
                : withMasterworkTotals(
                    (input.stats ?? []).map((s) => new PlanStat(s)),
                    input.rows.map((r) => owned.get(r.itemInstanceId) as OwnedItem),
                  )
            const plan = new Plan({
              kind: input.kind,
              title: input.title,
              subtitle: input.subtitle ?? null,
              stats: planStats,
              featured:
                input.featured === undefined
                  ? null
                  : new PlanFeatured({
                      itemInstanceId: input.featured.itemInstanceId,
                      perks: input.featured.perks.map((p) => new PlanPerk(p)),
                      stats: input.featured.stats.map((s) => new PlanStat({ ...s, target: false })),
                    }),
              ...(loadout === undefined ? {} : { loadout }),
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
            const swapped = [...swapsFor.values()].flat().length
            return `Plan saved with ${rows.length} rows (${actionable} actionable, ${swapped} mod swaps). The player will see it under your answer and confirm in the app.`
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

    const get_armor_mods = ({
      itemInstanceIds,
    }: {
      readonly itemInstanceIds: ReadonlyArray<string>
    }) =>
      withInventory((inv) =>
        Effect.gen(function* () {
          const picked = inv.items.filter(
            (i) => itemInstanceIds.includes(i.itemInstanceId) && i.armorStats !== null,
          )
          const hashes = picked.flatMap((i) => i.modSockets.map((socket) => socket.plugHash))
          const defs = yield* manifest
            .lookup(hashes)
            .pipe(Effect.orElseSucceed((): ReadonlyMap<number, ManifestItem> => new Map()))
          const plugs = yield* manifest.plugFacts(hashes)
          return json({
            unknownIds: itemInstanceIds.filter(
              (id) => !picked.some((i) => i.itemInstanceId === id),
            ),
            pieces: picked.map((item) => ({
              id: item.itemInstanceId,
              name: item.name,
              slot: item.slot,
              energy: item.energy,
              sockets: socketsNow(item, defs, plugs).map((socket) => ({
                kind: modSlotOf(socket.category) ?? "other",
                mod: socket.mod?.name ?? null,
                cost: socket.mod?.cost,
                stats: socket.mod === null ? undefined : namedMods(socket.mod.mods),
              })),
            })),
          })
        }),
      )

    const list_armor_mods = (input: {
      readonly slot?: typeof ModSlot.Type | undefined
      readonly text?: string | undefined
    }) =>
      Effect.map(manifest.armorMods, (catalog) => {
        const text = input.text?.toLowerCase()
        const byName = new Map<string, (typeof catalog)[number]>()
        for (const entry of catalog) {
          const key = `${entry.category}|${entry.name.toLowerCase()}`
          const kept = byName.get(key)
          if (kept === undefined || (kept.artifact && !entry.artifact)) byName.set(key, entry)
        }
        const mods = [...byName.values()]
          .filter(
            (entry) =>
              (input.slot === undefined || modSlotOf(entry.category) === input.slot) &&
              (text === undefined ||
                entry.name.toLowerCase().includes(text) ||
                entry.description.toLowerCase().includes(text)),
          )
          .map((entry) => ({
            name: entry.name,
            slot: modSlotOf(entry.category),
            cost: entry.energyCost,
            effect: clip(entry.description, 300),
            stats: namedMods(entry.mods),
            artifactOnly: entry.artifact || undefined,
          }))
        return json({ total: mods.length, mods })
      })

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

    const search_creator_notes = (input: {
      readonly query: string
      readonly limit?: number | undefined
    }) =>
      Effect.gen(function* () {
        const found = yield* creators.search(
          input.query,
          Math.min(Math.max(input.limit ?? 12, 1), 30),
        )
        const now = Date.now()
        return json({
          maxAgeDays: NOTE_MAX_AGE_DAYS,
          captionsAvailable: found.captionsAvailable,
          channels: found.channels,
          notes: found.notes.map((n) => ({
            ...n,
            ageDays: Math.floor((now - Date.parse(n.publishedAt)) / 86_400_000),
            unverifiedNames: n.unverifiedNames.length > 0 ? n.unverifiedNames : undefined,
          })),
        })
      })

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
      get_armor_mods,
      list_armor_mods,
      search_creator_notes,
      cite_sources,
    }
  }),
)
