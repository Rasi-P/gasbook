import { PricingBreakdown, type PricingSnapshot } from './PricingBreakdown';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { History } from 'lucide-react';
import { api, extractApiError, type Paginated } from '../lib/api';
import { formatDateTime } from '../lib/dateTime';
import { LoadingState } from './AsyncState';
import { Pager } from './Pager';
import { Alert } from './ui/Alert';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

export type StaffDirectSale = {
  id: number;
  customer_name: string;
  total_amount: string;
  status: 'completed' | 'cancelled';
  created_at: string;
  cancelled_at: string | null;
  items: (PricingSnapshot & { id: number; cylinder_type_name: string; quantity: number; total_amount: string })[];
};

export type StaffHistoryEntry<T> = {
  source_id: number;
  occurred_at: string | null;
} & ({ history_source: 'sale'; sale: StaffDirectSale } | { history_source: 'delivery'; delivery: T });

export function StaffDirectSaleCard({ sale }: { sale: StaffDirectSale }) {
  return <Card padding="sm" className="sa-list-card">
    <div className="sa-order__top">
      <strong className="sa-order__ref">Direct Sale #{sale.id}</strong>
      <Badge tone={sale.status === 'cancelled' ? 'danger' : 'success'}>
        {sale.status === 'cancelled' ? 'Cancelled' : 'Sale completed'}
      </Badge>
    </div>
    <span className="event-times">
      <span>Recorded {formatDateTime(sale.created_at)}</span>
      {sale.status === 'cancelled' && <span>Cancelled {formatDateTime(sale.cancelled_at)}</span>}
    </span>
    {sale.items.filter(item => item.quantity > 0 || Number(item.total_amount) > 0).map(item => (
      <div key={item.id} className="sa-list-card__text">{item.cylinder_type_name} ({item.quantity} qty)<PricingBreakdown value={item} /></div>
    ))}
    <div className="sa-muted">{sale.customer_name}</div>
    <div className="sa-amount-row sa-amount-row--footer">
      <span className="sa-amount-row__label">Sale amount:</span>
      <strong>₹{Number(sale.total_amount).toLocaleString('en-IN')}</strong>
    </div>
  </Card>;
}

/** Preserve server order: both sources are sorted together before server pagination. */
export function StaffHistoryRows<T>({ entries, renderDelivery }: {
  entries: StaffHistoryEntry<T>[];
  renderDelivery: (delivery: T) => ReactNode;
}) {
  return <div className="sa-list">
    {entries.map(entry => <Fragment key={`${entry.history_source}-${entry.source_id}`}>
      {entry.history_source === 'sale' ? <StaffDirectSaleCard sale={entry.sale} /> : renderDelivery(entry.delivery)}
    </Fragment>)}
  </div>;
}

const PAGE_SIZE = 10;

export function StaffHistory<T>({ renderDelivery }: { renderDelivery: (delivery: T) => ReactNode }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const queryKey = `${page}:${revision}`;
  const [result, setResult] = useState<{
    key: string; data?: Paginated<StaffHistoryEntry<T>>; error?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Paginated<StaffHistoryEntry<T>>>('/deliveries/history/', { params: { page, page_size: PAGE_SIZE } })
      .then(({ data }) => { if (!cancelled) setResult({ key: queryKey, data }); })
      .catch(err => {
        if (!cancelled) setResult({ key: queryKey, error: extractApiError(err, [], 'Could not load history.') });
      });
    return () => { cancelled = true; };
  }, [page, queryKey]);

  const current = result?.key === queryKey ? result : null;
  return <section className="sa-stack sa-stack--tight">
    <h3 className="sa-page-title">Sales &amp; Delivery History</h3>
    {!current && <LoadingState label="Loading history…" />}
    {current?.error && <Alert tone="danger">
      {current.error} <Button size="sm" variant="secondary" onClick={() => setRevision(value => value + 1)}>Retry</Button>
    </Alert>}
    {current?.data && <>
      <StaffHistoryRows entries={current.data.results} renderDelivery={renderDelivery} />
      {current.data.count === 0 && <Card><EmptyState compact icon={<History size={24} />} title="No sales or completed deliveries yet." /></Card>}
      <Pager page={page} pageCount={Math.ceil(current.data.count / PAGE_SIZE)} total={current.data.count} onChange={setPage} />
    </>}
  </section>;
}
