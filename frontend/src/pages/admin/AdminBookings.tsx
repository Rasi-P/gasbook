import { useEffect, useState } from 'react';
import { Check, ClipboardList, Truck, X } from 'lucide-react';
import { api } from '../../lib/api';

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
  original_amount?: string;
  discount_amount?: string;
  final_amount?: string;
  total_amount?: string;
  has_discount?: boolean;
  note: string;
  assigned_staff: number | null;
  assigned_staff_name: string | null;
  rejection_reason?: string | null;
  created_at: string;
};

type Staff = { id: number; username: string; full_name: string; assigned_area: string; user: number };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function originalAmount(booking: Booking) {
  return Number(booking.original_amount || Number(booking.rate || 0) * booking.quantity || 0);
}

function discountAmount(booking: Booking) {
  return Number(booking.discount_amount || 0);
}

function finalAmount(booking: Booking) {
  return Number(booking.final_amount || booking.total_amount || originalAmount(booking));
}

export default function AdminBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffByBooking, setStaffByBooking] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  
  const [rejectBookingId, setRejectBookingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  function load() {
    const p1 = api.get('/bookings/').then((r) => r.data.results ?? r.data).catch(() => []);
    const p2 = api.get('/staff-profiles/').then((r) => r.data.results ?? r.data).catch(() => []);
    Promise.all([p1, p2])
      .then(([rows, staffRows]) => {
        setBookings(rows);
        setStaff(staffRows);
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
    if (!rejectReason.trim()) {
      setRejectError('Please provide a reason for rejection.');
      return;
    }
    await api.post(`/bookings/${id}/reject/`, { reason: rejectReason.trim() });
    setMessage('Booking rejected.');
    setRejectBookingId(null);
    setRejectReason('');
    setRejectError('');
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
                    {discountAmount(booking) > 0 && (
                      <p style={{ marginTop: 4 }}>
                        <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 8 }}>{money(originalAmount(booking))}</span>
                        <strong style={{ color: '#16a34a' }}>{money(finalAmount(booking))}</strong>
                      </p>
                    )}
                    {booking.note && <p>{booking.note}</p>}
                  </td>
                  <td>
                    <span className={`badge ${
                      booking.status === 'pending' ? 'badge-warning' :
                      booking.status === 'approved' ? 'badge-info' :
                      booking.status === 'accepted' ? 'badge-info' :
                      booking.status === 'out_for_delivery' ? 'badge-warning' :
                      booking.status === 'delivered' ? 'badge-success' : 'badge'
                    }`}>
                      {booking.status.replaceAll('_', ' ')}
                    </span>
                    {booking.status === 'rejected' && booking.rejection_reason && (
                      <p style={{ fontSize: '12px', color: '#dc2626', marginTop: 4 }}>Reason: {booking.rejection_reason}</p>
                    )}
                  </td>
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
                        <button className="icon-button" title="Approve & Assign" onClick={() => approve(booking.id)}>
                          <Check size={18} />
                        </button>
                        <button className="icon-button" title="Reject Booking" onClick={() => {
                          setRejectBookingId(booking.id);
                          setRejectReason('');
                          setRejectError('');
                        }}>
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

      {rejectBookingId !== null && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
          <div className="modal-content" style={{ backgroundColor: '#fff', margin: '15% auto', padding: '24px', borderRadius: '8px', maxWidth: '400px' }}>
            <h3>Reject Booking</h3>
            <p style={{ marginBottom: '16px' }}>Please provide a reason for rejecting this order.</p>
            <input
              type="text"
              placeholder="e.g. Out of stock, outside delivery zone"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
              maxLength={250}
            />
            {rejectError && <p style={{ color: '#dc2626', fontSize: '12px', marginBottom: '16px' }}>{rejectError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="btn" style={{ background: '#f3f4f6', color: '#374151' }} onClick={() => setRejectBookingId(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#dc2626' }} onClick={() => reject(rejectBookingId)}>Reject Order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
