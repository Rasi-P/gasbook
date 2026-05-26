import { Navigate, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, Home, LogOut, Package, ShoppingCart, Users, UserCog } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Customers from './pages/Customers';
import Staff from './pages/Staff';
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

  useEffect(() => {
    if (!isAuthPage && isAuthenticated()) {
      const stored = localStorage.getItem('gasbook_role');
      if (stored) {
        setRole(stored);
      } else {
        api.get('/auth/me/').then((r) => {
          localStorage.setItem('gasbook_role', r.data.role);
          setRole(r.data.role);
        }).catch(() => undefined);
      }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>
            {role.toUpperCase()}
          </span>
          <button className="icon-button" title="Logout" onClick={() => { logout(); window.location.href = '/login'; }}>
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <aside className="side-nav">
        <NavItems role={role} />
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
            <RoleGuard allowed={['customer']} role={role}><CustomerHome /></RoleGuard>
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

function CustomerHome() {
  return (
    <div>
      <div className="page-title">
        <div>
          <h1>My Account</h1>
          <p>Contact the shop for your cylinder orders.</p>
        </div>
      </div>
      <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <Package size={48} style={{ color: 'var(--primary)', marginBottom: '16px' }} />
        <h2 style={{ marginBottom: '8px' }}>Welcome to GasBook</h2>
        <p>Your account is managed by the shop admin.</p>
        <p style={{ marginTop: '8px' }}>For orders or balance queries, contact the shop directly.</p>
      </div>
    </div>
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
