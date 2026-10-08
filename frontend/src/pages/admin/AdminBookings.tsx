import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardList, Truck, X } from 'lucide-react';
import { api, extractApiError, fetchAllPages, LIMITS } from '../../lib/api';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { Pager } from '../../components/Pager';
import { usePager } from '../../hooks/usePager';

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
  delivery_status?: string | null;
  delivery_staff_name?: string | null;
  delivery_rejection_reason?: string | null;
  needs_reassignment?: boolean;
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
  const [error, setError] = useState('');
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [staffLoadError, setStaffLoadError] = useState('');
  const [approveBusyId, setApproveBusyId] = useState<number | null>(null);

  const [rejectBookingId, setRejectBookingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);

  const { page, pageCount, pageItems, setPage, total } = usePager(bookings);

  const load = useCallback(() => Promise.allSettled([
    fetchAllPages<Booking>('/bookings/'),
    fetchAllPages<Staff>('/staff-profiles/'),
  ]).then(([bookingsResult, staffResult]) => {
    if (bookingsResult.status === 'fulfilled') {
      const rows = bookingsResult.value;
      setBookings(rows);
      setStaffByBooking(Object.fromEntries(rows.map((b) => [b.id, String(b.assigned_staff || '')])));
      setLoadError('');
      setLoadStatus('ready');
    } else {
      setLoadError(extractApiError(bookingsResult.reason, [], 'Could not load bookings.'));
      setLoadStatus('error');
    }
    if (staffResult.status === 'fulfilled') {
      setStaff(staffResult.value);
      setStaffLoadError('');
    } else {
      setStaffLoadError(extractApiError(staffResult.reason, [], 'Could not load the staff list.'));
    }
  }), []);

  useEffect(() => { void load(); }, [load]);

  async function approve(id: number) {
    if (approveBusyId !== null) return;
    const assigned_staff = staffByBooking[id];
    setMessage('');
    setError('');
    const booking = bookings.find((b) => b.id === id);
    if (booking?.needs_reassignment && !assigned_staff) {
      setError('Pick a different staff member before reassigning.');
      return;
    }
    setApproveBusyId(id);
    try {
      await api.post(`/bookings/${id}/approve/`, { assigned_staff });
      setMessage('Booking approved and assigned.');
      await load();
    } catch (err) {
      setError(extractApiError(err, ['assigned_staff'], 'Failed to approve booking.'));
    } finally {
      setApproveBusyId(null);
    }
  }

  async function reject(id: number) {
    if (rejectBusy) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('Please provide a reason for rejection.');
      return;
    }
    if (reason.length > LIMITS.adminReason) {
      setRejectError(`Reason must be ${LIMITS.adminReason} characters or fewer.`);
      return;
    }
    setRejectBusy(true);
    setRejectError('');
    try {
      await api.post(`/bookings/${id}/reject/`, { reason });
      setMessage('Booking rejected.');
      setError('');
      setRejectBookingId(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setRejectError(extractApiError(err, ['reason'], 'Failed to reject booking.'));
    } finally {
      setRejectBusy(false);
    }
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
      {error && <p className="form-error" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      {staffLoadError && (
        <p className="form-error" role="alert" style={{ marginBottom: 12 }}>
          {staffLoadError}{' '}
          <button type="button" className="async-inline-retry" onClick={() => void load()}>Retry</button>
        </p>
      )}

      {loadStatus === 'error' && (
        <ErrorState message={loadError} onRetry={() => { setLoadStatus('loading'); void load(); }} />
      )}

      {loadStatus !== 'error' && (
      <div className="card">
        <div className="section-head">
          <h2>Requests</h2>
          <ClipboardList />
        </div>
        {loadStatus === 'loading' && <LoadingState label="Loading bookings…" />}
        {loadStatus === 'ready' && (
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
              {pageItems.map((booking) => (
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
                    {booking.status === 'pending' && booking.needs_reassignment && (
                      <p style={{ marginTop: 4 }}>
                        <span className="badge badge-warning" style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                          Declined by {booking.delivery_staff_name || 'staff'}
                          {booking.delivery_rejection_reason ? `: ${booking.delivery_rejection_reason}` : ''}
                        </span>
                      </p>
                    )}
                    {booking.status !== 'pending' && booking.delivery_status && booking.delivery_status !== booking.status && (
                      <p style={{ marginTop: 4 }}>
                        <span className={`badge ${
                          booking.delivery_status === 'accepted' ? 'badge-info' :
                          booking.delivery_status === 'cancelled' ? 'badge-danger' : 'badge'
                        }`}>
                          <Truck size={12} /> {booking.delivery_status.replaceAll('_', ' ')}
                        </span>
                      </p>
                    )}
                  </td>
                  <td>
                    {booking.status === 'pending' ? (
                      <select
                        value={staffByBooking[booking.id] || ''}
                        onChange={(e) => setStaffByBooking((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                      >
                        <option value="">{booking.needs_reassignment ? 'Select staff (required)' : 'Select staff'}</option>
                        {staff.map((s) => {
                          const name = s.full_name || s.username;
                          const declined = Boolean(booking.needs_reassignment && booking.delivery_staff_name && name === booking.delivery_staff_name);
                          return (
                            <option key={s.id} value={s.user} disabled={declined}>
                              {declined ? `${name} (declined)` : name}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      booking.assigned_staff_name || '-'
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {booking.status === 'pending' ? (
                      <div style={{ display: 'inline-flex', gap: 8 }}>
                        <button
                          className="icon-button"
                          title={booking.needs_reassignment ? 'Reassign & Approve' : 'Approve & Assign'}
                          aria-label={booking.needs_reassignment ? 'Reassign & Approve' : 'Approve & Assign'}
                          disabled={approveBusyId !== null}
                          aria-busy={approveBusyId === booking.id}
                          onClick={() => approve(booking.id)}
                        >
                          <Check size={18} />
                        </button>
                        <button
                          className="icon-button"
                          title="Reject Booking"
                          aria-label="Reject Booking"
                          disabled={approveBusyId !== null}
                          onClick={() => {
                            setRejectBookingId(booking.id);
                            setRejectReason('');
                            setRejectError('');
                          }}
                        >
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
          <Pager page={page} pageCount={pageCount} onChange={setPage} total={total} />
        </div>
        )}
      </div>
      )}

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
              style={{ width: '100%', padding: '8px', marginBottom: '4px' }}
              maxLength={LIMITS.adminReason}
              aria-invalid={Boolean(rejectError)}
              disabled={rejectBusy}
            />
            <small style={{ display: 'block', textAlign: 'right', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {rejectReason.length}/{LIMITS.adminReason}
            </small>
            {rejectError && <p className="form-error" role="alert" style={{ fontSize: '12px', marginBottom: '16px' }}>{rejectError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button className="btn" style={{ background: '#f3f4f6', color: '#374151' }} disabled={rejectBusy} onClick={() => setRejectBookingId(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#dc2626' }} disabled={rejectBusy} onClick={() => reject(rejectBookingId)}>
                {rejectBusy ? 'Rejecting…' : 'Reject Order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
