import { describe, expect, test } from "bun:test"
import { type Candidate, chunk, requestBody } from "./jev.ts"

const intent = "Void Titan build prioritizing Health and grenade uptime"

const candidates: ReadonlyArray<Candidate> = Array.from({ length: 300 }, (_, i) => ({
  id: `69175290000${String(i).padStart(5, "0")}`,
  text: `Item ${i}; legendary titan Helmet; helmet slot; perks: ${"Perk ".repeat(i % 40)}`,
}))

describe("chunk", () => {
  const budget = 2_000
  const chunks = chunk("jev-latest", intent, candidates, budget)

  test("keeps every request body within the token budget", () => {
    expect(chunks.length).toBeGreaterThan(1)
    for (const part of chunks) {
      const chars = JSON.stringify(requestBody("jev-latest", intent, part)).length
      expect(chars / 4).toBeLessThanOrEqual(budget)
    }
  })

  test("sends every candidate exactly once, in order", () => {
    expect(chunks.flat().map((c) => c.id)).toEqual(candidates.map((c) => c.id))
  })

  test("sends nothing when there is nothing to rank", () => {
    expect(chunk("jev-latest", intent, [], budget)).toEqual([])
  })

  test("packs many candidates into one request at the real budget", () => {
    expect(chunk("jev-latest", intent, candidates.slice(0, 50))).toHaveLength(1)
  })
})
