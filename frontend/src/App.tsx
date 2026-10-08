import { Navigate, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, CalendarDays, Home, LogOut, Package, ShoppingCart, Truck, Users, UserCog } from 'lucide-react';
import Dashboard from './pages/admin/Dashboard';
import Stock from './pages/Stock';
import Sales from './pages/Sales';
import Reports from './pages/admin/Reports';
import Login from './pages/Login';
import Customers from './pages/Customers';
import Staff from './pages/admin/Staff';
import StaffDashboard from './pages/staff/StaffDashboard';
import ChangePassword from './pages/ChangePassword';
import AdminBookings from './pages/admin/AdminBookings';
import { getRoleHome, isAuthenticated, logout, api, extractApiError, FORCE_PASSWORD_CHANGE_KEY } from './lib/api';
import RatesPanel from './components/RatesPanel';
import { ErrorState } from './components/AsyncState';

function Protected({ children }: { children: ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return children;
}

function RoleGuard({ allowed, role, children }: { allowed: string[]; role: string; children: ReactNode }) {
  if (!role) return <p style={{ textAlign: 'center', padding: '40px' }}>Loading…</p>;
  if (!allowed.includes(role)) return <Navigate to={getRoleHome(role)} replace />;
  return children;
}

export default function App() {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login';
  const [role, setRole] = useState('');
  const [userName, setUserName] = useState('');
  const [mustChange, setMustChange] = useState(() => localStorage.getItem(FORCE_PASSWORD_CHANGE_KEY) === '1');
  const [meError, setMeError] = useState('');
  const today = new Date();
  const monthLabel = today.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  const yearLabel = today.getFullYear();

  const loadMe = useCallback(() => {
    setMeError('');
    api.get('/auth/me/').then((r) => {
      localStorage.setItem('gasbook_role', r.data.role);
      localStorage.setItem('gasbook_name', r.data.name);
      localStorage.setItem('gasbook_vehicle_location', r.data.vehicle_location_name || '');
      const mc = Boolean(r.data.must_change_password);
      setMustChange(mc);
      if (mc) localStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
      else localStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
      setRole(r.data.role);
      setUserName(r.data.name);
    }).catch((err) => {
      setMeError(extractApiError(err, [], 'Could not load your account. Please retry or log in again.'));
    });
  }, []);

  useEffect(() => {
    if (!isAuthPage && isAuthenticated()) {
      const storedRole = localStorage.getItem('gasbook_role');
      const storedName = localStorage.getItem('gasbook_name');
      if (storedRole) {
        setRole(storedRole);
      }
      if (storedName) {
        setUserName(storedName);
      }
      loadMe();
    }
  }, [isAuthPage, loadMe]);

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
      </Routes>
    );
  }

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (mustChange) {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }

  if (!role) {
    if (meError) {
      return (
        <div className="page-container">
          <ErrorState message={meError} onRetry={loadMe} />
          <button className="btn btn-outline" type="button" style={{ width: 'auto' }} onClick={() => { logout(); window.location.href = '/login'; }}>
            Logout
          </button>
        </div>
      );
    }
    return <p style={{ textAlign: 'center', padding: '40px' }}>Loading…</p>;
  }

  if (role === 'staff') {
    return (
      <Protected>
        <Routes>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/staff-dashboard" element={<StaffDashboard />} />
          <Route path="*" element={<Navigate to={getRoleHome(role)} replace />} />
        </Routes>
      </Protected>
    );
  }

  return (
    <Protected>
      <header className="app-header">
        <div className="brand">
          <Package />
          Sabco Gas
        </div>
        <div className="topbar-tools">
          <span className="topbar-date">
            <CalendarDays size={14} />
            {monthLabel}, {yearLabel}
          </span>
          <span className="role-pill">{role}</span>
          <button className="icon-button" title="Notifications" type="button">
            <Bell size={18} />
          </button>
          <div className="profile-avatar topbar-avatar">
            {(userName || role).slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>

      <aside className="side-nav">
        <div className="sidebar-brand">
          <Package />
          <span>Sabco Gas</span>
        </div>
        <NavItems role={role} />
        <div className="sidebar-profile">
          <div className="profile-avatar">
            {(userName || role).slice(0, 2).toUpperCase()}
          </div>
          <div className="profile-info">
            <span className="profile-name" title={userName || 'User'}>
              {userName || 'User'}
            </span>
            <span className="profile-role">{role}</span>
          </div>
          <button 
            className="profile-logout" 
            title="Logout" 
            onClick={() => { logout(); window.location.href = '/login'; }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="page-container">
        <Routes>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/" element={<Navigate to={getRoleHome(role)} replace />} />

          <Route path="/admin-dashboard" element={
            <RoleGuard allowed={['admin']} role={role}><Dashboard /></RoleGuard>
          } />
          <Route path="/bookings" element={
            <RoleGuard allowed={['admin']} role={role}><AdminBookings /></RoleGuard>
          } />
          <Route path="/stock" element={
            <RoleGuard allowed={['admin']} role={role}><Stock /></RoleGuard>
          } />
          <Route path="/sales" element={
            <RoleGuard allowed={['admin']} role={role}><Sales /></RoleGuard>
          } />
          <Route path="/customers" element={
            <RoleGuard allowed={['admin']} role={role}><Customers /></RoleGuard>
          } />
          <Route path="/reports" element={
            <RoleGuard allowed={['admin']} role={role}><Reports /></RoleGuard>
          } />
          <Route path="/staff" element={
            <RoleGuard allowed={['admin']} role={role}><Staff /></RoleGuard>
          } />
          <Route path="*" element={<Navigate to={getRoleHome(role)} replace />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <NavItems role={role} />
      </nav>
      {role === 'admin' && <RatesPanel />}
    </Protected>
  );
}

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
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Icon /><span>{label}</span>
        </NavLink>
      ))}
    </>
  );
}
