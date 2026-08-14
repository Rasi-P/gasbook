import { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  MapPin,
  Navigation,
  Phone,
  Truck,
  User,
  ChevronRight,
  History,
  Check
} from 'lucide-react';
import { api, logout } from '../../lib/api';
import cylinderImg from '../../assets/splash_cylinder.png';

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

function money(v: number | string) {
  return `₹${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function StaffMobileLayout() {
  const [activeTab, setActiveTab] = useState<'home' | 'deliveries' | 'history' | 'profile'>('home');
  const [filterTab, setFilterTab] = useState<'all' | 'assigned' | 'active' | 'completed'>('all');
  
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [collections, setCollections] = useState<
    Record<
      number,
      { amount: string; method: string; paid_method: string; empty: string }
    >
  >({});
  const [message, setMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [vehicleLocation, setVehicleLocation] = useState('');

  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('Too far');
  const [codConfirmed, setCodConfirmed] = useState<Record<number, boolean>>({});

  // Dynamic Greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  function load() {
    setIsLoading(true);
    setUserName(localStorage.getItem('gasbook_name') || 'Staff Partner');
    setVehicleLocation(localStorage.getItem('gasbook_vehicle_location') || '');

    Promise.all([
      api.get('/deliveries/'),
      api.get('/stock/'),
      api.get('/notifications/').catch(() => ({ data: [] }))
    ])
      .then(([deliveryRes, , notifRes]) => {
        const rows = deliveryRes.data.results ?? deliveryRes.data;
        setDeliveries(rows);
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
                empty: String(d.quantity)
              }
            ])
          )
        );
      })
      .catch(() => undefined)
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
    try {
      await api.post(`/deliveries/${id}/accept/`);
      setMessage('Delivery accepted!');
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to accept delivery.');
    }
  }

  async function reject(id: number) {
    try {
      await api.post(`/deliveries/${id}/reject/`, { reason: rejectReason });
      setMessage('Delivery rejected.');
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
      empty: '1'
    };

    if (isCod && !codConfirmed[id]) {
      setMessage('Please confirm payment collected from customer.');
      return;
    }

    const payload: any = {
      payment_method: isCod ? form.method : 'gpay',
      empty_collected: Number(form.empty || 0),
      payment_collected: String(totalAmount)
    };

    try {
      await api.post(`/deliveries/${id}/complete/`, payload);
      setMessage('Delivery completed successfully!');
      load();
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Failed to complete delivery.');
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

  const activeDeliveriesList = deliveries.filter((d) => {
    if (d.status === 'rejected') return false;
    if (filterTab === 'assigned') return d.status === 'assigned';
    if (filterTab === 'active') return d.status === 'accepted' || d.status === 'out_for_delivery';
    if (filterTab === 'completed') return d.status === 'delivered';
    return true;
  });

  return (
    <div style={{ background: '#F7F9FC', minHeight: '100vh', width: '100%', fontFamily: '"SF Pro Display", "Segoe UI", sans-serif' }}>
      <div style={{ width: '100%', maxWidth: '430px', margin: '0 auto', background: '#F7F9FC', paddingBottom: '90px', minHeight: '100vh', position: 'relative', overflowX: 'hidden' }}>
        
        {/* ================================================== */}
        {/* 1. STAFF HEADER */}
        {/* ================================================== */}
        <div style={{ padding: '20px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#132B4F', margin: 0, letterSpacing: '-0.02em' }}>
              {getGreeting()}, {userName.split(' ')[0] || userName} 👋
            </h2>
            {vehicleLocation ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', color: '#1457B8', fontSize: '13px', fontWeight: 600 }}>
                <MapPin size={14} color="#1457B8" />
                <span>{vehicleLocation}</span>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowNotifications(true)}
              style={{ position: 'relative', width: '42px', height: '42px', borderRadius: '50%', background: '#FFFFFF', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#132B4F', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.04)' }}
            >
              <Bell size={20} />
              {unreadNotifCount > 0 && (
                <span style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', borderRadius: '50%', background: '#FF6F00', border: '2px solid #FFFFFF' }} />
              )}
            </button>
          </div>
        </div>

        {message && (
          <div style={{ margin: '0 20px 16px', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1457B8', padding: '10px 14px', borderRadius: '12px', fontSize: '13px', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{message}</span>
            <button onClick={() => setMessage('')} style={{ background: 'none', border: 'none', color: '#1457B8', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        {/* LOADING STATE */}
        {isLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#718096' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Loading staff schedule...</div>
          </div>
        ) : null}

        {/* ================================================== */}
        {/* MAIN TAB CONTENT */}
        {/* ================================================== */}
        {activeTab === 'home' && !isLoading && (
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* ================================================== */}
            {/* 2. STAFF HERO / SUMMARY CARD */}
            {/* ================================================== */}
            <div
              style={{
                background: 'linear-gradient(135deg, #132B4F 0%, #1457B8 100%)',
                borderRadius: '24px',
                padding: '22px 20px',
                color: '#FFFFFF',
                boxShadow: '0 12px 28px rgba(20, 87, 184, 0.25)',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93C5FD', marginBottom: '8px' }}>
                TODAY'S OPERATIONS
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.01em' }}>
                Delivery Summary
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(8px)', borderRadius: '16px', padding: '12px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#FFFFFF' }}>{assignedCount}</div>
                  <div style={{ fontSize: '11px', color: '#DBEAFE', fontWeight: 600 }}>Assigned</div>
                </div>
                <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.15)', borderRight: '1px solid rgba(255,255,255,0.15)' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#FF9E43' }}>{activeCount}</div>
                  <div style={{ fontSize: '11px', color: '#DBEAFE', fontWeight: 600 }}>Active</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#4ADE80' }}>{completedCount}</div>
                  <div style={{ fontSize: '11px', color: '#DBEAFE', fontWeight: 600 }}>Completed</div>
                </div>
              </div>
            </div>

            {/* ================================================== */}
            {/* 3. QUICK ACTIONS */}
            {/* ================================================== */}
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#132B4F', margin: '0 0 12px' }}>Quick Actions</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                {/* 1. My Tasks */}
                <div
                  onClick={() => { setActiveTab('deliveries'); setFilterTab('assigned'); }}
                  style={{ background: '#FFFFFF', borderRadius: '18px', padding: '16px 10px', textAlign: 'center', border: '1px solid #EDF2F7', boxShadow: '0 4px 14px rgba(19, 43, 79, 0.04)', cursor: 'pointer' }}
                >
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: '#1457B8' }}>
                    <Truck size={22} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#132B4F' }}>My Tasks</div>
                  <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>{assignedCount} assigned</div>
                </div>

                {/* 2. Active Delivery */}
                <div
                  onClick={() => { setActiveTab('deliveries'); setFilterTab('active'); }}
                  style={{ background: '#FFFFFF', borderRadius: '18px', padding: '16px 10px', textAlign: 'center', border: '1px solid #EDF2F7', boxShadow: '0 4px 14px rgba(19, 43, 79, 0.04)', cursor: 'pointer' }}
                >
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#FFF7ED', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: '#FF6F00' }}>
                    <Navigation size={22} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#132B4F' }}>Active Order</div>
                  <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>{activeCount} in progress</div>
                </div>

                {/* 3. History */}
                <div
                  onClick={() => setActiveTab('history')}
                  style={{ background: '#FFFFFF', borderRadius: '18px', padding: '16px 10px', textAlign: 'center', border: '1px solid #EDF2F7', boxShadow: '0 4px 14px rgba(19, 43, 79, 0.04)', cursor: 'pointer' }}
                >
                  <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px', color: '#22A06B' }}>
                    <History size={22} />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#132B4F' }}>History</div>
                  <div style={{ fontSize: '11px', color: '#718096', marginTop: '2px' }}>Past orders</div>
                </div>
              </div>
            </div>

            {/* ================================================== */}
            {/* 4. PENDING ASSIGNMENTS */}
            {/* ================================================== */}
            {pendingAssignments.length > 0 ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#132B4F', margin: 0 }}>New Assignment</h4>
                  <span style={{ fontSize: '12px', background: '#FFF3EB', color: '#FF6F00', padding: '2px 8px', borderRadius: '10px', fontWeight: 700 }}>
                    {pendingAssignments.length} Pending
                  </span>
                </div>

                {pendingAssignments.slice(0, 1).map((order) => {
                  const isOnline = order.booking_payment_method === 'ONLINE' || order.booking_payment_status === 'PAID';
                  const totalAmt = Number(order.rate || 0) * order.quantity;

                  return (
                    <div key={order.id} style={{ background: '#FFFFFF', borderRadius: '20px', padding: '18px', border: '1px solid #E2E8F0', boxShadow: '0 6px 18px rgba(19, 43, 79, 0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 800, color: '#132B4F' }}>Order #GB{order.id}</span>
                        <span style={{ fontSize: '12px', color: isOnline ? '#22A06B' : '#FF6F00', fontWeight: 700, background: isOnline ? '#E6F4EA' : '#FFF3EB', padding: '2px 8px', borderRadius: '8px' }}>
                          {isOnline ? '✓ Paid Online' : '💵 COD'}
                        </span>
                      </div>

                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#132B4F' }}>
                        {order.quantity} x {order.cylinder_type_name}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', background: '#F8FAFC', padding: '10px 12px', borderRadius: '12px', margin: '10px 0' }}>
                        <MapPin size={15} color="#718096" style={{ marginTop: '2px', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', color: '#2D3748', lineHeight: 1.4 }}>{order.customer_address || 'No address provided'}</span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                        <span style={{ fontSize: '12px', color: '#718096', fontWeight: 600 }}>Amount to Collect:</span>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: '#1457B8' }}>{money(totalAmt)}</span>
                      </div>

                      {rejectingId === order.id ? (
                        <div style={{ background: '#FFF1F2', border: '1px solid #FECDD3', padding: '12px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <select
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #FCA5A5', fontSize: '13px' }}
                          >
                            <option value="Too far">Too far</option>
                            <option value="Unavailable">Unavailable</option>
                            <option value="Vehicle issue">Vehicle issue</option>
                          </select>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => reject(order.id)} style={{ flex: 1, padding: '8px', background: '#E11D48', color: '#FFF', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}>Confirm Reject</button>
                            <button onClick={() => setRejectingId(null)} style={{ padding: '8px 12px', background: '#FFF', border: '1px solid #CBD5E1', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                          <button onClick={() => setRejectingId(order.id)} style={{ padding: '12px', background: '#F1F5F9', color: '#475569', border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
                            Reject
                          </button>
                          <button onClick={() => accept(order.id)} style={{ padding: '12px', background: '#1457B8', color: '#FFFFFF', border: 'none', borderRadius: '12px', fontWeight: 700, cursor: 'pointer' }}>
                            Accept Assignment
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* ================================================== */}
            {/* 5. ACTIVE DELIVERY */}
            {/* ================================================== */}
            {activeDelivery ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#132B4F', margin: 0 }}>Your Active Delivery</h4>
                  <span style={{ fontSize: '12px', color: '#1457B8', fontWeight: 700 }}>In Progress</span>
                </div>

                {(() => {
                  const isOnline = activeDelivery.booking_payment_method === 'ONLINE' || activeDelivery.booking_payment_status === 'PAID';
                  const totalAmt = Number(activeDelivery.rate || 0) * activeDelivery.quantity;

                  return (
                    <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '18px', border: '1px solid #E2E8F0', boxShadow: '0 8px 24px rgba(19, 43, 79, 0.08)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: '#132B4F' }}>Order #GB{activeDelivery.id}</span>
                        <span style={{ background: '#E0E7FF', color: '#1457B8', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                          {activeDelivery.status.replaceAll('_', ' ')}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px' }}>
                        <img src={cylinderImg} style={{ width: '48px', height: '48px', objectFit: 'contain' }} alt="Cylinder" />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '15px', fontWeight: 700, color: '#132B4F' }}>{activeDelivery.cylinder_type_name}</div>
                          <div style={{ fontSize: '12px', color: '#718096' }}>Qty: {activeDelivery.quantity}</div>
                        </div>
                        {activeDelivery.customer_phone ? (
                          <a
                            href={`tel:${activeDelivery.customer_phone}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '20px', border: '1px solid #1457B8', color: '#1457B8', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}
                          >
                            <Phone size={14} /> Call
                          </a>
                        ) : null}
                      </div>

                      <div style={{ background: '#F8FAFC', padding: '12px', borderRadius: '12px', marginBottom: '14px' }}>
                        <div style={{ fontSize: '12px', color: '#718096', fontWeight: 600 }}>CUSTOMER &amp; ADDRESS</div>
                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#132B4F', marginTop: '2px' }}>{activeDelivery.customer_name}</div>
                        <div style={{ fontSize: '13px', color: '#4A5568', marginTop: '2px' }}>{activeDelivery.customer_address}</div>
                      </div>

                      {/* PAYMENT INFO CASE 1 & CASE 2 */}
                      <div style={{ background: isOnline ? '#F0FDF4' : '#FFF7ED', padding: '12px', borderRadius: '12px', marginBottom: '14px', border: isOnline ? '1px solid #DCFCE7' : '1px solid #FFEDD5' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: isOnline ? '#15803D' : '#C2410C' }}>
                              {isOnline ? '✓ Paid Online — No Cash Needed' : '💵 Cash on Delivery'}
                            </div>
                            <div style={{ fontSize: '13px', color: '#4A5568', marginTop: '2px' }}>
                              {isOnline ? 'Payment verified by system' : 'Collect cash upon delivery'}
                            </div>
                          </div>
                          <div style={{ fontSize: '16px', fontWeight: 800, color: isOnline ? '#15803D' : '#C2410C' }}>
                            {money(totalAmt)}
                          </div>
                        </div>

                        {!isOnline ? (
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', fontSize: '12px', fontWeight: 700, color: '#132B4F', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={!!codConfirmed[activeDelivery.id]}
                              onChange={(e) => setCodConfirmed((prev) => ({ ...prev, [activeDelivery.id]: e.target.checked }))}
                            />
                            <span>Confirm Cash Collected ({money(totalAmt)})</span>
                          </label>
                        ) : null}
                      </div>

                      {/* WORKFLOW ACTIONS */}
                      {activeDelivery.status === 'accepted' && (
                        <button
                          onClick={() => start(activeDelivery.id)}
                          style={{ width: '100%', padding: '14px', background: '#1457B8', color: '#FFFFFF', border: 'none', borderRadius: '14px', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
                        >
                          <Navigation size={18} /> Start Delivery &amp; Notify Customer
                        </button>
                      )}

                      {activeDelivery.status === 'out_for_delivery' && (
                        <button
                          onClick={() => complete(activeDelivery.id, !isOnline, totalAmt)}
                          disabled={!isOnline && !codConfirmed[activeDelivery.id]}
                          style={{
                            width: '100%',
                            padding: '14px',
                            background: (!isOnline && !codConfirmed[activeDelivery.id]) ? '#A0AEC0' : '#22A06B',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '14px',
                            fontWeight: 700,
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            cursor: (!isOnline && !codConfirmed[activeDelivery.id]) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <CheckCircle2 size={18} /> Complete Delivery
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : null}

            {/* ================================================== */}
            {/* 10. NO ACTIVE DELIVERY STATE */}
            {/* ================================================== */}
            {!activeDelivery && pendingAssignments.length === 0 ? (
              <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '32px 20px', textAlign: 'center', border: '1px solid #E2E8F0' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', color: '#94A3B8' }}>
                  <Check size={28} />
                </div>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#132B4F', margin: 0 }}>No active deliveries</h4>
                <p style={{ fontSize: '13px', color: '#718096', marginTop: '4px' }}>You're all caught up! New assignments will appear here.</p>
              </div>
            ) : null}

            {/* ================================================== */}
            {/* 11. COMPLETED / RECENT DELIVERY */}
            {/* ================================================== */}
            {!activeDelivery && recentCompleted ? (
              <div>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#132B4F', margin: '0 0 12px' }}>Recent Delivery</h4>
                <div style={{ background: '#FFFFFF', borderRadius: '18px', padding: '16px', border: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#132B4F' }}>Order #GB{recentCompleted.id}</div>
                    <div style={{ fontSize: '12px', color: '#718096', marginTop: '2px' }}>{recentCompleted.cylinder_type_name}</div>
                  </div>
                  <span style={{ fontSize: '12px', background: '#E6F4EA', color: '#22A06B', padding: '4px 10px', borderRadius: '12px', fontWeight: 700 }}>
                    ✓ Delivered
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* TAB 2: DELIVERIES ALL LIST */}
        {activeTab === 'deliveries' && !isLoading && (
          <div style={{ padding: '0 20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#132B4F', marginBottom: '14px' }}>All Deliveries</h3>
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '12px' }}>
              <button onClick={() => setFilterTab('all')} style={{ padding: '6px 14px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 700, background: filterTab === 'all' ? '#1457B8' : '#E2E8F0', color: filterTab === 'all' ? '#FFF' : '#475569' }}>All</button>
              <button onClick={() => setFilterTab('assigned')} style={{ padding: '6px 14px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 700, background: filterTab === 'assigned' ? '#1457B8' : '#E2E8F0', color: filterTab === 'assigned' ? '#FFF' : '#475569' }}>Assigned ({assignedCount})</button>
              <button onClick={() => setFilterTab('active')} style={{ padding: '6px 14px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 700, background: filterTab === 'active' ? '#1457B8' : '#E2E8F0', color: filterTab === 'active' ? '#FFF' : '#475569' }}>Active ({activeCount})</button>
              <button onClick={() => setFilterTab('completed')} style={{ padding: '6px 14px', borderRadius: '20px', border: 'none', fontSize: '12px', fontWeight: 700, background: filterTab === 'completed' ? '#1457B8' : '#E2E8F0', color: filterTab === 'completed' ? '#FFF' : '#475569' }}>Completed ({completedCount})</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {activeDeliveriesList.map((d) => (
                <div key={d.id} style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', border: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 800, color: '#132B4F' }}>Order #GB{d.id}</span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#1457B8' }}>{d.status.replaceAll('_', ' ')}</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#4A5568' }}>{d.customer_name} — {d.customer_address}</div>
                </div>
              ))}
              {activeDeliveriesList.length === 0 && <div style={{ textAlign: 'center', color: '#718096', padding: '30px' }}>No deliveries found for filter.</div>}
            </div>
          </div>
        )}

        {/* TAB 3: HISTORY */}
        {activeTab === 'history' && !isLoading && (
          <div style={{ padding: '0 20px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#132B4F', marginBottom: '14px' }}>Delivery History</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {completedDeliveries.map((d) => (
                <div key={d.id} style={{ background: '#FFFFFF', borderRadius: '16px', padding: '16px', border: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 800, color: '#132B4F' }}>Order #GB{d.id}</span>
                    <span style={{ fontSize: '12px', background: '#E6F4EA', color: '#22A06B', padding: '2px 8px', borderRadius: '8px', fontWeight: 700 }}>✓ Delivered</span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#4A5568', marginTop: '4px' }}>{d.cylinder_type_name} ({d.quantity} qty)</div>
                  <div style={{ fontSize: '12px', color: '#718096', marginTop: '2px' }}>{d.customer_name}</div>
                </div>
              ))}
              {completedDeliveries.length === 0 && <div style={{ textAlign: 'center', color: '#718096', padding: '30px' }}>No completed history yet.</div>}
            </div>
          </div>
        )}

        {/* TAB 4: PROFILE */}
        {activeTab === 'profile' && !isLoading && (
          <div style={{ padding: '0 20px' }}>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '24px', textAlign: 'center', border: '1px solid #E2E8F0', marginBottom: '16px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#EFF6FF', color: '#1457B8', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 800 }}>
                {userName.slice(0, 2).toUpperCase()}
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#132B4F', margin: 0 }}>{userName}</h3>
              <div style={{ fontSize: '13px', color: '#718096', marginTop: '4px' }}>Staff Partner</div>
            </div>

            <div style={{ background: '#FFFFFF', borderRadius: '18px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
              <button onClick={() => { logout(); window.location.href = '/login'; }} style={{ width: '100%', padding: '16px', background: 'none', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#E11D48' }}>Logout</span>
                <ChevronRight size={18} color="#94A3B8" />
              </button>
            </div>
          </div>
        )}

        {/* ================================================== */}
        {/* 13. BOTTOM NAVIGATION (STAFF WORKFLOW) */}
        {/* ================================================== */}
        <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: '#FFFFFF', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px', zIndex: 1000, boxShadow: '0 -4px 20px rgba(0,0,0,0.05)' }}>
          <button
            onClick={() => setActiveTab('home')}
            style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: activeTab === 'home' ? '#FF6F00' : '#718096', cursor: 'pointer', flex: 1 }}
          >
            <Truck size={22} color={activeTab === 'home' ? '#FF6F00' : '#718096'} />
            <span style={{ fontSize: '11px', fontWeight: activeTab === 'home' ? 700 : 500 }}>Home</span>
          </button>

          <button
            onClick={() => setActiveTab('deliveries')}
            style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: activeTab === 'deliveries' ? '#FF6F00' : '#718096', cursor: 'pointer', flex: 1 }}
          >
            <Navigation size={22} color={activeTab === 'deliveries' ? '#FF6F00' : '#718096'} />
            <span style={{ fontSize: '11px', fontWeight: activeTab === 'deliveries' ? 700 : 500 }}>Deliveries</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: activeTab === 'history' ? '#FF6F00' : '#718096', cursor: 'pointer', flex: 1 }}
          >
            <History size={22} color={activeTab === 'history' ? '#FF6F00' : '#718096'} />
            <span style={{ fontSize: '11px', fontWeight: activeTab === 'history' ? 700 : 500 }}>History</span>
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: activeTab === 'profile' ? '#FF6F00' : '#718096', cursor: 'pointer', flex: 1 }}
          >
            <User size={22} color={activeTab === 'profile' ? '#FF6F00' : '#718096'} />
            <span style={{ fontSize: '11px', fontWeight: activeTab === 'profile' ? 700 : 500 }}>Profile</span>
          </button>
        </div>

        {/* NOTIFICATIONS MODAL */}
        {showNotifications && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
            <div style={{ background: '#FFF', width: '100%', maxWidth: '360px', maxHeight: '80vh', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #F1F5F9', paddingBottom: '12px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>Staff Notifications</h3>
                <button onClick={() => setShowNotifications(false)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => void handleMarkRead(n.id)}
                    style={{ padding: '12px', borderRadius: '10px', background: n.is_read ? '#F8FAFC' : '#EFF6FF', border: n.is_read ? '1px solid #E2E8F0' : '1px solid #BFDBFE', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px', color: '#1E293B' }}>{n.title}</strong>
                      <small style={{ fontSize: '10px', color: '#94A3B8' }}>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                    <p style={{ fontSize: '12px', color: '#475569', margin: 0 }}>{n.body}</p>
                  </div>
                ))}
                {notifications.length === 0 && <p style={{ textAlign: 'center', color: '#94A3B8', marginTop: '40px', fontSize: '13px' }}>No alerts received yet.</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
