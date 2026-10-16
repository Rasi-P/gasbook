import { formatDateTime } from '../../lib/dateTime';
import { useEffect, useState } from 'react';
import {
  IndianRupee, WalletCards, XCircle,
  AlertTriangle, Package, Boxes, CheckCircle2, Receipt, Truck, Users,
} from 'lucide-react';
import { api, extractApiError, fetchAllPages } from '../../lib/api';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { FilledEmpty } from '../../components/FilledEmpty';
import { SaleItemsCell } from '../../components/SaleItemsCell';
import { VoidStatusBadges, type SaleVoidInfo } from '../../components/SaleVoidDialogs';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ChoiceChips } from '../../components/ui/ChoiceChips';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input, Select } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows, SkeletonStatGrid } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';

type SaleItem = { cylinder_type_name: string; quantity: number; rate: number };
type Sale = {
  id: number; created_at: string; customer_name: string; sold_by_name: string;
  sold_by_full_name: string; handover_staff_name: string | null; void?: SaleVoidInfo | null;
  total_amount: number; paid_amount: number; balance_due: number;
  accessory_items?: import('../../components/BookingItems').BookingItem[];
  payment_mode: string; location_name: string; items: SaleItem[];
  payments?: { amount: number; mode: string; date: string }[];
};
type Expense = {
  id: number; created_at: string; category: string;
  amount: number; note: string; spent_by_name: string;
};
type Movement = {
  id: number; cylinder_type_name: string; quantity: number; status: string;
  from_location_name: string; to_location_name: string;
  moved_by_name: string; created_at: string;
};
type PendingDue = {
  customer__user__first_name: string; customer__user__last_name: string; customer__user__phone: string;
  total_due: number; sale_count: number;
};
type CylinderSale = { cylinder_type__name: string; sale__location__name?: string; total_qty: number; total_amount: number };
type StaffTotal = { user_id: number | null; name: string | null; username: string | null; role: string | null; count: number; amount: number | string };
type Location = { id: number; name: string; code: string; is_main_supplier: boolean };
type StockRow = {
  type: string; shop_filled: number; shop_empty: number;
  kandam_filled: number; kandam_empty: number;
  with_customers: number; customer_credits: number;
  supplier_stock: number; physical_stock: number; total: number;
};
type LoadRow = { cylinder_type__name: string; to_location__name: string; total_qty: number };
type Cancellation = {
  sale_id: number; customer_name: string | null; location_name: string; sale_date: string; voided_at: string;
  voided_by_name: string | null; reason: string; total_amount: string; outcome: 'none' | 'refund' | 'credit';
  refund_due: string; refunded: boolean; refunded_at?: string | null;
};
type ReportsData = {
  range: { start: string; end: string };
  // sales: gross by sale date; cancelled: by void date; net_sales = sales - cancelled.
  summary: {
    sales: number; cancelled: number; net_sales: number; collection: number; refunds_paid: number; refunds_owed: number;
    expenses: number; movements: number; pending: number;
  };
  monthly: { sales: number; cancelled: number; net_sales: number; collection: number; expenses: number };
  cancellation_list: Cancellation[];
  cylinder_sales: CylinderSale[];
  staff_breakdown: { recorded_by: StaffTotal[]; handed_over_by: StaffTotal[]; collections_by_receiver: StaffTotal[] };
  pending_dues: PendingDue[];
  sales_list: Sale[];
  expense_list: Expense[];
  stock_snapshot: StockRow[];
  load_summary: LoadRow[];
  movement_history: Movement[];
  supplier_balance?: { type: string; pending: number }[];
  expense_breakdown: { category: string; total: number }[];
};

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

type Tab = 'summary' | 'stock' | 'sales' | 'pending';

function toLocalISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function today() { return toLocalISO(new Date()); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1); return toLocalISO(d);
}

export default function Reports() {
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('summary');
  const [locations, setLocations] = useState<Location[]>([]);
  const [location, setLocation] = useState('');

  // ISO yyyy-mm-dd strings compare lexicographically.
  const rangeError = start && end && start > end ? 'From date must be on or before To date.' : '';

  function fetchData(s: string, e: string, loc = location) {
    if (!s || !e || s > e) return;
    setLoading(true);
    setError('');
    api.get('/reports/', { params: { start: s, end: e, ...(loc ? { location: loc } : {}) } })
      .then((r) => setData(r.data as ReportsData))
      .catch((err) => {
        setError(extractApiError(err, [], 'Could not load report.'));
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(start, end); }, []);

  // The location filter is optional; without the list the report still covers every location.
  useEffect(() => {
    fetchAllPages<Location>('/locations/')
      .then((rows) => setLocations(rows.filter((l) => !l.is_main_supplier && l.code !== 'supplier')))
      .catch(() => setLocations([]));
  }, []);

  function applyRange(s: string, e: string) {
    setStart(s); setEnd(e); fetchData(s, e);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'stock', label: 'Stock' },
    { key: 'sales', label: 'Sales' },
    { key: 'pending', label: 'Pending' },
  ];

  const quickRanges = [
    { label: 'Today', s: today(), e: today() },
    { label: 'Yesterday', s: yesterday(), e: yesterday() },
    { label: 'This Month', s: monthStart(), e: today() },
  ];
  const activeRange = quickRanges.find((r) => start === r.s && end === r.e)?.label ?? null;

  return (
    <div>
      <PageHeader title="Reports" description="Full business flow — load, stock, sales, collections, pending." />

      {/* Date range */}
      <Card className="rp-range">
        <div className="rp-range__row">
          <Field label="From" className="rp-range__field">
            <Input type="date" value={start} max={end || undefined} aria-invalid={Boolean(rangeError)} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To" className="rp-range__field">
            <Input type="date" value={end} min={start || undefined} aria-invalid={Boolean(rangeError)} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Button
            type="button"
            className="rp-range__go"
            disabled={Boolean(rangeError) || loading || !start || !end}
            onClick={() => fetchData(start, end)}
          >
            Go
          </Button>
        </div>
        {locations.length > 0 && (
          <Field label="Location" className="rp-range__field" hint={location ? 'Filters gross sales, cancellations and net sales in this range. Collections, refunds, expenses, stock, pending dues and This Month cover every location.' : undefined}>
            <Select value={location} onChange={(e) => { setLocation(e.target.value); fetchData(start, end, e.target.value); }}>
              <option value="">All locations</option>
              {locations.map((l) => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
            </Select>
          </Field>
        )}
        {rangeError && <Alert tone="danger" role="alert" compact className="rp-range__error">{rangeError}</Alert>}
        <ChoiceChips
          ariaLabel="Quick ranges"
          size="sm"
          className="rp-range__chips"
          value={activeRange}
          onChange={(label) => {
            const r = quickRanges.find((x) => x.label === label);
            if (r) applyRange(r.s, r.e);
          }}
          options={quickRanges.map((r) => ({ value: r.label, label: r.label }))}
        />
      </Card>

      {loading && !data && (
        <div aria-busy="true">
          <div className="rp-section"><SkeletonStatGrid count={3} label="Loading report" /></div>
          <Card padding="none"><div className="ui-card__skeleton"><SkeletonRows rows={4} columns={4} /></div></Card>
        </div>
      )}
      {loading && data && <LoadingState label="Loading…" />}

      {!loading && error && (
        <ErrorState message={error} onRetry={() => fetchData(start, end)} />
      )}

      {data && (
        <>
          {/* Tab switcher */}
          <Tabs
            ariaLabel="Report sections"
            variant="tabs"
            className="page-tabs"
            value={tab}
            onChange={setTab}
            items={tabs.map((t) => ({ value: t.key, label: t.label }))}
          />

          {/* SUMMARY TAB */}
          {tab === 'summary' && (
            <>
              <section className="rp-stats">
                <StatCard label="Gross sales" value={money(data.summary.sales)} hint="Sales made in this range" icon={<IndianRupee />} />
                <StatCard label="Cancelled" value={money(data.summary.cancelled)} hint="Sales cancelled in this range" icon={<XCircle />} />
                <StatCard label="Net sales" value={money(data.summary.net_sales)} hint="Gross sales minus cancelled" icon={<IndianRupee />} />
                <StatCard label="Collection" value={money(data.summary.collection)} hint="Money in, less refunds paid" icon={<WalletCards />} />
                <StatCard label="Pending Dues" value={money(data.summary.pending)} icon={<AlertTriangle />} />
              </section>

              <Card className="rp-section">
                <CardHeader title="Refunds" description="A refund owed is not yet paid out; it reaches the collection only when it is confirmed." />
                <div className="ui-tiles">
                  <div className="ui-tile"><span className="ui-tile__label">Refunds owed (now)</span><strong className="ui-tile__value">{money(data.summary.refunds_owed)}</strong></div>
                  <div className="ui-tile"><span className="ui-tile__label">Refunds paid (this range)</span><strong className="ui-tile__value">{money(data.summary.refunds_paid)}</strong></div>
                </div>
              </Card>

              {data.cylinder_sales.length > 0 && (
                <Card padding="none" className="rp-section">
                  <CardHeader title="Cylinder-wise Sales" description="Gross: includes sales cancelled later." meta={<Package size={18} className="ui-card-icon" aria-hidden="true" />} />
                  <CylinderSalesTable rows={data.cylinder_sales} />
                </Card>
              )}

              <Card padding="none" className="rp-section">
                <CardHeader
                  title="By Person"
                  description="Three separate views. Recorded by and Handed over by add up to gross sales (cancelled sales included); Collections by receiver adds up to the collection (refunds paid out and credit moves included); never add them together."
                  meta={<Users size={18} className="ui-card-icon" aria-hidden="true" />}
                />
                <StaffTotalsTable heading="Recorded by" unit="Sales" rows={data.staff_breakdown.recorded_by} />
                <StaffTotalsTable heading="Handed over by" unit="Sales" rows={data.staff_breakdown.handed_over_by} />
                <StaffTotalsTable heading="Collections by receiver" unit="Entries" rows={data.staff_breakdown.collections_by_receiver} />
              </Card>

              <Card className="rp-section">
                <CardHeader title="This Month" />
                <div className="ui-tiles">
                  <div className="ui-tile"><span className="ui-tile__label">Gross sales</span><strong className="ui-tile__value">{money(data.monthly.sales)}</strong></div>
                  <div className="ui-tile"><span className="ui-tile__label">Net sales</span><strong className="ui-tile__value">{money(data.monthly.net_sales)}</strong></div>
                  <div className="ui-tile"><span className="ui-tile__label">Collection</span><strong className="ui-tile__value">{money(data.monthly.collection)}</strong></div>
                </div>
              </Card>
            </>
          )}

          {/* STOCK TAB — full flow */}
          {tab === 'stock' && (
            <div className="rp-stack">
              {/* Loads received in range */}
              <Card padding="none">
                <CardHeader title="New Cylinders Purchased (Loads)" meta={<Badge variant="outline">Supplier → Location</Badge>} />
                {data.load_summary.length === 0
                  ? <EmptyState compact icon={<Truck size={24} />} title="No loads in this range." />
                  : (() => {
                      const loadGroups = data.load_summary.reduce((acc, curr) => {
                        const cyl = curr.cylinder_type__name;
                        if (!acc[cyl]) acc[cyl] = { total: 0 };
                        acc[cyl][curr.to_location__name] = (acc[cyl][curr.to_location__name] || 0) + curr.total_qty;
                        acc[cyl].total += curr.total_qty;
                        return acc;
                      }, {} as Record<string, any>);
                      const locs = Array.from(new Set(data.load_summary.map(l => l.to_location__name))).sort();

                      return (
                        <TableWrap fade>
                          <Table stickyFirst className="rp-table">
                            <thead>
                              <tr>
                                <Th>Cylinder</Th>
                                {locs.map((loc) => (
                                  <Th key={loc} align="right">{loc}</Th>
                                ))}
                                <Th align="right">Total Added</Th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(loadGroups).sort(([cylA], [cylB]) => parseFloat(cylA) - parseFloat(cylB)).map(([cyl, locData]) => (
                                <tr key={cyl}>
                                  <Td><strong>{cyl}</strong></Td>
                                  {locs.map((loc) => (
                                    <Td key={loc} numeric>
                                      {locData[loc] ? <span className="ui-num-strong">{locData[loc]}</span> : <span className="ui-num-placeholder">-</span>}
                                    </Td>
                                  ))}
                                  <Td numeric>
                                    <Badge tone="success">+{locData.total}</Badge>
                                  </Td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </TableWrap>
                      );
                  })()
                }
              </Card>

              {/* Supplier Balance */}
              <Card padding="none" className="ui-list">
                <CardHeader title="Supplier Balance (All Time)" meta={<Badge variant="outline">Pending to Receive</Badge>} />
                {(data as any).supplier_balance && (data as any).supplier_balance.length === 0
                  ? <EmptyState compact title="No supplier records found." />
                  : (
                    <div>
                      {data.supplier_balance && [...data.supplier_balance].sort((a: any, b: any) => parseFloat(a.type) - parseFloat(b.type)).map((b: any, i: number) => (
                        <div key={i} className="ui-list-row">
                          <div className="ui-list-row__main">
                            <span className="ui-list-row__name">{b.type}</span>
                          </div>
                          <div className="ui-list-row__actions">
                            <Badge tone={b.pending > 0 ? 'warning' : 'success'}>
                              {b.pending > 0 ? `${b.pending} Pending` : 'Settled'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </Card>

              {/* Current stock snapshot */}
              <Card padding="none">
                <CardHeader title="Current Stock Snapshot" meta={<Boxes size={18} className="ui-card-icon" aria-hidden="true" />} />
                <TableWrap fade>
                  <Table stickyFirst className="rp-table rp-table--wide">
                    <thead>
                      <tr>
                        <Th>Type</Th>
                        <Th align="center">Shop (F/E)</Th>
                        <Th align="center">Kandam (F/E)</Th>
                        <Th align="right">With Customers</Th>
                        <Th align="right">Extras From Customers</Th>
                        <Th align="right">Supplier Stock<span className="ui-cell-sub">(Base)</span></Th>
                        <Th align="right">Total Physical<span className="ui-cell-sub">(Shop + Kandam)</span></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.stock_snapshot].sort((a, b) => parseFloat(a.type) - parseFloat(b.type)).map((r) => (
                        <tr key={r.type}>
                          <Td><strong>{r.type}</strong></Td>
                          <Td align="center"><FilledEmpty filled={r.shop_filled} empty={r.shop_empty} /></Td>
                          <Td align="center"><FilledEmpty filled={r.kandam_filled} empty={r.kandam_empty} /></Td>
                          <Td numeric>
                            {r.with_customers > 0
                              ? <span className="ui-num-warning">{r.with_customers}</span>
                              : <span className="ui-num-placeholder">—</span>}
                          </Td>
                          <Td numeric>
                            {r.customer_credits > 0
                              ? <span className="ui-num-success">{r.customer_credits}</span>
                              : <span className="ui-num-placeholder">—</span>}
                          </Td>
                          <Td numeric>{r.supplier_stock}</Td>
                          <Td numeric><strong>{r.physical_stock}</strong></Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </Card>

              {/* Cylinder-wise sold in range */}
              {data.cylinder_sales.length > 0 && (
                <Card padding="none">
                  <CardHeader title="Sold in Range" description="Gross: includes sales cancelled later." meta={<Package size={18} className="ui-card-icon" aria-hidden="true" />} />
                  <CylinderSalesTable rows={data.cylinder_sales} />
                </Card>
              )}
            </div>
          )}

          {/* SALES TAB */}
          {tab === 'sales' && (
            <div className="rp-stack">
            <Card padding="none">
              {data.sales_list.length === 0 ? (
                <EmptyState icon={<Receipt size={24} />} title="No sales found in this range." />
              ) : (
              <TableWrap fade>
                <Table cards stickyFirst className="sales-history-table">
                  <thead>
                    <tr>
                      <Th>Customer</Th>
                      <Th>Items</Th>
                      <Th align="right">Total</Th>
                      <Th align="right">Balance</Th>
                      <Th>Mode</Th>
                      <Th>Recorded by</Th>
                      <Th>Handed over by</Th>
                      <Th>Date &amp; time</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales_list.map((sale) => {
                      const isReturn = (sale as any).note === 'Empty cylinders returned';
                      return (
                      <tr key={sale.id}>
                        <Td label="Customer"><strong className="sh-customer">{sale.customer_name || 'Walk-in'}</strong></Td>
                        <Td label="Items"><SaleItemsCell customerName={sale.customer_name} items={sale.items} accessoryItems={sale.accessory_items} /></Td>
                        <Td label="Total" numeric>
                          {isReturn ? <span className="ui-num-placeholder">-</span> : <span className="ui-num-strong">{money(sale.total_amount)}</span>}
                        </Td>
                        <Td label="Balance" align="right">
                          {sale.void ? <VoidStatusBadges saleVoid={sale.void} /> : isReturn ? <span className="ui-num-placeholder">-</span> : (
                            Number(sale.balance_due) > 0
                              ? <Badge tone="warning">{money(sale.balance_due)}</Badge>
                              : <Badge tone="success">Paid</Badge>
                          )}
                        </Td>
                        <Td label="Mode" className="sh-nowrap">
                          {isReturn ? (
                            <Badge variant="outline">Return</Badge>
                          ) : (
                            <div className="sh-mode">
                              <Badge variant="outline">{sale.payment_mode}</Badge>
                              {(sale.payment_mode === 'split' || sale.payment_mode === 'credit') && sale.payments && sale.payments.length > 0 && (
                                <span className="ui-cell-sub">
                                  {sale.payments.map(p => `${p.mode.toUpperCase()} ${p.amount}`).join(' + ')}
                                </span>
                              )}
                            </div>
                          )}
                        </Td>
                        <Td label="Recorded by" className="sh-meta">{sale.sold_by_full_name || sale.sold_by_name}</Td>
                        <Td label="Handed over by" className="sh-meta">{sale.handover_staff_name || <span className="ui-num-placeholder">—</span>}</Td>
                        <Td label="Date & time" className="sh-meta">
                          {formatDateTime(sale.created_at)}
                        </Td>
                      </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
              )}
            </Card>
            {data.cancellation_list.length > 0 && (
              <Card padding="none">
                <CardHeader title="Cancelled in this range" description="Counted on the day each sale was cancelled; the sale stays in its own day's gross sales." />
                <TableWrap fade>
                  <Table stickyFirst className="rp-table">
                    <thead>
                      <tr>
                        <Th>Sale</Th>
                        <Th>Customer</Th>
                        <Th align="right">Amount</Th>
                        <Th>Outcome</Th>
                        <Th>Cancelled</Th>
                        <Th>Reason</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cancellation_list.map((c) => (
                        <tr key={c.sale_id}>
                          <Td><strong>#{c.sale_id}</strong><span className="ui-cell-sub">{formatDateTime(c.sale_date)} · {c.location_name}</span></Td>
                          <Td>{c.customer_name || '-'}</Td>
                          <Td numeric>{money(c.total_amount)}</Td>
                          <Td>
                            {c.outcome === 'refund'
                              ? <Badge tone={c.refunded ? 'neutral' : 'warning'}>{c.refunded ? 'Refunded' : `Refund owed ${money(c.refund_due)}`}</Badge>
                              : c.outcome === 'credit' ? <Badge>Kept as credit</Badge> : <Badge>Nothing paid</Badge>}
                            {c.refunded && <span className="ui-cell-sub">Refunded {formatDateTime(c.refunded_at)}</span>}
                          </Td>
                          <Td className="sh-meta">{formatDateTime(c.voided_at)}{c.voided_by_name && <span className="ui-cell-sub">{c.voided_by_name}</span>}</Td>
                          <Td className="sh-meta">{c.reason}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
              </Card>
            )}
            </div>
          )}

          {/* PENDING TAB */}
          {tab === 'pending' && (
            <Card padding="none" className="ui-list">
              {data.pending_dues.length === 0 && (
                <EmptyState icon={<CheckCircle2 size={24} />} title="No pending dues!" />
              )}
              {data.pending_dues.map((d, i) => {
                const fullName = `${d.customer__user__first_name || ''} ${d.customer__user__last_name || ''}`.trim();
                return (
                  <div key={i} className="ui-list-row">
                    <div className="ui-list-row__lead">
                      <span className="rp-avatar" aria-hidden="true"><Users size={16} /></span>
                    </div>
                    <div className="ui-list-row__main">
                      <span className="ui-list-row__name">{fullName || 'Walk-in'}</span>
                      <div className="ui-list-row__meta">
                        {d.customer__user__phone && <span>{d.customer__user__phone}</span>}
                        <span>{d.sale_count} sale{d.sale_count !== 1 ? 's' : ''} pending</span>
                      </div>
                    </div>
                    <div className="ui-list-row__actions">
                      <Badge tone="warning">{money(d.total_due)}</Badge>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/** One person-wise view of the report. Rows add up to that view's own total only. */
function StaffTotalsTable({ heading, unit, rows }: { heading: string; unit: string; rows: StaffTotal[] }) {
  const totalCount = rows.reduce((sum, r) => sum + r.count, 0);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  return (
    <TableWrap fade>
      <Table stickyFirst className="rp-table">
        <thead>
          <tr>
            <Th>{heading}</Th>
            <Th align="right">{unit}</Th>
            <Th align="right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><Td><span className="ui-num-placeholder">None in this range</span></Td><Td numeric>-</Td><Td numeric>-</Td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.user_id ?? 'none'}>
              <Td>{r.name}{r.role === 'admin' && <> <Badge size="sm" variant="outline">Admin</Badge></>}</Td>
              <Td numeric>{r.count}</Td>
              <Td numeric>{money(r.amount)}</Td>
            </tr>
          ))}
          {rows.length > 1 && (
            <tr>
              <Td><strong>Total</strong></Td>
              <Td numeric><strong>{totalCount}</strong></Td>
              <Td numeric><strong>{money(totalAmount)}</strong></Td>
            </tr>
          )}
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** Cylinder × location quantity table (Summary → Cylinder-wise Sales and Stock → Sold in Range). Aggregation unchanged. */
function CylinderSalesTable({ rows }: { rows: CylinderSale[] }) {
  const saleGroups = rows.reduce((acc, curr) => {
    const cyl = curr.cylinder_type__name;
    const loc = curr.sale__location__name || 'Unknown';
    const colKey = loc;

    if (!acc[cyl]) acc[cyl] = { total_qty: 0, total_amount: 0 };
    if (!acc[cyl][colKey]) acc[cyl][colKey] = { qty: 0, amount: 0 };

    acc[cyl][colKey].qty += curr.total_qty;
    acc[cyl][colKey].amount += curr.total_amount;

    acc[cyl].total_qty += curr.total_qty;
    acc[cyl].total_amount += curr.total_amount;
    return acc;
  }, {} as Record<string, any>);

  const colKeys = Array.from(new Set(rows.map(s => {
    return s.sale__location__name || 'Unknown';
  }))).sort();

  return (
    <TableWrap fade>
      <Table stickyFirst className="rp-table">
        <thead>
          <tr>
            <Th>Cylinder</Th>
            {colKeys.map((col) => (
              <Th key={col} align="right">{col}</Th>
            ))}
            <Th align="right">Total Qty</Th>
            <Th align="right">Total Amount</Th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(saleGroups).sort(([cylA], [cylB]) => parseFloat(cylA) - parseFloat(cylB)).map(([cyl, dataObj]) => (
            <tr key={cyl}>
              <Td><strong>{cyl}</strong></Td>
              {colKeys.map((col) => (
                <Td key={col} numeric>
                  {dataObj[col] ? <span>{dataObj[col].qty}</span> : <span className="ui-num-placeholder">-</span>}
                </Td>
              ))}
              <Td numeric><span className="ui-num-strong">{dataObj.total_qty}</span></Td>
              <Td numeric><strong>{money(dataObj.total_amount)}</strong></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
