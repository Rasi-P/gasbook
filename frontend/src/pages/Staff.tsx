import { useEffect, useState } from 'react';
import { UserPlus, X, Check, Pencil, KeyRound, Trash2, Copy, Mail, Share2 } from 'lucide-react';
import { api } from '../lib/api';

type StaffUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  plain_password: string;
  phone: string;
  email: string;
  address: string;
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--primary)',
  staff: 'var(--success)',
};

function fullName(user: StaffUser) {
  return user.first_name || user.last_name ? `${user.first_name} ${user.last_name}`.trim() : user.username;
}

function isProtectedAdmin(user: StaffUser) {
  return user.username === 'admin';
}

export default function Staff() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const [fullNameValue, setFullNameValue] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [credUserId, setCredUserId] = useState<number | null>(null);
  const [credMsg, setCredMsg] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load() {
    api.get('/auth/users/').then((r) => setUsers(r.data)).catch(() => undefined);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const createdUsername = username.trim();
      const { data } = await api.post('/auth/register/', {
        username: createdUsername,
        full_name: fullNameValue,
        phone,
        email,
        address,
        role,
      });
      const tempPassword = (data as { temporary_password?: string }).temporary_password;

      setFullNameValue(''); setUsername(''); setPhone(''); setEmail(''); setAddress(''); setRole('staff');
      setShowAdd(false);
      await load();

      if (data.id) {
        setCredUserId(data.id);
        setCredMsg(tempPassword || 'Password securely generated.');
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: StaffUser) {
    setCredUserId(null);
    setCredMsg('');
    setEditingId(user.id);
    setEditName(fullName(user));
    setEditPhone(user.phone || '');
    setEditEmail(user.email || '');
    setEditAddress(user.address || '');
    setEditError('');
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true); setEditError('');
    try {
      const { data } = await api.patch(`/auth/users/${editingId}/`, {
        full_name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        address: editAddress.trim(),
      });
      setUsers((prev) => prev.map((u) => (u.id === editingId ? data : u)));
      setEditingId(null);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setEditError(detail || 'Failed to save. Try again.');
    } finally {
      setEditSaving(false);
    }
  }

  async function resetPassword(userId: number) {
    setCredSaving(true); setCredMsg('');
    try {
      const { data } = await api.post(`/auth/users/${userId}/credentials/`, {});
      setCredMsg(data.temporary_password || 'Password reset successfully.');
      load();
    } catch {
      setCredMsg('Failed to reset password.');
    } finally {
      setCredSaving(false);
    }
  }

  async function deleteCredentials(user: StaffUser) {
    const ok = window.confirm(`PERMANENTLY DELETE user ${fullName(user)}? This will completely destroy all their associated sales, payments, and delivery data. This cannot be undone.`);
    if (!ok) return;
    setDeletingId(user.id);
    try {
      await api.delete(`/auth/users/${user.id}/`);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Staff & Users</h1>
          <p>Accounts are created with a one-time temporary password and can be reset securely.</p>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => { setShowAdd((v) => !v); setError(''); }}>
          {showAdd ? <X size={18} /> : <UserPlus size={18} />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card form-stack" style={{ marginBottom: '16px' }}>
          <h2>New User</h2>
          <div className="grid-2">
            <label>
              <span>Full Name</span>
              <input value={fullNameValue} onChange={(e) => setFullNameValue(e.target.value)} placeholder="e.g. Ravi Kumar" required />
            </label>
            <label>
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ravi" required />
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Password</span>
              <input value="Auto-generated on create" disabled />
            </label>
            <label>
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Phone *</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} pattern="[0-9]*" title="Only digits allowed" placeholder="Required" required />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <label>
            <span>Address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Check size={18} /> {saving ? 'Creating...' : 'Create User'}
          </button>
        </form>
      )}

      {/* No success banner here, it is now shown below the specific user card */}

      <div className="card" style={{ padding: 0 }}>
        {users.length === 0 && (
          <p style={{ textAlign: 'center', padding: '24px' }}>No users found.</p>
        )}
        {users.map((u) => {
          const protectedAdmin = isProtectedAdmin(u);
          return (
            <div key={u.id}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', borderBottom: editingId === u.id ? 'none' : '1px solid var(--border)', gap: '12px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '1rem' }}>{fullName(u)}</strong>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px',
                      borderRadius: '999px', background: (ROLE_COLORS[u.role] || 'var(--text-muted)') + '22',
                      color: ROLE_COLORS[u.role] || 'var(--text-muted)',
                    }}>
                      {u.role.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap', wordBreak: 'break-word' }}>
                    <span>{u.username}</span>
                    {u.phone && <span>{u.phone}</span>}
                    {u.email && <span>{u.email}</span>}
                    {u.address && <span>{u.address}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    className="icon-button"
                    title="Edit"
                    onClick={() => editingId === u.id ? setEditingId(null) : startEdit(u)}
                    style={editingId === u.id ? { color: 'var(--primary)' } : {}}
                  >
                    {editingId === u.id ? <X size={16} /> : <Pencil size={16} />}
                  </button>
                  <button
                    className="icon-button"
                    title="Password"
                    onClick={() => {
                      if (protectedAdmin) return;
                      setEditingId(null);
                      setCredUserId(credUserId === u.id ? null : u.id); setCredMsg('');
                    }}
                    disabled={protectedAdmin}
                    style={{
                      ...(credUserId === u.id ? { color: 'var(--primary)' } : {}),
                      opacity: protectedAdmin ? 0.3 : 1
                    }}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="Delete"
                    onClick={() => deleteCredentials(u)}
                    disabled={deletingId === u.id || protectedAdmin}
                    style={{ 
                      color: 'var(--danger)',
                      opacity: (deletingId === u.id || protectedAdmin) ? 0.3 : 1
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {credUserId === u.id && (
                <div
                  style={{
                    padding: '12px 18px',
                    borderBottom: editingId === u.id ? 'none' : '1px solid var(--border)',
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
                    {!credMsg ? (
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => resetPassword(u.id)}
                        disabled={credSaving}
                        style={{ padding: '6px 16px', fontSize: '0.85rem', width: 'auto', margin: 0 }}
                      >
                        <Check size={14} style={{ marginRight: '6px' }} /> {credSaving ? 'Generating...' : 'Generate Temporary Password'}
                      </button>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                        {/* USERNAME */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.5px' }}>USERNAME</span>
                          <span style={{ background: 'var(--surface)', padding: '4px 10px', borderRadius: '20px', border: '1px solid var(--border)', fontSize: '0.9rem' }}>{u.username}</span>
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
                                const msg = `Hello ${u.first_name},\n\nHere are your GasBook login details:\n\nUsername: ${u.username}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
                                navigator.clipboard.writeText(msg);
                                alert('Credentials copied to clipboard!');
                              }}
                            >
                              <Copy size={14} />
                            </button>
                            <a
                              href={u.email ? `mailto:${u.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${u.first_name},\n\nHere are your GasBook login details:\n\nUsername: ${u.username}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                              className="icon-button"
                              title={u.email ? "Email Details" : "No email saved"}
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
                                opacity: u.email ? 1 : 0.5,
                                pointerEvents: u.email ? 'auto' : 'none'
                              }}
                              onClick={(e) => {
                                if (!u.email) {
                                  e.preventDefault();
                                  alert('No email address saved for this staff member.');
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
                                const msg = `Hello ${u.first_name},\n\nHere are your GasBook login details:\n\nUsername: ${u.username}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
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
                    )}
                    
                    <button 
                      className="icon-button" 
                      onClick={() => { setCredUserId(null); setCredMsg(''); }}
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '28px', height: '28px', marginLeft: '4px', borderRadius: '6px' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}

              {editingId === u.id && (
                <form onSubmit={handleEdit} className="form-stack" style={{ padding: '0 18px 16px 18px', borderBottom: '1px solid var(--border)' }}>
                  <h2>Edit User</h2>
                  <div className="grid-2">
                    <label>
                      <span>Name *</span>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} required autoFocus />
                    </label>
                    <label>
                      <span>Phone *</span>
                      <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} pattern="[0-9]*" title="Only digits allowed" required />
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
                      <Check size={18} /> {editSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button className="btn btn-secondary" type="button" onClick={() => setEditingId(null)} disabled={editSaving}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
