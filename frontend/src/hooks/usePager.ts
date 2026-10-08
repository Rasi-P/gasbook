import { useMemo, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 10;

/**
 * Client-side paging over an already-loaded list. Resets to page 1 when `resetKey` (the active
 * search/filter) changes; a shrinking list (e.g. a deleted row) is clamped to the last page instead.
 */
export function usePager<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE, resetKey: unknown = null) {
  const [page, setPage] = useState(1);
  const resetToken = String(resetKey);
  const [seenToken, setSeenToken] = useState(resetToken);
  // Adjust state during render (no effect) when the filter changes.
  if (seenToken !== resetToken) {
    setSeenToken(resetToken);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  return { page: safePage, pageCount, pageItems, setPage, total: items.length };
}
