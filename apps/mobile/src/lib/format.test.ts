import { describe, expect, test } from 'bun:test'
import { tokens, until, usd } from './format'

describe('tokens', () => {
  test('shortens counts to fit a column, dropping a trailing .0', () => {
    expect([940, 1000, 45_230, 452_812, 1_250_000, 12_000_000].map(tokens)).toEqual([
      '940',
      '1K',
      '45.2K',
      '453K',
      '1.3M',
      '12M',
    ])
  })
})

describe('usd', () => {
  test('never shows a run that cost something as free', () => {
    expect([0, 0.004, 0.1149, 1.927].map(usd)).toEqual(['$0.00', '<$0.01', '$0.11', '$1.93'])
  })
})

describe('until', () => {
  const now = Date.parse('2026-10-25T06:00:00Z')
  test('counts down in the largest two units', () => {
    expect(
      ['2026-10-25T06:42:00Z', '2026-10-25T09:10:00Z', '2026-10-27T10:00:00Z'].map((iso) =>
        until(iso, now),
      ),
    ).toEqual(['in 42m', 'in 3h 10m', 'in 2d 4h'])
  })

  test('stops at zero once the time has passed', () => {
    expect(until('2026-10-25T05:00:00Z', now)).toBe('in 0m')
  })
})
