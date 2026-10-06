import { describe, expect, test } from "bun:test"
import { resolveEffort } from "./settings.ts"

describe("resolveEffort", () => {
  test("the app's choice wins over GHOST_EFFORT", () => {
    expect(resolveEffort("low", "max")).toBe("low")
  })

  test("uses GHOST_EFFORT until the app has chosen", () => {
    expect(resolveEffort(null, "xhigh")).toBe("xhigh")
  })

  test("ignores a stored value that is not an effort level", () => {
    expect(resolveEffort("turbo", "medium")).toBe("medium")
  })

  test("falls back to high when GHOST_EFFORT is not an effort level either", () => {
    expect(resolveEffort(null, "HIGH")).toBe("high")
    expect(resolveEffort(null, "")).toBe("high")
  })
})
