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
  const [collections, setCollections] = useState<Record<number, { amount: string; method: string; paid_method: string; empty: string; split_cash: string; split_gpay: string; split_bank: string }>>({});
  const [message, setMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [vehicleLocation, setVehicleLocation] = useState('');

  function load() {
    setUserName(localStorage.getItem('gasbook_name') || '');
    setVehicleLocation(localStorage.getItem('gasbook_vehicle_location') || '');
    Promise.all([api.get('/deliveries/'), api.get('/stock/')])
      .then(([deliveryRes, stockRes]) => {
        const rows = deliveryRes.data.results ?? deliveryRes.data;
        setDeliveries(rows);
        setStock(stockRes.data.results ?? stockRes.data);
        setCollections(Object.fromEntries(rows.map((d: Delivery) => [d.id, { amount: '', method: 'cash', paid_method: 'cash', empty: String(d.quantity), split_cash: '', split_gpay: '', split_bank: '' }])));
      })
      .catch(() => undefined);
  }

  useEffect(load, []);

  // Filter filled stock to only vehicle stock
  const vehicleFilledStock = stock
    .filter((s) => s.location_name === vehicleLocation && s.status === 'filled')
    .reduce((sum, s) => sum + s.quantity, 0);

  const filteredStock = vehicleLocation ? stock.filter((s) => s.location_name === vehicleLocation) : stock;

  async function start(id: number) {
    await api.post(`/deliveries/${id}/start/`);
    setMessage('Delivery started. Customer and admin were notified.');
    load();
  }

  async function complete(id: number) {
    const form = collections[id] || { amount: '0', method: 'credit', paid_method: 'cash', empty: '0', split_cash: '', split_gpay: '', split_bank: '' };
    
    const payload: any = {
      payment_method: form.method,
      empty_collected: Number(form.empty || 0),
    };

    if (form.method === 'split') {
      payload.split_payments = [];
      if (Number(form.split_cash) > 0) payload.split_payments.push({ mode: 'cash', amount: Number(form.split_cash) });
      if (Number(form.split_gpay) > 0) payload.split_payments.push({ mode: 'gpay', amount: Number(form.split_gpay) });
      if (Number(form.split_bank) > 0) payload.split_payments.push({ mode: 'bank', amount: Number(form.split_bank) });
    } else {
      payload.payment_collected = form.amount || '0';
      payload.paid_payment_mode = form.paid_method;
    }

    await api.post(`/deliveries/${id}/complete/`, payload);
    setMessage('Delivery completed. Sale, stock, payment, and empty cylinder records were updated.');
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Welcome, {userName || 'Delivery Partner'}</h1>
          <p>
            {vehicleLocation ? `Vehicle Location: ${vehicleLocation}` : 'No vehicle location assigned'} · Assigned deliveries and collections.
          </p>
        </div>
      </div>

      {message && <p className="form-note" style={{ marginBottom: 12 }}>{message}</p>}

      <section className="stat-grid">
        <div className="metric-card strong purple">
          <Truck />
          <span>Assigned</span>
          <strong>{deliveries.filter((d) => d.status !== 'delivered').length}</strong>
        </div>
        <div className="metric-card green">
          <PackageCheck />
          <span>Delivered Today</span>
          <strong>{deliveries.filter((d) => d.status === 'delivered').length}</strong>
        </div>
        <div className="metric-card orange">
          <Banknote />
          <span>Pending Cash</span>
          <strong>{money(deliveries.reduce((sum, d) => sum + Number(d.pending_amount || 0), 0))}</strong>
        </div>
        <div className="metric-card blue">
          <RotateCcw />
          <span>Vehicle Stock (Filled)</span>
          <strong>{vehicleFilledStock}</strong>
        </div>
      </section>

      <div className="grid-2">
        <div>
          {deliveries.map((delivery) => {
            const form = collections[delivery.id] || { amount: '', method: 'cash', paid_method: 'cash', empty: '', split_cash: '', split_gpay: '', split_bank: '' };
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
                      {form.method !== 'split' && (
                        <label>
                          <span>Collected</span>
                          <input
                            type="number"
                            min="0"
                            value={form.amount}
                            onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, amount: e.target.value } }))}
                          />
                        </label>
                      )}
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
                          <option value="split">Split Payment</option>
                        </select>
                      </label>
                      {form.method === 'credit' && Number(form.amount) > 0 && (
                        <label>
                          <span>Received Via</span>
                          <select
                            value={form.paid_method}
                            onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, paid_method: e.target.value } }))}
                          >
                            <option value="cash">Cash</option>
                            <option value="gpay">GPay</option>
                            <option value="bank">Bank</option>
                          </select>
                        </label>
                      )}
                      {form.method === 'split' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', gridColumn: '1 / -1' }}>
                          <label>
                            <span>Cash</span>
                            <input type="number" min="0" value={form.split_cash} onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_cash: e.target.value } }))} placeholder="0" />
                          </label>
                          <label>
                            <span>GPay</span>
                            <input type="number" min="0" value={form.split_gpay} onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_gpay: e.target.value } }))} placeholder="0" />
                          </label>
                          <label>
                            <span>Bank</span>
                            <input type="number" min="0" value={form.split_bank} onChange={(e) => setCollections((prev) => ({ ...prev, [delivery.id]: { ...form, split_bank: e.target.value } }))} placeholder="0" />
                          </label>
                          <label>
                            <span>Credit</span>
                            <input type="number" disabled value={Math.max(0, delivery.quantity * Number(delivery.rate) - (Number(form.split_cash || 0) + Number(form.split_gpay || 0) + Number(form.split_bank || 0)))} style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }} />
                          </label>
                        </div>
                      )}
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
            <h2>{vehicleLocation || 'All Locations'} Stock</h2>
            <PackageCheck />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Location</th><th>Cylinder</th><th>Status</th><th style={{ textAlign: 'right' }}>Qty</th></tr>
              </thead>
              <tbody>
                {filteredStock.map((row) => (
                  <tr key={row.id}>
                    <td>{row.location_name}</td>
                    <td>{row.cylinder_type_name}</td>
                    <td><span className="badge">{row.status}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 800 }}>{row.quantity}</td>
                  </tr>
                ))}
                {filteredStock.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '12px', color: 'var(--text-muted)' }}>
                      No cylinder stock found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
