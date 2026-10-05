import { JobStep } from "@ghost/contract"

const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null

const count = (value: unknown, noun: string) =>
  Array.isArray(value) && value.length > 0
    ? `${value.length} ${noun}${value.length === 1 ? "" : "s"}`
    : null

const host = (value: unknown) => {
  const url = text(value)
  if (url === null) return null
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

type Input = Readonly<Record<string, unknown>>

const STEPS: Record<string, { label: string; detail?: (input: Input) => string | null }> = {
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
    detail: (input) => count(input.itemInstanceIds, "item"),
  },
  roll_recommendations: { label: "Looking up recommended rolls" },
  describe_plugs: {
    label: "Reading perk effects",
    detail: (input) =>
      Array.isArray(input.names)
        ? input.names.flatMap((name) => text(name) ?? []).join(", ") || null
        : null,
  },
  get_armor_mods: {
    label: "Reading your armor mods",
    detail: (input) => count(input.itemInstanceIds, "piece"),
  },
  list_armor_mods: {
    label: "Looking up armor mods",
    detail: (input) =>
      [input.slot, input.text].flatMap((part) => text(part) ?? []).join(" · ") || null,
  },
  search_creator_notes: { label: "Checking creator notes", detail: (input) => text(input.query) },
  cite_sources: { label: "Citing sources", detail: (input) => count(input.sources, "source") },
  present_plan: { label: "Writing the plan", detail: (input) => count(input.rows, "item") },
  WebSearch: { label: "Searching the web", detail: (input) => text(input.query) },
  WebFetch: { label: "Reading a page", detail: (input) => host(input.url) },
}

const DETAIL_MAX = 80

export const describeStep = (tool: string, input: unknown): JobStep => {
  const name = tool.replace(/^mcp__ghost__/, "")
  const known = STEPS[name]
  const fields = typeof input === "object" && input !== null ? (input as Input) : {}
  const detail = known?.detail?.(fields) ?? null
  return new JobStep({
    label: known?.label ?? name.replaceAll("_", " "),
    detail:
      detail !== null && detail.length > DETAIL_MAX
        ? `${detail.slice(0, DETAIL_MAX - 1)}…`
        : detail,
  })
}
