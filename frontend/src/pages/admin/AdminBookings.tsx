import { PaymentSummary, type PaymentFacts } from '../../components/PaymentSummary';
import { useSearchParams } from 'react-router-dom';
import { BookingDetailItems } from '../../components/BookingDetailItems';
import { type BookingItem } from '../../components/BookingItems';
import { type PricingSnapshot } from '../../components/PricingBreakdown';
import { BookingTimes } from '../../components/BookingTimes';
import { useCallback, useEffect, useState } from 'react';
import { Check, ClipboardList, Truck, X } from 'lucide-react';
import { api, extractApiError, fetchAllPages, LIMITS } from '../../lib/api';
import { ErrorState } from '../../components/AsyncState';
import { Pager } from '../../components/Pager';
import { usePager } from '../../hooks/usePager';
import { bookingStatusTone, deliveryStatusTone } from '../../components/bookingStatus';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardFooter, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input, Select } from '../../components/ui/Field';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';

type Booking = PricingSnapshot & {
  payment_summary?: PaymentFacts;
  id: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  order_items?: BookingItem[];
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
  delivered_at?: string | null;
  rejected_at?: string | null;
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
  const [selectedBooking, setDetailBooking] = useState<Booking | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

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

  const requestedBookingId = searchParams.get('booking');
  const linkedBooking = loadStatus === 'ready' && requestedBookingId
    ? bookings.find(row => String(row.id) === requestedBookingId) : null;
  const detailBooking = selectedBooking ?? linkedBooking ?? null;
  const missingLinkedBooking = loadStatus === 'ready' && requestedBookingId && !linkedBooking;

  function closeDetails() {
    setDetailBooking(null);
    if (requestedBookingId) {
      const next = new URLSearchParams(searchParams);
      next.delete('booking');
      setSearchParams(next, { replace: true });
    }
  }

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
      <PageHeader
        title="Booking Control"
        description="Approve customer requests, assign delivery staff, and watch status move through delivery."
      />

      {missingLinkedBooking && <Alert tone="danger" role="alert" className="ui-alert--block-sm">This booking is no longer available.</Alert>}
      {message && <Alert tone="success" className="ui-alert--block-sm">{message}</Alert>}
      {error && <Alert tone="danger" role="alert" className="ui-alert--block-sm">{error}</Alert>}
      {staffLoadError && (
        <Alert
          tone="danger"
          role="alert"
          className="ui-alert--block-sm"
          actions={<Button type="button" variant="link" size="sm" onClick={() => void load()}>Retry</Button>}
        >
          {staffLoadError}
        </Alert>
      )}

      {loadStatus === 'error' && (
        <ErrorState message={loadError} onRetry={() => { setLoadStatus('loading'); void load(); }} />
      )}

      {loadStatus !== 'error' && (
      <Card padding="none">
        <CardHeader
          title="Requests"
          meta={loadStatus === 'ready'
            ? <Badge>{total} total</Badge>
            : <ClipboardList size={18} className="ui-card-icon" aria-hidden="true" />}
        />
        {loadStatus === 'loading' && (
          <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={5} label="Loading bookings…" /></div>
        )}
        {loadStatus === 'ready' && bookings.length === 0 && (
          <EmptyState icon={<ClipboardList size={24} />} title="No bookings yet." />
        )}
        {loadStatus === 'ready' && bookings.length > 0 && (
        <TableWrap>
          <Table cards className="bookings-table">
            <thead>
              <tr>
                <Th className="bk-col-customer">Customer</Th>
                <Th className="bk-col-cylinder">Order &amp; items</Th>
                <Th className="bk-col-status">Status</Th>
                <Th className="bk-col-staff">Staff</Th>
                <Th align="right" className="bk-col-actions">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((booking) => (
                <tr key={booking.id}>
                  <Td label="Customer">
                    <strong className="bk-name bk-clamp" title={booking.customer_name}>{booking.customer_name}</strong>
                    <span className="ui-cell-sub">{booking.customer_phone || booking.customer_area}</span>
                    <span className="ui-cell-sub bk-clamp" title={booking.customer_address}>{booking.customer_address}</span>
                  </Td>
                  <Td label="Order & items">
                    <strong className="bk-clamp">{booking.quantity} × {booking.cylinder_type_name}</strong>
                    {booking.order_items?.some(item => item.type === 'accessory') && (
                      <span className="ui-cell-sub bk-clamp" title={booking.order_items.filter(item => item.type === 'accessory').map(item => `${item.quantity} × ${item.name}`).join(', ')}>
                        + {booking.order_items.filter(item => item.type === 'accessory').map(item => `${item.quantity} × ${item.name}`).join(', ')}
                      </span>
                    )}
                    <BookingTimes booking={booking} />
                    <span className="bk-price">
                      {discountAmount(booking) > 0 && <s>{money(originalAmount(booking))}</s>}
                      <strong>Total: {money(finalAmount(booking))}</strong>
                    </span>
                  </Td>
                  <Td label="Status">
                    <div className="bk-status">
                      <Badge tone={bookingStatusTone(booking.status)}>{booking.status.replaceAll('_', ' ')}</Badge>
                      {booking.status === 'rejected' && booking.rejection_reason && (
                        <span className="bk-reason bk-clamp" title={booking.rejection_reason}>Reason: {booking.rejection_reason}</span>
                      )}
                      {booking.status === 'pending' && booking.needs_reassignment && (
                        <Badge tone="warning" square className="ui-badge--wrap">
                          Declined by {booking.delivery_staff_name || 'staff'}
                          {booking.delivery_rejection_reason && <span className="bk-clamp" title={booking.delivery_rejection_reason}>: {booking.delivery_rejection_reason}</span>}
                        </Badge>
                      )}
                      {booking.status !== 'pending' && booking.delivery_status && booking.delivery_status !== booking.status && (
                        <Badge variant="outline" tone={deliveryStatusTone(booking.delivery_status)} icon={<Truck />}>
                          {booking.delivery_status.replaceAll('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td label="Staff">
                    {booking.status === 'pending' ? (
                      <Select
                        selectSize="sm"
                        aria-label="Assign staff"
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
                      </Select>
                    ) : (
                      <span className="bk-clamp" title={booking.assigned_staff_name || undefined}>{booking.assigned_staff_name || '-'}</span>
                    )}
                  </Td>
                  <Td label="Actions" align="right">
                    <div className="bk-action-stack">
                    {booking.status === 'pending' ? (
                      <div className="bk-actions">
                        <IconButton
                          variant="outline"
                          tone="primary"
                          label={booking.needs_reassignment ? 'Reassign & Approve' : 'Approve & Assign'}
                          disabled={approveBusyId !== null}
                          aria-busy={approveBusyId === booking.id}
                          onClick={() => approve(booking.id)}
                        >
                          <Check size={18} />
                        </IconButton>
                        <IconButton
                          variant="outline"
                          tone="danger"
                          label="Reject Booking"
                          disabled={approveBusyId !== null}
                          onClick={() => {
                            setRejectBookingId(booking.id);
                            setRejectReason('');
                            setRejectError('');
                          }}
                        >
                          <X size={18} />
                        </IconButton>
                      </div>
                    ) : (
                      <Badge icon={<Truck />}>{booking.status.replaceAll('_', ' ')}</Badge>
                    )}
                    <Button type="button" variant="secondary" size="sm" onClick={() => setDetailBooking(booking)}>View details</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        )}
        {loadStatus === 'ready' && pageCount > 1 && (
          <CardFooter>
            <Pager page={page} pageCount={pageCount} onChange={setPage} total={total} />
          </CardFooter>
        )}
      </Card>
      )}

      <Modal
        open={detailBooking !== null}
        onClose={closeDetails}
        closeOnEscape
        title={detailBooking ? `Booking #${detailBooking.id}` : 'Booking details'}
        className="bk-detail-modal"
        size="lg"
        footer={<Button type="button" variant="secondary" autoFocus onClick={closeDetails}>Close details</Button>}
      >
        {detailBooking && <div className="bk-detail-content">
          <div className="bk-detail-overview">
          <section>
            <h3>Customer</h3>
            <strong>{detailBooking.customer_name}</strong>
            {detailBooking.customer_phone && <div>{detailBooking.customer_phone}</div>}
            {detailBooking.customer_address && <div>{detailBooking.customer_address}</div>}
            {detailBooking.customer_area && <div>{detailBooking.customer_area}</div>}
          </section>
          <section>
            <h3>Delivery</h3>
            <Badge tone={bookingStatusTone(detailBooking.status)}>{detailBooking.status.replaceAll('_', ' ')}</Badge>
            <BookingTimes booking={detailBooking} />
            <div className="bk-detail-partner">Delivery partner: <strong>{detailBooking.assigned_staff_name || 'Unassigned'}</strong></div>
            {detailBooking.delivery_status && detailBooking.delivery_status !== detailBooking.status && <div>Delivery: {detailBooking.delivery_status.replaceAll('_', ' ')}</div>}
            {detailBooking.rejection_reason && <p className="bk-reason">Reason: {detailBooking.rejection_reason}</p>}
            {detailBooking.needs_reassignment && <p>Declined by {detailBooking.delivery_staff_name || 'staff'}{detailBooking.delivery_rejection_reason ? `: ${detailBooking.delivery_rejection_reason}` : ''}</p>}
          </section>
          </div>
          <section>
            <div className="bk-detail-items-heading"><h3>Ordered items</h3><span>Amount</span></div>
            <PaymentSummary value={detailBooking.payment_summary} />
            <BookingDetailItems items={detailBooking.order_items?.length ? detailBooking.order_items : [{
              ...detailBooking,
              name: detailBooking.cylinder_type_name,
              type: 'cylinder',
              total_amount: String(finalAmount(detailBooking)),
            }]} />
            <div className="bk-detail-total">
              <div><span>Order total</span>{discountAmount(detailBooking) > 0 && <small>Discounts already included</small>}</div>
              <strong>{money(finalAmount(detailBooking)).replace('Rs. ', '₹')}</strong>
            </div>
          </section>
          {detailBooking.note && <details className="bk-detail-note"><summary>Order note</summary><p>{detailBooking.note}</p></details>}
        </div>}
      </Modal>

      <Modal
        open={rejectBookingId !== null}
        size="sm"
        title="Reject Booking"
        description="Please provide a reason for rejecting this order."
        footer={(
          <>
            <Button type="button" variant="secondary" disabled={rejectBusy} onClick={() => setRejectBookingId(null)}>Cancel</Button>
            <Button
              type="button"
              variant="danger"
              disabled={rejectBusy}
              onClick={() => { if (rejectBookingId !== null) void reject(rejectBookingId); }}
            >
              {rejectBusy ? 'Rejecting…' : 'Reject Order'}
            </Button>
          </>
        )}
      >
        <div className="form-stack">
          <Field as="div" hint={`${rejectReason.length}/${LIMITS.adminReason}`}>
            <Input
              type="text"
              aria-label="Rejection reason"
              placeholder="e.g. Out of stock, outside delivery zone"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={LIMITS.adminReason}
              aria-invalid={Boolean(rejectError)}
              disabled={rejectBusy}
            />
          </Field>
          {rejectError && <Alert tone="danger" role="alert" compact>{rejectError}</Alert>}
        </div>
      </Modal>
    </div>
  );
}
