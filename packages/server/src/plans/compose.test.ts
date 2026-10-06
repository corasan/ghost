import { describe, expect, test } from "bun:test"
import { type ItemSlot, SetBonus } from "@ghost/contract"
import { Effect, Layer } from "effect"
import type { CharacterInfo, Inventory, OwnedItem } from "../bungie/inventory.ts"
import { Manifest } from "../bungie/manifest.ts"
import { ProfileStore } from "../bungie/profile.ts"
import { ChargeEffects } from "../db/charge.ts"
import type { ManifestItem } from "../bungie/manifest.ts"
import { Wishlist } from "../wishlist/wishlist.ts"
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
  const bow = { name: "Le Monarque", typeName: "Combat Bow", damageType: "void" as const }
  const full = {
    exotic,
    setBonuses: [forceConverter],
    modded: true,
    weapons: [bow],
    element: "void" as const,
  }
  const bare = {
    exotic: undefined,
    setBonuses: [],
    modded: false,
    weapons: [],
    element: undefined,
  }

  test("asks for every part the build has and lacks synergy for", () => {
    const parts = synergyMissing({ ...full, synergy: { exotic: " " } })
    expect(parts).toHaveLength(4)
    expect(parts[0]).toContain("Starfire Protocol (Fusion Overdrive: an extra grenade charge.)")
    expect(parts[1]).toContain(
      "Force Converter (AION Renewal, 2 pieces, wearing 2): After a final blow",
    )
    expect(parts[2]).toStartWith("mods")
    expect(parts[3]).toStartWith("weapons")
  })

  test("accepts a build once each of its parts has synergy", () => {
    expect(
      synergyMissing({
        ...full,
        synergy: { exotic: "Grenades.", setBonuses: "Speed.", mods: "Energy.", weapons: "Bow." },
      }),
    ).toEqual([])
  })

  test("names each weapon's type and element and flags one off the subclass element", () => {
    const [part] = synergyMissing({
      ...bare,
      weapons: [
        { name: "Ace of Spades", typeName: "Hand Cannon", damageType: "kinetic" },
        { name: "Riskrunner", typeName: "Submachine Gun", damageType: "arc" },
        { name: "Edge Transit", typeName: "Grenade Launcher", damageType: "void" },
      ],
      element: "void",
      synergy: undefined,
    })
    expect(part).toBe(
      "weapons, on how the three weapons feed the loop: Ace of Spades (Hand Cannon, kinetic), Riskrunner (Submachine Gun, arc, not void like the subclass), Edge Transit (Grenade Launcher, void)",
    )
  })

  test("asks for setBonuses synergy only about the bonuses the build turns on", () => {
    const aionFour = new SetBonus({ ...forceConverter, name: "AION Four", required: 4, worn: 3 })
    expect(synergyMissing({ ...bare, setBonuses: [aionFour], synergy: undefined })).toEqual([])
    const [part] = synergyMissing({
      ...bare,
      setBonuses: [forceConverter, aionFour],
      synergy: undefined,
    })
    expect(part).toContain("Force Converter")
    expect(part).not.toContain("AION Four")
  })

  test("asks for no part the build lacks", () => {
    expect(synergyMissing({ ...bare, synergy: undefined })).toEqual([])
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

const weapon = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}) =>
  owned(id, slot, {
    name: `Weapon ${id}`,
    typeName: "Auto Rifle",
    damageType: slot === "kinetic" ? "kinetic" : "void",
    classType: null,
    armorStats: null,
    statTotal: null,
    location: "character",
    characterId: "titan-1",
    ...fields,
  })

const kinetic = weapon("kinetic-1", "kinetic", {
  itemHash: 500,
  typeName: "Hand Cannon",
  equipped: true,
  perks: ["Outlaw", "Rampage"],
  plugHashes: [101, 103],
})

const trait = (hash: number, name: string): ManifestItem => ({
  hash,
  name,
  typeName: "Trait",
  icon: null,
  tier: "common",
  slot: "other",
  damageType: "none",
  bucketHash: 0,
  classType: 3,
  description: "",
})

const traits = new Map([
  [101, trait(101, "Outlaw")],
  [102, trait(102, "Kill Clip")],
  [103, trait(103, "Rampage")],
])

const outlawKillClip = {
  itemHash: 500,
  perkHashes: [101, 102],
  trash: false,
  block: {
    notes: null,
    tags: [],
    sectionTitle: null,
    sectionDescription: null,
    sectionUrl: null,
    sectionDate: null,
  },
}
const energy = weapon("energy-1", "energy", { equipped: true })
const energySpare = weapon("energy-2", "energy")
const power = weapon("power-1", "power", { equipped: true })
const exoticEnergy = weapon("energy-x", "energy", { name: "Riskrunner", tier: "exotic" })
const exoticPower = weapon("power-x", "power", { name: "Gjallarhorn", tier: "exotic" })

const inventory: Inventory = {
  membershipType: 3,
  membershipId: "m",
  characters: [titan],
  items: [wornChest, starfire, kinetic, energy, energySpare, power, exoticEnergy, exoticPower],
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
    lookup: () => Effect.succeed(traits),
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
  Layer.succeed(Wishlist, {
    ensure: Effect.void,
    rollsFor: () => Effect.succeed(new Map([[500, [outlawKillClip]]])),
    asOf: Effect.succeed(null),
    source: Effect.die("unused"),
  }),
)

const weaponRows = (ids: ReadonlyArray<string>) =>
  ids.map((itemInstanceId) => ({ itemInstanceId, action: "none" as const }))

const recipe = (fields: Partial<BuildRecipe> = {}): BuildRecipe => ({
  kind: "build",
  title: "BUILD PLAN",
  subtitle: "Grenade loop",
  confirmLabel: "APPLY BUILD",
  rows: [
    { itemInstanceId: "chest-exotic", action: "equip" },
    ...weaponRows(["kinetic-1", "energy-1", "power-1"]),
  ],
  purpose: "Solar Titan grenade build",
  synergy: {
    exotic: "Fusion Overdrive refunds the grenades the loop spends.",
    weapons: "The auto rifles keep grenades coming.",
  },
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
    const row = build.plan.rows.find((r) => r.itemInstanceId === "chest-exotic")
    expect(row?.characterId).toBe("titan-1")
    expect(row?.meta).toBe("Chest Armor · equip on Titan")
    expect(row?.origin).toBe("Vault")
    expect(build.armor.map((item) => item.itemInstanceId)).toEqual(["chest-exotic"])
    expect(build.plan.stats.find((stat) => stat.label === "GRENADE")?.value).toBe(50)
    expect(build.subclassChanges).toBeNull()
    expect(build.plan.purpose).toBe("Solar Titan grenade build")
  })

  test("fills a weapon row's type, its perks the wishlist roll lists and the wishlist score", async () => {
    const build = await Effect.runPromise(compose(recipe()))
    const row = build.plan.rows.find((r) => r.itemInstanceId === "kinetic-1")
    expect(row?.typeName).toBe("Hand Cannon")
    expect(row?.perks?.map((perk) => [perk.name, perk.good])).toEqual([
      ["Outlaw", true],
      ["Rampage", false],
    ])
    expect(row?.score).toBe(60)
  })

  test("keeps the score the agent gave a weapon", async () => {
    const rows = recipe().rows.map((row) =>
      row.itemInstanceId === "kinetic-1" ? { ...row, score: 90 } : row,
    )
    const build = await Effect.runPromise(compose(recipe({ rows })))
    expect(build.plan.rows.find((r) => r.itemInstanceId === "kinetic-1")?.score).toBe(90)
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

  test("refuses a build that leaves a weapon slot empty", async () => {
    const rows = [
      { itemInstanceId: "chest-exotic", action: "equip" as const },
      ...weaponRows(["kinetic-1", "energy-1"]),
    ]
    expect(await verdict(recipe({ rows }))).toBe(
      "Error: a build lists exactly one weapon for each of kinetic, energy and power, with action none for one that stays equipped; this one has no power weapon. Call present_plan again with all three.",
    )
  })

  test("refuses a build that lists two weapons for one slot", async () => {
    const rows = [
      { itemInstanceId: "chest-exotic", action: "equip" as const },
      ...weaponRows(["kinetic-1", "energy-1", "energy-2", "power-1"]),
    ]
    expect(await verdict(recipe({ rows }))).toContain(
      "this one has 2 energy weapons (Weapon energy-1, Weapon energy-2).",
    )
  })

  test("refuses a build with two exotic weapons and accepts one", async () => {
    const twoExotics = [
      { itemInstanceId: "chest-exotic", action: "equip" as const },
      ...weaponRows(["kinetic-1"]),
      { itemInstanceId: "energy-x", action: "equip" as const },
      { itemInstanceId: "power-x", action: "equip" as const },
    ]
    expect(await verdict(recipe({ rows: twoExotics }))).toStartWith(
      "Error: a build can equip only one exotic weapon; this one has Riskrunner and Gjallarhorn.",
    )
    const oneExotic = twoExotics.filter((row) => row.itemInstanceId !== "power-x")
    oneExotic.push({ itemInstanceId: "power-1", action: "none" })
    expect(await verdict(recipe({ rows: oneExotic }))).toBe("ok")
  })

  test("refuses a build without synergy for its weapons", async () => {
    expect(await verdict(recipe({ synergy: { exotic: "Grenades." } }))).toStartWith(
      "Error: the build needs synergy, one or two sentences per part on how it feeds the rest of the build: weapons, on how the three weapons feed the loop: Weapon kinetic-1 (Hand Cannon, kinetic)",
    )
  })

  test("refuses a build whose exotic has no synergy", async () => {
    expect(await verdict(recipe({ synergy: { weapons: "Rifles." } }))).toStartWith(
      "Error: the build needs synergy, one or two sentences per part on how it feeds the rest of the build: exotic, on what Starfire Protocol (Fusion Overdrive: an extra grenade charge.) does",
    )
  })
})
