import { noul, TypeSafeClient } from "@typesafe-ai/sdk"
import { Effect, Layer, Redacted, Schema } from "effect"
import { BungieClient, BungieClientLive } from "../src/bungie/client.ts"
import { isRolledTrait } from "../src/bungie/inventory.ts"
import { LoadoutsLive } from "../src/bungie/loadouts.ts"
import { Manifest, ManifestLive } from "../src/bungie/manifest.ts"
import { ProfileStoreLive } from "../src/bungie/profile.ts"
import { AppConfig, AppConfigLive } from "../src/config.ts"
import { BuildsRepoLive } from "../src/db/builds.ts"
import { DatabaseLive } from "../src/db/client.ts"
import { ItemsRepoLive } from "../src/db/items.ts"
import { PerkRatingsLive } from "../src/db/perk-ratings.ts"
import { SettingsLive } from "../src/db/settings.ts"
import { type Purpose, PURPOSES, type RatedPerk } from "../src/junk/perks.ts"
import { JunkJudge, JunkJudgeLive } from "../src/junk/service.ts"
import { perkKey } from "../src/wishlist/parse.ts"
import { WishlistLive } from "../src/wishlist/wishlist.ts"

// Scores Jev against Ghost's perk ratings: for owned weapons whose perks the
// weapon's own wishlist rolls or the player rate, asks Jev whether each perk
// is a god roll pick for PvE and for PvP, and reports how often it agrees.
// Jev never sees the wishlist. Read-only toward Bungie; point GHOST_DATA_DIR
// at a copy of the data directory. EVAL_WEAPONS caps how many weapons it asks
// about (default 40).

const readOnly = (action: string) => () =>
  Effect.die(new Error(`jev-perk-eval is read-only; it tried to ${action}`))

const ReadOnlyBungie = Layer.effect(
  BungieClient,
  Effect.map(BungieClient, (client) => ({
    ...client,
    transferItem: readOnly("transfer an item"),
    pullFromPostmaster: readOnly("pull from the postmaster"),
    equipItem: readOnly("equip an item"),
    insertPlug: readOnly("insert a plug"),
    snapshotLoadout: readOnly("save a loadout"),
  })),
).pipe(Layer.provide(BungieClientLive))

const Repos = Layer.mergeAll(SettingsLive, ItemsRepoLive, BuildsRepoLive, PerkRatingsLive).pipe(
  Layer.provideMerge(DatabaseLive),
)
const Clients = Layer.mergeAll(ReadOnlyBungie, ManifestLive, WishlistLive).pipe(
  Layer.provideMerge(Repos),
)
const Reads = LoadoutsLive.pipe(Layer.provideMerge(ProfileStoreLive), Layer.provideMerge(Clients))
const EvalLive = JunkJudgeLive.pipe(Layer.provideMerge(Reads), Layer.provideMerge(AppConfigLive))

const decodeAnswers = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Struct({ noul: Schema.Number })),
)

const LABELLED = new Set(["wishlist", "player"])
const LIMIT = Number(process.env["EVAL_WEAPONS"] ?? 40)

const QUESTION = {
  question:
    "Is the Destiny 2 weapon perk in `item` one of the top picks for the weapon and activity `request` names, the perk a god roll would pick in its column?",
  true: "Players and roll curators pick this perk on this weapon for that activity; it is among the best options its column offers there.",
  false:
    "Players pass this perk over on this weapon for that activity: other perks in its column do the job better, or it does little there.",
}

interface Case {
  readonly weapon: string
  readonly typeName: string
  readonly purpose: Purpose
  readonly column: number
  readonly perk: string
  readonly good: boolean
}

const auc = (scored: ReadonlyArray<{ readonly score: number; readonly good: boolean }>) => {
  const positives = scored.filter((s) => s.good)
  const negatives = scored.filter((s) => !s.good)
  if (positives.length === 0 || negatives.length === 0) return Number.NaN
  let wins = 0
  for (const p of positives) {
    for (const n of negatives) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  }
  return wins / (positives.length * negatives.length)
}

const accuracyAt = (
  scored: ReadonlyArray<{ readonly score: number; readonly good: boolean }>,
  threshold: number,
) => scored.filter((s) => s.score >= threshold === s.good).length / scored.length

const groupBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string) => {
  const groups = new Map<string, Array<A>>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const program = Effect.gen(function* () {
  const config = yield* AppConfig
  const judgment = yield* (yield* JunkJudge).judgeVault
  const manifest = yield* Manifest

  const byWeapon = new Map<string, { typeName: string; columns: Array<Map<string, RatedPerk>> }>()
  for (const [id, columns] of judgment.columns) {
    const item = judgment.items.get(id)
    if (item === undefined) continue
    const entry = byWeapon.get(item.name) ?? { typeName: item.typeName, columns: [] }
    columns.forEach((column, index) => {
      const merged = entry.columns[index] ?? new Map<string, RatedPerk>()
      for (const perk of column) merged.set(perkKey(perk.name), perk)
      entry.columns[index] = merged
    })
    byWeapon.set(item.name, entry)
  }
  const labelled = [...byWeapon]
    .filter(([, { columns }]) =>
      columns.some((column) =>
        [...column.values()].some((perk) => perk.source !== null && LABELLED.has(perk.source)),
      ),
    )
    .toSorted(([a], [b]) => a.localeCompare(b))
    .slice(0, LIMIT)

  const cases: Array<Case> = labelled.flatMap(([weapon, { typeName, columns }]) =>
    PURPOSES.flatMap((purpose) =>
      columns.flatMap((column, index) =>
        [...column.values()].map((perk) => ({
          weapon,
          typeName,
          purpose,
          column: index,
          perk: perk.name,
          good: perk.good.includes(purpose),
        })),
      ),
    ),
  )

  const defs = yield* manifest.findByName([...new Set(cases.map((c) => c.perk))])
  const description = new Map(
    defs
      .filter((def) => isRolledTrait(def.typeName))
      .map((def) => [perkKey(def.name), def.description.trim()]),
  )

  const client = new TypeSafeClient({
    apiKey: Redacted.value(config.jev.apiKey),
    defaultModel: config.jev.model,
    timeout: 30_000,
    retry: { maxRetries: 1 },
  })
  const groups = groupBy(cases, (c) => `${c.weapon}|${c.purpose}`)
  const scores = new Map<Case, number>()
  yield* Effect.forEach(
    [...groups.values()],
    (group) =>
      Effect.tryPromise(async () => {
        const first = group[0]
        if (first === undefined) return
        const label = first.purpose === "pve" ? "PvE" : "PvP"
        const request = `${first.weapon} (${first.typeName}) for ${label}`
        const response = await client.systemOne({
          model: config.jev.model,
          state: { request },
          questions: Object.fromEntries(
            group.map((c, i) => [
              `p${i}`,
              noul(
                {
                  question: QUESTION.question,
                  item: `${c.perk}: ${description.get(perkKey(c.perk)) ?? "no description"}`,
                },
                { true: QUESTION.true, false: QUESTION.false },
              ),
            ]),
          ),
        })
        const answers = decodeAnswers(response.answers)
        group.forEach((c, i) => {
          const answer = answers[`p${i}`]
          if (answer !== undefined) scores.set(c, answer.noul)
        })
      }),
    { concurrency: 4 },
  )

  const scored = cases.flatMap((c) => {
    const score = scores.get(c)
    return score === undefined ? [] : [{ ...c, score }]
  })
  const thresholds = Array.from({ length: 19 }, (_, i) => (i + 1) / 20)
  const best = thresholds.reduce((a, b) => (accuracyAt(scored, b) > accuracyAt(scored, a) ? b : a))
  const columns = groupBy(scored, (s) => `${s.weapon}|${s.purpose}|${s.column}`)
  const topHits = [...columns.values()].filter((column) => column.some((s) => s.good))
  const hit = topHits.filter((column) => column.reduce((a, b) => (b.score > a.score ? b : a)).good)
  const baseRate = scored.filter((s) => s.good).length / scored.length

  const lines = [
    `weapons ${labelled.length}, perk questions ${scored.length} of ${cases.length}, good ${pct(baseRate)}`,
    `AUC ${auc(scored).toFixed(3)} (0.5 is chance)`,
    ...PURPOSES.map(
      (purpose) =>
        `  ${purpose}: AUC ${auc(scored.filter((s) => s.purpose === purpose)).toFixed(3)}`,
    ),
    `accuracy at 0.5: ${pct(accuracyAt(scored, 0.5))}; best threshold ${best}: ${pct(accuracyAt(scored, best))}; always "not good": ${pct(1 - baseRate)}`,
    `Jev's top perk per column is a good one: ${hit.length} of ${topHits.length} (${pct(hit.length / topHits.length)})`,
    "",
    "Biggest misses:",
    ...scored
      .toSorted((a, b) => Math.abs(b.score - Number(b.good)) - Math.abs(a.score - Number(a.good)))
      .slice(0, 15)
      .map(
        (s) =>
          `  ${s.weapon} ${s.purpose} · ${s.perk} · labelled ${s.good ? "good" : "not good"} · Jev ${s.score.toFixed(2)}`,
      ),
  ]
  yield* Effect.sync(() => console.log(lines.join("\n")))
})

Effect.runPromise(program.pipe(Effect.provide(EvalLive), Effect.scoped)).catch((error) => {
  console.error(error)
  process.exit(1)
})
