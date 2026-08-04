import { useState } from 'react';
import { Bell, CheckCheck, Trash2, Info, AlertTriangle, CheckCircle } from 'lucide-react';

interface NotificationItem {
  id: number;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success';
  time: string;
  is_read: boolean;
}

const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 1,
    title: 'Low Stock Alert',
    message: 'Commercial 19kg cylinder stock in Main Shop is running low (only 4 filled remaining).',
    type: 'warning',
    time: '10 mins ago',
    is_read: false,
  },
  {
    id: 2,
    title: 'Refill Dispatch Completed',
    message: 'Supplier load #SL-4029 received and verified with 50 filled cylinders.',
    type: 'success',
    time: '1 hour ago',
    is_read: false,
  },
  {
    id: 3,
    title: 'New Customer Booking',
    message: 'Customer Apex Industries created a new booking request for 10 units of 19kg Commercial.',
    type: 'info',
    time: '2 hours ago',
    is_read: true,
  },
  {
    id: 4,
    title: 'Pending Payment Due',
    message: 'Payment due for Invoice #INV-2091 (Amount: ₹12,400) customer Royal Hotel.',
    type: 'warning',
    time: '1 day ago',
    is_read: true,
  },
];

export default function Notifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>(DEMO_NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const toggleRead = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: !n.is_read } : n))
    );
  };

  const deleteNotification = (id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '24px 16px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, fontSize: '1.6rem' }}>
            <Bell style={{ color: 'var(--primary)' }} />
            Notifications
            {unreadCount > 0 && (
              <span style={{ fontSize: '0.8rem', background: 'var(--primary)', color: '#fff', borderRadius: '12px', padding: '2px 8px' }}>
                {unreadCount} new
              </span>
            )}
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            View system alerts, order updates, and inventory warnings.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {unreadCount > 0 && (
            <button className="btn" onClick={markAllRead} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
              <CheckCheck size={16} /> Mark all read
            </button>
          )}
        </div>
      </header>

      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', background: 'var(--background)', borderBottom: '1px solid var(--border)', display: 'flex', gap: '8px' }}>
          <button
            className={`btn ${filter === 'all' ? 'btn-primary' : ''}`}
            onClick={() => setFilter('all')}
            style={{ fontSize: '0.85rem', padding: '6px 12px' }}
          >
            All ({notifications.length})
          </button>
          <button
            className={`btn ${filter === 'unread' ? 'btn-primary' : ''}`}
            onClick={() => setFilter('unread')}
            style={{ fontSize: '0.85rem', padding: '6px 12px' }}
          >
            Unread ({unreadCount})
          </button>
        </div>

        <div>
          {filtered.length === 0 ? (
            <div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Bell size={36} style={{ opacity: 0.3, marginBottom: '8px' }} />
              <p style={{ margin: 0 }}>No notifications to display.</p>
            </div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border)',
                  background: item.is_read ? 'transparent' : 'rgba(59, 130, 246, 0.05)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px',
                  transition: 'background 0.2s ease',
                }}
              >
                <div style={{ marginTop: '2px' }}>
                  {item.type === 'warning' && <AlertTriangle style={{ color: '#f59e0b' }} size={20} />}
                  {item.type === 'success' && <CheckCircle style={{ color: '#10b981' }} size={20} />}
                  {item.type === 'info' && <Info style={{ color: '#3b82f6' }} size={20} />}
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{item.title}</h3>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.time}</span>
                  </div>
                  <p style={{ margin: '6px 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    {item.message}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="icon-button"
                    title={item.is_read ? 'Mark as unread' : 'Mark as read'}
                    onClick={() => toggleRead(item.id)}
                    style={{ height: '30px', minWidth: '30px' }}
                  >
                    <CheckCheck size={14} style={{ color: item.is_read ? 'var(--text-muted)' : 'var(--primary)' }} />
                  </button>
                  <button
                    className="icon-button"
                    title="Delete notification"
                    onClick={() => deleteNotification(item.id)}
                    style={{ height: '30px', minWidth: '30px' }}
                  >
                    <Trash2 size={14} style={{ color: 'var(--danger, #ef4444)' }} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
