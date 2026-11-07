import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, changePassword, getRoleHome } from '../lib/api';
import { Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { AuthHeader, AuthLayout } from '../components/AuthLayout';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';

function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <IconButton type="button" size="sm" label={shown ? 'Hide password' : 'Show password'} onClick={onToggle}>
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </IconButton>
  );
}

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
      <AuthLayout>
        <div className="auth-success">
          <span className="auth-success__icon" aria-hidden="true">
            <ShieldCheck size={40} />
          </span>
          <AuthHeader title="Password Updated Successfully" subtitle="Your password has been changed successfully." />
          <Button type="button" size="lg" block onClick={handleContinue}>
            CONTINUE
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader title={<>Welcome {userName} 👋</>} subtitle="Please change your password to continue" />

      <form className="auth-form" onSubmit={handleSubmit}>
        <Field label="Current Password" htmlFor="current-password">
          <Input
            id="current-password"
            type={showCurrent ? 'text' : 'password'}
            placeholder="Current Password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            leadingIcon={<Lock size={18} />}
            trailing={<PasswordToggle shown={showCurrent} onToggle={() => setShowCurrent(!showCurrent)} />}
          />
        </Field>

        <Field label="New Password" htmlFor="new-password">
          <Input
            id="new-password"
            type={showNew ? 'text' : 'password'}
            placeholder="New Password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
            leadingIcon={<Lock size={18} />}
            trailing={<PasswordToggle shown={showNew} onToggle={() => setShowNew(!showNew)} />}
          />
        </Field>

        <Field label="Confirm Password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type={showConfirm ? 'text' : 'password'}
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            leadingIcon={<Lock size={18} />}
            trailing={<PasswordToggle shown={showConfirm} onToggle={() => setShowConfirm(!showConfirm)} />}
          />
        </Field>

        <ul className="auth-hints">
          <li>At least 8 characters</li>
          <li>Include number &amp; symbol</li>
        </ul>

        {error ? <Alert tone="danger" compact>{error}</Alert> : null}

        <Button type="submit" size="lg" block disabled={saving} loading={saving}>
          {saving ? 'SAVING...' : 'SAVE PASSWORD'}
        </Button>
      </form>
    </AuthLayout>
  );
}
