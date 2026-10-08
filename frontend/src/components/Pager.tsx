export function Pager({
  page,
  pageCount,
  onChange,
  total,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  total?: number;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <button
        type="button"
        className="btn btn-compact"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        Prev
      </button>
      <span className="pager-label">
        Page {page} of {pageCount}
        {typeof total === 'number' ? <small> · {total} total</small> : null}
      </span>
      <button
        type="button"
        className="btn btn-compact"
        disabled={page >= pageCount}
        onClick={() => onChange(Math.min(pageCount, page + 1))}
      >
        Next
      </button>
    </nav>
  );
}
