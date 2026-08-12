import { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  MapPin,
  Navigation,
  Package,
  PackageCheck,
  Phone,
  RotateCcw,
  Truck,
  Zap
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
  booking_payment_method?: string;
  booking_payment_status?: string;
};

type Stock = { id: number; cylinder_type_name: string; location_name: string; status: string; quantity: number };

type NotificationItem = {
  id: number;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

function money(v: number | string) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function StaffDashboard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'assigned' | 'active' | 'completed'>('all');

  const [collections, setCollections] = useState<
    Record<
      number,
      { amount: string; method: string; paid_method: string; empty: string; split_cash: string; split_gpay: string; split_bank: string }
    >
  >({});
  const [message, setMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [vehicleLocation, setVehicleLocation] = useState('');

  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('Too far');
  const [codConfirmed, setCodConfirmed] = useState<Record<number, boolean>>({});

  function load() {
    setUserName(localStorage.getItem('gasbook_name') || 'Staff Partner');
    setVehicleLocation(localStorage.getItem('gasbook_vehicle_location') || '');

    Promise.all([
      api.get('/deliveries/'),
      api.get('/stock/'),
      api.get('/notifications/').catch(() => ({ data: [] }))
    ])
      .then(([deliveryRes, stockRes, notifRes]) => {
        const rows = deliveryRes.data.results ?? deliveryRes.data;
        setDeliveries(rows);
        setStock(stockRes.data.results ?? stockRes.data);
        const notifData = notifRes.data.results ?? notifRes.data;
        setNotifications(Array.isArray(notifData) ? notifData : []);
        setCollections(
          Object.fromEntries(
            rows.map((d: Delivery) => [
              d.id,
              {
                amount: String(Number(d.rate || 0) * d.quantity),
                method: 'cash',
                paid_method: 'cash',
                empty: String(d.quantity),
                split_cash: '',
                split_gpay: '',
                split_bank: ''
              }
            ])
          )
        );
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  const handleMarkRead = async (id: number) => {
    try {
      await api.post(`/notifications/${id}/mark_read/`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch {
      // ignore
    }
  };

  const unreadNotifCount = notifications.filter((n) => !n.is_read).length;

  const vehicleFilledStock = stock
    .filter((s) => s.location_name === vehicleLocation && s.status === 'filled')
    .reduce((sum, s) => sum + s.quantity, 0);

  const filteredStock = vehicleLocation ? stock.filter((s) => s.location_name === vehicleLocation) : stock;

  async function accept(id: number) {
    try {
      await api.post(`/deliveries/${id}/accept/`);
      setMessage('Delivery accepted! Order status updated to Out for Delivery.');
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to accept delivery.');
    }
  }

  async function reject(id: number) {
    try {
      await api.post(`/deliveries/${id}/reject/`, { reason: rejectReason });
      setMessage('Delivery rejected. Admin notified for reassignment.');
      setRejectingId(null);
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to reject delivery.');
    }
  }

  async function start(id: number) {
    try {
      await api.post(`/deliveries/${id}/start/`);
      setMessage('Delivery started. Customer notified.');
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to start delivery.');
    }
  }

  async function complete(id: number, isCod: boolean, totalAmount: number) {
    const form = collections[id] || {
      amount: String(totalAmount),
      method: 'cash',
      paid_method: 'cash',
      empty: '1',
      split_cash: '',
      split_gpay: '',
      split_bank: ''
    };

    if (isCod && !codConfirmed[id]) {
      setMessage('Please confirm payment collected from customer before completing COD delivery.');
      return;
    }

    const payload: any = {
      payment_method: isCod ? form.method : 'gpay',
      empty_collected: Number(form.empty || 0)
    };

    if (isCod) {
      if (form.method === 'split') {
        payload.split_payments = [];
        if (Number(form.split_cash) > 0) payload.split_payments.push({ mode: 'cash', amount: Number(form.split_cash) });
        if (Number(form.split_gpay) > 0) payload.split_payments.push({ mode: 'gpay', amount: Number(form.split_gpay) });
        if (Number(form.split_bank) > 0) payload.split_payments.push({ mode: 'bank', amount: Number(form.split_bank) });
      } else {
        payload.payment_collected = form.amount || String(totalAmount);
        payload.paid_payment_mode = form.paid_method;
      }
    } else {
      payload.payment_collected = String(totalAmount);
    }

    try {
      await api.post(`/deliveries/${id}/complete/`, payload);
      setMessage('Delivery completed successfully! Customer and Admin notified.');
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to complete delivery.');
    }
  }

  const activeDeliveriesList = deliveries.filter((d) => {
    if (d.status === 'rejected') return false;
    if (filterTab === 'assigned') return d.status === 'assigned';
    if (filterTab === 'active') return d.status === 'accepted' || d.status === 'out_for_delivery';
    if (filterTab === 'completed') return d.status === 'delivered';
    return true;
  });

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
          borderRadius: 16,
          padding: '24px 28px',
          color: '#fff',
          marginBottom: 20,
          boxShadow: '0 10px 25px -5px rgba(37,99,235,0.3)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16
        }}
      >
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            <Zap size={14} color="#facc15" /> DELIVERY PARTNER PORTAL
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: '4px 0' }}>
            Good Afternoon, {userName} 👋
          </h1>
          <p style={{ color: '#bfdbfe', fontSize: 14, margin: 0 }}>
            {vehicleLocation ? `Vehicle: ${vehicleLocation}` : 'Assigned Staff Agent'} • Ready for dispatch
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setShowNotifications(true)}
            style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 12,
              padding: 10,
              color: '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Notifications"
          >
            <Bell size={20} />
            {unreadNotifCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#ef4444',
                  border: '2px solid #2563eb'
                }}
              />
            )}
          </button>
        </div>
      </div>

      {message && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '12px 16px', borderRadius: 10, marginBottom: 20, fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{message}</span>
          <button onClick={() => setMessage('')} style={{ background: 'none', border: 'none', color: '#1e40af', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* Metric Cards */}
      <section className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="metric-card strong purple">
          <Truck />
          <span>Assigned Tasks</span>
          <strong>{deliveries.filter((d) => d.status !== 'delivered' && d.status !== 'rejected').length}</strong>
        </div>
        <div className="metric-card green">
          <PackageCheck />
          <span>Delivered Today</span>
          <strong>{deliveries.filter((d) => d.status === 'delivered').length}</strong>
        </div>
        <div className="metric-card orange">
          <RotateCcw />
          <span>Vehicle Stock</span>
          <strong>{vehicleFilledStock}</strong>
        </div>
        <div className="metric-card blue">
          <Package />
          <span>Total Orders</span>
          <strong>{deliveries.length}</strong>
        </div>
      </section>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
        <button
          className={`filter-tab-btn ${filterTab === 'all' ? 'active' : ''}`}
          onClick={() => setFilterTab('all')}
          style={{ padding: '8px 16px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: filterTab === 'all' ? '#2563eb' : '#f1f5f9', color: filterTab === 'all' ? '#fff' : '#64748b' }}
        >
          All ({deliveries.filter(d => d.status !== 'rejected').length})
        </button>
        <button
          className={`filter-tab-btn ${filterTab === 'assigned' ? 'active' : ''}`}
          onClick={() => setFilterTab('assigned')}
          style={{ padding: '8px 16px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: filterTab === 'assigned' ? '#2563eb' : '#f1f5f9', color: filterTab === 'assigned' ? '#fff' : '#64748b' }}
        >
          New Assigned ({deliveries.filter(d => d.status === 'assigned').length})
        </button>
        <button
          className={`filter-tab-btn ${filterTab === 'active' ? 'active' : ''}`}
          onClick={() => setFilterTab('active')}
          style={{ padding: '8px 16px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: filterTab === 'active' ? '#2563eb' : '#f1f5f9', color: filterTab === 'active' ? '#fff' : '#64748b' }}
        >
          Active Deliveries ({deliveries.filter(d => d.status === 'accepted' || d.status === 'out_for_delivery').length})
        </button>
        <button
          className={`filter-tab-btn ${filterTab === 'completed' ? 'active' : ''}`}
          onClick={() => setFilterTab('completed')}
          style={{ padding: '8px 16px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer', background: filterTab === 'completed' ? '#2563eb' : '#f1f5f9', color: filterTab === 'completed' ? '#fff' : '#64748b' }}
        >
          Completed ({deliveries.filter(d => d.status === 'delivered').length})
        </button>
      </div>

      {/* Content Grid */}
      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activeDeliveriesList.map((delivery) => {
            const isOnline = delivery.booking_payment_method === 'ONLINE' || delivery.booking_payment_status === 'PAID';
            const totalOrderAmount = Number(delivery.rate || 0) * delivery.quantity;
            const form = collections[delivery.id] || {
              amount: String(totalOrderAmount),
              method: 'cash',
              paid_method: 'cash',
              empty: String(delivery.quantity),
              split_cash: '',
              split_gpay: '',
              split_bank: ''
            };

            return (
              <div
                key={delivery.id}
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  padding: 20,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14
                }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                      {delivery.customer_name}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2563eb', fontSize: 13, fontWeight: 600, marginTop: 4 }}>
                      <Phone size={14} />
                      <a href={`tel:${delivery.customer_phone}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                        {delivery.customer_phone || 'No phone'}
                      </a>
                    </div>
                  </div>
                  <span
                    style={{
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: 'capitalize',
                      background:
                        delivery.status === 'assigned'
                          ? '#fef3c7'
                          : delivery.status === 'out_for_delivery' || delivery.status === 'accepted'
                          ? '#eff6ff'
                          : '#dcfce7',
                      color:
                        delivery.status === 'assigned'
                          ? '#92400e'
                          : delivery.status === 'out_for_delivery' || delivery.status === 'accepted'
                          ? '#1e40af'
                          : '#166534'
                    }}
                  >
                    {delivery.status.replaceAll('_', ' ')}
                  </span>
                </div>

                {/* Address */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#f8fafc', padding: '10px 12px', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                  <MapPin size={16} color="#64748b" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: '#334155' }}>
                    {delivery.customer_address || 'Address not specified'}
                  </span>
                </div>

                {/* Details summary */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, background: '#f1f5f9', padding: 12, borderRadius: 8 }}>
                  <div>
                    <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Product</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{delivery.quantity}x {delivery.cylinder_type_name}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#2563eb' }}>{money(totalOrderAmount)}</div>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Payment</span>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isOnline ? '#166534' : '#b45309' }}>
                      {isOnline ? 'Online Paid' : 'COD'}
                    </div>
                  </div>
                </div>

                {/* Action Controls */}
                {delivery.status === 'assigned' && (
                  <div>
                    {rejectingId === delivery.id ? (
                      <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: 12, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#9f1239' }}>
                          Select Rejection Reason:
                          <select
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            style={{ width: '100%', marginTop: 6, padding: 8, borderRadius: 6, border: '1px solid #fca5a5' }}
                          >
                            <option value="Too far">Too far</option>
                            <option value="Currently unavailable">Currently unavailable</option>
                            <option value="Vehicle issue">Vehicle issue</option>
                            <option value="Already handling another delivery">Already handling another delivery</option>
                            <option value="Other">Other</option>
                          </select>
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => reject(delivery.id)} style={{ flex: 1, padding: '8px 14px', background: '#e11d48', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>Confirm Reject</button>
                          <button onClick={() => setRejectingId(null)} style={{ padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button
                          onClick={() => accept(delivery.id)}
                          style={{
                            flex: 1,
                            padding: '10px 16px',
                            background: '#16a34a',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            cursor: 'pointer'
                          }}
                        >
                          <CheckCircle2 size={18} /> Accept Delivery
                        </button>
                        <button
                          onClick={() => setRejectingId(delivery.id)}
                          style={{
                            padding: '10px 16px',
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            color: '#475569',
                            borderRadius: 8,
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {delivery.status === 'accepted' && (
                  <div>
                    <button
                      onClick={() => start(delivery.id)}
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer'
                      }}
                    >
                      <Navigation size={18} /> Start Delivery &amp; Notify Customer
                    </button>
                  </div>
                )}

                {delivery.status === 'out_for_delivery' && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: 14, borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {isOnline ? (
                      <div style={{ color: '#166534', fontWeight: 600, fontSize: 13 }}>✓ Paid Online — No cash collection needed.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>COD Collection: {money(totalOrderAmount)}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <label style={{ fontSize: 12, fontWeight: 600 }}>
                            Payment Mode:
                            <select
                              value={form.method}
                              onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, method: e.target.value } }))}
                              style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                            >
                              <option value="cash">Cash</option>
                              <option value="gpay">GPay</option>
                              <option value="bank">Bank</option>
                              <option value="split">Split</option>
                            </select>
                          </label>
                          {form.method !== 'split' && (
                            <label style={{ fontSize: 12, fontWeight: 600 }}>
                              Collected:
                              <input
                                type="number"
                                value={form.amount}
                                onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, amount: e.target.value } }))}
                                style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                              />
                            </label>
                          )}
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#1e293b' }}>
                          <input
                            type="checkbox"
                            checked={!!codConfirmed[delivery.id]}
                            onChange={(e) => setCodConfirmed((prev) => ({ ...prev, [delivery.id]: e.target.checked }))}
                          />
                          <span>Confirm Payment Collected from Customer</span>
                        </label>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'flex-end' }}>
                      <label style={{ fontSize: 12, fontWeight: 600 }}>
                        Empty Returned:
                        <input
                          type="number"
                          min="0"
                          value={form.empty}
                          onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, empty: e.target.value } }))}
                          style={{ width: '100%', marginTop: 4, padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                        />
                      </label>
                      <button
                        onClick={() => complete(delivery.id, !isOnline, totalOrderAmount)}
                        disabled={!isOnline && !codConfirmed[delivery.id]}
                        style={{
                          padding: '10px 14px',
                          background: (!isOnline && !codConfirmed[delivery.id]) ? '#94a3b8' : '#16a34a',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          fontWeight: 700,
                          cursor: (!isOnline && !codConfirmed[delivery.id]) ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <CheckCircle2 size={16} /> Complete Delivery
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {activeDeliveriesList.length === 0 && (
            <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 40, textAlign: 'center' }}>
              <Truck size={36} color="#94a3b8" style={{ marginBottom: 12 }} />
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#475569', margin: 0 }}>No deliveries matching filter</h3>
              <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>You will receive real-time notifications when new orders are assigned.</p>
            </div>
          )}
        </div>

        {/* Vehicle Stock Panel */}
        <div>
          <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                {vehicleLocation || 'Vehicle'} Stock Inventory
              </h3>
              <PackageCheck size={20} color="#2563eb" />
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cylinder</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.cylinder_type_name}</strong></td>
                      <td>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600, background: row.status === 'filled' ? '#dcfce7' : '#fef3c7', color: row.status === 'filled' ? '#15803d' : '#b45309' }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 15 }}>{row.quantity}</td>
                    </tr>
                  ))}
                  {filteredStock.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>
                        No vehicle stock assigned.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Notifications Drawer Modal */}
      {showNotifications && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', maxWidth: 360, height: '100%', padding: 20, display: 'flex', flexDirection: 'column', boxShadow: '-5px 0 25px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #f1f5f9', paddingBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Staff Notifications</h2>
              <button onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => void handleMarkRead(n.id)}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: n.is_read ? '#f8fafc' : '#eff6ff',
                    border: n.is_read ? '1px solid #e2e8f0' : '1px solid #bfdbfe',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <strong style={{ fontSize: 14, color: '#1e293b' }}>{n.title}</strong>
                    <small style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                  </div>
                  <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>{n.body}</p>
                </div>
              ))}
              {notifications.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40 }}>No alerts received yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
