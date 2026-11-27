import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ArrowLeft, AtSign, Ban, CircleCheck, IndianRupee, Mail, MapPin, Phone, Receipt } from 'lucide-react';
import { api, extractApiError, type Paginated } from '../../lib/api';
import { formatDateTime } from '../../lib/dateTime';
import { ErrorState } from '../../components/AsyncState';
import { Pager } from '../../components/Pager';
import { SaleItemsCell } from '../../components/SaleItemsCell';
import { VoidStatusBadges, type SaleVoidInfo } from '../../components/SaleVoidDialogs';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardFooter, CardHeader } from '../../components/ui/Card';
import { ChoiceChips } from '../../components/ui/ChoiceChips';
import { Field, Input } from '../../components/ui/Field';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchInput } from '../../components/ui/SearchInput';
import { SkeletonRows, SkeletonStatGrid } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';
import { DEFAULT_PAGE_SIZE } from '../../hooks/usePager';
import type { HistoryStaff } from './StaffHistory';

type SaleRow = {
  id: number; created_at: string; customer_name: string;
  sold_by_full_name: string; sold_by_name: string; handover_staff_name: string | null;
  items: ComponentProps<typeof SaleItemsCell>['items'];
  total_amount: string; paid_amount: string; balance_due: string; payment_mode: string;
  void: SaleVoidInfo | null;
};
type HistoryResponse = Paginated<SaleRow> & {
  summary: { total: number; completed: number; cancelled: number; sales_amount: string };
};
const money = (value: string) => `Rs. ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paymentLabels: Record<string, string> = { cash: 'Cash', gpay: 'GPay', bank: 'Bank', credit: 'Credit', split: 'Split' };

/** Admin-only profile history. Handover is involvement in a sale, not payment collection. */
export default function AdminSalesHistory({ user, onBack }: { user: HistoryStaff; onBack: () => void }) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const invalidRange = Boolean(start && end && start > end);
  const params = useMemo(() => ({ involved_user: user.id, source: 'direct', search, start, end, void_status: status, page, page_size: DEFAULT_PAGE_SIZE }), [user.id, search, start, end, status, page]);
  const requestKey = `${JSON.stringify(params)}|${reload}`;
  const loading = loadedKey !== requestKey;
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (invalidRange) return;
    let cancelled = false;
    api.get<HistoryResponse>('/sales/', { params }).then(({ data: result }) => {
      if (!cancelled) { setData(result); setError(''); setLoadedKey(requestKey); }
    }).catch((err) => {
      if (!cancelled) { setError(extractApiError(err, [], 'Could not load sales history.')); setLoadedKey(requestKey); }
    });
    return () => { cancelled = true; };
  }, [params, requestKey, invalidRange]);
  const name = `${user.first_name} ${user.last_name}`.trim() || user.username;
  const ready = !loading && !error && !invalidRange && data;
  function clearFilters() { setSearchInput(''); setSearch(''); setStart(''); setEnd(''); setStatus(''); setPage(1); }

  return <div className="sh admin-sales-history">
    <PageHeader className="sh-header"
      leading={<IconButton label="Back to staff and users" variant="outline" onClick={onBack}><ArrowLeft size={20} /></IconButton>}
      title={<span className="sh-title"><span className="staff-avatar staff-avatar--initial" aria-hidden="true">{name.charAt(0).toUpperCase()}</span><span className="sh-name">{name}</span></span>}
      meta={<><span><AtSign size={14} /> {user.username}</span>{user.phone && <span><Phone size={14} /> {user.phone}</span>}{user.email && <span><Mail size={14} /> {user.email}</span>}{user.address && <span><MapPin size={14} /> {user.address}</span>}</>}
      actions={<><Badge tone="primary" variant="outline">ADMIN</Badge><Badge tone={user.is_active === false ? 'neutral' : 'success'}>{user.is_active === false ? 'Inactive' : 'Active'}</Badge></>}
    />
    {loading && !invalidRange && <div className="sh-stats-skeleton"><SkeletonStatGrid label="Loading sales summary" /></div>}
    {ready && <section className="sh-stats admin-sales-history__stats" aria-label="Sales summary">
      <StatCard label="Direct sales" value={data.summary.total} hint="Recorded or handed over" icon={<Receipt size={18} />} />
      <StatCard label="Completed" value={data.summary.completed} hint="Excludes cancelled sales" icon={<CircleCheck size={18} />} />
      <StatCard label="Cancelled" value={data.summary.cancelled} hint="Includes refunds and credits" icon={<Ban size={18} />} />
      <StatCard label="Sales amount" value={money(data.summary.sales_amount)} hint="Sale totals, excluding cancelled" icon={<IndianRupee size={18} />} />
    </section>}
    <Card className="sh-filters">
      <div className="sh-filters__row">
        <Field label="Search" className="sh-filters__search"><SearchInput value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Sale ID, customer name or phone" /></Field>
        <Field label="Recorded from" className="sh-filters__date"><Input type="date" value={start} onChange={(e) => { setStart(e.target.value); setPage(1); }} /></Field>
        <Field label="Recorded to" className="sh-filters__date"><Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1); }} /></Field>
        {(searchInput || start || end || status) && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
      </div>
      <ChoiceChips ariaLabel="Sale status" value={status} options={[{ value: '', label: 'All' }, { value: 'active', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'refund_pending', label: 'Refund pending' }]} onChange={(v) => { setStatus(v); setPage(1); }} />
      <p className="muted">Summary and history follow these filters. Dates use IST.</p>
      {invalidRange && <Alert tone="danger" role="alert">The end date must be on or after the start date.</Alert>}
    </Card>
    {!loading && error && !invalidRange && <ErrorState message={error} onRetry={() => setReload((v) => v + 1)} />}
    <Card padding="none">
      <CardHeader title="Direct Sale History" description="Sales recorded by this admin or handed over by them. Payment collection alone does not add a sale here." meta={ready ? <Badge>{data.count} sales</Badge> : undefined} />
      {loading && !invalidRange && <SkeletonRows label="Loading sales history" />}
      {ready && (data.results.length ? <TableWrap><Table cards className="sh-table">
        <thead><tr><Th>Sale</Th><Th>Customer & items</Th><Th>Recorded / handed over</Th><Th>Payment</Th><Th>Status</Th></tr></thead>
        <tbody>{data.results.map((sale) => <tr key={sale.id}>
          <Td label="Sale"><strong>Direct Sale #{sale.id}</strong><div className="muted">Recorded {formatDateTime(sale.created_at)}</div></Td>
          <Td label="Customer & items"><strong>{sale.customer_name || 'Walk-in customer'}</strong><details className="admin-sales-history__items"><summary>Items & pricing</summary><SaleItemsCell customerName={sale.customer_name} items={sale.items} /></details></Td>
          <Td label="Recorded / handed over"><div>Recorded: {sale.sold_by_full_name || sale.sold_by_name}</div><div className="muted">Handed over: {sale.handover_staff_name || 'Not specified'}</div></Td>
          <Td label="Payment"><strong>{money(sale.total_amount)}</strong><div>{paymentLabels[sale.payment_mode] || sale.payment_mode}</div>{sale.void ? <div className="muted">Paid before cancellation: {money(sale.void.paid_amount)}</div> : <><Badge tone={Number(sale.balance_due) === 0 ? 'success' : 'warning'}>{Number(sale.balance_due) === 0 ? 'Paid' : Number(sale.paid_amount) > 0 ? 'Part paid' : 'Unpaid'}</Badge><div className="muted">Paid: {money(sale.paid_amount)}</div><div className="muted">Balance: {money(sale.balance_due)}</div></>}</Td>
          <Td label="Status">{sale.void ? <><VoidStatusBadges saleVoid={sale.void} /><div className="muted">Cancelled {formatDateTime(sale.void.voided_at)}</div>{sale.void.refund && <div className="muted">Refunded {formatDateTime(sale.void.refund.confirmed_at)}</div>}</> : <Badge tone="success">Sale completed</Badge>}</Td>
        </tr>)}</tbody>
      </Table></TableWrap> : <p className="admin-sales-history__empty">No direct sales match this admin and these filters.</p>)}
      {ready && <CardFooter><Pager page={page} pageCount={Math.max(1, Math.ceil(data.count / DEFAULT_PAGE_SIZE))} onChange={setPage} total={data.count} /></CardFooter>}
    </Card>
  </div>;
}
