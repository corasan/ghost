import type { PlanStat } from "@ghost/contract"

/** Asked-for stats first, then the rest from highest to lowest. */
export const orderBuildStats = (stats: readonly PlanStat[]): PlanStat[] =>
  [...stats].sort((a, b) => Number(b.target) - Number(a.target) || b.value - a.value)
