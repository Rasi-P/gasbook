import { AdminNotifications } from './AdminNotifications';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, Building2, CalendarDays, Home, IndianRupee, LogOut, Package, ShoppingCart, Truck, Users, UserCog } from 'lucide-react';
import { logout } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { IconButton } from '../ui/IconButton';
import RatesPanel from '../RatesPanel';
import sabcoLogoWhite from '../../assets/sabco_logo.png';
import sabcoLogoBlue from '../../assets/sabco_logo_blue.svg';

type NavEntry = { to: string; label: string; Icon: LucideIcon };

const STAFF_NAV: NavEntry[] = [
  { to: '/staff-dashboard', label: 'Deliveries', Icon: Truck },
  { to: '/stock', label: 'Vehicle Stock', Icon: Package },
  { to: '/customers', label: 'Customers', Icon: Users },
];

const ADMIN_NAV: NavEntry[] = [
  { to: '/admin-dashboard', label: 'Home', Icon: Home },
  { to: '/bookings', label: 'Bookings', Icon: CalendarDays },
  { to: '/products', label: 'Products & Inventory', Icon: Package },
  { to: '/stock', label: 'Stock', Icon: Package },
  { to: '/sales', label: 'Sales', Icon: ShoppingCart },
  { to: '/customers', label: 'Customers', Icon: Users },
  { to: '/staff', label: 'Staff', Icon: UserCog },
  { to: '/reports', label: 'Reports', Icon: BarChart3 },
];

const PLATFORM_NAV: NavEntry[] = [
  { to: '/platform', label: 'Agencies', Icon: Building2 },
];

function navFor(role: string) {
  if (role === 'staff') return STAFF_NAV;
  if (role === 'platform_admin') return PLATFORM_NAV;
  return ADMIN_NAV;
}

function NavItems({ role }: { role: string }) {
  const entries = navFor(role);
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
type AppShellProps = {
  role: string;
  userName: string;
  tenantName?: string;
  /** The original agency, whose logo ships with the app; other agencies are shown by name. */
  showBrandLogo?: boolean;
  children: ReactNode;
};

export function AppShell({ role, userName, tenantName, showBrandLogo = false, children }: AppShellProps) {
  const [ratesOpen, setRatesOpen] = useState(false);
  const today = new Date();
  const monthLabel = today.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  const yearLabel = today.getFullYear();
  const initials = (userName || role).slice(0, 2).toUpperCase();
  const brand = tenantName || 'GasBook';
  const roleLabel = role === 'platform_admin' ? 'platform' : role;
  const showRates = role === 'admin';
  const toggleRates = () => setRatesOpen((value) => !value);

  return (
    <>
      <header className="shell-header">
        <div className="shell-brand">
          {showBrandLogo
            ? <img src={sabcoLogoBlue} className="shell-brand__logo" alt={brand} />
            : <><Package /><span title={brand}>{brand}</span></>}
        </div>
        <div className="shell-header__tools">
          <span className="shell-date">
            <CalendarDays size={16} />
            {monthLabel}, {yearLabel}
          </span>
          <Badge variant="outline" className="shell-role">{roleLabel}</Badge>
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
          <div className="shell-header__account">
            {role === 'admin' ? <AdminNotifications /> : <IconButton type="button" label="Notifications" variant="outline">
              <Bell size={18} />
            </IconButton>}
            <span className="shell-avatar" aria-hidden="true">{initials}</span>
          </div>
        </div>
      </header>

      <aside className="shell-sidebar">
        <div className="shell-sidebar__brand">
          <div className="shell-brand">
            {showBrandLogo
              ? <img src={sabcoLogoWhite} className="shell-brand__logo" alt={brand} />
              : <><Package /><span title={brand}>{brand}</span></>}
          </div>
        </div>
        <nav className="shell-nav" aria-label="Main navigation">
          <NavItems role={role} />
        </nav>
        <div className="shell-sidebar__profile">
          <span className="shell-avatar" aria-hidden="true">{initials}</span>
          <div className="shell-sidebar__info">
            <span className="shell-sidebar__name" title={userName || 'User'}>{userName || 'User'}</span>
            <span className="shell-sidebar__role">{roleLabel}</span>
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
