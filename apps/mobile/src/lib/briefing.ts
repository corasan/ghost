import type { Briefing } from '@ghost/contract'

// Pure wording for the "since last..." message that opens the chat. Kept free
// of React Native imports so it can be tested with `bun test`.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

/** "Since last night", "Since this morning", "Since Tuesday"... */
export function sinceLabel(since: string, now: Date = new Date()) {
  const then = new Date(since)
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000)
  const hour = then.getHours()
  if (days <= 0) {
    if (hour < 12) return 'Since this morning'
    if (hour < 17) return 'Since this afternoon'
    return 'Since earlier this evening'
  }
  if (days === 1) return hour >= 17 ? 'Since last night' : 'Since yesterday'
  if (days < 7) return `Since ${DAYS[then.getDay()]}`
  return `Since ${then.getDate()} ${MONTHS[then.getMonth()]}`
}

export const countWord = (n: number) => WORDS[n] ?? String(n)

const items = (n: number) => `${n} new ${n === 1 ? 'item' : 'items'}`

export function briefingSentence(briefing: Briefing, now: Date = new Date()) {
  const parts: string[] = []
  if (briefing.since === null) {
    parts.push("First sync done. I'm tracking your gear from here, so new drops land in Recent.")
  } else if (briefing.newCount === 0) {
    parts.push(`${sinceLabel(briefing.since, now)}: nothing new.`)
  } else {
    const upgrades = briefing.upgrades.length
    const beat =
      upgrades === 0
        ? ''
        : upgrades === briefing.newCount && upgrades === 1
          ? ', and it beats what you have on'
          : `, ${countWord(upgrades)} of them ${upgrades === 1 ? 'beats' : 'beat'} what you have on`
    parts.push(`${sinceLabel(briefing.since, now)}: ${items(briefing.newCount)}${beat}.`)
  }
  const { postmasterCount: post, postmasterCapacity: postCap } = briefing
  if (post >= postCap) parts.push(`Postmaster is full, so new drops are being lost.`)
  else if (post > 0) parts.push(`Postmaster is at ${post} of ${postCap}.`)
  if (briefing.vaultCount / briefing.vaultCapacity >= 0.9) {
    parts.push(`Vault is at ${briefing.vaultCount} of ${briefing.vaultCapacity}.`)
  }
  return parts.join(' ')
}

export type FollowUp =
  | { readonly label: string; readonly kind: 'prompt'; readonly prompt: string }
  | { readonly label: string; readonly kind: 'recent'; readonly filter: 'upgrades' | 'all' }

/** The two most useful next steps, most urgent first. */
export function followUps(briefing: Briefing): readonly FollowUp[] {
  const out: FollowUp[] = []
  if (briefing.upgrades.length > 0) {
    out.push({ label: 'SHOW UPGRADES', kind: 'recent', filter: 'upgrades' })
  }
  if (briefing.postmasterCount > 0) {
    out.push({
      label: 'CLEAR POSTMASTER',
      kind: 'prompt',
      prompt: 'Empty the postmaster into the vault',
    })
  }
  if (briefing.vaultCount / briefing.vaultCapacity >= 0.9) {
    out.push({ label: 'CLEAN UP VAULT', kind: 'prompt', prompt: 'Clean up my vault' })
  }
  if (briefing.newCount > 0 && briefing.upgrades.length === 0) {
    out.push({ label: "SHOW WHAT'S NEW", kind: 'recent', filter: 'all' })
  }
  return out.slice(0, 2)
}

/** "Sat 4 Oct" */
export function dayStamp(now: Date = new Date()) {
  return `${DAYS[now.getDay()]?.slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()]}`
}
