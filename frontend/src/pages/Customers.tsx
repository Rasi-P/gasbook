import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { Search, ChevronRight, ArrowLeft, IndianRupee, Package, RotateCcw, UserPlus, X, Pencil, Check, KeyRound, Trash2, Copy, Phone, Mail, MapPin, Share2, Tag } from 'lucide-react';
import { api } from '../lib/api';

type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  opening_balance: number;
  pending_balance: number;
  empties_owed: Record<number, { owed: number; name: string }>;
  empty_credits: Record<number, { credit: number; name: string }>;
  custom_rates?: {
    id: number;
    cylinder_type: number;
    cylinder_type_name: string;
    custom_price: string;
  }[];
};

type SaleItem = {
  cylinder_type_name: string;
  quantity: number;
  rate: number;
  empty_returned: number;
};

type Sale = {
  id: number;
  created_at: string;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  location_name: string;
  delivery_type: string;
  items: SaleItem[];
  payments?: { amount: number; mode: string; date: string }[];
};

type Payment = {
  id: number;
  created_at: string;
  amount: number;
  payment_mode: string;
  note: string;
  empty_collected: number;
  sale: number | null;
};

type Ledger = {
  customer: Customer;
  sales: Sale[];
  payments: Payment[];
};

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);

  // Per-row action state — track which customer's panel is open
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [credsId, setCredsId] = useState<number | null>(null);
  const [creds, setCreds] = useState<{ username: string; full_name: string } | null>(null);
  const [credsError, setCredsError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Custom rates panel state
  const [ratesId, setRatesId] = useState<number | null>(null);
  const [cylinderTypes, setCylinderTypes] = useState<{ id: number; name: string }[]>([]);
  const [rateCylinderId, setRateCylinderId] = useState('');
  const [ratePrice, setRatePrice] = useState('');
  const [rateSaving, setRateSaving] = useState(false);

  // Add customer form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [credUserId, setCredUserId] = useState<number | null>(null);
  const [credMsg, setCredMsg] = useState('');
  const [createdPhone, setCreatedPhone] = useState('');
  const [createdUsername, setCreatedUsername] = useState('');

  // Receive Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentSplit, setPaymentSplit] = useState({ cash: '', gpay: '', bank: '' });
  const [paymentSaving, setPaymentSaving] = useState(false);

  // ── helpers ──────────────────────────────────────────────────────────────

  function startEdit(c: Customer) {
    setCredsId(null); setCreds(null); setCredsError(''); setPwMsg('');
    setEditName(c.name); setEditPhone(c.phone);
    setEditEmail(c.email || ''); setEditAddress(c.address);
    setEditError('');
    setEditingId(c.id);
  }

  function cancelEdit() { setEditingId(null); setEditError(''); }

  async function handleEdit(e: FormEvent, customerId: number) {
    e.preventDefault();
    setEditError(''); setEditSaving(true);
    try {
      const { data } = await api.patch(`/customers/${customerId}/`, {
        name: editName.trim(), phone: editPhone.trim(),
        email: editEmail.trim(), address: editAddress.trim(),
      });
      setCustomers((prev) => prev.map((c) => c.id === customerId ? { ...c, ...data } : c));
      setEditingId(null);
      // If detail view is open for same customer, refresh
      if (selected && selected.customer.id === customerId) {
        setSelected((prev) => prev ? { ...prev, customer: { ...prev.customer, ...data } } : prev);
      }
    } catch {
      setEditError('Failed to save. Try again.');
    } finally {
      setEditSaving(false);
    }
  }

  async function loadCreds(customerId: number) {
    setEditingId(null);
    setCredsError(''); setCreds(null); setPwMsg('');
    setCredsId(customerId);
    try {
      const { data } = await api.get(`/customers/${customerId}/credentials/`);
      setCreds(data);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCredsError(detail || 'No login account linked.');
    }
  }

  function closeCreds() { setCredsId(null); setCreds(null); setCredsError(''); setPwMsg(''); }

  async function resetPassword(customerId: number) {
    setPwSaving(true); setPwMsg('');
    try {
      const { data } = await api.post(`/customers/${customerId}/credentials/`, {});
      setPwMsg(data.temporary_password || 'Password reset successfully.');
    } catch {
      setPwMsg('Failed to reset password.');
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteCustomer(customerId: number, name: string) {
    const ok = window.confirm(
      `PERMANENTLY DELETE customer ${name}? This will completely destroy all their sales, payments, and booking data. This cannot be undone.`
    );
    if (!ok) return;
    setDeletingId(customerId);
    try {
      await api.delete(`/customers/${customerId}/credentials/`);
      setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      if (selected && selected.customer.id === customerId) setSelected(null);
    } finally {
      setDeletingId(null);
    }
  }

  async function loadRates(customerId: number) {
    setEditingId(null); setCredsId(null);
    setRatesId(customerId);
    if (cylinderTypes.length === 0) {
      try {
        const { data } = await api.get('/cylinder-types/');
        setCylinderTypes(data.results || data);
        if ((data.results || data).length > 0) {
          setRateCylinderId((data.results || data)[0].id.toString());
        }
      } catch {
        // failed to fetch types
      }
    }
  }

  function closeRates() {
    setRatesId(null);
    setRatePrice('');
  }

  async function handleAddRate(e: FormEvent, customerId: number) {
    e.preventDefault();
    if (!rateCylinderId || !ratePrice) return;
    setRateSaving(true);
    try {
      await api.post('/customer-rates/', {
        customer: customerId,
        cylinder_type: rateCylinderId,
        custom_price: ratePrice,
      });
      setRatePrice('');
      fetchCustomers();
    } catch {
      alert('Failed to save custom rate. Note: Cannot have duplicate rates for the same cylinder type. Delete the old one first.');
    } finally {
      setRateSaving(false);
    }
  }

  async function handleDeleteRate(rateId: number) {
    try {
      await api.delete(`/customer-rates/${rateId}/`);
      fetchCustomers();
    } catch {
      alert('Failed to delete custom rate.');
    }
  }

  async function handleAddCustomer(e: FormEvent) {
    e.preventDefault();
    setAddError(''); setCredUserId(null); setCredMsg('');
    setAddSaving(true);
    try {
      const username = addUsername.trim();
      const fullName = addName.trim();
      const { data } = await api.post('/auth/register/', {
        full_name: fullName, username,
        phone: addPhone.trim(), email: addEmail.trim(),
        address: addAddress.trim(), role: 'customer',
        linked_customer: linkedCustomerId || undefined,
      });
      const tempPassword = (data as { temporary_password?: string }).temporary_password;
      const createdPhoneNum = addPhone.trim();
      setAddName(''); setAddUsername(''); setAddPhone(''); setAddEmail(''); setAddAddress(''); setLinkedCustomerId('');
      setShowAdd(false);
      await fetchCustomers();
      if (data.id) {
        setCredUserId(data.id);
        setCredMsg(tempPassword || 'Password securely generated.');
        setCreatedPhone(createdPhoneNum);
        setCreatedUsername(username);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAddError(detail || 'Failed to save. Try again.');
    } finally {
      setAddSaving(false);
    }
  }

  const fetchCustomers = useCallback(() => {
    const params = search ? { search } : {};
    api.get('/customers/', { params })
      .then((r) => setCustomers(r.data.results ?? r.data))
      .catch(() => undefined);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(t);
  }, [fetchCustomers]);

  function openLedger(id: number) {
    setLoading(true);
    setEditingId(null); setCredsId(null); setCreds(null); setCredsError(''); setPwMsg('');
    api.get(`/customers/${id}/ledger/`)
      .then((r) => setSelected(r.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  async function handleReceivePayment(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    
    const totalPayment = paymentMode === 'split' 
      ? Number(paymentSplit.cash) + Number(paymentSplit.gpay) + Number(paymentSplit.bank)
      : Number(paymentAmount);
      
    if (totalPayment > Number(selected.customer.pending_balance)) {
      alert(`Cannot receive more than the pending balance of Rs. ${selected.customer.pending_balance}.`);
      return;
    }

    setPaymentSaving(true);
    try {
      if (paymentMode === 'split') {
        if (Number(paymentSplit.cash) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.cash), payment_mode: 'cash', note: 'Balance clearance' });
        if (Number(paymentSplit.gpay) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.gpay), payment_mode: 'gpay', note: 'Balance clearance' });
        if (Number(paymentSplit.bank) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.bank), payment_mode: 'bank', note: 'Balance clearance' });
      } else {
        await api.post('/payments/', {
          customer: selected.customer.id,
          amount: Number(paymentAmount),
          payment_mode: paymentMode,
          note: 'Balance clearance',
        });
      }
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentMode('cash');
      setPaymentSplit({ cash: '', gpay: '', bank: '' });
      openLedger(selected.customer.id);
      fetchCustomers();
    } catch {
      alert('Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  }

  // ── Detail / ledger view ─────────────────────────────────────────────────

  if (selected) {
    const { customer, sales, payments } = selected;

    type PaymentGroup = { payments: Payment[]; total: number; date: string; note: string; empties: number };
    type Entry =
      | { kind: 'sale'; date: string; sale: Sale }
      | { kind: 'payment_group'; date: string; group: PaymentGroup };

    // Hide payments linked to a sale — the sale row already shows payment breakdown
    const standalonePayments = payments.filter((p) => !p.sale);

    // Group payments that happened at the same time with the same note
    const groupMap = new Map<string, PaymentGroup>();
    for (const p of standalonePayments) {
      const key = `${p.created_at.slice(0, 16)}_${p.note}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.payments.push(p);
        existing.total += Number(p.amount);
        existing.empties += p.empty_collected || 0;
      } else {
        groupMap.set(key, { payments: [p], total: Number(p.amount), date: p.created_at, note: p.note, empties: p.empty_collected || 0 });
      }
    }

    const timeline: Entry[] = [
      ...sales.map((s) => ({ kind: 'sale' as const, date: s.created_at, sale: s })),
      ...[...groupMap.values()].map((g) => ({ kind: 'payment_group' as const, date: g.date, group: g })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
      <div>
        <div className="page-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="icon-button" onClick={() => setSelected(null)}>
              <ArrowLeft size={20} />
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <h1 style={{ margin: 0 }}>{customer.name}</h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {customer.phone && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Phone size={14} /> {customer.phone}
                  </span>
                )}
                {customer.email && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Mail size={14} /> {customer.email}
                  </span>
                )}
                {customer.address && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MapPin size={14} /> {customer.address}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <section className="stat-grid" style={{ marginBottom: '16px' }}>
          <div className="metric-card strong">
            <IndianRupee />
            <span>Pending</span>
            <strong>{money(customer.pending_balance)}</strong>
            {customer.pending_balance > 0 && (
              <button 
                className="btn btn-primary" 
                style={{ marginTop: '12px', width: '100%', padding: '6px' }}
                onClick={() => {
                  setPaymentAmount(String(customer.pending_balance));
                  setShowPaymentModal(true);
                }}
              >
                Receive Payment
              </button>
            )}
          </div>
          <div className={`metric-card ${Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0) > 0 ? 'strong' : ''}`}
            style={Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0) > 0 ? { background: 'var(--danger)', color: 'white' } : {}}>
            <RotateCcw style={Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0) > 0 ? { color: 'white' } : {}} />
            <span style={Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0) > 0 ? { color: 'white' } : {}}>Empties Owed</span>
            <strong>
              {Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0)} cylinder{Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0) !== 1 ? 's' : ''}
            </strong>
          </div>
          <div className="metric-card">
            <Package />
            <span>Total Sales</span>
            <strong>{sales.length}</strong>
          </div>
          <div className="metric-card">
            <IndianRupee />
            <span>Total Billed</span>
            <strong>{money(sales.reduce((s, x) => s + Number(x.total_amount), 0))}</strong>
          </div>
        </section>

        {Object.values(customer.empty_credits || {}).length > 0 && (
          <div style={{ 
            marginBottom: '16px', 
            background: 'var(--success-soft)', 
            border: '1px solid rgba(16, 185, 129, 0.2)', 
            color: 'var(--success)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '14px 20px',
            borderRadius: '12px'
          }}>
            <RotateCcw size={20} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap' }}>Available Credits:</span>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', flex: 1 }}>
              {Object.values(customer.empty_credits).map((c, i) => (
                <span key={i} style={{ fontSize: '1.05rem' }}>
                  <strong>{c.credit}</strong> <span style={{ opacity: 0.8, margin: '0 2px' }}>×</span> {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Full-width Owed Banner */}
        {Object.values(customer.empties_owed || {}).length > 0 && (
          <div style={{ 
            marginBottom: '16px', 
            background: 'var(--danger-soft)', 
            border: '1px solid rgba(239, 68, 68, 0.2)', 
            color: 'var(--danger)', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '16px', 
            padding: '14px 20px',
            borderRadius: '12px'
          }}>
            <RotateCcw size={20} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem', whiteSpace: 'nowrap' }}>Empties Owed:</span>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', flex: 1 }}>
              {Object.values(customer.empties_owed).map((c, i) => (
                <span key={i} style={{ fontSize: '1.05rem' }}>
                  <strong>{c.owed}</strong> <span style={{ opacity: 0.8, margin: '0 2px' }}>×</span> {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {/* Receive Payment Modal */}
        {showPaymentModal && (
          <div className="modal-overlay">
            <div className="modal-content form-stack" style={{ maxWidth: '400px' }}>
              <div className="section-head">
                <h2>Receive Payment</h2>
                <button className="icon-button" onClick={() => setShowPaymentModal(false)}>
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleReceivePayment} className="form-stack">
                <label style={{ display: paymentMode === 'split' ? 'none' : 'block' }}>
                  <span>Amount Received (Rs.)</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="1" 
                    max={customer.pending_balance} 
                    required={paymentMode !== 'split'} 
                    value={paymentAmount} 
                    onChange={e => setPaymentAmount(e.target.value)} 
                    autoFocus 
                  />
                </label>
                <label>
                  <span>Payment Mode</span>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer</option>
                    <option value="gpay">GPay</option>
                    <option value="split">Split Payment</option>
                  </select>
                </label>
                {paymentMode === 'split' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                    <label>
                      <span>Cash</span>
                      <input type="number" min="0" value={paymentSplit.cash} onChange={e => setPaymentSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>GPay</span>
                      <input type="number" min="0" value={paymentSplit.gpay} onChange={e => setPaymentSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>Bank</span>
                      <input type="number" min="0" value={paymentSplit.bank} onChange={e => setPaymentSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                    </label>
                    <label>
                      <span>Credit Remaining</span>
                      <input type="number" disabled value={Math.max(0, customer.pending_balance - (Number(paymentSplit.cash || 0) + Number(paymentSplit.gpay || 0) + Number(paymentSplit.bank || 0)))} style={{ background: 'var(--surface-muted)', color: 'var(--danger)' }} />
                    </label>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                  <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowPaymentModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={paymentSaving}>
                    {paymentSaving ? 'Saving...' : 'Confirm Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="card">
          <h2 style={{ marginBottom: '14px' }}>Transaction History</h2>
          {timeline.length === 0 && <p style={{ textAlign: 'center', padding: '24px' }}>No transactions yet.</p>}
          <div className="ledger-list">
            {timeline.map((entry) => {
              if (entry.kind === 'payment_group') {
                const g = entry.group;
                const isSplit = g.payments.length > 1;
                return (
                  <div className="ledger-row" key={`payg-${g.payments[0].id}`}>
                    <div>
                      <strong style={{ color: 'var(--success)' }}>Payment Received</strong>
                      <p>
                        {fmtDate(g.date)}
                        {isSplit
                          ? ` · ${g.payments.map(p => `${p.payment_mode.toUpperCase()} ${p.amount}`).join(' + ')}`
                          : ` · ${g.payments[0].payment_mode.toUpperCase()}`
                        }
                        {g.empties > 0 && ` · ${g.empties} empty cylinder${g.empties > 1 ? 's' : ''} collected`}
                        {g.note ? ` · ${g.note}` : ''}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge badge-success">{money(g.total)}</span>
                      {g.empties > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                            <RotateCcw size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            {g.empties} empty back
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              const s = entry.sale;
              const returnOnlyItems = s.items.filter(i => i.quantity === 0);
              const regularItems = s.items.filter(i => i.quantity > 0);
              const isPureReturn = Number(s.total_amount) === 0 && returnOnlyItems.length === s.items.length && s.items.length > 0;

              return (
                <div key={`sale-${s.id}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <strong>{isPureReturn ? `Empty Return #${s.id}` : `Sale #${s.id}`}</strong>
                      <p>
                        {fmtDate(s.created_at)} · {s.location_name} · {s.payment_mode.toUpperCase()}
                        {(s.payment_mode === 'split' || s.payment_mode === 'credit') && s.payments && s.payments.length > 0 && (
                          <span className="badge" style={{ marginLeft: '6px', fontSize: '0.7rem', padding: '2px 6px', background: 'var(--surface-muted)' }}>
                            {s.payments.length} Payments
                          </span>
                        )}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{isPureReturn ? '' : money(s.total_amount)}</div>
                      {Number(s.balance_due) > 0
                        ? <span className="badge badge-warning">On Credit {money(s.balance_due)}</span>
                        : <span className="badge badge-success">{isPureReturn ? 'Recorded' : 'Paid'}</span>}
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface-muted)', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(() => {
                      const rows = [];
                      
                      regularItems.forEach((item, i) => {
                        rows.push(
                          <div key={`reg-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', alignItems: 'center' }}>
                            <span>
                              <strong>{item.quantity} × {item.cylinder_type_name}</strong>
                              {item.empty_returned > 0 && (
                                <span style={{ color: 'var(--success)', marginLeft: '8px' }}>
                                  <RotateCcw size={12} style={{ display: 'inline', marginRight: '3px' }} />
                                  {item.empty_returned} returned
                                </span>
                              )}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>@ {money(item.rate)}</span>
                          </div>
                        );
                      });

                      if (returnOnlyItems.length > 0) {
                        const totalReturns = returnOnlyItems.reduce((acc, i) => acc + i.empty_returned, 0);
                        const names = returnOnlyItems.map(i => `${i.empty_returned} × ${i.cylinder_type_name}`).join(', ');
                        
                        rows.push(
                          <div key="returns" style={{ display: 'flex', fontSize: '0.88rem', alignItems: 'center', marginTop: rows.length > 0 ? '4px' : '0' }}>
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              <RotateCcw size={12} style={{ display: 'inline', marginRight: '4px' }} />
                              {totalReturns} empty cylinder{totalReturns > 1 ? 's' : ''} returned <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({names})</span>
                            </span>
                          </div>
                        );
                      }
                      
                      if ((s.payment_mode === 'split' || s.payment_mode === 'credit') && s.payments && s.payments.length > 0) {
                        rows.push(
                          <div key="payments" style={{ marginTop: '6px', paddingTop: '10px', borderTop: '1px dashed var(--border)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                              <span>Payment Breakdown</span>
                              <span>Total Paid: {money(s.paid_amount)}</span>
                            </div>
                            {s.payments.map((p, idx) => (
                              <div key={`pay-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <span>{p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''} · {p.mode.toUpperCase()}</span>
                                <span style={{ color: 'var(--success)', fontWeight: 600 }}>{money(p.amount)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      return rows;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Customer list ────────────────────────────────────────────────────────

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Customers</h1>
          <p>Cashbook — pending balances and cylinder history.</p>
        </div>
        <button
          className="btn btn-primary"
          style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => { setShowAdd((v) => !v); setAddError(''); setCredUserId(null); setCredMsg(''); setCreatedPhone(''); setCreatedUsername(''); }}
        >
          {showAdd ? <X size={18} /> : <UserPlus size={18} />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Add customer form */}
      {showAdd && (
        <form onSubmit={handleAddCustomer} className="card form-stack" style={{ marginBottom: '16px' }}>
          <h2>New Customer</h2>
          <div className="grid-2">
            <label>
              <span>Name *</span>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Ravi Kumar" required autoFocus />
            </label>
            <label>
              <span>Phone *</span>
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} pattern="[0-9]*" title="Only digits allowed" placeholder="Required" required />
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Username</span>
              <input value={addUsername} onChange={(e) => setAddUsername(e.target.value)} placeholder="e.g. ravi" required />
            </label>
            <label>
              <span>Password</span>
              <input value="Auto-generated on create" disabled />
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Email</span>
              <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Optional" />
            </label>
            <label>
              <span>Address</span>
              <input value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          {addError && <p className="form-error">{addError}</p>}
          <button className="btn btn-primary" type="submit" disabled={addSaving}>
            <UserPlus size={18} /> {addSaving ? 'Saving…' : 'Save Customer'}
          </button>
        </form>
      )}

      <div className="input-with-icon" style={{ marginBottom: '16px' }}>
        <Search size={18} />
        <input
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading && <p style={{ textAlign: 'center', padding: '24px' }}>Loading…</p>}

      <div className="card" style={{ padding: 0 }}>
        {customers.length === 0 && !loading && (
          <p style={{ textAlign: 'center', padding: '24px' }}>No customers found.</p>
        )}

        {customers.map((c) => (
          <div key={c.id}>
            {/* ── Row ── */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', borderBottom: '1px solid var(--border)',
            }}>
              {/* Left: customer details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <strong style={{ fontSize: '1rem' }}>{c.name}</strong>
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  {c.phone && <span>{c.phone}</span>}
                  {c.email && <span>{c.email}</span>}
                  {c.address && <span>{c.address}</span>}
                </div>
              </div>

              {/* Right: badges + action buttons + ledger arrow */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {Number(c.pending_balance) > 0 && (
                  <span className="badge badge-warning">{money(c.pending_balance)}</span>
                )}
                {Object.values(c.empties_owed || {}).reduce((s, x) => s + x.owed, 0) > 0 && (
                  <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                    <RotateCcw size={11} style={{ display: 'inline', marginRight: '3px' }} />
                    {Object.values(c.empties_owed || {}).reduce((s, x) => s + x.owed, 0)} empty
                  </span>
                )}

                {/* Edit button */}
                <button
                  className="icon-button"
                  title="Edit"
                  onClick={() => editingId === c.id ? cancelEdit() : startEdit(c)}
                  style={editingId === c.id ? { color: 'var(--primary)' } : {}}
                >
                  {editingId === c.id ? <X size={16} /> : <Pencil size={16} />}
                </button>

                {/* Custom Rates button */}
                <button
                  className="icon-button"
                  title="Custom Cylinder Rates"
                  onClick={() => ratesId === c.id ? closeRates() : loadRates(c.id)}
                  style={ratesId === c.id ? { color: 'var(--primary)' } : {}}
                >
                  <Tag size={16} />
                </button>

                {/* Credentials button */}
                <button
                  className="icon-button"
                  title="Credentials / Reset Password"
                  onClick={() => credsId === c.id ? closeCreds() : loadCreds(c.id)}
                  style={credsId === c.id ? { color: 'var(--primary)' } : {}}
                >
                  <KeyRound size={16} />
                </button>

                {/* Delete button */}
                <button
                  className="icon-button"
                  title="Delete Customer"
                  style={{ color: 'var(--danger)' }}
                  disabled={deletingId === c.id}
                  onClick={() => handleDeleteCustomer(c.id, c.name)}
                >
                  <Trash2 size={16} />
                </button>

                {/* Open ledger */}
                <button
                  className="icon-button"
                  title="View Ledger"
                  onClick={() => openLedger(c.id)}
                  style={{ color: 'var(--text-muted)' }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* ── Inline Custom Rates panel ── */}
            {ratesId === c.id && (
              <div
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-muted)',
                }}
              >
                <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Tag size={16} /> Custom Cylinder Rates
                </h3>
                
                {/* Existing Rates */}
                {c.custom_rates && c.custom_rates.length > 0 ? (
                  <div style={{ marginBottom: '20px', display: 'grid', gap: '8px' }}>
                    {c.custom_rates.map(rate => (
                      <div key={rate.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 16px', background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: '8px'
                      }}>
                        <span style={{ fontWeight: 600 }}>{rate.cylinder_type_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>{money(rate.custom_price)}</span>
                          <button
                            className="icon-button"
                            onClick={() => handleDeleteRate(rate.id)}
                            title="Delete custom rate"
                            style={{ color: 'var(--danger)', padding: '4px' }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
                    No custom rates set for this customer yet.
                  </p>
                )}

                {/* Add New Rate Form */}
                <form onSubmit={(e) => handleAddRate(e, c.id)} className="grid-3" style={{ alignItems: 'flex-end', background: 'var(--surface)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <label>
                    <span>Cylinder Type</span>
                    <select
                      value={rateCylinderId}
                      onChange={(e) => setRateCylinderId(e.target.value)}
                      required
                    >
                      {cylinderTypes.map(ct => (
                        <option key={ct.id} value={ct.id}>{ct.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Custom Price (Rs.)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={ratePrice}
                      onChange={(e) => setRatePrice(e.target.value)}
                      required
                      placeholder="e.g. 900"
                    />
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={rateSaving}>
                    {rateSaving ? 'Saving…' : 'Add Rate'}
                  </button>
                </form>
              </div>
            )}

            {/* ── Inline Edit panel ── */}
            {editingId === c.id && (
              <form
                onSubmit={(e) => handleEdit(e, c.id)}
                className="form-stack"
                style={{
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-muted)',
                }}
              >
                <h3 style={{ marginBottom: '10px' }}>Edit Customer</h3>
                <div className="grid-2">
                  <label>
                    <span>Name *</span>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus />
                  </label>
                  <label>
                    <span>Phone *</span>
                    <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} required />
                  </label>
                </div>
                <div className="grid-2">
                  <label>
                    <span>Email</span>
                    <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                  </label>
                  <label>
                    <span>Address</span>
                    <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                  </label>
                </div>
                {editError && <p className="form-error">{editError}</p>}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-primary" type="submit" disabled={editSaving}>
                    <Check size={16} /> {editSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn btn-secondary" type="button" onClick={cancelEdit} disabled={editSaving}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* ── Inline Credentials panel ── */}
            {credsId === c.id && (
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={16} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Login Credentials</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px', flex: 1, justifyContent: 'flex-end' }}>
                  {credsError && <span className="form-error" style={{ margin: 0, paddingRight: '8px' }}>{credsError}</span>}
                  
                  {creds && !pwMsg && (
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => resetPassword(c.id)}
                      disabled={pwSaving}
                      style={{ padding: '6px 16px', fontSize: '0.85rem', width: 'auto', margin: 0 }}
                    >
                      <Check size={14} style={{ marginRight: '6px' }} /> {pwSaving ? 'Generating…' : 'Generate Temporary Password'}
                    </button>
                  )}

                  {creds && pwMsg && (
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                      {/* USERNAME */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>USERNAME</span>
                        <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.9rem' }}>{creds.username}</span>
                      </div>
                      
                      {/* TEMPORARY PASSWORD */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>TEMPORARY PASSWORD</span>
                        <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.9rem', letterSpacing: '0.5px' }}>{pwMsg}</span>
                        
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            className="icon-button" 
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', borderRadius: '6px' }}
                            title="Copy Details"
                            onClick={() => {
                              const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.`;
                              navigator.clipboard.writeText(msg);
                              alert('Credentials copied to clipboard!');
                            }}
                          >
                            <Copy size={14} />
                          </button>
                          <a
                            href={c.email ? `mailto:${c.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                            className="icon-button"
                            title={c.email ? "Email Details" : "No email saved"}
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              textDecoration: 'none', 
                              color: 'inherit', 
                              background: 'var(--surface)', 
                              border: '1px solid var(--border)', 
                              width: '28px', 
                              height: '28px', 
                              borderRadius: '6px',
                              opacity: c.email ? 1 : 0.5,
                              pointerEvents: c.email ? 'auto' : 'none'
                            }}
                            onClick={(e) => {
                              if (!c.email) {
                                e.preventDefault();
                                alert('No email address saved for this customer.');
                              }
                            }}
                          >
                            <Mail size={14} />
                          </a>
                          <button 
                            className="icon-button" 
                            type="button"
                            style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', borderRadius: '6px' }}
                            title="Share Details"
                            onClick={async () => {
                              const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.`;
                              if (navigator.share) {
                                try {
                                  await navigator.share({
                                    title: 'GasBook Login Details',
                                    text: msg
                                  });
                                } catch (err) {
                                  console.error('Error sharing', err);
                                }
                              } else {
                                navigator.clipboard.writeText(msg);
                                alert('Share not supported on this device. Credentials copied to clipboard instead!');
                              }
                            }}
                          >
                            <Share2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <button 
                    className="icon-button" 
                    onClick={closeCreds}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', marginLeft: '4px', borderRadius: '6px' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* ── New-customer temp password banner ── */}
            {credUserId && credMsg && c.phone === createdPhone && (
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--surface-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '16px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <KeyRound size={16} style={{ color: 'var(--primary)' }} />
                  <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>Login Credentials</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px', flex: 1, justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    {/* USERNAME */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>USERNAME</span>
                      <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.9rem' }}>{createdUsername}</span>
                    </div>
                    
                    {/* TEMPORARY PASSWORD */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>TEMPORARY PASSWORD</span>
                      <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.9rem', letterSpacing: '0.5px' }}>{credMsg}</span>
                      
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button 
                          className="icon-button" 
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', borderRadius: '6px' }}
                          title="Copy Details"
                          onClick={() => {
                            const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
                            navigator.clipboard.writeText(msg);
                            alert('Credentials copied to clipboard!');
                          }}
                        >
                          <Copy size={14} />
                        </button>
                        <a
                          href={c.email ? `mailto:${c.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                          className="icon-button"
                          title={c.email ? "Email Details" : "No email saved"}
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            textDecoration: 'none', 
                            color: 'inherit', 
                            background: 'var(--surface)', 
                            border: '1px solid var(--border)', 
                            width: '28px', 
                            height: '28px', 
                            borderRadius: '6px',
                            opacity: c.email ? 1 : 0.5,
                            pointerEvents: c.email ? 'auto' : 'none'
                          }}
                          onClick={(e) => {
                            if (!c.email) {
                              e.preventDefault();
                              alert('No email address saved for this customer.');
                            }
                          }}
                        >
                          <Mail size={14} />
                        </a>
                        <button 
                          className="icon-button" 
                          type="button"
                          style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', borderRadius: '6px' }}
                          title="Share Details"
                          onClick={async () => {
                            const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
                            if (navigator.share) {
                              try {
                                await navigator.share({
                                  title: 'GasBook Login Details',
                                  text: msg
                                });
                              } catch (err) {
                                console.error('Error sharing', err);
                              }
                            } else {
                              navigator.clipboard.writeText(msg);
                              alert('Share not supported on this browser. Credentials copied to clipboard instead!');
                            }
                          }}
                        >
                          <Share2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <button 
                    className="icon-button" 
                    onClick={() => { setCredUserId(null); setCredMsg(''); setCreatedUsername(''); }}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', marginLeft: '4px', borderRadius: '6px' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
