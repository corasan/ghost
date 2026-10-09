import { describe, expect, test } from 'bun:test'
import { isNewer, parseVersion } from './install.ts'

describe('parseVersion', () => {
  test('reads release tags with or without the v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('10.0.12')).toEqual([10, 0, 12])
  })

  test('rejects prereleases and anything else', () => {
    expect(parseVersion('v1.2.3-beta.1')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('latest')).toBeNull()
  })
})

describe('isNewer', () => {
  test('compares each part as a number, not as text', () => {
    expect(isNewer([1, 0, 10], [1, 0, 9])).toBe(true)
    expect(isNewer([1, 10, 0], [1, 9, 99])).toBe(true)
    expect(isNewer([2, 0, 0], [1, 99, 99])).toBe(true)
  })

  test('is false for the same or an older version', () => {
    expect(isNewer([1, 0, 1], [1, 0, 1])).toBe(false)
    expect(isNewer([1, 0, 0], [1, 0, 1])).toBe(false)
  })
})
