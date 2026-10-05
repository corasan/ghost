import { ChargeEffect, Source } from "@ghost/contract"
import { Context, Effect, Layer } from "effect"
import { SqlClient, type SqlError } from "effect/sql"

export interface ChargeEffectsShape {
  /** Keyed by lowercased mod name. */
  readonly forMods: (
    names: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyMap<string, ChargeEffect>, SqlError.SqlError>
  readonly record: (
    entries: ReadonlyArray<{ readonly mod: string; readonly effect: ChargeEffect }>,
  ) => Effect.Effect<void, SqlError.SqlError>
}

export class ChargeEffects extends Context.Service<ChargeEffects, ChargeEffectsShape>()(
  "ChargeEffects",
) {}

interface Row {
  readonly mod: string
  readonly effect: string
  readonly source_label: string
  readonly source_url: string | null
  readonly source_as_of: string | null
}

export const ChargeEffectsLive = Layer.effect(
  ChargeEffects,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return {
      forMods: (names) =>
        names.length === 0
          ? Effect.succeed(new Map())
          : sql<Row>`
              SELECT * FROM charge_effects WHERE mod IN ${sql.in(names.map((n) => n.toLowerCase()))}
            `.pipe(
              Effect.map(
                (rows) =>
                  new Map(
                    rows.map((row) => [
                      row.mod,
                      new ChargeEffect({
                        effect: row.effect,
                        source: new Source({
                          label: row.source_label,
                          url: row.source_url,
                          asOf: row.source_as_of,
                        }),
                      }),
                    ]),
                  ),
              ),
            ),
      record: (entries) =>
        Effect.forEach(
          entries,
          ({ mod, effect }) => sql`
            INSERT INTO charge_effects (mod, effect, source_label, source_url, source_as_of, recorded_at)
            VALUES (${mod.toLowerCase()}, ${effect.effect}, ${effect.source.label},
              ${effect.source.url}, ${effect.source.asOf}, ${new Date().toISOString()})
            ON CONFLICT(mod) DO UPDATE SET effect = excluded.effect,
              source_label = excluded.source_label, source_url = excluded.source_url,
              source_as_of = excluded.source_as_of, recorded_at = excluded.recorded_at
          `,
          { discard: true },
        ),
    }
  }),
)
