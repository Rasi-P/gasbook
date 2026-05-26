import { useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Navigation, PackageCheck, RotateCcw, Truck } from 'lucide-react';
import { api } from '../lib/api';

type Delivery = {
  id: number;
  status: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  rate: string;
  pending_amount: string;
  deposit_cylinders: number;
};
type Stock = { id: number; cylinder_type_name: string; location_name: string; status: string; quantity: number };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function StaffDashboard() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [collections, setCollections] = useState<Record<number, { amount: string; method: string; empty: string }>>({});
  const [message, setMessage] = useState('');

  function load() {
    Promise.all([api.get('/deliveries/'), api.get('/stock/')])
      .then(([deliveryRes, stockRes]) => {
        const rows = deliveryRes.data.results ?? deliveryRes.data;
        setDeliveries(rows);
        setStock(stockRes.data.results ?? stockRes.data);
        setCollections(Object.fromEntries(rows.map((d: Delivery) => [d.id, { amount: '', method: 'cash', empty: String(d.quantity) }])));
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  async function start(id: number) {
    await api.post(`/deliveries/${id}/start/`);
    setMessage('Delivery started. Customer and admin were notified.');
    load();
  }

  async function complete(id: number) {
    const form = collections[id] || { amount: '0', method: 'credit', empty: '0' };
    await api.post(`/deliveries/${id}/complete/`, {
      payment_collected: form.amount || '0',
      payment_method: form.method,
      empty_collected: Number(form.empty || 0),
    });
    setMessage('Delivery completed. Sale, stock, payment, and empty cylinder records were updated.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Delivery App</h1>
          <p>Assigned deliveries, customer details, collections, and vehicle stock.</p>
        </div>
      </div>

      {message && <p className="form-note" style={{ marginBottom: 12 }}>{message}</p>}

      <section className="stat-grid">
        <div className="metric-card strong">
          <Truck />
          <span>Assigned</span>
          <strong>{deliveries.filter((d) => d.status !== 'delivered').length}</strong>
        </div>
        <div className="metric-card">
          <PackageCheck />
          <span>Delivered</span>
          <strong>{deliveries.filter((d) => d.status === 'delivered').length}</strong>
        </div>
        <div className="metric-card">
          <Banknote />
          <span>Pending Cash</span>
          <strong>{money(deliveries.reduce((sum, d) => sum + Number(d.pending_amount || 0), 0))}</strong>
        </div>
        <div className="metric-card">
          <RotateCcw />
          <span>Filled Stock</span>
          <strong>{stock.filter((s) => s.status === 'filled').reduce((sum, s) => sum + s.quantity, 0)}</strong>
        </div>
      </section>

      <div className="grid-2">
        <div>
          {deliveries.map((delivery) => {
            const form = collections[delivery.id] || { amount: '', method: 'cash', empty: '' };
            return (
              <div className="card form-stack" key={delivery.id}>
                <div className="section-head">
                  <div>
                    <h2>{delivery.customer_name}</h2>
                    <p>{delivery.customer_area} - {delivery.customer_phone}</p>
                  </div>
                  <span className="badge badge-warning">{delivery.status.replaceAll('_', ' ')}</span>
                </div>
                <p>{delivery.customer_address}</p>
                <div className="summary-grid">
                  <p><span>Cylinder</span><strong>{delivery.quantity} x {delivery.cylinder_type_name}</strong></p>
                  <p><span>Rate</span><strong>{money(delivery.rate)}</strong></p>
                  <p><span>Pending</span><strong>{money(delivery.pending_amount)}</strong></p>
                </div>
                {delivery.status !== 'delivered' && (
                  <>
                    <div className="grid-3">
                      <label>
                        <span>Collected</span>
                        <input
                          type="number"
                          min="0"
                          value={form.amount}
                          onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, amount: e.target.value } }))}
                        />
                      </label>
                      <label>
                        <span>Payment Mode</span>
                        <select
                          value={form.method}
                          onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, method: e.target.value } }))}
                        >
                          <option value="cash">Cash</option>
                          <option value="gpay">GPay</option>
                          <option value="bank">Bank</option>
                          <option value="credit">Credit Pending</option>
                        </select>
                      </label>
                      <label>
                        <span>Empty Collected</span>
                        <input
                          type="number"
                          min="0"
                          value={form.empty}
                          onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, empty: e.target.value } }))}
                        />
                      </label>
                    </div>
                    <div className="grid-2">
                      <button className="btn btn-outline" type="button" onClick={() => start(delivery.id)}>
                        <Navigation size={20} /> Start Delivery
                      </button>
                      <button className="btn btn-primary" type="button" onClick={() => complete(delivery.id)}>
                        <CheckCircle2 size={20} /> Delivered
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {deliveries.length === 0 && <div className="card"><p>No assigned deliveries.</p></div>}
        </div>

        <div className="card">
          <div className="section-head">
            <h2>Live Stock</h2>
            <PackageCheck />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Location</th><th>Cylinder</th><th>Status</th><th style={{ textAlign: 'right' }}>Qty</th></tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <tr key={row.id}>
                    <td>{row.location_name}</td>
                    <td>{row.cylinder_type_name}</td>
                    <td><span className="badge">{row.status}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{row.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
