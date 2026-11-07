import { ImageUpload } from '../../components/ImageUpload';
import { CylinderImage } from '../../components/CylinderImage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { api, extractApiError } from '../../lib/api';
import { cylinderWeightKg, defaultCylinderImage, type CylinderImageSubject } from '../../lib/cylinderImages';
import {
  STATUS_FILTER_OPTIONS, apiFieldErrors, chargePerCylinder, cylinderDeactivationWarnings, deleteBlockers, emptyCylinderForm, fetchAllCylinderTypes, formFromCylinder,
  formatRupees, matchesSearch, matchesStatus, notifyCatalogChanged, validateCylinderForm,
  type CylinderForm, type CylinderTypeRecord, type CylinderUsage, type FieldErrors, type StatusFilter,
} from '../../lib/catalog';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { ChoiceChips } from '../ui/ChoiceChips';
import { EmptyState } from '../ui/EmptyState';
import { Field, Input } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { SearchInput } from '../ui/SearchInput';
import { SkeletonRows } from '../ui/Skeleton';
import { Switch } from '../ui/Switch';
import { Table, TableWrap, Td, Th } from '../ui/Table';
import { useToast } from '../ui/toast-context';
import { ActiveBadge, DeactivateDialog, DeleteDialog } from './shared';

const FIELD_NAMES = ['name', 'weight', 'refill_rate', 'deposit_amount', 'low_stock_threshold', 'image'] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** What every app shows for this type: the uploaded picture, else the default for its weight, else a generic cylinder. */
export function CylinderThumb({ cylinder, name }: { cylinder: CylinderImageSubject; name: string }) {
  return <CylinderImage className="catalog-thumb" cylinder={cylinder} alt={`${name} cylinder`} loading="lazy" />;
}

/** Says which picture customers see while no custom one is set. */
function defaultPictureNote(weight: string) {
  const kg = cylinderWeightKg(weight);
  if (kg === null) return 'Enter the weight to see its standard picture.';
  return defaultCylinderImage(kg, api.defaults.baseURL ?? '') ? `Showing the standard ${kg} kg picture.` : `No standard picture for ${kg} kg; a generic cylinder is shown.`;
}

export function CylinderTypeTable({
  rows, busyId, onEdit, onToggle, onDelete,
}: {
  rows: CylinderTypeRecord[];
  busyId: number | null;
  onEdit: (row: CylinderTypeRecord) => void;
  onToggle: (row: CylinderTypeRecord, active: boolean) => void;
  onDelete?: (row: CylinderTypeRecord) => void;
}) {
  return (
    <TableWrap>
      <Table cards className="catalog-table catalog-table--types" aria-label="Cylinder types">
        <thead>
          <tr>
            <Th>Cylinder type</Th>
            <Th align="right">Refill price</Th>
            <Th align="right">New-cylinder deposit</Th>
            <Th align="right">New connection</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-inactive={row.is_active ? undefined : 'true'}>
              <Td className="catalog-td-name">
                <div className="catalog-name">
                  <CylinderThumb cylinder={row} name={row.name} />
                  <span>
                    <strong>{row.name}</strong>
                    <span className="ui-cell-sub">{Number(row.weight)} kg</span>
                  </span>
                </div>
              </Td>
              <Td label="Refill" numeric className="catalog-td-price">{formatRupees(row.refill_rate)}</Td>
              <Td label="Deposit" numeric className="catalog-td-price">{formatRupees(row.deposit_amount)}</Td>
              <Td label="New connection" numeric className="catalog-td-price">{formatRupees(chargePerCylinder(row.refill_rate, row.deposit_amount)?.newConnection ?? 0)}</Td>
              <Td className="catalog-td-status">
                <div className="catalog-status">
                  <ActiveBadge active={row.is_active} />
                  <Switch
                    compact
                    checked={row.is_active}
                    disabled={busyId === row.id}
                    onChange={(checked) => onToggle(row, checked)}
                    aria-label={`${row.name} is ${row.is_active ? 'active' : 'inactive'}`}
                  />
                </div>
              </Td>
              <Td align="right" className="catalog-td-actions">
                <div className="catalog-row-actions">
                  <Button type="button" size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>Edit</Button>
                  {onDelete && (
                    <Button type="button" size="sm" variant="ghost" icon={<Trash2 size={14} />} disabled={busyId === row.id} onClick={() => onDelete(row)} aria-label={`Delete ${row.name}`}>Delete</Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** The pricing rule, shown live as the two amounts are typed. */
export function PriceSummary({ refill, deposit }: { refill: string; deposit: string }) {
  const charge = chargePerCylinder(refill, deposit);
  // A refill needs only the refill price, so it shows as soon as that is valid; a new connection needs both.
  const refillOnly = refill.trim() !== '' && Number.isFinite(Number(refill)) ? Number(refill) : null;
  return (
    <div className="catalog-span-2 catalog-price-summary" role="status" aria-label="What a customer pays per cylinder">
      <span><strong>Refill</strong> {refillOnly !== null ? formatRupees(refillOnly) : '—'}</span>
      <span aria-hidden="true">·</span>
      <span><strong>New connection</strong> {charge ? formatRupees(charge.newConnection) : '—'} <small>(refill + deposit)</small></span>
    </div>
  );
}

export function CylinderTypeFormFields({
  form, errors, preview, hasStoredImage, removeImage, disabled, onChange, onPickImage, onRemoveImage,
}: {
  form: CylinderForm;
  errors: FieldErrors<(typeof FIELD_NAMES)[number]>;
  preview: string | null;
  hasStoredImage: boolean;
  removeImage: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<CylinderForm>) => void;
  onPickImage: (file: File | null) => void;
  onRemoveImage: () => void;
}) {
  const money = (field: 'refill_rate' | 'deposit_amount', label: string, hint: string) => (
    <Field label={label} hint={hint} error={errors[field]} required>
      <Input inputMode="decimal" value={form[field]} invalid={Boolean(errors[field])} disabled={disabled}
        onChange={(e) => onChange({ [field]: e.target.value })} placeholder="0.00" />
    </Field>
  );
  return (
    <div className="catalog-form-grid">
      <Field label="Name" error={errors.name} required className="catalog-span-2">
        <Input value={form.name} maxLength={80} invalid={Boolean(errors.name)} disabled={disabled} autoFocus
          onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. 19kg" />
      </Field>
      <Field label="Weight (kg)" error={errors.weight} required>
        <Input inputMode="decimal" value={form.weight} invalid={Boolean(errors.weight)} disabled={disabled}
          onChange={(e) => onChange({ weight: e.target.value })} placeholder="19" />
      </Field>
      {money('refill_rate', 'Refill price (₹)', 'Charged on every refill, and again on every new connection.')}
      {money('deposit_amount', 'New-cylinder deposit (₹)', 'Added only on a new connection. Never charged on a refill.')}
      <PriceSummary refill={form.refill_rate} deposit={form.deposit_amount} />
      <Field label="Low-stock alert at" error={errors.low_stock_threshold} hint="Warn when filled cylinders drop to this number.">
        <Input inputMode="numeric" value={form.low_stock_threshold} invalid={Boolean(errors.low_stock_threshold)} disabled={disabled}
          onChange={(e) => onChange({ low_stock_threshold: e.target.value })} />
      </Field>
      <Field as="div" label="Picture" error={errors.image} hint="JPG, PNG or WebP · up to 5 MB. Optional: without one, the standard picture for the weight is used." className="catalog-span-2">
        <div className="catalog-image-row">
          <CylinderThumb cylinder={{ image: preview, weight: form.weight, name: form.name }} name={form.name || 'New'} />
          <div className="catalog-image-actions">
            <label className="ui-btn ui-btn--secondary ui-btn--sm catalog-file">
              <Upload size={14} aria-hidden="true" />
              <span>{preview ? 'Change picture' : 'Choose picture'}</span>
              <ImageUpload type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
                onChange={(e) => { onPickImage(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            {(preview || (hasStoredImage && !removeImage)) && (
              <Button type="button" size="sm" variant="ghost" icon={<X size={14} />} onClick={onRemoveImage} disabled={disabled}>Remove picture</Button>
            )}
            {!preview && <span className="ui-cell-sub catalog-image-note" role="status">{defaultPictureNote(form.weight)}</span>}
          </div>
        </div>
      </Field>
      <div className="catalog-span-2">
        <Switch checked={form.is_active} disabled={disabled} onChange={(checked) => onChange({ is_active: checked })}
          label={form.is_active ? 'Active: can be booked and sold' : 'Inactive: hidden from new bookings, sales and stock loads'} />
      </div>
    </div>
  );
}

type Pending = { id: number | null; formData: FormData; usage: CylinderUsage; name: string } | null;
type PendingDelete = { row: CylinderTypeRecord; blockers: { code: string; detail: string }[] } | null;

export default function CylinderTypesPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<CylinderTypeRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const [editing, setEditing] = useState<CylinderTypeRecord | 'new' | null>(null);
  const [form, setForm] = useState<CylinderForm>(emptyCylinderForm);
  const [errors, setErrors] = useState<FieldErrors<(typeof FIELD_NAMES)[number]>>({});
  const [formError, setFormError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    return fetchAllCylinderTypes()
      .then((data) => { setRows(data); setLoadError(''); setStatus('ready'); })
      .catch((err) => { setLoadError(extractApiError(err, [], 'Could not load cylinder types.')); setStatus('error'); });
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Preview of the chosen file (an object URL, released when it changes), else the stored picture unless it is being removed.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const storedImage = editing && editing !== 'new' ? editing.image : null;
  const preview = fileUrl ?? (removeImage ? null : storedImage);

  const visible = useMemo(
    () => rows.filter((r) => matchesSearch(`${r.name} ${r.weight}`, search) && matchesStatus(r.is_active, filter)),
    [rows, search, filter],
  );

  function openForm(target: CylinderTypeRecord | 'new') {
    setEditing(target);
    setForm(target === 'new' ? emptyCylinderForm : formFromCylinder(target));
    setFile(null);
    setRemoveImage(false);
    setErrors({});
    setFormError('');
  }
  const closeForm = () => { if (!saving) setEditing(null); };

  // An error goes away as soon as its field is edited; the banner goes once none are left.
  function clearErrors(fields: string[]) {
    const next = { ...errors };
    for (const field of fields) delete next[field as keyof typeof next];
    setErrors(next);
    if (!Object.values(next).some(Boolean)) setFormError('');
  }

  function pickImage(next: File | null) {
    if (!next) return;
    if (!/^image\/(png|jpeg|webp)$/.test(next.type)) { setErrors((e) => ({ ...e, image: 'Choose a JPG, PNG or WebP picture.' })); return; }
    if (next.size > MAX_IMAGE_BYTES) { setErrors((e) => ({ ...e, image: 'That picture is over 5 MB.' })); return; }
    setErrors((e) => ({ ...e, image: undefined }));
    setRemoveImage(false);
    setFile(next);
  }
  function dropImage() {
    setFile(null);
    setRemoveImage(true);
  }

  function buildBody(): FormData {
    const body = new FormData();
    body.append('name', form.name.trim().replace(/\s+/g, ' '));
    body.append('weight', form.weight.trim());
    body.append('refill_rate', form.refill_rate.trim());
    body.append('deposit_amount', form.deposit_amount.trim());
    body.append('low_stock_threshold', form.low_stock_threshold.trim());
    body.append('is_active', String(form.is_active));
    if (file) body.append('image', file);
    else if (removeImage) body.append('remove_image', 'true');
    return body;
  }

  async function send(id: number | null, body: FormData | { is_active: boolean }) {
    const { data } = await (id === null ? api.post('/cylinder-types/', body) : api.patch(`/cylinder-types/${id}/`, body));
    return data as CylinderTypeRecord;
  }

  async function finishSave(id: number | null, body: FormData, message?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFormError('');
    try {
      const saved = await send(id, body);
      toast.show(message ?? (id === null ? `${saved.name} added.` : `${saved.name} saved.`), { tone: 'success' });
      setEditing(null);
      setPending(null);
      notifyCatalogChanged();
      await load();
    } catch (err) {
      setPending(null);
      const fieldErrors = apiFieldErrors(err, FIELD_NAMES);
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length ? 'Fix the highlighted fields and try again.' : extractApiError(err, [], 'Could not save the cylinder type.'));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateCylinderForm(form);
    setErrors(found);
    if (Object.keys(found).length) { setFormError('Fix the highlighted fields and try again.'); return; }
    const body = buildBody();
    const id = editing && editing !== 'new' ? editing.id : null;
    // Switching an active type off from the form asks first, like the switch in the list.
    if (editing && editing !== 'new' && editing.is_active && !form.is_active) {
      try {
        const { data } = await api.get<CylinderUsage>(`/cylinder-types/${id}/usage/`);
        setPending({ id, formData: body, usage: data, name: editing.name });
      } catch (err) {
        setFormError(extractApiError(err, [], 'Could not check what uses this cylinder type.'));
      }
      return;
    }
    await finishSave(id, body);
  }

  async function onToggle(row: CylinderTypeRecord, active: boolean) {
    setListError('');
    if (active) {
      setBusyId(row.id);
      try {
        await send(row.id, { is_active: true });
        toast.show(`${row.name} is active again.`, { tone: 'success' });
        notifyCatalogChanged();
        await load();
      } catch (err) {
        setListError(extractApiError(err, [], 'Could not activate the cylinder type.'));
      } finally { setBusyId(null); }
      return;
    }
    setBusyId(row.id);
    try {
      const { data } = await api.get<CylinderUsage>(`/cylinder-types/${row.id}/usage/`);
      const body = new FormData();
      body.append('is_active', 'false');
      setPending({ id: row.id, formData: body, usage: data, name: row.name });
    } catch (err) {
      setListError(extractApiError(err, [], 'Could not check what uses this cylinder type.'));
    } finally { setBusyId(null); }
  }

  async function askDelete(row: CylinderTypeRecord) {
    setListError('');
    setBusyId(row.id);
    try {
      const { data } = await api.get<CylinderUsage>(`/cylinder-types/${row.id}/usage/`);
      setPendingDelete({ row, blockers: deleteBlockers(data) });
    } catch (err) {
      setListError(extractApiError(err, [], 'Could not check what uses this cylinder type.'));
    } finally { setBusyId(null); }
  }

  async function confirmDelete() {
    if (!pendingDelete || inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      await api.delete(`/cylinder-types/${pendingDelete.row.id}/`);
      toast.show(`${pendingDelete.row.name} deleted.`, { tone: 'success' });
      setPendingDelete(null);
      notifyCatalogChanged();
      await load();
    } catch (err) {
      // The server re-checks under lock; if something appeared meanwhile, show it instead of failing silently.
      const blockers = (err as { response?: { data?: { blockers?: { code: string; detail: string }[] } } })?.response?.data?.blockers;
      if (blockers?.length) setPendingDelete({ row: pendingDelete.row, blockers });
      else { setPendingDelete(null); setListError(extractApiError(err, [], 'Could not delete the cylinder type.')); }
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  async function confirmDeactivate() {
    if (!pending) return;
    await finishSave(pending.id, pending.formData, editing === null ? `${pending.name} is now inactive.` : undefined);
  }

  return (
    <section className="catalog-panel" aria-labelledby="cylinder-types-title">
      <div className="catalog-toolbar">
        <h2 id="cylinder-types-title">Cylinder types</h2>
        <Button type="button" icon={<Plus size={16} />} aria-label="Add cylinder type" onClick={() => openForm('new')}>Add <span className="catalog-btn-long">cylinder </span>type</Button>
        <p>A refill costs the refill price. A new connection costs the refill price plus the new-cylinder deposit. Changing a price affects new transactions only; past ones keep what was charged.</p>
      </div>

      <div className="catalog-filters">
        <SearchInput placeholder="Search by name or weight" aria-label="Search cylinder types" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ChoiceChips ariaLabel="Filter by status" options={STATUS_FILTER_OPTIONS} value={filter} onChange={setFilter} size="sm" />
      </div>

      {listError && <Alert tone="danger">{listError}</Alert>}
      {status === 'loading' && <SkeletonRows rows={4} columns={5} label="Loading cylinder types" />}
      {status === 'error' && (
        <Alert tone="danger" actions={<Button type="button" size="sm" variant="secondary" onClick={() => { setStatus('loading'); void load(); }}>Retry</Button>}>{loadError}</Alert>
      )}
      {status === 'ready' && rows.length === 0 && (
        <EmptyState title="No cylinder types yet" hint="Add the sizes you sell to start taking bookings and sales." action={<Button type="button" onClick={() => openForm('new')}>Add cylinder type</Button>} />
      )}
      {status === 'ready' && rows.length > 0 && visible.length === 0 && (
        <EmptyState compact title="No cylinder types match" hint="Try a different search or status filter." />
      )}
      {status === 'ready' && visible.length > 0 && (
        <>
          <p className="catalog-count" role="status">{visible.length === rows.length ? `${rows.length} cylinder types` : `${visible.length} of ${rows.length} cylinder types`}</p>
          <CylinderTypeTable rows={visible} busyId={busyId} onEdit={openForm} onToggle={(row, active) => void onToggle(row, active)} onDelete={(row) => void askDelete(row)} />
        </>
      )}

      <Modal
        open={editing !== null}
        onClose={closeForm}
        title={editing === 'new' ? 'Add cylinder type' : `Edit ${editing ? editing.name : ''}`}
        description="Prices apply to new transactions. Past bookings, sales and receipts are not changed."
        size="lg"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" form="cylinder-type-form" loading={saving} disabled={saving}>{editing === 'new' ? 'Add cylinder type' : 'Save changes'}</Button>
          </>
        )}
      >
        <form id="cylinder-type-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          {formError && <Alert tone="danger" className="catalog-form-alert">{formError}</Alert>}
          <CylinderTypeFormFields
            form={form} errors={errors} preview={preview} removeImage={removeImage} disabled={saving}
            hasStoredImage={Boolean(editing && editing !== 'new' && editing.image)}
            onChange={(patch) => { setForm((prev) => ({ ...prev, ...patch })); clearErrors(Object.keys(patch)); }}
            onPickImage={pickImage} onRemoveImage={dropImage}
          />
        </form>
      </Modal>

      <DeleteDialog
        open={pendingDelete !== null}
        name={pendingDelete?.row.name ?? ''}
        kind="cylinder type"
        blockers={pendingDelete?.blockers ?? []}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
        onDeactivateInstead={pendingDelete?.row.is_active ? () => { const row = pendingDelete.row; setPendingDelete(null); void onToggle(row, false); } : undefined}
      />

      <DeactivateDialog
        open={pending !== null}
        title={`Deactivate ${pending?.name ?? ''}?`}
        intro="It will no longer be offered for new bookings, sales, deliveries or supplier loads. Nothing is deleted."
        warnings={pending ? cylinderDeactivationWarnings(pending.usage) : []}
        confirmLabel="Deactivate"
        busy={saving}
        onConfirm={() => void confirmDeactivate()}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
