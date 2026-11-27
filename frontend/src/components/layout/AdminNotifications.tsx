import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api, extractApiError, fetchAllPages } from '../../lib/api';
import { formatDateTime } from '../../lib/dateTime';
import { usePager } from '../../hooks/usePager';
import { Pager } from '../Pager';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import '../../styles/notifications.css';

type Notification = { id: number; title: string; body: string; created_at: string; is_read: boolean; booking: number | null };

export function AdminNotifications() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busyIds, setBusyIds] = useState<number[]>([]);
  const mounted = useRef(false);
  const fetching = useRef(false);
  const marking = useRef(new Set<number>());
  const readIds = useRef(new Set<number>());
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const unread = items.filter(item => !item.is_read).length;
  const { page, pageCount, pageItems, setPage, total } = usePager(unreadOnly ? items.filter(item => !item.is_read) : items, 10, unreadOnly);

  const load = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    try {
      const rows = await fetchAllPages<Notification>('/notifications/');
      if (!mounted.current) return;
      // A refresh started before mark-read must not bring a read badge back.
      setItems(rows.map(item => readIds.current.has(item.id) ? { ...item, is_read: true } : item));
      setLoaded(true);
      setError('');
    } catch (err) {
      if (mounted.current) setError(extractApiError(err, [], 'Could not load notifications. Please try again.'));
    } finally {
      fetching.current = false;
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { mounted.current = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const triggerButton = trigger.current;
    const dialog = panel.current?.closest<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first = buttons?.[0], last = buttons?.[buttons.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog?.addEventListener('keydown', trap);
    return () => { dialog?.removeEventListener('keydown', trap); triggerButton?.focus(); };
  }, [open]);

  async function markRead(item: Notification) {
    if (item.is_read || readIds.current.has(item.id)) return true;
    if (marking.current.has(item.id)) return false;
    marking.current.add(item.id);
    setBusyIds([...marking.current]);
    setReadError('');
    try {
      await api.post(`/notifications/${item.id}/mark_read/`);
      readIds.current.add(item.id);
      if (mounted.current) setItems(rows => rows.map(row => row.id === item.id ? { ...row, is_read: true } : row));
      return true;
    } catch (err) {
      if (mounted.current) setReadError(extractApiError(err, [], 'Could not mark the notification as read. Please try again.'));
      return false;
    } finally {
      marking.current.delete(item.id);
      if (mounted.current) setBusyIds([...marking.current]);
    }
  }

  return <>
    <IconButton ref={trigger} type="button" label="Notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} variant="outline" className="admin-notification-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); void load(); }}>
      <Bell size={18} />
      {(unread > 0 || error) && <span className="admin-notification-count" aria-hidden="true">{error ? '!' : unread > 99 ? '99+' : unread}</span>}
    </IconButton>
    <Modal open={open} onClose={() => setOpen(false)} closeOnEscape closeOnOverlay title="Notifications" description={loaded ? `${unread} unread notification${unread === 1 ? '' : 's'}` : undefined}>
      <div ref={panel} className="admin-notification-panel">
        <div className="admin-notification-controls">
          <div className="admin-notification-filters" role="group" aria-label="Filter notifications">
            <Button type="button" size="sm" variant={unreadOnly ? 'secondary' : 'primary'} aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</Button>
            <Button type="button" size="sm" variant={unreadOnly ? 'primary' : 'secondary'} aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread</Button>
          </div>
          <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : error ? 'Retry' : 'Refresh'}</Button>
        </div>
        {error && <Alert tone="danger" role="alert">{error}{loaded ? ' Showing previously loaded notifications.' : ''}</Alert>}
        {readError && <Alert tone="danger" role="alert">{readError}</Alert>}
        {!loaded && loading && <p role="status">Loading notifications…</p>}
        {loaded && !error && total === 0 && <EmptyState compact icon={<Bell size={24} />} title={unreadOnly ? 'You’re all caught up.' : 'No notifications yet.'} />}
        <div className="admin-notification-list">
          {pageItems.map(item => <article key={item.id} className={`admin-notification${item.is_read ? '' : ' admin-notification--unread'}`}>
            <div className="admin-notification-title"><h3>{item.title}</h3>{!item.is_read && <span>Unread</span>}</div>
            <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
            <p>{item.body}</p>
            <div className="admin-notification-actions">
              {item.booking != null && <Button type="button" size="sm" variant="secondary" disabled={busyIds.includes(item.id)} onClick={async () => {
                if (await markRead(item) && mounted.current) { setOpen(false); navigate(`/bookings?booking=${item.booking}`); }
              }}>View booking</Button>}
              {!item.is_read && <Button type="button" size="sm" variant="link" disabled={busyIds.includes(item.id)} onClick={() => void markRead(item)}>{busyIds.includes(item.id) ? 'Saving…' : 'Mark as read'}</Button>}
            </div>
          </article>)}
        </div>
        <Pager page={page} pageCount={pageCount} onChange={setPage} total={total} />
      </div>
    </Modal>
  </>;
}
