import { Navigate, Routes, Route, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
import { ErrorState, LoadingState } from './components/AsyncState';
import { AppShell } from './components/layout/AppShell';
import { Button } from './components/ui/Button';

function Protected({ children }: { children: ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return children;
}

function RoleGuard({ allowed, role, children }: { allowed: string[]; role: string; children: ReactNode }) {
  if (!role) return <LoadingState />;
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
        <div className="shell-main shell-main--centered">
          <ErrorState message={meError} onRetry={loadMe} />
          <Button type="button" variant="secondary" onClick={() => { logout(); window.location.href = '/login'; }}>
            Logout
          </Button>
        </div>
      );
    }
    return (
      <div className="shell-main shell-main--centered">
        <LoadingState label="Loading your account…" />
      </div>
    );
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
      <AppShell role={role} userName={userName}>
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
      </AppShell>
    </Protected>
  );
}
