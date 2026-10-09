import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Redacted } from "effect"
import { FetchHttpClient } from "effect/http"
import { SqlClient } from "effect/sql"
import { AppConfig } from "../config.ts"
import { DatabaseLive } from "../db/client.ts"
import { Settings, SettingsLive } from "../db/settings.ts"
import {
  keywordsFrom,
  Manifest,
  ManifestLive,
  type PlugFacts,
  TUNING_SOCKET,
  tuningModsFrom,
} from "./manifest.ts"

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

describe("ManifestLive plug lookups", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "ghost-manifest-"))
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

  const config = Layer.succeed(AppConfig, {
    host: "127.0.0.1",
    port: 0,
    dataDir,
    model: "test",
    effort: "low",
    claudePath: "",
    youtubeChannels: "",
    bungie: { apiKey: Redacted.make("key"), clientId: "", clientSecret: Redacted.make("") },
    jev: { apiKey: Redacted.make(""), model: "test" },
  })
  const manifest = ManifestLive.pipe(
    Layer.provideMerge(SettingsLive),
    Layer.provideMerge(DatabaseLive),
    Layer.provide(config),
  )

  const maintenance = () =>
    Response.json({ ErrorCode: 5, ErrorStatus: "SystemDisabled", Message: "down" })

  test("a Bungie error is not remembered as an empty definition", async () => {
    const asked: Array<string> = []
    const replies = [
      maintenance,
      () =>
        Response.json({
          ErrorCode: 1,
          ErrorStatus: "Success",
          Message: "Ok",
          Response: {
            displayProperties: { description: "Grants a bonus." },
            plug: { plugCategoryIdentifier: "enhancements.v2_arms" },
          },
        }),
    ]
    // The version check meets maintenance too, which lookups must survive.
    const fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        if (!url.includes("/DestinyInventoryItemDefinition/")) return maintenance()
        asked.push(url)
        return (replies[asked.length - 1] ?? maintenance)()
      },
      { preconnect: () => {} },
    )
    const [first, second, third] = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Manifest
        const first = yield* service.plugFacts([111])
        const second = yield* service.plugFacts([111])
        const third = yield* service.plugFacts([111])
        return [first, second, third]
      }).pipe(Effect.provide(manifest), Effect.provideService(FetchHttpClient.Fetch, fetch)),
    )
    expect(first?.size).toBe(0)
    expect(second?.get(111)).toMatchObject({
      category: "enhancements.v2_arms",
      description: "Grants a bonus.",
    })
    expect(third?.get(111)).toEqual(second?.get(111))
    expect(asked).toHaveLength(2)
  })

  test("names resolve from a whole local copy while Bungie is down", async () => {
    const fetch = Object.assign(async () => maintenance(), { preconnect: () => {} })
    const [described, any] = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const settings = yield* Settings
        yield* sql`INSERT INTO manifest_items ${sql.insert({
          hash: 222,
          name: "Ace of Spades",
          type_name: "Hand Cannon",
          icon: null,
          tier_type: 6,
          bucket_hash: 1498876634,
          item_type: 3,
          damage_type: 1,
          class_type: 3,
          description: null,
        })}`
        yield* settings.set("manifest.version", "local")
        const service = yield* Manifest
        return [
          yield* service.findByName(["ace of spades"]),
          yield* service.findByName(["ace of spades"], "any"),
        ]
      }).pipe(Effect.provide(manifest), Effect.provideService(FetchHttpClient.Fetch, fetch)),
    )
    expect(described).toEqual([])
    expect(any?.map((item) => item.name)).toEqual(["Ace of Spades"])
  })
})
