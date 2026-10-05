import type { PlanStat } from "@ghost/contract"

export const change = (stat: PlanStat) => stat.value - (stat.before ?? stat.value)

/** Asked-for stats first, then what the build raises, then what it lowers, then the rest. */
export const orderBuildStats = (stats: readonly PlanStat[]): PlanStat[] => {
  const rank = (stat: PlanStat) =>
    stat.target ? 0 : change(stat) > 0 ? 1 : change(stat) < 0 ? 2 : 3
  return [...stats].sort((a, b) => rank(a) - rank(b) || change(b) - change(a))
}
