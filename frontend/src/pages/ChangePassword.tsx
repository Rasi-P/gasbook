import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole, Eye, EyeOff } from 'lucide-react';
import { api, changePassword, getRoleHome, logout } from '../lib/api';

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
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
        style={{ paddingRight: '44px' }}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        title={show ? 'Hide password' : 'View password'}
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          padding: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      const { data } = await api.get('/auth/me/');
      localStorage.setItem('gasbook_role', data.role);
      localStorage.setItem('gasbook_name', data.name);
      localStorage.setItem('gasbook_vehicle_location', data.vehicle_location_name || '');
      localStorage.removeItem('gasbook_force_password_change');
      window.location.href = getRoleHome(data.role);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel" style={{ maxWidth: '420px' }}>
        <div className="login-mark"><LockKeyhole /></div>
        <h1>Change Your Password</h1>
        <p style={{ marginBottom: '18px', color: 'var(--text-muted)' }}>
          Use your temporary password once, then choose a new one.
        </p>
        <form onSubmit={handleSubmit} className="form-stack">
          <label>
            <span>Current / Temporary Password</span>
            <PasswordInput
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
          </label>
          <label>
            <span>New Password</span>
            <PasswordInput
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Confirm New Password</span>
            <PasswordInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Updating…' : 'Update Password'}
          </button>
          <button className="btn" type="button" onClick={() => { logout(); window.location.href = '/login'; }}>
            Logout
          </button>
        </form>
      </section>
    </main>
  );
}

