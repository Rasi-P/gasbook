import { expect, test } from 'bun:test'
import { api, changePassword } from '../src/lib/api'

test('password change installs replacement tokens before the next authenticated request', async () => {
  const values = new Map<string, string>([['gasbook_access', 'old-test-access'], ['gasbook_refresh', 'old-test-refresh']])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
  const adapter = api.defaults.adapter
  try {
    api.defaults.adapter = async config => {
      if (config.url === '/auth/me/') expect(config.headers.Authorization).toBe('Bearer new-test-access')
      return { data: { detail: 'Updated', access: 'new-test-access', refresh: 'new-test-refresh' }, status: 200, statusText: 'OK', headers: {}, config }
    }
    await changePassword('test-input', 'test-input-new', 'test-input-new')
    expect(values.get('gasbook_refresh')).toBe('new-test-refresh')
    await api.get('/auth/me/')
  } finally {
    api.defaults.adapter = adapter
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
