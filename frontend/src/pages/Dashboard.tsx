import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightCircle,
  Boxes,
  CalendarDays,
  IndianRupee,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

type DashboardData = {
  total_cylinders: number; filled_cylinders: number; empty_cylinders: number;
  shop_stock: number; kandam_stock: number;
  today_sales: number; today_collection: number; pending_payments: number;
  low_stock: { cylinder_type: string; location: string; status: string; quantity: number; threshold: number }[];
  stock_rows: { id: number; type: string; shop_filled: number; shop_empty: number; kandam_filled: number; kandam_empty: number; total: number; with_customers: number }[];
  recent_activity: { id: number; action: string; description: string; user_name: string }[];
};

function money(value: number | string) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  const loadDashboard = useCallback(() => {
    api.get('/dashboard/')
      .then((response) => setData(response.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadDashboard();

    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  if (!data) return <p style={{ textAlign: 'center', padding: '40px' }}>Loading...</p>;

  const filledPercent = percent(data.filled_cylinders, data.total_cylinders);
  const emptyPercent = percent(data.empty_cylinders, data.total_cylinders);
  const customerTotal = data.stock_rows.reduce((sum, item) => sum + item.with_customers, 0);

  return (
    <div>
      <div className="page-title dashboard-title">
        <div>
          <h1>Overview</h1>
          <p>Gas stock, sales, collections, and movement warnings in one place.</p>
        </div>
        <div className="dashboard-actions">
          <select aria-label="Branch filter">
            <option>All Branches</option>
            <option>Main Shop</option>
            <option>Kandam</option>
          </select>
          <button className="btn btn-compact" type="button" onClick={loadDashboard}>
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      <section className="stat-grid">
        <div className="metric-card strong purple">
          <IndianRupee />
          <span>Today Sales</span>
          <strong>{money(data.today_sales)}</strong>
          <small>{money(data.today_collection)} collected</small>
        </div>
        <div className="metric-card blue">
          <PackageCheck />
          <span>Filled</span>
          <strong>{data.filled_cylinders}</strong>
          <small>{filledPercent}% of total cylinders</small>
        </div>
        <div className="metric-card green">
          <Boxes />
          <span>Empty</span>
          <strong>{data.empty_cylinders}</strong>
          <small>{emptyPercent}% ready to refill</small>
        </div>
        <div className="metric-card orange">
          <AlertTriangle />
          <span>Pending Payments</span>
          <strong>{money(data.pending_payments)}</strong>
          <small>{data.low_stock.length} stock warnings</small>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-kicker">
          <ShoppingBag size={18} />
          <div>
            <h2>Stock overview</h2>
            <p>Status mix and cylinder location breakdown</p>
          </div>
        </div>

        <div className="overview-grid">
          <div className="card dashboard-card">
            <div className="section-head">
              <h2>Status breakdown</h2>
              <span className="badge badge-success">{data.total_cylinders} total</span>
            </div>
            <div className="status-grid">
              <div className="status-tile green">
                <span>Filled</span>
                <strong>{data.filled_cylinders}</strong>
              </div>
              <div className="status-tile orange">
                <span>Empty</span>
                <strong>{data.empty_cylinders}</strong>
              </div>
              <div className="status-tile blue">
                <span>At shop</span>
                <strong>{data.shop_stock}</strong>
              </div>
              <div className="status-tile purple">
                <span>With customers</span>
                <strong>{customerTotal}</strong>
              </div>
            </div>
          </div>

          <div className="card dashboard-card">
            <div className="section-head">
              <h2>Locations</h2>
              <Warehouse size={18} />
            </div>
            <div className="progress-list">
              <ProgressRow label="Main shop" value={data.shop_stock} total={data.total_cylinders} color="green" />
              <ProgressRow label="Kandam" value={data.kandam_stock} total={data.total_cylinders} color="blue" />
              <ProgressRow label="With customers" value={customerTotal} total={data.total_cylinders} color="orange" />
            </div>
          </div>

          <div className="card dashboard-card">
            <div className="section-head">
              <h2>Top cylinder types</h2>
              <TrendingUp size={18} />
            </div>
            <div className="progress-list">
              {data.stock_rows.slice(0, 4).map((item) => (
                <ProgressRow key={item.id} label={item.type} value={item.total} total={data.total_cylinders} color="green" />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-kicker">
          <ShieldCheck size={18} />
          <div>
            <h2>Operations overview</h2>
            <p>Sales readiness, pending payments, and quick actions</p>
          </div>
        </div>

        <section className="grid-2">
          <div className="card dashboard-card">
            <div className="section-head">
              <h2>Readiness</h2>
              <span className="badge">{filledPercent}% filled</span>
            </div>
            <div className="wide-progress">
              <div className="wide-progress-row">
                <span>Filled cylinders</span>
                <strong>{data.filled_cylinders} / {data.total_cylinders}</strong>
              </div>
              <div className="bar-track">
                <span className="bar-fill green" style={{ width: `${filledPercent}%` }} />
              </div>
            </div>
            <div className="mini-metrics">
              <span><strong>{data.today_collection}</strong> collected today</span>
              <span><strong>{data.low_stock.length}</strong> low stock alerts</span>
            </div>
          </div>

          <div className="card dashboard-card">
            <div className="section-head">
              <h2>Quick actions</h2>
              <CalendarDays size={18} />
            </div>
            <div className="action-stack">
              <Link className="btn btn-primary" to="/sales">Add Sale <ArrowRightCircle size={20} /></Link>
              <Link className="btn btn-outline" to="/stock">Move Stock <ArrowRightCircle size={20} /></Link>
            </div>
          </div>
        </section>
      </section>

      <div className="card dashboard-card">
        <div className="section-head">
          <h2>Live stock</h2>
          <span className="badge badge-success">{data.total_cylinders} cylinders</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th style={{ textAlign: 'center' }}>Shop (F/E)</th>
                <th style={{ textAlign: 'center' }}>Kandam (F/E)</th>
                <th style={{ textAlign: 'right' }}>With Customers</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.stock_rows.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.type}</strong></td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>{item.shop_filled}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                    <span style={{ color: 'var(--danger)' }}>{item.shop_empty}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>{item.kandam_filled}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span>
                    <span style={{ color: 'var(--danger)' }}>{item.kandam_empty}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {item.with_customers > 0
                      ? <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{item.with_customers}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProgressRow({ label, value, total, color }: { label: string; value: number; total: number; color: 'green' | 'blue' | 'orange' }) {
  const width = percent(value, total);

  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <strong>{value} <small>/ {total}</small></strong>
      </div>
      <div className="bar-track">
        <span className={`bar-fill ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
