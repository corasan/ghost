import { PlanAction, PlanKind, Synergy } from "@ghost/contract"
import { Schema } from "effect"

export const SourceInput = Schema.Struct({
  label: Schema.String,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  asOf: Schema.optional(Schema.NullOr(Schema.String)),
})

export const SubclassInput = Schema.Struct({
  name: Schema.String,
  super: Schema.optional(Schema.String),
  classAbility: Schema.optional(Schema.String),
  jump: Schema.optional(Schema.String),
  melee: Schema.optional(Schema.String),
  grenade: Schema.optional(Schema.String),
  aspects: Schema.optional(Schema.Array(Schema.String)),
  fragments: Schema.optional(Schema.Array(Schema.String)),
})

/** What the agent passes to present_plan. */
export const PlanInput = Schema.Struct({
  kind: PlanKind,
  title: Schema.String,
  subtitle: Schema.optional(
    Schema.String.annotate({
      description:
        "The plan's headline on the card: a short one-liner, at most about 30 characters, naming the build's idea (for example 'Sentinel melee loop'), not every aspect and piece.",
    }),
  ),
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
  chargeEffects: Schema.optional(
    Schema.Array(Schema.Struct({ mod: Schema.String, effect: Schema.String, source: SourceInput })),
  ),
  situational: Schema.optional(Schema.String),
  synergy: Schema.optional(Schema.Struct(Synergy.fields)),
  purpose: Schema.optional(
    Schema.String.annotate({
      description:
        "What the build does, in plain words: subclass and element, activity, stat goals and playstyle, for example 'Void Sentinel Titan build, 100 Health and 100 Class, overshields and Devour'. Pass it for every build, so the set bonuses can be judged against it.",
    }),
  ),
  artifact: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "The Seasonal Artifact perks the build runs, by the names get_artifact gives, including ones already selected. Leave it out only when the character has no artifact or no perks to spend.",
    }),
  ),
  shortfall: Schema.optional(Schema.String),
  subclass: Schema.optional(SubclassInput),
  sources: Schema.optional(Schema.Array(SourceInput)),
})
export type PlanInput = typeof PlanInput.Type

/**
 * Everything that makes a plan, kept so a saved build can be composed again
 * against a later inventory. `characterId` is the character the plan falls
 * back to when a row names none.
 */
export const BuildRecipe = Schema.Struct({
  ...PlanInput.fields,
  characterId: Schema.NullOr(Schema.String),
})
export type BuildRecipe = typeof BuildRecipe.Type
