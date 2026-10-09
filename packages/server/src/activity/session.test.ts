import { describe, expect, test } from 'bun:test'
import { sessionWindow } from './session.ts'

const at = (iso: string) => Date.parse(iso)

describe('sessionWindow', () => {
  test('first run has no window', () => {
    expect(sessionWindow(at('2026-10-04T12:00:00Z'), null, null)).toEqual({
      since: null,
      started: false,
    })
  })

  test('a request within 45 minutes keeps the stored start', () => {
    const window = sessionWindow(
      at('2026-10-04T12:30:00Z'),
      '2026-10-04T12:00:00Z',
      '2026-10-03T20:00:00Z',
    )
    expect(window).toEqual({ since: '2026-10-03T20:00:00Z', started: false })
  })

  test('a gap over 45 minutes starts a session at the last activity', () => {
    const window = sessionWindow(
      at('2026-10-04T13:00:01Z'),
      '2026-10-04T12:15:00Z',
      '2026-10-03T20:00:00Z',
    )
    expect(window).toEqual({ since: '2026-10-04T12:15:00Z', started: true })
  })

  test('exactly 45 minutes is still the same session', () => {
    const window = sessionWindow(at('2026-10-04T12:45:00Z'), '2026-10-04T12:00:00Z', null)
    expect(window).toEqual({ since: null, started: false })
  })
})
