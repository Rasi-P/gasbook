import { useEffect, useState } from 'react';
import {
  IndianRupee, WalletCards,
  AlertTriangle, Package, Boxes, CheckCircle2, Receipt, Truck, Users,
} from 'lucide-react';
import { api, extractApiError } from '../../lib/api';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { FilledEmpty } from '../../components/FilledEmpty';
import { SaleItemsCell } from '../../components/SaleItemsCell';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ChoiceChips } from '../../components/ui/ChoiceChips';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows, SkeletonStatGrid } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';

type SaleItem = { cylinder_type_name: string; quantity: number; rate: number };
type Sale = {
  id: number; created_at: string; customer_name: string; sold_by_name: string;
  total_amount: number; paid_amount: number; balance_due: number;
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
type CylinderSale = { cylinder_type__name: string; sale__location__name?: string; sale__sold_by__role?: string; total_qty: number; total_amount: number };
type StockRow = {
  type: string; shop_filled: number; shop_empty: number;
  kandam_filled: number; kandam_empty: number;
  with_customers: number; customer_credits: number;
  supplier_stock: number; physical_stock: number; total: number;
};
type LoadRow = { cylinder_type__name: string; to_location__name: string; total_qty: number };
type ReportsData = {
  range: { start: string; end: string };
  summary: { sales: number; collection: number; expenses: number; movements: number; pending: number };
  monthly: { sales: number; collection: number; expenses: number };
  cylinder_sales: CylinderSale[];
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

  // ISO yyyy-mm-dd strings compare lexicographically.
  const rangeError = start && end && start > end ? 'From date must be on or before To date.' : '';

  function fetchData(s: string, e: string) {
    if (!s || !e || s > e) return;
    setLoading(true);
    setError('');
    api.get('/reports/', { params: { start: s, end: e } })
      .then((r) => setData(r.data as ReportsData))
      .catch((err) => {
        setError(extractApiError(err, [], 'Could not load report.'));
        setData(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(start, end); }, []);

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
                <StatCard label="Sales" value={money(data.summary.sales)} icon={<IndianRupee />} />
                <StatCard label="Collection" value={money(data.summary.collection)} icon={<WalletCards />} />
                <StatCard label="Pending Dues" value={money(data.summary.pending)} icon={<AlertTriangle />} />
              </section>

              {data.cylinder_sales.length > 0 && (
                <Card padding="none" className="rp-section">
                  <CardHeader title="Cylinder-wise Sales" meta={<Package size={18} className="ui-card-icon" aria-hidden="true" />} />
                  <CylinderSalesTable rows={data.cylinder_sales} />
                </Card>
              )}

              <Card className="rp-section">
                <CardHeader title="This Month" />
                <div className="ui-tiles">
                  <div className="ui-tile"><span className="ui-tile__label">Sales</span><strong className="ui-tile__value">{money(data.monthly.sales)}</strong></div>
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
                  <CardHeader title="Sold in Range" meta={<Package size={18} className="ui-card-icon" aria-hidden="true" />} />
                  <CylinderSalesTable rows={data.cylinder_sales} />
                </Card>
              )}
            </div>
          )}

          {/* SALES TAB */}
          {tab === 'sales' && (
            <Card padding="none">
              {data.sales_list.length === 0 ? (
                <EmptyState icon={<Receipt size={24} />} title="No sales found in this range." />
              ) : (
              <TableWrap fade>
                <Table stickyFirst className="sales-history-table">
                  <thead>
                    <tr>
                      <Th>Customer</Th>
                      <Th>Items</Th>
                      <Th align="right">Total</Th>
                      <Th align="right">Balance</Th>
                      <Th>Mode</Th>
                      <Th>Staff</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales_list.map((sale) => {
                      const isReturn = (sale as any).note === 'Empty cylinders returned';
                      return (
                      <tr key={sale.id}>
                        <Td><strong className="sh-customer">{sale.customer_name || 'Walk-in'}</strong></Td>
                        <Td><SaleItemsCell customerName={sale.customer_name} items={sale.items} /></Td>
                        <Td numeric>
                          {isReturn ? <span className="ui-num-placeholder">-</span> : <span className="ui-num-strong">{money(sale.total_amount)}</span>}
                        </Td>
                        <Td align="right">
                          {isReturn ? <span className="ui-num-placeholder">-</span> : (
                            Number(sale.balance_due) > 0
                              ? <Badge tone="warning">{money(sale.balance_due)}</Badge>
                              : <Badge tone="success">Paid</Badge>
                          )}
                        </Td>
                        <Td className="sh-nowrap">
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
                        <Td className="sh-meta">{sale.sold_by_name}</Td>
                        <Td className="sh-meta sh-nowrap">
                          {new Date(sale.created_at).toLocaleDateString('en-IN')}
                        </Td>
                      </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrap>
              )}
            </Card>
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
