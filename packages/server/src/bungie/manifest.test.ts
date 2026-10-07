import { describe, expect, test } from "bun:test"
import { keywordsFrom, type PlugFacts, TUNING_SOCKET, tuningModsFrom } from "./manifest.ts"

describe("tuningModsFrom", () => {
  const facts = (category: string, mods: Readonly<Record<string, number>>): PlugFacts => ({
    mods,
    classMods: {},
    fragmentSlots: 0,
    energyCost: 0,
    category,
    artifact: false,
    charged: false,
    description: "",
    keywords: [],
  })

  test("keeps only tuning mods, each with the stat it raises", () => {
    expect(
      tuningModsFrom(
        new Map([
          [1, facts(TUNING_SOCKET, { "1943323491": 5, "392767087": -5 })],
          [2, facts(TUNING_SOCKET, {})],
          [3, facts("enhancements.v2_general", { "1943323491": 10 })],
        ]),
      ),
    ).toEqual(
      new Map([
        [1, "1943323491"],
        [2, null],
      ]),
    )
  })
})

describe("keywordsFrom", () => {
  test("keeps only traits shown as keywords, with absolute icons", () => {
    expect(
      keywordsFrom({
        "3336638905": {
          displayHint: "keyword",
          displayProperties: {
            name: "Weaken",
            description: "The target takes increased damage.",
            icon: "/common/weaken.png",
          },
        },
        "2833630124": { displayProperties: { name: "Fragment", description: "A fragment." } },
        "1": { displayHint: "keyword", displayProperties: { name: "Blank" } },
      }),
    ).toEqual({
      "3336638905": {
        name: "Weaken",
        description: "The target takes increased damage.",
        icon: "https://www.bungie.net/common/weaken.png",
      },
    })
  })
})
