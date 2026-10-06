import { Schema } from "effect"

// Pure helpers for the creator-notes source: reading YouTube's channel
// feeds, turning yt-dlp caption files into timestamped text, checking what
// the summarizer returned, and ranking notes for a search. Nothing here
// touches the network or the database, so all of it is unit tested.

/** How long a creator note stays usable; older advice is dropped. */
export const NOTE_MAX_AGE_DAYS = 60

/** A configured channel: an @handle, a UC… channel id, or a name to search for. */
export type ChannelRef =
  | { readonly kind: "id"; readonly value: string }
  | { readonly kind: "handle"; readonly value: string }
  | { readonly kind: "search"; readonly value: string }

const CHANNEL_ID = /^UC[\w-]{22}$/

export const parseChannelRef = (raw: string): ChannelRef | null => {
  const entry = raw.trim()
  if (entry === "") return null
  if (CHANNEL_ID.test(entry)) return { kind: "id", value: entry }
  if (entry.startsWith("@")) return { kind: "handle", value: entry }
  return { kind: "search", value: entry }
}

export const parseChannelList = (raw: string): ReadonlyArray<ChannelRef> =>
  raw.split(",").flatMap((part) => {
    const ref = parseChannelRef(part)
    return ref === null ? [] : [ref]
  })

/**
 * The channel id on a channel page, or the first channel in a search
 * results page. YouTube's markup changes, so several markers are tried.
 */
export const extractChannelId = (html: string): string | null => {
  const patterns = [
    /<meta itemprop="identifier" content="(UC[\w-]{22})"/,
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/,
    /"externalId":"(UC[\w-]{22})"/,
    /"channelId":"(UC[\w-]{22})"/,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1] !== undefined) return match[1]
  }
  return null
}

export interface FeedVideo {
  readonly videoId: string
  readonly channelId: string
  readonly channelTitle: string
  readonly title: string
  readonly publishedAt: string
  readonly description: string
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
])

export const decodeXml = (text: string) =>
  text.replace(/&(#x?[\da-f]+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X"))
      return String.fromCodePoint(parseInt(code.slice(2), 16))
    if (code.startsWith("#")) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES.get(code) ?? whole
  })

const tag = (xml: string, name: string) => {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))
  return match?.[1] === undefined ? null : decodeXml(match[1].trim())
}

/**
 * YouTube publishes each channel's latest 15 uploads as an Atom feed at
 * /feeds/videos.xml?channel_id=…, with no API key. The feed has the title,
 * the publish time and the description, which is the fallback when no
 * captions can be read.
 */
export const parseFeed = (xml: string): ReadonlyArray<FeedVideo> => {
  const channelTitle = tag(xml.split("<entry>")[0] ?? "", "title") ?? ""
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  return entries.flatMap((entry) => {
    const videoId = tag(entry, "yt:videoId")
    const channelId = tag(entry, "yt:channelId")
    const published = tag(entry, "published")
    if (videoId === null || channelId === null || published === null) return []
    return [
      {
        videoId,
        channelId,
        channelTitle: tag(entry, "name") ?? channelTitle,
        title: tag(entry, "title") ?? "",
        publishedAt: new Date(published).toISOString(),
        description: tag(entry, "media:description") ?? "",
      },
    ]
  })
}

export interface CaptionLine {
  readonly startSec: number
  readonly text: string
}

const decodeJson3 = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      events: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            tStartMs: Schema.optionalKey(Schema.Number),
            segs: Schema.optionalKey(
              Schema.Array(Schema.Struct({ utf8: Schema.optionalKey(Schema.String) })),
            ),
          }),
        ),
      ),
    }),
  ),
)

/** yt-dlp's json3 subtitle format: timed events, each a list of word segments. */
export const parseJson3 = (raw: string): ReadonlyArray<CaptionLine> => {
  const data = decodeJson3(raw)
  return (data.events ?? []).flatMap((event) => {
    const text = (event.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (text === "" || event.tStartMs === undefined) return []
    return [{ startSec: Math.floor(event.tStartMs / 1000), text }]
  })
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`

/**
 * Caption lines merged into one paragraph per window, each prefixed with its
 * start time, so the summarizer can say where in the video a claim is made.
 * Auto-captions repeat themselves as lines roll, so exact repeats are dropped.
 */
export const transcriptText = (lines: ReadonlyArray<CaptionLine>, windowSec = 60) => {
  const out: Array<string> = []
  let start = -1
  let parts: Array<string> = []
  let last = ""
  const flush = () => {
    if (parts.length > 0) out.push(`[${clock(start)}] ${parts.join(" ")}`)
    parts = []
  }
  for (const line of lines) {
    if (line.text === last) continue
    last = line.text
    if (start < 0 || line.startSec - start >= windowSec) {
      flush()
      start = line.startSec
    }
    parts.push(line.text)
  }
  flush()
  return out.join("\n")
}

export const videoUrl = (videoId: string, startSec: number | null) =>
  `https://www.youtube.com/watch?v=${videoId}${startSec !== null && startSec > 0 ? `&t=${startSec}s` : ""}`

export const NoteTopic = Schema.Literals([
  "build",
  "weapon",
  "perk",
  "mod",
  "exotic",
  "subclass",
  "activity",
  "patch",
  "meta",
])

/** What the summarizer must return for one video. */
export const SummaryOutput = Schema.Struct({
  notes: Schema.Array(
    Schema.Struct({
      topic: NoteTopic,
      claim: Schema.String,
      startSec: Schema.NullOr(Schema.Number),
      names: Schema.Array(Schema.String),
    }),
  ),
})
export type SummaryOutput = typeof SummaryOutput.Type

/** The JSON object's text in a model reply, with or without a code fence around it. */
export const extractJsonText = (text: string) => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] ?? text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("no JSON object in summary")
  return body.slice(start, end + 1)
}

export interface CheckedNote {
  readonly topic: typeof NoteTopic.Type
  readonly claim: string
  readonly startSec: number | null
  readonly names: ReadonlyArray<string>
  readonly unverified: ReadonlyArray<string>
}

/**
 * Keep a note only if the gear it names exists in the current manifest.
 * Auto-captions mangle names ("vorple weapon") and a summarizer can invent
 * them, so a note whose every name fails the check is dropped; one with some
 * unknown names keeps them flagged as unverified. Names are returned in the
 * manifest's own spelling.
 */
export const checkNotes = (
  notes: SummaryOutput["notes"],
  known: ReadonlyMap<string, string>,
  durationSec: number | null,
): ReadonlyArray<CheckedNote> =>
  notes.flatMap((note) => {
    const claim = note.claim.trim()
    if (claim === "") return []
    const names: Array<string> = []
    const unverified: Array<string> = []
    for (const name of note.names) {
      const canonical = known.get(name.trim().toLowerCase())
      if (canonical !== undefined) {
        if (!names.includes(canonical)) names.push(canonical)
      } else if (name.trim() !== "") unverified.push(name.trim())
    }
    if (note.names.length > 0 && names.length === 0) return []
    const start =
      note.startSec === null ||
      note.startSec < 0 ||
      (durationSec !== null && note.startSec > durationSec)
        ? null
        : Math.floor(note.startSec)
    return [{ topic: note.topic, claim, startSec: start, names, unverified }]
  })

export interface StoredNote {
  readonly topic: string
  readonly claim: string
  readonly names: ReadonlyArray<string>
  readonly publishedAt: string
}

const terms = (query: string) =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((t) => t.length >= 3)

/**
 * Rank notes for a query: a hit in the gear names counts most, then the
 * topic, then the claim text. Ties go to the newer video. An empty query
 * returns the newest notes.
 */
export const rankNotes = <N extends StoredNote>(
  notes: ReadonlyArray<N>,
  query: string,
  limit: number,
): ReadonlyArray<N> => {
  const wanted = terms(query)
  const scored = notes.map((note) => {
    if (wanted.length === 0) return { note, score: 1 }
    const names = note.names.join(" ").toLowerCase()
    const claim = note.claim.toLowerCase()
    let score = 0
    for (const term of wanted) {
      if (names.includes(term)) score += 3
      if (note.topic === term) score += 2
      if (claim.includes(term)) score += 1
    }
    return { note, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.note.publishedAt.localeCompare(a.note.publishedAt))
    .slice(0, limit)
    .map((s) => s.note)
}
