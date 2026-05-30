import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Bell, CalendarClock, IndianRupee, PackagePlus } from 'lucide-react';
import { api } from '../lib/api';

type CylinderType = { id: number; name: string; selling_price: number };
type Rate = { cylinder_type: number; custom_price: string };
type Profile = {
  id: number;
  full_name: string;
  pending_amount: string;
  last_delivery_date: string | null;
  custom_rates: Rate[];
  phone: string;
  area: string;
  credit_limit: number;
  deposit_cylinders: number;
};
type Booking = {
  id: number;
  cylinder_type_name: string;
  quantity: number;
  status: string;
  rate: string;
  created_at: string;
};
type Notification = { id: number; title: string; body: string; is_read: boolean; created_at: string };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function getStatusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes('delivered')) return 'badge-success';
  if (s.includes('reject') || s.includes('cancel')) return 'badge-danger';
  if (s.includes('out') || s.includes('delivery') || s.includes('transit')) return 'badge-cyan';
  if (s.includes('approve') || s.includes('confirm')) return 'badge-info';
  return 'badge-warning';
}

export default function CustomerDashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [types, setTypes] = useState<CylinderType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [cylinderType, setCylinderType] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');

  function load() {
    Promise.all([
      api.get('/customer-profiles/'),
      api.get('/cylinder-types/'),
      api.get('/bookings/'),
      api.get('/notifications/'),
    ]).then(([profileRes, typeRes, bookingRes, notificationRes]) => {
      const profileRows = profileRes.data.results ?? profileRes.data;
      const typeRows = typeRes.data.results ?? typeRes.data;
      setProfile(profileRows[0] || null);
      setTypes(typeRows);
      setCylinderType(String(typeRows[0]?.id || ''));
      setBookings(bookingRes.data.results ?? bookingRes.data);
      setNotifications(notificationRes.data.results ?? notificationRes.data);
    }).catch(() => undefined);
  }

  useEffect(load, []);

  const activeType = useMemo(() => types.find((t) => String(t.id) === cylinderType), [types, cylinderType]);
  const activeRate = useMemo(() => {
    const custom = profile?.custom_rates.find((r) => String(r.cylinder_type) === cylinderType);
    return custom?.custom_price || activeType?.selling_price || 0;
  }, [activeType, cylinderType, profile]);

  async function book(e: FormEvent) {
    e.preventDefault();
    await api.post('/bookings/', { cylinder_type: Number(cylinderType), quantity, note });
    setMessage('Booking request sent for admin approval.');
    setQuantity(1);
    setNote('');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>{profile?.full_name || 'Customer Dashboard'}</h1>
          <p>Book refills, manage your special rates, and view live status updates.</p>
        </div>
      </div>

      <section className="stat-grid">
        <div className="metric-card strong purple">
          <IndianRupee />
          <span>Active Book Rate</span>
          <strong>{money(activeRate)}</strong>
        </div>
        <div className="metric-card orange">
          <CalendarClock />
          <span>Pending Dues</span>
          <strong>{money(profile?.pending_amount || 0)}</strong>
        </div>
        <div className="metric-card green">
          <PackagePlus />
          <span>Bookings Filed</span>
          <strong>{bookings.length}</strong>
        </div>
        <div className="metric-card blue">
          <Bell />
          <span>Active Alerts</span>
          <strong>{notifications.filter((n) => !n.is_read).length}</strong>
        </div>
      </section>

      <div className="grid-2" style={{ marginBottom: '16px' }}>
        <form onSubmit={book} className="card form-stack" style={{ marginBottom: 0 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><PackagePlus size={20} style={{ color: 'var(--primary)' }} /> Book Cylinder</h2>
          <div className="form-stack">
            <label>
              <span>Cylinder Size</span>
              <select value={cylinderType} onChange={(e) => setCylinderType(e.target.value)} required>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              <span>Quantity</span>
              <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} required />
            </label>
            <label>
              <span>Delivery Instructions / Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. deliver near back entrance" />
            </label>
            {message && <p className="form-note">{message}</p>}
            <button className="btn btn-primary" type="submit" style={{ marginTop: '8px' }}>
              Send Booking Request
            </button>
          </div>
        </form>

        <div className="card">
          <h2>Refill Rates Lookup</h2>
          <p style={{ fontSize: '0.85rem', marginBottom: '16px' }}>View standard cylinder rates and your account's special pricing agreements.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cylinder Size</th>
                  <th style={{ textAlign: 'right' }}>Standard Price</th>
                  <th style={{ textAlign: 'right' }}>Your Special Price</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => {
                  const custom = profile?.custom_rates.find((r) => r.cylinder_type === t.id);
                  return (
                    <tr key={t.id}>
                      <td><strong>{t.name}</strong></td>
                      <td style={{ textAlign: 'right' }}>{money(t.selling_price)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {custom ? (
                          <span className="badge badge-success" style={{ fontSize: '0.8rem' }}>
                            {money(custom.custom_price)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Standard</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {types.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)' }}>
                      No cylinder sizes configured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '16px' }}>
        <h2>Account Profile & Credit Details</h2>
        <p style={{ fontSize: '0.85rem', marginBottom: '16px', color: 'var(--text-muted)' }}>Linked phone, address, credit limits, and cylinder holdings.</p>
        <div className="summary-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <p style={{ margin: 0, padding: '14px', background: 'var(--surface-muted)', borderRadius: 'var(--radius)' }}>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Registered Phone</span>
            <strong style={{ fontSize: '1.1rem', display: 'block', marginTop: '4px', color: 'var(--text)' }}>{profile?.phone || '—'}</strong>
          </p>
          <p style={{ margin: 0, padding: '14px', background: 'var(--surface-muted)', borderRadius: 'var(--radius)' }}>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Service Area</span>
            <strong style={{ fontSize: '1.1rem', display: 'block', marginTop: '4px', color: 'var(--text)' }}>{profile?.area || '—'}</strong>
          </p>
          <p style={{ margin: 0, padding: '14px', background: 'var(--surface-muted)', borderRadius: 'var(--radius)' }}>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Credit Limit</span>
            <strong style={{ fontSize: '1.1rem', display: 'block', marginTop: '4px', color: 'var(--text)' }}>{money(profile?.credit_limit || 0)}</strong>
          </p>
          <p style={{ margin: 0, padding: '14px', background: 'var(--surface-muted)', borderRadius: 'var(--radius)' }}>
            <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Cylinder Deposit</span>
            <strong style={{ fontSize: '1.1rem', display: 'block', marginTop: '4px', color: 'var(--text)' }}>{profile?.deposit_cylinders || 0} empty</strong>
          </p>
        </div>
        {profile?.last_delivery_date && (
          <p style={{ marginTop: '14px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Last cylinder refill delivered: <span style={{ color: 'var(--primary)' }}>{new Date(profile.last_delivery_date).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>
          </p>
        )}
      </div>

      <section className="grid-2">
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Booking Status Tracker</h2>
          <p style={{ fontSize: '0.85rem', marginBottom: '16px', color: 'var(--text-muted)' }}>Track approval, dispatch, and delivery details of your cylinder bookings.</p>
          <div className="ledger-list">
            {bookings.map((b) => (
              <div className="ledger-row" key={b.id}>
                <div>
                  <strong>{b.quantity} x {b.cylinder_type_name}</strong>
                  <p>{new Date(b.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })} - {money(b.rate)} each</p>
                </div>
                <span className={`badge ${getStatusBadgeClass(b.status)}`}>
                  {b.status.replaceAll('_', ' ').toUpperCase()}
                </span>
              </div>
            ))}
            {bookings.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No refill requests filed yet.</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Live Dispatch Updates</h2>
          <p style={{ fontSize: '0.85rem', marginBottom: '16px', color: 'var(--text-muted)' }}>Real-time updates regarding order approvals, starts, and completions.</p>
          <div className="ledger-list">
            {notifications.slice(0, 6).map((n) => (
              <div className="ledger-row" key={n.id}>
                <div>
                  <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text)' }}>
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: n.is_read ? 'var(--text-muted)' : 'var(--primary)' }} />
                    {n.title}
                  </strong>
                  <p style={{ marginTop: '4px', fontSize: '0.88rem' }}>{n.body}</p>
                </div>
              </div>
            ))}
            {notifications.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No live updates available yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
