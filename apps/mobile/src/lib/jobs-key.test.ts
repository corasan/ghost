import { describe, expect, mock, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'

mock.module('./server-url', () => ({
  getServerToken: () => '',
  getServerUrl: () => 'http://ghost.test',
  useServerUrl: () => 'http://ghost.test',
}))
const { queryKeys } = await import('./api')

describe('jobs cache', () => {
  test('a fresh chat never reads the every-job list the Vault and Recent pages cache', () => {
    const client = new QueryClient()
    const url = 'http://ghost.test'
    client.setQueryData(queryKeys.jobs(url), [{ id: 'older-chat-job' }])
    expect(client.getQueryData(queryKeys.jobs(url, null))).toBeUndefined()
  })
})
