import { useEffect, useState, useCallback } from 'react';
import {
  IndianRupee, WalletCards,
  AlertTriangle, Package, Boxes,
} from 'lucide-react';
import { api } from '../../lib/api';

type SaleItem = { cylinder_type_name: string; quantity: number; rate: number; empty_returned?: number };
type Sale = {
  id: number; created_at: string; customer_name: string; sold_by_name: string;
  total_amount: number; paid_amount: number; balance_due: number;
  payment_mode: string; location_name: string; note?: string; items: SaleItem[];
  payments?: { amount: number; mode: string; date: string }[];
};
type CylinderSaleRow = {
  total_qty: number;
  total_amount: number;
  locations: Record<string, { qty: number; amount: number }>;
};
type CylinderGroupMap = Record<string, CylinderSaleRow>;
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

  const fetchData = useCallback((s: string, e: string) => {
    api.get('/reports/', { params: { start: s, end: e } })
      .then((r) => setData(r.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData(start, end);
  }, [fetchData, start, end]);

  function applyRange(s: string, e: string) {
    setStart(s); setEnd(e); fetchData(s, e);
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'stock', label: 'Stock' },
    { key: 'sales', label: 'Sales' },
    { key: 'pending', label: 'Pending' },
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
                <div className="metric-card strong purple">
                  <IndianRupee />
                  <span>Sales</span>
                  <strong>{money(data.summary.sales)}</strong>
                </div>
                <div className="metric-card blue">
                  <WalletCards />
                  <span>Collection</span>
                  <strong>{money(data.summary.collection)}</strong>
                </div>
                <div className="metric-card orange">
                  <AlertTriangle />
                  <span>Pending Dues</span>
                  <strong>{money(data.summary.pending)}</strong>
                </div>
              </section>

              {data.cylinder_sales.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="section-head" style={{ padding: '18px 18px 0', marginBottom: '14px' }}>
                    <h2>Cylinder-wise Sales</h2>
                    <Package size={18} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="table-wrap">
                    {(() => {
                      const saleGroups = data.cylinder_sales.reduce((acc, curr) => {
                        const cyl = curr.cylinder_type__name;
                        const loc = curr.sale__location__name || 'Unknown';
                        
                        if (!acc[cyl]) acc[cyl] = { total_qty: 0, total_amount: 0, locations: {} };
                        if (!acc[cyl].locations[loc]) acc[cyl].locations[loc] = { qty: 0, amount: 0 };
                        
                        acc[cyl].locations[loc].qty += curr.total_qty;
                        acc[cyl].locations[loc].amount += curr.total_amount;
                        
                        acc[cyl].total_qty += curr.total_qty;
                        acc[cyl].total_amount += curr.total_amount;
                        return acc;
                      }, {} as CylinderGroupMap);

                      const colKeys = Array.from(new Set(data.cylinder_sales.map(s => {
                        return s.sale__location__name || 'Unknown';
                      }))).sort();

                      return (
                        <table style={{ minWidth: '100%', margin: 0 }}>
                          <thead style={{ background: 'var(--surface-muted)' }}>
                            <tr>
                              <th style={{ padding: '12px 18px' }}>Cylinder</th>
                              {colKeys.map((col) => (
                                <th key={col} style={{ textAlign: 'center', borderLeft: '1px dashed var(--border)' }}>{col}</th>
                              ))}
                              <th style={{ textAlign: 'right', padding: '12px 18px', borderLeft: '1px dashed var(--border)' }}>Total Qty</th>
                              <th style={{ textAlign: 'right', padding: '12px 18px', borderLeft: '1px dashed var(--border)' }}>Total Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(saleGroups).sort(([cylA], [cylB]) => parseFloat(cylA) - parseFloat(cylB)).map(([cyl, dataObj]) => (
                              <tr key={cyl} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '14px 18px' }}><strong>{cyl}</strong></td>
                                {colKeys.map((col) => (
                                  <td key={col} style={{ textAlign: 'center', fontWeight: 700, borderLeft: '1px dashed var(--border)', background: 'var(--surface)' }}>
                                    {dataObj.locations[col] ? (
                                      <span style={{ background: 'var(--info-soft)', color: 'var(--info)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.95rem' }}>
                                        {dataObj.locations[col].qty}
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--border)' }}>-</span>
                                    )}
                                  </td>
                                ))}
                                <td style={{ textAlign: 'right', padding: '14px 18px', borderLeft: '1px dashed var(--border)', background: 'var(--surface-muted)' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1rem' }}>
                                    {dataObj.total_qty}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', padding: '14px 18px', borderLeft: '1px dashed var(--border)', background: 'var(--surface-muted)' }}>
                                  <span style={{ fontWeight: 800, color: 'var(--text)', fontSize: '1.05rem' }}>
                                    {money(dataObj.total_amount)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="card">
                <div className="section-head">
                  <h2>This Month</h2>
                </div>
                <div className="summary-grid">
                  <p><span>Sales</span><strong>{money(data.monthly.sales)}</strong></p>
                  <p><span>Collection</span><strong>{money(data.monthly.collection)}</strong></p>
                </div>
              </div>
            </>
          )}

          {/* STOCK TAB — full flow */}
          {tab === 'stock' && (
            <div style={{ display: 'grid', gap: '16px' }}>
              {/* Loads received in range */}
              <div className="card" style={{ padding: 0 }}>
                <div className="section-head" style={{ padding: '18px 18px 0', marginBottom: '14px' }}>
                  <h2>New Cylinders Purchased (Loads)</h2>
                  <span className="badge">Supplier → Location</span>
                </div>
                {data.load_summary.length === 0
                  ? <p style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No loads in this range.</p>
                  : (() => {
                      const loadGroups = data.load_summary.reduce((acc, curr) => {
                        const cyl = curr.cylinder_type__name;
                        if (!acc[cyl]) acc[cyl] = { total: 0 };
                        acc[cyl][curr.to_location__name] = (acc[cyl][curr.to_location__name] || 0) + curr.total_qty;
                        acc[cyl].total += curr.total_qty;
                        return acc;
                      }, {} as Record<string, Record<string, number>>);
                      const locs = Array.from(new Set(data.load_summary.map(l => l.to_location__name))).sort();
                      
                      return (
                        <div className="table-wrap">
                          <table style={{ minWidth: '100%', margin: 0 }}>
                            <thead style={{ background: 'var(--surface-muted)' }}>
                              <tr>
                                <th style={{ padding: '12px 18px' }}>Cylinder</th>
                                {locs.map((loc, idx) => (
                                  <th key={loc} style={{ textAlign: 'center', borderLeft: idx >= 0 ? '1px dashed var(--border)' : 'none' }}>{loc}</th>
                                ))}
                                <th style={{ textAlign: 'right', padding: '12px 18px', borderLeft: '1px dashed var(--border)' }}>Total Added</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(loadGroups).sort(([cylA], [cylB]) => parseFloat(cylA) - parseFloat(cylB)).map(([cyl, locData]) => (
                                <tr key={cyl} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={{ padding: '14px 18px' }}><strong>{cyl}</strong></td>
                                  {locs.map((loc, idx) => (
                                    <td key={loc} style={{ textAlign: 'center', fontWeight: 700, borderLeft: idx >= 0 ? '1px dashed var(--border)' : 'none', background: 'var(--surface)' }}>
                                      {locData[loc] ? (
                                        <span style={{ background: 'var(--primary-soft)', color: 'var(--primary)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.95rem' }}>
                                          {locData[loc]}
                                        </span>
                                      ) : (
                                        <span style={{ color: 'var(--border)' }}>-</span>
                                      )}
                                    </td>
                                  ))}
                                  <td style={{ textAlign: 'right', padding: '14px 18px', borderLeft: '1px dashed var(--border)', background: 'var(--surface-muted)' }}>
                                    <span className="badge badge-success" style={{ fontSize: '0.95rem', padding: '6px 12px' }}>
                                      +{locData.total}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                  })()
                }
              </div>

              {/* Supplier Balance */}
              <div className="card" style={{ padding: 0 }}>
                <div className="section-head" style={{ padding: '18px 18px 0', marginBottom: '14px' }}>
                  <h2>Supplier Balance (All Time)</h2>
                  <span className="badge">Pending to Receive</span>
                </div>
                {data.supplier_balance && data.supplier_balance.length === 0
                  ? <p style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No supplier records found.</p>
                  : (
                    <div>
                      {data.supplier_balance && [...data.supplier_balance].sort((a, b) => parseFloat(a.type) - parseFloat(b.type)).map((b, i: number) => (
                        <div key={i} style={{ 
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '14px 18px', borderTop: '1px solid var(--border)'
                        }}>
                          <strong style={{ fontSize: '1.05rem', color: 'var(--text)' }}>{b.type}</strong>
                          <span className={`badge ${b.pending > 0 ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: '0.95rem', padding: '6px 12px' }}>
                            {b.pending > 0 ? `${b.pending} Pending` : 'Settled'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
              </div>

              {/* Current stock snapshot */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="section-head" style={{ padding: '18px 18px 0', marginBottom: '14px' }}>
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Boxes size={18} style={{ color: 'var(--primary)' }} />
                    Current Stock Snapshot
                  </h2>
                </div>
                <div className="table-wrap">
                  <table style={{ minWidth: '600px', margin: 0 }}>
                    <thead style={{ background: 'var(--surface-muted)' }}>
                      <tr>
                        <th style={{ padding: '12px 18px' }}>Type</th>
                        <th style={{ textAlign: 'center' }}>Shop (F/E)</th>
                        <th style={{ textAlign: 'center' }}>Warehouse (F/E)</th>
                        <th style={{ textAlign: 'center' }}>With Customers</th>
                        <th style={{ textAlign: 'center' }}>Extras From Customers</th>
                        <th style={{ textAlign: 'center', padding: '12px 18px' }}>Supplier Stock<br/><span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>(Base)</span></th>
                        <th style={{ textAlign: 'right', padding: '12px 18px' }}>Total Physical<br/><span style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>(Shop + Warehouse)</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.stock_snapshot].sort((a, b) => parseFloat(a.type) - parseFloat(b.type)).map((r) => (
                        <tr key={r.type}>
                          <td style={{ padding: '14px 18px' }}><strong>{r.type}</strong></td>
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
                          <td style={{ textAlign: 'center' }}>
                            {r.with_customers > 0
                              ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{r.with_customers}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {r.customer_credits > 0
                              ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>{r.customer_credits}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'center', padding: '14px 18px' }}>{r.supplier_stock}</td>
                          <td style={{ textAlign: 'right', fontWeight: 'bold', padding: '14px 18px' }}>{r.physical_stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cylinder-wise sold in range */}
              {data.cylinder_sales.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="section-head" style={{ padding: '18px 18px 0', marginBottom: '14px' }}>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Package size={18} style={{ color: 'var(--primary)' }} />
                      Sold in Range
                    </h2>
                  </div>
                  <div className="table-wrap">
                    {(() => {
                      const saleGroups = data.cylinder_sales.reduce((acc, curr) => {
                        const cyl = curr.cylinder_type__name;
                        const loc = curr.sale__location__name || 'Unknown';
                        
                        if (!acc[cyl]) acc[cyl] = { total_qty: 0, total_amount: 0, locations: {} };
                        if (!acc[cyl].locations[loc]) acc[cyl].locations[loc] = { qty: 0, amount: 0 };
                        
                        acc[cyl].locations[loc].qty += curr.total_qty;
                        acc[cyl].locations[loc].amount += curr.total_amount;
                        
                        acc[cyl].total_qty += curr.total_qty;
                        acc[cyl].total_amount += curr.total_amount;
                        return acc;
                      }, {} as CylinderGroupMap);

                      const colKeys = Array.from(new Set(data.cylinder_sales.map(s => {
                        return s.sale__location__name || 'Unknown';
                      }))).sort();

                      return (
                        <table style={{ minWidth: '100%', margin: 0 }}>
                          <thead style={{ background: 'var(--surface-muted)' }}>
                            <tr>
                              <th style={{ padding: '12px 18px' }}>Cylinder</th>
                              {colKeys.map((col) => (
                                <th key={col} style={{ textAlign: 'center', borderLeft: '1px dashed var(--border)' }}>{col}</th>
                              ))}
                              <th style={{ textAlign: 'right', padding: '12px 18px', borderLeft: '1px dashed var(--border)' }}>Total Qty</th>
                              <th style={{ textAlign: 'right', padding: '12px 18px', borderLeft: '1px dashed var(--border)' }}>Total Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(saleGroups).sort(([cylA], [cylB]) => parseFloat(cylA) - parseFloat(cylB)).map(([cyl, dataObj]) => (
                              <tr key={cyl} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '14px 18px' }}><strong>{cyl}</strong></td>
                                {colKeys.map((col) => (
                                  <td key={col} style={{ textAlign: 'center', fontWeight: 700, borderLeft: '1px dashed var(--border)', background: 'var(--surface)' }}>
                                    {dataObj.locations[col] ? (
                                      <span style={{ background: 'var(--info-soft)', color: 'var(--info)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.95rem' }}>
                                        {dataObj.locations[col].qty}
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--border)' }}>-</span>
                                    )}
                                  </td>
                                ))}
                                <td style={{ textAlign: 'right', padding: '14px 18px', borderLeft: '1px dashed var(--border)', background: 'var(--surface-muted)' }}>
                                  <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1rem' }}>
                                    {dataObj.total_qty}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'right', padding: '14px 18px', borderLeft: '1px dashed var(--border)', background: 'var(--surface-muted)' }}>
                                  <span style={{ fontWeight: 800, color: 'var(--text)', fontSize: '1.05rem' }}>
                                    {money(dataObj.total_amount)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SALES TAB */}
          {tab === 'sales' && (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table style={{ minWidth: '100%', margin: 0 }}>
                  <thead style={{ background: 'var(--surface-muted)' }}>
                    <tr>
                      <th style={{ padding: '12px 18px' }}>Customer</th>
                      <th style={{ padding: '12px 18px' }}>Items</th>
                      <th style={{ textAlign: 'right', padding: '12px 18px' }}>Total</th>
                      <th style={{ textAlign: 'right', padding: '12px 18px' }}>Balance</th>
                      <th style={{ padding: '12px 18px' }}>Mode</th>
                      <th style={{ padding: '12px 18px' }}>Staff</th>
                      <th style={{ padding: '12px 18px' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales_list.map((sale) => (
                      <tr key={sale.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '14px 18px' }}><strong>{sale.customer_name || 'Walk-in'}</strong></td>
                        <td style={{ padding: '14px 18px' }}>
                          {sale.items.map((item, i) => (
                            <span key={i} style={{ display: 'block', fontSize: '0.82rem', marginBottom: '2px' }}>
                              {item.quantity > 0 && <span>{item.quantity}×{item.cylinder_type_name} @ {money(item.rate)}</span>}
                              {(item.empty_returned ?? 0) > 0 ? (
                                <span style={{ 
                                  color: (!sale.customer_name && item.quantity > 0 && (item.empty_returned ?? 0) < item.quantity) ? 'var(--danger)' : 'var(--text-muted)', 
                                  marginLeft: item.quantity > 0 ? '6px' : '0',
                                  background: (!sale.customer_name && item.quantity > 0 && (item.empty_returned ?? 0) < item.quantity) ? 'var(--danger-soft, #fee2e2)' : 'var(--surface)',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: `1px solid ${(!sale.customer_name && item.quantity > 0 && (item.empty_returned ?? 0) < item.quantity) ? 'var(--danger)' : 'var(--border)'}`
                                }}>
                                  🔄 Returned {item.empty_returned} × {item.cylinder_type_name} empties
                                </span>
                              ) : (
                                !sale.customer_name && item.quantity > 0 && (
                                  <span style={{ 
                                    color: 'var(--danger)', 
                                    marginLeft: '6px',
                                    background: 'var(--danger-soft, #fee2e2)',
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--danger)'
                                  }}>
                                    ⚠️ 0 empties returned
                                  </span>
                                )
                              )}
                            </span>
                          ))}
                        </td>
                        <td style={{ textAlign: 'right', padding: '14px 18px' }}>
                          {sale.note === 'Empty cylinders returned' ? '-' : money(sale.total_amount)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '14px 18px' }}>
                          {sale.note === 'Empty cylinders returned' ? '-' : (
                            Number(sale.balance_due) > 0
                              ? <span className="badge badge-warning">{money(sale.balance_due)}</span>
                              : <span className="badge badge-success">Paid</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', padding: '14px 18px' }}>
                          {sale.note === 'Empty cylinders returned' ? (
                            <span className="badge" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>Return</span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="badge">{sale.payment_mode}</span>
                              {(sale.payment_mode === 'split' || sale.payment_mode === 'credit') && sale.payments && sale.payments.length > 0 && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {sale.payments.map(p => `${p.mode.toUpperCase()} ${p.amount}`).join(' + ')}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: '0.82rem', padding: '14px 18px' }}>{sale.sold_by_name}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '14px 18px' }}>
                          {new Date(sale.created_at).toLocaleDateString('en-IN')}
                        </td>
                      </tr>
                    ))}
                    {data.sales_list.length === 0 && (
                      <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No sales found in this range.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PENDING TAB */}
          {tab === 'pending' && (
            <div className="card" style={{ padding: 0 }}>
              {data.pending_dues.length === 0 && (
                <p style={{ textAlign: 'center', padding: '24px', color: 'var(--success)' }}>✓ No pending dues!</p>
              )}
              {data.pending_dues.map((d, i) => {
                const fullName = `${d.customer__user__first_name || ''} ${d.customer__user__last_name || ''}`.trim();
                return (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 18px', borderBottom: '1px solid var(--border)',
                  }}>
                    <div>
                      <strong>{fullName || 'Walk-in'}</strong>
                      {d.customer__user__phone && <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>{d.customer__user__phone}</p>}
                      <p style={{ fontSize: '0.82rem' }}>{d.sale_count} sale{d.sale_count !== 1 ? 's' : ''} pending</p>
                    </div>
                    <span className="badge badge-warning" style={{ fontSize: '0.9rem' }}>{money(d.total_due)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
