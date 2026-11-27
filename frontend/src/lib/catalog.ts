import { useEffect, useState } from 'react';
import { fetchAllPages } from './api';

/** A cylinder type as the API returns it. Two amounts price a transaction: a refill costs the refill rate; a new
 *  connection costs the refill rate PLUS the new-cylinder deposit. There is no separate selling price. */
export type CylinderTypeRecord = {
  id: number;
  name: string;
  weight: string;
  deposit_amount: string;
  refill_rate: string;
  low_stock_threshold: number;
  is_active: boolean;
  image: string | null;
  /** Legacy column, read-only and not part of the business model; never shown or sent. */
  selling_price?: string;
};

export type LocationRecord = {
  id: number;
  name: string;
  code: string;
  is_main_supplier: boolean;
  is_active: boolean;
  /** `supplier` holds no stock of its own; `stock` locations hold, sell and deliver cylinders. */
  kind?: 'stock' | 'supplier';
};

/** One reason a record cannot be deleted (the server returns the same list and enforces it). */
export type DeleteBlocker = { code: string; detail: string };

export type CylinderUsage = {
  stock_filled: number;
  stock_empty: number;
  open_bookings: number;
  bookings: number;
  sale_lines: number;
  movements: number;
  customer_rates?: number;
  delete_blockers?: DeleteBlocker[];
};

export type LocationUsage = {
  stock_filled: number;
  stock_empty: number;
  sales: number;
  movements: number;
  staff_assigned: number;
  delete_blockers?: DeleteBlocker[];
};

export const isSupplierLocation = (location: { code: string; is_main_supplier?: boolean; kind?: 'stock' | 'supplier' }) =>
  location.kind === 'supplier' || Boolean(location.is_main_supplier) || location.code === 'supplier';

// ── Loading ──────────────────────────────────────────────────────────────────

/** Types that may be used for NEW transactions. History screens fetch `/cylinder-types/` without the filter. */
export const fetchActiveCylinderTypes = () => fetchAllPages<CylinderTypeRecord>('/cylinder-types/', { active: 1 });
export const fetchAllCylinderTypes = () => fetchAllPages<CylinderTypeRecord>('/cylinder-types/');
/** Locations that may be used for NEW operations (active). Pass `kind: 'stock'` to leave out the supplier. */
export const fetchActiveLocations = (kind?: 'stock' | 'supplier') =>
  fetchAllPages<LocationRecord>('/locations/', { active: 1, ...(kind ? { kind } : {}) });
export const fetchAllLocations = () => fetchAllPages<LocationRecord>('/locations/');

// ── Keeping open screens in step ─────────────────────────────────────────────

export const CATALOG_CHANGED_EVENT = 'gasbook-catalog-changed';

/** Call after saving a cylinder type or location so screens that stay mounted (rates panel, sales form) reload their lists. */
export function notifyCatalogChanged() {
  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
  window.dispatchEvent(new Event('gas-rates-changed'));
}

/** A number that goes up whenever the catalog changes; add it to an effect's dependencies to reload. */
export function useCatalogRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, bump);
  }, []);
  return revision;
}

// ── Forms and validation (mirrors the server's rules; the server stays the authority) ──────────

export type CylinderForm = {
  name: string;
  weight: string;
  refill_rate: string;
  deposit_amount: string;
  low_stock_threshold: string;
  is_active: boolean;
};

export const emptyCylinderForm: CylinderForm = {
  name: '', weight: '', refill_rate: '', deposit_amount: '', low_stock_threshold: '5', is_active: true,
};

export const formFromCylinder = (row: CylinderTypeRecord): CylinderForm => ({
  name: row.name,
  weight: row.weight,
  refill_rate: row.refill_rate,
  deposit_amount: row.deposit_amount,
  low_stock_threshold: String(row.low_stock_threshold),
  is_active: row.is_active,
});

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const isMoney = (value: string) => /^\d{1,8}(\.\d{1,2})?$/.test(value.trim());

export function validateCylinderForm(form: CylinderForm): FieldErrors<keyof CylinderForm> {
  const errors: FieldErrors<keyof CylinderForm> = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Enter a name, for example 19kg.';
  else if (name.length > 80) errors.name = 'Use 80 characters or fewer.';
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(form.weight.trim()) || Number(form.weight) <= 0) {
    errors.weight = 'Enter the weight in kg, greater than 0 (up to 2 decimals).';
  }
  const money: [keyof CylinderForm, string][] = [
    ['refill_rate', 'refill price'], ['deposit_amount', 'deposit'],
  ];
  for (const [field, label] of money) {
    const value = String(form[field]).trim();
    if (!isMoney(value)) errors[field] = `Enter the ${label} in rupees, 0 or more (up to 2 decimals).`;
  }
  if (!/^\d{1,9}$/.test(form.low_stock_threshold.trim())) errors.low_stock_threshold = 'Enter a whole number, 0 or more.';
  return errors;
}

export type LocationForm = { name: string; is_main_supplier: boolean; is_active: boolean };
export const emptyLocationForm: LocationForm = { name: '', is_main_supplier: false, is_active: true };

export function validateLocationForm(form: LocationForm): FieldErrors<keyof LocationForm> {
  const errors: FieldErrors<keyof LocationForm> = {};
  const name = form.name.trim().replace(/\s+/g, ' ');
  if (!name) errors.name = 'Enter a name, for example Godown 2.';
  else if (name.length > 80) errors.name = 'Use 80 characters or fewer.';
  return errors;
}

/** Picks the field errors out of an API error body ({ name: ["…"] } or { field: "name" }) so they can sit beside the input. */
export function apiFieldErrors<K extends string>(err: unknown, fields: readonly K[]): FieldErrors<K> {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const out: FieldErrors<K> = {};
  if (!data || typeof data !== 'object') return out;
  for (const field of fields) {
    const value = data[field];
    const text = Array.isArray(value) ? value.map(String).join(' ') : typeof value === 'string' ? value : '';
    if (text) out[field] = text;
  }
  if (!Object.keys(out).length && typeof data.field === 'string' && (fields as readonly string[]).includes(data.field) && typeof data.detail === 'string') {
    out[data.field as K] = data.detail;
  }
  return out;
}

export function matchesSearch(text: string, term: string) {
  const needle = term.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

export type StatusFilter = 'all' | 'active' | 'inactive';
export const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];
export const matchesStatus = (isActive: boolean, filter: StatusFilter) =>
  filter === 'all' || (filter === 'active' ? isActive : !isActive);

// ── Confirmation wording ─────────────────────────────────────────────────────

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What to tell the admin before a cylinder type is deactivated. Empty list = nothing depends on it. */
export function cylinderDeactivationWarnings(usage: CylinderUsage): string[] {
  const warnings: string[] = [];
  const held = usage.stock_filled + usage.stock_empty;
  if (held) warnings.push(`${plural(held, 'cylinder')} of this type are in stock (${usage.stock_filled} filled, ${usage.stock_empty} empty). They stay in stock, but cannot be sold or loaded from the supplier while it is inactive.`);
  if (usage.open_bookings) warnings.push(`${plural(usage.open_bookings, 'open booking')} include it. They can still be delivered.`);
  if (usage.bookings || usage.sale_lines) warnings.push('Past bookings, sales and receipts keep showing it.');
  return warnings;
}

export function locationDeactivationWarnings(usage: LocationUsage): string[] {
  const warnings: string[] = [];
  if (usage.staff_assigned) warnings.push(`${plural(usage.staff_assigned, 'staff member')} use it as their delivery location; deliveries will fall back to the shop.`);
  if (usage.sales || usage.movements) warnings.push('Past sales, stock movements and reports keep showing it.');
  return warnings;
}

/** Reasons a record cannot be deleted; empty when nothing depends on it. */
export const deleteBlockers = (usage: { delete_blockers?: DeleteBlocker[] }): DeleteBlocker[] => usage.delete_blockers ?? [];

/** True when the location still holds cylinders: the server refuses to deactivate it until they are moved. */
export const locationHoldsStock = (usage: LocationUsage) => usage.stock_filled + usage.stock_empty > 0;

/** What a customer pays per cylinder: a refill is the refill price only; a new connection adds the deposit once.
 *  null while either amount is not a valid number. */
export function chargePerCylinder(refill: string | number, deposit: string | number): { refill: number; newConnection: number } | null {
  const refillAmount = Number(String(refill).trim());
  const depositAmount = Number(String(deposit).trim());
  if (String(refill).trim() === '' || String(deposit).trim() === '' || !Number.isFinite(refillAmount) || !Number.isFinite(depositAmount)) return null;
  return { refill: refillAmount, newConnection: Math.round((refillAmount + depositAmount) * 100) / 100 };
}

export const formatRupees = (value: string | number) =>
  `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
