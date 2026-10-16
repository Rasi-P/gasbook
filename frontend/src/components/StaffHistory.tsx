import { PaymentSummary, type PaymentFacts } from './PaymentSummary';
import { BookingDetailItems } from './BookingDetailItems';
import type { BookingItem } from './BookingItems';
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
  payment_summary?: PaymentFacts | null;
  accessory_items?: BookingItem[];
  id: number;
  customer_name: string;
  total_amount: string;
  status: 'completed' | 'cancelled';
  created_at: string;
  cancelled_at: string | null;
  items: (PricingSnapshot & { id: number; cylinder_type_name: string; quantity: number; rate?: string | number; total_amount: string })[];
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

export function StaffDirectSaleCard({ sale, onCollected }: { sale: StaffDirectSale; onCollected?: () => void }) {
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
    summary={[...items.map(item => `${item.cylinder_type_name} (${item.quantity} qty)`), ...(sale.accessory_items || []).map(item=>`${item.name} (${item.quantity} qty)`)].join(' · ')}
    amountLabel={sale.status === 'cancelled' ? 'Original sale amount' : 'Sale amount'}
    amount={`₹${Number(sale.total_amount).toLocaleString('en-IN')}`}
    details={<><PaymentSummary value={sale.payment_summary} allowCollection onCollected={onCollected} />{sale.accessory_items?.length ? <BookingDetailItems items={sale.accessory_items} /> : null}<div className="bk-detail-items">{items.map(item => <article key={item.id} className="bk-detail-item">
      <div className="bk-detail-item-row">
        <div>
          <strong>{item.cylinder_type_name}</strong>
          <span className="bk-detail-muted">{item.rate_type === 'new' ? 'New cylinder' : item.rate_type === 'refill' ? 'Refill' : 'Cylinder'}</span>
          <span className="bk-detail-muted">Qty {item.quantity}{item.rate != null && ` × ₹${Number(item.rate).toLocaleString('en-IN')} each`}</span>
        </div>
        <strong className="bk-detail-item-amount">₹{Number(item.total_amount).toLocaleString('en-IN')}</strong>
      </div>
      {item.rate_type && item.deposit_unit_amount != null && item.refill_unit_amount != null && <details className="bk-detail-breakdown">
        <summary>{item.rate_type === 'new' ? 'Deposit & refill breakdown' : 'Refill breakdown'}</summary>
        <PricingBreakdown value={item} />
      </details>}
    </article>)}</div></>}
  />;
}

/** Preserve server order: both sources are sorted together before server pagination. */
export function StaffHistoryRows<T>({ entries, renderDelivery, onCollected }: {
  onCollected?: () => void;
  entries: StaffHistoryEntry<T>[];
  renderDelivery: (delivery: T) => ReactNode;
}) {
  return <div className="sa-list">
    {entries.map(entry => <Fragment key={`${entry.history_source}-${entry.source_id}`}>
      {entry.history_source === 'sale' ? <StaffDirectSaleCard sale={entry.sale} onCollected={onCollected} /> : renderDelivery(entry.delivery)}
    </Fragment>)}
  </div>;
}

const PAGE_SIZE = 10;

export function StaffHistory<T>({ renderDelivery, onCollected }: { renderDelivery: (delivery: T) => ReactNode; onCollected?: () => void }) {
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
      <StaffHistoryRows entries={current.data.results} renderDelivery={renderDelivery} onCollected={() => {setRevision(v=>v+1);onCollected?.();}} />
      {current.data.count === 0 && <Card><EmptyState compact icon={<History size={24} />} title="No sales or completed deliveries yet." /></Card>}
      <Pager page={page} pageCount={Math.ceil(current.data.count / PAGE_SIZE)} total={current.data.count} onChange={setPage} />
    </>}
  </section>;
}
