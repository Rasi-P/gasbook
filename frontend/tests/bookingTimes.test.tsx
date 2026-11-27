import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BookingTimes } from '../src/components/BookingTimes'

it('renders placement and completion as separate event times', () => {
  const html = renderToStaticMarkup(<BookingTimes booking={{status: 'delivered', created_at: '2026-10-13T01:00:00Z', delivered_at: '2026-10-14T03:00:00Z'}} />)
  expect(html).toContain('Booked ')
  expect(html).toMatch(/13 Oct 2026.*06:30 am IST/i)
  expect(html).toContain('Delivered ')
  expect(html).toMatch(/14 Oct 2026.*08:30 am IST/i)
})
it('never replaces an absent cancellation time with placement', () => {
  const html = renderToStaticMarkup(<BookingTimes booking={{status: 'cancelled', created_at: '2026-10-13T01:00:00Z'}} />)
  expect(html).toContain('Cancelled Time unavailable')
})
