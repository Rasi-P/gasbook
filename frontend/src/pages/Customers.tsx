import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { Search, ChevronRight, ArrowLeft, IndianRupee, Package, RotateCcw, UserPlus, X, Pencil, Check, KeyRound, Trash2, Copy, Phone, Mail, MapPin, Share2 } from 'lucide-react';
import { api } from '../lib/api';

type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  opening_balance: number;
  pending_balance: number;
  empties_owed: number;
  empty_credits: Record<number, { credit: number; name: string }>;
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
};

type Payment = {
  id: number;
  created_at: string;
  amount: number;
  payment_mode: string;
  note: string;
  empty_collected: number;
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

  // Receive Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
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
    setPaymentSaving(true);
    try {
      await api.post('/payments/', {
        customer: selected.customer.id,
        amount: Number(paymentAmount),
        payment_mode: paymentMode,
        note: 'Balance clearance',
      });
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentMode('cash');
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

    type Entry =
      | { kind: 'sale'; date: string; sale: Sale }
      | { kind: 'payment'; date: string; payment: Payment };

    const timeline: Entry[] = [
      ...sales.map((s) => ({ kind: 'sale' as const, date: s.created_at, sale: s })),
      ...payments.map((p) => ({ kind: 'payment' as const, date: p.created_at, payment: p })),
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
          <div className={`metric-card ${customer.empties_owed > 0 ? 'strong' : ''}`}
            style={customer.empties_owed > 0 ? { background: 'var(--danger)', color: 'white' } : {}}>
            <RotateCcw style={customer.empties_owed > 0 ? { color: 'white' } : {}} />
            <span style={customer.empties_owed > 0 ? { color: 'white' } : {}}>Empties Owed</span>
            <strong>{customer.empties_owed} cylinder{customer.empties_owed !== 1 ? 's' : ''}</strong>
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

        {/* Full-width Credits Banner */}
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
                <label>
                  <span>Amount Received (Rs.)</span>
                  <input 
                    type="number" 
                    step="0.01" 
                    min="1" 
                    max={customer.pending_balance} 
                    required 
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
                  </select>
                </label>
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
              if (entry.kind === 'payment') {
                const p = entry.payment;
                return (
                  <div className="ledger-row" key={`pay-${p.id}`}>
                    <div>
                      <strong style={{ color: 'var(--success)' }}>Payment Received</strong>
                      <p>
                        {fmtDate(p.created_at)} · {p.payment_mode.toUpperCase()}
                        {p.empty_collected > 0 && ` · ${p.empty_collected} empty cylinder${p.empty_collected > 1 ? 's' : ''} collected`}
                        {p.note ? ` · ${p.note}` : ''}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="badge badge-success">{money(p.amount)}</span>
                      {p.empty_collected > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                            <RotateCcw size={11} style={{ display: 'inline', marginRight: '3px' }} />
                            {p.empty_collected} empty back
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
                      <p>{fmtDate(s.created_at)} · {s.location_name} · {s.payment_mode.toUpperCase()}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{isPureReturn ? '' : money(s.total_amount)}</div>
                      {Number(s.balance_due) > 0
                        ? <span className="badge badge-warning">Due {money(s.balance_due)}</span>
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
          onClick={() => { setShowAdd((v) => !v); setAddError(''); setCredUserId(null); setCredMsg(''); setCreatedPhone(''); }}
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
                {c.empties_owed > 0 && (
                  <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                    <RotateCcw size={11} style={{ display: 'inline', marginRight: '3px' }} />
                    {c.empties_owed} empty
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
              <div className="form-stack" style={{ padding: '0 18px 16px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2>Login Credentials Generated</h2>
                  <button className="icon-button" onClick={() => { setCredUserId(null); setCredMsg(''); }}><X size={16} /></button>
                </div>
                <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '12px' }}>
                  <p style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Temporary Password</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '1.05rem', wordBreak: 'break-all' }}>{credMsg}</strong>
                    <button className="icon-button" type="button" onClick={() => navigator.clipboard.writeText(credMsg)} title="Copy Password">
                      <Copy size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
