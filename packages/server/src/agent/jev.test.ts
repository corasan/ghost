import { describe, expect, test } from "bun:test"
import { type Candidate, chunk, requestBody } from "./jev.ts"

const intent = "Void Titan build prioritizing Health and grenade uptime"

const candidates: ReadonlyArray<Candidate> = Array.from({ length: 300 }, (_, i) => ({
  id: `69175290000${String(i).padStart(5, "0")}`,
  text: `Item ${i}; legendary titan Helmet; helmet slot; perks: ${"Perk ".repeat(i % 40)}`,
}))

describe("chunk", () => {
  const budget = 2_000
  const chunks = chunk("jev-latest", intent, candidates, "item", budget)

  test.each(["item", "set bonus", "outclassed"] as const)(
    "keeps every request body about an %s within the token budget",
    (subject) => {
      const parts = chunk("jev-latest", intent, candidates, subject, budget)
      expect(parts.length).toBeGreaterThan(1)
      for (const part of parts) {
        const chars = JSON.stringify(requestBody("jev-latest", intent, part, subject)).length
        expect(chars / 4).toBeLessThanOrEqual(budget)
      }
    },
  )

  test("sends every candidate exactly once, in order", () => {
    expect(chunks.flat().map((c) => c.id)).toEqual(candidates.map((c) => c.id))
  })

  test("sends nothing when there is nothing to rank", () => {
    expect(chunk("jev-latest", intent, [], "item", budget)).toEqual([])
  })

  test("packs many candidates into one request at the real budget", () => {
    expect(chunk("jev-latest", intent, candidates.slice(0, 50))).toHaveLength(1)
  })
})
