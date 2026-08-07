import { useState } from 'react';
import type { FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';
import { api, changePassword, getRoleHome, logout } from '../lib/api';

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
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4" style={{ fontFamily: '"Inter", sans-serif' }}>
      <section className="bg-white border border-[#E2E8F0] rounded-[32px] shadow-xl p-8 max-w-md w-full relative animate-in fade-in zoom-in-95 duration-200">
        <div className="w-14 h-14 bg-orange-50 text-[#F97316] rounded-2xl flex items-center justify-center mb-6 shadow-sm border border-orange-100/50">
          <LockKeyhole size={28} />
        </div>
        <h1 className="text-2xl font-black text-[#1E293B] tracking-tight">Change Your Password</h1>
        <p className="text-sm text-[#64748B] mt-1.5 mb-6">
          Choose a secure, strong password to protect your GasBook account connection.
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-[#475569] uppercase tracking-wide">Current / Temporary Password</span>
            <input 
              type="password" 
              value={currentPassword} 
              onChange={(e) => setCurrentPassword(e.target.value)} 
              autoComplete="current-password" 
              className="w-full px-4 py-3 border border-[#E2E8F0] focus:border-[#F97316] rounded-xl text-sm focus:outline-none transition-all duration-200 mt-1.5 focus:ring-2 focus:ring-orange-100" 
              required 
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-[#475569] uppercase tracking-wide">New Password</span>
            <input 
              type="password" 
              value={newPassword} 
              onChange={(e) => setNewPassword(e.target.value)} 
              autoComplete="new-password" 
              className="w-full px-4 py-3 border border-[#E2E8F0] focus:border-[#F97316] rounded-xl text-sm focus:outline-none transition-all duration-200 mt-1.5 focus:ring-2 focus:ring-orange-100" 
              required 
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-[#475569] uppercase tracking-wide">Confirm New Password</span>
            <input 
              type="password" 
              value={confirmPassword} 
              onChange={(e) => setConfirmPassword(e.target.value)} 
              autoComplete="new-password" 
              className="w-full px-4 py-3 border border-[#E2E8F0] focus:border-[#F97316] rounded-xl text-sm focus:outline-none transition-all duration-200 mt-1.5 focus:ring-2 focus:ring-orange-100" 
              required 
            />
          </label>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-650 text-xs font-semibold p-3.5 rounded-xl text-red-600 mt-2">
              ⚠️ {error}
            </div>
          )}

          <div className="pt-2 space-y-2">
            <button 
              className="w-full bg-[#F97316] hover:bg-orange-600 text-white font-extrabold py-3.5 rounded-2xl text-sm shadow-md shadow-orange-500/10 transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.01]" 
              type="submit" 
              disabled={saving}
            >
              {saving ? 'Updating…' : 'Update Password'}
            </button>
            <button 
              className="w-full bg-slate-50 hover:bg-slate-100 text-[#64748B] hover:text-[#1E293B] font-extrabold py-3.5 rounded-2xl text-sm transition-all duration-200 flex items-center justify-center gap-2" 
              type="button" 
              onClick={() => { logout(); window.location.href = '/login'; }}
            >
              Logout
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
