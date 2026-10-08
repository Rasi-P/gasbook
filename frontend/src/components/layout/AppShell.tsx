import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, CalendarDays, Home, IndianRupee, LogOut, Package, ShoppingCart, Truck, Users, UserCog } from 'lucide-react';
import { logout } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';
import RatesPanel from '../RatesPanel';

type NavEntry = { to: string; label: string; Icon: LucideIcon };

const STAFF_NAV: NavEntry[] = [
  { to: '/staff-dashboard', label: 'Deliveries', Icon: Truck },
  { to: '/stock', label: 'Vehicle Stock', Icon: Package },
  { to: '/customers', label: 'Customers', Icon: Users },
];

const ADMIN_NAV: NavEntry[] = [
  { to: '/admin-dashboard', label: 'Home', Icon: Home },
  { to: '/bookings', label: 'Bookings', Icon: CalendarDays },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/sales', label: 'Sales', Icon: ShoppingCart },
  { to: '/customers', label: 'Customers', Icon: Users },
  { to: '/staff', label: 'Staff', Icon: UserCog },
  { to: '/reports', label: 'Reports', Icon: BarChart3 },
];

function NavItems({ role }: { role: string }) {
  const entries = role === 'staff' ? STAFF_NAV : ADMIN_NAV;
  return (
    <>
      {entries.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          title={label}
          aria-label={label}
          className={({ isActive }) => `shell-nav-item ${isActive ? 'active' : ''}`}
        >
          <Icon /><span>{label}</span>
        </NavLink>
      ))}
    </>
  );
}

function handleLogout() {
  logout();
  window.location.href = '/login';
}

/**
 * Management shell: sticky header, desktop sidebar (≥980px), phone/tablet bottom navigation and the
 * rates trigger (header icon button below 980px, floating button above). Routes are rendered as children.
 */
export function AppShell({ role, userName, children }: { role: string; userName: string; children: ReactNode }) {
  const [ratesOpen, setRatesOpen] = useState(false);
  const today = new Date();
  const monthLabel = today.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  const yearLabel = today.getFullYear();
  const initials = (userName || role).slice(0, 2).toUpperCase();
  const showRates = role === 'admin';
  const toggleRates = () => setRatesOpen((value) => !value);

  return (
    <>
      <header className="shell-header">
        <div className="shell-brand">
          <Package />
          <span>Sabco Gas</span>
        </div>
        <div className="shell-header__tools">
          <span className="shell-date">
            <CalendarDays size={16} />
            {monthLabel}, {yearLabel}
          </span>
          <Badge variant="outline" className="shell-role">{role}</Badge>
          {showRates && (
            <IconButton
              type="button"
              label="Today's Gas Rates"
              variant="outline"
              className="shell-rates-trigger"
              active={ratesOpen}
              aria-expanded={ratesOpen}
              onClick={toggleRates}
            >
              <IndianRupee size={18} />
            </IconButton>
          )}
          <IconButton type="button" label="Notifications" variant="outline">
            <Bell size={18} />
          </IconButton>
          <span className="shell-avatar" aria-hidden="true">{initials}</span>
        </div>
      </header>

      <aside className="shell-sidebar">
        <div className="shell-sidebar__brand">
          <div className="shell-brand">
            <Package />
            <span>Sabco Gas</span>
          </div>
        </div>
        <nav className="shell-nav" aria-label="Main navigation">
          <NavItems role={role} />
        </nav>
        <div className="shell-sidebar__profile">
          <span className="shell-avatar" aria-hidden="true">{initials}</span>
          <div className="shell-sidebar__info">
            <span className="shell-sidebar__name" title={userName || 'User'}>{userName || 'User'}</span>
            <span className="shell-sidebar__role">{role}</span>
          </div>
          <IconButton type="button" label="Logout" tone="danger" onClick={handleLogout}>
            <LogOut size={18} />
          </IconButton>
        </div>
      </aside>

      <main className="shell-main">
        <div className="shell-content">{children}</div>
      </main>

      <nav className="shell-bottom-nav" aria-label="Mobile navigation">
        <NavItems role={role} />
      </nav>

      {showRates && (
        <>
          <button
            type="button"
            className="shell-rates-fab"
            title="Today's Gas Rates"
            aria-label="Today's Gas Rates"
            aria-expanded={ratesOpen}
            onClick={toggleRates}
          >
            <IndianRupee size={22} />
          </button>
          <RatesPanel open={ratesOpen} onClose={() => setRatesOpen(false)} />
        </>
      )}
    </>
  );
}
