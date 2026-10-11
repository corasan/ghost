import { expect, test } from 'bun:test'
import { ArmorMod, Plan, PlanRow } from '@ghost/contract'
import type { StoredBuild } from '../db/builds.ts'
import { revisionBrief } from './revision.ts'

const row = (id: string, fields: Partial<PlanRow>) =>
  new PlanRow({
    itemInstanceId: id,
    itemHash: 1,
    name: id,
    icon: null,
    tier: 'legendary',
    meta: '',
    power: 10,
    score: null,
    action: 'equip',
    characterId: 'titan-1',
    selected: true,
    outcome: null,
    error: null,
    ...fields,
  })

const mod = (name: string) => new ArmorMod({ name, description: '', cost: 1, mods: [] })

const build: StoredBuild = {
  id: 'b1',
  jobId: 'j1',
  name: 'Melee',
  revision: 2,
  link: null,
  createdAt: 'then',
  updatedAt: 'then',
  recipe: {
    kind: 'build',
    title: 'BUILD PLAN',
    confirmLabel: 'APPLY BUILD',
    characterId: 'titan-1',
    purpose: 'Void Titan melee',
    stats: [
      { label: 'Melee', value: 100, target: true },
      { label: 'Health', value: 60, target: false },
    ],
    rows: [{ itemInstanceId: 'helm', action: 'equip' }],
    mods: [{ itemInstanceId: 'helm', mod: 'Heavy Handed', replaces: 'Ashes to Assets' }],
    subclass: { name: 'Sentinel', aspects: ['Knockout'] },
  },
  plan: new Plan({
    kind: 'build',
    title: 'BUILD PLAN',
    subtitle: null,
    stats: [],
    featured: null,
    note: null,
    confirmLabel: 'APPLY BUILD',
    status: 'proposed',
    rows: [
      row('helm', { slot: 'helmet', armorMods: [mod('Heavy Handed'), mod('Melee Mod')] }),
      row('rifle', { slot: 'energy', action: 'none' }),
      row('old-arms', { slot: 'arms', action: 'to_vault' }),
    ],
  }),
}

const savedOf = (brief: string) =>
  JSON.parse(brief.slice(brief.indexOf('The saved build: ') + 'The saved build: '.length))

test('hands the agent the gear the build keeps, each piece with the mods it ends with', () => {
  const saved = savedOf(revisionBrief(build))
  expect(saved.gear).toEqual([
    { slot: 'helmet', name: 'helm', itemInstanceId: 'helm', mods: ['Heavy Handed', 'Melee Mod'] },
    { slot: 'energy', name: 'rifle', itemInstanceId: 'rifle' },
  ])
  expect(saved.stats).toEqual([{ label: 'Melee', value: 100, target: true }])
  expect(saved.subclass).toEqual({ name: 'Sentinel', aspects: ['Knockout'] })
  expect(saved).not.toHaveProperty('mods')
})
