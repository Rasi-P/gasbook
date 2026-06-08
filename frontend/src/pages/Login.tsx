import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Package, Eye, EyeOff } from 'lucide-react';
import { login, api, getRoleHome } from '../lib/api';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const tokenData = await login(username, password);
      if (tokenData.must_change_password) {
        localStorage.setItem('gasbook_force_password_change', '1');
        window.location.href = '/change-password';
        return;
      }
      const { data } = await api.get('/auth/me/');
      localStorage.setItem('gasbook_role', data.role);
      localStorage.setItem('gasbook_name', data.name);
      localStorage.setItem('gasbook_vehicle_location', data.vehicle_location_name || '');
      window.location.href = getRoleHome(data.role);
    } catch {
      setLoginError('Wrong username or password.');
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-mark"><Package /></div>
        <h1>GasBook</h1>
        <p style={{ marginBottom: '20px' }}>Digital notebook for gas stock, sales, and collections.</p>

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
      </section>
    </main>
  );
}
