import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Mail,
  Navigation,
  Phone,
  Truck,
  User,
  ChevronRight,
  History,
  Check,
  LogOut,
  Pencil,
  RefreshCw,
  X
} from 'lucide-react';
import { api, logout, extractApiError, fetchAllPages, getApiErrorCode, LIMITS } from '../../lib/api';
import cylinderImg from '../../assets/splash_cylinder.png';
import { LoadingState } from '../../components/AsyncState';
import { Alert } from '../../components/ui/Alert';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonClass';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { IconButton } from '../../components/ui/IconButton';
import { Modal } from '../../components/ui/Modal';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Tabs } from '../../components/ui/Tabs';

type Delivery = {
  id: number;
  booking: number;
  order_id?: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  rate: string;
  original_amount?: string;
  discount_amount?: string;
  final_amount?: string;
  has_discount?: boolean;
  pending_amount: string;
  deposit_cylinders: number;
  booking_payment_method?: string;
  booking_payment_status?: string;
  created_at?: string;
  updated_at?: string;
};



type NotificationItem = {
  id: number;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
};

type StaffProfileData = {
  id: number;
  username: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
  address?: string;
  date_joined?: string;
  vehicle_location_name?: string | null;
  assigned_area?: string | null;
  vehicle_number?: string | null;
  staff_image_url?: string | null;
};

function money(v: number | string) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

// The order number shown to staff is the booking's id (GB{booking}), never the delivery row id.
function orderRef(d: Delivery) {
  return d.order_id || `GB${d.booking}`;
}

function originalAmount(delivery: Delivery) {
  return Number(delivery.original_amount || Number(delivery.rate || 0) * delivery.quantity || 0);
}

function discountAmount(delivery: Delivery) {
  return Number(delivery.discount_amount || 0);
}

function finalAmount(delivery: Delivery) {
  return Number(delivery.final_amount || originalAmount(delivery));
}

// Staff see the struck-through original while picking up and delivering, so the
// amount they collect is unambiguous. History shows the settled amount only.
type AmountTone = 'primary' | 'success' | 'warning' | 'neutral';

function AmountToCollect({
  delivery,
  showOriginal,
  tone = 'primary',
}: {
  delivery: Delivery;
  showOriginal: boolean;
  tone?: AmountTone;
}) {
  const isDiscounted = showOriginal && discountAmount(delivery) > 0;
  return (
    <div className="sa-amount">
      {isDiscounted && (
        <div className="sa-amount__original">
          {money(originalAmount(delivery))}
        </div>
      )}
      <span className={`sa-amount__value sa-amount__value--${tone}`}>{money(finalAmount(delivery))}</span>
    </div>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  assigned: 'warning',
  accepted: 'primary',
  out_for_delivery: 'primary',
  delivered: 'success',
};

function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] || 'neutral';
}

function formatJoinDate(value?: string) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export default function StaffMobileLayout() {
  const [activeTab, setActiveTab] = useState<'home' | 'deliveries' | 'history' | 'profile'>('home');
  const [filterTab, setFilterTab] = useState<'all' | 'assigned' | 'active' | 'completed'>('all');
  
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notifError, setNotifError] = useState('');

  const [collections, setCollections] = useState<
    Record<
      number,
      { amount: string; method: string; paid_method: string; empty: string }
    >
  >({});
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info' | 'error'>('info');
  const [userName, setUserName] = useState('');
  const [vehicleLocation, setVehicleLocation] = useState('');
  const [staffProfile, setStaffProfile] = useState<StaffProfileData | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editProfileValues, setEditProfileValues] = useState({ full_name: '', phone: '', email: '', address: '' });
  const [editProfileError, setEditProfileError] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('Too far');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [codConfirmed, setCodConfirmed] = useState<Record<number, boolean>>({});

  // Dynamic Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  function showInfo(text: string) {
    setMessageTone('info');
    setMessage(text);
  }

  function showError(text: string) {
    setMessageTone('error');
    setMessage(text);
  }

  function load() {
    setIsLoading(true);
    setLoadError('');
    setUserName(localStorage.getItem('gasbook_name') || 'Staff Partner');
    setVehicleLocation(localStorage.getItem('gasbook_vehicle_location') || '');

    Promise.all([
      api.get('/auth/me/'),
      fetchAllPages<Delivery>('/deliveries/'),
      fetchAllPages<NotificationItem>('/notifications/')
        .then((rows) => ({ rows, error: '' }))
        .catch((err) => ({ rows: null, error: extractApiError(err, [], 'Notifications unavailable.') })),
    ])
      .then(([meRes, rows, notif]) => {
        setStaffProfile(meRes.data);
        setUserName(meRes.data.name || localStorage.getItem('gasbook_name') || 'Staff Partner');
        setVehicleLocation(meRes.data.vehicle_location_name || '');
        setDeliveries(rows);
        if (notif.rows) {
          setNotifications(notif.rows);
          setNotifError('');
        } else {
          setNotifError(notif.error);
        }
        setCollections(
          Object.fromEntries(
            rows.map((d: Delivery) => [
              d.id,
              {
                amount: String(finalAmount(d)),
                method: 'cash',
                paid_method: 'cash',
                empty: String(d.quantity)
              }
            ])
          )
        );
      })
      .catch((err) => {
        setLoadError(extractApiError(err, [], 'Could not load your deliveries.'));
      })
      .finally(() => setIsLoading(false));
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

  async function accept(id: number) {
    if (actionBusyId !== null) return;
    setActionBusyId(id);
    try {
      await api.post(`/deliveries/${id}/accept/`);
      showInfo('Delivery accepted!');
      load();
    } catch (err) {
      showError(extractApiError(err, [], 'Failed to accept delivery.'));
    } finally {
      setActionBusyId(null);
    }
  }

  async function reject(id: number) {
    if (rejectBusy) return;
    const reason = rejectReason.trim();
    if (!reason) {
      showError('Please select a reason.');
      return;
    }
    if (reason.length > LIMITS.staffReason) {
      showError(`Reason must be ${LIMITS.staffReason} characters or fewer.`);
      return;
    }
    setRejectBusy(true);
    try {
      await api.post(`/deliveries/${id}/reject/`, { reason });
      showInfo('Delivery declined. Admin will reassign it.');
      setRejectingId(null);
      load();
    } catch (err) {
      showError(extractApiError(err, ['reason'], 'Failed to decline delivery.'));
    } finally {
      setRejectBusy(false);
    }
  }

  async function start(id: number) {
    if (actionBusyId !== null) return;
    setActionBusyId(id);
    try {
      await api.post(`/deliveries/${id}/start/`);
      showInfo('Delivery started. Customer notified.');
      load();
    } catch (err) {
      showError(extractApiError(err, [], 'Failed to start delivery.'));
    } finally {
      setActionBusyId(null);
    }
  }

  async function complete(id: number, isCod: boolean, totalAmount: number) {
    if (actionBusyId !== null) return;
    const form = collections[id] || {
      amount: String(totalAmount),
      method: 'cash',
      paid_method: 'cash',
      empty: '1'
    };

    if (isCod && !codConfirmed[id]) {
      showError('Please confirm payment collected from customer.');
      return;
    }

    const payload = {
      payment_method: isCod ? form.method : 'gpay',
      empty_collected: Number(form.empty || 0),
      payment_collected: String(totalAmount)
    };

    setActionBusyId(id);
    try {
      await api.post(`/deliveries/${id}/complete/`, payload);
      showInfo('Delivery completed successfully!');
      load();
    } catch (err) {
      const code = getApiErrorCode(err);
      const detail = extractApiError(err, ['empty_collected', 'payment_collected', 'split_payments'], 'Failed to complete delivery.');
      if (code === 'insufficient_stock') {
        showError(`Stock not loaded — contact admin: ${detail}`);
      } else if (code === 'already_completed') {
        showError(detail);
        load();
      } else {
        showError(detail);
      }
    } finally {
      setActionBusyId(null);
    }
  }

  // Filtered Delivery Lists
  const pendingAssignments = deliveries.filter((d) => d.status === 'assigned');
  const activeDelivery = deliveries.find((d) => d.status === 'accepted' || d.status === 'out_for_delivery');
  const completedDeliveries = deliveries.filter((d) => d.status === 'delivered');
  const recentCompleted = completedDeliveries.length > 0 ? completedDeliveries[0] : null;

  const assignedCount = pendingAssignments.length;
  const activeCount = deliveries.filter((d) => d.status === 'accepted' || d.status === 'out_for_delivery').length;
  const completedCount = completedDeliveries.length;
  const profileInitials = (staffProfile?.name || userName || 'SP')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const profileRows = [
    { icon: <User size={16} />, label: 'Full Name', value: staffProfile?.name || userName || 'Not available' },
    { icon: <Phone size={16} />, label: 'Phone Number', value: staffProfile?.phone || 'Not available' },
    { icon: <Mail size={16} />, label: 'Email Address', value: staffProfile?.email || 'Not available' },
    { icon: <MapPin size={16} />, label: 'Address', value: staffProfile?.address || 'Not available' },
    { icon: <CalendarDays size={16} />, label: 'Member Since', value: formatJoinDate(staffProfile?.date_joined) },
  ];

  function openEditProfile() {
    setEditProfileValues({
      full_name: staffProfile?.name || userName || '',
      phone: staffProfile?.phone || '',
      email: staffProfile?.email || '',
      address: staffProfile?.address || '',
    });
    setEditProfileError('');
    setShowEditProfile(true);
  }

  async function saveProfileChanges(e: React.FormEvent) {
    e.preventDefault();
    if (!editProfileValues.full_name.trim()) {
      setEditProfileError('Full name is required.');
      return;
    }
    if (editProfileValues.phone.trim() && !/^\d+$/.test(editProfileValues.phone.trim())) {
      setEditProfileError('Phone number must contain only digits.');
      return;
    }

    setIsSavingProfile(true);
    setEditProfileError('');
    try {
      const { data } = await api.patch('/auth/me/', {
        full_name: editProfileValues.full_name.trim(),
        phone: editProfileValues.phone.trim(),
        email: editProfileValues.email.trim(),
        address: editProfileValues.address.trim(),
      });
      setStaffProfile(data);
      setUserName(data.name || userName);
      localStorage.setItem('gasbook_name', data.name || userName);
      setShowEditProfile(false);
      showInfo('Profile updated successfully.');
    } catch (err) {
      setEditProfileError(extractApiError(err, ['full_name', 'name', 'phone', 'email', 'address'], 'Failed to update profile.'));
    } finally {
      setIsSavingProfile(false);
    }
  }

  const activeDeliveriesList = deliveries.filter((d) => {
    if (d.status === 'rejected') return false;
    if (filterTab === 'assigned') return d.status === 'assigned';
    if (filterTab === 'active') return d.status === 'accepted' || d.status === 'out_for_delivery';
    if (filterTab === 'completed') return d.status === 'delivered';
    return true;
  });


  const navItems = [
    { tab: 'home' as const, label: 'Home', icon: <Truck size={20} /> },
    { tab: 'deliveries' as const, label: 'Deliveries', icon: <Navigation size={20} /> },
    { tab: 'history' as const, label: 'History', icon: <History size={20} /> },
    { tab: 'profile' as const, label: 'Profile', icon: <User size={20} /> },
  ];

  return (
    <div className="sa">
      <div className="sa__column">

        {/* Header */}
        <header className="sa-header">
          <div className="sa-header__text">
            <h2>
              {getGreeting()}, {userName.split(' ')[0] || userName} 👋
            </h2>
            {vehicleLocation ? (
              <div className="sa-header__location">
                <MapPin size={14} aria-hidden="true" />
                <span>{vehicleLocation}</span>
              </div>
            ) : null}
          </div>

          <span className="sa-bell">
            <IconButton type="button" variant="outline" size="lg" label="Notifications" onClick={() => setShowNotifications(true)}>
              <Bell size={20} />
            </IconButton>
            {unreadNotifCount > 0 && <span className="sa-bell__dot" aria-hidden="true" />}
          </span>
        </header>

        {message && (
          <Alert
            tone={messageTone === 'error' ? 'danger' : 'info'}
            actions={
              <IconButton type="button" size="sm" label="Dismiss" onClick={() => setMessage('')}>
                <X size={16} />
              </IconButton>
            }
          >
            <span>{message}</span>
          </Alert>
        )}

        {/* Loading */}
        {isLoading ? (
          <Card className="sa-state">
            <LoadingState label="Loading staff schedule..." />
          </Card>
        ) : null}

        {/* Load error */}
        {!isLoading && loadError && activeTab !== 'profile' ? (
          <Card className="sa-state sa-state--error" role="alert">
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title="Could not load deliveries"
              hint={loadError}
              action={
                <Button type="button" icon={<RefreshCw size={16} />} onClick={load}>
                  Retry
                </Button>
              }
            />
          </Card>
        ) : null}

        {/* ── Home ── */}
        {activeTab === 'home' && !isLoading && !loadError && (
          <div className="sa-stack">

            {/* Summary */}
            <section className="sa-hero">
              <div className="sa-hero__eyebrow">TODAY'S OPERATIONS</div>
              <h3 className="sa-hero__title">Delivery Summary</h3>
              <div className="sa-hero__stats">
                <div className="sa-hero__stat">
                  <div className="sa-hero__value">{assignedCount}</div>
                  <div className="sa-hero__label">Assigned</div>
                </div>
                <div className="sa-hero__stat">
                  <div className="sa-hero__value sa-hero__value--active">{activeCount}</div>
                  <div className="sa-hero__label">Active</div>
                </div>
                <div className="sa-hero__stat">
                  <div className="sa-hero__value sa-hero__value--done">{completedCount}</div>
                  <div className="sa-hero__label">Completed</div>
                </div>
              </div>
            </section>

            {/* Quick actions */}
            <section>
              <SectionHeader as="h3" title="Quick Actions" className="sa-section-head" />
              <div className="sa-quick">
                <button type="button" className="sa-quick__tile" onClick={() => { setActiveTab('deliveries'); setFilterTab('assigned'); }}>
                  <span className="sa-quick__icon sa-quick__icon--primary" aria-hidden="true"><Truck size={20} /></span>
                  <span className="sa-quick__title">My Tasks</span>
                  <span className="sa-quick__sub">{assignedCount} assigned</span>
                </button>

                <button type="button" className="sa-quick__tile" onClick={() => { setActiveTab('deliveries'); setFilterTab('active'); }}>
                  <span className="sa-quick__icon sa-quick__icon--warning" aria-hidden="true"><Navigation size={20} /></span>
                  <span className="sa-quick__title">Active Order</span>
                  <span className="sa-quick__sub">{activeCount} in progress</span>
                </button>

                <button type="button" className="sa-quick__tile" onClick={() => setActiveTab('history')}>
                  <span className="sa-quick__icon sa-quick__icon--success" aria-hidden="true"><History size={20} /></span>
                  <span className="sa-quick__title">History</span>
                  <span className="sa-quick__sub">Past orders</span>
                </button>
              </div>
            </section>

            {/* Pending assignments */}
            {pendingAssignments.length > 0 ? (
              <section>
                <SectionHeader
                  as="h3"
                  title="New Assignment"
                  className="sa-section-head"
                  meta={<Badge tone="warning">{pendingAssignments.length} Pending</Badge>}
                />

                {pendingAssignments.slice(0, 1).map((order) => {
                  const isOnline = order.booking_payment_method === 'ONLINE' || order.booking_payment_status === 'PAID';

                  return (
                    <Card key={order.id} className="sa-order">
                      <div className="sa-order__top">
                        <strong className="sa-order__ref">Order #{orderRef(order)}</strong>
                        <Badge tone={isOnline ? 'success' : 'warning'} icon={isOnline ? <Check size={12} /> : <Banknote size={12} />}>
                          {isOnline ? 'Paid Online' : 'COD'}
                        </Badge>
                      </div>

                      <div className="sa-order__item">
                        {order.quantity} x {order.cylinder_type_name}
                      </div>

                      <div className="sa-address">
                        <MapPin size={16} aria-hidden="true" />
                        <span>{order.customer_address || 'No address provided'}</span>
                      </div>

                      <div className="sa-amount-row">
                        <span className="sa-amount-row__label">Amount to Collect:</span>
                        <AmountToCollect delivery={order} showOriginal />
                      </div>

                      {rejectingId === order.id ? (
                        <div className="sa-reject">
                          <Select
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            disabled={rejectBusy}
                            aria-label="Decline reason"
                          >
                            <option value="Too far">Too far</option>
                            <option value="Unavailable">Unavailable</option>
                            <option value="Vehicle issue">Vehicle issue</option>
                          </Select>
                          <div className="sa-reject__actions">
                            <Button type="button" variant="danger" onClick={() => reject(order.id)} disabled={rejectBusy} loading={rejectBusy}>
                              {rejectBusy ? 'Declining…' : 'Confirm Reject'}
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => setRejectingId(null)} disabled={rejectBusy}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="sa-order__actions">
                          <Button type="button" variant="secondary" size="lg" onClick={() => setRejectingId(order.id)} disabled={actionBusyId !== null}>
                            Reject
                          </Button>
                          <Button type="button" size="lg" onClick={() => accept(order.id)} disabled={actionBusyId !== null} loading={actionBusyId === order.id}>
                            {actionBusyId === order.id ? 'Accepting…' : 'Accept Assignment'}
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </section>
            ) : null}

            {/* Active delivery */}
            {activeDelivery ? (
              <section>
                <SectionHeader
                  as="h3"
                  title="Your Active Delivery"
                  className="sa-section-head"
                  meta={<span className="sa-section-head__note">In Progress</span>}
                />

                {(() => {
                  const isOnline = activeDelivery.booking_payment_method === 'ONLINE' || activeDelivery.booking_payment_status === 'PAID';
                  const totalAmt = finalAmount(activeDelivery);
                  const completeBlocked = (!isOnline && !codConfirmed[activeDelivery.id]) || actionBusyId !== null;

                  return (
                    <Card className="sa-order sa-order--active">
                      <div className="sa-order__top">
                        <strong className="sa-order__ref">Order #{orderRef(activeDelivery)}</strong>
                        <Badge tone="primary">{activeDelivery.status.replaceAll('_', ' ')}</Badge>
                      </div>

                      <div className="sa-cylinder">
                        <img src={cylinderImg} className="sa-cylinder__img" alt="Cylinder" />
                        <div className="sa-cylinder__text">
                          <div className="sa-cylinder__type">{activeDelivery.cylinder_type_name}</div>
                          <div className="sa-cylinder__qty">Qty: {activeDelivery.quantity}</div>
                        </div>
                        {activeDelivery.customer_phone ? (
                          <a href={`tel:${activeDelivery.customer_phone}`} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                            <span className="ui-btn__icon" aria-hidden="true"><Phone size={14} /></span>
                            <span className="ui-btn__label">Call</span>
                          </a>
                        ) : null}
                      </div>

                      <div className="sa-block">
                        <div className="sa-block__eyebrow">CUSTOMER &amp; ADDRESS</div>
                        <div className="sa-block__name">{activeDelivery.customer_name}</div>
                        <div className="sa-block__text">{activeDelivery.customer_address}</div>
                      </div>

                      <div className={`sa-pay ${isOnline ? 'sa-pay--online' : 'sa-pay--cod'}`}>
                        <div className="sa-pay__row">
                          <div className="sa-pay__text">
                            <div className="sa-pay__title">
                              {isOnline ? <CheckCircle2 size={14} aria-hidden="true" /> : <Banknote size={14} aria-hidden="true" />}
                              <span>{isOnline ? 'Paid Online — No Cash Needed' : 'Cash on Delivery'}</span>
                            </div>
                            <div className="sa-pay__sub">
                              {isOnline ? 'Payment verified by system' : 'Collect cash upon delivery'}
                            </div>
                          </div>
                          <AmountToCollect delivery={activeDelivery} showOriginal tone={isOnline ? 'success' : 'warning'} />
                        </div>

                        {!isOnline ? (
                          <label className="sa-check">
                            <input
                              type="checkbox"
                              checked={!!codConfirmed[activeDelivery.id]}
                              onChange={(e) => setCodConfirmed((prev) => ({ ...prev, [activeDelivery.id]: e.target.checked }))}
                            />
                            <span>Confirm Cash Collected ({money(totalAmt)})</span>
                          </label>
                        ) : null}
                      </div>

                      {activeDelivery.status === 'accepted' && (
                        <Button
                          type="button"
                          size="lg"
                          block
                          icon={<Navigation size={18} />}
                          onClick={() => start(activeDelivery.id)}
                          disabled={actionBusyId !== null}
                          loading={actionBusyId === activeDelivery.id}
                        >
                          Start Delivery &amp; Notify Customer
                        </Button>
                      )}

                      {activeDelivery.status === 'out_for_delivery' && (
                        <Button
                          type="button"
                          size="lg"
                          block
                          icon={<CheckCircle2 size={18} />}
                          onClick={() => complete(activeDelivery.id, !isOnline, totalAmt)}
                          disabled={completeBlocked}
                          loading={actionBusyId === activeDelivery.id}
                        >
                          {actionBusyId === activeDelivery.id ? 'Completing…' : 'Complete Delivery'}
                        </Button>
                      )}
                    </Card>
                  );
                })()}
              </section>
            ) : null}

            {/* Nothing to do */}
            {!activeDelivery && pendingAssignments.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Check size={24} />}
                  title="No active deliveries"
                  hint="You're all caught up! New assignments will appear here."
                />
              </Card>
            ) : null}

            {/* Most recent completed */}
            {!activeDelivery && recentCompleted ? (
              <section>
                <SectionHeader as="h3" title="Recent Delivery" className="sa-section-head" />
                <Card padding="sm" className="sa-recent">
                  <div>
                    <div className="sa-order__ref">Order #{orderRef(recentCompleted)}</div>
                    <div className="sa-muted">{recentCompleted.cylinder_type_name}</div>
                  </div>
                  <Badge tone="success" icon={<Check size={12} />}>Delivered</Badge>
                </Card>
              </section>
            ) : null}
          </div>
        )}

        {/* ── All deliveries ── */}
        {activeTab === 'deliveries' && !isLoading && !loadError && (
          <section className="sa-stack sa-stack--tight">
            <h3 className="sa-page-title">All Deliveries</h3>
            <div className="sa-filters">
              <Tabs
                ariaLabel="Delivery filter"
                size="sm"
                value={filterTab}
                onChange={setFilterTab}
                items={[
                  { value: 'all', label: 'All' },
                  { value: 'assigned', label: `Assigned (${assignedCount})` },
                  { value: 'active', label: `Active (${activeCount})` },
                  { value: 'completed', label: `Completed (${completedCount})` },
                ]}
              />
            </div>

            <div className="sa-list">
              {activeDeliveriesList.map((d) => (
                <Card key={d.id} padding="sm" className="sa-list-card">
                  <div className="sa-order__top">
                    <strong className="sa-order__ref">Order #{orderRef(d)}</strong>
                    <Badge tone={statusTone(d.status)}>{d.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <div className="sa-list-card__text">{d.customer_name} — {d.customer_address}</div>
                  <div className="sa-amount-row sa-amount-row--footer">
                    <span className="sa-amount-row__label">
                      {d.status === 'delivered' ? 'Amount Collected:' : 'Amount to Collect:'}
                    </span>
                    <AmountToCollect delivery={d} showOriginal={d.status !== 'delivered'} />
                  </div>
                </Card>
              ))}
              {activeDeliveriesList.length === 0 && (
                <Card><EmptyState compact title="No deliveries found for filter." /></Card>
              )}
            </div>
          </section>
        )}

        {/* ── History ── */}
        {activeTab === 'history' && !isLoading && !loadError && (
          <section className="sa-stack sa-stack--tight">
            <h3 className="sa-page-title">Delivery History</h3>
            <div className="sa-list">
              {completedDeliveries.map((d) => (
                <Card key={d.id} padding="sm" className="sa-list-card">
                  <div className="sa-order__top">
                    <strong className="sa-order__ref">Order #{orderRef(d)}</strong>
                    <Badge tone="success" icon={<Check size={12} />}>Delivered</Badge>
                  </div>
                  <div className="sa-list-card__text">{d.cylinder_type_name} ({d.quantity} qty)</div>
                  <div className="sa-muted">{d.customer_name}</div>
                  <div className="sa-amount-row sa-amount-row--footer">
                    <span className="sa-amount-row__label">Amount Collected:</span>
                    <AmountToCollect delivery={d} showOriginal={false} tone="neutral" />
                  </div>
                </Card>
              ))}
              {completedDeliveries.length === 0 && (
                <Card><EmptyState compact icon={<History size={24} />} title="No completed history yet." /></Card>
              )}
            </div>
          </section>
        )}

        {/* ── Profile ── */}
        {activeTab === 'profile' && !isLoading && (
          <div className="sa-stack">
            <Card className="sa-profile">
              {staffProfile?.staff_image_url ? (
                <img src={staffProfile.staff_image_url} alt={staffProfile.name || userName} className="sa-profile__avatar" />
              ) : (
                <div className="sa-profile__avatar sa-profile__avatar--initials">{profileInitials}</div>
              )}
              <div className="sa-profile__text">
                <h3>{staffProfile?.name || userName}</h3>
                <p>Manage your account and saved details.</p>
              </div>
            </Card>

            <section>
              <SectionHeader
                as="h3"
                title="Account Details"
                className="sa-section-head"
                meta={
                  <Button type="button" variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={openEditProfile}>
                    Edit
                  </Button>
                }
              />
              <Card padding="none" className="sa-details">
                {profileRows.map((row) => (
                  <div key={row.label} className="sa-details__row">
                    <div className="sa-details__label">
                      <span className="sa-details__icon" aria-hidden="true">{row.icon}</span>
                      <span>{row.label}</span>
                    </div>
                    <div className="sa-details__value">{row.value}</div>
                  </div>
                ))}
              </Card>
            </section>

            <section>
              <SectionHeader as="h3" title="Account" className="sa-section-head" />
              <button
                type="button"
                className="sa-logout"
                onClick={() => { logout(); window.location.href = '/login'; }}
              >
                <span className="sa-logout__icon" aria-hidden="true"><LogOut size={18} /></span>
                <span className="sa-logout__label">Logout</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </section>
          </div>
        )}
      </div>

      {/* Bottom navigation */}
      <nav className="sa-nav" aria-label="Staff navigation">
        <div className="sa-nav__inner">
          {navItems.map((item) => (
            <button
              key={item.tab}
              type="button"
              className={`sa-nav__item${activeTab === item.tab ? ' is-active' : ''}`}
              aria-current={activeTab === item.tab ? 'page' : undefined}
              onClick={() => setActiveTab(item.tab)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Notifications */}
      <Modal open={showNotifications} onClose={() => setShowNotifications(false)} title="Staff Notifications" size="sm">
        <div className="sa-notifs">
          {notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`sa-notif${n.is_read ? '' : ' sa-notif--unread'}`}
              onClick={() => void handleMarkRead(n.id)}
            >
              <span className="sa-notif__head">
                <strong>{n.title}</strong>
                <small>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
              </span>
              <span className="sa-notif__body">{n.body}</span>
            </button>
          ))}
          {notifError && (
            <Alert
              tone="danger"
              actions={<Button type="button" size="sm" variant="secondary" onClick={load}>Retry</Button>}
            >
              <p>Notifications unavailable. {notifError}</p>
            </Alert>
          )}
          {!notifError && notifications.length === 0 && (
            <EmptyState compact icon={<Bell size={24} />} title="No alerts received yet." />
          )}
        </div>
      </Modal>

      {/* Edit profile */}
      <Modal
        open={showEditProfile}
        onClose={() => { if (!isSavingProfile) setShowEditProfile(false); }}
        closeOnOverlay
        title="Edit Profile"
        description="Update your personal details"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setShowEditProfile(false)} disabled={isSavingProfile}>
              Cancel
            </Button>
            <Button type="submit" form="staff-edit-profile-form" disabled={isSavingProfile} loading={isSavingProfile}>
              {isSavingProfile ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <form id="staff-edit-profile-form" onSubmit={saveProfileChanges} className="sa-form">
          {editProfileError ? <Alert tone="danger" compact>{editProfileError}</Alert> : null}

          {([
            { key: 'full_name', label: 'Full Name *', type: 'text', placeholder: 'Enter your full name', maxLength: LIMITS.name },
            { key: 'phone', label: 'Phone Number', type: 'tel', placeholder: 'Enter mobile number', maxLength: LIMITS.phone, inputMode: 'numeric', pattern: '[0-9]*' },
            { key: 'email', label: 'Email Address', type: 'email', placeholder: 'Enter email address', maxLength: LIMITS.email },
          ] as { key: string; label: string; type: string; placeholder: string; maxLength: number; inputMode?: 'numeric'; pattern?: string }[]).map((field) => (
            <Field key={field.key} label={field.label}>
              <Input
                type={field.type}
                value={editProfileValues[field.key as keyof typeof editProfileValues]}
                onChange={(e) => setEditProfileValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                maxLength={field.maxLength}
                inputMode={field.inputMode}
                pattern={field.pattern}
                title={field.pattern ? 'Only digits allowed' : undefined}
              />
            </Field>
          ))}

          <Field label="Address">
            <Textarea
              rows={3}
              value={editProfileValues.address}
              onChange={(e) => setEditProfileValues((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Enter full address"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
