import { PaymentSummary, type PaymentFacts } from '../components/PaymentSummary';
import { DirectSaleRates } from '../components/DirectSaleRates';
import { formatDateTime } from '../lib/dateTime';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle, Banknote, Building2, CheckCircle2, CreditCard, Plus,
  Receipt, RotateCcw, Smartphone, Trash2, User,
} from 'lucide-react';
import { api, extractApiError, fetchAllPages, getApiErrorCode, LIMITS, newClientRef } from '../lib/api';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';
import { usePager } from '../hooks/usePager';
import { SaleItemsCell } from '../components/SaleItemsCell';
import { ConfirmRefundModal, VoidSaleModal, VoidStatusBadges, type SalePaymentRow, type SaleVoidInfo } from '../components/SaleVoidDialogs';
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
import { fetchActiveCylinderTypes, fetchActiveLocations, useCatalogRevision } from '../lib/catalog';

type CylinderType = { id: number; name: string; deposit_amount: number; refill_rate: number };
type Location = { id: number; name: string; code: string; is_main_supplier: boolean };
type AccessoryProduct = { id: number; name: string; selling_price: string; is_active: boolean; available: boolean; stock: number; reserved: number };
type AccessoryLine = { product: number; quantity: number | string };
type SaleItem = { cylinder_type: number; quantity: number | string; empty_returned: number | string; rate_type: 'refill' | 'new'; rate?: string; deposit?: string };
// The server validates active admins and eligible staff using the same handover rule.
type StaffOption = { id: number; user: number; username: string; first_name: string; last_name: string; role: string; can_hand_over: boolean };
type HistorySale = {
  payment_summary?: PaymentFacts;
  id: number;
  customer_name: string;
  sold_by_name: string;
  sold_by_full_name: string;
  handover_staff_name: string | null;
  is_direct: boolean;
  void: SaleVoidInfo | null;
  note?: string;
  accessory_items?: import('../components/BookingItems').BookingItem[];
  items: { cylinder_type_name: string; quantity: number; rate: number; empty_returned: number }[];
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  created_at: string;
  payments: SalePaymentRow[];
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

/** The payments that paid for a sale (refunds and credit reversals are shown with its cancellation). */
function originalPayments(sale: { payments: SalePaymentRow[] }) {
  return (sale.payments ?? []).filter((p) => p.kind === 'payment');
}

function staffName(s: StaffOption) {
  const name = `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.username;
  return `${name} · ${s.role === 'admin' ? 'Admin' : 'Staff'}`;
}

type ExistingCustomer = { id: number; name: string; phone: string };
type CustomerSuggestion = {
  id: number; name: string; phone: string; address: string; pending_balance: number | string;
  credit_balance: number | string; empties_owed: Record<number, { owed: number; name: string }>;
  sales_count: number; custom_rates: { cylinder_type: number; custom_price: string }[];
  empty_credits: Record<number, { credit: number; name: string }>; is_active?: boolean;
};
type SalePayload = {
  client_ref: string; location: number; payment_mode: string; paid_amount: string; quoted_total: string;
  sale_items: SaleItem[]; accessory_lines: AccessoryLine[]; handover_staff?: number; customer?: number;
  new_customer?: { name: string; phone: string; address: string }; paid_payment_mode?: string;
  split_payments?: { mode: string; amount: number }[]; past_due_payments?: { mode: string; amount: string }[];
};

/** The customer already using a phone number, when a new-customer sale was refused for it. */
function duplicateCustomerFrom(err: unknown): ExistingCustomer | null {
  if (getApiErrorCode(err) !== 'duplicate_phone') return null;
  return (err as { response?: { data?: { existing_customer?: ExistingCustomer } } }).response?.data?.existing_customer ?? null;
}

/** A request whose client_ref already recorded a sale: an earlier attempt went through. */
function isReusedClientRef(err: unknown): boolean {
  return getApiErrorCode(err) === 'client_ref_reused';
}

export default function Sales() {
  const [tab, setTab] = useState<'new' | 'history'>('new');
  const [cylinderTypes, setCylinderTypes] = useState<CylinderType[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  // Customer search
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSuggestion | null>(null);
  const [location, setLocation] = useState(0);
  // Who physically handed the cylinders over (optional). The server accepts only active staff.
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const handoverOptions = staffOptions.filter((s) => s.can_hand_over);
  const [staffLoadError, setStaffLoadError] = useState('');
  const [handoverStaff, setHandoverStaff] = useState('');

  // Sale items (start empty — user adds as needed)
  const [items, setItems] = useState<SaleItem[]>([]);
  const [products, setProducts] = useState<AccessoryProduct[]>([]);
  const [accessories, setAccessories] = useState<AccessoryLine[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState('');
  const [productsRevision, setProductsRevision] = useState(0);
  const availableProducts = products.filter(p => p.is_active && p.available && p.stock > p.reserved);
  const nextProduct = availableProducts.find(p => !accessories.some(line => line.product === p.id));
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
  // Identifies this sale for the server; kept across retries, renewed after each saved sale.
  const [clientRef, setClientRef] = useState(newClientRef);
  const [existingCustomer, setExistingCustomer] = useState<ExistingCustomer | null>(null);
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
  const [filterHandover, setFilterHandover] = useState('');
  const [filterVoid, setFilterVoid] = useState('');
  const historyPager = usePager(sales, 10, `${search}|${filterPending}|${filterHandover}|${filterVoid}`);
  // Cancelling a sale and confirming its refund (components/SaleVoidDialogs).
  const [voidSaleId, setVoidSaleId] = useState<number | null>(null);
  const [refundSale, setRefundSale] = useState<HistorySale | null>(null);
  const [historyNotice, setHistoryNotice] = useState('');

  function loadReferenceData() {
    // Only active cylinder types and active stock locations can take a new sale (the server enforces the same).
    Promise.all([fetchActiveCylinderTypes(), fetchActiveLocations('stock')])
      .then(([types, locs]) => {
        setCylinderTypes(types as unknown as CylinderType[]);
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

  const catalogRevision = useCatalogRevision();
  useEffect(() => { loadReferenceData(); }, [catalogRevision]);

  useEffect(() => {
    let cancelled = false;
    fetchAllPages<AccessoryProduct>('/products/').then(rows => {
      if (!cancelled) { setProducts(rows); setProductsError(''); }
    }).catch(err => {
      if (!cancelled) setProductsError(extractApiError(err, [], 'Could not load accessories.'));
    }).finally(() => { if (!cancelled) setProductsLoading(false); });
    return () => { cancelled = true; };
  }, [productsRevision]);

  // Optional field: if the list cannot load, the sale can still be recorded without it.
  useEffect(() => {
    fetchAllPages<StaffOption>('/sales/handover-options/')
      .then((rows) => { setStaffOptions(rows); setStaffLoadError(''); })
      .catch((err) => setStaffLoadError(extractApiError(err, [], 'Could not load the handover list.')));
  }, []);

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

  const fetchHistory = useCallback(() => {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filterPending) params.pending = '1';
    if (filterHandover) params.handover_staff = filterHandover;
    if (filterVoid) params.void_status = filterVoid;
    fetchAllPages<HistorySale>('/sales/', params)
      .then((rows) => { setSales(rows); setHistoryError(''); setHistoryStatus('ready'); })
      .catch((err) => {
        setHistoryError(extractApiError(err, [], 'Could not load sales history.'));
        setHistoryStatus('error');
      });
  }, [search, filterPending, filterHandover, filterVoid, setSales, setHistoryError, setHistoryStatus]);

  useEffect(() => {
    if (tab === 'history') fetchHistory();
  }, [tab, fetchHistory]);

  // ── Item helpers ──────────────────────────────────────────────────────────

  // ── Item helpers ──────────────────────────────────────────────────────────

  function updateItem(index: number, patch: Partial<SaleItem>) {
    setItems(prev => prev.map((item, i) => i === index
      ? { ...item, ...(patch.cylinder_type !== undefined ? { rate: undefined, deposit: undefined } : {}), ...patch }
      : item));
  }

  function itemAmounts(item: SaleItem) {
    const cylinder = cylinderTypes.find(type => type.id === item.cylinder_type);
    const agreed = selectedCustomer && selectedCustomerId === selectedCustomer.id
      ? selectedCustomer.custom_rates?.find((value: { cylinder_type: number; custom_price: string }) => value.cylinder_type === item.cylinder_type)
      : undefined;
    return {
      refill: item.rate ?? String(agreed?.custom_price ?? cylinder?.refill_rate ?? 0),
      deposit: item.rate_type === 'new' ? item.deposit ?? String(cylinder?.deposit_amount ?? 0) : '0',
    };
  }

  function itemSubtotal(item: SaleItem) {
    const { refill, deposit } = itemAmounts(item);
    return (Math.round(Number(refill) * 100) + Math.round(Number(deposit) * 100)) * Number(item.quantity) / 100;
  }

  function addItem() {
    const cylinder = cylinderTypes[0];
    if (cylinder) setItems(prev => [...prev, { cylinder_type: cylinder.id, quantity: 1, empty_returned: 1, rate_type: 'refill' }]);
  }

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

  type Quote = { total_amount: string; discount_amount: string; accessory_items?: { name: string; quantity: number; rate: string; total_amount: string }[] };
  const [quote, setQuote] = useState<{ key: string; data?: Quote; error?: string } | null>(null);
  const [quoteRevision, setQuoteRevision] = useState(0);
  const quoteRequest = JSON.stringify({ customer: selectedCustomerId, sale_items: items.map(item => ({
    cylinder_type: item.cylinder_type, quantity: Number(item.quantity), rate_type: item.rate_type,
    empty_returned: Number(item.empty_returned),
    refill_charge: itemAmounts(item).refill, deposit: itemAmounts(item).deposit,
  })), accessory_lines: accessories.map(line => ({ product: line.product, quantity: Number(line.quantity) })) });
  const quoteKey = `${quoteRevision}:${quoteRequest}`;
  useEffect(() => {
    let cancelled = false;
    if (returnMode || (!items.length && !accessories.length)) return;
    const timer = window.setTimeout(() => {
      api.post<Quote>('/sales/preview/', JSON.parse(quoteRequest))
        .then(({ data }) => { if (!cancelled) setQuote({ key: quoteKey, data }); })
        .catch(err => { if (!cancelled) setQuote({ key: quoteKey, error: extractApiError(err, [], 'Could not calculate pricing.') }); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [quoteRequest, quoteKey, items.length, accessories.length, returnMode]);
  useEffect(() => {
    const refresh = () => {
      fetchActiveCylinderTypes()
        .then(types => { setCylinderTypes(types as unknown as CylinderType[]); setQuoteRevision(value => value + 1); })
        .catch(() => setQuoteRevision(value => value + 1));
    };
    window.addEventListener('gas-rates-changed', refresh);
    return () => window.removeEventListener('gas-rates-changed', refresh);
  }, []);
  const currentQuote = !returnMode && (items.length || accessories.length) && quote?.key === quoteKey ? quote : null;
  // The API combines accessories and returns them in product-ID order.
  const quotedAccessories = new Map([...accessories].sort((a, b) => a.product - b.product)
    .map((line, index) => [line.product, currentQuote?.data?.accessory_items?.[index]]));
  const total = Number(currentQuote?.data?.total_amount ?? 0);
  const paid = paymentMode === 'split' ? (Number(saleSplit.cash || 0) + Number(saleSplit.gpay || 0) + Number(saleSplit.bank || 0)) : (paymentMode === 'credit' ? Number(paidAmount || 0) : total);
  const balance = Math.max(total - paid, 0);

  const pastTotal = pastPaymentMode === 'split' ? (Number(pastSplit.cash || 0) + Number(pastSplit.gpay || 0) + Number(pastSplit.bank || 0)) : Number(pastAmount || 0);

  // ── Submit sale ───────────────────────────────────────────────────────────

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setMessage(''); setError(''); setExistingCustomer(null);
    if (!items.length && !accessories.length) { setError('Add at least one cylinder or accessory.'); return; }
    if (!currentQuote?.data) { setError('Wait for a valid price quote.'); return; }
    if (selectedCustomer && pastTotal > Number(selectedCustomer.pending_balance)) {
      setError(`Cannot collect past payment greater than the pending balance of Rs. ${selectedCustomer.pending_balance}.`);
      return;
    }
    setSaving(true);
    try {
      if (!selectedCustomerId) {
        if (!customerName.trim()) {
          setError('Please select a customer or enter details to register a new one.');
          return;
        }
        if (!phone.trim()) {
          setError('Phone number is required to register a new customer.');
          return;
        }
      }
      // One request records everything (a new customer, the sale, its payments, past dues) or
      // nothing; client_ref makes a retry of the same request return the saved sale.
      const salePayload: SalePayload = {
        client_ref: clientRef,
        location,
        payment_mode: paymentMode,
        // 2-decimal string: float maths turns 899.99 × 3 into 2699.9700000000003, which the server rejects.
        paid_amount: paid.toFixed(2),
        quoted_total: Number(currentQuote.data.total_amount).toFixed(2),
        sale_items: JSON.parse(quoteRequest).sale_items,
        accessory_lines: JSON.parse(quoteRequest).accessory_lines,
      };
      if (handoverStaff) salePayload.handover_staff = Number(handoverStaff);
      if (selectedCustomerId) salePayload.customer = selectedCustomerId;
      else salePayload.new_customer = { name: customerName.trim(), phone: phone.trim(), address };

      if (paymentMode === 'split') {
        salePayload.split_payments = [];
        if (Number(saleSplit.cash) > 0) salePayload.split_payments.push({ mode: 'cash', amount: Number(saleSplit.cash) });
        if (Number(saleSplit.gpay) > 0) salePayload.split_payments.push({ mode: 'gpay', amount: Number(saleSplit.gpay) });
        if (Number(saleSplit.bank) > 0) salePayload.split_payments.push({ mode: 'bank', amount: Number(saleSplit.bank) });
      } else {
        salePayload.paid_payment_mode = paidPaymentMode;
      }

      // Settles the customer's older dues only, never this sale.
      if (pastTotal > 0 && selectedCustomerId) {
        salePayload.past_due_payments = pastPaymentMode === 'split'
          ? (['cash', 'gpay', 'bank'] as const)
              .filter((mode) => Number(pastSplit[mode]) > 0)
              .map((mode) => ({ mode, amount: Number(pastSplit[mode]).toFixed(2) }))
          : [{ mode: pastPaymentMode, amount: pastTotal.toFixed(2) }];
      }

      await api.post('/sales/', salePayload);

      setMessage(`Sale saved! Total ${money(total)}, Balance ${money(balance)}${pastTotal > 0 ? `, and collected ${money(pastTotal)} for past dues` : ''}.`);
      setCustomerName(''); setPhone(''); setAddress(''); setSelectedCustomerId(null); setSelectedCustomer(null);
      setPaidAmount(''); setPaymentMode('cash'); setPaidPaymentMode('cash'); setSaleSplit({ cash: '', gpay: '', bank: '' });
      setPastAmount(''); setPastPaymentMode('cash'); setPastSplit({ cash: '', gpay: '', bank: '' });
      setItems([]);
      setAccessories([]);
      setProductsRevision(value => value + 1);
      setHandoverStaff('');
      setClientRef(newClientRef());
    } catch (err: unknown) {
      setExistingCustomer(duplicateCustomerFrom(err));
      if (isReusedClientRef(err)) {
        setClientRef(newClientRef());
        setError('An earlier attempt of this sale was already saved. Check Sales history before entering it again.');
      } else {
        if (['rate_mismatch', 'quote_changed'].includes(getApiErrorCode(err) ?? '')) setQuoteRevision(value => value + 1);
        setError(extractApiError(err, ['name', 'phone', 'address', 'customer', 'location', 'sale_items', 'accessory_lines', 'paid_amount', 'split_payments', 'handover_staff', 'non_field_errors'], 'Failed to save sale. Check backend connection.'));
      }
    } finally {
      setSaving(false);
    }
  }

  /** After a duplicate-phone refusal, switch the form to the customer who has that number. */
  async function selectExistingCustomer() {
    if (!existingCustomer) return;
    try {
      const { data } = await api.get(`/customers/${existingCustomer.id}/`);
      setCustomerName(data.name); setPhone(data.phone); setAddress(data.address);
      setSelectedCustomerId(data.id); setSelectedCustomer(data);
      setExistingCustomer(null); setError('');
    } catch (err: unknown) {
      setError(extractApiError(err, [], 'Could not load that customer.'));
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
        client_ref: clientRef,
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
      setClientRef(newClientRef());
    } catch (err: unknown) {
      if (isReusedClientRef(err)) {
        setClientRef(newClientRef());
        setError('An earlier attempt of this return was already saved. Check Sales history before entering it again.');
        return;
      }
      setError(extractApiError(err, ['customer', 'location', 'sale_items', 'non_field_errors'], 'Failed to record return.'));
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader title="Sales" description="Cylinder and accessory sales, payments and history." />

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
                    onChange={(e) => { setCustomerName(e.target.value); setSelectedCustomerId(null); setCustomerSuggestions([]); }}
                    placeholder="Search or enter new customer"
                    autoComplete="off"
                    maxLength={LIMITS.name}
                  />
                  {customerName.trim() && selectedCustomerId === null && customerSuggestions.length > 0 && (
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
            {!returnMode && (
              <div className="grid-2 sale-card__row">
                <Field label="Handed over by" hint={staffLoadError || 'Optional. The admin or staff member who handed the items to the customer.'}>
                  <Select value={handoverStaff} onChange={(e) => setHandoverStaff(e.target.value)}>
                    <option value="">Not specified</option>
                    {handoverOptions.map((s) => <option key={s.id} value={s.user}>{staffName(s)}</option>)}
                  </Select>
                </Field>
              </div>
            )}

            {selectedCustomer && (
              <div className="sale-summary">
                <div className="ui-tile">
                  <span className="ui-tile__label">Payment Due</span>
                  {Number(selectedCustomer.pending_balance) > 0 ? (
                    <strong className="ui-tile__value sale-summary__due">{money(selectedCustomer.pending_balance)}</strong>
                  ) : Number(selectedCustomer.credit_balance) > 0 ? (
                    <span className="sale-summary__ok">Credit {money(selectedCustomer.credit_balance)}</span>
                  ) : (
                    <span className="sale-summary__ok">Settled</span>
                  )}
                </div>
                <div className="ui-tile">
                  <span className="ui-tile__label">Empties Owed</span>
                  {selectedCustomer.empties_owed && Object.values(selectedCustomer.empties_owed).length > 0 ? (
                    <div className="sale-summary__badges">
                      {Object.values(selectedCustomer.empties_owed).map((ec) => (
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
                      {Object.values(selectedCustomer.empty_credits).map((ec) => (
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
                          </div>
                          <IconButton type="button" label="Remove item" tone="danger" size="sm" onClick={() => removeItem(i)}>
                            <Trash2 size={16} />
                          </IconButton>
                        </div>

                        <div className={`sale-item__grid${item.rate_type === 'new' ? ' sale-item__grid--new' : ''}`}>
                          <Field label="Cylinder" className="sale-item__cylinder">
                            <Select value={item.cylinder_type} onChange={(e) => updateItem(i, { cylinder_type: Number(e.target.value) })}>
                              {cylinderTypes.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Rate Type">
                            <Select value={item.rate_type} onChange={(e) => updateItem(i, { rate_type: e.target.value as 'refill' | 'new' })}>
                              <option value="refill">Refill</option>
                              <option value="new">New Cylinder</option>
                            </Select>
                          </Field>
                          <DirectSaleRates
                            rateType={item.rate_type}
                            rate={itemAmounts(item).refill}
                            deposit={itemAmounts(item).deposit}
                            onRateChange={rate => updateItem(i, { rate })}
                            onDepositChange={deposit => updateItem(i, { deposit })}
                          />
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

                          <strong className="sale-item__total">{money(itemSubtotal(item))}</strong>
                        </div>

                        {item.rate_type !== 'new' && Number(item.empty_returned) < Number(item.quantity) && (
                          <Alert tone="warning" compact>
                            Warning: Quantity is {item.quantity} but only {item.empty_returned} empty returned. Check the customer’s empty-cylinder balance. Returns do not change the price.
                          </Alert>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="sale-card" aria-label="Accessories">
                <CardHeader title="Accessories" meta={<Button type="button" variant="secondary" size="sm" icon={<Plus />} disabled={saving || productsLoading || !!productsError || !nextProduct} onClick={() => { if (nextProduct) setAccessories(prev => [...prev, { product: nextProduct.id, quantity: 1 }]); }}>Add accessory</Button>} />
                {productsLoading && <LoadingState label="Loading accessories…" />}
                {productsError && <ErrorState message={productsError} onRetry={() => { setProductsLoading(true); setProductsRevision(value => value + 1); }} />}
                {!productsLoading && !productsError && !accessories.length && <p className="muted">{availableProducts.length ? 'Add accessories to this sale, with or without cylinders.' : 'No accessories are currently available.'}</p>}
                <div className="sale-accessories">
                  {accessories.map((line, index) => {
                    const product = products.find(p => p.id === line.product);
                    const quoted = quotedAccessories.get(line.product);
                    return <div className="sale-accessory" key={index}>
                      <Field label="Product"><Select disabled={saving} value={line.product} onChange={e => setAccessories(rows => rows.map((r, i) => i === index ? { ...r, product: Number(e.target.value) } : r))}>{availableProducts.map(p => <option key={p.id} value={p.id} disabled={accessories.some((r, i) => i !== index && r.product === p.id)}>{p.name}</option>)}</Select></Field>
                      <Field label="Rate (Rs.)"><Input readOnly value={quoted?.rate ?? product?.selling_price ?? ''} /></Field>
                      <Field label="Accessory quantity" hint={product ? `${Math.max(0, product.stock - product.reserved)} available` : undefined}><Input type="number" inputMode="numeric" min="1" max={product ? product.stock - product.reserved : undefined} step="1" required disabled={saving} value={line.quantity} onChange={e => setAccessories(rows => rows.map((r, i) => i === index ? { ...r, quantity: e.target.value } : r))} /></Field>
                      <div className="sale-accessory__subtotal"><span>Subtotal</span><strong>{quoted ? money(quoted.total_amount) : '—'}</strong></div>
                      <IconButton type="button" label="Remove accessory" tone="danger" disabled={saving} onClick={() => setAccessories(rows => rows.filter((_, i) => i !== index))}><Trash2 size={17} /></IconButton>
                    </div>;
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

                {(items.length > 0 || accessories.length > 0) && !currentQuote && <p>Calculating pricing…</p>}
                {currentQuote?.error && <Alert tone="danger">{currentQuote.error} <Button type="button" onClick={() => setQuoteRevision(value => value + 1)}>Retry</Button></Alert>}
                <div className="sale-total">
                  <span className="sale-total__label">Grand Total</span>
                  <strong className="sale-total__value">{currentQuote?.data ? money(total) : '—'}</strong>
                  {Number(currentQuote?.data?.discount_amount) > 0 && <span>Refill discount: {money(currentQuote!.data!.discount_amount)}</span>}
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
              {existingCustomer && (
                <Button type="button" variant="secondary" icon={<User />} onClick={selectExistingCustomer}>
                  Use existing customer: {existingCustomer.name} ({existingCustomer.phone})
                </Button>
              )}
              {message && <Alert tone="success">{message}</Alert>}

              <div className="sale-submit">
                <Button type="submit" size="lg" icon={<Plus />} disabled={saving || !currentQuote?.data}>
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
            <Select aria-label="Handed over by" value={filterHandover} onChange={(e) => setFilterHandover(e.target.value)}>
              <option value="">Handed over by: anyone</option>
              <option value="none">Handed over by: not specified</option>
              {/* Every admin and staff member, so older sales handed over by someone now inactive can be found. */}
              {staffOptions.map((s) => <option key={s.id} value={s.user}>{s.can_hand_over ? staffName(s) : `${staffName(s)} (inactive)`}</option>)}
            </Select>
            <Select aria-label="Sale status" value={filterVoid} onChange={(e) => setFilterVoid(e.target.value)}>
              <option value="">All sales</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="refund_pending">Refund owed</option>
            </Select>
          </div>
          {historyNotice && <Alert tone="success" compact>{historyNotice}</Alert>}

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
              <Table cards stickyFirst className="sales-history-table">
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Items</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Balance</Th>
                    <Th>Mode</Th>
                    <Th>Recorded by</Th>
                    <Th>Handed over by</Th>
                    <Th>Date &amp; time</Th>
                    <Th className="sv-actions">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {historyPager.pageItems.map((sale) => {
                    const isReturn = sale.note === 'Empty cylinders returned';
                    return (
                    <tr key={sale.id}>
                      <Td label="Customer"><strong className="sh-customer">{sale.customer_name}</strong></Td>
                      <Td label="Items"><SaleItemsCell customerName={sale.customer_name} items={sale.items} accessoryItems={sale.accessory_items} /></Td>
                      <Td label="Total" numeric>
                        {isReturn ? <span className="ui-num-placeholder">-</span> : <span className="ui-num-strong">{money(sale.total_amount)}</span>}
                      </Td>
                      <Td label="Balance" align="right">
                        <details><summary>Payment details</summary><PaymentSummary value={sale.payment_summary} allowCollection onCollected={fetchHistory} /></details>
                        {sale.void ? <VoidStatusBadges saleVoid={sale.void} /> : isReturn ? <span className="ui-num-placeholder">-</span> : (
                          Number(sale.balance_due) > 0
                            ? <Badge tone="warning">{money(sale.balance_due)}</Badge>
                            : <Badge tone="success">Paid</Badge>
                        )}
                      </Td>
                      <Td label="Mode" className="sh-nowrap">
                        {isReturn ? (
                          <Badge variant="outline" icon={<RotateCcw />}>Return</Badge>
                        ) : (
                          <div className="sh-mode">
                            <Badge variant="outline">{sale.payment_mode}</Badge>
                            {(sale.payment_mode === 'split' || sale.payment_mode === 'credit') && originalPayments(sale).length > 0 && (
                              <span className="ui-cell-sub">
                                {originalPayments(sale).map(p => `${p.mode.toUpperCase()} ${p.amount}`).join(' + ')}
                              </span>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td label="Recorded by" className="sh-meta">{sale.sold_by_full_name || sale.sold_by_name}</Td>
                      <Td label="Handed over by" className="sh-meta">{sale.handover_staff_name || <span className="ui-num-placeholder">—</span>}</Td>
                      <Td label="Date & time" className="sh-meta">
                        {formatDateTime(sale.created_at)}
                        {sale.void && <span className="ui-cell-sub sv-reason" title={sale.void.reason}>Cancelled {formatDateTime(sale.void.voided_at)}</span>}
                        {sale.void?.refund && <span className="ui-cell-sub">Refunded {formatDateTime(sale.void.refund.confirmed_at)}</span>}
                      </Td>
                      <Td label="Actions" className="sh-nowrap sv-actions">
                        {!sale.void && sale.is_direct && (
                          <Button type="button" size="sm" variant="secondary" onClick={() => { setHistoryNotice(''); setVoidSaleId(sale.id); }}>
                            Cancel
                          </Button>
                        )}
                        {sale.void?.status === 'refund_pending' && (
                          <Button type="button" size="sm" onClick={() => { setHistoryNotice(''); setRefundSale(sale); }}>
                            Confirm refund
                          </Button>
                        )}
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
          <VoidSaleModal
            saleId={voidSaleId}
            onClose={() => setVoidSaleId(null)}
            onDone={() => { setHistoryNotice(`Sale #${voidSaleId} cancelled.`); setVoidSaleId(null); fetchHistory(); }}
          />
          <ConfirmRefundModal
            sale={refundSale}
            onClose={() => setRefundSale(null)}
            onDone={() => { setHistoryNotice(`Refund for sale #${refundSale?.id} confirmed.`); setRefundSale(null); fetchHistory(); }}
          />
        </div>
      )}
    </div>
  );
}
