import { afterEach, beforeEach, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CylinderTypeFormFields, CylinderTypeTable, PriceSummary } from '../src/components/catalog/CylinderTypesPanel';
import { InventoryTabs } from '../src/components/catalog/InventoryTabs';
import { LocationFormFields, LocationTable } from '../src/components/catalog/LocationsPanel';
import { ToastProvider } from '../src/components/ui/Toast';
import {
  CATALOG_CHANGED_EVENT, apiFieldErrors, chargePerCylinder, cylinderDeactivationWarnings, deleteBlockers, emptyCylinderForm, emptyLocationForm,
  formFromCylinder, isSupplierLocation, locationDeactivationWarnings, locationHoldsStock, matchesSearch,
  matchesStatus, notifyCatalogChanged, validateCylinderForm, validateLocationForm,
  type CylinderTypeRecord, type LocationRecord,
} from '../src/lib/catalog';
import { INVENTORY_TABS, isInventoryTab } from '../src/lib/inventoryTabs';
import { api } from '../src/lib/api';
import { GENERIC_CYLINDER_IMAGE, SUPPORTED_CYLINDER_WEIGHTS, defaultCylinderImage } from '../src/lib/cylinderImages';

/** The SABCO default this app requests for a weight (served by the backend at /static/cylinders/). */
const sabco = (kg: number) => defaultCylinderImage(kg, api.defaults.baseURL ?? '')!;

const cylinder = (over: Partial<CylinderTypeRecord> = {}): CylinderTypeRecord => ({
  id: 1, name: '19kg', weight: '19.00', deposit_amount: '1000.00', refill_rate: '1420.00',
  low_stock_threshold: 5, is_active: true, image: null, ...over,
});
const location = (over: Partial<LocationRecord> = {}): LocationRecord => ({
  id: 1, name: 'Shop', code: 'shop', is_main_supplier: false, is_active: true, kind: 'stock', ...over,
});
const noop = () => {};

// ── validation ───────────────────────────────────────────────────────────────

it('accepts a complete cylinder form and reports each bad field with a readable message', () => {
  const ok = { ...emptyCylinderForm, name: '35kg', weight: '35', refill_rate: '2400', deposit_amount: '1500' };
  expect(validateCylinderForm(ok)).toEqual({});
  const bad = validateCylinderForm({ ...emptyCylinderForm, name: '  ', weight: '0', refill_rate: 'abc', deposit_amount: '1.234', low_stock_threshold: '-2' });
  expect(Object.keys(bad).sort()).toEqual(['deposit_amount', 'low_stock_threshold', 'name', 'refill_rate', 'weight']);
  expect(bad.name).toContain('Enter a name');
  expect(bad.weight).toContain('greater than 0');
  expect(bad.refill_rate).toContain('refill price');
  expect(bad.deposit_amount).toContain('deposit');
  expect(validateCylinderForm({ ...ok, name: 'x'.repeat(81) }).name).toContain('80');
});

it('has no selling-price field: only the refill price and the new-cylinder deposit price a cylinder', () => {
  expect('selling_price' in emptyCylinderForm).toBe(false);
  expect('selling_price' in formFromCylinder(cylinder())).toBe(false);
  expect(validateCylinderForm({ ...emptyCylinderForm, name: 'a', weight: '5', refill_rate: '1', deposit_amount: '1' })).toEqual({});
});

it('keeps refill rate and new-cylinder deposit as two separate required amounts', () => {
  const missingDeposit = validateCylinderForm({ ...emptyCylinderForm, name: 'a', weight: '5', refill_rate: '1', deposit_amount: '' });
  expect(Object.keys(missingDeposit)).toEqual(['deposit_amount']);
  const missingRefill = validateCylinderForm({ ...emptyCylinderForm, name: 'a', weight: '5', refill_rate: '', deposit_amount: '1' });
  expect(Object.keys(missingRefill)).toEqual(['refill_rate']);
});

it('validates locations', () => {
  expect(validateLocationForm({ ...emptyLocationForm, name: 'Godown 2' })).toEqual({});
  expect(validateLocationForm(emptyLocationForm).name).toContain('Enter a name');
});

it('turns API field errors into per-field messages, including the server duplicate-name error', () => {
  const duplicate = { response: { data: { detail: 'A cylinder type named 5kg already exists.', code: 'duplicate_name', field: 'name', name: ['A cylinder type with this name already exists.'] } } };
  expect(apiFieldErrors(duplicate, ['name', 'weight'] as const)).toEqual({ name: 'A cylinder type with this name already exists.' });
  const onlyField = { response: { data: { detail: 'Too big', field: 'weight' } } };
  expect(apiFieldErrors(onlyField, ['name', 'weight'] as const)).toEqual({ weight: 'Too big' });
  expect(apiFieldErrors({ response: { data: { detail: 'No field named' } } }, ['name'] as const)).toEqual({});
  expect(apiFieldErrors(new Error('network'), ['name'] as const)).toEqual({});
});

// ── search, filters, warnings ────────────────────────────────────────────────

it('searches ignoring case and filters by status', () => {
  expect(matchesSearch('19kg 19.00', ' 19K ')).toBe(true);
  expect(matchesSearch('Godown 2 godown-2', 'shop')).toBe(false);
  expect(matchesSearch('anything', '')).toBe(true);
  expect(matchesStatus(true, 'active') && !matchesStatus(true, 'inactive') && matchesStatus(false, 'all')).toBe(true);
});

it('explains what depends on a cylinder type before it is deactivated', () => {
  const none = cylinderDeactivationWarnings({ stock_filled: 0, stock_empty: 0, open_bookings: 0, bookings: 0, sale_lines: 0, movements: 0 });
  expect(none).toEqual([]);
  const used = cylinderDeactivationWarnings({ stock_filled: 4, stock_empty: 1, open_bookings: 2, bookings: 9, sale_lines: 3, movements: 5 });
  expect(used.join(' ')).toContain('5 cylinders');
  expect(used.join(' ')).toContain('2 open bookings');
  expect(used.join(' ')).toContain('keep showing it');
});

it('treats a location that holds cylinders as blocked, and lists softer dependents otherwise', () => {
  expect(locationHoldsStock({ stock_filled: 0, stock_empty: 1, sales: 0, movements: 0, staff_assigned: 0 })).toBe(true);
  expect(locationHoldsStock({ stock_filled: 0, stock_empty: 0, sales: 4, movements: 2, staff_assigned: 0 })).toBe(false);
  const warnings = locationDeactivationWarnings({ stock_filled: 0, stock_empty: 0, sales: 4, movements: 2, staff_assigned: 1 });
  expect(warnings.join(' ')).toContain('1 staff member');
  expect(warnings.join(' ')).toContain('Past sales');
});

it('recognises the supplier by type, flag or the legacy code', () => {
  expect(isSupplierLocation(location())).toBe(false);
  expect(isSupplierLocation({ code: 'supplier', is_main_supplier: false })).toBe(true);
  expect(isSupplierLocation({ code: 'plant', is_main_supplier: true })).toBe(true);
  expect(isSupplierLocation({ code: 'x', kind: 'supplier' })).toBe(true);
});

// ── presentation ─────────────────────────────────────────────────────────────

it('lists cylinder types with refill price, deposit and the new-connection total, and a clear status', () => {
  const html = renderToStaticMarkup(
    <CylinderTypeTable rows={[cylinder(), cylinder({ id: 2, name: '5kg', weight: '5.00', is_active: false, image: 'https://api.example/media/cylinder-images/5.png' })]}
      busyId={null} onEdit={noop} onToggle={noop} />,
  );
  for (const heading of ['Refill price', 'New-cylinder deposit', 'New connection']) expect(html).toContain(heading);
  expect(html).not.toContain('Selling price');
  expect(html).toContain('₹1,420.00'); expect(html).toContain('₹1,000.00');
  expect(html).toContain('₹2,420.00'); // new connection = refill + deposit, not shown anywhere as a separate selling price
  expect(html).toContain('>Active<'); expect(html).toContain('>Inactive<');
  expect(html).toContain('data-inactive="true"');
  expect(html).toContain('src="https://api.example/media/cylinder-images/5.png"');
  expect(html).toContain(`src="${sabco(19)}"`); // no picture uploaded for 19kg: its standard picture
  expect(html).not.toContain(`src="${sabco(5)}"`); // 5kg has a custom one
  expect(html).toContain('aria-label="Edit 19kg"');
  expect(html).toContain('aria-label="19kg is active"'); expect(html).toContain('aria-label="5kg is inactive"');
});

it('renders the cylinder form with labelled fields, inline errors, the picture preview and an accessible status switch', () => {
  const form = { ...formFromCylinder(cylinder()), name: '' };
  const html = renderToStaticMarkup(
    <CylinderTypeFormFields form={form} errors={{ name: 'Enter a name, for example 19kg.' }} preview="blob:picture" hasStoredImage={false}
      removeImage={false} onChange={noop} onPickImage={noop} onRemoveImage={noop} />,
  );
  for (const label of ['Name', 'Weight (kg)', 'Refill price (₹)', 'New-cylinder deposit (₹)', 'Picture']) expect(html).toContain(label);
  expect(html).not.toContain('Selling price');
  expect(html).toContain('Never charged on a refill');
  expect(html).toContain('New connection');
  expect(html).toContain('Enter a name, for example 19kg.');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('src="blob:picture"');
  expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
  expect(html).toContain('Remove picture');
  expect(html).toContain('Change picture');
  expect(html).toContain('type="checkbox"'); expect(html).toContain('checked=""');
  expect(html).toContain('Active: can be booked and sold');
  const off = renderToStaticMarkup(
    <CylinderTypeFormFields form={{ ...form, is_active: false }} errors={{}} preview={null} hasStoredImage={false} removeImage={false} onChange={noop} onPickImage={noop} onRemoveImage={noop} />,
  );
  expect(off).toContain('Inactive: hidden from new bookings'); expect(off).not.toContain('Remove picture'); expect(off).toContain('Choose picture');
});

it('shows a stored picture as removable unless it is already marked for removal', () => {
  const stored = renderToStaticMarkup(
    <CylinderTypeFormFields form={emptyCylinderForm} errors={{}} preview="https://api.example/x.png" hasStoredImage removeImage={false} onChange={noop} onPickImage={noop} onRemoveImage={noop} />,
  );
  expect(stored).toContain('Remove picture');
  const removed = renderToStaticMarkup(
    <CylinderTypeFormFields form={emptyCylinderForm} errors={{}} preview={null} hasStoredImage removeImage onChange={noop} onPickImage={noop} onRemoveImage={noop} />,
  );
  expect(removed).not.toContain('Remove picture');
});

it('shows every existing type without a custom picture with its weight\'s standard picture', () => {
  const rows = SUPPORTED_CYLINDER_WEIGHTS.map((kg, i) => cylinder({ id: i + 1, name: `${kg}kg`, weight: `${kg}.00`, image: null }));
  const html = renderToStaticMarkup(<CylinderTypeTable rows={rows} busyId={null} onEdit={noop} onToggle={noop} />);
  for (const kg of SUPPORTED_CYLINDER_WEIGHTS) expect(html).toContain(`src="${sabco(kg)}"`);
  expect(html).not.toContain(GENERIC_CYLINDER_IMAGE);
  const odd = renderToStaticMarkup(<CylinderTypeTable rows={[cylinder({ name: 'Big Blue', weight: '35.00' })]} busyId={null} onEdit={noop} onToggle={noop} />);
  expect(odd).toContain(`src="${GENERIC_CYLINDER_IMAGE}"`);
});

it('previews the standard picture for the typed weight while no custom picture is set, and on removal', () => {
  const fields = (weight: string, preview: string | null, extra: { hasStoredImage?: boolean; removeImage?: boolean } = {}) => renderToStaticMarkup(
    <CylinderTypeFormFields form={{ ...emptyCylinderForm, name: 'Commercial', weight }} errors={{}} preview={preview} hasStoredImage={extra.hasStoredImage ?? false}
      removeImage={extra.removeImage ?? false} onChange={noop} onPickImage={noop} onRemoveImage={noop} />,
  );
  expect(sabco(19)).toEndWith('/static/cylinders/sabco-19kg.png');
  const nineteen = fields('19', null);
  expect(nineteen).toContain(`src="${sabco(19)}"`); expect(nineteen).toContain('Showing the standard 19 kg picture.');
  expect(nineteen).toContain('Choose picture'); expect(nineteen).not.toContain('Remove picture'); // a default can never be removed
  // Changing the weight swaps the default straight away.
  expect(fields('33', null)).toContain(`src="${sabco(33)}"`);
  // A custom picture wins over the default and is removable; once marked for removal the default is back.
  const custom = fields('33', 'https://api.example/media/cylinder-images/c.png', { hasStoredImage: true });
  expect(custom).toContain('src="https://api.example/media/cylinder-images/c.png"'); expect(custom).not.toContain(sabco(33));
  expect(custom).not.toContain('Showing the standard');
  const removed = fields('33', null, { hasStoredImage: true, removeImage: true });
  expect(removed).toContain(`src="${sabco(33)}"`); expect(removed).not.toContain('Remove picture');
  const odd = fields('35', null);
  expect(odd).toContain(`src="${GENERIC_CYLINDER_IMAGE}"`); expect(odd).toContain('No standard picture for 35 kg');
  expect(fields('', null)).toContain('Enter the weight to see its standard picture.');
});

it('lists locations with type, cylinders held and status; the supplier holds none', () => {
  const html = renderToStaticMarkup(
    <LocationTable rows={[location(), location({ id: 2, name: 'Godown 2', code: 'godown-2', is_active: false }), location({ id: 3, name: 'Supplier', code: 'supplier', kind: 'supplier' })]}
      held={{ 1: 12, 2: 0 }} busyId={null} onEdit={noop} onToggle={noop} />,
  );
  expect(html).toContain('Godown 2'); expect(html).toContain('godown-2');
  expect(html).toContain('Stock location'); expect(html).toContain('>Supplier<');
  expect(html).toContain('>12<'); expect(html).toContain('—');
  expect(html).toContain('aria-label="Godown 2 is inactive"');
  expect(html).toContain('data-inactive="true"');
});

it('shows a stock figure placeholder while stock levels are still loading', () => {
  expect(renderToStaticMarkup(<LocationTable rows={[location()]} held={null} busyId={null} onEdit={noop} onToggle={noop} />)).toContain('…');
});

it('lets the type be chosen only when adding a location', () => {
  const adding = renderToStaticMarkup(<LocationFormFields form={emptyLocationForm} errors={{}} isNew onChange={noop} />);
  expect(adding).not.toMatch(/<select[^>]*disabled/);
  expect(adding).toContain('cannot be changed later');
  const editing = renderToStaticMarkup(<LocationFormFields form={{ name: 'Shop', is_main_supplier: false, is_active: true }} errors={{}} isNew={false} onChange={noop} />);
  expect(editing).toMatch(/<select[^>]*disabled/);
  expect(editing).toContain('fixed once a location exists');
  const error = renderToStaticMarkup(<LocationFormFields form={emptyLocationForm} errors={{ name: 'A location with this name already exists.' }} isNew onChange={noop} />);
  expect(error).toContain('already exists');
});

// ── the pricing rule ─────────────────────────────────────────────────────────

it('charges a refill the refill price only and a new connection the refill price plus the deposit, once', () => {
  expect(chargePerCylinder('360', '450')).toEqual({ refill: 360, newConnection: 810 });
  expect(chargePerCylinder(1420, '1000.50')).toEqual({ refill: 1420, newConnection: 2420.5 });
  expect(chargePerCylinder('360', '0')).toEqual({ refill: 360, newConnection: 360 });
  expect(chargePerCylinder('', '450')).toBeNull();
  expect(chargePerCylinder('360', 'abc')).toBeNull();
});

it('shows the live price summary while the two amounts are typed', () => {
  const html = renderToStaticMarkup(<PriceSummary refill="360" deposit="450" />);
  expect(html).toContain('Refill'); expect(html).toContain('₹360.00');
  expect(html).toContain('New connection'); expect(html).toContain('₹810.00'); expect(html).toContain('refill + deposit');
  const incomplete = renderToStaticMarkup(<PriceSummary refill="360" deposit="" />);
  expect(incomplete).toContain('₹360.00'); expect(incomplete).not.toContain('₹810.00');
});

// ── delete ───────────────────────────────────────────────────────────────────

it('offers a Delete button on every cylinder type and location row, labelled with the record name', () => {
  const types = renderToStaticMarkup(<CylinderTypeTable rows={[cylinder(), cylinder({ id: 2, name: '5kg' })]} busyId={null} onEdit={noop} onToggle={noop} onDelete={noop} />);
  expect(types).toContain('aria-label="Delete 19kg"'); expect(types).toContain('aria-label="Delete 5kg"');
  const places = renderToStaticMarkup(<LocationTable rows={[location(), location({ id: 2, name: 'Godown 2', code: 'godown-2' })]} held={null} busyId={null} onEdit={noop} onToggle={noop} onDelete={noop} />);
  expect(places).toContain('aria-label="Delete Godown 2"'); expect(places).toContain('aria-label="Delete Shop"');
});

it('does not render Delete when the table is not given a delete handler', () => {
  expect(renderToStaticMarkup(<CylinderTypeTable rows={[cylinder()]} busyId={null} onEdit={noop} onToggle={noop} />)).not.toContain('Delete');
});

it('disables the row actions while that row is being checked', () => {
  const html = renderToStaticMarkup(<CylinderTypeTable rows={[cylinder()]} busyId={1} onEdit={noop} onToggle={noop} onDelete={noop} />);
  expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Delete 19kg"|<button[^>]*aria-label="Delete 19kg"[^>]*disabled/);
});

it('reads the reasons a record cannot be deleted from the usage the server returns', () => {
  expect(deleteBlockers({})).toEqual([]);
  expect(deleteBlockers({ delete_blockers: [] })).toEqual([]);
  const blockers = [{ code: 'has_history', detail: 'It appears in 3 bookings.' }, { code: 'has_stock', detail: '2 cylinders in stock.' }];
  expect(deleteBlockers({ delete_blockers: blockers })).toEqual(blockers);
});

// ── tabs ─────────────────────────────────────────────────────────────────────

it('offers Products & Inventory, Cylinder Types and Locations as tabs, with short labels for phones', () => {
  expect(INVENTORY_TABS.map((t) => t.value)).toEqual(['products', 'cylinders', 'locations']);
  expect(isInventoryTab('cylinders')).toBe(true);
  expect(isInventoryTab('nonsense')).toBe(false);
  expect(isInventoryTab(null)).toBe(false);
  const html = renderToStaticMarkup(<ToastProvider><InventoryTabs tab="cylinders" onChange={noop} /></ToastProvider>);
  expect(html).toContain('role="tablist"');
  expect((html.match(/role="tab"/g) ?? []).length).toBe(3);
  expect(html).toContain('catalog-tab-long'); expect(html).toContain('catalog-tab-short');
  expect(html).toMatch(/aria-selected="true"[^>]*><span><span class="catalog-tab-long">Cylinder Types/);
  expect(html).toContain('aria-label="Cylinder types"'); // the active panel
  expect(html).toContain('Add cylinder type');
});

it('keeps the existing Products & Inventory screen as the first tab', () => {
  const html = renderToStaticMarkup(<ToastProvider><InventoryTabs tab="products" onChange={noop} /></ToastProvider>);
  expect(html).toContain('Products &amp; Inventory');
  expect(html).toContain('Add product');
  expect(html).toContain('inventory-page');
  expect(html).not.toContain('Add cylinder type');
});

it('shows the Locations tab with its add button', () => {
  const html = renderToStaticMarkup(<ToastProvider><InventoryTabs tab="locations" onChange={noop} /></ToastProvider>);
  expect(html).toContain('Add location');
  expect(html).toContain('appears in stock, sales, delivery and report lists');
});

// ── keeping selectors fresh ──────────────────────────────────────────────────

const g = globalThis as unknown as { window?: EventTarget };
let saved: EventTarget | undefined;
beforeEach(() => { saved = g.window; g.window = new EventTarget(); });
afterEach(() => { g.window = saved; });

it('tells every mounted screen the catalog changed, and the existing rates listeners too', () => {
  const seen: string[] = [];
  g.window!.addEventListener(CATALOG_CHANGED_EVENT, () => seen.push('catalog'));
  g.window!.addEventListener('gas-rates-changed', () => seen.push('rates'));
  notifyCatalogChanged();
  expect(seen).toEqual(['catalog', 'rates']);
});
