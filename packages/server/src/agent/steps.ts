import { JobStep } from "@ghost/contract"
import { Effect, Option, Schema } from "effect"

const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)))

const ToolInput = Schema.Struct({
  text: lenient(Schema.String),
  category: lenient(Schema.String),
  slot: lenient(Schema.String),
  tier: lenient(Schema.String),
  damageType: lenient(Schema.String),
  location: lenient(Schema.String),
  subclass: lenient(Schema.String),
  query: lenient(Schema.String),
  url: lenient(Schema.String),
  names: lenient(Schema.Array(Schema.String)),
  itemInstanceIds: lenient(Schema.Array(Schema.Unknown)),
  sources: lenient(Schema.Array(Schema.Unknown)),
  rows: lenient(Schema.Array(Schema.Unknown)),
})

type ToolInput = typeof ToolInput.Type

/** What a tool call's input says, keeping the fields a step describes and dropping the rest. */
export const decodeToolInput = Schema.decodeUnknownSync(
  ToolInput.pipe(Schema.catchDecoding(() => Effect.succeed(Option.some({})))),
)

const text = (value: string | undefined) =>
  value !== undefined && value.trim() !== "" ? value.trim() : null

const count = (length: number | undefined, noun: string) =>
  length !== undefined && length > 0 ? `${length} ${noun}${length === 1 ? "" : "s"}` : null

const host = (value: string | undefined) => {
  const url = text(value)
  if (url === null) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

interface StepCopy {
  readonly label: string
  readonly detail?: (input: ToolInput) => string | null
}

const STEPS = new Map<string, StepCopy>(
  Object.entries({
    get_characters: { label: "Reading your characters" },
    search_items: {
      label: "Searching your items",
      detail: (input) =>
        [input.text, input.category, input.slot, input.tier, input.damageType, input.location]
          .flatMap((part) => text(part) ?? [])
          .join(" · ") || null,
    },
    check_rolls: {
      label: "Scoring rolls against the wishlist",
      detail: (input) => count(input.itemInstanceIds?.length, "item"),
    },
    roll_recommendations: { label: "Looking up recommended rolls" },
    describe_plugs: {
      label: "Reading perk effects",
      detail: (input) =>
        input.names === undefined
          ? null
          : input.names.flatMap((name) => text(name) ?? []).join(", ") || null,
    },
    get_armor_mods: {
      label: "Reading your armor mods",
      detail: (input) => count(input.itemInstanceIds?.length, "piece"),
    },
    list_armor_mods: {
      label: "Looking up armor mods",
      detail: (input) =>
        [input.slot, input.text].flatMap((part) => text(part) ?? []).join(" · ") || null,
    },
    list_subclasses: {
      label: "Looking up your subclasses",
      detail: (input) => text(input.subclass),
    },
    search_creator_notes: { label: "Checking creator notes", detail: (input) => text(input.query) },
    cite_sources: {
      label: "Citing sources",
      detail: (input) => count(input.sources?.length, "source"),
    },
    present_plan: {
      label: "Writing the plan",
      detail: (input) => count(input.rows?.length, "item"),
    },
    WebSearch: { label: "Searching the web", detail: (input) => text(input.query) },
    WebFetch: { label: "Reading a page", detail: (input) => host(input.url) },
  }),
)

const DETAIL_MAX = 80

export const describeStep = (tool: string, input: ToolInput): JobStep => {
  const name = tool.replace(/^mcp__ghost__/, "")
  const known = STEPS.get(name)
  const detail = known?.detail?.(input) ?? null
  return new JobStep({
    label: known?.label ?? name.replaceAll("_", " "),
    detail:
      detail !== null && detail.length > DETAIL_MAX
        ? `${detail.slice(0, DETAIL_MAX - 1)}…`
        : detail,
  })
}
