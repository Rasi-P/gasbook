import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Package, UserPlus, Eye, EyeOff } from 'lucide-react';
import { login, api, getRoleHome } from '../lib/api';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8001/api';

function PasswordInput({ value, onChange, placeholder, autoComplete }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        style={{ paddingRight: '48px' }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        style={{
          position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', color: 'var(--text-muted)', padding: '4px', cursor: 'pointer',
        }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export default function Login() {
  const [tab, setTab] = useState<'login' | 'register'>('login');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regFullName, setRegFullName] = useState('');
  const [regRole, setRegRole] = useState('staff');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const [regLoading, setRegLoading] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      await login(username, password);
      const { data } = await api.get('/auth/me/');
      localStorage.setItem('gasbook_role', data.role);
      window.location.href = getRoleHome(data.role);
    } catch {
      setLoginError('Wrong username or password.');
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setRegError(''); setRegSuccess('');
    setRegLoading(true);
    try {
      const tokenRes = await axios.post(`${API_BASE_URL}/auth/token/`, {
        username: adminUsername, password: adminPassword,
      });
      const adminToken = tokenRes.data.access;
      await axios.post(
        `${API_BASE_URL}/auth/register/`,
        { username: regUsername, password: regPassword, full_name: regFullName, role: regRole },
        { headers: { Authorization: `Bearer ${adminToken}` } },
      );
      setRegSuccess(`User "${regUsername}" created successfully.`);
      setRegUsername(''); setRegPassword(''); setRegFullName(''); setRegRole('staff');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      if (!detail && (err as { response?: { status?: number } })?.response?.status === 401) {
        setRegError('Admin username or password is wrong.');
      } else {
        setRegError(detail || 'Failed to create user.');
      }
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-mark"><Package /></div>
        <h1>GasBook</h1>
        <p style={{ marginBottom: '20px' }}>Digital notebook for gas stock, sales, and collections.</p>

        <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '20px' }}>
          {(['login', 'register'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '9px', border: 'none', borderRadius: '6px',
              background: tab === t ? 'var(--surface)' : 'transparent',
              fontWeight: 700, fontSize: '0.88rem',
              color: tab === t ? 'var(--text)' : 'var(--text-muted)',
            }}>
              {t === 'login' ? 'Login' : 'Add Staff'}
            </button>
          ))}
        </div>

        {tab === 'login' && (
          <form onSubmit={handleLogin} className="form-stack">
            <label>
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              <span>Password</span>
              <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
            </label>
            {loginError && <p className="form-error">{loginError}</p>}
            <button className="btn btn-primary" type="submit">
              <LockKeyhole size={20} /> Login
            </button>
          </form>
        )}

        {tab === 'register' && (
          <form onSubmit={handleRegister} className="form-stack">
            <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '14px', display: 'grid', gap: '10px' }}>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem', margin: 0 }}>Admin Verification</p>
              <label>
                <span>Admin Username</span>
                <input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} autoComplete="off" required />
              </label>
              <label>
                <span>Admin Password</span>
                <PasswordInput value={adminPassword} onChange={setAdminPassword} autoComplete="off" />
              </label>
            </div>

            <div style={{ background: 'var(--surface-muted)', borderRadius: 'var(--radius)', padding: '14px', display: 'grid', gap: '10px' }}>
              <p style={{ color: 'var(--text)', fontWeight: 700, fontSize: '0.88rem', margin: 0 }}>New Staff Details</p>
              <label>
                <span>Full Name</span>
                <input value={regFullName} onChange={(e) => setRegFullName(e.target.value)} placeholder="e.g. Ravi Kumar" required />
              </label>
              <label>
                <span>Username</span>
                <input value={regUsername} onChange={(e) => setRegUsername(e.target.value)} placeholder="e.g. ravi" required />
              </label>
              <label>
                <span>Password</span>
                <PasswordInput value={regPassword} onChange={setRegPassword} />
              </label>
              <label>
                <span>Role</span>
                <select value={regRole} onChange={(e) => setRegRole(e.target.value)}>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                  <option value="customer">Customer</option>
                </select>
              </label>
            </div>

            {regError && <p className="form-error">{regError}</p>}
            {regSuccess && <p className="form-note">{regSuccess}</p>}
            <button className="btn btn-primary" type="submit" disabled={regLoading}>
              <UserPlus size={20} /> {regLoading ? 'Creating…' : 'Create Staff Account'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
