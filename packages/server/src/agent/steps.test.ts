import { describe, expect, test } from "bun:test"
import { decodeToolInput, describeStep } from "./steps.ts"

type ToolCallInput = Readonly<Record<string, string | number | ReadonlyArray<string>>>

const step = (tool: string, input: ToolCallInput | undefined) => {
  const { label, detail } = describeStep(tool, decodeToolInput(input))
  return { label, detail }
}

describe("describeStep", () => {
  test("names a Ghost tool and says what it searched for", () => {
    expect(
      step("mcp__ghost__search_items", { text: "hand cannon", location: "vault", limit: 20 }),
    ).toEqual({ label: "Searching your items", detail: "hand cannon · vault" })
  })

  test("counts the items being scored", () => {
    expect(step("mcp__ghost__check_rolls", { itemInstanceIds: ["1", "2", "3"] })).toEqual({
      label: "Scoring rolls against the wishlist",
      detail: "3 items",
    })
    expect(step("mcp__ghost__check_rolls", { itemInstanceIds: ["1"] }).detail).toBe("1 item")
  })

  test("shows the site, not the whole address, for a fetched page", () => {
    expect(step("WebFetch", { url: "https://www.destiny2.science/endgame?tab=3" })).toEqual({
      label: "Reading a page",
      detail: "destiny2.science",
    })
  })

  test("leaves detail empty when the tool was called with nothing to show", () => {
    expect(step("mcp__ghost__search_items", {})).toEqual({
      label: "Searching your items",
      detail: null,
    })
    expect(step("mcp__ghost__get_characters", undefined).detail).toBeNull()
  })

  test("falls back to the tool's own name for one it has no label for", () => {
    expect(step("mcp__ghost__compare_loadouts", {})).toEqual({
      label: "compare loadouts",
      detail: null,
    })
  })

  test("cuts a long detail to one line", () => {
    const { detail } = step("WebSearch", { query: "a".repeat(200) })
    expect(detail).toHaveLength(80)
    expect(detail?.endsWith("…")).toBe(true)
  })
})
