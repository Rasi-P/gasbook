import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/Button';

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
      <Button
        type="button"
        variant="secondary"
        size="sm"
        icon={<ChevronLeft size={14} />}
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        Prev
      </Button>
      <span className="pager-label">
        Page {page} of {pageCount}
        {typeof total === 'number' ? <small> · {total} total</small> : null}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconRight={<ChevronRight size={14} />}
        disabled={page >= pageCount}
        onClick={() => onChange(Math.min(pageCount, page + 1))}
      >
        Next
      </Button>
    </nav>
  );
}
