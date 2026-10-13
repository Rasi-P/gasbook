import { describe, expect, it } from 'bun:test'
import { formatDateTime } from '../src/lib/dateTime'

describe('event date/time', () => {
  it('uses IST including the correct day across midnight, independent of device timezone', () => {
    const previous = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    try {
      const result = formatDateTime('2026-10-13T20:45:00Z')
      expect(result).toContain('14 Oct 2026')
      expect(result).toContain('02:15')
      expect(result.toLowerCase()).toContain('am')
      expect(result).toEndWith('IST')
      expect(result).toBe(formatDateTime('2026-10-14T02:15:00+05:30'))
    } finally { process.env.TZ = previous }
  })
  it('does not invent event times for missing, malformed or date-only values', () => {
    for (const value of [null, undefined, '', 'invalid', '2026-10-13', '2026-10-13T12:00:00']) {
      expect(formatDateTime(value)).toBe('Time unavailable')
    }
  })
})
