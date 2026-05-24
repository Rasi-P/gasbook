import { useEffect, useState } from 'react';
import {
  IndianRupee, ReceiptText, Route, WalletCards,
  AlertTriangle, Package, ChevronDown, ChevronUp, Boxes,
} from 'lucide-react';
import { api } from '../lib/api';

type SaleItem = { cylinder_type_name: string; quantity: number; rate: number };
type Sale = {
  id: number; created_at: string; customer_name: string; sold_by_name: string;
  total_amount: number; paid_amount: number; balance_due: number;
  payment_mode: string; location_name: string; items: SaleItem[];
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
  customer__name: string; customer__phone: string;
  total_due: number; sale_count: number;
};
type CylinderSale = { cylinder_type__name: string; total_qty: number; total_amount: number };
type StockRow = {
  type: string; shop_filled: number; shop_empty: number;
  kandam_filled: number; kandam_empty: number;
  with_customers: number; total: number;
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
  expense_breakdown: { category: string; total: number }[];
};

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: 'Fuel', salary: 'Salary', transport: 'Transport', misc: 'Miscellaneous',
};

type Tab = 'summary' | 'stock' | 'sales' | 'pending' | 'expenses' | 'movements' | 'full';

function today() { return new Date().toISOString().slice(0, 10); }
function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('summary');
  const [expandedSale, setExpandedSale] = useState<number | null>(null);

  function fetchData(s: string, e: string) {
    setLoading(true);
    api.get('/reports/', { params: { start: s, end: e } })
      .then((r) => setData(r.data))
      .catch(() => undefined)
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
    { key: 'expenses', label: 'Expenses' },
    { key: 'movements', label: 'Movements' },
    { key: 'full', label: '📋 Full' },
  ];

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Reports</h1>
          <p>Full business flow — load, stock, sales, collections, pending.</p>
        </div>
      </div>

      {/* Date range */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: 1, minWidth: '130px' }}>
            <span>From</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: '130px' }}>
            <span>To</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0 20px' }}
            onClick={() => fetchData(start, end)}>Go</button>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
          {[
            { label: 'Today', s: today(), e: today() },
            { label: 'Yesterday', s: yesterday(), e: yesterday() },
            { label: 'This Month', s: monthStart(), e: today() },
          ].map(({ label, s, e }) => (
            <button key={label} onClick={() => applyRange(s, e)} style={{
              padding: '6px 14px', border: '1px solid var(--border)', borderRadius: '6px',
              background: start === s && end === e ? 'var(--primary)' : 'var(--surface)',
              color: start === s && end === e ? 'white' : 'var(--text-muted)',
              fontWeight: 700, fontSize: '0.82rem',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {loading && <p style={{ textAlign: 'center', padding: '24px' }}>Loading…</p>}

      {data && (
        <>
          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '16px', overflowX: 'auto' }}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                flex: 1, padding: '9px 6px', border: 'none', borderRadius: '6px', whiteSpace: 'nowrap',
                background: tab === t.key ? 'var(--surface)' : 'transparent',
                fontWeight: 600, fontSize: '0.82rem',
                color: tab === t.key ? 'var(--text)' : 'var(--text-muted)',
              }}>{t.label}</button>
            ))}
          </div>

          {/* SUMMARY TAB */}
          {tab === 'summary' && (
            <>
              <section className="stat-grid">
                <div className="metric-card strong">
                  <IndianRupee />
                  <span>Sales</span>
                  <strong>{money(data.summary.sales)}</strong>
                </div>
                <div className="metric-card">
                  <WalletCards />
                  <span>Collection</span>
                  <strong>{money(data.summary.collection)}</strong>
                </div>
                <div className="metric-card">
                  <ReceiptText />
                  <span>Expenses</span>
                  <strong>{money(data.summary.expenses)}</strong>
                </div>
                <div className="metric-card">
                  <Route />
                  <span>Movements</span>
                  <strong>{data.summary.movements}</strong>
                </div>
              </section>

              {Number(data.summary.pending) > 0 && (
                <div className="card alert-card" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <AlertTriangle style={{ color: 'var(--danger)', flexShrink: 0 }} size={28} />
                  <div>
                    <strong style={{ fontSize: '1.3rem' }}>{money(data.summary.pending)}</strong>
                    <p>Total pending dues across all customers</p>
                  </div>
                </div>
              )}

              {data.cylinder_sales.length > 0 && (
                <div className="card">
                  <div className="section-head">
                    <h2>Cylinder-wise Sales</h2>
                    <Package size={18} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Cylinder</th>
                          <th style={{ textAlign: 'right' }}>Qty Sold</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.cylinder_sales.map((c) => (
                          <tr key={c.cylinder_type__name}>
                            <td><strong>{c.cylinder_type__name}</strong></td>
                            <td style={{ textAlign: 'right' }}>{c.total_qty}</td>
                            <td style={{ textAlign: 'right' }}>{money(c.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="card">
                <div className="section-head">
                  <h2>This Month</h2>
                  <span className="badge badge-success">
                    {money(Number(data.monthly.collection) - Number(data.monthly.expenses))} net
                  </span>
                </div>
                <div className="summary-grid">
                  <p><span>Sales</span><strong>{money(data.monthly.sales)}</strong></p>
                  <p><span>Collection</span><strong>{money(data.monthly.collection)}</strong></p>
                  <p><span>Expenses</span><strong>{money(data.monthly.expenses)}</strong></p>
                </div>
              </div>

              {data.expense_breakdown.length > 0 && (
                <div className="card">
                  <h2 style={{ marginBottom: '14px' }}>Expense Breakdown</h2>
                  <div className="summary-grid">
                    {data.expense_breakdown.map((e) => (
                      <p key={e.category}>
                        <span>{CATEGORY_LABELS[e.category] ?? e.category}</span>
                        <strong>{money(e.total)}</strong>
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* STOCK TAB — full flow */}
          {tab === 'stock' && (
            <>
              {/* Loads received in range */}
              <div className="card">
                <div className="section-head">
                  <h2>Loads Received</h2>
                  <span className="badge">Supplier → Location</span>
                </div>
                {data.load_summary.length === 0
                  ? <p style={{ textAlign: 'center', padding: '16px' }}>No loads in this range.</p>
                  : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Cylinder</th>
                            <th>Location</th>
                            <th style={{ textAlign: 'right' }}>Qty Loaded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.load_summary.map((l, i) => (
                            <tr key={i}>
                              <td><strong>{l.cylinder_type__name}</strong></td>
                              <td>{l.to_location__name}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{l.total_qty}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              {/* Current stock snapshot */}
              <div className="card">
                <div className="section-head">
                  <h2>Current Stock Snapshot</h2>
                  <Boxes size={18} style={{ color: 'var(--primary)' }} />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th style={{ textAlign: 'center' }}>Shop (F/E)</th>
                        <th style={{ textAlign: 'center' }}>Kandam (F/E)</th>
                        <th style={{ textAlign: 'right' }}>With Customers</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.stock_snapshot.map((r) => (
                        <tr key={r.type}>
                          <td><strong>{r.type}</strong></td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>{r.shop_filled}</span>
                            <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                            <span style={{ color: 'var(--danger)' }}>{r.shop_empty}</span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>{r.kandam_filled}</span>
                            <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                            <span style={{ color: 'var(--danger)' }}>{r.kandam_empty}</span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {r.with_customers > 0
                              ? <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{r.with_customers}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{r.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cylinder-wise sold in range */}
              {data.cylinder_sales.length > 0 && (
                <div className="card">
                  <div className="section-head">
                    <h2>Sold in Range</h2>
                    <Package size={18} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Cylinder</th>
                          <th style={{ textAlign: 'right' }}>Qty Sold</th>
                          <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.cylinder_sales.map((c) => (
                          <tr key={c.cylinder_type__name}>
                            <td><strong>{c.cylinder_type__name}</strong></td>
                            <td style={{ textAlign: 'right' }}>{c.total_qty}</td>
                            <td style={{ textAlign: 'right' }}>{money(c.total_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* SALES TAB */}
          {tab === 'sales' && (
            <div className="card" style={{ padding: 0 }}>
              {data.sales_list.length === 0 && (
                <p style={{ textAlign: 'center', padding: '24px' }}>No sales in this range.</p>
              )}
              {data.sales_list.map((s) => (
                <div key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setExpandedSale(expandedSale === s.id ? null : s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '14px 18px', background: 'none', border: 'none',
                      textAlign: 'left', cursor: 'pointer',
                    }}
                  >
                    <div>
                      <strong>{s.customer_name || 'Walk-in'}</strong>
                      <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>
                        {fmtDateTime(s.created_at)} · {s.location_name} · {s.payment_mode.toUpperCase()} · by {s.sold_by_name}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700 }}>{money(s.total_amount)}</div>
                        {Number(s.balance_due) > 0
                          ? <span className="badge badge-warning">Due {money(s.balance_due)}</span>
                          : <span className="badge badge-success">Paid</span>}
                      </div>
                      {expandedSale === s.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>
                  {expandedSale === s.id && (
                    <div style={{ background: 'var(--surface-muted)', padding: '10px 18px 14px', display: 'grid', gap: '6px' }}>
                      {s.items.map((item, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                          <span><strong>{item.quantity} × {item.cylinder_type_name}</strong></span>
                          <span style={{ color: 'var(--text-muted)' }}>@ {money(item.rate)} = {money(item.quantity * Number(item.rate))}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Paid</span>
                        <strong style={{ color: 'var(--success)' }}>{money(s.paid_amount)}</strong>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* PENDING TAB */}
          {tab === 'pending' && (
            <div className="card" style={{ padding: 0 }}>
              {data.pending_dues.length === 0 && (
                <p style={{ textAlign: 'center', padding: '24px', color: 'var(--success)' }}>✓ No pending dues!</p>
              )}
              {data.pending_dues.map((d, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 18px', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <strong>{d.customer__name || '—'}</strong>
                    {d.customer__phone && <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>{d.customer__phone}</p>}
                    <p style={{ fontSize: '0.82rem' }}>{d.sale_count} sale{d.sale_count !== 1 ? 's' : ''} pending</p>
                  </div>
                  <span className="badge badge-warning" style={{ fontSize: '0.9rem' }}>{money(d.total_due)}</span>
                </div>
              ))}
            </div>
          )}

          {/* EXPENSES TAB */}
          {tab === 'expenses' && (
            <>
              {data.expense_breakdown.length > 0 && (
                <div className="card">
                  <h2 style={{ marginBottom: '14px' }}>By Category</h2>
                  <div className="summary-grid">
                    {data.expense_breakdown.map((e) => (
                      <p key={e.category}>
                        <span>{CATEGORY_LABELS[e.category] ?? e.category}</span>
                        <strong>{money(e.total)}</strong>
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <div className="card" style={{ padding: 0 }}>
                {data.expense_list.length === 0 && (
                  <p style={{ textAlign: 'center', padding: '24px' }}>No expenses in this range.</p>
                )}
                {data.expense_list.map((e) => (
                  <div key={e.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 18px', borderBottom: '1px solid var(--border)',
                  }}>
                    <div>
                      <strong>{CATEGORY_LABELS[e.category] ?? e.category}</strong>
                      <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>
                        {fmtDate(e.created_at)} · {e.spent_by_name}{e.note ? ` · ${e.note}` : ''}
                      </p>
                    </div>
                    <span className="badge badge-warning">{money(e.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* MOVEMENTS TAB */}
          {tab === 'movements' && (
            <div className="card" style={{ padding: 0 }}>
              {data.movement_history.length === 0 && (
                <p style={{ textAlign: 'center', padding: '24px' }}>No movements in this range.</p>
              )}
              {data.movement_history.map((m) => (
                <div key={m.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '14px 18px', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <strong>{m.quantity} × {m.cylinder_type_name} ({m.status})</strong>
                    <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>
                      {m.from_location_name} → {m.to_location_name} · {fmtDateTime(m.created_at)}
                    </p>
                  </div>
                  <span className="badge">{m.moved_by_name}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
