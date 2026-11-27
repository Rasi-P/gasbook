import { privateMediaUrl } from '../lib/mediaUrl';
import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { api } from '../lib/api';

/** Staff bytes use authenticated fetch; tokens never appear in image URLs. */
export function MediaImage({ src, alt = '', ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  let privateUrl: string | null = null;
  let invalid = false;
  try { privateUrl = src ? privateMediaUrl(src, api.defaults.baseURL!) : null; } catch { invalid = true; }
  useEffect(() => {
    if (!privateUrl || !src) return;
    let live = true; let blobUrl = '';
    api.get(privateUrl, { responseType: 'blob' }).then(({ data }) => {
      if (live) { blobUrl = URL.createObjectURL(data); setResolved({ source: src, url: blobUrl }); setFailed(null); }
    }).catch(() => { if (live) setFailed(src); });
    return () => { live = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [privateUrl, src, attempt]);
  if (!src || invalid || failed === src) return <span className={props.className} role="img" aria-label={alt || 'Image unavailable'}>Image unavailable{src && !invalid && <button type="button" onClick={() => { setFailed(null); setResolved(null); setAttempt(n => n + 1); }}>Retry image</button>}</span>;
  const url = privateUrl ? (resolved?.source === src ? resolved.url : undefined) : src;
  return url ? <img {...props} src={url} alt={alt} onError={() => setFailed(src)} /> : <span className={props.className} role="status">Loading image…</span>;
}
