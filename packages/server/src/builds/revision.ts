import type { StoredBuild } from '../db/builds.ts'

/**
 * What the agent reads when a request revises a saved build: the build as
 * saved, in present_plan's own terms, with each piece's mods as the build
 * ends with them rather than the changes that first put them in.
 */
export const revisionBrief = (build: StoredBuild): string => {
  const { recipe, plan } = build
  const saved = {
    name: build.name,
    purpose: recipe.purpose,
    stats: recipe.stats?.filter((stat) => stat.target),
    shortfall: recipe.shortfall,
    subclass: recipe.subclass,
    gear: plan.rows
      .filter((row) => row.action === 'equip' || row.action === 'none')
      .map((row) => ({
        slot: row.slot,
        name: row.name,
        itemInstanceId: row.itemInstanceId,
        mods: row.armorMods?.map((mod) => mod.name),
      })),
    artifact: recipe.artifact,
    synergy: recipe.synergy,
    situational: recipe.situational,
  }
  return [
    `The player is revising their saved build "${build.name}". Change what they ask for and keep the rest as saved, unless a change forces another (a new exotic that breaks the loop, a stat goal the gear can no longer reach). When they ask to re-optimize, rebuild it toward its purpose and stat goals with what they own now.`,
    'Read the account as for any build: get_armor_mods shows what each piece holds now, so list in mods only what must change from that to reach the mods below. Then call present_plan kind build with the whole build as it should end: every armor piece and all three weapons, the subclass, artifact, purpose, stat goals, synergy and situational. The app offers to update the saved build from the card, so do not ask the player to save it.',
    `The saved build: ${JSON.stringify(saved)}`,
  ].join('\n')
}
