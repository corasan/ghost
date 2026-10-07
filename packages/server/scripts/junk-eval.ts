import { Effect, Layer } from "effect"
import { BungieClient, BungieClientLive } from "../src/bungie/client.ts"
import type { OwnedItem } from "../src/bungie/inventory.ts"
import { LoadoutsLive } from "../src/bungie/loadouts.ts"
import { ManifestLive } from "../src/bungie/manifest.ts"
import { ProfileStoreLive } from "../src/bungie/profile.ts"
import { AppConfig, AppConfigLive } from "../src/config.ts"
import { BuildsRepoLive } from "../src/db/builds.ts"
import { DatabaseLive } from "../src/db/client.ts"
import { ItemsRepoLive } from "../src/db/items.ts"
import { PerkRatingsLive } from "../src/db/perk-ratings.ts"
import { SettingsLive } from "../src/db/settings.ts"
import type { Verdict } from "../src/junk/judge.ts"
import { flagged } from "../src/junk/proposal.ts"
import { JunkJudge, JunkJudgeLive } from "../src/junk/service.ts"
import { WishlistLive } from "../src/wishlist/wishlist.ts"

// Judges a real vault and prints the verdicts, for reading by eye. Point
// GHOST_DATA_DIR at a copy of the data directory: reading the profile records
// first-seen times and refreshed tokens there. It never writes to Bungie.

const readOnly = (action: string) => () =>
  Effect.die(new Error(`junk-eval is read-only; it tried to ${action}`))

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

const SAMPLE = 25

const line = (name: string, power: number | null, text: string) =>
  `  ${name}${power === null ? "" : ` ${power}`} · ${text}`

const kind = (item: OwnedItem) =>
  item.tuning === null ? item.typeName : `${item.typeName} · tuning ${item.tuning}`

const program = Effect.gen(function* () {
  const { dataDir } = yield* AppConfig
  const judgment = yield* (yield* JunkJudge).judgeVault
  const counts = { junk: 0, review: 0, keep: 0 }
  const protections = new Map<string, number>()
  for (const verdict of judgment.verdicts.values()) {
    counts[verdict.verdict] += 1
    if (verdict.verdict !== "keep") continue
    for (const p of verdict.protections) protections.set(p, (protections.get(p) ?? 0) + 1)
  }
  const rows = flagged(judgment)
  const protectedSample = [...judgment.verdicts]
    .flatMap(([id, verdict]): Array<readonly [string, Extract<Verdict, { verdict: "keep" }>]> =>
      verdict.verdict === "keep" &&
      verdict.protections.some((p) => p !== "only_copy" && p !== "best_copy")
        ? [[id, verdict]]
        : [],
    )
    .toSorted(([a], [b]) => a.localeCompare(b))
    .slice(0, SAMPLE)
  const out = [
    `data dir: ${dataDir}`,
    `judged ${judgment.verdicts.size} weapons and armor pieces`,
    `verdicts: junk ${counts.junk}, review ${counts.review}, keep ${counts.keep}`,
    `keep protections: ${[...protections]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([p, n]) => `${p} ${n}`)
      .join(", ")}`,
    "",
    `JUNK (${counts.junk})`,
    ...rows
      .filter((row) => row.verdict === "junk")
      .map((row) => line(row.item.name, row.item.power, `${kind(row.item)} · ${row.reason}`)),
    "",
    `REVIEW (${counts.review})`,
    ...rows
      .filter((row) => row.verdict === "review")
      .map((row) => line(row.item.name, row.item.power, `${kind(row.item)} · ${row.reason}`)),
    "",
    `PROTECTED SAMPLE (${protectedSample.length} by item id)`,
    ...protectedSample.map(([id, verdict]) => {
      const item = judgment.items.get(id)
      return line(item?.name ?? id, item?.power ?? null, verdict.protections.join(", "))
    }),
  ]
  yield* Effect.sync(() => console.log(out.join("\n")))
})

Effect.runPromise(program.pipe(Effect.provide(EvalLive), Effect.scoped)).catch((error) => {
  console.error(error)
  process.exit(1)
})
