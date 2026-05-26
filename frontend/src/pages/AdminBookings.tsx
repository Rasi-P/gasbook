import { useEffect, useState } from 'react';
import { Check, ClipboardList, Truck, X } from 'lucide-react';
import { api } from '../lib/api';

type Booking = {
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  status: string;
  rate: string;
  note: string;
  assigned_staff: number | null;
  assigned_staff_name: string | null;
  created_at: string;
};

type Staff = { id: number; username: string; full_name: string; assigned_area: string; user: number };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function AdminBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffByBooking, setStaffByBooking] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');

  function load() {
    Promise.all([api.get('/bookings/'), api.get('/staff-profiles/')])
      .then(([bookingRes, staffRes]) => {
        const rows = bookingRes.data.results ?? bookingRes.data;
        setBookings(rows);
        setStaff(staffRes.data.results ?? staffRes.data);
        setStaffByBooking(Object.fromEntries(rows.map((b: Booking) => [b.id, String(b.assigned_staff || '')])));
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function approve(id: number) {
    const assigned_staff = staffByBooking[id];
    await api.post(`/bookings/${id}/approve/`, { assigned_staff });
    setMessage('Booking approved and assigned.');
    load();
  }

  async function reject(id: number) {
    await api.post(`/bookings/${id}/reject/`);
    setMessage('Booking rejected.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Booking Control</h1>
          <p>Approve customer requests, assign delivery staff, and watch status move through delivery.</p>
        </div>
      </div>

      {message && <p className="form-note" style={{ marginBottom: 12 }}>{message}</p>}

      <div className="card">
        <div className="section-head">
          <h2>Requests</h2>
          <ClipboardList />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Cylinder</th>
                <th>Status</th>
                <th>Staff</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    <strong>{booking.customer_name}</strong>
                    <p>{booking.customer_phone || booking.customer_area}</p>
                    <p>{booking.customer_address}</p>
                  </td>
                  <td>
                    <strong>{booking.quantity} x {booking.cylinder_type_name}</strong>
                    <p>{money(booking.rate)} each</p>
                    {booking.note && <p>{booking.note}</p>}
                  </td>
                  <td><span className="badge badge-warning">{booking.status.replaceAll('_', ' ')}</span></td>
                  <td>
                    {booking.status === 'pending' ? (
                      <select
                        value={staffByBooking[booking.id] || ''}
                        onChange={(e) => setStaffByBooking((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                      >
                        <option value="">Select staff</option>
                        {staff.map((s) => <option key={s.id} value={s.user}>{s.full_name || s.username}</option>)}
                      </select>
                    ) : (
                      booking.assigned_staff_name || '-'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {booking.status === 'pending' ? (
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        <button className="icon-button" title="Approve" onClick={() => approve(booking.id)}>
                          <Check size={18} />
                        </button>
                        <button className="icon-button" title="Reject" onClick={() => reject(booking.id)}>
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      <span className="badge"><Truck size={12} /> {booking.status.replaceAll('_', ' ')}</span>
                    )}
                  </td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24 }}>No bookings yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
