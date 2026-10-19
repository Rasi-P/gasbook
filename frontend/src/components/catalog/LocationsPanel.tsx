import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Factory, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, extractApiError, fetchAllPages } from '../../lib/api';
import {
  STATUS_FILTER_OPTIONS, apiFieldErrors, deleteBlockers, emptyLocationForm, fetchAllLocations, isSupplierLocation, locationDeactivationWarnings,
  locationHoldsStock, matchesSearch, matchesStatus, notifyCatalogChanged, validateLocationForm,
  type FieldErrors, type LocationForm, type LocationRecord, type LocationUsage, type StatusFilter,
} from '../../lib/catalog';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ChoiceChips } from '../ui/ChoiceChips';
import { EmptyState } from '../ui/EmptyState';
import { Field, Input, Select } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { SearchInput } from '../ui/SearchInput';
import { SkeletonRows } from '../ui/Skeleton';
import { Switch } from '../ui/Switch';
import { Table, TableWrap, Td, Th } from '../ui/Table';
import { useToast } from '../ui/toast-context';
import { ActiveBadge, DeactivateDialog, DeleteDialog } from './shared';

const FIELD_NAMES = ['name', 'is_main_supplier', 'is_active'] as const;
type StockRow = { location: number; quantity: number };

export function LocationKindBadge({ location }: { location: LocationRecord }) {
  return isSupplierLocation(location)
    ? <Badge tone="info" icon={<Factory size={12} />}>Supplier</Badge>
    : <Badge tone="primary" variant="outline" icon={<MapPin size={12} />}>Stock location</Badge>;
}

export function LocationTable({
  rows, held, busyId, onEdit, onToggle, onDelete,
}: {
  rows: LocationRecord[];
  /** Cylinders currently held per location id (undefined while unknown). */
  held: Record<number, number> | null;
  busyId: number | null;
  onEdit: (row: LocationRecord) => void;
  onToggle: (row: LocationRecord, active: boolean) => void;
  onDelete?: (row: LocationRecord) => void;
}) {
  return (
    <TableWrap>
      <Table cards className="catalog-table catalog-table--locations" aria-label="Locations">
        <thead>
          <tr>
            <Th>Location</Th>
            <Th>Type</Th>
            <Th align="right">Cylinders held</Th>
            <Th>Status</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-inactive={row.is_active ? undefined : 'true'}>
              <Td className="catalog-td-name"><strong>{row.name}</strong><span className="ui-cell-sub">{row.code}</span></Td>
              <Td label="Type" className="catalog-td-meta"><LocationKindBadge location={row} /></Td>
              <Td label="Cylinders held" numeric className="catalog-td-meta">{isSupplierLocation(row) ? '—' : held ? (held[row.id] ?? 0) : '…'}</Td>
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

export function LocationFormFields({
  form, errors, isNew, disabled, onChange,
}: {
  form: LocationForm;
  errors: FieldErrors<(typeof FIELD_NAMES)[number]>;
  isNew: boolean;
  disabled?: boolean;
  onChange: (patch: Partial<LocationForm>) => void;
}) {
  return (
    <div className="catalog-form-grid">
      <Field label="Name" error={errors.name} required className="catalog-span-2">
        <Input value={form.name} maxLength={80} invalid={Boolean(errors.name)} disabled={disabled} autoFocus
          onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Godown 2" />
      </Field>
      <Field
        label="Type"
        className="catalog-span-2"
        error={errors.is_main_supplier}
        hint={isNew
          ? 'A stock location holds, sells and delivers cylinders. A supplier is where empties are sent for refilling. This cannot be changed later.'
          : 'The type is fixed once a location exists.'}
      >
        <Select value={form.is_main_supplier ? 'supplier' : 'stock'} disabled={disabled || !isNew}
          onChange={(e) => onChange({ is_main_supplier: e.target.value === 'supplier' })}>
          <option value="stock">Stock location (shop, godown…)</option>
          <option value="supplier">Supplier</option>
        </Select>
      </Field>
      <div className="catalog-span-2">
        <Switch checked={form.is_active} disabled={disabled} onChange={(checked) => onChange({ is_active: checked })}
          label={form.is_active ? 'Active: appears in stock, sales and delivery lists' : 'Inactive: hidden from new operations; history is kept'} />
      </div>
    </div>
  );
}

type Pending = { row: LocationRecord; usage: LocationUsage } | null;
type PendingDelete = { row: LocationRecord; blockers: { code: string; detail: string }[] } | null;

export default function LocationsPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<LocationRecord[]>([]);
  const [held, setHeld] = useState<Record<number, number> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');

  const [editing, setEditing] = useState<LocationRecord | 'new' | null>(null);
  const [form, setForm] = useState<LocationForm>(emptyLocationForm);
  const [errors, setErrors] = useState<FieldErrors<(typeof FIELD_NAMES)[number]>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [listError, setListError] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    return fetchAllLocations()
      .then((data) => {
        setRows(data);
        setLoadError('');
        setStatus('ready');
        // The stock column is a convenience; the list works without it.
        return fetchAllPages<StockRow>('/stock/')
          .then((stock) => {
            const totals: Record<number, number> = {};
            for (const row of stock) totals[row.location] = (totals[row.location] ?? 0) + row.quantity;
            setHeld(totals);
          })
          .catch(() => setHeld(null));
      })
      .catch((err) => { setLoadError(extractApiError(err, [], 'Could not load locations.')); setStatus('error'); });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => rows.filter((r) => matchesSearch(`${r.name} ${r.code}`, search) && matchesStatus(r.is_active, filter)),
    [rows, search, filter],
  );

  function openForm(target: LocationRecord | 'new') {
    setEditing(target);
    setForm(target === 'new' ? emptyLocationForm : { name: target.name, is_main_supplier: isSupplierLocation(target), is_active: target.is_active });
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

  async function save(id: number | null, body: Partial<LocationForm>, message?: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setFormError('');
    try {
      const { data } = await (id === null ? api.post('/locations/', body) : api.patch(`/locations/${id}/`, body));
      toast.show(message ?? (id === null ? `${data.name} added. It now appears in every location list.` : `${data.name} saved.`), { tone: 'success' });
      setEditing(null);
      setPending(null);
      notifyCatalogChanged();
      await load();
    } catch (err) {
      setPending(null);
      const fieldErrors = apiFieldErrors(err, FIELD_NAMES);
      setErrors(fieldErrors);
      const text = extractApiError(err, [], 'Could not save the location.');
      if (editing !== null) setFormError(Object.keys(fieldErrors).length ? 'Fix the highlighted fields and try again.' : text);
      else setListError(text);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function checkAndAsk(row: LocationRecord, resume?: () => void) {
    try {
      const { data } = await api.get<LocationUsage>(`/locations/${row.id}/usage/`);
      setPending({ row, usage: data });
      resume?.();
    } catch (err) {
      const text = extractApiError(err, [], 'Could not check what uses this location.');
      if (editing !== null) setFormError(text); else setListError(text);
    }
  }

  async function askDelete(row: LocationRecord) {
    setListError('');
    setBusyId(row.id);
    try {
      const { data } = await api.get<LocationUsage>(`/locations/${row.id}/usage/`);
      setPendingDelete({ row, blockers: deleteBlockers(data) });
    } catch (err) {
      setListError(extractApiError(err, [], 'Could not check what uses this location.'));
    } finally { setBusyId(null); }
  }

  async function confirmDelete() {
    if (!pendingDelete || inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    try {
      await api.delete(`/locations/${pendingDelete.row.id}/`);
      toast.show(`${pendingDelete.row.name} deleted.`, { tone: 'success' });
      setPendingDelete(null);
      notifyCatalogChanged();
      await load();
    } catch (err) {
      // The server re-checks under lock; if something appeared meanwhile, show it instead of failing silently.
      const blockers = (err as { response?: { data?: { blockers?: { code: string; detail: string }[] } } })?.response?.data?.blockers;
      if (blockers?.length) setPendingDelete({ row: pendingDelete.row, blockers });
      else { setPendingDelete(null); setListError(extractApiError(err, [], 'Could not delete the location.')); }
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateLocationForm(form);
    setErrors(found);
    if (Object.keys(found).length) { setFormError('Fix the highlighted fields and try again.'); return; }
    const name = form.name.trim().replace(/\s+/g, ' ');
    if (editing === 'new') {
      await save(null, { name, is_main_supplier: form.is_main_supplier, is_active: form.is_active });
      return;
    }
    if (editing && editing.is_active && !form.is_active) { await checkAndAsk(editing); return; }
    if (editing) await save(editing.id, { name, is_active: form.is_active });
  }

  async function onToggle(row: LocationRecord, active: boolean) {
    setListError('');
    setBusyId(row.id);
    try {
      if (active) await save(row.id, { is_active: true }, `${row.name} is active again.`);
      else await checkAndAsk(row);
    } finally { setBusyId(null); }
  }

  const blocked = pending && locationHoldsStock(pending.usage)
    ? `${pending.row.name} still holds ${pending.usage.stock_filled + pending.usage.stock_empty} cylinder(s) (${pending.usage.stock_filled} filled, ${pending.usage.stock_empty} empty). Move them to another location from the Stock page first; nothing is moved automatically.`
    : undefined;

  return (
    <section className="catalog-panel" aria-labelledby="locations-title">
      <div className="catalog-toolbar">
        <h2 id="locations-title">Locations</h2>
        <Button type="button" icon={<Plus size={16} />} onClick={() => openForm('new')}>Add location</Button>
        <p>Where cylinders are kept. A new active location appears in stock, sales, delivery and report lists straight away.</p>
      </div>

      <div className="catalog-filters">
        <SearchInput placeholder="Search by name" aria-label="Search locations" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ChoiceChips ariaLabel="Filter by status" options={STATUS_FILTER_OPTIONS} value={filter} onChange={setFilter} size="sm" />
      </div>

      {listError && <Alert tone="danger">{listError}</Alert>}
      {status === 'loading' && <SkeletonRows rows={3} columns={4} label="Loading locations" />}
      {status === 'error' && (
        <Alert tone="danger" actions={<Button type="button" size="sm" variant="secondary" onClick={() => { setStatus('loading'); void load(); }}>Retry</Button>}>{loadError}</Alert>
      )}
      {status === 'ready' && rows.length === 0 && (
        <EmptyState title="No locations yet" hint="Add your shop or godown to start tracking stock." action={<Button type="button" onClick={() => openForm('new')}>Add location</Button>} />
      )}
      {status === 'ready' && rows.length > 0 && visible.length === 0 && (
        <EmptyState compact title="No locations match" hint="Try a different search or status filter." />
      )}
      {status === 'ready' && visible.length > 0 && (
        <>
          <p className="catalog-count" role="status">{visible.length === rows.length ? `${rows.length} locations` : `${visible.length} of ${rows.length} locations`}</p>
          <LocationTable rows={visible} held={held} busyId={busyId} onEdit={openForm} onToggle={(row, active) => void onToggle(row, active)} onDelete={(row) => void askDelete(row)} />
        </>
      )}

      <Modal
        open={editing !== null}
        onClose={closeForm}
        title={editing === 'new' ? 'Add location' : `Edit ${editing ? editing.name : ''}`}
        size="md"
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" form="location-form" loading={saving} disabled={saving}>{editing === 'new' ? 'Add location' : 'Save changes'}</Button>
          </>
        )}
      >
        <form id="location-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          {formError && <Alert tone="danger" className="catalog-form-alert">{formError}</Alert>}
          <LocationFormFields form={form} errors={errors} isNew={editing === 'new'} disabled={saving}
            onChange={(patch) => { setForm((prev) => ({ ...prev, ...patch })); clearErrors(Object.keys(patch)); }} />
        </form>
      </Modal>

      <DeleteDialog
        open={pendingDelete !== null}
        name={pendingDelete?.row.name ?? ''}
        kind="location"
        blockers={pendingDelete?.blockers ?? []}
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
        onDeactivateInstead={pendingDelete?.row.is_active ? () => { const row = pendingDelete.row; setPendingDelete(null); void onToggle(row, false); } : undefined}
      />

      <DeactivateDialog
        open={pending !== null}
        title={`Deactivate ${pending?.row.name ?? ''}?`}
        intro="It will disappear from the lists used for new stock movements, sales and deliveries. Its history stays."
        warnings={pending ? locationDeactivationWarnings(pending.usage) : []}
        blockedMessage={blocked}
        confirmLabel="Deactivate"
        busy={saving}
        onConfirm={() => {
          if (!pending) return;
          // From the edit form, any name change is saved together with the deactivation.
          const body = editing !== null && editing !== 'new'
            ? { name: form.name.trim().replace(/\s+/g, ' '), is_active: false }
            : { is_active: false };
          void save(pending.row.id, body, `${pending.row.name} is now inactive.`);
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}
