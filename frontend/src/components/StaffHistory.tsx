import { PricingBreakdown, type PricingSnapshot } from './PricingBreakdown';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, History } from 'lucide-react';
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

/** A consistent compact overview; saved line amounts stay available without crowding the list. */
export function StaffHistoryCard({ reference, badge, times, customer, summary, amountLabel, amount, details }: {
  reference: string; badge: ReactNode; times: ReactNode; customer: string; summary: string;
  amountLabel: string; amount: ReactNode; details: ReactNode;
}) {
  return <Card padding="sm" className="sa-history-card">
    <div className="sa-order__top sa-history-card__heading">
      <strong className="sa-order__ref">{reference}</strong>{badge}
    </div>
    <div className="sa-history-card__times">{times}</div>
    <div className="sa-history-card__customer" title={customer}>Customer: <strong>{customer || 'Not recorded'}</strong></div>
    <div className="sa-history-card__summary" title={summary}>{summary}</div>
    <div className="sa-amount-row sa-amount-row--footer">
      <span className="sa-amount-row__label">{amountLabel}</span><strong>{amount}</strong>
    </div>
    <details className="sa-history-card__details">
      <summary><span>View items &amp; pricing</span><ChevronDown size={16} /></summary>
      <div className="sa-history-card__breakdown">{details}</div>
    </details>
  </Card>;
}

export function StaffDirectSaleCard({ sale }: { sale: StaffDirectSale }) {
  const items = sale.items.filter(item => item.quantity > 0 || Number(item.total_amount) > 0);
  return <StaffHistoryCard
    reference={`Direct Sale #${sale.id}`}
    badge={<Badge tone={sale.status === 'cancelled' ? 'danger' : 'success'}>
        {sale.status === 'cancelled' ? 'Cancelled' : 'Sale completed'}
      </Badge>}
    times={<span className="event-times">
      <span>Recorded {formatDateTime(sale.created_at)}</span>
      {sale.status === 'cancelled' && <span>Cancelled {formatDateTime(sale.cancelled_at)}</span>}
    </span>}
    customer={sale.customer_name}
    summary={items.map(item => `${item.cylinder_type_name} (${item.quantity} qty)`).join(' · ')}
    amountLabel={sale.status === 'cancelled' ? 'Original sale amount' : 'Sale amount'}
    amount={`₹${Number(sale.total_amount).toLocaleString('en-IN')}`}
    details={items.map(item => <section key={item.id} className="sa-history-card__item">
      <div className="sa-history-card__item-heading"><span>{item.cylinder_type_name} ({item.quantity} qty)</span><strong>₹{Number(item.total_amount).toLocaleString('en-IN')}</strong></div>
      <PricingBreakdown value={item} />
    </section>)}
  />;
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
