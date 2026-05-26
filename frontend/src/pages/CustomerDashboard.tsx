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
          <h1>{profile?.full_name || 'Customer'}</h1>
          <p>Book cylinders and track delivery status.</p>
        </div>
      </div>

      <section className="stat-grid">
        <div className="metric-card strong">
          <IndianRupee />
          <span>Your Rate</span>
          <strong>{money(activeRate)}</strong>
        </div>
        <div className="metric-card">
          <CalendarClock />
          <span>Pending Amount</span>
          <strong>{money(profile?.pending_amount || 0)}</strong>
        </div>
        <div className="metric-card">
          <PackagePlus />
          <span>Bookings</span>
          <strong>{bookings.length}</strong>
        </div>
        <div className="metric-card">
          <Bell />
          <span>Notifications</span>
          <strong>{notifications.filter((n) => !n.is_read).length}</strong>
        </div>
      </section>

      <form onSubmit={book} className="card form-stack">
        <h2>Book Cylinder</h2>
        <div className="grid-3">
          <label>
            <span>Cylinder</span>
            <select value={cylinderType} onChange={(e) => setCylinderType(e.target.value)} required>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>
            <span>Quantity</span>
            <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            <span>Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
        </div>
        {message && <p className="form-note">{message}</p>}
        <button className="btn btn-primary" type="submit"><PackagePlus size={20} /> Send Booking</button>
      </form>

      <section className="grid-2">
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Booking Status</h2>
          <div className="ledger-list">
            {bookings.map((b) => (
              <div className="ledger-row" key={b.id}>
                <div>
                  <strong>{b.quantity} x {b.cylinder_type_name}</strong>
                  <p>{new Date(b.created_at).toLocaleDateString('en-IN')} - {money(b.rate)} each</p>
                </div>
                <span className="badge badge-warning">{b.status.replaceAll('_', ' ')}</span>
              </div>
            ))}
            {bookings.length === 0 && <p>No bookings yet.</p>}
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Notifications</h2>
          <div className="ledger-list">
            {notifications.slice(0, 6).map((n) => (
              <div className="ledger-row" key={n.id}>
                <div>
                  <strong>{n.title}</strong>
                  <p>{n.body}</p>
                </div>
              </div>
            ))}
            {notifications.length === 0 && <p>No notifications yet.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
