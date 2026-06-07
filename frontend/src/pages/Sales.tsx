import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Banknote, Building2, CreditCard, Minus, Plus,
  RotateCcw, Search, Smartphone, Trash2, User,
} from 'lucide-react';
import { api } from '../lib/api';

type CylinderType = { id: number; name: string; selling_price: number; refill_rate: number };
type Location = { id: number; name: string; code: string };
type SaleItem = { cylinder_type: number; quantity: number; rate: string; empty_returned: number };
type HistorySale = {
  id: number;
  customer_name: string;
  sold_by_name: string;
  items: { cylinder_type_name: string; quantity: number; rate: number }[];
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  created_at: string;
};

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gpay', label: 'GPay', icon: Smartphone },
  { value: 'bank', label: 'Bank', icon: Building2 },
  { value: 'credit', label: 'Credit', icon: CreditCard },
];

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function Sales() {
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [cylinderTypes, setCylinderTypes] = useState<CylinderType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // Customer search
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<{ id: number; name: string; phone: string; address: string; pending_balance: number; empties_owed: number; sales_count: number; custom_rates: any[]; empty_credits: Record<number, { credit: number; name: string }> }[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [location, setLocation] = useState(0);

  // Sale items (start empty — user adds as needed)
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');

  // Empty-return-only mode
  const [returnMode, setReturnMode] = useState(false);
  const [returnEmpties, setReturnEmpties] = useState<{ cylinder_type: number; quantity: number }[]>([]);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // History state
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/cylinder-types/'), api.get('/locations/')])
      .then(([tr, lr]) => {
        const types: CylinderType[] = tr.data.results ?? tr.data;
        const locs: Location[] = lr.data.results ?? lr.data;
        setCylinderTypes(types);
        setLocations(locs);
        setLocation(locs[0]?.id ?? 1);
        // Don't pre-populate items — user adds when ready
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!customerName.trim() || selectedCustomerId !== null) {
      setCustomerSuggestions([]);
      return;
    }
    const t = setTimeout(() => {
      api.get('/customers/', { params: { search: customerName } })
        .then((r) => setCustomerSuggestions((r.data.results ?? r.data).slice(0, 5)))
        .catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [customerName, selectedCustomerId]);

  function fetchHistory() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterPending) params.pending = '1';
    api.get('/sales/', { params })
      .then((r) => setSales(r.data.results ?? r.data))
      .catch(() => undefined);
  }

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab, search, filterPending]);

  // ── Item helpers ──────────────────────────────────────────────────────────

  function applyPricingRules(itemsToProcess: SaleItem[], customer: any | null): SaleItem[] {
    const credits = customer?.empty_credits ? { ...customer.empty_credits } : {};

    const newItems: SaleItem[] = [];

    for (const item of itemsToProcess) {
      const t = cylinderTypes.find(c => c.id === item.cylinder_type);
      if (!t) {
        newItems.push(item);
        continue;
      }

      // 1. Check custom rate first
      const custom = customer?.custom_rates?.find((cr: any) => cr.cylinder_type === item.cylinder_type);
      if (custom) {
        newItems.push({ ...item, rate: String(custom.custom_price) });
        continue;
      }

      // 2. Calculate available empty credits
      const availableCredit = credits[item.cylinder_type]?.credit || 0;
      const refillAllowed = item.empty_returned + availableCredit;

      // 3. Determine pricing
      if (item.quantity <= refillAllowed) {
        // Entire row gets refill rate
        newItems.push({ ...item, rate: String(t.refill_rate) });
        // Deduct used credits (only the portion that came from credits, not from empty_returned)
        const usedCredit = Math.max(0, item.quantity - item.empty_returned);
        if (credits[item.cylinder_type]) {
          credits[item.cylinder_type].credit = availableCredit - usedCredit;
        }
      } else {
        // Splitting required
        if (refillAllowed > 0) {
          // Row 1: The portion covered by empties/credits (at Refill Rate)
          newItems.push({
            ...item,
            quantity: refillAllowed,
            rate: String(t.refill_rate),
            empty_returned: item.empty_returned // All empties stay with the refill row
          });
          if (credits[item.cylinder_type]) {
            credits[item.cylinder_type].credit = availableCredit - Math.max(0, refillAllowed - item.empty_returned);
          }
        }

        const remainder = item.quantity - refillAllowed;
        if (remainder > 0) {
          // Row 2: The remaining portion (at Sale Price)
          newItems.push({
            cylinder_type: item.cylinder_type,
            quantity: remainder,
            rate: String(t.selling_price),
            empty_returned: 0 // Empties were used in the previous row
          });
        }
      }
    }

    // Consolidate rows that have the exact same cylinder_type and rate
    const finalItems: SaleItem[] = [];
    for (const item of newItems) {
      const existing = finalItems.find(i => i.cylinder_type === item.cylinder_type && i.rate === item.rate);
      if (existing) {
        existing.quantity += item.quantity;
        existing.empty_returned += item.empty_returned;
      } else {
        finalItems.push({ ...item });
      }
    }

    return finalItems;
  }

  function updateItem(index: number, patch: Partial<SaleItem>) {
    setItems((prev) => {
      const next = prev.map((item, i) => i === index ? { ...item, ...patch } : item);
      // If user explicitly changed the rate, don't auto-recalculate the rest of the row's pricing
      if (patch.rate !== undefined) return next;
      
      return applyPricingRules(next, selectedCustomer);
    });
  }

  function addItem() {
    const t = cylinderTypes[0];
    const newItem = { cylinder_type: t?.id ?? 0, quantity: 1, rate: String(t?.selling_price ?? '0'), empty_returned: 0 };
    setItems((prev) => applyPricingRules([...prev, newItem], selectedCustomer));
  }

  // Update rates if customer selection changes
  useEffect(() => {
    if (items.length > 0) {
      setItems((prev) => applyPricingRules(prev, selectedCustomer));
    }
  }, [selectedCustomer]);

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Empty-return-only helpers ─────────────────────────────────────────────

  function addReturnRow() {
    setReturnEmpties((prev) => [...prev, { cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: 1 }]);
  }

  function updateReturnRow(index: number, patch: Partial<{ cylinder_type: number; quantity: number }>) {
    setReturnEmpties((prev) => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  function removeReturnRow(index: number) {
    setReturnEmpties((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * Number(item.rate || 0), 0),
    [items],
  );
  const paid = paymentMode === 'credit' ? Number(paidAmount || 0) : total;
  const balance = Math.max(total - paid, 0);

  // ── Submit sale ───────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(''); setError('');
    if (items.length === 0) { setError('Add at least one cylinder item.'); return; }
    try {
      let customerId: number | null = selectedCustomerId;
      if (!customerId && customerName.trim()) {
        const res = await api.post('/customers/', { name: customerName.trim(), phone, address });
        customerId = res.data.id;
      }
      await api.post('/sales/', {
        customer: customerId,
        location,
        payment_mode: paymentMode,
        paid_amount: paid,
        sale_items: items.map((item) => ({
          cylinder_type: item.cylinder_type,
          quantity: item.quantity,
          rate: item.rate,
          empty_returned: item.empty_returned,
        })),
      });
      setMessage(`Sale saved! Total ${money(total)}, Balance ${money(balance)}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setPaidAmount(''); setPaymentMode('cash');
      setItems([]);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setError(msg ? JSON.stringify(msg) : 'Failed to save sale. Check backend connection.');
    }
  }

  // ── Submit empty-return-only ──────────────────────────────────────────────

  async function handleReturnSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(''); setError('');
    if (!selectedCustomerId) { setError('Select a customer to record empty returns.'); return; }
    if (returnEmpties.length === 0) { setError('Add at least one cylinder type to return.'); return; }
    const totalEmpties = returnEmpties.reduce((s, r) => s + r.quantity, 0);
    try {
      await api.post('/sales/', {
        customer: selectedCustomerId,
        location,
        payment_mode: 'cash',
        paid_amount: 0,
        note: 'Empty cylinders returned',
        sale_items: returnEmpties.map((r) => ({
          cylinder_type: r.cylinder_type,
          quantity: 0,
          rate: 0,
          empty_returned: r.quantity,
        })),
      });
      const locName = locations.find(l => l.id === location)?.name || '';
      setMessage(`Recorded ${totalEmpties} empty cylinder(s) returned at ${locName}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setReturnEmpties([]);
      setReturnMode(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setError(msg ? JSON.stringify(msg) : 'Failed to record return.');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="page-title">
        <div><h1>Sales</h1><p>Multi-cylinder invoice entry and history.</p></div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '16px' }}>
        {(['new', 'history'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px', border: 'none', borderRadius: '6px',
            background: tab === t ? 'var(--surface)' : 'transparent',
            fontWeight: 600, color: tab === t ? 'var(--text)' : 'var(--text-muted)',
          }}>
            {t === 'new' ? 'New Sale' : 'History'}
          </button>
        ))}
      </div>

      {tab === 'new' && (
        <>
          {/* Mode toggle: Sale vs Return Empties */}
          <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => { setReturnMode(false); setError(''); setMessage(''); }}
              style={{
                flex: 1, padding: '9px', border: 'none', borderRadius: '6px',
                background: !returnMode ? 'var(--surface)' : 'transparent',
                fontWeight: 600, color: !returnMode ? 'var(--text)' : 'var(--text-muted)',
              }}
            >
              🧾 Sale
            </button>
            <button
              type="button"
              onClick={() => { setReturnMode(true); setError(''); setMessage(''); }}
              style={{
                flex: 1, padding: '9px', border: 'none', borderRadius: '6px',
                background: returnMode ? 'var(--primary)' : 'transparent',
                fontWeight: 600, color: returnMode ? 'white' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <RotateCcw size={15} /> Return Empties Only
            </button>
          </div>

          {/* Customer section — shared between both modes */}
          <div className="card form-card" style={{ marginBottom: '16px' }}>
            <h2 style={{ marginBottom: '14px' }}>Customer</h2>
            <div className="grid-2">
              <label>
                <span>Name</span>
                <div style={{ position: 'relative' }}>
                  <div className="input-with-icon">
                    <User size={18} />
                    <input
                      value={customerName}
                      onChange={(e) => { setCustomerName(e.target.value); setSelectedCustomerId(null); }}
                      placeholder="Walk-in"
                      autoComplete="off"
                    />
                  </div>
                  {customerSuggestions.length > 0 && (
                    <div className="dropdown-list">
                      {customerSuggestions.map((c) => (
                        <button key={c.id} type="button"
                          onClick={() => {
                  setCustomerName(c.name);
                  setPhone(c.phone);
                  setAddress(c.address);
                  setSelectedCustomerId(c.id);
                  setSelectedCustomer(c);
                  setCustomerSuggestions([]);
                }}
                          style={{ display: 'block', width: '100%', padding: '10px 14px', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <strong style={{ fontSize: '0.9rem' }}>{c.name}</strong>
                              {c.phone && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '8px' }}>{c.phone}</span>}
                              {c.address && <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', display: 'block', marginTop: '2px' }}>{c.address}</span>}
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
                              {Number(c.pending_balance) > 0 && (
                                <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>Due {money(c.pending_balance)}</span>
                              )}
                              {c.empties_owed > 0 && (
                                <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--danger-soft)', color: 'var(--danger)', display: 'block', marginTop: '3px' }}>{c.empties_owed} empty owed</span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </label>
              <label>
                <span>Phone</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Required for new customer" required={Boolean(customerName.trim() && selectedCustomerId === null && !returnMode)} />
              </label>
            </div>
            <div style={{ marginTop: '12px' }}>
              <label>
                <span>Address</span>
                <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
              </label>
            </div>
            <div style={{ marginTop: '12px' }}>
              <label>
                <span>Location</span>
                <select value={location} onChange={(e) => setLocation(Number(e.target.value))}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          {/* ── RETURN EMPTIES MODE ── */}
          {returnMode && (
            <form onSubmit={handleReturnSubmit} className="form-stack">
              <div className="card">
                <div className="section-head">
                  <h2><RotateCcw size={18} style={{ display: 'inline', marginRight: '6px', color: 'var(--primary)' }} />Empty Cylinders Returned</h2>
                  <button type="button" className="btn btn-outline" style={{ width: 'auto', minHeight: '36px', padding: '6px 14px' }} onClick={addReturnRow}>
                    <Plus size={16} /> Add
                  </button>
                </div>

                {returnEmpties.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '8px 0' }}>
                    Click "+ Add" to add cylinders being returned.
                  </p>
                )}

                <div className="form-stack" style={{ marginTop: '8px' }}>
                  {returnEmpties.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center', background: 'var(--surface-muted)', borderRadius: '8px', padding: '12px' }}>
                      <label style={{ flex: 2, margin: 0 }}>
                        <span>Cylinder Type</span>
                        <select value={row.cylinder_type} onChange={(e) => updateReturnRow(i, { cylinder_type: Number(e.target.value) })}>
                          {cylinderTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </label>
                      <label style={{ flex: 1, margin: 0 }}>
                        <span>Qty Returned</span>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <button type="button"
                            onClick={() => updateReturnRow(i, { quantity: Math.max(1, row.quantity - 1) })}
                            style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', width: '36px', height: '48px' }}>
                            <Minus size={14} />
                          </button>
                          <input type="number" min="1" value={row.quantity}
                            onChange={(e) => updateReturnRow(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                            style={{ textAlign: 'center', flex: 1 }} />
                          <button type="button"
                            onClick={() => updateReturnRow(i, { quantity: row.quantity + 1 })}
                            style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', width: '36px', height: '48px' }}>
                            <Plus size={14} />
                          </button>
                        </div>
                      </label>
                      <button type="button" onClick={() => removeReturnRow(i)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: '4px', marginTop: '20px' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                {returnEmpties.length > 0 && (
                  <div className="total-box" style={{ marginTop: '12px' }}>
                    <span>Total Cylinders Returned</span>
                    <strong style={{ color: 'var(--success)' }}>
                      {returnEmpties.reduce((s, r) => s + r.quantity, 0)} cylinder(s)
                    </strong>
                  </div>
                )}
              </div>

              {error && <p className="form-error">{error}</p>}
              {message && <p className="form-note">{message}</p>}

              <button type="submit" className="btn btn-primary">
                <RotateCcw size={18} /> Record Empty Return
              </button>
            </form>
          )}

          {/* ── SALE MODE ── */}
          {!returnMode && (
            <form onSubmit={handleSubmit} className="form-stack">
              {/* Cylinder Items */}
              <div className="card">
                <div className="section-head">
                  <h2>Cylinders</h2>
                  <button type="button" className="btn btn-outline" style={{ width: 'auto', minHeight: '36px', padding: '6px 14px' }} onClick={addItem}>
                    <Plus size={16} /> Add
                  </button>
                </div>

                {items.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '8px 0' }}>
                    Click "+ Add" to add cylinder items.
                  </p>
                )}

                <div className="form-stack">
                  {items.map((item, i) => {
                    const type = cylinderTypes.find((c) => c.id === item.cylinder_type);
                    const isCustomRate = item.rate !== '' && 
                      Number(item.rate) !== Number(type?.selling_price) && 
                      Number(item.rate) !== Number(type?.refill_rate);
                    return (
                      <div key={i} style={{ background: 'var(--surface-muted)', borderRadius: '8px', padding: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Item {i + 1}</span>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {isCustomRate && <span className="badge badge-warning">Custom Price</span>}
                            <button type="button" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: '4px' }}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <div className="grid-3">
                          <label>
                            <span>Cylinder</span>
                            <select value={item.cylinder_type} onChange={(e) => updateItem(i, { cylinder_type: Number(e.target.value) })}>
                              {cylinderTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          </label>
                          <label>
                            <span>Rate (Rs.)</span>
                            {/* Rate is auto-filled from standard price; editing it marks it as Custom */}
                            <input type="number" min="0" value={item.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} />
                          </label>
                          <label>
                            <span>Qty</span>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <button type="button"
                                onClick={() => updateItem(i, { quantity: Math.max(1, item.quantity - 1) })}
                                style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', width: '36px', height: '48px', fontSize: '1.2rem' }}>
                                <Minus size={14} />
                              </button>
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10);
                                  updateItem(i, { quantity: v > 0 ? v : 1 });
                                }}
                                style={{ textAlign: 'center', flex: 1 }}
                              />
                              <button type="button"
                                onClick={() => updateItem(i, { quantity: item.quantity + 1 })}
                                style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', width: '36px', height: '48px', fontSize: '1.2rem' }}>
                                <Plus size={14} />
                              </button>
                            </div>
                          </label>
                        </div>

                        {/* Quick qty buttons */}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                          {[1, 2, 5, 10].map((q) => (
                            <button key={q} type="button" onClick={() => updateItem(i, { quantity: q })}
                              style={{ padding: '4px 12px', border: '1px solid var(--border)', borderRadius: '6px', background: item.quantity === q ? 'var(--primary)' : 'var(--surface)', color: item.quantity === q ? 'white' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.82rem' }}>
                              {q}
                            </button>
                          ))}
                        </div>

                        {/* Empty cylinders returned at time of sale */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                          <RotateCcw size={15} style={{ color: 'var(--text-muted)' }} />
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Empty returned now:</span>
                          <input type="number" min="0" value={item.empty_returned}
                            onChange={(e) => updateItem(i, { empty_returned: Math.max(0, Number(e.target.value) || 0) })}
                            style={{ width: '72px', minHeight: '36px', padding: '0 8px', textAlign: 'center' }} />
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            (swapping {item.empty_returned} empty for {item.quantity} filled)
                          </span>
                        </div>

                        <div style={{ textAlign: 'right', marginTop: '8px', fontWeight: 700, color: 'var(--primary)' }}>
                          {money(item.quantity * Number(item.rate || 0))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment */}
              <div className="card">
                <h2 style={{ marginBottom: '14px' }}>Payment</h2>

                <div className="payment-options" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: '14px' }}>
                  {PAYMENT_MODES.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" className={paymentMode === value ? 'selected' : ''} onClick={() => setPaymentMode(value)}>
                      <Icon size={18} /> {label}
                    </button>
                  ))}
                </div>

                {paymentMode === 'credit' && (
                  <label style={{ marginBottom: '12px' }}>
                    <span>Amount Received (Rs.)</span>
                    <input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="0" />
                  </label>
                )}

                <div className="total-box">
                  <span>Grand Total</span>
                  <strong>{money(total)}</strong>
                  {balance > 0 && <small style={{ color: 'var(--danger)', fontWeight: 700 }}>Pending: {money(balance)}</small>}
                  {balance === 0 && total > 0 && <small style={{ color: 'var(--success)' }}>Fully paid ✓</small>}
                </div>
              </div>

              {error && <p className="form-error">{error}</p>}
              {message && <p className="form-note">{message}</p>}

              <button type="submit" className="btn btn-primary">
                <Plus size={20} /> Complete Sale
              </button>
            </form>
          )}
        </>
      )}

      {tab === 'history' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '14px', color: 'var(--text-muted)' }} />
              <input placeholder="Search customer…" value={search} onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '36px' }} />
            </div>
            <button type="button" onClick={() => setFilterPending((p) => !p)}
              className={filterPending ? 'btn btn-primary' : 'btn btn-outline'}
              style={{ width: 'auto', padding: '0 16px', whiteSpace: 'nowrap' }}>
              Pending only
            </button>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Items</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                    <th>Mode</th>
                    <th>Staff</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id}>
                      <td><strong>{sale.customer_name || 'Walk-in'}</strong></td>
                      <td>
                        {sale.items.map((item, i) => (
                          <span key={i} style={{ display: 'block', fontSize: '0.82rem' }}>
                            {item.quantity}×{item.cylinder_type_name} @ {money(item.rate)}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: 'right' }}>{money(sale.total_amount)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {Number(sale.balance_due) > 0
                          ? <span className="badge badge-warning">{money(sale.balance_due)}</span>
                          : <span className="badge badge-success">Paid</span>}
                      </td>
                      <td><span className="badge">{sale.payment_mode}</span></td>
                      <td style={{ fontSize: '0.82rem' }}>{sale.sold_by_name}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {new Date(sale.created_at).toLocaleDateString('en-IN')}
                      </td>
                    </tr>
                  ))}
                  {sales.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>No sales found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
