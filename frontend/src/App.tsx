import { Navigate, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { BarChart3, Home, LogOut, Package, ShoppingCart, Users } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Sales from './pages/Sales';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Customers from './pages/Customers';
import { isAuthenticated, logout } from './lib/api';
import RatesPanel from './components/RatesPanel';

function Protected({ children }: { children: ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  const location = useLocation();
  const isAuthPage = location.pathname === '/login';

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Protected>
      <header className="app-header">
        <div className="brand">
          <Package />
          GasBook
        </div>
        <button className="icon-button" title="Logout" onClick={() => { logout(); window.location.href = '/login'; }}>
          <LogOut size={20} />
        </button>
      </header>

      <aside className="side-nav">
        <NavItems />
      </aside>

      <main className="page-container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>

      <nav className="bottom-nav">
        <NavItems />
      </nav>
      <RatesPanel />
    </Protected>
  );
}

function NavItems() {
  return (
    <>
      <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Home />
        <span>Home</span>
      </NavLink>
      <NavLink to="/stock" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Package />
        <span>Stock</span>
      </NavLink>
      <NavLink to="/sales" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <ShoppingCart />
        <span>Sales</span>
      </NavLink>
      <NavLink to="/customers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Users />
        <span>Customers</span>
      </NavLink>
      <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <BarChart3 />
        <span>Reports</span>
      </NavLink>
    </>
  );
}

export default App;
