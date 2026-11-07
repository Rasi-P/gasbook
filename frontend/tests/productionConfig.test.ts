import { describe, expect, test } from 'bun:test'
import { validateApiBaseUrl } from '../build/api-url'

describe('production API URL', () => {
  test('accepts and normalizes an explicit HTTPS API endpoint', () => {
    expect(validateApiBaseUrl('https://api.example.com/api/')).toBe('https://api.example.com/api')
  })
  for (const invalid of [undefined, '', '/api', 'http://api.example.com/api', 'https://localhost/api', 'https://localhost./api', 'https://[::ffff:127.0.0.1]/api', 'https://127.1/api', 'https://[::1]/api', 'https://10.0.0.1/api', 'https://api.example.com', 'https://user:secret@api.example.com/api', 'https://api.example.com/api?token=x', 'https://api.example.com/api#x']) {
    test(`rejects unsafe input ${invalid === undefined ? 'missing' : invalid?.split(':')[0]}`, () => {
      expect(() => validateApiBaseUrl(invalid)).toThrow('VITE_API_BASE_URL')
    })
  }
})

import vercel from '../vercel.json'
test('SPA fallback covers login and actual dashboard routes', () => {
  const rule = vercel.rewrites[0]
  const pattern = new RegExp(`^${rule.source}$`)
  for (const route of ['/login', '/admin-dashboard', '/bookings', '/change-password']) expect(pattern.test(route)).toBe(true)
  expect(rule.destination).toBe('/index.html')
})
