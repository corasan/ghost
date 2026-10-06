import { describe, expect, test } from "bun:test"
import { type ItemSlot, SetBonus } from "@ghost/contract"
import { Effect, Layer } from "effect"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { ChargeEffects } from "../db/charge.ts"
import { buildRules, composeBuild, synergyMissing } from "./compose.ts"
import type { BuildRecipe } from "./recipe.ts"

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 1,
  name: `Item ${id}`,
  typeName: "Chest Armor",
  icon: null,
  tier: "legendary",
  slot,
  damageType: "none",
  power: 550,
  quantity: 1,
  location: "vault",
  characterId: null,
  equipped: false,
  classType: "titan",
  locked: false,
  masterwork: true,
  statTotal: 60,
  perks: [],
  duplicates: 0,
  decision: null,
  acquiredAt: null,
  armorStats: {
    mobility: 0,
    resilience: 30,
    recovery: 0,
    discipline: 20,
    intellect: 10,
    strength: 0,
  },
  plugHashes: [],
  modSockets: [],
  energy: null,
  exoticPerk: null,
  set: null,
  ...fields,
})

describe("synergyMissing", () => {
  const forceConverter = new SetBonus({
    name: "Force Converter",
    description: "After a final blow with a Rocket Launcher, sprint to gain Speed Booster.",
    icon: null,
    set: "AION Renewal",
    required: 2,
    worn: 2,
  })
  const exotic = owned("x0", "chest", {
    name: "Starfire Protocol",
    tier: "exotic",
    exoticPerk: "Fusion Overdrive: an extra grenade charge.",
  })
  const full = { exotic, setBonuses: [forceConverter], modded: true }

  test("asks for every part the build has and lacks synergy for", () => {
    const parts = synergyMissing({ ...full, synergy: { exotic: " " } })
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain("Starfire Protocol (Fusion Overdrive: an extra grenade charge.)")
    expect(parts[1]).toContain(
      "Force Converter (AION Renewal, 2 pieces, wearing 2): After a final blow",
    )
    expect(parts[2]).toStartWith("mods")
  })

  test("accepts a build once each of its parts has synergy", () => {
    expect(
      synergyMissing({
        ...full,
        synergy: { exotic: "Grenades.", setBonuses: "Speed.", mods: "Energy." },
      }),
    ).toEqual([])
  })

  test("asks for setBonuses synergy only about the bonuses the build turns on", () => {
    const aionFour = new SetBonus({ ...forceConverter, name: "AION Four", required: 4, worn: 3 })
    expect(
      synergyMissing({
        exotic: undefined,
        setBonuses: [aionFour],
        modded: false,
        synergy: undefined,
      }),
    ).toEqual([])
    const [part] = synergyMissing({
      exotic: undefined,
      setBonuses: [forceConverter, aionFour],
      modded: false,
      synergy: undefined,
    })
    expect(part).toContain("Force Converter")
    expect(part).not.toContain("AION Four")
  })

  test("asks for no part the build lacks", () => {
    expect(
      synergyMissing({ exotic: undefined, setBonuses: [], modded: false, synergy: undefined }),
    ).toEqual([])
  })
})

const titan: CharacterInfo = {
  characterId: "titan-1",
  classType: "titan",
  light: 550,
  subclass: "Sentinel",
  subclassIcon: null,
  ghostIcon: null,
  element: "void",
  loadout: { super: null, abilities: [], aspects: [], fragments: [] },
  subclasses: [],
  stats: {
    mobility: 10,
    resilience: 60,
    recovery: 20,
    discipline: 30,
    intellect: 10,
    strength: 40,
  },
  postmasterCount: 0,
}

const wornChest = owned("chest-worn", "chest", {
  location: "character",
  characterId: "titan-1",
  equipped: true,
})

const starfire = owned("chest-exotic", "chest", {
  name: "Starfire Protocol",
  tier: "exotic",
  exoticPerk: "Fusion Overdrive: an extra grenade charge.",
  armorStats: {
    mobility: 0,
    resilience: 10,
    recovery: 0,
    discipline: 40,
    intellect: 10,
    strength: 0,
  },
})

const inventory: Inventory = {
  membershipType: 3,
  membershipId: "m",
  characters: [titan],
  items: [wornChest, starfire],
  vaultCount: 1,
}

const ComposeTest = Layer.mergeAll(
  Layer.succeed(Manifest, {
    statFacts: Effect.succeed({}),
    plugFacts: () => Effect.succeed(new Map()),
    subclassPlugSets: () => Effect.succeed([]),
    armorMods: Effect.succeed([]),
    armorSets: Effect.succeed([]),
    elementIcons: Effect.succeed({}),
    capacities: Effect.succeed({ vault: 700, postmaster: 21 }),
    ensure: Effect.void,
    lookup: () => Effect.succeed(new Map()),
    findByName: () => Effect.succeed([]),
  }),
  Layer.succeed(ProfileStore, {
    inventory: Effect.succeed(inventory),
    plugSets: Effect.succeed({}),
    invalidate: Effect.void,
  }),
  Layer.succeed(ChargeEffects, {
    forMods: () => Effect.succeed(new Map()),
    record: () => Effect.void,
  }),
)

const recipe = (fields: Partial<BuildRecipe> = {}): BuildRecipe => ({
  kind: "build",
  title: "BUILD PLAN",
  subtitle: "Grenade loop",
  confirmLabel: "APPLY BUILD",
  rows: [{ itemInstanceId: "chest-exotic", action: "equip" }],
  purpose: "Solar Titan grenade build",
  synergy: { exotic: "Fusion Overdrive refunds the grenades the loop spends." },
  characterId: "titan-1",
  ...fields,
})

const compose = (input: BuildRecipe) =>
  composeBuild(input, inventory).pipe(Effect.provide(ComposeTest))

const verdict = (input: BuildRecipe) =>
  compose(input).pipe(
    Effect.map((build) => buildRules(input, build)?.message ?? "ok"),
    Effect.catchTag("BuildRefusal", (refusal) => Effect.succeed(refusal.message)),
    Effect.runPromise,
  )

describe("composeBuild", () => {
  test("equips the piece on the recipe's character and counts it in the stats", async () => {
    const build = await Effect.runPromise(compose(recipe()))
    const [row] = build.plan.rows
    expect(row?.characterId).toBe("titan-1")
    expect(row?.meta).toBe("Chest Armor · equip on Titan")
    expect(row?.origin).toBe("Vault")
    expect(build.armor.map((item) => item.itemInstanceId)).toEqual(["chest-exotic"])
    expect(build.plan.stats.find((stat) => stat.label === "GRENADE")?.value).toBe(50)
    expect(build.subclassChanges).toBeNull()
    expect(build.plan.purpose).toBe("Solar Titan grenade build")
  })

  test("refuses ids the player does not own, word for word", async () => {
    expect(await verdict(recipe({ rows: [{ itemInstanceId: "gone", action: "equip" }] }))).toBe(
      "Error: unknown item ids gone. Use ids from search_items or get_characters.",
    )
  })
})

describe("buildRules", () => {
  test("accepts a build with a purpose and synergy for its exotic", async () => {
    expect(await verdict(recipe())).toBe("ok")
  })

  test("refuses a build that misses a stat goal, unless it says why", async () => {
    const goal = { stats: [{ label: "Grenade", value: 100, target: true }] }
    expect(await verdict(recipe(goal))).toStartWith(
      "Error: the build misses stat goals: GRENADE 50, asked 100.",
    )
    expect(await verdict(recipe({ ...goal, shortfall: "No owned armor reaches it." }))).toBe("ok")
  })

  test("refuses a build without a purpose", async () => {
    expect(await verdict(recipe({ purpose: " " }))).toBe(
      "Error: a build needs purpose: what it does, in plain words, so Jev can judge its set bonuses. Call present_plan again with purpose.",
    )
  })

  test("refuses a build whose exotic has no synergy", async () => {
    expect(await verdict(recipe({ synergy: undefined }))).toStartWith(
      "Error: the build needs synergy, one or two sentences per part on how it feeds the rest of the build: exotic, on what Starfire Protocol (Fusion Overdrive: an extra grenade charge.) does",
    )
  })
})
