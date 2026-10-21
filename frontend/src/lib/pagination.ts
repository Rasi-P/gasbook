/** Complete DRF lists only; never send a response-supplied URL to an authenticated client. */
export async function collectPages<T extends { id: number }>(endpoint: URL, read: (query: string) => Promise<unknown>, limit = 250): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<number>();
  let count: number | undefined;
  const base = new URL(endpoint); base.searchParams.delete('page');
  const invalid = () => new Error('The catalog is incomplete or changed while loading. Please reload.');
  for (let page = 1; page <= limit; page++) {
    const query = new URLSearchParams(base.search); query.set('page', String(page));
    const data = await read(query.toString());
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
    const envelope = data as { count: unknown; results: unknown; next: unknown };
    if (!Number.isSafeInteger(envelope.count) || Number(envelope.count) < 0 || !Array.isArray(envelope.results)) throw invalid();
    if (count === undefined) count = Number(envelope.count);
    if (envelope.count !== count) throw invalid();
    for (const row of envelope.results) {
      if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw invalid();
      ids.add(row.id); rows.push(row as T);
    }
    if (rows.length > count) throw invalid();
    if (envelope.next === null) {
      if (rows.length !== count || (page > 1 && !envelope.results.length)) throw invalid();
      return rows;
    }
    if (typeof envelope.next !== 'string' || !envelope.results.length || rows.length >= count) throw invalid();
    let next: URL;
    try { next = new URL(envelope.next, endpoint); } catch { throw invalid(); }
    if (next.origin !== endpoint.origin || next.pathname !== endpoint.pathname || next.username || next.password || next.hash) throw invalid();
    const expected = new URLSearchParams(base.search); expected.set('page', String(page + 1));
    const actual = new URLSearchParams(next.search); expected.sort(); actual.sort();
    if (actual.toString() !== expected.toString()) throw invalid();
  }
  throw invalid();
}
