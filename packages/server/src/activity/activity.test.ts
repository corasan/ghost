import { describe, expect, test } from "bun:test"
import { startOfDay } from "./activity.ts"

describe("startOfDay", () => {
  test("starts the day at midnight in the player's time zone", () => {
    const now = Date.parse("2026-10-08T03:30:00Z")
    expect(startOfDay(now, "America/Los_Angeles")).toBe("2026-10-07T07:00:00.000Z")
    expect(startOfDay(now, "Europe/Berlin")).toBe("2026-10-07T22:00:00.000Z")
  })

  test("falls back to the server's day for a zone that does not resolve", () => {
    const now = Date.parse("2026-10-08T03:30:00Z")
    const local = new Date(now)
    local.setHours(0, 0, 0, 0)
    expect(startOfDay(now, "Nowhere/Atlantis")).toBe(local.toISOString())
  })
})
