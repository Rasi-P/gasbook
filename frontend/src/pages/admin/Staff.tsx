import { useEffect, useState } from 'react';
import { UserPlus, X, Check, Pencil, KeyRound, Trash2, Copy, Mail, Share2, UserX, UserCheck } from 'lucide-react';
import { api, extractApiError, getApiErrorCode, getApiStatus, LIMITS } from '../../lib/api';
import { ErrorState, LoadingState } from '../../components/AsyncState';

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
  staff_image_url?: string | null;
  is_active?: boolean;
};

type RowNotice = { id: number; text: string; tone: 'info' | 'error' | 'confirm' };

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
  const [availableRoles, setAvailableRoles] = useState<{code: string; name: string}[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const [fullNameValue, setFullNameValue] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [role, setRole] = useState('staff');
  const [staffImage, setStaffImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editIsStaff, setEditIsStaff] = useState(false);
  const [editStaffImageUrl, setEditStaffImageUrl] = useState<string | null>(null);
  const [editStaffImage, setEditStaffImage] = useState<File | null>(null);
  const [editRemoveStaffImage, setEditRemoveStaffImage] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [credUserId, setCredUserId] = useState<number | null>(null);
  const [credMsg, setCredMsg] = useState('');
  const [credSaving, setCredSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [rolesError, setRolesError] = useState('');
  const [rowNotice, setRowNotice] = useState<RowNotice | null>(null);

  function load() {
    return Promise.allSettled([
      api.get('/auth/users/'),
      api.get('/auth/roles/'),
    ]).then(([usersResult, rolesResult]) => {
      if (usersResult.status === 'fulfilled') {
        const rows = usersResult.value.data;
        setUsers(Array.isArray(rows) ? rows : (rows?.results ?? []));
        setLoadError('');
        setLoadStatus('ready');
      } else {
        setLoadError(extractApiError(usersResult.reason, [], 'Could not load users.'));
        setLoadStatus('error');
      }
      if (rolesResult.status === 'fulfilled') {
        const roles = rolesResult.value.data as { code: string; name: string }[];
        setAvailableRoles(roles);
        setRolesError('');
        if (roles.length > 0 && !role) setRole(roles[0].code);
      } else {
        setRolesError(extractApiError(rolesResult.reason, [], 'Could not load roles.'));
      }
    });
  }

  useEffect(() => { void load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const createdUsername = username.trim();
      const payload = new FormData();
      payload.append('username', createdUsername);
      payload.append('full_name', fullNameValue);
      payload.append('phone', phone);
      payload.append('email', email);
      payload.append('address', address);
      payload.append('role', role);
      if (role === 'staff' && staffImage) {
        payload.append('image', staffImage);
      }

      const { data } = await api.post('/auth/register/', payload);
      const tempPassword = (data as { temporary_password?: string }).temporary_password;

      setFullNameValue(''); setUsername(''); setPhone(''); setEmail(''); setAddress(''); setRole('staff'); setStaffImage(null);
      setShowAdd(false);
      await load();

      if (data.id) {
        setCredUserId(data.id);
        setCredMsg(tempPassword || 'Password securely generated.');
      }
    } catch (err: unknown) {
      setError(extractApiError(err, ['full_name', 'username', 'phone', 'email', 'address', 'role', 'image'], 'Failed to create user.'));
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
    setEditIsStaff(user.role === 'staff');
    setEditStaffImageUrl(user.staff_image_url || null);
    setEditStaffImage(null);
    setEditRemoveStaffImage(false);
    setEditError('');
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setEditSaving(true); setEditError('');
    try {
      const payload = new FormData();
      payload.append('full_name', editName.trim());
      payload.append('phone', editPhone.trim());
      payload.append('email', editEmail.trim());
      payload.append('address', editAddress.trim());
      if (editIsStaff && editStaffImage) {
        payload.append('image', editStaffImage);
      }
      // Removal applies to any user that has a staff image, not only role=staff.
      if (editRemoveStaffImage) {
        payload.append('remove_staff_image', 'true');
      }
      const { data } = await api.patch(`/auth/users/${editingId}/`, payload);
      const updated = data as Partial<StaffUser> | undefined;
      const imageStillPresent = Boolean(updated?.staff_image_url);
      setUsers((prev) => prev.map((u) => (u.id === editingId
        ? {
          ...u,
          ...(updated?.first_name !== undefined ? { first_name: updated.first_name } : {}),
          ...(updated?.last_name !== undefined ? { last_name: updated.last_name } : {}),
          ...(updated?.phone !== undefined ? { phone: updated.phone } : {}),
          ...(updated?.email !== undefined ? { email: updated.email } : {}),
          ...(updated?.address !== undefined ? { address: updated.address } : {}),
          staff_image_url: updated && 'staff_image_url' in updated ? (updated.staff_image_url ?? null) : u.staff_image_url,
        }
        : u)));
      setEditStaffImageUrl(updated && 'staff_image_url' in updated ? (updated.staff_image_url ?? null) : editStaffImageUrl);
      setEditStaffImage(null);
      if (editRemoveStaffImage && imageStillPresent) {
        setEditRemoveStaffImage(false);
        setEditError('The image was not removed. Please try again.');
        return;
      }
      setEditRemoveStaffImage(false);
      setEditingId(null);
      void load();
    } catch (err: unknown) {
      setEditError(extractApiError(err, ['full_name', 'name', 'phone', 'email', 'address', 'image'], 'Failed to save. Try again.'));
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
    } catch (err) {
      setCredMsg(extractApiError(err, [], 'Failed to reset password.'));
    } finally {
      setCredSaving(false);
    }
  }

  function applyUserUpdate(id: number, patch: Partial<StaffUser>) {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function deleteCredentials(user: StaffUser) {
    const ok = window.confirm(`Delete user ${fullName(user)}? Accounts with delivery or transaction history cannot be deleted and can only be deactivated.`);
    if (!ok) return;
    setDeletingId(user.id);
    setRowNotice(null);
    try {
      await api.delete(`/auth/users/${user.id}/`);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      const code = getApiErrorCode(err);
      const detail = extractApiError(err, [], 'Failed to delete user.');
      if (getApiStatus(err) === 409 && code === 'has_history') {
        const body = (err as { response?: { data?: { is_active?: boolean } } })?.response?.data;
        const alreadyInactive = body?.is_active === false || user.is_active === false;
        if (alreadyInactive) {
          setRowNotice({
            id: user.id,
            text: 'This user has delivery or transaction history and cannot be deleted. The account is already deactivated; history is preserved.',
            tone: 'info',
          });
        } else {
          setRowNotice({ id: user.id, text: detail, tone: 'confirm' });
        }
      } else {
        setRowNotice({ id: user.id, text: detail, tone: 'error' });
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function deactivateUser(user: StaffUser) {
    setDeletingId(user.id);
    try {
      const { data } = await api.post(`/auth/users/${user.id}/deactivate/`, {});
      const updated = (data as { user?: Partial<StaffUser> } | undefined)?.user;
      applyUserUpdate(user.id, { ...(updated ?? {}), is_active: false });
      setRowNotice({ id: user.id, text: (data as { detail?: string })?.detail || 'User deactivated. History is preserved.', tone: 'info' });
    } catch (err) {
      setRowNotice({ id: user.id, text: extractApiError(err, [], 'Failed to deactivate user.'), tone: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  async function reactivateUser(user: StaffUser) {
    setDeletingId(user.id);
    setRowNotice(null);
    try {
      const { data } = await api.post(`/auth/users/${user.id}/reactivate/`, {});
      const updated = (data as { user?: Partial<StaffUser> } | undefined)?.user;
      applyUserUpdate(user.id, { ...(updated ?? {}), is_active: true });
      setRowNotice({ id: user.id, text: (data as { detail?: string })?.detail || 'User reactivated.', tone: 'info' });
    } catch (err) {
      setRowNotice({ id: user.id, text: extractApiError(err, [], 'Failed to reactivate user.'), tone: 'error' });
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
          disabled={Boolean(rolesError) && availableRoles.length === 0}
          title={rolesError && availableRoles.length === 0 ? 'Roles could not be loaded' : undefined}
          onClick={() => { setShowAdd((v) => !v); setError(''); }}>
          {showAdd ? <X size={18} /> : <UserPlus size={18} />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {rolesError && (
        <p className="form-error" role="alert" style={{ marginBottom: '12px' }}>
          {rolesError}{' '}
          <button type="button" className="async-inline-retry" onClick={() => void load()}>Retry</button>
        </p>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="card form-stack" style={{ marginBottom: '16px' }}>
          <h2>New User</h2>
          <div className="grid-2">
            <label>
              <span>Full Name</span>
              <input value={fullNameValue} onChange={(e) => setFullNameValue(e.target.value)} placeholder="e.g. Ravi Kumar" maxLength={LIMITS.name} required />
            </label>
            <label>
              <span>Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ravi" maxLength={LIMITS.username} autoComplete="off" required />
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Password</span>
              <input value="Auto-generated on create" disabled />
            </label>
            <label>
              <span>Role</span>
              <select value={role} onChange={(e) => {
                const nextRole = e.target.value;
                setRole(nextRole);
                if (nextRole !== 'staff') {
                  setStaffImage(null);
                }
              }}>
                {availableRoles.map(r => (
                  <option key={r.code} value={r.code}>{r.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label>
              <span>Phone *</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} pattern="[0-9]*" inputMode="numeric" maxLength={LIMITS.phone} title="Only digits allowed" placeholder="Required" required />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" maxLength={LIMITS.email} />
            </label>
          </div>
          <label>
            <span>Address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
          </label>
          {role === 'staff' && (
            <label>
              <span>Staff Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setStaffImage(e.target.files?.[0] || null)}
              />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            <Check size={18} /> {saving ? 'Creating...' : 'Create User'}
          </button>
        </form>
      )}

      {/* No success banner here, it is now shown below the specific user card */}

      {loadStatus === 'error' && <ErrorState message={loadError} onRetry={() => { setLoadStatus('loading'); void load(); }} />}

      {loadStatus !== 'error' && (
      <div className="card" style={{ padding: 0 }}>
        {loadStatus === 'loading' && <LoadingState label="Loading users…" />}
        {loadStatus === 'ready' && users.length === 0 && (
          <p style={{ textAlign: 'center', padding: '24px' }}>No users found.</p>
        )}
        {users.map((u) => {
          const protectedAdmin = isProtectedAdmin(u);
          const inactive = u.is_active === false;
          const busy = deletingId === u.id;
          return (
            <div key={u.id}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', borderBottom: editingId === u.id ? 'none' : '1px solid var(--border)', gap: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={{ flexShrink: 0 }}>
                    {u.staff_image_url ? (
                      <img
                        src={u.staff_image_url}
                        alt={fullName(u)}
                        style={{ width: '44px', height: '44px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '50%',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--surface-muted)',
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {fullName(u).charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '1rem', opacity: inactive ? 0.6 : 1 }}>{fullName(u)}</strong>
                        {inactive && <span className="badge badge-danger">INACTIVE</span>}
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
                  {inactive ? (
                    <button
                      className="icon-button"
                      title="Reactivate"
                      aria-label="Reactivate"
                      onClick={() => reactivateUser(u)}
                      disabled={busy}
                      style={{ color: 'var(--success)', opacity: busy ? 0.3 : 1 }}
                    >
                      <UserCheck size={16} />
                    </button>
                  ) : (
                    <button
                      className="icon-button"
                      title="Deactivate"
                      aria-label="Deactivate"
                      onClick={() => {
                        if (window.confirm(`Deactivate ${fullName(u)}? They will no longer be able to sign in. History is preserved.`)) void deactivateUser(u);
                      }}
                      disabled={busy || protectedAdmin}
                      style={{ color: 'var(--warning)', opacity: (busy || protectedAdmin) ? 0.3 : 1 }}
                    >
                      <UserX size={16} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    title="Delete"
                    aria-label="Delete"
                    onClick={() => deleteCredentials(u)}
                    disabled={busy || protectedAdmin}
                    style={{ 
                      color: 'var(--danger)',
                      opacity: (busy || protectedAdmin) ? 0.3 : 1
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {rowNotice?.id === u.id && (
                <div
                  role={rowNotice.tone === 'error' ? 'alert' : 'status'}
                  className={rowNotice.tone === 'error' ? 'form-error' : 'form-note'}
                  style={{ margin: '0 18px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}
                >
                  <span>{rowNotice.text}</span>
                  <span style={{ display: 'inline-flex', gap: '8px' }}>
                    {rowNotice.tone === 'confirm' && !inactive && (
                      <button
                        type="button"
                        className="btn btn-compact"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Deactivate ${fullName(u)} instead? They will no longer be able to sign in. History is preserved.`)) void deactivateUser(u);
                        }}
                      >
                        {busy ? 'Deactivating…' : 'Deactivate instead'}
                      </button>
                    )}
                    <button type="button" className="btn btn-compact" onClick={() => setRowNotice(null)}>Dismiss</button>
                  </span>
                </div>
              )}

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
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={LIMITS.name} required autoFocus />
                    </label>
                    <label>
                      <span>Phone *</span>
                      <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} pattern="[0-9]*" inputMode="numeric" maxLength={LIMITS.phone} title="Only digits allowed" required />
                    </label>
                  </div>
                  <div className="grid-2">
                    <label>
                      <span>Email</span>
                      <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} maxLength={LIMITS.email} />
                    </label>
                    <label>
                      <span>Address</span>
                      <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                    </label>
                  </div>
                  {(editIsStaff || editStaffImageUrl) && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <div>
                          {editStaffImageUrl && !editRemoveStaffImage ? (
                            <img
                              src={editStaffImageUrl}
                              alt={editName || 'Staff image'}
                              style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '56px',
                                height: '56px',
                                borderRadius: '50%',
                                border: '1px solid var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'var(--surface-muted)',
                                color: 'var(--text-muted)',
                                fontWeight: 700,
                              }}
                            >
                              {(editName.trim().charAt(0) || 'S').toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                          {editStaffImage ? `Selected: ${editStaffImage.name}` : editStaffImageUrl && !editRemoveStaffImage ? 'Current staff image' : 'No staff image'}
                        </div>
                      </div>
                      {editIsStaff && (
                      <label>
                        <span>Staff Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setEditStaffImage(file);
                            if (file) {
                              setEditRemoveStaffImage(false);
                            }
                          }}
                        />
                      </label>
                      )}
                      {(editStaffImageUrl || editStaffImage) && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="checkbox"
                            checked={editRemoveStaffImage}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setEditRemoveStaffImage(checked);
                              if (checked) {
                                setEditStaffImage(null);
                              }
                            }}
                          />
                          <span>Remove current image</span>
                        </label>
                      )}
                    </>
                  )}
                  {editError && <p className="form-error" role="alert">{editError}</p>}
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
      )}
    </div>
  );
}
