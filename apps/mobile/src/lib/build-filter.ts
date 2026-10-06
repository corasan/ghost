import type { DamageType, GuardianClass, SavedBuild } from "@ghost/contract"

import type { ActiveFilter } from "./vault-filter"

export type BuildWhere = "all" | "in_game" | "ghost_only"
export type BuildState = "all" | "ready" | "missing_items" | "past_artifact"
export type BuildSort = "newest" | "name" | "class"

export interface BuildFilter {
  readonly query: string
  readonly classes: ReadonlySet<GuardianClass>
  readonly elements: ReadonlySet<DamageType>
  /** Exotic armor and exotic weapons alike, by name. */
  readonly exotics: ReadonlySet<string>
  readonly weaponTypes: ReadonlySet<string>
  readonly where: BuildWhere
  readonly state: BuildState
  readonly sort: BuildSort
}

export const emptyBuildFilter: BuildFilter = {
  query: "",
  classes: new Set(),
  elements: new Set(),
  exotics: new Set(),
  weaponTypes: new Set(),
  where: "all",
  state: "all",
  sort: "newest",
}

const exoticsOf = (build: SavedBuild) =>
  [build.facets.exoticArmor, build.facets.exoticWeapon].filter((name) => name !== null)

const haystacks = new WeakMap<SavedBuild, string>()
const haystack = (build: SavedBuild) => {
  let text = haystacks.get(build)
  if (text === undefined) {
    const { facets, plan } = build
    text = [
      build.name,
      plan.purpose,
      plan.subtitle,
      facets.classType,
      facets.element,
      facets.subclass,
      ...exoticsOf(build),
      ...facets.weaponTypes,
    ]
      .filter((part) => part)
      .join(" ")
      .toLowerCase()
    haystacks.set(build, text)
  }
  return text
}

const matchesWhere = (build: SavedBuild, where: BuildWhere) =>
  where === "all" || (where === "in_game") === (build.inGame !== null)

/** A build whose readiness is unknown, because Bungie was unreachable, only shows under "all". */
const matchesState = (build: SavedBuild, state: BuildState) => {
  const readiness = build.readiness
  switch (state) {
    case "all":
      return true
    case "ready":
      return readiness !== null && readiness.missing.length === 0 && !readiness.pastArtifact
    case "missing_items":
      return readiness !== null && readiness.missing.length > 0
    case "past_artifact":
      return readiness?.pastArtifact === true
  }
}

const anyOf = <T>(chosen: ReadonlySet<T>, values: readonly T[]) =>
  chosen.size === 0 || values.some((value) => chosen.has(value))

const comparators: Record<BuildSort, (a: SavedBuild, b: SavedBuild) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  class: (a, b) =>
    a.facets.classType.localeCompare(b.facets.classType) || a.name.localeCompare(b.name),
}

export function filterBuilds(builds: readonly SavedBuild[], filter: BuildFilter): SavedBuild[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  return builds
    .filter(
      (build) =>
        anyOf(filter.classes, [build.facets.classType]) &&
        anyOf(filter.elements, [build.facets.element]) &&
        anyOf(filter.exotics, exoticsOf(build)) &&
        anyOf(filter.weaponTypes, build.facets.weaponTypes) &&
        matchesWhere(build, filter.where) &&
        matchesState(build, filter.state) &&
        words.every((word) => haystack(build).includes(word)),
    )
    .sort(comparators[filter.sort])
}

export const BUILD_SORT_LABEL: Record<BuildSort, string> = {
  newest: "NEWEST",
  name: "A–Z",
  class: "CLASS",
}

export const WHERE_LABEL: Record<BuildWhere, string> = {
  all: "ANYWHERE",
  in_game: "IN GAME",
  ghost_only: "GHOST ONLY",
}

export const STATE_LABEL: Record<BuildState, string> = {
  all: "ANY",
  ready: "READY",
  missing_items: "MISSING ITEMS",
  past_artifact: "PAST ARTIFACT",
}

type Facet = "classes" | "elements" | "exotics" | "weaponTypes"
const FACETS: readonly Facet[] = ["classes", "elements", "exotics", "weaponTypes"]

/** Everything narrowing the list right now, as chips the player can tap to remove. */
export const activeFilters = (filter: BuildFilter): ActiveFilter[] => [
  ...(filter.where === "all" ? [] : [{ id: "where", label: WHERE_LABEL[filter.where] }]),
  ...(filter.state === "all" ? [] : [{ id: "state", label: STATE_LABEL[filter.state] }]),
  ...FACETS.flatMap((facet) =>
    [...filter[facet]].map((value) => ({ id: `${facet}:${value}`, label: value.toUpperCase() })),
  ),
]

export const removeFilter = (filter: BuildFilter, id: string): BuildFilter => {
  if (id === "where") return { ...filter, where: "all" }
  if (id === "state") return { ...filter, state: "all" }
  const facet = FACETS.find((each) => id.startsWith(`${each}:`))
  if (facet === undefined) return filter
  const value = id.slice(facet.length + 1)
  return { ...filter, [facet]: new Set([...filter[facet]].filter((each) => each !== value)) }
}

export interface FacetOption<T> {
  readonly value: T
  readonly count: number
}

export interface FacetOptions {
  readonly classes: readonly FacetOption<GuardianClass>[]
  readonly elements: readonly FacetOption<DamageType>[]
  readonly exotics: readonly FacetOption<string>[]
  readonly weaponTypes: readonly FacetOption<string>[]
}

const CLASS_ORDER: readonly GuardianClass[] = ["hunter", "titan", "warlock"]
const ELEMENT_ORDER: readonly DamageType[] = [
  "kinetic",
  "arc",
  "solar",
  "void",
  "stasis",
  "strand",
  "none",
]

const tally = <T>(values: readonly (readonly T[])[]) => {
  const counts = new Map<T, number>()
  for (const each of values) {
    for (const value of new Set(each)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

const inOrder = <T>(counts: ReadonlyMap<T, number>, order: readonly T[]): FacetOption<T>[] =>
  order.flatMap((value) => {
    const count = counts.get(value)
    return count === undefined ? [] : [{ value, count }]
  })

const byCount = (counts: ReadonlyMap<string, number>): FacetOption<string>[] =>
  [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

/** The chips the filter sheet offers: only values some saved build has, each with how many have it. */
export const facetOptions = (builds: readonly SavedBuild[]): FacetOptions => ({
  classes: inOrder(tally(builds.map((build) => [build.facets.classType])), CLASS_ORDER),
  elements: inOrder(tally(builds.map((build) => [build.facets.element])), ELEMENT_ORDER),
  exotics: byCount(tally(builds.map(exoticsOf))),
  weaponTypes: byCount(tally(builds.map((build) => build.facets.weaponTypes))),
})
