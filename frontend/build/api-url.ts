/** Production bundles must contain an explicit HTTPS backend API URL. */
export function validateApiBaseUrl(value: string | undefined): string {
  const fail = () => { throw new Error('VITE_API_BASE_URL must be an explicit HTTPS backend URL ending in /api; local addresses, credentials, queries and fragments are forbidden.') }
  if (!value?.trim()) return fail()
  let url: URL
  try { url = new URL(value.trim()) } catch { return fail() }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const local = host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  if (url.protocol !== 'https:' || local || url.username || url.password || url.search || url.hash ||
      url.pathname.replace(/\/+$/, '') !== '/api') return fail()
  return `${url.origin}/api`
}
