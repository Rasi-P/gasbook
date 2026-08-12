import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, changePassword, getRoleHome } from '../lib/api';
import sabcoLogo from '../assets/sabco_logo.png';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const userName = localStorage.getItem('gasbook_name') || 'Partner';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      const { data } = await api.get('/auth/me/');
      localStorage.setItem('gasbook_role', data.role);
      localStorage.setItem('gasbook_name', data.name);
      localStorage.setItem('gasbook_vehicle_location', data.vehicle_location_name || '');
      localStorage.removeItem('gasbook_force_password_change');
      setIsSuccess(true);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Unable to update password. Please check your credentials.');
    } finally {
      setSaving(false);
    }
  }

  function handleContinue() {
    const role = localStorage.getItem('gasbook_role') || 'staff';
    window.location.href = getRoleHome(role);
  }

  if (isSuccess) {
    return (
      <div className="legacy-auth-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="login-screen" style={{ justifyContent: 'center', alignItems: 'center', padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#0f55d8' }}>
            <ShieldCheck size={52} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>Password Updated Successfully</h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 32 }}>Your password has been changed successfully.</p>
          <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={handleContinue}>
            CONTINUE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="legacy-auth-shell">
      <div className="login-screen">
        <div className="login-header">
          <img src={sabcoLogo} className="login-brand-logo" alt="Sabco logo" />
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <h2>Welcome {userName} 👋</h2>
            <p>Please change your password to continue</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="current-password">Current Password</label>
              <div className="input-wrapper">
                <Lock className="field-icon" size={20} />
                <input
                  id="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowCurrent(!showCurrent)}>
                  {showCurrent ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <div className="input-wrapper">
                <Lock className="field-icon" size={20} />
                <input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowNew(!showNew)}>
                  {showNew ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">Confirm Password</label>
              <div className="input-wrapper">
                <Lock className="field-icon" size={20} />
                <input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <button type="button" className="password-toggle" onClick={() => setShowConfirm(!showConfirm)}>
                  {showConfirm ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <ul className="password-hints">
              <li>At least 8 characters</li>
              <li>Include number &amp; symbol</li>
            </ul>

            {error ? <p className="form-feedback form-feedback--error">{error}</p> : null}

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'SAVING...' : 'SAVE PASSWORD'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

