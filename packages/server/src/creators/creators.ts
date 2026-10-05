import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { Context, DateTime, Effect, Layer, Semaphore } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { SqlClient } from "effect/sql"
import { Summarizer } from "../agent/summarize.ts"
import { Manifest } from "../bungie/manifest.ts"
import { AppConfig } from "../config.ts"
import {
  type ChannelRef,
  type CaptionLine,
  checkNotes,
  extractChannelId,
  type FeedVideo,
  NOTE_MAX_AGE_DAYS,
  parseChannelList,
  parseFeed,
  parseJson3,
  rankNotes,
  transcriptText,
  videoUrl,
} from "./parse.ts"

// Creator videos are often where a new meta shows up first, so Ghost keeps
// short, dated notes from a few Destiny channels. New uploads come from each
// channel's public RSS feed (no API key). Captions come from yt-dlp when it
// is installed; without it the video description is summarized instead and
// the note says so. Each video is summarized once, every gear name is checked
// against the Bungie manifest, and notes older than 60 days are deleted.

const REFRESH_EVERY = "6 hours"
/** Summaries cost a model call each, so a run handles at most this many. */
const VIDEOS_PER_RUN = 10
const MAX_TRANSCRIPT_CHARS = 60_000
const DAY_MS = 86_400_000

export interface CreatorNote {
  readonly claim: string
  readonly topic: string
  readonly names: ReadonlyArray<string>
  readonly unverifiedNames: ReadonlyArray<string>
  readonly channel: string
  readonly video: string
  readonly publishedAt: string
  readonly url: string
  /** captions: from what was said; description: from the video description only. */
  readonly basis: "captions" | "description"
}

export interface CreatorChannel {
  readonly channel: string
  readonly configured: string
  readonly latestVideoAt: string | null
  readonly error: string | null
}

export interface CreatorNotesShape {
  /** Poll feeds and summarize new uploads. Never fails; problems are logged and stored. */
  readonly refresh: Effect.Effect<void>
  readonly search: (
    query: string,
    limit: number,
  ) => Effect.Effect<{
    readonly notes: ReadonlyArray<CreatorNote>
    readonly channels: ReadonlyArray<CreatorChannel>
    readonly captionsAvailable: boolean
  }>
}

export class CreatorNotes extends Context.Service<CreatorNotes, CreatorNotesShape>()(
  "CreatorNotes",
) {}

interface NoteRow {
  readonly topic: string
  readonly claim: string
  readonly start_sec: number | null
  readonly names: string
  readonly unverified: string
  readonly video_id: string
  readonly title: string
  readonly channel_title: string
  readonly published_at: string
  readonly basis: string
}

interface ChannelRow {
  readonly ref: string
  readonly channel_id: string | null
  readonly title: string | null
  readonly error: string | null
  readonly latest: string | null
}

const refKey = (ref: ChannelRef) => ref.value

// Consent cookies skip the EU cookie wall, which otherwise replaces the page.
const page = (url: string) =>
  HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader("User-Agent", "Mozilla/5.0 (compatible; Ghost/0.0)"),
    HttpClientRequest.setHeader("Accept-Language", "en-US,en;q=0.9"),
    HttpClientRequest.setHeader("Cookie", "CONSENT=YES+1; SOCS=CAI"),
  )

const ytDlp = Bun.which("yt-dlp")

/** English captions through yt-dlp, or null when it is missing or finds none. */
const captionsFor = (videoId: string, dataDir: string) =>
  Effect.tryPromise(async (): Promise<ReadonlyArray<CaptionLine> | null> => {
    if (ytDlp === null) return null
    const dir = join(dataDir, "captions", videoId)
    mkdirSync(dir, { recursive: true })
    try {
      const proc = Bun.spawn(
        [
          ytDlp,
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs",
          "en.*,en",
          "--sub-format",
          "json3",
          "--no-warnings",
          "--quiet",
          "-o",
          join(dir, "%(id)s.%(ext)s"),
          videoUrl(videoId, null),
        ],
        { stdout: "ignore", stderr: "pipe", timeout: 120_000 },
      )
      await proc.exited
      // Uploaded captions are named "<id>.en.json3", auto ones "<id>.en-orig.json3"
      // or similar; the shortest name is the uploaded track when both exist.
      const file = readdirSync(dir)
        .filter((f) => f.endsWith(".json3"))
        .sort((a, b) => a.length - b.length)[0]
      if (file === undefined) return null
      const lines = parseJson3(readFileSync(join(dir, file), "utf8"))
      return lines.length > 0 ? lines : null
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.as(Effect.logWarning(`captions for ${videoId} failed: ${String(error)}`), null),
    ),
  )

export const CreatorNotesLive = Layer.effect(
  CreatorNotes,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const sql = yield* SqlClient.SqlClient
    const http = yield* HttpClient.HttpClient
    const manifest = yield* Manifest
    const summarizer = yield* Summarizer
    const lock = yield* Semaphore.make(1)
    const refs = parseChannelList(config.youtubeChannels)

    const fetchText = (url: string) =>
      http
        .execute(page(url))
        .pipe(
          Effect.flatMap((response) =>
            response.status === 200
              ? response.text
              : Effect.fail(new Error(`HTTP ${response.status} for ${url}`)),
          ),
        )

    const setChannel = (
      ref: ChannelRef,
      fields: { id?: string; title?: string | undefined; error: string | null },
    ) =>
      sql`
        INSERT INTO creator_channels (ref, channel_id, title, error)
        VALUES (${refKey(ref)}, ${fields.id ?? null}, ${fields.title ?? null}, ${fields.error})
        ON CONFLICT(ref) DO UPDATE SET
          channel_id = COALESCE(excluded.channel_id, creator_channels.channel_id),
          title = COALESCE(excluded.title, creator_channels.title),
          error = excluded.error
      `.pipe(Effect.orDie)

    // A handle or a name is resolved to a channel id once and remembered.
    const resolve = (ref: ChannelRef) =>
      Effect.gen(function* () {
        if (ref.kind === "id") return ref.value
        const rows = yield* sql<{ channel_id: string | null }>`
          SELECT channel_id FROM creator_channels WHERE ref = ${refKey(ref)}
        `.pipe(Effect.orDie)
        const known = rows[0]?.channel_id
        if (known !== null && known !== undefined) return known
        const url =
          ref.kind === "handle"
            ? `https://www.youtube.com/${ref.value}`
            : // sp=EgIQAg== limits search results to channels.
              `https://www.youtube.com/results?search_query=${encodeURIComponent(ref.value)}&sp=EgIQAg%253D%253D`
        const id = extractChannelId(yield* fetchText(url))
        if (id === null) return yield* Effect.fail(new Error(`no channel found for ${ref.value}`))
        return id
      })

    const knownNames = (names: ReadonlyArray<string>) =>
      Effect.map(manifest.findByName(names), (defs) => {
        const map = new Map<string, string>()
        for (const def of defs) map.set(def.name.toLowerCase(), def.name)
        return map as ReadonlyMap<string, string>
      })

    const processVideo = (video: FeedVideo) =>
      Effect.gen(function* () {
        const captions = yield* captionsFor(video.videoId, config.dataDir)
        const text =
          captions !== null
            ? transcriptText(captions).slice(0, MAX_TRANSCRIPT_CHARS)
            : `${video.title}\n\n${video.description}`
        const basis = captions !== null ? "captions" : "description"
        const now = DateTime.formatIso(yield* DateTime.now)
        const insertVideo = (status: string) =>
          sql`
            INSERT OR REPLACE INTO creator_videos
              (video_id, channel_id, channel_title, title, published_at, basis, status, processed_at)
            VALUES (${video.videoId}, ${video.channelId}, ${video.channelTitle}, ${video.title},
                    ${video.publishedAt}, ${basis}, ${status}, ${now})
          `
        // A description this short has no advice in it; remember the video
        // so it is not retried every run.
        if (captions === null && video.description.trim().length < 200) {
          yield* insertVideo("no_text").pipe(Effect.orDie)
          return
        }
        const summary = yield* summarizer.summarize({
          channelTitle: video.channelTitle,
          title: video.title,
          publishedAt: video.publishedAt,
          text,
          timed: captions !== null,
        })
        const known = yield* knownNames(summary.notes.flatMap((n) => n.names))
        const lastLine = captions?.[captions.length - 1]
        const notes = checkNotes(
          summary.notes,
          known,
          lastLine === undefined ? null : lastLine.startSec + 60,
        )
        yield* Effect.gen(function* () {
          yield* sql`DELETE FROM creator_notes WHERE video_id = ${video.videoId}`
          yield* insertVideo("done")
          if (notes.length === 0) return
          yield* sql`INSERT INTO creator_notes ${sql.insert(
            notes.map((note) => ({
              video_id: video.videoId,
              topic: note.topic,
              claim: note.claim,
              start_sec: captions !== null ? note.startSec : null,
              names: JSON.stringify(note.names),
              unverified: JSON.stringify(note.unverified),
            })),
          )}`
        }).pipe(sql.withTransaction, Effect.orDie)
        yield* Effect.logInfo(
          `creator notes: ${notes.length} from "${video.title}" (${video.channelTitle}, ${basis})`,
        )
      })

    const prune = (cutoff: string) =>
      Effect.gen(function* () {
        yield* sql`
          DELETE FROM creator_notes WHERE video_id IN
            (SELECT video_id FROM creator_videos WHERE published_at < ${cutoff})
        `
        yield* sql`DELETE FROM creator_videos WHERE published_at < ${cutoff}`
      }).pipe(Effect.orDie)

    const cutoffIso = Effect.map(DateTime.now, (now) =>
      new Date(DateTime.toEpochMillis(now) - NOTE_MAX_AGE_DAYS * DAY_MS).toISOString(),
    )

    const refresh = Effect.gen(function* () {
      if (refs.length === 0) return
      const cutoff = yield* cutoffIso
      yield* prune(cutoff)
      const fresh: Array<FeedVideo> = []
      for (const ref of refs) {
        const videos = yield* Effect.gen(function* () {
          const id = yield* resolve(ref)
          const list = parseFeed(
            yield* fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`),
          )
          yield* setChannel(ref, { id, title: list[0]?.channelTitle, error: null })
          return list
        }).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.andThen(
                setChannel(ref, { error: String(error) }),
                Effect.logWarning(`creator feed ${ref.value} failed: ${String(error)}`),
              ),
              [] as ReadonlyArray<FeedVideo>,
            ),
          ),
        )
        fresh.push(...videos.filter((v) => v.publishedAt >= cutoff))
      }
      if (fresh.length === 0) return
      const seen = new Set(
        (yield* sql<{ video_id: string }>`
          SELECT video_id FROM creator_videos WHERE video_id IN ${sql.in(fresh.map((v) => v.videoId))}
        `.pipe(Effect.orDie)).map((row) => row.video_id),
      )
      const queue = fresh
        .filter((v) => !seen.has(v.videoId))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, VIDEOS_PER_RUN)
      // Names are checked against the manifest, so without it nothing is stored.
      const ready = yield* manifest.ensure.pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.as(
            Effect.logWarning(`creator notes waiting on manifest: ${error.message}`),
            false,
          ),
        ),
      )
      if (!ready) return
      for (const video of queue) {
        yield* processVideo(video).pipe(
          Effect.catch((error) =>
            Effect.logWarning(`creator note for ${video.videoId} failed: ${String(error)}`),
          ),
        )
      }
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("creator refresh failed", cause)),
      lock.withPermits(1),
    )

    const search = (query: string, limit: number) =>
      Effect.gen(function* () {
        const cutoff = yield* cutoffIso
        const rows = yield* sql<NoteRow>`
          SELECT n.topic, n.claim, n.start_sec, n.names, n.unverified, v.video_id, v.title,
                 v.channel_title, v.published_at, v.basis
          FROM creator_notes n JOIN creator_videos v ON v.video_id = n.video_id
          WHERE v.published_at >= ${cutoff}
        `.pipe(Effect.orDie)
        const notes = rows.map((row) => ({
          row,
          topic: row.topic,
          claim: row.claim,
          names: JSON.parse(row.names) as Array<string>,
          publishedAt: row.published_at,
        }))
        const channels = yield* sql<ChannelRow>`
          SELECT c.ref, c.channel_id, c.title, c.error,
                 (SELECT MAX(published_at) FROM creator_videos v WHERE v.channel_id = c.channel_id) AS latest
          FROM creator_channels c
        `.pipe(Effect.orDie)
        const active = new Set(refs.map(refKey))
        return {
          notes: rankNotes(notes, query, limit).map(({ row, names }): CreatorNote => ({
            claim: row.claim,
            topic: row.topic,
            names,
            unverifiedNames: JSON.parse(row.unverified) as Array<string>,
            channel: row.channel_title,
            video: row.title,
            publishedAt: row.published_at,
            url: videoUrl(row.video_id, row.start_sec),
            basis: row.basis === "captions" ? "captions" : "description",
          })),
          channels: channels
            .filter((c) => active.has(c.ref))
            .map((c) => ({
              channel: c.title ?? c.ref,
              configured: c.ref,
              latestVideoAt: c.latest,
              error: c.error,
            })),
          captionsAvailable: ytDlp !== null,
        }
      })

    return { refresh, search }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

const refreshLoop = Effect.gen(function* () {
  const creators = yield* CreatorNotes
  yield* creators.refresh
}).pipe(Effect.andThen(Effect.sleep(REFRESH_EVERY)), Effect.forever)

export const CreatorRefreshLive = Layer.effectDiscard(Effect.forkScoped(refreshLoop))
