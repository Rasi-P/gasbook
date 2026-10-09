import { useEffect, useState } from 'react';
import { UserPlus, X, Check, Pencil, KeyRound, Trash2, Copy, Mail, Share2, UserX, UserCheck, Users, ChevronRight } from 'lucide-react';
import { api, extractApiError, getApiErrorCode, getApiStatus, LIMITS } from '../../lib/api';
import { ErrorState } from '../../components/AsyncState';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input, Select } from '../../components/ui/Field';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows } from '../../components/ui/Skeleton';
import StaffHistory from './StaffHistory';

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
  const [historyUser, setHistoryUser] = useState<StaffUser | null>(null);

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

  function openHistory(user: StaffUser) {
    setEditingId(null);
    setCredUserId(null);
    setCredMsg('');
    setHistoryUser(user);
  }

  if (historyUser) {
    return <StaffHistory staff={historyUser} onBack={() => setHistoryUser(null)} />;
  }

  return (
    <div>
      <PageHeader
        title="Staff & Users"
        description="Accounts are created with a one-time temporary password and can be reset securely."
        actions={(
          <Button
            type="button"
            variant={showAdd ? 'secondary' : 'primary'}
            icon={showAdd ? <X /> : <UserPlus />}
            disabled={Boolean(rolesError) && availableRoles.length === 0}
            title={rolesError && availableRoles.length === 0 ? 'Roles could not be loaded' : undefined}
            onClick={() => { setShowAdd((v) => !v); setError(''); }}
          >
            {showAdd ? 'Cancel' : 'Add'}
          </Button>
        )}
      />

      {rolesError && (
        <Alert
          tone="danger"
          role="alert"
          className="ui-alert--block-sm"
          actions={<Button type="button" variant="link" size="sm" onClick={() => void load()}>Retry</Button>}
        >
          {rolesError}
        </Alert>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="ui-card ui-card--pad-md form-stack staff-add">
          <h2 className="ui-card__title">New User</h2>
          <div className="grid-2">
            <Field label="Full Name">
              <Input value={fullNameValue} onChange={(e) => setFullNameValue(e.target.value)} placeholder="e.g. Ravi Kumar" maxLength={LIMITS.name} required />
            </Field>
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. ravi" maxLength={LIMITS.username} autoComplete="off" required />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Password">
              <Input value="Auto-generated on create" disabled />
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => {
                const nextRole = e.target.value;
                setRole(nextRole);
                if (nextRole !== 'staff') {
                  setStaffImage(null);
                }
              }}>
                {availableRoles.map(r => (
                  <option key={r.code} value={r.code}>{r.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Phone *">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} pattern="[0-9]*" inputMode="numeric" maxLength={LIMITS.phone} title="Only digits allowed" placeholder="Required" required />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" maxLength={LIMITS.email} />
            </Field>
          </div>
          <Field label="Address">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
          </Field>
          {role === 'staff' && (
            <Field label="Staff Image">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => setStaffImage(e.target.files?.[0] || null)}
              />
            </Field>
          )}
          {error && <Alert tone="danger" role="alert">{error}</Alert>}
          <div className="form-actions-row">
            <Button type="submit" disabled={saving} icon={<Check />}>
              {saving ? 'Creating...' : 'Create User'}
            </Button>
          </div>
        </form>
      )}

      {/* No success banner here, it is now shown below the specific user card */}

      {loadStatus === 'error' && <ErrorState message={loadError} onRetry={() => { setLoadStatus('loading'); void load(); }} />}

      {loadStatus !== 'error' && (
      <Card padding="none" className="ui-list">
        {loadStatus === 'loading' && (
          <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={3} label="Loading users…" /></div>
        )}
        {loadStatus === 'ready' && users.length === 0 && (
          <EmptyState icon={<Users size={24} />} title="No users found." />
        )}
        {users.map((u) => {
          const protectedAdmin = isProtectedAdmin(u);
          const inactive = u.is_active === false;
          const busy = deletingId === u.id;
          return (
            <div key={u.id}>
              <div className={`ui-list-row${inactive ? ' ui-list-row--muted' : ''}`}>
                <div className="ui-list-row__lead">
                  {u.staff_image_url ? (
                    <img className="staff-avatar" src={u.staff_image_url} alt={fullName(u)} />
                  ) : (
                    <span className="staff-avatar staff-avatar--initial" aria-hidden="true">
                      {fullName(u).charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="ui-list-row__main">
                  <div className="ui-list-row__title">
                    <span className="ui-list-row__name">{fullName(u)}</span>
                    {inactive && <Badge variant="outline" size="sm">INACTIVE</Badge>}
                    <Badge variant="outline" size="sm" tone={u.role === 'admin' ? 'primary' : 'neutral'} className="staff-role">
                      {u.role.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="ui-list-row__meta">
                    <span>{u.username}</span>
                    {u.phone && <span>{u.phone}</span>}
                    {u.email && <span>{u.email}</span>}
                    {u.address && <span>{u.address}</span>}
                  </div>
                </div>
                <div className="ui-list-row__actions staff-actions">
                  <IconButton
                    label="Edit"
                    active={editingId === u.id}
                    onClick={() => editingId === u.id ? setEditingId(null) : startEdit(u)}
                  >
                    {editingId === u.id ? <X size={16} /> : <Pencil size={16} />}
                  </IconButton>
                  <IconButton
                    label="Password"
                    active={credUserId === u.id}
                    onClick={() => {
                      if (protectedAdmin) return;
                      setEditingId(null);
                      setCredUserId(credUserId === u.id ? null : u.id); setCredMsg('');
                    }}
                    disabled={protectedAdmin}
                  >
                    <KeyRound size={16} />
                  </IconButton>
                  {inactive ? (
                    <IconButton
                      label="Reactivate"
                      tone="primary"
                      onClick={() => reactivateUser(u)}
                      disabled={busy}
                    >
                      <UserCheck size={16} />
                    </IconButton>
                  ) : (
                    <IconButton
                      label="Deactivate"
                      tone="danger"
                      onClick={() => {
                        if (window.confirm(`Deactivate ${fullName(u)}? They will no longer be able to sign in. History is preserved.`)) void deactivateUser(u);
                      }}
                      disabled={busy || protectedAdmin}
                    >
                      <UserX size={16} />
                    </IconButton>
                  )}
                  <IconButton
                    label="Delete"
                    tone="danger"
                    onClick={() => deleteCredentials(u)}
                    disabled={busy || protectedAdmin}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                  {u.role === 'staff' ? (
                    <IconButton label="Delivery History" variant="outline" onClick={() => openHistory(u)}>
                      <ChevronRight size={18} />
                    </IconButton>
                  ) : (
                    <span className="staff-actions__spacer" aria-hidden="true" />
                  )}
                </div>
              </div>

              {rowNotice?.id === u.id && (
                <div className="ui-list-notice">
                  <Alert
                    compact
                    tone={rowNotice.tone === 'error' ? 'danger' : rowNotice.tone === 'confirm' ? 'warning' : 'info'}
                    role={rowNotice.tone === 'error' ? 'alert' : 'status'}
                    actions={(
                      <>
                        {rowNotice.tone === 'confirm' && !inactive && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Deactivate ${fullName(u)} instead? They will no longer be able to sign in. History is preserved.`)) void deactivateUser(u);
                            }}
                          >
                            {busy ? 'Deactivating…' : 'Deactivate instead'}
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRowNotice(null)}>Dismiss</Button>
                      </>
                    )}
                  >
                    {rowNotice.text}
                  </Alert>
                </div>
              )}

              {credUserId === u.id && (
                <div className="ui-list-panel cred-panel">
                  <div className="cred-panel__title">
                    <KeyRound size={16} />
                    <span>Login Credentials</span>
                  </div>

                  <div className="cred-panel__body">
                    {!credMsg ? (
                      <Button
                        type="button"
                        size="sm"
                        icon={<Check />}
                        onClick={() => resetPassword(u.id)}
                        disabled={credSaving}
                      >
                        {credSaving ? 'Generating...' : 'Generate Temporary Password'}
                      </Button>
                    ) : (
                      <div className="cred-panel__values">
                        <div className="cred-panel__pair">
                          <span className="cred-panel__label">USERNAME</span>
                          <span className="cred-panel__value">{u.username}</span>
                        </div>

                        <div className="cred-panel__pair">
                          <span className="cred-panel__label">TEMPORARY PASSWORD</span>
                          <span className="cred-panel__value cred-panel__value--mono">{credMsg}</span>

                          <div className="cred-panel__tools">
                            <IconButton
                              size="sm"
                              variant="outline"
                              label="Copy Details"
                              onClick={() => {
                                const msg = `Hello ${u.first_name},\n\nHere are your GasBook login details:\n\nUsername: ${u.username}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
                                navigator.clipboard.writeText(msg);
                                alert('Credentials copied to clipboard!');
                              }}
                            >
                              <Copy size={14} />
                            </IconButton>
                            <a
                              href={u.email ? `mailto:${u.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${u.first_name},\n\nHere are your GasBook login details:\n\nUsername: ${u.username}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                              className={`ui-iconbtn ui-iconbtn--outline ui-iconbtn--sm${u.email ? '' : ' cred-panel__link--disabled'}`}
                              title={u.email ? "Email Details" : "No email saved"}
                              aria-label={u.email ? "Email Details" : "No email saved"}
                              onClick={(e) => {
                                if (!u.email) {
                                  e.preventDefault();
                                  alert('No email address saved for this staff member.');
                                }
                              }}
                            >
                              <Mail size={14} />
                            </a>
                            <IconButton
                              type="button"
                              size="sm"
                              variant="outline"
                              label="Share Details"
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
                            </IconButton>
                          </div>
                        </div>
                      </div>
                    )}

                    <IconButton
                      size="sm"
                      variant="outline"
                      label="Close"
                      onClick={() => { setCredUserId(null); setCredMsg(''); }}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                </div>
              )}

              {editingId === u.id && (
                <form onSubmit={handleEdit} className="ui-list-panel form-stack">
                  <h3>Edit User</h3>
                  <div className="grid-2">
                    <Field label="Name *">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={LIMITS.name} required autoFocus />
                    </Field>
                    <Field label="Phone *">
                      <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} pattern="[0-9]*" inputMode="numeric" maxLength={LIMITS.phone} title="Only digits allowed" required />
                    </Field>
                  </div>
                  <div className="grid-2">
                    <Field label="Email">
                      <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} maxLength={LIMITS.email} />
                    </Field>
                    <Field label="Address">
                      <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                    </Field>
                  </div>
                  {(editIsStaff || editStaffImageUrl) && (
                    <>
                      <div className="staff-image-row">
                        {editStaffImageUrl && !editRemoveStaffImage ? (
                          <img className="staff-avatar staff-avatar--lg" src={editStaffImageUrl} alt={editName || 'Staff image'} />
                        ) : (
                          <span className="staff-avatar staff-avatar--lg staff-avatar--initial" aria-hidden="true">
                            {(editName.trim().charAt(0) || 'S').toUpperCase()}
                          </span>
                        )}
                        <span className="ui-field__hint">
                          {editStaffImage ? `Selected: ${editStaffImage.name}` : editStaffImageUrl && !editRemoveStaffImage ? 'Current staff image' : 'No staff image'}
                        </span>
                      </div>
                      {editIsStaff && (
                      <Field label="Staff Image">
                        <Input
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
                      </Field>
                      )}
                      {(editStaffImageUrl || editStaffImage) && (
                        <label className="staff-check">
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
                  {editError && <Alert tone="danger" role="alert">{editError}</Alert>}
                  <div className="form-actions-row">
                    <Button type="button" variant="secondary" onClick={() => setEditingId(null)} disabled={editSaving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={editSaving} icon={<Check />}>
                      {editSaving ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </Card>
      )}
    </div>
  );
}
