import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Copy, Pencil, Plus } from 'lucide-react';
import { api, extractApiError, LIMITS } from '../../lib/api';
import { ErrorState } from '../../components/AsyncState';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { IconButton } from '../../components/ui/IconButton';
import { Field, Input } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Switch } from '../../components/ui/Switch';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/toast-context';

type Tenant = {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  user_count: number;
  address: string;
  phone: string;
  email: string;
  tax_id: string;
};

type DetailsForm = Pick<Tenant, 'name' | 'address' | 'phone' | 'email' | 'tax_id'>;

type CreatedAdmin = { tenant: string; username: string; temporary_password: string };

const EMPTY_FORM = { name: '', slug: '', admin_full_name: '', admin_username: '', admin_phone: '', admin_email: '' };

export default function Tenants() {
  const toast = useToast();
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState<CreatedAdmin | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [details, setDetails] = useState<DetailsForm>({ name: '', address: '', phone: '', email: '', tax_id: '' });
  const [detailsError, setDetailsError] = useState('');

  const load = useCallback(() => api.get('/platform/tenants/').then(
    (r) => {
      setTenants(r.data);
      setLoadError('');
    },
    (err) => setLoadError(extractApiError(err, [], 'Could not load agencies.')),
  ), []);

  useEffect(() => { void load(); }, [load]);

  const update = (key: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const closeCreate = () => {
    setShowCreate(false);
    setForm(EMPTY_FORM);
    setFormError('');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const { data } = await api.post('/platform/tenants/', form);
      setCreated({ tenant: data.name, username: data.admin.username, temporary_password: data.admin.temporary_password });
      closeCreate();
      load();
    } catch (err) {
      setFormError(extractApiError(err, ['name', 'slug', 'admin_username', 'admin_phone', 'admin_email', 'admin_full_name'], 'Could not create the agency.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (tenant: Tenant, isActive: boolean) => {
    setTogglingId(tenant.id);
    try {
      const { data } = await api.patch(`/platform/tenants/${tenant.id}/`, { is_active: isActive });
      setTenants((list) => list?.map((t) => (t.id === data.id ? data : t)) ?? null);
      toast.show(`${data.name} is now ${data.is_active ? 'active' : 'suspended'}.`, { tone: data.is_active ? 'success' : 'warning' });
    } catch (err) {
      toast.show(extractApiError(err, [], 'Could not update the agency.'), { tone: 'danger' });
    } finally {
      setTogglingId(null);
    }
  };

  const openEdit = (tenant: Tenant) => {
    setEditing(tenant);
    setDetails({ name: tenant.name, address: tenant.address, phone: tenant.phone, email: tenant.email, tax_id: tenant.tax_id });
    setDetailsError('');
  };

  const updateDetail = (key: keyof DetailsForm) => (e: { target: { value: string } }) =>
    setDetails((d) => ({ ...d, [key]: e.target.value }));

  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setDetailsError('');
    try {
      const { data } = await api.patch(`/platform/tenants/${editing.id}/`, details);
      setTenants((list) => list?.map((t) => (t.id === data.id ? data : t)) ?? null);
      setEditing(null);
      toast.show(`${data.name} updated.`, { tone: 'success' });
    } catch (err) {
      setDetailsError(extractApiError(err, ['name', 'address', 'phone', 'email', 'tax_id'], 'Could not update the agency.'));
    } finally {
      setSaving(false);
    }
  };

  const copyCredentials = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`Username: ${created.username}\nTemporary password: ${created.temporary_password}`);
      toast.show('Login details copied.', { tone: 'success' });
    } catch {
      toast.show('Copy failed. Select the text and copy it manually.', { tone: 'warning' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Agencies"
        description="Each agency has its own staff, customers, stock, sales and reports. Nothing is shared between agencies."
        actions={<Button type="button" icon={<Plus size={16} />} onClick={() => setShowCreate(true)}>New agency</Button>}
      />

      {created && (
        <Alert
          tone="success"
          title={`${created.tenant} is ready`}
          className="ui-alert--block"
          actions={(
            <>
              <Button type="button" size="sm" variant="secondary" icon={<Copy size={14} />} onClick={copyCredentials}>Copy login details</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreated(null)}>Dismiss</Button>
            </>
          )}
        >
          First admin login: <strong>{created.username}</strong> / <strong>{created.temporary_password}</strong>.
          They will be asked to set a new password when they first sign in. This password is shown only once.
        </Alert>
      )}

      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : (
        <Card padding="none">
          <CardHeader title="All agencies" meta={tenants ? <Badge>{tenants.length} total</Badge> : undefined} />
          {tenants === null ? (
            <SkeletonRows rows={3} columns={4} />
          ) : tenants.length === 0 ? (
            <EmptyState icon={<Building2 size={24} />} title="No agencies yet" hint="Create the first agency to get started." />
          ) : (
            <TableWrap>
              <Table cards>
                <thead>
                  <tr>
                    <Th>Agency</Th>
                    <Th>Code</Th>
                    <Th align="right">Users</Th>
                    <Th>Created</Th>
                    <Th align="right">Active</Th>
                    <Th align="right"><span className="sr-only">Edit</span></Th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <Td label="Agency">
                        <strong>{t.name}</strong>
                        {!t.is_active && <> <Badge tone="warning">Suspended</Badge></>}
                      </Td>
                      <Td label="Code">{t.slug}</Td>
                      <Td label="Users" numeric>{t.user_count}</Td>
                      <Td label="Created">{new Date(t.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</Td>
                      <Td label="Active" align="right">
                        <Switch
                          compact
                          checked={t.is_active}
                          disabled={togglingId === t.id}
                          onChange={(checked) => toggleActive(t, checked)}
                          aria-label={`${t.is_active ? 'Suspend' : 'Activate'} ${t.name}`}
                        />
                      </Td>
                      <Td align="right">
                        <IconButton type="button" label={`Edit ${t.name}`} onClick={() => openEdit(t)}>
                          <Pencil size={16} />
                        </IconButton>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      )}

      <Modal
        open={showCreate}
        onClose={closeCreate}
        title="New agency"
        description="Creates the agency with a Shop and a Supplier location, and its first admin account."
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeCreate} disabled={saving}>Cancel</Button>
            <Button type="submit" form="tenant-create-form" loading={saving} disabled={saving}>Create agency</Button>
          </>
        )}
      >
        <form id="tenant-create-form" className="form-stack" onSubmit={submit}>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Agency name" required>
            <Input value={form.name} onChange={update('name')} maxLength={120} required autoFocus />
          </Field>
          <Field label="Code" hint="Short unique id, e.g. city-gas. Leave blank to generate one from the name.">
            <Input value={form.slug} onChange={update('slug')} maxLength={50} pattern="[a-z0-9-]*" />
          </Field>
          <h3>First admin</h3>
          <div className="grid-2">
            <Field label="Full name" required>
              <Input value={form.admin_full_name} onChange={update('admin_full_name')} maxLength={LIMITS.name} required />
            </Field>
            <Field label="Username" required>
              <Input value={form.admin_username} onChange={update('admin_username')} maxLength={LIMITS.username} required autoComplete="off" />
            </Field>
            <Field label="Phone" required>
              <Input value={form.admin_phone} onChange={update('admin_phone')} maxLength={LIMITS.phone} required inputMode="tel" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.admin_email} onChange={update('admin_email')} maxLength={LIMITS.email} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : 'Edit agency'}
        description="The name and details printed on this agency's customer receipts. Leave a field blank to omit it."
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
            <Button type="submit" form="tenant-edit-form" loading={saving} disabled={saving}>Save</Button>
          </>
        )}
      >
        <form id="tenant-edit-form" className="form-stack" onSubmit={saveDetails}>
          {detailsError && <Alert tone="danger">{detailsError}</Alert>}
          <Field label="Agency name" required>
            <Input value={details.name} onChange={updateDetail('name')} maxLength={120} required />
          </Field>
          <Field label="Address">
            <Input value={details.address} onChange={updateDetail('address')} maxLength={300} />
          </Field>
          <div className="grid-2">
            <Field label="Phone">
              <Input value={details.phone} onChange={updateDetail('phone')} maxLength={20} inputMode="tel" />
            </Field>
            <Field label="Email">
              <Input type="email" value={details.email} onChange={updateDetail('email')} maxLength={254} />
            </Field>
          </div>
          <Field label="GST / tax registration">
            <Input value={details.tax_id} onChange={updateDetail('tax_id')} maxLength={30} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
