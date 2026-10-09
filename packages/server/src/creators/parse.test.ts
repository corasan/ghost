import { describe, expect, test } from 'bun:test'
import {
  checkNotes,
  extractChannelId,
  extractJsonText,
  parseChannelList,
  parseFeed,
  parseJson3,
  rankNotes,
  transcriptText,
  videoUrl,
} from './parse.ts'

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Datto</title>
 <author><name>Datto</name></author>
 <entry>
  <id>yt:video:abc123def45</id>
  <yt:videoId>abc123def45</yt:videoId>
  <yt:channelId>UCaaaaaaaaaaaaaaaaaaaaaa</yt:channelId>
  <title>Best Hunter Build &amp; Why It&#39;s Busted</title>
  <author><name>Datto</name></author>
  <published>2026-09-30T16:00:00+00:00</published>
  <media:group>
   <media:title>Best Hunter Build</media:title>
   <media:description>Here is the build &lt;3</media:description>
  </media:group>
 </entry>
 <entry>
  <yt:videoId>missingdate</yt:videoId>
  <yt:channelId>UCaaaaaaaaaaaaaaaaaaaaaa</yt:channelId>
 </entry>
</feed>`

describe('channel config', () => {
  test('reads handles, ids and names to search', () => {
    expect(parseChannelList(' @Datto, UCaaaaaaaaaaaaaaaaaaaaaa ,Aegis Destiny 2,,')).toEqual([
      { kind: 'handle', value: '@Datto' },
      { kind: 'id', value: 'UCaaaaaaaaaaaaaaaaaaaaaa' },
      { kind: 'search', value: 'Aegis Destiny 2' },
    ])
  })

  test('finds the channel id on a channel or search page', () => {
    expect(
      extractChannelId(`<meta itemprop="identifier" content="UCbbbbbbbbbbbbbbbbbbbbbb">`),
    ).toBe('UCbbbbbbbbbbbbbbbbbbbbbb')
    expect(extractChannelId(`{"channelId":"UCcccccccccccccccccccccc","title"`)).toBe(
      'UCcccccccccccccccccccccc',
    )
    expect(extractChannelId('<html>consent wall</html>')).toBeNull()
  })
})

describe('parseFeed', () => {
  test('reads entries with decoded titles and skips incomplete ones', () => {
    expect(parseFeed(FEED)).toEqual([
      {
        videoId: 'abc123def45',
        channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
        channelTitle: 'Datto',
        title: "Best Hunter Build & Why It's Busted",
        publishedAt: '2026-09-30T16:00:00.000Z',
        description: 'Here is the build <3',
      },
    ])
  })

  test('skips an entry with a malformed date or an id that is not a video id', () => {
    const entry = (videoId: string, published: string) => `<entry>
  <yt:videoId>${videoId}</yt:videoId>
  <yt:channelId>UCaaaaaaaaaaaaaaaaaaaaaa</yt:channelId>
  <published>${published}</published>
 </entry>`
    const feed = `<feed><title>Datto</title>
 ${entry('abc123def45', 'yesterday-ish')}
 ${entry('../../../etc', '2026-09-30T16:00:00+00:00')}
 ${entry('zzz123def45', '2026-09-30T16:00:00+00:00')}
</feed>`
    expect(parseFeed(feed).map((video) => video.videoId)).toEqual(['zzz123def45'])
  })
})

describe('captions', () => {
  const json3 = JSON.stringify({
    events: [
      { tStartMs: 0, segs: [{ utf8: 'welcome back' }] },
      { tStartMs: 500 },
      { tStartMs: 4000, segs: [{ utf8: 'today ' }, { utf8: '\nhunters' }] },
      { tStartMs: 4200, segs: [{ utf8: 'today hunters' }] },
      { tStartMs: 75_000, segs: [{ utf8: 'run Vorpal Weapon' }] },
    ],
  })

  test('joins segments and keeps start seconds', () => {
    expect(parseJson3(json3)).toEqual([
      { startSec: 0, text: 'welcome back' },
      { startSec: 4, text: 'today hunters' },
      { startSec: 4, text: 'today hunters' },
      { startSec: 75, text: 'run Vorpal Weapon' },
    ])
  })

  test('groups lines into timestamped windows without rolling repeats', () => {
    expect(transcriptText(parseJson3(json3))).toBe(
      '[0:00] welcome back today hunters\n[1:15] run Vorpal Weapon',
    )
  })

  test('links to the moment', () => {
    expect(videoUrl('abc', 75)).toBe('https://www.youtube.com/watch?v=abc&t=75s')
    expect(videoUrl('abc', null)).toBe('https://www.youtube.com/watch?v=abc')
  })
})

describe('summary checks', () => {
  test('pulls JSON out of a fenced reply', () => {
    expect(extractJsonText('Here:\n```json\n{"notes":[]}\n```')).toBe('{"notes":[]}')
    expect(() => extractJsonText('no json')).toThrow()
  })

  test('keeps manifest names, flags unknown ones and drops notes with none known', () => {
    const known = new Map([['vorpal weapon', 'Vorpal Weapon']])
    const notes = checkNotes(
      [
        {
          topic: 'perk',
          claim: ' Vorpal is great on rockets. ',
          startSec: 75.4,
          names: ['vorpal weapon', 'Rocket Thing'],
        },
        { topic: 'perk', claim: 'Vorple wepon is good.', startSec: 10, names: ['Vorple Wepon'] },
        { topic: 'meta', claim: 'Solar is strong this season.', startSec: 9999, names: [] },
        { topic: 'meta', claim: '  ', startSec: 0, names: [] },
      ],
      known,
      600,
    )
    expect(notes).toEqual([
      {
        topic: 'perk',
        claim: 'Vorpal is great on rockets.',
        startSec: 75,
        names: ['Vorpal Weapon'],
        unverified: ['Rocket Thing'],
      },
      {
        topic: 'meta',
        claim: 'Solar is strong this season.',
        startSec: null,
        names: [],
        unverified: [],
      },
    ])
  })
})

describe('rankNotes', () => {
  const notes = [
    {
      topic: 'meta',
      claim: 'Solar hunters are strong in GMs',
      names: [],
      publishedAt: '2026-09-01',
    },
    {
      topic: 'weapon',
      claim: 'Run this rocket',
      names: ['Apex Predator'],
      publishedAt: '2026-09-02',
    },
    {
      topic: 'perk',
      claim: 'Apex Predator wants Bait and Switch',
      names: ['Bait and Switch'],
      publishedAt: '2026-09-03',
    },
  ]

  test('names outrank claim text, then newer first', () => {
    expect(rankNotes(notes, 'apex predator', 5).map((n) => n.publishedAt)).toEqual([
      '2026-09-02',
      '2026-09-03',
    ])
  })

  test('an empty query lists newest first', () => {
    expect(rankNotes(notes, '', 2).map((n) => n.publishedAt)).toEqual(['2026-09-03', '2026-09-02'])
  })
})
