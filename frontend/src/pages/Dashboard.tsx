import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRightCircle, Boxes, IndianRupee, PackageCheck, Warehouse } from 'lucide-react';
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

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get('/dashboard/')
      .then((response) => setData(response.data))
      .catch(() => undefined);
  }, []);

  if (!data) return <p style={{ textAlign: 'center', padding: '40px' }}>Loading…</p>;

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Today</h1>
          <p>Shop, Kandam, sales, and pending money in one place.</p>
        </div>
      </div>

      <section className="stat-grid">
        <div className="metric-card strong">
          <IndianRupee />
          <span>Today Sales</span>
          <strong>{money(data.today_sales)}</strong>
        </div>
        <div className="metric-card">
          <PackageCheck />
          <span>Filled</span>
          <strong>{data.filled_cylinders}</strong>
        </div>
        <div className="metric-card">
          <Boxes />
          <span>Empty</span>
          <strong>{data.empty_cylinders}</strong>
        </div>
        <div className="metric-card">
          <Warehouse />
          <span>Kandam</span>
          <strong>{data.kandam_stock}</strong>
        </div>
      </section>

      <div className="card">
        <div className="section-head">
          <h2>Live Stock</h2>
          <span className="badge badge-success">{data.total_cylinders} total</span>
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
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{item.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="grid-2">
        <div className="card alert-card">
          <div className="section-head">
            <h2>Pending</h2>
            <AlertTriangle />
          </div>
          <strong>{money(data.pending_payments)}</strong>
          <p>{data.low_stock.length} low stock warning</p>
        </div>
        <div className="card">
          <h2>Quick Actions</h2>
          <div className="action-stack">
            <Link className="btn btn-primary" to="/sales">Add Sale <ArrowRightCircle size={20} /></Link>
            <Link className="btn btn-outline" to="/stock">Move Stock <ArrowRightCircle size={20} /></Link>
          </div>
        </div>
      </section>
    </div>
  );
}
