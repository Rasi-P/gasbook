import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Banknote, Building2, CreditCard, Plus,
  RotateCcw, Search, Smartphone, Trash2, User,
} from 'lucide-react';
import { api, extractApiError, fetchAllPages, LIMITS } from '../lib/api';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';
import { usePager } from '../hooks/usePager';

type CylinderType = { id: number; name: string; selling_price: number; refill_rate: number };
type Location = { id: number; name: string; code: string; is_main_supplier: boolean };
type SaleItem = { cylinder_type: number; quantity: number | string; rate: string; empty_returned: number | string; rate_type: 'custom' | 'refill' | 'new' };
type HistorySale = {
  id: number;
  customer_name: string;
  sold_by_name: string;
  note?: string;
  items: { cylinder_type_name: string; quantity: number; rate: number; empty_returned: number }[];
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  created_at: string;
  payments: { amount: number; mode: string }[];
};

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gpay', label: 'GPay', icon: Smartphone },
  { value: 'bank', label: 'Bank', icon: Building2 },
  { value: 'credit', label: 'Credit', icon: CreditCard },
  { value: 'split', label: 'Split', icon: Plus },
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
  type CustomerSuggestion = { id: number; name: string; phone: string; address: string; pending_balance: number; empties_owed: Record<number, { owed: number; name: string }>; sales_count: number; custom_rates: any[]; empty_credits: Record<number, { credit: number; name: string }>; is_active?: boolean };
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [location, setLocation] = useState(0);

  // Sale items (start empty — user adds as needed)
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [paidPaymentMode, setPaidPaymentMode] = useState('cash');
  const [saleSplit, setSaleSplit] = useState({ cash: '', gpay: '', bank: '' });

  // Past pending collection
  const [pastAmount, setPastAmount] = useState('');
  const [pastPaymentMode, setPastPaymentMode] = useState('cash');
  const [pastSplit, setPastSplit] = useState({ cash: '', gpay: '', bank: '' });

  // Empty-return-only mode
  const [returnMode, setReturnMode] = useState(false);
  const [returnEmpties, setReturnEmpties] = useState<{ cylinder_type: number; quantity: number | string }[]>([]);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refStatus, setRefStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refError, setRefError] = useState('');

  // Stock availability
  const [stockData, setStockData] = useState<{ cylinder_type: number; location: number; status: string; quantity: number }[]>([]);
  const [stockError, setStockError] = useState('');

  // History state
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState(false);
  const historyPager = usePager(sales, 10, `${search}|${filterPending}`);

  function loadReferenceData() {
    Promise.all([fetchAllPages<CylinderType>('/cylinder-types/'), fetchAllPages<Location>('/locations/')])
      .then(([types, allLocs]) => {
        const locs = allLocs.filter((l) => !l.is_main_supplier && l.code !== 'supplier');
        setCylinderTypes(types);
        setLocations(locs);
        const savedLoc = localStorage.getItem('lastSalesLoc');
        if (savedLoc && locs.find(l => l.id === Number(savedLoc))) {
          setLocation(Number(savedLoc));
        } else {
          setLocation(locs[0]?.id ?? 1);
        }
        setRefError('');
        setRefStatus('ready');
        // Don't pre-populate items — user adds when ready
      })
      .catch((err) => {
        setRefError(extractApiError(err, [], 'Could not load cylinder types and locations.'));
        setRefStatus('error');
      });
  }

  useEffect(() => { loadReferenceData(); }, []);

  useEffect(() => {
    if (location) localStorage.setItem('lastSalesLoc', String(location));
  }, [location]);

  // Fetch stock whenever location changes
  useEffect(() => {
    if (!location || locations.length === 0) return;
    const loc = locations.find(l => l.id === location);
    if (!loc) return;
    fetchAllPages<{ cylinder_type: number; location: number; status: string; quantity: number }>('/stock/', { location: loc.code, status: 'filled' })
      .then((rows) => { setStockData(rows); setStockError(''); })
      .catch((err) => setStockError(extractApiError(err, [], 'Stock levels unavailable.')));
  }, [location, locations]);

  useEffect(() => {
    if (!customerName.trim() || selectedCustomerId !== null) {
      setCustomerSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchAllPages<CustomerSuggestion>('/customers/', { search: customerName }, 2)
        .then((rows) => {
          if (cancelled) return;
          // Deactivated customers cannot take new sales.
          setCustomerSuggestions(rows.filter((c) => c.is_active !== false).slice(0, 5));
        })
        .catch(() => undefined);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerName, selectedCustomerId]);

  function fetchHistory() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterPending) params.pending = '1';
    fetchAllPages<HistorySale>('/sales/', params)
      .then((rows) => { setSales(rows); setHistoryError(''); setHistoryStatus('ready'); })
      .catch((err) => {
        setHistoryError(extractApiError(err, [], 'Could not load sales history.'));
        setHistoryStatus('error');
      });
  }

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab, search, filterPending]);

  // ── Item helpers ──────────────────────────────────────────────────────────

  // ── Item helpers ──────────────────────────────────────────────────────────

  function getApplicableRate(cylinder_type: number, rate_type: 'custom' | 'refill' | 'new', customer: any | null) {
    const t = cylinderTypes.find(c => c.id === cylinder_type);
    if (!t) return '0';
    if (rate_type === 'custom') {
      const custom = customer?.custom_rates?.find((cr: any) => cr.cylinder_type === cylinder_type);
      return custom ? String(custom.custom_price) : String(t.refill_rate);
    } else if (rate_type === 'refill') {
      return String(t.refill_rate);
    } else {
      return String(t.selling_price);
    }
  }

  function updateItem(index: number, patch: Partial<SaleItem>) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], ...patch };

      // If cylinder_type or rate_type changes, update the rate automatically
      if (patch.cylinder_type !== undefined || patch.rate_type !== undefined) {
        item.rate = getApplicableRate(item.cylinder_type, item.rate_type, selectedCustomer);
      }

      next[index] = item;
      return next;
    });
  }

  function addItem() {
    const t = cylinderTypes[0];
    if (!t) return;
    const hasCustom = selectedCustomer?.custom_rates?.find((cr: any) => cr.cylinder_type === t.id);
    const initialRateType = hasCustom ? 'custom' : 'refill';
    const rate = getApplicableRate(t.id, initialRateType, selectedCustomer);
    const newItem: SaleItem = { cylinder_type: t.id, quantity: 1, rate, empty_returned: 1, rate_type: initialRateType };
    setItems((prev) => [...prev, newItem]);
  }

  // Update rates if customer selection changes
  useEffect(() => {
    if (items.length > 0) {
      setItems((prev) => prev.map(item => ({
        ...item,
        rate: getApplicableRate(item.cylinder_type, item.rate_type, selectedCustomer)
      })));
    }
  }, [selectedCustomer]);

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Empty-return-only helpers ─────────────────────────────────────────────

  function addReturnRow() {
    const selectedIds = new Set(returnEmpties.map(r => r.cylinder_type));
    const firstAvailable = cylinderTypes.find(t => !selectedIds.has(t.id));
    if (!firstAvailable) return;
    setReturnEmpties((prev) => [...prev, { cylinder_type: firstAvailable.id, quantity: 1 }]);
  }

  function updateReturnRow(index: number, patch: Partial<{ cylinder_type: number; quantity: number | string }>) {
    setReturnEmpties((prev) => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  function removeReturnRow(index: number) {
    setReturnEmpties((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * Number(item.rate || 0), 0),
    [items],
  );
  const paid = paymentMode === 'split' ? (Number(saleSplit.cash || 0) + Number(saleSplit.gpay || 0) + Number(saleSplit.bank || 0)) : (paymentMode === 'credit' ? Number(paidAmount || 0) : total);
  const balance = Math.max(total - paid, 0);

  const pastTotal = pastPaymentMode === 'split' ? (Number(pastSplit.cash || 0) + Number(pastSplit.gpay || 0) + Number(pastSplit.bank || 0)) : Number(pastAmount || 0);

  // ── Submit sale ───────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(''); setError('');
    if (items.length === 0) { setError('Add at least one cylinder item.'); return; }
    if (selectedCustomer && pastTotal > Number(selectedCustomer.pending_balance)) {
      setError(`Cannot collect past payment greater than the pending balance of Rs. ${selectedCustomer.pending_balance}.`);
      return;
    }
    setSaving(true);
    try {
      let customerId: number | null = selectedCustomerId;
      if (!customerId) {
        if (!customerName.trim()) {
          setError('Please select a customer or enter details to register a new one.');
          return;
        }
        if (!phone.trim()) {
          setError('Phone number is required to register a new customer.');
          return;
        }
        const res = await api.post('/customers/', { name: customerName.trim(), phone, address });
        customerId = res.data.id;
      }
      const salePayload: any = {
        customer: customerId,
        location,
        payment_mode: paymentMode,
        paid_amount: paid,
        sale_items: items.map((item) => ({
          cylinder_type: item.cylinder_type,
          quantity: Number(item.quantity) || 1,
          rate: item.rate,
          empty_returned: Number(item.empty_returned) || 0,
        })),
      };

      if (paymentMode === 'split') {
        salePayload.split_payments = [];
        if (Number(saleSplit.cash) > 0) salePayload.split_payments.push({ mode: 'cash', amount: Number(saleSplit.cash) });
        if (Number(saleSplit.gpay) > 0) salePayload.split_payments.push({ mode: 'gpay', amount: Number(saleSplit.gpay) });
        if (Number(saleSplit.bank) > 0) salePayload.split_payments.push({ mode: 'bank', amount: Number(saleSplit.bank) });
      } else {
        salePayload.paid_payment_mode = paidPaymentMode;
      }

      await api.post('/sales/', salePayload);

      if (pastTotal > 0 && customerId) {
        if (pastPaymentMode === 'split') {
          if (Number(pastSplit.cash) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.cash), payment_mode: 'cash', note: 'Past pending collected during sale' });
          if (Number(pastSplit.gpay) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.gpay), payment_mode: 'gpay', note: 'Past pending collected during sale' });
          if (Number(pastSplit.bank) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.bank), payment_mode: 'bank', note: 'Past pending collected during sale' });
        } else {
          await api.post('/payments/', {
            customer: customerId,
            amount: pastTotal,
            payment_mode: pastPaymentMode,
            note: 'Past pending collected during sale',
          });
        }
      }

      setMessage(`Sale saved! Total ${money(total)}, Balance ${money(balance)}${pastTotal > 0 ? `, and collected ${money(pastTotal)} for past dues` : ''}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setPaidAmount(''); setPaymentMode('cash'); setPaidPaymentMode('cash'); setSaleSplit({ cash: '', gpay: '', bank: '' });
      setPastAmount(''); setPastPaymentMode('cash'); setPastSplit({ cash: '', gpay: '', bank: '' });
      setItems([]);
    } catch (err: unknown) {
      setError(extractApiError(err, ['name', 'phone', 'address', 'customer', 'location', 'sale_items', 'paid_amount', 'split_payments', 'non_field_errors'], 'Failed to save sale. Check backend connection.'));
    } finally {
      setSaving(false);
    }
  }

  // ── Submit empty-return-only ──────────────────────────────────────────────

  async function handleReturnSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(''); setError('');
    if (!selectedCustomerId) { setError('Select a customer to record empty returns.'); return; }
    if (returnEmpties.length === 0) { setError('Add at least one cylinder type to return.'); return; }
    const totalEmpties = returnEmpties.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    setSaving(true);
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
          empty_returned: Number(r.quantity) || 1,
        })),
      });
      const locName = locations.find(l => l.id === location)?.name || '';
      setMessage(`Recorded ${totalEmpties} empty cylinder(s) returned at ${locName}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setReturnEmpties([]);
      setReturnMode(false);
    } catch (err: unknown) {
      setError(extractApiError(err, ['customer', 'location', 'sale_items', 'non_field_errors'], 'Failed to record return.'));
    } finally {
      setSaving(false);
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

      {tab === 'new' && refStatus === 'loading' && <LoadingState label="Loading sale setup…" />}
      {tab === 'new' && refStatus === 'error' && <ErrorState message={refError} onRetry={() => { setRefStatus('loading'); loadReferenceData(); }} />}

      {tab === 'new' && refStatus === 'ready' && (
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
                      placeholder="Search or enter new customer"
                      autoComplete="off"
                      maxLength={LIMITS.name}
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
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Required for new customer" maxLength={LIMITS.phone} inputMode="numeric" pattern="[0-9]*" title="Only digits allowed" required={Boolean(customerName.trim() && selectedCustomerId === null && !returnMode)} />
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

            {selectedCustomer && (
              <div style={{ marginTop: '16px', padding: '16px', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Payment Due</div>
                  {Number(selectedCustomer.pending_balance) > 0 ? (
                    <strong style={{ color: 'var(--danger)', fontSize: '1.1rem' }}>{money(selectedCustomer.pending_balance)}</strong>
                  ) : (
                    <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.95rem' }}>Settled</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: '120px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Empties Owed</div>
                  {selectedCustomer.empties_owed && Object.values(selectedCustomer.empties_owed).length > 0 ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {Object.values(selectedCustomer.empties_owed).map((ec: any) => (
                        <span key={ec.name} className="badge" style={{ padding: '4px 8px', background: 'var(--danger-soft)', color: 'var(--danger)' }}>{ec.owed} × {ec.name}</span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.95rem' }}>None</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Empty Credits</div>
                  {selectedCustomer.empty_credits && Object.values(selectedCustomer.empty_credits).length > 0 ? (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {Object.values(selectedCustomer.empty_credits).map((ec: any) => (
                        <span key={ec.name} className="badge badge-success" style={{ padding: '4px 8px' }}>{ec.credit} × {ec.name}</span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.95rem' }}>No credits</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── RETURN EMPTIES MODE ── */}
          {returnMode && (
            <form onSubmit={handleReturnSubmit} className="form-stack">
              <div className="card">
                <div className="section-head">
                  <h2><RotateCcw size={18} style={{ display: 'inline', marginRight: '6px', color: 'var(--primary)' }} />Empty Cylinders Returned</h2>
                  {returnEmpties.length < cylinderTypes.length && (
                    <button type="button" className="btn btn-outline" style={{ width: 'auto', minHeight: '36px', padding: '6px 14px' }} onClick={addReturnRow}>
                      <Plus size={16} /> Add
                    </button>
                  )}
                </div>

                {returnEmpties.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '8px 0' }}>
                    Click "+ Add" to add cylinders being returned.
                  </p>
                )}

                <div className="form-stack" style={{ marginTop: '8px' }}>
                  {returnEmpties.map((row, i) => (
                    <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px' }}>
                      <label style={{ flex: 2, margin: 0 }}>
                        <span>Cylinder Type</span>
                        <select value={row.cylinder_type} onChange={(e) => updateReturnRow(i, { cylinder_type: Number(e.target.value) })}>
                          {cylinderTypes.filter(t => !returnEmpties.some((r, j) => j !== i && r.cylinder_type === t.id)).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      </label>
                      <label style={{ flex: 1, margin: 0 }}>
                        <span>Qty Returned</span>
                        <input
                          type="number" min="1" placeholder="0"
                          value={row.quantity}
                          onChange={(e) => updateReturnRow(i, { quantity: e.target.value })}
                          style={{ textAlign: 'center', width: '100%' }}
                        />
                      </label>
                      <button type="button" onClick={() => removeReturnRow(i)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: '4px', marginTop: '20px' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                {returnEmpties.length > 0 && (
                  <>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800 }}>
                      <span style={{ color: 'var(--text)', fontSize: '1.05rem' }}>Total Cylinders Returned</span>
                      <strong style={{ color: 'var(--success)', fontSize: '1.2rem' }}>
                        {returnEmpties.reduce((s, r) => s + (Number(r.quantity) || 0), 0)} cylinder(s)
                      </strong>
                    </div>
                  </>
                )}
              </div>

              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="form-note">{message}</p>}

              <button type="submit" className="btn btn-primary" disabled={saving}>
                <RotateCcw size={18} /> {saving ? 'Saving…' : 'Record Empty Return'}
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
                    const available = stockData.find(s => s.cylinder_type === type?.id)?.quantity ?? 0;
                    return (
                      <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>Item {i + 1}</span>
                            <span style={{ 
                              fontSize: '0.72rem', 
                              padding: '3px 10px', 
                              borderRadius: '12px',
                              fontWeight: 600,
                              letterSpacing: '0.02em',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: stockError ? 'var(--surface-muted)' : available > 0 ? 'var(--success-soft, rgba(34,197,94,0.1))' : 'var(--danger-soft, rgba(239,68,68,0.1))',
                              color: stockError ? 'var(--text-muted)' : available > 0 ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
                              border: `1px solid ${stockError ? 'var(--border)' : available > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                            }} title={stockError || undefined}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                              {stockError ? 'stock unknown' : `${available} in stock`}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {isCustomRate && <span className="badge badge-warning">Custom Price</span>}
                            <button type="button" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', padding: '4px', cursor: 'pointer' }}>
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr', gap: '12px', alignItems: 'end' }}>
                          <label>
                            <span>Cylinder</span>
                            <select value={item.cylinder_type} onChange={(e) => updateItem(i, { cylinder_type: Number(e.target.value) })}>
                              {cylinderTypes.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Rate Type</span>
                            <select value={item.rate_type} onChange={(e) => updateItem(i, { rate_type: e.target.value as 'custom' | 'refill' | 'new' })}>
                              {selectedCustomer?.custom_rates?.some((cr: any) => cr.cylinder_type === item.cylinder_type) && (
                                <option value="custom">Agreed Rate</option>
                              )}
                              <option value="refill">Refill</option>
                              <option value="new">New Cylinder</option>
                            </select>
                          </label>
                          <label>
                            <span>Rate (Rs.)</span>
                            <input type="number" min="0" value={item.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} />
                          </label>
                          <label>
                            <span>Qty</span>
                            <input
                              type="number" min="1" placeholder="0"
                              value={item.quantity}
                              onChange={(e) => updateItem(i, { quantity: e.target.value })}
                              style={{ textAlign: 'center' }}
                            />
                          </label>
                          <label>
                            <span style={{ color: 'var(--primary)' }}>Empty Returned</span>
                            <input
                              type="number" min="0" placeholder="0"
                              value={item.empty_returned}
                              onChange={(e) => updateItem(i, { empty_returned: e.target.value })}
                              style={{ textAlign: 'center', borderColor: 'var(--primary)', color: 'var(--primary)', background: 'var(--primary-soft)' }}
                            />
                          </label>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '16px' }}>
                          {/* Quick qty buttons */}
                          <div style={{ display: 'flex', gap: '6px' }}>
                            {[1, 2, 5, 10].map((q) => (
                              <button key={q} type="button" onClick={() => updateItem(i, { quantity: q })}
                                style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '6px', background: item.quantity === q ? 'var(--primary)' : 'var(--surface)', color: item.quantity === q ? 'white' : 'var(--text-muted)', fontWeight: 700, fontSize: '0.85rem' }}>
                                {q}
                              </button>
                            ))}
                          </div>

                          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--primary)' }}>
                            {money((Number(item.quantity) || 0) * Number(item.rate || 0))}
                          </div>
                        </div>

                        {item.rate_type !== 'new' && Number(item.empty_returned) < Number(item.quantity) && (
                          <div style={{ marginTop: '12px', padding: '8px 12px', background: 'var(--warning-soft, rgba(245,158,11,0.1))', color: 'var(--warning, #d97706)', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'currentColor' }} />
                            Warning: Quantity is {item.quantity} but only {item.empty_returned} empty returned. Ensure customer has empty credits or change Rate Type to New Cylinder.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment */}
              <div className="card">
                <h2 style={{ marginBottom: '14px' }}>Payment</h2>

                <div className="payment-options" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: '14px' }}>
                  {PAYMENT_MODES.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" className={paymentMode === value ? 'selected' : ''} onClick={() => setPaymentMode(value)}>
                      <Icon size={18} /> {label}
                    </button>
                  ))}
                </div>

                {paymentMode === 'credit' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
                    <label>
                      <span>Amount Received (Rs.)</span>
                      <input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="0" />
                    </label>
                    {Number(paidAmount) > 0 && (
                      <label>
                        <span>Received Via</span>
                        <select value={paidPaymentMode} onChange={(e) => setPaidPaymentMode(e.target.value)}>
                          {PAYMENT_MODES.filter(m => m.value !== 'credit' && m.value !== 'split').map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}

                {paymentMode === 'split' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '12px' }}>
                    <label>
                      <span>Cash Paid</span>
                      <input type="number" min="0" value={saleSplit.cash} onChange={(e) => setSaleSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>GPay Paid</span>
                      <input type="number" min="0" value={saleSplit.gpay} onChange={(e) => setSaleSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>Bank Paid</span>
                      <input type="number" min="0" value={saleSplit.bank} onChange={(e) => setSaleSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>Credit (Pending)</span>
                      <input type="number" disabled value={balance > 0 ? balance : 0} style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }} />
                    </label>
                  </div>
                )}

                <div className="total-box">
                  <span>Grand Total</span>
                  <strong>{money(total)}</strong>
                  {balance > 0 && <small style={{ color: 'var(--danger)', fontWeight: 700 }}>Pending: {money(balance)}</small>}
                  {balance === 0 && total > 0 && <small style={{ color: 'var(--success)' }}>Fully paid ✓</small>}
                </div>
              </div>

              {selectedCustomer && Number(selectedCustomer.pending_balance) > 0 && (
                <div className="card" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}>
                  <h2 style={{ marginBottom: '14px', color: 'var(--danger)' }}>
                    Past Pending Balance: {money(selectedCustomer.pending_balance)}
                  </h2>
                  <p style={{ fontSize: '0.9rem', marginBottom: '16px' }}>
                    You can collect payment for past dues along with this sale.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <label style={{ display: pastPaymentMode === 'split' ? 'none' : 'block' }}>
                      <span>Collect Past Pending (Rs.)</span>
                      <input type="number" min="0" max={selectedCustomer.pending_balance} value={pastAmount} onChange={(e) => setPastAmount(e.target.value)} placeholder="0" />
                    </label>
                    <label>
                      <span>Received Via</span>
                      <select value={pastPaymentMode} onChange={(e) => setPastPaymentMode(e.target.value)}>
                        {PAYMENT_MODES.filter(m => m.value !== 'credit').map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                    {pastPaymentMode === 'split' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', gridColumn: '1 / -1' }}>
                        <label>
                          <span>Cash</span>
                          <input type="number" min="0" value={pastSplit.cash} onChange={(e) => setPastSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                        </label>
                        <label>
                          <span>GPay</span>
                          <input type="number" min="0" value={pastSplit.gpay} onChange={(e) => setPastSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                        </label>
                        <label>
                          <span>Bank</span>
                          <input type="number" min="0" value={pastSplit.bank} onChange={(e) => setPastSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                        </label>
                        <label>
                          <span>Credit Remaining</span>
                          <input type="number" disabled value={Math.max(0, Number(selectedCustomer.pending_balance) - pastTotal)} style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }} />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="form-error" role="alert">{error}</p>}
              {message && <p className="form-note">{message}</p>}

              <button type="submit" className="btn btn-primary" disabled={saving}>
                <Plus size={20} /> {saving ? 'Saving…' : 'Complete Sale'}
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

          {historyStatus === 'error' && <ErrorState message={historyError} onRetry={() => { setHistoryStatus('loading'); fetchHistory(); }} />}
          {historyStatus !== 'error' && (
          <div className="card">
            {historyStatus === 'loading' && <LoadingState label="Loading sales…" />}
            {historyStatus === 'ready' && (
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
                  {historyPager.pageItems.map((sale) => (
                    <tr key={sale.id}>
                      <td><strong>{sale.customer_name}</strong></td>
                      <td>
                        {sale.items.map((item, i) => (
                          <span key={i} style={{ display: 'block', fontSize: '0.82rem', marginBottom: '2px' }}>
                            {item.quantity > 0 && <span>{item.quantity}×{item.cylinder_type_name} @ {money(item.rate)}</span>}
                            {item.empty_returned > 0 ? (
                              <span style={{ 
                                color: (!sale.customer_name && item.quantity > 0 && item.empty_returned < item.quantity) ? 'var(--danger)' : 'var(--text-muted)', 
                                marginLeft: item.quantity > 0 ? '6px' : '0',
                                background: (!sale.customer_name && item.quantity > 0 && item.empty_returned < item.quantity) ? 'var(--danger-soft, #fee2e2)' : 'var(--surface)',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                border: `1px solid ${(!sale.customer_name && item.quantity > 0 && item.empty_returned < item.quantity) ? 'var(--danger)' : 'var(--border)'}`
                              }}>
                                🔄 Returned {item.empty_returned} × {item.cylinder_type_name} empties
                              </span>
                            ) : (
                              !sale.customer_name && item.quantity > 0 && (
                                <span style={{ 
                                  color: 'var(--danger)', 
                                  marginLeft: '6px',
                                  background: 'var(--danger-soft, #fee2e2)',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  border: '1px solid var(--danger)'
                                }}>
                                  ⚠️ 0 empties returned
                                </span>
                              )
                            )}
                          </span>
                        ))}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {sale.note === 'Empty cylinders returned' ? '-' : money(sale.total_amount)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {sale.note === 'Empty cylinders returned' ? '-' : (
                          Number(sale.balance_due) > 0
                            ? <span className="badge badge-warning">{money(sale.balance_due)}</span>
                            : <span className="badge badge-success">Paid</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {sale.note === 'Empty cylinders returned' ? (
                          <span className="badge" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>Return</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="badge">{sale.payment_mode}</span>
                            {(sale.payment_mode === 'split' || sale.payment_mode === 'credit') && sale.payments && sale.payments.length > 0 && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {sale.payments.map(p => `${p.mode.toUpperCase()} ${p.amount}`).join(' + ')}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
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
              <Pager page={historyPager.page} pageCount={historyPager.pageCount} onChange={historyPager.setPage} total={historyPager.total} />
            </div>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  );
}
