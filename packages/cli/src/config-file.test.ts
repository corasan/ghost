import { describe, expect, test } from "bun:test"
import { parseSettings, updateSettings } from "./config-file.ts"

describe("parseSettings", () => {
  test("reads keys, skips comments, and unquotes values", () => {
    const settings = parseSettings(
      [
        "# Bungie",
        "BUNGIE_API_KEY=abc123",
        'GHOST_YOUTUBE_CHANNELS="@Datto,Aegis Destiny 2"',
        "export GHOST_PORT=4900 # tailnet",
        "",
      ].join("\n"),
    )
    expect([...settings]).toEqual([
      ["BUNGIE_API_KEY", "abc123"],
      ["GHOST_YOUTUBE_CHANNELS", "@Datto,Aegis Destiny 2"],
      ["GHOST_PORT", "4900"],
    ])
  })

  test("drops a comment after a quoted value", () => {
    const settings = parseSettings(
      ['GHOST_A="a b" # note', "GHOST_B='c d'   # note", 'GHOST_C="say \\"hi\\"" # x'].join("\n"),
    )
    expect([...settings]).toEqual([
      ["GHOST_A", "a b"],
      ["GHOST_B", "c d"],
      ["GHOST_C", 'say "hi"'],
    ])
  })
})

describe("updateSettings", () => {
  test("rewrites existing keys in place, keeps comments, and appends new keys", () => {
    const before = ["# my notes", "GHOST_PORT=4848", "GHOST_MODEL=claude-sonnet-5-5", ""].join("\n")
    const after = updateSettings(
      before,
      new Map([
        ["GHOST_PORT", "4900"],
        ["BUNGIE_CLIENT_SECRET", "s3cret value"],
      ]),
    )
    expect(after).toBe(
      [
        "# my notes",
        "GHOST_PORT=4900",
        "GHOST_MODEL=claude-sonnet-5-5",
        'BUNGIE_CLIENT_SECRET="s3cret value"',
        "",
      ].join("\n"),
    )
  })

  test("round-trips what it writes", () => {
    const written = updateSettings("", new Map([["GHOST_YOUTUBE_CHANNELS", "@Datto, Aegis #1"]]))
    expect(parseSettings(written).get("GHOST_YOUTUBE_CHANNELS")).toBe("@Datto, Aegis #1")
  })
})

test("values with quotes and backslashes survive repeated saves", () => {
  const value = 'say "hi" \\ bye'
  const once = updateSettings("", new Map([["GHOST_NOTE", value]]))
  const twice = updateSettings(
    once,
    new Map([["GHOST_NOTE", parseSettings(once).get("GHOST_NOTE") ?? ""]]),
  )
  expect(parseSettings(twice).get("GHOST_NOTE")).toBe(value)
})
