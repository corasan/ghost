import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  ArtifactProfile,
  type CharacterArtifact,
  parseArtifact,
  type PerkFacts,
  planArtifact,
} from "./artifact.ts"

const item = (itemHash: number, isActive: boolean) => ({ itemHash, isActive, isVisible: true })

const response = {
  responseMintedTimestamp: "2026-10-06T05:21:20Z",
  profileProgression: {
    data: {
      checklists: {},
      seasonalArtifact: {
        artifactHash: 2894222926,
        pointProgression: {
          progressionHash: 3443776603,
          currentProgress: 4025000,
          level: 12,
          levelCap: 12,
          stepIndex: 12,
        },
        pointsAcquired: 0,
        powerBonus: 0,
      },
    },
    privacy: 1,
  },
  characterProgressions: {
    data: {
      "2305843009309769093": {
        progressions: {},
        seasonalArtifact: {
          artifactHash: 2894222926,
          pointsUsed: 12,
          resetCount: 0,
          tiers: [
            {
              tierHash: 3144670121,
              isUnlocked: true,
              pointsToUnlock: 0,
              items: [item(4217417017, true), item(4217417018, false)],
            },
            {
              tierHash: 3144670122,
              isUnlocked: true,
              pointsToUnlock: 0,
              items: [item(3619040074, true), { ...item(3619040075, false), isVisible: false }],
            },
          ],
        },
      },
      "2305843009363125331": {
        seasonalArtifact: {
          artifactHash: 2894222926,
          pointsUsed: 0,
          resetCount: 0,
          tiers: [
            { tierHash: 3144670121, isUnlocked: true, pointsToUnlock: 0, items: [] },
            { tierHash: 3144670122, isUnlocked: false, pointsToUnlock: 3, items: [] },
          ],
        },
      },
      "2305843009877264518": { progressions: {} },
    },
    privacy: 2,
  },
}

const definition = {
  displayProperties: { name: "Implement of Curiosity" },
  tiers: [
    { tierHash: 3144670121, minimumUnlockPointsUsedRequirement: 0 },
    { tierHash: 3144670122, minimumUnlockPointsUsedRequirement: 3 },
  ],
}

const names = new Map([
  [4217417017, "Anti-Barrier Hand Cannon"],
  [4217417018, "Anti-Barrier Sniper Rifle"],
  [3619040074, "Expert Handling"],
  [3619040075, "Gravitic-Voltaic Charge"],
])

const facts = (hash: number): PerkFacts | undefined => {
  const name = names.get(hash)
  return name === undefined ? undefined : { name, description: `${name} effect`, icon: null }
}

const profile = Schema.decodeUnknownSync(ArtifactProfile)(response)

describe("parseArtifact", () => {
  test("reads the account's points, the character's columns and which perks are active", () => {
    const artifact = parseArtifact(profile, "2305843009309769093", definition, facts)
    expect(artifact?.name).toBe("Implement of Curiosity")
    expect(artifact?.pointsAvailable).toBe(12)
    expect(artifact?.pointsUsed).toBe(12)
    expect(
      artifact?.tiers.map((tier) => ({
        column: tier.column,
        unlocksAt: tier.unlocksAt,
        perks: tier.perks.map((perk) => [perk.name, perk.active]),
      })),
    ).toEqual([
      {
        column: 0,
        unlocksAt: 0,
        perks: [
          ["Anti-Barrier Hand Cannon", true],
          ["Anti-Barrier Sniper Rifle", false],
        ],
      },
      { column: 1, unlocksAt: 3, perks: [["Expert Handling", true]] },
    ])
  })

  test("takes when a column opens from the definition, since Bungie counts it down as points are spent", () => {
    const spent = parseArtifact(profile, "2305843009309769093", definition, facts)
    const fresh = parseArtifact(profile, "2305843009363125331", definition, facts)
    expect(spent?.tiers[1]?.unlocksAt).toBe(3)
    expect(fresh?.tiers[1]).toMatchObject({ unlocked: false, unlocksAt: 3 })
  })

  test("gives null for a character without an artifact", () => {
    expect(parseArtifact(profile, "2305843009877264518", definition, facts)).toBeNull()
    expect(parseArtifact(profile, "missing", definition, facts)).toBeNull()
  })
})

const perk = (name: string, active = false) => ({
  hash: name.charCodeAt(0),
  name,
  description: `${name} effect`,
  icon: null,
  active,
})

const artifact: CharacterArtifact = {
  artifactHash: 1,
  name: "Implement of Curiosity",
  pointsAvailable: 4,
  pointsUsed: 3,
  tiers: [
    {
      column: 0,
      unlocked: true,
      unlocksAt: 0,
      perks: [perk("A", true), perk("B", true), perk("C")],
    },
    { column: 1, unlocked: true, unlocksAt: 2, perks: [perk("D", true), perk("E")] },
    { column: 2, unlocked: false, unlocksAt: 3, perks: [perk("F")] },
  ],
}

const picked = (names: ReadonlyArray<string>) => {
  const plan = planArtifact(artifact, names)
  return "errors" in plan
    ? plan
    : { reset: plan.reset, picks: plan.picks.map((pick) => [pick.name, pick.column, pick.state]) }
}

describe("planArtifact", () => {
  test("adds picks beside the active perks when the points allow, marking which to select in game", () => {
    expect(picked(["b ", "E"])).toEqual({
      reset: false,
      picks: [
        ["B", 0, "active"],
        ["E", 1, "select_in_game"],
      ],
    })
  })

  test("asks for a reset when the picks only fit once the active perks come off", () => {
    expect(picked(["A", "C", "E"])).toEqual({
      reset: true,
      picks: [
        ["A", 0, "active"],
        ["C", 0, "select_in_game"],
        ["E", 1, "select_in_game"],
      ],
    })
  })

  test("refuses a pick whose column the picks leave closed", () => {
    expect(picked(["C", "E"])).toEqual({
      errors: [
        '"E" sits in column 2, which opens after 2 points in earlier columns, and the picks put 1 there',
      ],
    })
  })

  test("counts the active perks toward opening a column when they stay", () => {
    expect(picked(["F"])).toEqual({ reset: false, picks: [["F", 2, "select_in_game"]] })
  })

  test("refuses picks over the point budget", () => {
    expect(picked(["A", "B", "C", "D", "E"])).toEqual({
      errors: ["the picks take 5 points and Implement of Curiosity has 4"],
    })
  })

  test("refuses a perk the artifact does not have", () => {
    expect(picked(["A", "Grenade Kickstart"])).toEqual({
      errors: ['"Grenade Kickstart" is not a perk on Implement of Curiosity'],
    })
  })
})
