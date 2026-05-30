import { Navigate, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, Bell, CalendarDays, Home, LogOut, Package, ShoppingCart, Users, UserCog } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Customers from './pages/Customers';
import Staff from './pages/Staff';
import CustomerDashboard from './pages/CustomerDashboard';
import { getRoleHome, isAuthenticated, logout, api } from './lib/api';
import RatesPanel from './components/RatesPanel';

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
  const today = new Date();
  const monthLabel = today.toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
  const yearLabel = today.getFullYear();

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
      
      api.get('/auth/me/').then((r) => {
        localStorage.setItem('gasbook_role', r.data.role);
        localStorage.setItem('gasbook_name', r.data.name);
        localStorage.setItem('gasbook_vehicle_location', r.data.vehicle_location_name || '');
        setRole(r.data.role);
        setUserName(r.data.name);
      }).catch(() => undefined);
    }
  }, [isAuthPage]);

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  if (!role) {
    return <p style={{ textAlign: 'center', padding: '40px' }}>Loading…</p>;
  }

  return (
    <Protected>
      <header className="app-header">
        <div className="brand">
          <Package />
          GasBook
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
          <span>GasBook</span>
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
          <Route path="/" element={<Navigate to={getRoleHome(role)} replace />} />

          <Route path="/admin-dashboard" element={
            <RoleGuard allowed={['admin', 'staff']} role={role}><Dashboard /></RoleGuard>
          } />
          <Route path="/staff-dashboard" element={
            <RoleGuard allowed={['admin', 'staff']} role={role}><Dashboard /></RoleGuard>
          } />
          <Route path="/stock" element={
            <RoleGuard allowed={['admin', 'staff']} role={role}><Stock /></RoleGuard>
          } />
          <Route path="/sales" element={
            <RoleGuard allowed={['admin', 'staff']} role={role}><Sales /></RoleGuard>
          } />
          <Route path="/customers" element={
            <RoleGuard allowed={['admin', 'staff']} role={role}><Customers /></RoleGuard>
          } />
          <Route path="/reports" element={
            <RoleGuard allowed={['admin']} role={role}><Reports /></RoleGuard>
          } />
          <Route path="/staff" element={
            <RoleGuard allowed={['admin']} role={role}><Staff /></RoleGuard>
          } />
          <Route path="/customer-dashboard" element={
            <RoleGuard allowed={['customer']} role={role}><CustomerDashboard /></RoleGuard>
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

function NavItems({ role }: { role: string }) {
  if (role === 'customer') {
    return (
      <NavLink to="/customer-dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Home /><span>Home</span>
      </NavLink>
    );
  }

  if (role === 'staff') {
    return (
      <>
        <NavLink to="/staff-dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Home /><span>Home</span>
        </NavLink>
        <NavLink to="/stock" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Package /><span>Stock</span>
        </NavLink>
        <NavLink to="/sales" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ShoppingCart /><span>Sales</span>
        </NavLink>
        <NavLink to="/customers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Users /><span>Customers</span>
        </NavLink>
      </>
    );
  }

  // Admin
  return (
    <>
      <NavLink to="/admin-dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Home /><span>Home</span>
      </NavLink>
      <NavLink to="/stock" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Package /><span>Stock</span>
      </NavLink>
      <NavLink to="/sales" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <ShoppingCart /><span>Sales</span>
      </NavLink>
      <NavLink to="/customers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Users /><span>Customers</span>
      </NavLink>
      <NavLink to="/staff" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <UserCog /><span>Staff</span>
      </NavLink>
      <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <BarChart3 /><span>Reports</span>
      </NavLink>
    </>
  );
}
