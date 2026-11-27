export function privateMediaUrl(src: string, base: string): string | null {
  const origin = new URL(base);
  const url = new URL(src, origin);
  if (!url.pathname.startsWith('/media/staff-images/')) return null;
  if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash) throw new Error('Invalid staff image URL');
  return url.href;
}

