import { describe, expect, test } from 'bun:test'
import { Layer, Redacted } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { Access, AccessGuard, type AccessValues, type Incoming, refusal } from './access.ts'

const access: AccessValues = {
  token: Redacted.make('pair-token'),
  mcpToken: Redacted.make('mcp-token'),
  tailscaleUser: 'me@example.com',
  tailnetHost: 'box.tail1234.ts.net',
  localHosts: new Set(['127.0.0.1:4848', 'localhost:4848', '[::1]:4848']),
}

const request = (url: string, headers: Incoming['headers'], method = 'GET'): Incoming => ({
  method,
  url,
  headers,
})

const local = (extra: Incoming['headers'] = {}) => ({ host: '127.0.0.1:4848', ...extra })
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

describe('refusal', () => {
  test('lets health and the Bungie callback through without a token', () => {
    expect(refusal(access, request('/health', local()))).toBeNull()
    expect(refusal(access, request('/auth/bungie/callback?code=x', local()))).toBeNull()
  })

  test('requires the pairing token everywhere else, docs included', () => {
    for (const path of ['/jobs', '/docs', '/openapi.json', '/health/../jobs', '/healthz']) {
      expect(refusal(access, request(path, local()))?.status).toBe(401)
      expect(refusal(access, request(path, local(bearer('wrong'))))?.status).toBe(401)
      expect(refusal(access, request(path, local(bearer('pair-token'))))).toBeNull()
    }
    expect(refusal(access, request('/health', local(), 'POST'))?.status).toBe(401)
  })

  test('guards /mcp with its own token, not the pairing token', () => {
    expect(refusal(access, request('/mcp', local(bearer('pair-token')), 'POST'))?.status).toBe(401)
    expect(refusal(access, request('/mcp', local(bearer('mcp-token')), 'POST'))).toBeNull()
    expect(refusal(access, request('/jobs', local(bearer('mcp-token'))))?.status).toBe(401)
  })

  test('refuses everything when no pairing token is configured', () => {
    const open = { ...access, token: Redacted.make('') }
    expect(refusal(open, request('/jobs', local({ authorization: 'Bearer ' })))?.status).toBe(401)
    expect(refusal(open, request('/jobs', local())))?.toMatchObject({ status: 401 })
  })

  test('refuses a Host that is neither loopback nor the tailnet name', () => {
    const rebound = { host: 'evil.example:4848', ...bearer('pair-token') }
    expect(refusal(access, request('/jobs', rebound))?.status).toBe(403)
    expect(refusal(access, request('/health', { host: 'evil.example:4848' }))?.status).toBe(403)
    expect(refusal(access, request('/jobs', { ...bearer('pair-token') }))?.status).toBe(403)
    expect(refusal(access, request('/jobs', { host: '127.0.0.1:9999' }))?.status).toBe(403)
    const viaServe = {
      host: 'box.tail1234.ts.net:4848',
      'tailscale-user-login': 'me@example.com',
      ...bearer('pair-token'),
    }
    expect(refusal(access, request('/jobs', viaServe))).toBeNull()
  })

  test('trusts any Host from tailscale serve only while the tailnet name is unknown', () => {
    const unknown = { ...access, tailnetHost: '' }
    const proxied = {
      host: 'renamed.tail1234.ts.net:4848',
      'tailscale-user-login': 'me@example.com',
      ...bearer('pair-token'),
    }
    expect(refusal(unknown, request('/jobs', proxied))).toBeNull()
    expect(refusal(access, request('/jobs', proxied))?.status).toBe(403)
  })

  test('refuses another tailnet user coming through tailscale serve', () => {
    const stranger = {
      host: 'box.tail1234.ts.net:4848',
      'tailscale-user-login': 'someone@example.com',
      ...bearer('pair-token'),
    }
    expect(refusal(access, request('/jobs', stranger))?.status).toBe(403)
    expect(refusal(access, request('/auth/bungie/callback', stranger))?.status).toBe(403)
    expect(refusal({ ...access, tailscaleUser: '' }, request('/jobs', stranger))).toBeNull()
  })
})

describe('AccessGuard', () => {
  const App = Layer.mergeAll(
    HttpRouter.add('GET', '/health', HttpServerResponse.text('ok')),
    HttpRouter.add('GET', '/jobs', HttpServerResponse.text('jobs')),
    AccessGuard,
  ).pipe(Layer.provide(Layer.succeed(Access, access)))

  test('answers refused requests itself and passes the rest to the route', async () => {
    const { handler, dispose } = HttpRouter.toWebHandler(App, { disableLogger: true })
    const call = (path: string, headers: Record<string, string> = {}) =>
      handler(new Request(`http://127.0.0.1:4848${path}`, { headers: { ...local(), ...headers } }))
    try {
      expect(await (await call('/health')).text()).toBe('ok')
      const refused = await call('/jobs')
      expect(refused.status).toBe(401)
      expect(refused.headers.get('www-authenticate')).toBe('Bearer')
      expect((await call('/missing')).status).toBe(401)
      const allowed = await call('/jobs', bearer('pair-token'))
      expect(allowed.status).toBe(200)
      expect(await allowed.text()).toBe('jobs')
    } finally {
      await dispose()
    }
  })
})
