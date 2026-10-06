import type { Keyword, LoadoutPlug } from "@ghost/contract"

export type KeywordRun = { text: string; keyword?: Keyword }

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const stems = (name: string) => {
  const lower = name.toLowerCase()
  return [lower, lower.replace(/(ility|ion|ed|e)$/, "")]
}

const ENDINGS = "(?:s|es|d|ed|ing|en|ened|ens|ion|ions|ility|le|e)?"

/** Every keyword the plugs use, once each, in the order they first appear. */
export const loadoutKeywords = (plugs: readonly LoadoutPlug[]): Keyword[] => [
  ...new Map(
    plugs.flatMap((plug) => plug.keywords ?? []).map((keyword) => [keyword.name, keyword]),
  ).values(),
]

/**
 * Splits effect text into runs, marking each word that is one of `keywords`
 * in any of its forms, so "weakened" and "Invisible" find Weaken and Invisibility.
 */
export const keywordRuns = (text: string, keywords: readonly Keyword[]): KeywordRun[] => {
  const byStem = new Map(
    keywords.flatMap((keyword) => stems(keyword.name).map((s) => [s, keyword])),
  )
  if (byStem.size === 0) return [{ text }]
  const alternatives = [...byStem.keys()].sort((a, b) => b.length - a.length).map(escape)
  const pattern = new RegExp(`\\b(${alternatives.join("|")})${ENDINGS}\\b`, "gi")
  const runs: KeywordRun[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    const keyword = byStem.get((match[1] ?? "").toLowerCase())
    if (keyword === undefined) continue
    if (match.index > at) runs.push({ text: text.slice(at, match.index) })
    runs.push({ text: match[0], keyword })
    at = match.index + match[0].length
  }
  if (at < text.length) runs.push({ text: text.slice(at) })
  return runs
}
