/** Event timestamps use the business timezone, independent of the device timezone. */
const eventDateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true,
})

export function formatDateTime(value?: string | null): string {
  // A date-only or offset-less value cannot identify an event instant reliably.
  if (!value || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return 'Time unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Time unavailable'
  return `${eventDateTime.format(date)} IST`
}
