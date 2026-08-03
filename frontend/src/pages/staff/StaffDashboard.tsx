import { useEffect, useState, useCallback } from 'react';
import {
  Banknote, CheckCircle2, Navigation, PackageCheck, Phone,
  RotateCcw, Truck, MapPin
} from 'lucide-react';
import { api } from '../../lib/api';

type Delivery = {
  id: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  rate: string;
  pending_amount: string;
  deposit_cylinders: number;
};
type Stock = { id: number; cylinder_type_name: string; location_name: string; status: string; quantity: number };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (d.detail && typeof d.detail === 'string') return d.detail;
    return Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' | ');
  }
  return fallback;
}

export default function StaffDashboard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [collections, setCollections] = useState<Record<number, { amount: string; method: string; paid_method: string; empty: string; split_cash: string; split_gpay: string; split_bank: string }>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [userName] = useState(() => localStorage.getItem('gasbook_name') || '');
  const [vehicleLocation] = useState(() => localStorage.getItem('gasbook_vehicle_location') || '');
  const [tabFilter, setTabFilter] = useState<'all' | 'pending' | 'delivered'>('pending');

  const load = useCallback(() => {
    api.get('/deliveries/')
      .then((res) => {
        const data: Delivery[] = res.data.results ?? res.data;
        setDeliveries(data);
        setCollections((prev) => {
          const next = { ...prev };
          data.forEach((d) => {
            if (!next[d.id]) {
              const defaultAmt = String(Number(d.quantity) * Number(d.rate));
              next[d.id] = {
                amount: defaultAmt,
                method: 'cash',
                paid_method: 'cash',
                empty: String(d.quantity),
                split_cash: '',
                split_gpay: '',
                split_bank: '',
              };
            }
          });
          return next;
        });
      })
      .catch(() => undefined);

    api.get('/stock/')
      .then((res) => {
        const raw = res.data.results ?? res.data;
        setStock(Array.isArray(raw) ? raw : []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filter filled stock to only vehicle stock
  const vehicleFilledStock = stock
    .filter((s) => vehicleLocation && s.location_name.toLowerCase() === vehicleLocation.toLowerCase() && s.status === 'filled')
    .reduce((sum, s) => sum + s.quantity, 0);

  const filteredStock = vehicleLocation
    ? stock.filter((s) => s.location_name.toLowerCase() === vehicleLocation.toLowerCase())
    : [];

  async function start(id: number) {
    setMessage(''); setError(''); setLoadingId(id);
    try {
      await api.post(`/deliveries/${id}/start/`);
      setMessage('✓ Delivery started. Customer and admin were notified.');
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to start delivery.'));
    } finally {
      setLoadingId(null);
    }
  }

  async function complete(id: number) {
    setMessage(''); setError(''); setLoadingId(id);
    try {
      const d = deliveries.find((item) => item.id === id);
      const defaultAmount = d ? String(Number(d.quantity) * Number(d.rate)) : '0';
      const defaultEmpty = d ? String(d.quantity) : '0';
      const form = collections[id] || {
        amount: defaultAmount,
        method: 'cash',
        paid_method: 'cash',
        empty: defaultEmpty,
        split_cash: '', split_gpay: '', split_bank: ''
      };
      
      const splitPayments: { mode: string; amount: number }[] = [];
      const payload: {
        payment_method: string;
        empty_collected: number;
        split_payments?: { mode: string; amount: number }[];
        payment_collected?: string;
        paid_payment_mode?: string;
      } = {
        payment_method: form.method,
        empty_collected: Number(form.empty || 0),
      };

      if (form.method === 'split') {
        if (Number(form.split_cash) > 0) splitPayments.push({ mode: 'cash', amount: Number(form.split_cash) });
        if (Number(form.split_gpay) > 0) splitPayments.push({ mode: 'gpay', amount: Number(form.split_gpay) });
        if (Number(form.split_bank) > 0) splitPayments.push({ mode: 'bank', amount: Number(form.split_bank) });
        payload.split_payments = splitPayments;
      } else {
        payload.payment_collected = form.amount || '0';
      }

      await api.post(`/deliveries/${id}/complete/`, payload);
      setMessage('✓ Delivery completed successfully. Stock, payment, and cylinder ledger updated.');
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to complete delivery. Check vehicle stock level.'));
    } finally {
      setLoadingId(null);
    }
  }

  const activeDeliveries = deliveries.filter((d) => d.status !== 'delivered');
  const completedDeliveries = deliveries.filter((d) => d.status === 'delivered');

  const displayedDeliveries = tabFilter === 'pending'
    ? activeDeliveries
    : tabFilter === 'delivered'
      ? completedDeliveries
      : deliveries;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* ── Page Header ── */}
      <div className="page-title" style={{ marginBottom: '20px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Welcome, {userName || 'Delivery Partner'}</span>
          </h1>
          <p style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
            <Truck size={16} />
            <span>{vehicleLocation ? `Assigned Vehicle: ${vehicleLocation}` : 'No vehicle location assigned'}</span>
          </p>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', marginBottom: '20px',
          background: 'var(--success-soft, #d1fae5)', color: 'var(--success, #059669)',
          fontWeight: 600, border: '1px solid var(--success)',
        }}>
          {message}
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: '8px', marginBottom: '20px',
          background: 'var(--danger-soft, #fee2e2)', color: 'var(--danger, #ef4444)',
          fontWeight: 600, border: '1px solid var(--danger, #ef4444)',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Metrics Cards ── */}
      <section className="stat-grid" style={{ marginBottom: '24px' }}>
        <div className="metric-card strong purple">
          <Truck />
          <span>Active Orders</span>
          <strong>{activeDeliveries.length}</strong>
          <small>{activeDeliveries.filter(d => d.status === 'out_for_delivery').length} out for delivery</small>
        </div>
        <div className="metric-card green">
          <PackageCheck />
          <span>Delivered Today</span>
          <strong>{completedDeliveries.length}</strong>
          <small>Completed orders</small>
        </div>
        <div className="metric-card orange">
          <Banknote />
          <span>Pending Collect</span>
          <strong>{money(activeDeliveries.reduce((sum, d) => sum + Number(d.pending_amount || 0), 0))}</strong>
          <small>Total amount to collect</small>
        </div>
        <div className="metric-card blue">
          <RotateCcw />
          <span>Vehicle Filled Stock</span>
          <strong>{vehicleFilledStock}</strong>
          <small>{vehicleLocation || 'Unassigned'}</small>
        </div>
      </section>

      {/* ── Tabs & Content Layout ── */}
      <div className="grid-2" style={{ alignItems: 'start', gap: '24px' }}>
        
        {/* Left Column: Delivery Orders */}
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '16px', flexWrap: 'wrap', gap: '10px'
          }}>
            <div style={{ display: 'flex', gap: '6px', background: 'var(--border)', padding: '4px', borderRadius: '8px' }}>
              <button
                type="button"
                onClick={() => setTabFilter('pending')}
                style={{
                  padding: '6px 14px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                  background: tabFilter === 'pending' ? 'var(--surface)' : 'transparent',
                  color: tabFilter === 'pending' ? 'var(--text)' : 'var(--text-muted)'
                }}
              >
                Active ({activeDeliveries.length})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('delivered')}
                style={{
                  padding: '6px 14px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                  background: tabFilter === 'delivered' ? 'var(--surface)' : 'transparent',
                  color: tabFilter === 'delivered' ? 'var(--text)' : 'var(--text-muted)'
                }}
              >
                Completed ({completedDeliveries.length})
              </button>
              <button
                type="button"
                onClick={() => setTabFilter('all')}
                style={{
                  padding: '6px 14px', borderRadius: '6px', border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                  background: tabFilter === 'all' ? 'var(--surface)' : 'transparent',
                  color: tabFilter === 'all' ? 'var(--text)' : 'var(--text-muted)'
                }}
              >
                All ({deliveries.length})
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {displayedDeliveries.map((delivery) => {
              const isCompleted = delivery.status === 'delivered';
              const isOut = delivery.status === 'out_for_delivery';

              return (
                <div key={delivery.id} className="card" style={{
                  padding: '20px', borderRadius: '12px',
                  border: isOut ? '2px solid var(--cyan, #06b6d4)' : isCompleted ? '1px solid var(--border)' : '1px solid var(--border)',
                  background: 'var(--surface)',
                }}>
                  {/* Card Top: Customer Info & Status */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', gap: '12px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: '50%',
                        background: 'var(--primary-soft, #e0e7ff)', color: 'var(--primary, #4f46e5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: '1rem', flexShrink: 0
                      }}>
                        {delivery.customer_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{delivery.customer_name}</h2>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={13} /> {delivery.customer_area || 'Standard Area'}
                        </span>
                      </div>
                    </div>

                    <span className="badge" style={{
                      textTransform: 'uppercase', fontSize: '0.72rem', letterSpacing: '0.5px', fontWeight: 700, padding: '4px 10px',
                      background: isCompleted ? 'var(--success-soft, #d1fae5)' : isOut ? 'var(--info-soft, #cff4fc)' : 'var(--warning-soft, #fef3c7)',
                      color: isCompleted ? 'var(--success, #059669)' : isOut ? '#0284c7' : 'var(--warning, #d97706)',
                      border: `1px solid ${isCompleted ? 'var(--success)' : isOut ? '#0284c7' : 'var(--warning)'}`,
                    }}>
                      {delivery.status.replaceAll('_', ' ')}
                    </span>
                  </div>

                  {/* Customer Quick Call & Address */}
                  <div style={{
                    background: 'var(--surface-muted)', padding: '12px', borderRadius: '8px',
                    marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px'
                  }}>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)' }}>
                      <strong>Address:</strong> {delivery.customer_address || 'No address specified'}
                    </p>
                    {delivery.customer_phone && (
                      <a
                        href={`tel:${delivery.customer_phone}`}
                        className="btn btn-compact"
                        style={{
                          background: 'var(--success-soft, #d1fae5)', color: 'var(--success, #059669)',
                          border: '1px solid var(--success)', flexShrink: 0, textDecoration: 'none',
                          padding: '6px 12px', fontSize: '0.82rem', fontWeight: 600
                        }}
                      >
                        <Phone size={14} /> Call
                      </a>
                    )}
                  </div>

                  {/* Order Financial Summary */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px',
                    padding: '12px', borderRadius: '8px', background: 'var(--border)',
                    textAlign: 'center', marginBottom: '16px'
                  }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Order Item</span>
                      <strong style={{ fontSize: '0.9rem' }}>{delivery.quantity} × {delivery.cylinder_type_name}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Unit Rate</span>
                      <strong style={{ fontSize: '0.9rem' }}>{money(delivery.rate)}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Total Pending</span>
                      <strong style={{ fontSize: '0.95rem', color: 'var(--primary)' }}>{money(delivery.pending_amount)}</strong>
                    </div>
                  </div>

                  {/* Fulfillment Form (Active Deliveries Only) */}
                  {!isCompleted && (() => {
                    const orderCost = Number(delivery.quantity) * Number(delivery.rate);
                    const form = collections[delivery.id] || {
                      amount: String(orderCost),
                      method: 'cash',
                      paid_method: 'cash',
                      empty: String(delivery.quantity),
                      split_cash: '', split_gpay: '', split_bank: ''
                    };
                    const collectedAmt = Number(form.amount || 0);

                    return (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: '14px',
                        background: 'var(--surface-muted)', padding: '16px', borderRadius: '10px',
                        border: '1px solid var(--border)'
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div>
                            <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Payment Method</label>
                            <select
                              value={form.method}
                              onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, method: e.target.value } }))}
                              style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                            >
                              <option value="cash">💵 Cash</option>
                              <option value="gpay">📱 GPay / UPI</option>
                              <option value="bank">🏦 Bank Transfer</option>
                              <option value="credit">⏳ Credit (Pending)</option>
                              <option value="split">🔀 Split Payment</option>
                            </select>
                          </div>

                          {form.method !== 'split' && (
                            <div>
                              <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Amount Collected (Rs)</label>
                              <input
                                type="number"
                                min="0"
                                placeholder={String(orderCost)}
                                value={form.amount}
                                onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, amount: e.target.value } }))}
                                style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', textAlign: 'right', fontWeight: 700 }}
                              />
                            </div>
                          )}

                          {form.method === 'split' && (
                            <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                              <div>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Cash</span>
                                <input
                                  type="number" min="0" placeholder="0" value={form.split_cash}
                                  onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_cash: e.target.value } }))}
                                  style={{ width: '100%', padding: '6px', textAlign: 'center' }}
                                />
                              </div>
                              <div>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>GPay</span>
                                <input
                                  type="number" min="0" placeholder="0" value={form.split_gpay}
                                  onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_gpay: e.target.value } }))}
                                  style={{ width: '100%', padding: '6px', textAlign: 'center' }}
                                />
                              </div>
                              <div>
                                <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>Bank</span>
                                <input
                                  type="number" min="0" placeholder="0" value={form.split_bank}
                                  onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_bank: e.target.value } }))}
                                  style={{ width: '100%', padding: '6px', textAlign: 'center' }}
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        {form.method !== 'split' && (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                            <span>Order Total: <strong>{money(orderCost)}</strong></span>
                            {collectedAmt > orderCost && (
                              <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                                ✨ {money(orderCost)} order + {money(collectedAmt - orderCost)} ledger
                              </span>
                            )}
                          </div>
                        )}

                        {/* Empty Cylinder Collected */}
                        <div>
                          <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', display: 'block' }}>Empty Cylinders Collected</label>
                          <input
                            type="number"
                            min="0"
                            value={form.empty}
                            onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, empty: e.target.value } }))}
                            placeholder="Number of empty cylinders"
                            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)' }}
                          />
                        </div>

                      {/* Action Buttons */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
                        {!isOut && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => start(delivery.id)}
                            disabled={loadingId === delivery.id}
                            style={{ border: '1px solid #0284c7', color: '#0284c7', background: 'var(--info-soft, #f0f9ff)' }}
                          >
                            <Navigation size={18} /> {loadingId === delivery.id ? 'Starting…' : 'Start Delivery'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => complete(delivery.id)}
                          disabled={loadingId === delivery.id}
                          style={{ background: 'var(--success, #059669)', gridColumn: !isOut ? '2' : '1 / -1' }}
                        >
                          <CheckCircle2 size={18} /> {loadingId === delivery.id ? 'Completing…' : 'Complete & Deliver'}
                        </button>
                      </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}

            {displayedDeliveries.length === 0 && (
              <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={32} style={{ marginBottom: '8px', color: 'var(--success)' }} />
                <h3>No deliveries found</h3>
                <p style={{ fontSize: '0.88rem' }}>All assigned orders for this filter have been processed.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Vehicle Stock Panel */}
        <div className="card" style={{ padding: '20px', borderRadius: '12px', position: 'sticky', top: '80px' }}>
          <div className="section-head" style={{ marginBottom: '16px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{vehicleLocation ? `${vehicleLocation} Stock` : 'Vehicle Stock'}</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                {vehicleLocation ? 'Live inventory on your vehicle' : 'No vehicle assigned to your profile'}
              </p>
            </div>
            <PackageCheck size={22} color="var(--primary)" />
          </div>

          <div className="table-wrap">
            <table style={{ width: '100%', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 4px' }}>Cylinder</th>
                  <th style={{ padding: '8px 4px' }}>Status</th>
                  <th style={{ padding: '8px 4px', textAlign: 'right' }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {filteredStock.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 4px', fontWeight: 600 }}>{row.cylinder_type_name}</td>
                    <td style={{ padding: '10px 4px' }}>
                      <span className="badge" style={{
                        fontSize: '0.72rem', textTransform: 'uppercase', padding: '2px 6px',
                        background: row.status === 'filled' ? 'var(--success-soft, #d1fae5)' : 'var(--surface-muted)',
                        color: row.status === 'filled' ? 'var(--success, #059669)' : 'var(--text-muted)',
                        border: `1px solid ${row.status === 'filled' ? 'var(--success)' : 'var(--border)'}`
                      }}>
                        {row.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 4px', textAlign: 'right', fontWeight: 800, fontSize: '1rem' }}>
                      {row.quantity}
                    </td>
                  </tr>
                ))}
                {filteredStock.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)' }}>
                      {!vehicleLocation
                        ? '⚠️ No vehicle assigned. Ask Admin to assign a vehicle location in Staff Management.'
                        : 'No cylinder stock currently loaded on your vehicle.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
