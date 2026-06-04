import { useEffect, useState } from 'react';
import { Eye, EyeOff, UserPlus, X, Check, Pencil, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

type StaffUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  plain_password: string;
  phone: string;
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
  const [showPw, setShowPw] = useState<Record<number, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);

  const [fullNameValue, setFullNameValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [credUserId, setCredUserId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [credMsg, setCredMsg] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function load() {
    api.get('/auth/users/').then((r) => setUsers(r.data)).catch(() => undefined);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    setSaving(true);
    try {
      await api.post('/auth/register/', {
        username,
        password,
        full_name: fullNameValue,
        phone,
        address,
        role,
      });
      setSuccess(`User "${username}" created.`);
      setFullNameValue(''); setUsername(''); setPassword(''); setPhone(''); setAddress(''); setRole('staff');
      setShowAdd(false);
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user: StaffUser) {
    setEditingId(user.id);
    setEditName(fullName(user));
    setEditPhone(user.phone || '');
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
    if (!newPassword.trim()) return;
    setCredSaving(true); setCredMsg('');
    try {
      await api.post(`/auth/users/${userId}/credentials/`, { password: newPassword });
      setCredMsg('Password updated successfully.');
      setNewPassword('');
      load();
    } catch {
      setCredMsg('Failed to update password.');
    } finally {
      setCredSaving(false);
    }
  }

  async function deleteCredentials(user: StaffUser) {
    const ok = window.confirm(`Remove login credentials for ${fullName(user)}? Sales and history will be kept.`);
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
          <p>All accounts - username and password visible to admin.</p>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => { setShowAdd((v) => !v); setError(''); setSuccess(''); }}>
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
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a password" required />
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
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Required" required />
            </label>
            <label>
              <span>Address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-note">{success}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Check size={18} /> {saving ? 'Creating...' : 'Create User'}
          </button>
        </form>
      )}

      {success && !showAdd && <p className="form-note" style={{ marginBottom: '16px' }}>{success}</p>}

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
                <div style={{ display: 'flex', gap: '16px', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  <span>{u.username}</span>
                  {u.phone && <span>{u.phone}</span>}
                  {u.address && <span>{u.address}</span>}
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {showPw[u.id]
                      ? (u.plain_password || '(not set)')
                      : '*'.repeat(Math.min((u.plain_password || '').length || 8, 10))}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => editingId === u.id ? setEditingId(null) : startEdit(u)}
                  style={{
                    background: 'var(--surface-muted)', border: 'none', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)',
                  }}
                >
                  {editingId === u.id ? <X size={14} /> : <Pencil size={14} />}
                  {editingId === u.id ? 'Cancel' : 'Edit'}
                </button>
                <button
                  onClick={() => {
                    if (protectedAdmin) return;
                    setCredUserId(credUserId === u.id ? null : u.id); setCredMsg(''); setNewPassword('');
                  }}
                  disabled={protectedAdmin}
                  style={{
                    background: 'var(--surface-muted)', border: 'none', borderRadius: '6px',
                    padding: '6px 10px', cursor: protectedAdmin ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.78rem', fontWeight: 700, color: protectedAdmin ? 'var(--text-muted)' : 'var(--text-muted)',
                    opacity: protectedAdmin ? 0.6 : 1,
                  }}
                >
                  <KeyRound size={14} />
                  Password
                </button>
                <button
                  onClick={() => setShowPw((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}
                  style={{
                    background: 'var(--surface-muted)', border: 'none', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px',
                    fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)',
                  }}
                >
                  {showPw[u.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showPw[u.id] ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(
                    `Username: ${u.username}\nPassword: ${u.plain_password || '(not set)'}`
                  )}
                  style={{
                    background: 'var(--primary)', border: 'none', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: 'white',
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() => deleteCredentials(u)}
                  disabled={deletingId === u.id || protectedAdmin}
                  style={{
                    background: 'var(--danger-soft)', border: 'none', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, color: 'var(--danger)',
                    display: 'flex', alignItems: 'center', gap: '4px',
                  }}
                >
                  <Trash2 size={14} />
                  {deletingId === u.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>

            {credUserId === u.id && (
              <div className="form-stack" style={{ padding: '0 18px 16px 18px', borderBottom: editingId === u.id ? 'none' : '1px solid var(--border)' }}>
                <h2>Login Credentials</h2>
                <div style={{ display: 'grid', gap: '10px' }}>
                  <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '12px' }}>
                    <p style={{ fontSize: '0.8rem', marginBottom: '4px' }}>Username</p>
                    <strong>{u.username}</strong>
                  </div>
                  <label>
                    <span>Set New Password</span>
                    <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" />
                  </label>
                  {credMsg && <p className={credMsg.includes('success') ? 'form-note' : 'form-error'}>{credMsg}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" type="button" onClick={() => resetPassword(u.id)} disabled={credSaving || !newPassword.trim()}>
                      <Check size={18} /> {credSaving ? 'Saving...' : 'Update Password'}
                    </button>
                    <button className="btn btn-secondary" type="button" onClick={() => { setCredUserId(null); setCredMsg(''); setNewPassword(''); }}>
                      Cancel
                    </button>
                  </div>
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
                    <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} required />
                  </label>
                </div>
                <label>
                  <span>Address</span>
                  <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                </label>
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
