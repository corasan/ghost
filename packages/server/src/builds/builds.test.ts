import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ArmorMod,
  ArtifactPlan,
  type ItemSlot,
  LoadoutSaveTo,
  LoadoutSlotInvalid,
  Plan,
  PlanNotApplicable,
  PlanRow,
  SubclassLoadout,
} from '@ghost/contract'
import { BungieError } from '../bungie/client.ts'
import { Effect, Layer, Redacted } from 'effect'
import type { CharacterInfo, Inventory, OwnedItem } from '../bungie/inventory.ts'
import { type GameLoadout, type GameLoadouts, Loadouts, snapshotOf } from '../bungie/loadouts.ts'
import {
  type ArmorModEntry,
  Manifest,
  type ManifestItem,
  type ManifestService,
} from '../bungie/manifest.ts'
import { ProfileStore } from '../bungie/profile.ts'
import { AppConfig } from '../config.ts'
import { type BuildLink, BuildsRepo, BuildsRepoLive } from '../db/builds.ts'
import { ChargeEffects } from '../db/charge.ts'
import { Artifacts } from '../bungie/artifact.ts'
import { Wishlist } from '../wishlist/wishlist.ts'
import { DatabaseLive } from '../db/client.ts'
import { JobsRepo, JobsRepoLive } from '../db/jobs.ts'
import type { BuildRecipe } from '../plans/recipe.ts'
import {
  baselineFor,
  Builds,
  BuildsLive,
  buildFacets,
  buildReadiness,
  linkState,
  normalizePlan,
  substitute,
} from './builds.ts'

const owned = (id: string, slot: ItemSlot, fields: Partial<OwnedItem> = {}): OwnedItem => ({
  itemInstanceId: id,
  itemHash: 100,
  name: `Item ${id}`,
  typeName: 'Chest Armor',
  icon: null,
  tier: 'legendary',
  slot,
  damageType: 'none',
  power: 550,
  quantity: 1,
  location: 'vault',
  characterId: null,
  equipped: false,
  classType: 'titan',
  locked: false,
  masterwork: false,
  statTotal: 60,
  perks: [],
  duplicates: 0,
  decision: null,
  acquiredAt: null,
  armorStats: null,
  plugHashes: [],
  modSockets: [],
  weaponSockets: [],
  weaponStats: {},
  energy: null,
  exoticPerk: null,
  intrinsics: [],
  set: null,
  crafted: false,
  tuning: null,
  traits: [],
  ...fields,
})

const row = (item: OwnedItem, action: PlanRow['action'] = 'equip', fields: Partial<PlanRow> = {}) =>
  new PlanRow({
    itemInstanceId: item.itemInstanceId,
    itemHash: item.itemHash,
    name: item.name,
    icon: null,
    tier: item.tier,
    meta: '',
    power: item.power,
    score: null,
    action,
    characterId: 'titan-1',
    selected: true,
    outcome: 'ok',
    error: null,
    slot: item.slot,
    typeName: item.typeName,
    ...fields,
  })

const loadout = new SubclassLoadout({
  classType: 'titan',
  subclass: 'Sentinel',
  element: 'void',
  super: null,
  aspects: [],
  fragments: [],
})

const plan = (rows: ReadonlyArray<PlanRow>, fields: Partial<Plan> = {}) =>
  new Plan({
    kind: 'build',
    title: 'BUILD PLAN',
    subtitle: 'Melee loop',
    stats: [],
    featured: null,
    rows,
    note: null,
    confirmLabel: 'APPLY BUILD',
    status: 'applied',
    loadout,
    ...fields,
  })

const titan: CharacterInfo = {
  characterId: 'titan-1',
  classType: 'titan',
  light: 550,
  subclass: 'Sentinel',
  subclassIcon: null,
  ghostIcon: null,
  element: 'void',
  loadout: { super: null, abilities: [], aspects: [], fragments: [] },
  subclasses: [],
  stats: { mobility: 0, resilience: 0, recovery: 0, discipline: 0, intellect: 0, strength: 0 },
  postmasterCount: 0,
}

const inventory = (items: ReadonlyArray<OwnedItem>): Inventory => ({
  membershipType: 3,
  membershipId: 'm',
  characters: [titan],
  items,
  vaultCount: 0,
})

const bow = owned('bow', 'kinetic', { typeName: 'Combat Bow', tier: 'exotic', name: 'Le Monarque' })
const rifle = owned('rifle', 'energy', { typeName: 'Auto Rifle' })
const rocket = owned('rocket', 'power', { typeName: 'Rocket Launcher' })
const helm = owned('helm', 'helmet', {
  typeName: 'Helmet',
  tier: 'exotic',
  name: 'Loreley Splendor',
})
const chest = owned('chest', 'chest')

describe('buildFacets', () => {
  test('reads class and element from the subclass and the exotics and weapon types from the rows', () => {
    const facets = buildFacets(
      plan([row(rocket), row(helm), row(bow, 'none'), row(rifle), row(chest)]),
    )
    expect(facets?.classType).toBe('titan')
    expect(facets?.element).toBe('void')
    expect(facets?.subclass).toBe('Sentinel')
    expect(facets?.exoticArmor).toBe('Loreley Splendor')
    expect(facets?.exoticWeapon).toBe('Le Monarque')
    expect(facets?.weaponTypes).toEqual(['Combat Bow', 'Auto Rifle', 'Rocket Launcher'])
  })

  test('has nothing to say about a plan with no subclass', () => {
    expect(buildFacets(plan([row(helm)], { loadout: undefined }))).toBeUndefined()
  })
})

const gearSlot = (items: GameLoadout['items']): GameLoadout => ({
  index: 2,
  nameHash: 0,
  colorHash: 0,
  iconHash: 0,
  items,
})

describe('buildReadiness', () => {
  const built = plan([row(helm), row(chest, 'none')], {
    artifact: new ArtifactPlan({
      artifactHash: 1,
      name: 'Old',
      picks: [],
      pointsAvailable: 12,
      reset: false,
    }),
  })

  test('names the pieces no longer owned and spots a past artifact', () => {
    const readiness = buildReadiness(
      { plan: built, revision: 1, link: null },
      inventory([chest]),
      undefined,
      2,
    )
    expect(readiness.missing).toEqual(['Loreley Splendor'])
    expect(readiness.pastArtifact).toBe(true)
    expect(readiness.inGame).toBeNull()
  })

  test('does not call the artifact past when Bungie did not say which is current', () => {
    expect(
      buildReadiness(
        { plan: built, revision: 1, link: null },
        inventory([helm, chest]),
        undefined,
        null,
      ).pastArtifact,
    ).toBe(false)
  })
})

describe('linkState', () => {
  const built = plan([row(helm), row(chest, 'none')])
  const slot = gearSlot([
    { itemInstanceId: 'helm', plugItemHashes: [1] },
    { itemInstanceId: 'chest', plugItemHashes: [2] },
    { itemInstanceId: 'sub', plugItemHashes: [3, 4] },
  ])
  const remodded = gearSlot([
    { itemInstanceId: 'helm', plugItemHashes: [1] },
    { itemInstanceId: 'chest', plugItemHashes: [9] },
    { itemInstanceId: 'sub', plugItemHashes: [3, 4] },
  ])
  const link = (snapshot: BuildLink['snapshot']): BuildLink => ({
    characterId: 'titan-1',
    index: 2,
    savedAt: 'then',
    revision: 1,
    snapshot,
  })
  const agreed = link(snapshotOf(slot))

  test('reads the slot against the build on both sides since they last agreed', () => {
    const sides: ReadonlyArray<readonly [number, GameLoadout]> = [
      [1, slot],
      [1, remodded],
      [2, slot],
      [2, remodded],
    ]
    expect(
      sides.map(([revision, now]) => linkState({ plan: built, revision }, agreed, now)),
    ).toEqual(['synced', 'game_changed', 'build_changed', 'diverged'])
  })

  test('calls a slot that is gone or emptied cleared, whatever changed in the build', () => {
    expect(linkState({ plan: built, revision: 2 }, agreed, undefined)).toBe('cleared')
    expect(linkState({ plan: built, revision: 1 }, agreed, gearSlot([]))).toBe('cleared')
  })

  test('a link waiting for its baseline only asks that the slot still holds every kept piece', () => {
    const pending = link(null)
    const lost = gearSlot([{ itemInstanceId: 'helm', plugItemHashes: [1] }])
    expect(linkState({ plan: built, revision: 1 }, pending, remodded)).toBe('synced')
    expect(linkState({ plan: built, revision: 1 }, pending, lost)).toBe('game_changed')
    expect(baselineFor({ plan: built, revision: 1 }, pending, remodded)).toEqual(
      snapshotOf(remodded),
    )
    expect(baselineFor({ plan: built, revision: 1 }, pending, lost)).toBeUndefined()
    expect(baselineFor({ plan: built, revision: 1 }, agreed, remodded)).toBeUndefined()
  })
})

describe('substitute', () => {
  const recipe: BuildRecipe = {
    kind: 'build',
    title: 'BUILD PLAN',
    confirmLabel: 'APPLY BUILD',
    rows: [
      { itemInstanceId: 'helm', action: 'equip' },
      { itemInstanceId: 'chest', action: 'equip' },
    ],
    mods: [{ itemInstanceId: 'helm', mod: 'Hands-On' }],
    featured: { itemInstanceId: 'helm', perks: [], stats: [] },
    characterId: 'titan-1',
  }
  const saved = plan([row(helm), row(chest)])

  test('swaps a lost piece for the best owned copy of the same item, mods and all', () => {
    const weak = owned('helm-2', 'helmet', { itemHash: helm.itemHash, statTotal: 55 })
    const strong = owned('helm-3', 'helmet', { itemHash: helm.itemHash, statTotal: 68 })
    const result = substitute(recipe, saved, inventory([weak, strong, chest]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(['helm-3', 'chest'])
    expect(result.recipe.mods?.[0]?.itemInstanceId).toBe('helm-3')
    expect(result.recipe.featured?.itemInstanceId).toBe('helm-3')
    expect(result.substituted).toEqual(['Loreley Splendor'])
    expect(result.lost).toEqual([])
  })

  test('drops a piece with no copy left and hands back its row unticked', () => {
    const result = substitute(recipe, saved, inventory([chest]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(['chest'])
    expect(result.recipe.mods).toEqual([])
    expect(result.recipe.featured).toBeUndefined()
    expect(result.lost.map((r) => [r.name, r.selected, r.error])).toEqual([
      ['Loreley Splendor', false, 'no longer owned'],
    ])
  })

  test('does not hand two rows the same copy', () => {
    const one = owned('chest-1', 'chest', { itemHash: chest.itemHash })
    const twice: BuildRecipe = {
      ...recipe,
      rows: [
        { itemInstanceId: 'chest', action: 'equip' },
        { itemInstanceId: 'chest-gone', action: 'to_vault' },
      ],
    }
    const twiceSaved = plan([
      row(chest),
      row({ ...chest, itemInstanceId: 'chest-gone' }, 'to_vault'),
    ])
    const result = substitute(twice, twiceSaved, inventory([one]))
    expect(result.recipe.rows.map((r) => r.itemInstanceId)).toEqual(['chest-1'])
    expect(result.lost).toHaveLength(1)
  })
})

describe('normalizePlan', () => {
  test('forgets the first run: status, outcomes, errors and the slot it saved to', () => {
    const applied = plan([row(helm, 'equip', { outcome: 'failed', error: 'nope' })], {
      saveTo: new LoadoutSaveTo({
        buildId: 'b',
        characterId: 'titan-1',
        index: 0,
        nameHash: 0,
        colorHash: 0,
        iconHash: 0,
        replaces: null,
        outcome: 'ok',
        error: null,
      }),
    })
    const stored = normalizePlan(applied)
    expect(stored.status).toBe('proposed')
    expect(stored.saveTo).toBeUndefined()
    expect(stored.rows[0]?.outcome).toBeNull()
    expect(stored.rows[0]?.error).toBeNull()
  })
})

const dataDir = mkdtempSync(join(tmpdir(), 'ghost-builds-service-'))
afterAll(() => rmSync(dataDir, { recursive: true, force: true }))

const ConfigTest = Layer.succeed(AppConfig, {
  host: '127.0.0.1',
  port: 0,
  dataDir,
  model: 'test',
  effort: 'low',
  claudePath: '',
  youtubeChannels: '',
  bungie: { apiKey: Redacted.make(''), clientId: '', clientSecret: Redacted.make('') },
  jev: { apiKey: Redacted.make(''), model: 'test' },
})

const down = Effect.fail(new BungieError({ status: 'Down', message: 'Bungie is down' }))

const serviceWith = (
  inventoryNow: Effect.Effect<Inventory, BungieError>,
  manifest: Partial<ManifestService> = {},
  game: Effect.Effect<GameLoadouts, BungieError> = down,
) =>
  BuildsLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(JobsRepoLive, BuildsRepoLive).pipe(
        Layer.provideMerge(DatabaseLive),
        Layer.provide(ConfigTest),
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProfileStore, {
          inventory: inventoryNow,
          plugSets: Effect.succeed({}),
          invalidate: Effect.void,
        }),
        Layer.succeed(Loadouts, { current: game, invalidate: Effect.void, catalog: down }),
        Layer.succeed(Manifest, {
          statFacts: Effect.succeed({}),
          plugFacts: () => Effect.succeed(new Map()),
          subclassPlugSets: () => Effect.succeed([]),
          weaponPerkPools: () => Effect.succeed([]),
          weaponPerkSockets: () => Effect.succeed([]),
          plugInvestments: () => Effect.succeed(new Map()),
          armorMods: Effect.succeed([]),
          armorSets: Effect.succeed([]),
          tuningMods: Effect.succeed(new Map()),
          elementIcons: Effect.succeed({}),
          capacities: Effect.succeed({ vault: 700, postmaster: 21 }),
          ensure: Effect.void,
          lookup: () => Effect.succeed(new Map()),
          findByName: () => Effect.succeed([]),
          ...manifest,
        }),
        Layer.succeed(ChargeEffects, {
          forMods: () => Effect.succeed(new Map()),
          record: () => Effect.void,
        }),
        Layer.succeed(Artifacts, { forCharacter: () => Effect.succeed(null) }),
        Layer.succeed(Wishlist, {
          ensure: Effect.void,
          rollsFor: () => Effect.succeed(new Map()),
          recommended: Effect.succeed([]),
          asOf: Effect.succeed(null),
          source: Effect.die('unused'),
        }),
      ),
    ),
  )

const ServiceTest = serviceWith(down)

const recipe: BuildRecipe = {
  kind: 'build',
  title: 'BUILD PLAN',
  confirmLabel: 'APPLY BUILD',
  rows: [{ itemInstanceId: 'helm', action: 'equip' }],
  characterId: 'titan-1',
}

const buildJob = (withRecipe: boolean) =>
  Effect.gen(function* () {
    const jobs = yield* JobsRepo
    const job = yield* jobs.create({ kind: 'build_suggestion', prompt: 'a build' })
    yield* jobs.setPlan(job.id, plan([row(helm, 'equip', { outcome: 'failed', error: 'x' })]))
    if (withRecipe) yield* jobs.setRecipe(job.id, recipe)
    return job.id
  })

describe('Builds.save', () => {
  test('saves once per job: a second save renames the same build, and Bungie being down only blanks readiness', async () => {
    const [first, second, all] = await Effect.gen(function* () {
      const builds = yield* Builds
      const jobId = yield* buildJob(true)
      const first = yield* builds.save({ jobId, name: 'Melee' })
      const second = yield* builds.save({ jobId, name: 'Melee v2' })
      return [first, second, yield* builds.list] as const
    }).pipe(Effect.provide(ServiceTest), Effect.runPromise)
    expect(second.build.id).toBe(first.build.id)
    expect(second.build.name).toBe('Melee v2')
    expect(first.confirm).toBeNull()
    expect(first.build.plan.status).toBe('proposed')
    expect(first.build.plan.rows[0]?.error).toBeNull()
    expect(first.build.readiness).toBeNull()
    expect(first.build.facets.subclass).toBe('Sentinel')
    expect(all.filter((b) => b.id === first.build.id)).toHaveLength(1)
  })

  test('refuses a build whose recipe was never kept', async () => {
    const result = await Effect.gen(function* () {
      const builds = yield* Builds
      const jobId = yield* buildJob(false)
      return yield* builds.save({ jobId, name: 'Old' }).pipe(Effect.result)
    }).pipe(Effect.provide(ServiceTest), Effect.runPromise)
    expect(result._tag === 'Failure' && result.failure._tag).toBe('PlanNotApplicable')
  })
})

describe('Builds.equip', () => {
  test('keeps a substituted piece in the plan, equipped from the copy that replaced it', async () => {
    const copy = owned('helm-2', 'helmet', { itemHash: helm.itemHash, name: helm.name })
    const result = await Effect.gen(function* () {
      const stored = yield* (yield* BuildsRepo).insert({
        jobId: crypto.randomUUID(),
        name: 'Melee',
        recipe: {
          ...recipe,
          rows: [
            { itemInstanceId: 'helm', action: 'equip' },
            { itemInstanceId: 'chest', action: 'equip' },
          ],
        },
        plan: plan([row(helm), row(chest)]),
      })
      return yield* (yield* Builds).equip(stored.id, { characterId: 'titan-1' })
    }).pipe(
      Effect.provide(serviceWith(Effect.succeed(inventory([copy, chest])))),
      Effect.runPromise,
    )
    expect(result.substituted).toEqual(['Loreley Splendor'])
    expect(result.job.plan?.rows.map((r) => [r.itemInstanceId, r.action])).toEqual([
      ['helm-2', 'equip'],
      ['chest', 'equip'],
    ])
  })
})

const GENERAL = 'enhancements.v2_general'
const facts = (hash: number, name: string, fields: Partial<ArmorModEntry> = {}): ArmorModEntry => ({
  hash,
  name,
  icon: null,
  mods: {},
  classMods: {},
  fragmentSlots: 0,
  energyCost: 3,
  category: GENERAL,
  artifact: false,
  charged: false,
  keywords: [],
  description: '',
  ...fields,
})
const grenadeMod = facts(1, 'Grenade Mod')
const weaponsMod = facts(2, 'Weapons Mod')
const definition = (hash: number, name: string, typeName: string): ManifestItem => ({
  hash,
  name,
  typeName,
  icon: null,
  tier: 'common',
  slot: 'other',
  damageType: 'none',
  bucketHash: 0,
  classType: 3,
  description: '',
})
const manifestOf = (
  definitions: ReadonlyArray<ManifestItem>,
  known: ReadonlyArray<ArmorModEntry>,
): Partial<ManifestService> => ({
  armorMods: Effect.succeed(known.filter((entry) => entry.category === GENERAL)),
  plugFacts: (hashes) =>
    Effect.succeed(
      new Map(
        known.filter((entry) => hashes.includes(entry.hash)).map((entry) => [entry.hash, entry]),
      ),
    ),
  lookup: (hashes) => {
    const wanted = new Set(hashes)
    return Effect.succeed(
      new Map(definitions.filter((def) => wanted.has(def.hash)).map((def) => [def.hash, def])),
    )
  },
})
const modDefinitions = [
  definition(1, 'Grenade Mod', 'General Armor Mod'),
  definition(2, 'Weapons Mod', 'General Armor Mod'),
]
const modManifest = manifestOf(modDefinitions, [grenadeMod, weaponsMod])
const stats = {
  mobility: 10,
  resilience: 10,
  recovery: 10,
  discipline: 10,
  intellect: 10,
  strength: 10,
}
const modded = (
  id: string,
  slot: ItemSlot,
  holds: ArmorModEntry,
  fields: Partial<OwnedItem> = {},
) =>
  owned(id, slot, {
    armorStats: stats,
    energy: { used: 3, capacity: 10 },
    modSockets: [{ index: 0, plugHash: holds.hash, empty: false }],
    ...fields,
  })
const wearing = (mod: ArmorModEntry) => [
  new ArmorMod({ name: mod.name, description: '', cost: 3, mods: [] }),
]

describe('Builds.equip on a build whose first run already changed the gear', () => {
  const gauntlets = (holds: ArmorModEntry, fields: Partial<OwnedItem> = {}) =>
    modded('arms', 'arms', holds, { name: 'Stronghold', ...fields })
  const saved = (arms: OwnedItem) =>
    Effect.gen(function* () {
      const stored = yield* (yield* BuildsRepo).insert({
        jobId: crypto.randomUUID(),
        name: 'Grenades',
        recipe: {
          ...recipe,
          rows: [
            { itemInstanceId: 'helm', action: 'none' },
            { itemInstanceId: 'arms', action: 'none' },
          ],
          mods: [{ itemInstanceId: 'arms', mod: 'Grenade Mod', replaces: 'Weapons Mod' }],
        },
        plan: plan([
          row(helm, 'none'),
          row(arms, 'none', {
            armorMods: wearing(grenadeMod),
          }),
        ]),
      })
      return yield* (yield* Builds).equip(stored.id, { characterId: 'titan-1' })
    })
  const arms = gauntlets(grenadeMod)

  test('equips again without asking for a mod the piece already holds', async () => {
    const worn = { location: 'character' as const, characterId: 'titan-1', equipped: true }
    const result = await saved(gauntlets(grenadeMod, worn)).pipe(
      Effect.provide(
        serviceWith(
          Effect.succeed(inventory([{ ...helm, ...worn }, gauntlets(grenadeMod, worn)])),
          modManifest,
        ),
      ),
      Effect.runPromise,
    )
    const armsRow = result.job.plan?.rows.find((r) => r.itemInstanceId === 'arms')
    expect(armsRow?.armorMods?.map((m) => [m.name, m.swap ?? false])).toEqual([
      ['Grenade Mod', false],
    ])
  })

  test('puts the mod back and equips the pieces that came off since', async () => {
    const result = await saved(arms).pipe(
      Effect.provide(
        serviceWith(Effect.succeed(inventory([helm, gauntlets(weaponsMod)])), modManifest),
      ),
      Effect.runPromise,
    )
    const rows = result.job.plan?.rows ?? []
    expect(rows.map((r) => [r.itemInstanceId, r.action, r.selected])).toEqual([
      ['helm', 'equip', true],
      ['arms', 'equip', true],
    ])
    expect(rows[1]?.armorMods?.map((m) => [m.name, m.replaces])).toEqual([
      ['Grenade Mod', 'Weapons Mod'],
    ])
  })
})

const storedBuild = (fields: { readonly recipe: BuildRecipe; readonly plan: Plan }) =>
  Effect.flatMap(BuildsRepo, (repo) =>
    repo.insert({ jobId: crypto.randomUUID(), name: 'Grenades', ...fields }),
  )

describe('Builds.edit', () => {
  const arms = modded('arms', 'arms', grenadeMod, { name: 'Stronghold' })
  const spare = modded('arms-2', 'arms', weaponsMod, { name: 'Synthoceps', power: 560 })
  const grenades = {
    recipe: {
      ...recipe,
      rows: [
        { itemInstanceId: 'helm', action: 'none' as const },
        { itemInstanceId: 'arms', action: 'none' as const },
      ],
      purpose: 'Grenade spam',
      note: 'Stronghold keeps you alive',
      synergy: { exotic: 'Stronghold blocks' },
      featured: { itemInstanceId: 'arms', perks: [], stats: [] },
    },
    plan: plan([row(helm, 'none'), row(arms, 'none', { armorMods: wearing(grenadeMod) })], {
      purpose: 'Grenade spam',
    }),
  }
  const withGear = (items: ReadonlyArray<OwnedItem>) =>
    serviceWith(Effect.succeed(inventory(items)), modManifest)

  test('swaps a piece in: the new one takes the old one’s mods, and equipping puts them on', async () => {
    const [edited, equipped] = await Effect.gen(function* () {
      const stored = yield* storedBuild(grenades)
      const builds = yield* Builds
      const edited = yield* builds.edit(stored.id, {
        name: 'Grenades v2',
        purpose: 'Grenade spam',
        items: ['helm', 'arms-2'],
      })
      return [edited, yield* builds.equip(stored.id, { characterId: 'titan-1' })] as const
    }).pipe(Effect.provide(withGear([helm, arms, spare])), Effect.runPromise)
    expect(edited.name).toBe('Grenades v2')
    expect(edited.plan.rows.map((r) => [r.itemInstanceId, r.action])).toEqual([
      ['helm', 'none'],
      ['arms-2', 'equip'],
    ])
    expect(edited.plan.rows[1]?.armorMods?.map((m) => m.name)).toEqual(['Grenade Mod'])
    expect([
      edited.plan.purpose,
      edited.plan.note,
      edited.plan.synergy,
      edited.plan.featured,
    ]).toEqual(['Grenade spam', null, undefined, null])
    expect(
      equipped.job.plan?.rows
        .find((r) => r.itemInstanceId === 'arms-2')
        ?.armorMods?.map((m) => [m.name, m.replaces]),
    ).toEqual([['Grenade Mod', 'Weapons Mod']])
  })

  test('removes a piece and keeps what the rest of the build says', async () => {
    const edited = await Effect.gen(function* () {
      const stored = yield* storedBuild(grenades)
      return yield* (yield* Builds).edit(stored.id, {
        name: 'Grenades',
        purpose: 'Grenade spam',
        items: ['arms'],
      })
    }).pipe(Effect.provide(withGear([helm, arms])), Effect.runPromise)
    expect(edited.plan.rows.map((r) => r.itemInstanceId)).toEqual(['arms'])
    expect(edited.plan.note).toBeNull()
    expect(edited.plan.featured?.itemInstanceId).toBe('arms')
  })

  test('renames without a new revision, and changes the purpose with one, Bungie down or not', async () => {
    const [renamed, repurposed] = await Effect.gen(function* () {
      const stored = yield* storedBuild(grenades)
      const builds = yield* Builds
      const repo = yield* BuildsRepo
      const items = ['arms', 'helm']
      yield* builds.edit(stored.id, { name: 'Nades', purpose: 'Grenade spam', items })
      const renamed = yield* repo.get(stored.id)
      yield* builds.edit(stored.id, { name: 'Nades', purpose: null, items })
      return [renamed, yield* repo.get(stored.id)] as const
    }).pipe(Effect.provide(ServiceTest), Effect.runPromise)
    expect([renamed.name, renamed.revision, renamed.plan.purpose]).toEqual([
      'Nades',
      1,
      'Grenade spam',
    ])
    expect([repurposed.revision, repurposed.plan.purpose, repurposed.recipe.purpose]).toEqual([
      2,
      undefined,
      undefined,
    ])
    expect(repurposed.plan.note).toBeNull()
  })

  test.each([
    [['helm', 'gone'], 'one of the picked items is no longer in your inventory'],
    [['helm', 'cloak'], 'Mask of Bakris is Hunter armor; this build is for a Titan'],
    [['helm', 'arms', 'arms-2'], 'Stronghold and Synthoceps both go in the arms slot'],
    [['helm', 'shell'], 'Item shell is not a weapon or armor piece'],
  ])('refuses %p: %s', async (items, reason) => {
    const cloak = owned('cloak', 'arms', { name: 'Mask of Bakris', classType: 'hunter' })
    const shell = owned('shell', 'other')
    const result = await Effect.gen(function* () {
      const stored = yield* storedBuild(grenades)
      return yield* (yield* Builds).edit(stored.id, { name: 'X', purpose: null, items })
    }).pipe(
      Effect.result,
      Effect.provide(withGear([helm, arms, spare, cloak, shell])),
      Effect.runPromise,
    )
    expect(result._tag === 'Failure' && result.failure).toEqual(new PlanNotApplicable({ reason }))
  })
})

describe('Builds.options', () => {
  test('lists the owned pieces for one slot the build’s class can wear, strongest first', async () => {
    const weak = owned('helm-weak', 'helmet', { power: 500 })
    const strong = owned('helm-strong', 'helmet', {
      power: 560,
      location: 'character',
      characterId: 'titan-1',
    })
    const hunter = owned('helm-hunter', 'helmet', { power: 570, classType: 'hunter' })
    const options = await Effect.gen(function* () {
      const stored = yield* storedBuild({ recipe, plan: plan([row(helm)]) })
      return yield* (yield* Builds).options(stored.id, 'helmet')
    }).pipe(
      Effect.provide(serviceWith(Effect.succeed(inventory([weak, chest, helm, strong, hunter])))),
      Effect.runPromise,
    )
    expect(options.map((item) => [item.itemInstanceId, item.power])).toEqual([
      ['helm-strong', 560],
      ['helm', 550],
      ['helm-weak', 500],
    ])
  })
})

describe('Builds.link', () => {
  const NO_PLUG = 2166136261
  const subclassPlugs = [
    definition(900, 'Ward of Dawn', 'Void Super'),
    definition(901, 'Bastion', 'Void Aspect'),
    definition(902, 'Echo of Expulsion', 'Void Fragment'),
  ]
  const sentinel = {
    itemInstanceId: 'sentinel',
    itemHash: 50,
    name: 'Sentinel',
    icon: null,
    element: 'void' as const,
    equipped: true,
    sockets: [900, 901, 902].map((plugHash) => ({ plugHash, enabled: true })),
  }
  const withSubclass: CharacterInfo = { ...titan, subclasses: [sentinel] }
  const hunter: CharacterInfo = { ...titan, characterId: 'hunter-1', classType: 'hunter' }
  const linkManifest = manifestOf(
    [...modDefinitions, ...subclassPlugs],
    [grenadeMod, weaponsMod, facts(901, 'Bastion', { category: 'aspect', fragmentSlots: 2 })],
  )
  const bow = owned('bow', 'kinetic', { typeName: 'Combat Bow', classType: null })
  const visor = modded('visor', 'helmet', weaponsMod, { name: 'Helm of Saint-14' })
  const slotWith = (helmPlug: number): GameLoadout => ({
    index: 1,
    nameHash: 0,
    colorHash: 0,
    iconHash: 0,
    items: [
      { itemInstanceId: 'bow', plugItemHashes: [NO_PLUG] },
      { itemInstanceId: 'visor', plugItemHashes: [helmPlug, NO_PLUG] },
      { itemInstanceId: 'sentinel', plugItemHashes: [900, 901, 902] },
    ],
  })
  const harness = () => {
    let slot = slotWith(grenadeMod.hash)
    const game = Effect.sync((): GameLoadouts => ({
      byCharacter: new Map([['titan-1', [gearSlot([]), slot]]]),
      artifactHash: null,
    }))
    return {
      layer: serviceWith(
        Effect.succeed({ ...inventory([helm, bow, visor]), characters: [withSubclass, hunter] }),
        linkManifest,
        game,
      ),
      change: (next: GameLoadout) => {
        slot = next
      },
    }
  }
  const linked = { characterId: 'titan-1', index: 1 }
  const helmBuild = { recipe, plan: plan([row(helm)]) }

  test('takes the slot’s gear, armor mods and subclass into the build and reads it synced', async () => {
    const build = await Effect.gen(function* () {
      const stored = yield* storedBuild(helmBuild)
      return yield* (yield* Builds).link(stored.id, linked)
    }).pipe(Effect.provide(harness().layer), Effect.runPromise)
    expect(build.plan.rows.map((r) => [r.itemInstanceId, r.action])).toEqual([
      ['bow', 'equip'],
      ['visor', 'equip'],
    ])
    expect(build.plan.rows[1]?.armorMods?.map((m) => m.name)).toEqual(['Grenade Mod'])
    expect(build.plan.loadout?.super?.name).toBe('Ward of Dawn')
    expect(build.plan.loadout?.aspects.map((p) => p.name)).toEqual(['Bastion'])
    expect(build.plan.loadout?.fragments.map((p) => p.name)).toEqual(['Echo of Expulsion'])
    expect([build.inGame?.index, build.readiness?.inGame]).toEqual([1, 'synced'])
  })

  test('linking the same slot again changes nothing; after a change in game it pulls the slot anew', async () => {
    const h = harness()
    const [first, again, pulled] = await Effect.gen(function* () {
      const stored = yield* storedBuild(helmBuild)
      const builds = yield* Builds
      const repo = yield* BuildsRepo
      yield* builds.link(stored.id, linked)
      const first = yield* repo.get(stored.id)
      yield* builds.link(stored.id, linked)
      const again = yield* repo.get(stored.id)
      h.change(slotWith(weaponsMod.hash))
      const changed = yield* builds.list
      expect(changed.find((b) => b.id === stored.id)?.readiness?.inGame).toBe('game_changed')
      yield* builds.link(stored.id, linked)
      return [first, again, yield* repo.get(stored.id)] as const
    }).pipe(Effect.provide(h.layer), Effect.runPromise)
    expect([first.revision, again.revision, pulled.revision]).toEqual([2, 2, 3])
    expect(again.plan).toEqual(first.plan)
    expect(pulled.plan.rows[1]?.armorMods?.map((m) => m.name)).toEqual(['Weapons Mod'])
    expect(pulled.link?.revision).toBe(3)
  })

  test('just links a slot that already holds the build’s gear', async () => {
    const build = await Effect.gen(function* () {
      const stored = yield* storedBuild({
        recipe: {
          ...recipe,
          rows: [
            { itemInstanceId: 'bow', action: 'none' },
            { itemInstanceId: 'visor', action: 'none' },
          ],
        },
        plan: plan([row(bow, 'none'), row(visor, 'none')]),
      })
      yield* (yield* Builds).link(stored.id, linked)
      return yield* (yield* BuildsRepo).get(stored.id)
    }).pipe(Effect.provide(harness().layer), Effect.runPromise)
    expect([build.revision, build.link?.revision, build.link?.snapshot?.length]).toEqual([1, 1, 3])
  })

  test('refuses an empty slot and a character of another class', async () => {
    const [empty, wrongClass] = await Effect.gen(function* () {
      const stored = yield* storedBuild(helmBuild)
      const builds = yield* Builds
      return [
        yield* builds.link(stored.id, { characterId: 'titan-1', index: 0 }).pipe(Effect.flip),
        yield* builds.link(stored.id, { characterId: 'hunter-1', index: 1 }).pipe(Effect.flip),
      ] as const
    }).pipe(Effect.provide(harness().layer), Effect.runPromise)
    expect(empty).toEqual(
      new LoadoutSlotInvalid({ reason: 'slot 1 is empty; save the build into it instead' }),
    )
    expect(wrongClass).toEqual(new PlanNotApplicable({ reason: 'this build is for a Titan' }))
  })

  test('a build saved into the slot in game takes the slot as its baseline the first time it is read', async () => {
    const [read, stored] = await Effect.gen(function* () {
      const saved = yield* storedBuild({
        recipe,
        plan: plan([row(bow, 'none'), row(visor, 'none')]),
      })
      const repo = yield* BuildsRepo
      yield* repo.claimInGameSlot(saved.id, linked, null)
      const read = (yield* (yield* Builds).list).find((b) => b.id === saved.id)
      return [read, yield* repo.get(saved.id)] as const
    }).pipe(Effect.provide(harness().layer), Effect.runPromise)
    expect(read?.readiness?.inGame).toBe('synced')
    expect(stored.link?.snapshot?.map((item) => item.itemInstanceId)).toEqual([
      'bow',
      'sentinel',
      'visor',
    ])
  })

  test('unlinking forgets the slot', async () => {
    const build = await Effect.gen(function* () {
      const stored = yield* storedBuild(helmBuild)
      const builds = yield* Builds
      yield* builds.link(stored.id, linked)
      return yield* builds.unlink(stored.id)
    }).pipe(Effect.provide(harness().layer), Effect.runPromise)
    expect([build.inGame, build.readiness?.inGame]).toEqual([null, null])
  })
})
