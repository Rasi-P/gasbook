import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle, Banknote, Building2, CheckCircle2, CreditCard, Plus,
  Receipt, RotateCcw, Smartphone, Trash2, User,
} from 'lucide-react';
import { api, extractApiError, fetchAllPages, LIMITS } from '../lib/api';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';
import { usePager } from '../hooks/usePager';
import { SaleItemsCell } from '../components/SaleItemsCell';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { Card, CardFooter, CardHeader } from '../components/ui/Card';
import { ChoiceChips } from '../components/ui/ChoiceChips';
import { Field, Input, Select } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Table, TableWrap, Td, Th } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';

type CylinderType = { id: number; name: string; selling_price: number; refill_rate: number };
type Location = { id: number; name: string; code: string; is_main_supplier: boolean };
type SaleItem = { cylinder_type: number; quantity: number | string; rate: string; empty_returned: number | string; rate_type: 'custom' | 'refill' | 'new' };
type HistorySale = {
  id: number;
  customer_name: string;
  sold_by_name: string;
  note?: string;
  items: { cylinder_type_name: string; quantity: number; rate: number; empty_returned: number }[];
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  created_at: string;
  payments: { amount: number; mode: string }[];
};

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'gpay', label: 'GPay', icon: Smartphone },
  { value: 'bank', label: 'Bank', icon: Building2 },
  { value: 'credit', label: 'Credit', icon: CreditCard },
  { value: 'split', label: 'Split', icon: Plus },
];

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

export default function Sales() {
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [cylinderTypes, setCylinderTypes] = useState<CylinderType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // Customer search
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  type CustomerSuggestion = { id: number; name: string; phone: string; address: string; pending_balance: number; empties_owed: Record<number, { owed: number; name: string }>; sales_count: number; custom_rates: any[]; empty_credits: Record<number, { credit: number; name: string }>; is_active?: boolean };
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null);
  const [location, setLocation] = useState(0);

  // Sale items (start empty — user adds as needed)
  const [items, setItems] = useState<SaleItem[]>([]);
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [paidPaymentMode, setPaidPaymentMode] = useState('cash');
  const [saleSplit, setSaleSplit] = useState({ cash: '', gpay: '', bank: '' });

  // Past pending collection
  const [pastAmount, setPastAmount] = useState('');
  const [pastPaymentMode, setPastPaymentMode] = useState('cash');
  const [pastSplit, setPastSplit] = useState({ cash: '', gpay: '', bank: '' });

  // Empty-return-only mode
  const [returnMode, setReturnMode] = useState(false);
  const [returnEmpties, setReturnEmpties] = useState<{ cylinder_type: number; quantity: number | string }[]>([]);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refStatus, setRefStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refError, setRefError] = useState('');

  // Stock availability
  const [stockData, setStockData] = useState<{ cylinder_type: number; location: number; status: string; quantity: number }[]>([]);
  const [stockError, setStockError] = useState('');

  // History state
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
  const [search, setSearch] = useState('');
  const [filterPending, setFilterPending] = useState(false);
  const historyPager = usePager(sales, 10, `${search}|${filterPending}`);

  function loadReferenceData() {
    Promise.all([fetchAllPages<CylinderType>('/cylinder-types/'), fetchAllPages<Location>('/locations/')])
      .then(([types, allLocs]) => {
        const locs = allLocs.filter((l) => !l.is_main_supplier && l.code !== 'supplier');
        setCylinderTypes(types);
        setLocations(locs);
        const savedLoc = localStorage.getItem('lastSalesLoc');
        if (savedLoc && locs.find(l => l.id === Number(savedLoc))) {
          setLocation(Number(savedLoc));
        } else {
          setLocation(locs[0]?.id ?? 1);
        }
        setRefError('');
        setRefStatus('ready');
        // Don't pre-populate items — user adds when ready
      })
      .catch((err) => {
        setRefError(extractApiError(err, [], 'Could not load cylinder types and locations.'));
        setRefStatus('error');
      });
  }

  useEffect(() => { loadReferenceData(); }, []);

  useEffect(() => {
    if (location) localStorage.setItem('lastSalesLoc', String(location));
  }, [location]);

  // Fetch stock whenever location changes
  useEffect(() => {
    if (!location || locations.length === 0) return;
    const loc = locations.find(l => l.id === location);
    if (!loc) return;
    fetchAllPages<{ cylinder_type: number; location: number; status: string; quantity: number }>('/stock/', { location: loc.code, status: 'filled' })
      .then((rows) => { setStockData(rows); setStockError(''); })
      .catch((err) => setStockError(extractApiError(err, [], 'Stock levels unavailable.')));
  }, [location, locations]);

  useEffect(() => {
    if (!customerName.trim() || selectedCustomerId !== null) {
      setCustomerSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchAllPages<CustomerSuggestion>('/customers/', { search: customerName }, 2)
        .then((rows) => {
          if (cancelled) return;
          // Deactivated customers cannot take new sales.
          setCustomerSuggestions(rows.filter((c) => c.is_active !== false).slice(0, 5));
        })
        .catch(() => undefined);
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerName, selectedCustomerId]);

  function fetchHistory() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterPending) params.pending = '1';
    fetchAllPages<HistorySale>('/sales/', params)
      .then((rows) => { setSales(rows); setHistoryError(''); setHistoryStatus('ready'); })
      .catch((err) => {
        setHistoryError(extractApiError(err, [], 'Could not load sales history.'));
        setHistoryStatus('error');
      });
  }

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab, search, filterPending]);

  // ── Item helpers ──────────────────────────────────────────────────────────

  // ── Item helpers ──────────────────────────────────────────────────────────

  function getApplicableRate(cylinder_type: number, rate_type: 'custom' | 'refill' | 'new', customer: any | null) {
    const t = cylinderTypes.find(c => c.id === cylinder_type);
    if (!t) return '0';
    if (rate_type === 'custom') {
      const custom = customer?.custom_rates?.find((cr: any) => cr.cylinder_type === cylinder_type);
      return custom ? String(custom.custom_price) : String(t.refill_rate);
    } else if (rate_type === 'refill') {
      return String(t.refill_rate);
    } else {
      return String(t.selling_price);
    }
  }

  function updateItem(index: number, patch: Partial<SaleItem>) {
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], ...patch };

      // If cylinder_type or rate_type changes, update the rate automatically
      if (patch.cylinder_type !== undefined || patch.rate_type !== undefined) {
        item.rate = getApplicableRate(item.cylinder_type, item.rate_type, selectedCustomer);
      }

      next[index] = item;
      return next;
    });
  }

  function addItem() {
    const t = cylinderTypes[0];
    if (!t) return;
    const hasCustom = selectedCustomer?.custom_rates?.find((cr: any) => cr.cylinder_type === t.id);
    const initialRateType = hasCustom ? 'custom' : 'refill';
    const rate = getApplicableRate(t.id, initialRateType, selectedCustomer);
    const newItem: SaleItem = { cylinder_type: t.id, quantity: 1, rate, empty_returned: 1, rate_type: initialRateType };
    setItems((prev) => [...prev, newItem]);
  }

  // Update rates if customer selection changes
  useEffect(() => {
    if (items.length > 0) {
      setItems((prev) => prev.map(item => ({
        ...item,
        rate: getApplicableRate(item.cylinder_type, item.rate_type, selectedCustomer)
      })));
    }
  }, [selectedCustomer]);

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Empty-return-only helpers ─────────────────────────────────────────────

  function addReturnRow() {
    const selectedIds = new Set(returnEmpties.map(r => r.cylinder_type));
    const firstAvailable = cylinderTypes.find(t => !selectedIds.has(t.id));
    if (!firstAvailable) return;
    setReturnEmpties((prev) => [...prev, { cylinder_type: firstAvailable.id, quantity: 1 }]);
  }

  function updateReturnRow(index: number, patch: Partial<{ cylinder_type: number; quantity: number | string }>) {
    setReturnEmpties((prev) => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  }

  function removeReturnRow(index: number) {
    setReturnEmpties((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * Number(item.rate || 0), 0),
    [items],
  );
  const paid = paymentMode === 'split' ? (Number(saleSplit.cash || 0) + Number(saleSplit.gpay || 0) + Number(saleSplit.bank || 0)) : (paymentMode === 'credit' ? Number(paidAmount || 0) : total);
  const balance = Math.max(total - paid, 0);

  const pastTotal = pastPaymentMode === 'split' ? (Number(pastSplit.cash || 0) + Number(pastSplit.gpay || 0) + Number(pastSplit.bank || 0)) : Number(pastAmount || 0);

  // ── Submit sale ───────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(''); setError('');
    if (items.length === 0) { setError('Add at least one cylinder item.'); return; }
    if (selectedCustomer && pastTotal > Number(selectedCustomer.pending_balance)) {
      setError(`Cannot collect past payment greater than the pending balance of Rs. ${selectedCustomer.pending_balance}.`);
      return;
    }
    setSaving(true);
    try {
      let customerId: number | null = selectedCustomerId;
      if (!customerId) {
        if (!customerName.trim()) {
          setError('Please select a customer or enter details to register a new one.');
          return;
        }
        if (!phone.trim()) {
          setError('Phone number is required to register a new customer.');
          return;
        }
        const res = await api.post('/customers/', { name: customerName.trim(), phone, address });
        customerId = res.data.id;
      }
      const salePayload: any = {
        customer: customerId,
        location,
        payment_mode: paymentMode,
        paid_amount: paid,
        sale_items: items.map((item) => ({
          cylinder_type: item.cylinder_type,
          quantity: Number(item.quantity) || 1,
          rate: item.rate,
          empty_returned: Number(item.empty_returned) || 0,
        })),
      };

      if (paymentMode === 'split') {
        salePayload.split_payments = [];
        if (Number(saleSplit.cash) > 0) salePayload.split_payments.push({ mode: 'cash', amount: Number(saleSplit.cash) });
        if (Number(saleSplit.gpay) > 0) salePayload.split_payments.push({ mode: 'gpay', amount: Number(saleSplit.gpay) });
        if (Number(saleSplit.bank) > 0) salePayload.split_payments.push({ mode: 'bank', amount: Number(saleSplit.bank) });
      } else {
        salePayload.paid_payment_mode = paidPaymentMode;
      }

      await api.post('/sales/', salePayload);

      if (pastTotal > 0 && customerId) {
        if (pastPaymentMode === 'split') {
          if (Number(pastSplit.cash) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.cash), payment_mode: 'cash', note: 'Past pending collected during sale' });
          if (Number(pastSplit.gpay) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.gpay), payment_mode: 'gpay', note: 'Past pending collected during sale' });
          if (Number(pastSplit.bank) > 0) await api.post('/payments/', { customer: customerId, amount: Number(pastSplit.bank), payment_mode: 'bank', note: 'Past pending collected during sale' });
        } else {
          await api.post('/payments/', {
            customer: customerId,
            amount: pastTotal,
            payment_mode: pastPaymentMode,
            note: 'Past pending collected during sale',
          });
        }
      }

      setMessage(`Sale saved! Total ${money(total)}, Balance ${money(balance)}${pastTotal > 0 ? `, and collected ${money(pastTotal)} for past dues` : ''}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setPaidAmount(''); setPaymentMode('cash'); setPaidPaymentMode('cash'); setSaleSplit({ cash: '', gpay: '', bank: '' });
      setPastAmount(''); setPastPaymentMode('cash'); setPastSplit({ cash: '', gpay: '', bank: '' });
      setItems([]);
    } catch (err: unknown) {
      setError(extractApiError(err, ['name', 'phone', 'address', 'customer', 'location', 'sale_items', 'paid_amount', 'split_payments', 'non_field_errors'], 'Failed to save sale. Check backend connection.'));
    } finally {
      setSaving(false);
    }
  }

  // ── Submit empty-return-only ──────────────────────────────────────────────

  async function handleReturnSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(''); setError('');
    if (!selectedCustomerId) { setError('Select a customer to record empty returns.'); return; }
    if (returnEmpties.length === 0) { setError('Add at least one cylinder type to return.'); return; }
    const totalEmpties = returnEmpties.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    setSaving(true);
    try {
      await api.post('/sales/', {
        customer: selectedCustomerId,
        location,
        payment_mode: 'cash',
        paid_amount: 0,
        note: 'Empty cylinders returned',
        sale_items: returnEmpties.map((r) => ({
          cylinder_type: r.cylinder_type,
          quantity: 0,
          rate: 0,
          empty_returned: Number(r.quantity) || 1,
        })),
      });
      const locName = locations.find(l => l.id === location)?.name || '';
      setMessage(`Recorded ${totalEmpties} empty cylinder(s) returned at ${locName}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setReturnEmpties([]);
      setReturnMode(false);
    } catch (err: unknown) {
      setError(extractApiError(err, ['customer', 'location', 'sale_items', 'non_field_errors'], 'Failed to record return.'));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader title="Sales" description="Multi-cylinder invoice entry and history." />

      {/* Tab switcher */}
      <Tabs
        ariaLabel="Sales sections"
        variant="tabs"
        className="page-tabs"
        value={tab}
        onChange={setTab}
        items={[{ value: 'new', label: 'New Sale' }, { value: 'history', label: 'History' }]}
      />

      {tab === 'new' && refStatus === 'loading' && <LoadingState label="Loading sale setup…" />}
      {tab === 'new' && refStatus === 'error' && <ErrorState message={refError} onRetry={() => { setRefStatus('loading'); loadReferenceData(); }} />}

      {tab === 'new' && refStatus === 'ready' && (
        <div className="sale-form">
          {/* Mode toggle: Sale vs Return Empties */}
          <Tabs
            ariaLabel="Sale mode"
            block
            value={returnMode ? 'return' : 'sale'}
            onChange={(mode) => {
              setReturnMode(mode === 'return');
              setError('');
              setMessage('');
            }}
            items={[
              { value: 'sale', label: 'Sale', icon: <Receipt /> },
              { value: 'return', label: 'Return Empties Only', icon: <RotateCcw /> },
            ]}
          />

          {/* Customer section — shared between both modes */}
          <Card className="sale-card sale-card--overflow">
            <CardHeader title="Customer" />
            <div className="grid-2">
              <Field label="Name">
                <div className="sale-search">
                  <Input
                    leadingIcon={<User />}
                    value={customerName}
                    onChange={(e) => { setCustomerName(e.target.value); setSelectedCustomerId(null); }}
                    placeholder="Search or enter new customer"
                    autoComplete="off"
                    maxLength={LIMITS.name}
                  />
                  {customerSuggestions.length > 0 && (
                    <div className="dropdown-list">
                      {customerSuggestions.map((c) => (
                        <button key={c.id} type="button" className="suggest-item"
                          onClick={() => {
                  setCustomerName(c.name);
                  setPhone(c.phone);
                  setAddress(c.address);
                  setSelectedCustomerId(c.id);
                  setSelectedCustomer(c);
                  setCustomerSuggestions([]);
                }}>
                          <span className="suggest-item__main">
                            <strong>{c.name}</strong>
                            {c.phone && <span className="suggest-item__phone">{c.phone}</span>}
                            {c.address && <span className="suggest-item__address">{c.address}</span>}
                          </span>
                          {Number(c.pending_balance) > 0 && (
                            <Badge tone="warning" size="sm">Due {money(c.pending_balance)}</Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
              <Field label="Phone">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Required for new customer" maxLength={LIMITS.phone} inputMode="numeric" pattern="[0-9]*" title="Only digits allowed" required={Boolean(customerName.trim() && selectedCustomerId === null && !returnMode)} />
              </Field>
            </div>
            <div className="grid-2 sale-card__row">
              <Field label="Address">
                <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Location">
                <Select value={location} onChange={(e) => setLocation(Number(e.target.value))}>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              </Field>
            </div>

            {selectedCustomer && (
              <div className="sale-summary">
                <div className="ui-tile">
                  <span className="ui-tile__label">Payment Due</span>
                  {Number(selectedCustomer.pending_balance) > 0 ? (
                    <strong className="ui-tile__value sale-summary__due">{money(selectedCustomer.pending_balance)}</strong>
                  ) : (
                    <span className="sale-summary__ok">Settled</span>
                  )}
                </div>
                <div className="ui-tile">
                  <span className="ui-tile__label">Empties Owed</span>
                  {selectedCustomer.empties_owed && Object.values(selectedCustomer.empties_owed).length > 0 ? (
                    <div className="sale-summary__badges">
                      {Object.values(selectedCustomer.empties_owed).map((ec: any) => (
                        <Badge key={ec.name} tone="danger">{ec.owed} × {ec.name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="sale-summary__ok">None</span>
                  )}
                </div>
                <div className="ui-tile">
                  <span className="ui-tile__label">Empty Credits</span>
                  {selectedCustomer.empty_credits && Object.values(selectedCustomer.empty_credits).length > 0 ? (
                    <div className="sale-summary__badges">
                      {Object.values(selectedCustomer.empty_credits).map((ec: any) => (
                        <Badge key={ec.name} tone="success">{ec.credit} × {ec.name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="sale-summary__muted">No credits</span>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* ── RETURN EMPTIES MODE ── */}
          {returnMode && (
            <form onSubmit={handleReturnSubmit} className="form-stack">
              <Card className="sale-card">
                <CardHeader
                  title={<span className="sale-card__title"><RotateCcw size={18} aria-hidden="true" />Empty Cylinders Returned</span>}
                  meta={returnEmpties.length < cylinderTypes.length ? (
                    <Button type="button" variant="secondary" size="sm" icon={<Plus />} onClick={addReturnRow}>Add</Button>
                  ) : undefined}
                />

                {returnEmpties.length === 0 && (
                  <p className="sale-hint">
                    Click "+ Add" to add cylinders being returned.
                  </p>
                )}

                <div className="sale-rows">
                  {returnEmpties.map((row, i) => (
                    <div key={i} className="sale-return-row">
                      <Field label="Cylinder Type" className="sale-return-row__type">
                        <Select value={row.cylinder_type} onChange={(e) => updateReturnRow(i, { cylinder_type: Number(e.target.value) })}>
                          {cylinderTypes.filter(t => !returnEmpties.some((r, j) => j !== i && r.cylinder_type === t.id)).map((t) => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Qty Returned" className="sale-return-row__qty">
                        <Input
                          type="number" min="1" placeholder="0"
                          className="sale-num"
                          value={row.quantity}
                          onChange={(e) => updateReturnRow(i, { quantity: e.target.value })}
                        />
                      </Field>
                      <IconButton type="button" label="Remove" tone="danger" className="sale-return-row__remove" onClick={() => removeReturnRow(i)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  ))}
                </div>

                {returnEmpties.length > 0 && (
                  <div className="sale-total-line">
                    <span>Total Cylinders Returned</span>
                    <strong className="ui-num-success">
                      {returnEmpties.reduce((s, r) => s + (Number(r.quantity) || 0), 0)} cylinder(s)
                    </strong>
                  </div>
                )}
              </Card>

              {error && <Alert tone="danger" role="alert">{error}</Alert>}
              {message && <Alert tone="success">{message}</Alert>}

              <div className="sale-submit">
                <Button type="submit" size="lg" icon={<RotateCcw />} disabled={saving}>
                  {saving ? 'Saving…' : 'Record Empty Return'}
                </Button>
              </div>
            </form>
          )}

          {/* ── SALE MODE ── */}
          {!returnMode && (
            <form onSubmit={handleSubmit} className="form-stack">
              {/* Cylinder Items */}
              <Card className="sale-card">
                <CardHeader
                  title="Cylinders"
                  meta={<Button type="button" variant="secondary" size="sm" icon={<Plus />} onClick={addItem}>Add</Button>}
                />

                {items.length === 0 && (
                  <p className="sale-hint">
                    Click "+ Add" to add cylinder items.
                  </p>
                )}

                <div className="sale-rows">
                  {items.map((item, i) => {
                    const type = cylinderTypes.find((c) => c.id === item.cylinder_type);
                    const isCustomRate = item.rate !== '' &&
                      Number(item.rate) !== Number(type?.selling_price) &&
                      Number(item.rate) !== Number(type?.refill_rate);
                    const available = stockData.find(s => s.cylinder_type === type?.id)?.quantity ?? 0;
                    return (
                      <div key={i} className="sale-item">
                        <div className="sale-item__head">
                          <div className="sale-item__title">
                            <strong>Item {i + 1}</strong>
                            <Badge
                              size="sm"
                              tone={stockError ? 'neutral' : available > 0 ? 'success' : 'danger'}
                              title={stockError || undefined}
                              icon={<span className="sale-dot" />}
                            >
                              {stockError ? 'stock unknown' : `${available} in stock`}
                            </Badge>
                            {isCustomRate && <Badge tone="warning" size="sm">Custom Price</Badge>}
                          </div>
                          <IconButton type="button" label="Remove item" tone="danger" size="sm" onClick={() => removeItem(i)}>
                            <Trash2 size={16} />
                          </IconButton>
                        </div>

                        <div className="sale-item__grid">
                          <Field label="Cylinder" className="sale-item__cylinder">
                            <Select value={item.cylinder_type} onChange={(e) => updateItem(i, { cylinder_type: Number(e.target.value) })}>
                              {cylinderTypes.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Rate Type">
                            <Select value={item.rate_type} onChange={(e) => updateItem(i, { rate_type: e.target.value as 'custom' | 'refill' | 'new' })}>
                              {selectedCustomer?.custom_rates?.some((cr: any) => cr.cylinder_type === item.cylinder_type) && (
                                <option value="custom">Agreed Rate</option>
                              )}
                              <option value="refill">Refill</option>
                              <option value="new">New Cylinder</option>
                            </Select>
                          </Field>
                          <Field label="Rate (Rs.)">
                            <Input type="number" min="0" value={item.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} />
                          </Field>
                          <Field label="Qty">
                            <Input
                              type="number" min="1" placeholder="0"
                              className="sale-num"
                              value={item.quantity}
                              onChange={(e) => updateItem(i, { quantity: e.target.value })}
                            />
                          </Field>
                          <Field label="Empty Returned">
                            <Input
                              type="number" min="0" placeholder="0"
                              className="sale-num"
                              value={item.empty_returned}
                              onChange={(e) => updateItem(i, { empty_returned: e.target.value })}
                            />
                          </Field>
                        </div>

                        <div className="sale-item__foot">
                          {/* Quick qty buttons */}
                          <ChoiceChips
                            ariaLabel="Quick quantity"
                            size="sm"
                            value={typeof item.quantity === 'number' ? item.quantity : null}
                            onChange={(q) => updateItem(i, { quantity: q })}
                            options={[1, 2, 5, 10].map((q) => ({ value: q, label: String(q) }))}
                          />

                          <strong className="sale-item__total">
                            {money((Number(item.quantity) || 0) * Number(item.rate || 0))}
                          </strong>
                        </div>

                        {item.rate_type !== 'new' && Number(item.empty_returned) < Number(item.quantity) && (
                          <Alert tone="warning" compact>
                            Warning: Quantity is {item.quantity} but only {item.empty_returned} empty returned. Ensure customer has empty credits or change Rate Type to New Cylinder.
                          </Alert>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Payment */}
              <Card className="sale-card">
                <CardHeader title="Payment" />

                <ChoiceChips
                  ariaLabel="Payment mode"
                  layout="icon"
                  className="sale-pay-modes"
                  value={paymentMode}
                  onChange={setPaymentMode}
                  options={PAYMENT_MODES.map(({ value, label, icon: Icon }) => ({ value, label, icon: <Icon size={18} /> }))}
                />

                {paymentMode === 'credit' && (
                  <div className="grid-2 sale-card__row">
                    <Field label="Amount Received (Rs.)">
                      <Input type="number" min="0" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} placeholder="0" />
                    </Field>
                    {Number(paidAmount) > 0 && (
                      <Field label="Received Via">
                        <Select value={paidPaymentMode} onChange={(e) => setPaidPaymentMode(e.target.value)}>
                          {PAYMENT_MODES.filter(m => m.value !== 'credit' && m.value !== 'split').map(m => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
                )}

                {paymentMode === 'split' && (
                  <div className="split-grid split-grid--4 sale-card__row">
                    <Field label="Cash Paid">
                      <Input type="number" min="0" value={saleSplit.cash} onChange={(e) => setSaleSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                    </Field>
                    <Field label="GPay Paid">
                      <Input type="number" min="0" value={saleSplit.gpay} onChange={(e) => setSaleSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                    </Field>
                    <Field label="Bank Paid">
                      <Input type="number" min="0" value={saleSplit.bank} onChange={(e) => setSaleSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                    </Field>
                    <Field label="Credit (Pending)">
                      <Input type="number" disabled className="split-grid__remaining" value={balance > 0 ? balance : 0} />
                    </Field>
                  </div>
                )}

                <div className="sale-total">
                  <span className="sale-total__label">Grand Total</span>
                  <strong className="sale-total__value">{money(total)}</strong>
                  {balance > 0 && <span className="sale-total__pending">Pending: {money(balance)}</span>}
                  {balance === 0 && total > 0 && <span className="sale-total__paid"><CheckCircle2 size={14} aria-hidden="true" /> Fully paid</span>}
                </div>
              </Card>

              {selectedCustomer && Number(selectedCustomer.pending_balance) > 0 && (
                <Card className="sale-card sale-card--dues">
                  <CardHeader
                    title={<span className="sale-card__title"><AlertTriangle size={18} aria-hidden="true" />Past Pending Balance: {money(selectedCustomer.pending_balance)}</span>}
                    description="You can collect payment for past dues along with this sale."
                  />
                  <div className="grid-2">
                    <Field label="Collect Past Pending (Rs.)" className={pastPaymentMode === 'split' ? 'ui-hidden' : undefined}>
                      <Input type="number" min="0" max={selectedCustomer.pending_balance} value={pastAmount} onChange={(e) => setPastAmount(e.target.value)} placeholder="0" />
                    </Field>
                    <Field label="Received Via">
                      <Select value={pastPaymentMode} onChange={(e) => setPastPaymentMode(e.target.value)}>
                        {PAYMENT_MODES.filter(m => m.value !== 'credit').map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  {pastPaymentMode === 'split' && (
                    <div className="split-grid split-grid--4 sale-card__row">
                      <Field label="Cash">
                        <Input type="number" min="0" value={pastSplit.cash} onChange={(e) => setPastSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                      </Field>
                      <Field label="GPay">
                        <Input type="number" min="0" value={pastSplit.gpay} onChange={(e) => setPastSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                      </Field>
                      <Field label="Bank">
                        <Input type="number" min="0" value={pastSplit.bank} onChange={(e) => setPastSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                      </Field>
                      <Field label="Credit Remaining">
                        <Input type="number" disabled className="split-grid__remaining" value={Math.max(0, Number(selectedCustomer.pending_balance) - pastTotal)} />
                      </Field>
                    </div>
                  )}
                </Card>
              )}

              {error && <Alert tone="danger" role="alert">{error}</Alert>}
              {message && <Alert tone="success">{message}</Alert>}

              <div className="sale-submit">
                <Button type="submit" size="lg" icon={<Plus />} disabled={saving}>
                  {saving ? 'Saving…' : 'Complete Sale'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div>
          <div className="ui-toolbar">
            <div className="ui-toolbar__grow">
              <SearchInput aria-label="Search sales" placeholder="Search customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button
              type="button"
              variant={filterPending ? 'primary' : 'secondary'}
              aria-pressed={filterPending}
              onClick={() => setFilterPending((p) => !p)}
            >
              Pending only
            </Button>
          </div>

          {historyStatus === 'error' && <ErrorState message={historyError} onRetry={() => { setHistoryStatus('loading'); fetchHistory(); }} />}
          {historyStatus !== 'error' && (
          <Card padding="none">
            {historyStatus === 'loading' && (
              <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={6} label="Loading sales…" /></div>
            )}
            {historyStatus === 'ready' && sales.length === 0 && (
              <EmptyState icon={<Receipt size={24} />} title="No sales found." />
            )}
            {historyStatus === 'ready' && sales.length > 0 && (
            <TableWrap fade>
              <Table stickyFirst className="sales-history-table">
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Items</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Balance</Th>
                    <Th>Mode</Th>
                    <Th>Staff</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {historyPager.pageItems.map((sale) => {
                    const isReturn = sale.note === 'Empty cylinders returned';
                    return (
                    <tr key={sale.id}>
                      <Td><strong className="sh-customer">{sale.customer_name}</strong></Td>
                      <Td><SaleItemsCell customerName={sale.customer_name} items={sale.items} /></Td>
                      <Td numeric>
                        {isReturn ? <span className="ui-num-placeholder">-</span> : <span className="ui-num-strong">{money(sale.total_amount)}</span>}
                      </Td>
                      <Td align="right">
                        {isReturn ? <span className="ui-num-placeholder">-</span> : (
                          Number(sale.balance_due) > 0
                            ? <Badge tone="warning">{money(sale.balance_due)}</Badge>
                            : <Badge tone="success">Paid</Badge>
                        )}
                      </Td>
                      <Td className="sh-nowrap">
                        {isReturn ? (
                          <Badge variant="outline" icon={<RotateCcw />}>Return</Badge>
                        ) : (
                          <div className="sh-mode">
                            <Badge variant="outline">{sale.payment_mode}</Badge>
                            {(sale.payment_mode === 'split' || sale.payment_mode === 'credit') && sale.payments && sale.payments.length > 0 && (
                              <span className="ui-cell-sub">
                                {sale.payments.map(p => `${p.mode.toUpperCase()} ${p.amount}`).join(' + ')}
                              </span>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td className="sh-meta">{sale.sold_by_name}</Td>
                      <Td className="sh-meta sh-nowrap">
                        {new Date(sale.created_at).toLocaleDateString('en-IN')}
                      </Td>
                    </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
            )}
            {historyStatus === 'ready' && historyPager.pageCount > 1 && (
              <CardFooter>
                <Pager page={historyPager.page} pageCount={historyPager.pageCount} onChange={historyPager.setPage} total={historyPager.total} />
              </CardFooter>
            )}
          </Card>
          )}
        </div>
      )}
    </div>
  );
}
