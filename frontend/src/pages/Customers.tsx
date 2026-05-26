import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { Search, ChevronRight, ArrowLeft, IndianRupee, Package, RotateCcw, UserPlus, X, Pencil, Check, KeyRound, Eye, EyeOff } from 'lucide-react';
import { api } from '../lib/api';

type Customer = {
  id: number;
  name: string;
  phone: string;
  address: string;
  opening_balance: number;
  pending_balance: number;
  empties_owed: number;
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

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Credentials state
  const [showCreds, setShowCreds] = useState(false);
  const [creds, setCreds] = useState<{ username: string; full_name: string; plain_password: string } | null>(null);
  const [credsError, setCredsError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [lastSetPassword, setLastSetPassword] = useState('');

  async function loadCreds(customerId: number) {
    setCredsError(''); setCreds(null); setPwMsg('');
    try {
      const { data } = await api.get(`/customers/${customerId}/credentials/`);
      setCreds(data);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCredsError(detail || 'No login account linked.');
    }
  }

  async function resetPassword(customerId: number) {
    if (!newPassword.trim()) return;
    setPwSaving(true); setPwMsg('');
    try {
      await api.post(`/customers/${customerId}/credentials/`, { password: newPassword });
      setPwMsg('Password updated successfully.');
      setNewPassword('');
      // Refresh creds so the new password shows immediately
      const { data } = await api.get(`/customers/${customerId}/credentials/`);
      setCreds(data);
    } catch {
      setPwMsg('Failed to update password.');
    } finally {
      setPwSaving(false);
    }
  }

  function startEdit(c: Customer) {
    setEditName(c.name); setEditPhone(c.phone); setEditAddress(c.address);
    setEditError(''); setEditing(true);
  }

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setEditError(''); setEditSaving(true);
    try {
      const { data } = await api.patch(`/customers/${selected.customer.id}/`, {
        name: editName.trim(), phone: editPhone.trim(), address: editAddress.trim(),
      });
      setSelected((prev) => prev ? { ...prev, customer: { ...prev.customer, ...data } } : prev);
      setEditing(false);
    } catch {
      setEditError('Failed to save. Try again.');
    } finally {
      setEditSaving(false);
    }
  }

  // Add customer form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  async function handleAddCustomer(e: FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddSaving(true);
    try {
      await api.post('/customers/', { name: addName.trim(), phone: addPhone.trim(), address: addAddress.trim() });
      setAddName(''); setAddPhone(''); setAddAddress('');
      setShowAdd(false);
      fetchCustomers();
    } catch {
      setAddError('Failed to save. Try again.');
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
    api.get(`/customers/${id}/ledger/`)
      .then((r) => setSelected(r.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }

  if (selected) {
    const { customer, sales, payments } = selected;

    // Build unified timeline
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
            <button className="icon-button" onClick={() => { setSelected(null); setEditing(false); setShowCreds(false); setCreds(null); }}><ArrowLeft size={20} /></button>
            <div>
              <h1>{customer.name}</h1>
              {customer.phone && <p>{customer.phone}</p>}
            </div>
          </div>
          <button className="icon-button" onClick={() => editing ? setEditing(false) : startEdit(customer)}>
            {editing ? <X size={18} /> : <Pencil size={18} />}
          </button>
          <button className="icon-button" onClick={() => {
            setShowCreds((v) => !v);
            if (!showCreds) loadCreds(customer.id);
            else { setCreds(null); setCredsError(''); setPwMsg(''); setLastSetPassword(''); }
          }}>
            <KeyRound size={18} />
          </button>
        </div>

        {/* Credentials panel */}
        {showCreds && (
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="section-head">
              <h2>Login Credentials</h2>
              <KeyRound size={18} style={{ color: 'var(--primary)' }} />
            </div>
            {credsError && <p className="form-error">{credsError}</p>}
            {creds && (
              <div style={{ display: 'grid', gap: '12px' }}>
                {/* Username row */}
                <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Username</p>
                    <strong style={{ fontSize: '1rem', color: 'var(--text)' }}>{creds.username}</strong>
                  </div>
                  <button type="button" onClick={() => navigator.clipboard.writeText(creds.username)}
                    style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                    Copy
                  </button>
                </div>

                {/* Password row */}
                <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Password</p>
                    <strong style={{ fontSize: '1rem', color: 'var(--text)', fontFamily: 'monospace' }}>
                      {showNewPw ? creds.plain_password : '•'.repeat(Math.min(creds.plain_password.length, 12))}
                    </strong>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" onClick={() => setShowNewPw((v) => !v)}
                      style={{ background: 'var(--border)', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      {showNewPw ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" onClick={() => navigator.clipboard.writeText(creds.plain_password)}
                      style={{ background: 'var(--primary)', border: 'none', borderRadius: '6px', padding: '6px 10px', fontSize: '0.78rem', fontWeight: 700, color: 'white', cursor: 'pointer' }}>
                      Copy
                    </button>
                  </div>
                </div>

                {/* Reset password */}
                <label>
                  <span>Set New Password</span>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </label>
                {pwMsg && <p className={pwMsg.includes('success') ? 'form-note' : 'form-error'}>{pwMsg}</p>}
                <button className="btn btn-primary" onClick={() => resetPassword(customer.id)} disabled={pwSaving || !newPassword.trim()}>
                  <Check size={18} /> {pwSaving ? 'Saving…' : 'Update Password'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <form onSubmit={handleEdit} className="card form-stack" style={{ marginBottom: '16px' }}>
            <h2>Edit Customer</h2>
            <div className="grid-2">
              <label>
                <span>Name *</span>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus />
              </label>
              <label>
                <span>Phone</span>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              </label>
            </div>
            <label>
              <span>Address</span>
              <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </label>
            {editError && <p className="form-error">{editError}</p>}
            <button className="btn btn-primary" type="submit" disabled={editSaving}>
              <Check size={18} /> {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </form>
        )}

        {/* Summary cards */}
        <section className="stat-grid" style={{ marginBottom: '16px' }}>
          <div className="metric-card strong">
            <IndianRupee />
            <span>Pending</span>
            <strong>{money(customer.pending_balance)}</strong>
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
              return (
                <div key={`sale-${s.id}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '14px', marginBottom: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <strong>Sale #{s.id}</strong>
                      <p>{fmtDate(s.created_at)} · {s.location_name} · {s.payment_mode.toUpperCase()}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{money(s.total_amount)}</div>
                      {Number(s.balance_due) > 0
                        ? <span className="badge badge-warning">Due {money(s.balance_due)}</span>
                        : <span className="badge badge-success">Paid</span>}
                    </div>
                  </div>

                  {/* Cylinder breakdown */}
                  <div style={{ background: 'var(--surface-muted)', borderRadius: '6px', padding: '10px', display: 'grid', gap: '6px' }}>
                    {s.items.map((item, i) => {
                      const emptiesOwed = item.quantity - item.empty_returned;
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', alignItems: 'center' }}>
                          <span>
                            <strong>{item.quantity} × {item.cylinder_type_name}</strong>
                            {item.empty_returned > 0 && (
                              <span style={{ color: 'var(--success)', marginLeft: '8px' }}>
                                <RotateCcw size={12} style={{ display: 'inline', marginRight: '3px' }} />
                                {item.empty_returned} returned
                              </span>
                            )}
                            {emptiesOwed > 0 && (
                              <span style={{ color: 'var(--danger)', marginLeft: '8px', fontWeight: 700 }}>
                                {emptiesOwed} empty owed
                              </span>
                            )}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>@ {money(item.rate)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Customers</h1>
          <p>Cashbook — pending balances and cylinder history.</p>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => { setShowAdd((v) => !v); setAddError(''); }}>
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
              <span>Phone</span>
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <label>
            <span>Address</span>
            <input value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder="Optional" />
          </label>
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
          <button
            key={c.id}
            onClick={() => openLedger(c.id)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%', padding: '16px 18px', background: 'none', border: 'none',
              borderBottom: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer',
            }}
          >
            <div>
              <strong style={{ fontSize: '1rem' }}>{c.name}</strong>
              {c.phone && <p style={{ fontSize: '0.82rem', marginTop: '2px' }}>{c.phone}</p>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {Number(c.pending_balance) > 0
                ? <span className="badge badge-warning">{money(c.pending_balance)}</span>
                : <span className="badge badge-success">Clear</span>}
              {c.empties_owed > 0 && (
                <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  <RotateCcw size={11} style={{ display: 'inline', marginRight: '3px' }} />
                  {c.empties_owed} empty
                </span>
              )}
              <ChevronRight size={18} style={{ color: 'var(--text-muted)' }} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
