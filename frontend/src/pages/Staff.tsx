import { useEffect, useState } from 'react';
import { Eye, EyeOff, UserPlus, X, Check } from 'lucide-react';
import { api } from '../lib/api';

type StaffUser = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  plain_password: string;
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--primary)',
  staff: 'var(--success)',
  customer: 'var(--warning)',
};

export default function Staff() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [showPw, setShowPw] = useState<Record<number, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);

  // Add user form
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function load() {
    api.get('/auth/users/').then((r) => setUsers(r.data)).catch(() => undefined);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');
    setSaving(true);
    try {
      await api.post('/auth/register/', { username, password, full_name: fullName, role });
      setSuccess(`User "${username}" created.`);
      setFullName(''); setUsername(''); setPassword(''); setRole('staff');
      setShowAdd(false);
      load();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h1>Staff & Users</h1>
          <p>All accounts — username and password visible to admin.</p>
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0 16px' }}
          onClick={() => { setShowAdd((v) => !v); setError(''); setSuccess(''); }}>
          {showAdd ? <X size={18} /> : <UserPlus size={18} />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="card form-stack" style={{ marginBottom: '16px' }}>
          <h2>New User</h2>
          <div className="grid-2">
            <label>
              <span>Full Name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Ravi Kumar" required />
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
                <option value="customer">Customer</option>
              </select>
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-note">{success}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Check size={18} /> {saving ? 'Creating…' : 'Create User'}
          </button>
        </form>
      )}

      {success && !showAdd && <p className="form-note" style={{ marginBottom: '16px' }}>{success}</p>}

      <div className="card" style={{ padding: 0 }}>
        {users.length === 0 && (
          <p style={{ textAlign: 'center', padding: '24px' }}>No users found.</p>
        )}
        {users.map((u) => (
          <div key={u.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', borderBottom: '1px solid var(--border)', gap: '12px',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <strong style={{ fontSize: '1rem' }}>
                  {u.first_name || u.last_name ? `${u.first_name} ${u.last_name}`.trim() : u.username}
                </strong>
                <span style={{
                  fontSize: '0.72rem', fontWeight: 800, padding: '2px 8px',
                  borderRadius: '999px', background: ROLE_COLORS[u.role] + '22',
                  color: ROLE_COLORS[u.role],
                }}>
                  {u.role.toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                <span>👤 {u.username}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  🔑 {showPw[u.id]
                    ? (u.plain_password || '(not set)')
                    : '•'.repeat(Math.min((u.plain_password || '').length || 8, 10))}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
