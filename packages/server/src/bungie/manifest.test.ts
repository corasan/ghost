import { describe, expect, test } from "bun:test"
import { keywordsFrom } from "./manifest.ts"

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
