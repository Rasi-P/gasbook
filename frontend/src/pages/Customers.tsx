import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ChevronRight, ArrowLeft, IndianRupee, Package, RotateCcw, UserPlus, X, Pencil, Check, KeyRound, Trash2, Copy, Phone, Mail, MapPin, Share2, Tag, ClipboardList, Truck, UserX, UserCheck, Receipt, Wallet } from 'lucide-react';
import { api, extractApiError, fetchAllPages, getApiErrorCode, getApiStatus, LIMITS } from '../lib/api';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';
import { usePager } from '../hooks/usePager';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardFooter, CardHeader } from '../components/ui/Card';
import { ChoiceChips } from '../components/ui/ChoiceChips';
import { Modal } from '../components/ui/Modal';
import { StatCard } from '../components/ui/StatCard';
import { Switch } from '../components/ui/Switch';
import { Tabs } from '../components/ui/Tabs';
import { bookingStatusTone } from '../components/bookingStatus';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { SkeletonRows } from '../components/ui/Skeleton';

type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  opening_balance: number;
  pending_balance: number;
  global_discount_type?: 'percentage' | 'fixed' | null;
  global_discount_value?: string;
  global_discount_is_active?: boolean;
  cylinder_discounts?: CylinderDiscount[];
  empties_owed: Record<number, { owed: number; name: string }>;
  empty_credits: Record<number, { credit: number; name: string }>;
  custom_rates?: {
    id: number;
    cylinder_type: number;
    cylinder_type_name: string;
    custom_price: string;
  }[];
  is_active?: boolean;
};

type CylinderTypeOption = { id: number; name: string; selling_price?: string };
type RowNotice = { id: number; text: string; tone: 'info' | 'error' | 'confirm' };

type CylinderDiscount = {
  id: number;
  customer: number;
  cylinder_type: number;
  cylinder_type_name: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: string;
  is_active: boolean;
};

type SaleItem = {
  cylinder_type_name: string;
  quantity: number;
  rate: number;
  empty_returned: number;
};

type Sale = {
  id: number;
  created_at: string;
  original_amount?: number | string;
  discount_amount?: number | string;
  total_amount: number;
  final_amount?: number | string;
  has_discount?: boolean;
  applied_discount_type?: 'percentage' | 'fixed' | null;
  applied_discount_value?: string;
  paid_amount: number;
  balance_due: number;
  payment_mode: string;
  location_name: string;
  delivery_type: string;
  items: SaleItem[];
  payments?: { amount: number; mode: string; date: string }[];
};

type Payment = {
  id: number;
  created_at: string;
  amount: number;
  payment_mode: string;
  note: string;
  empty_collected: number;
  sale: number | null;
};

type Ledger = {
  customer: Customer;
  sales: Sale[];
  payments: Payment[];
  bookings: Booking[];
};

type Booking = {
  id: number;
  customer: number;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  status: string;
  rate: string;
  original_amount?: string;
  discount_amount?: string;
  final_amount?: string;
  total_amount?: string;
  has_discount?: boolean;
  applied_discount_type?: 'percentage' | 'fixed' | null;
  applied_discount_value?: string;
  note: string;
  assigned_staff: number | null;
  assigned_staff_name: string | null;
  payment_method?: string;
  payment_status?: string;
  created_at: string;
  delivery_status?: string | null;
  delivery_staff_name?: string | null;
  delivery_rejection_reason?: string | null;
  needs_reassignment?: boolean;
};

type Staff = { id: number; username: string; full_name: string; assigned_area: string; user: number };

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hasActiveDiscount(customer: Customer) {
  return Boolean(
    (
      customer.global_discount_is_active &&
      customer.global_discount_type &&
      Number(customer.global_discount_value || 0) > 0
    ) ||
    (customer.cylinder_discounts || []).some(
      (discount) => discount.is_active && Number(discount.discount_value || 0) > 0,
    )
  );
}

function formatDiscountValue(type: 'percentage' | 'fixed' | null | undefined, value: number | string) {
  if (!type || Number(value || 0) <= 0) return 'No discount';
  if (type === 'percentage') return `${Number(value || 0)}%`;
  return money(value || 0);
}

function getActiveCylinderDiscountCount(customer: Customer) {
  return (customer.cylinder_discounts || []).filter(
    (discount) => discount.is_active && Number(discount.discount_value || 0) > 0,
  ).length;
}

function formatCustomerDiscount(customer: Customer) {
  const hasGlobalDiscount = Boolean(
    customer.global_discount_is_active &&
    customer.global_discount_type &&
    Number(customer.global_discount_value || 0) > 0,
  );
  const activeCylinderCount = getActiveCylinderDiscountCount(customer);

  if (!hasGlobalDiscount && activeCylinderCount === 0) return 'No discount';
  if (hasGlobalDiscount && activeCylinderCount === 0) {
    return `${formatDiscountValue(customer.global_discount_type, customer.global_discount_value || 0)} global`;
  }
  if (!hasGlobalDiscount && activeCylinderCount > 0) {
    return `${activeCylinderCount} cylinder discount${activeCylinderCount === 1 ? '' : 's'}`;
  }
  return `${formatDiscountValue(customer.global_discount_type, customer.global_discount_value || 0)} global + ${activeCylinderCount} size rule${activeCylinderCount === 1 ? '' : 's'}`;
}

function getBookingOriginalAmount(booking: Booking) {
  return Number(booking.original_amount || Number(booking.rate || 0) * booking.quantity || 0);
}

function getBookingDiscountAmount(booking: Booking) {
  return Number(booking.discount_amount || 0);
}

function getBookingFinalAmount(booking: Booking) {
  return Number(booking.final_amount || booking.total_amount || getBookingOriginalAmount(booking));
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffByBooking, setStaffByBooking] = useState<Record<number, string>>({});
  const [requestsId, setRequestsId] = useState<number | null>(null);
  const [requestsBusyId, setRequestsBusyId] = useState<number | null>(null);
  const [requestsMessage, setRequestsMessage] = useState('');
  const [requestsMessageTone, setRequestsMessageTone] = useState<'info' | 'error'>('info');
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState('');
  const [bookingsError, setBookingsError] = useState('');
  const [ledgerError, setLedgerError] = useState('');
  const [ledgerErrorId, setLedgerErrorId] = useState<number | null>(null);
  const [rowNotice, setRowNotice] = useState<RowNotice | null>(null);
  const listPager = usePager(customers, 10, search);

  // Per-row action state — track which customer's panel is open
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [credsId, setCredsId] = useState<number | null>(null);
  const [creds, setCreds] = useState<{ username: string; full_name: string } | null>(null);
  const [credsError, setCredsError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [cylinderTypes, setCylinderTypes] = useState<CylinderTypeOption[]>([]);
  const [discountId, setDiscountId] = useState<number | null>(null);
  const [discountTab, setDiscountTab] = useState<'global' | 'cylinder'>('global');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [discountSaving, setDiscountSaving] = useState(false);
  const [discountError, setDiscountError] = useState('');
  const [discountMessage, setDiscountMessage] = useState('');
  const [editingCylinderDiscountId, setEditingCylinderDiscountId] = useState<number | 'new' | null>(null);
  const [cylinderDiscountCylinderId, setCylinderDiscountCylinderId] = useState('');
  const [cylinderDiscountValue, setCylinderDiscountValue] = useState('');
  const [cylinderDiscountIsPercentage, setCylinderDiscountIsPercentage] = useState(false);
  const [cylinderDiscountEnabled, setCylinderDiscountEnabled] = useState(true);
  const [cylinderDiscountSaving, setCylinderDiscountSaving] = useState(false);
  const [cylinderDiscountError, setCylinderDiscountError] = useState('');

  // Add customer form
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUsername, setAddUsername] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [credUserId, setCredUserId] = useState<number | null>(null);
  const [credMsg, setCredMsg] = useState('');
  const [createdPhone, setCreatedPhone] = useState('');
  const [createdUsername, setCreatedUsername] = useState('');

  // Receive Payment Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [paymentSplit, setPaymentSplit] = useState({ cash: '', gpay: '', bank: '' });
  const [paymentSaving, setPaymentSaving] = useState(false);

  // ── helpers ──────────────────────────────────────────────────────────────

  function syncCustomerRecord(customerId: number, patch: Partial<Customer>) {
    setCustomers((prev) => prev.map((customer) => (
      customer.id === customerId ? { ...customer, ...patch } : customer
    )));
    if (selected && selected.customer.id === customerId) {
      setSelected((prev) => prev ? { ...prev, customer: { ...prev.customer, ...patch } } : prev);
    }
  }

  async function refreshCustomerRecord(customerId: number) {
    const { data } = await api.get(`/customers/${customerId}/`);
    syncCustomerRecord(customerId, data);
    return data as Customer;
  }

  async function ensureCylinderTypes() {
    if (cylinderTypes.length > 0) return cylinderTypes;
    const rows = await fetchAllPages<CylinderTypeOption>('/cylinder-types/');
    setCylinderTypes(rows);
    return rows;
  }

  function resetCylinderDiscountEditor() {
    setEditingCylinderDiscountId(null);
    setCylinderDiscountCylinderId('');
    setCylinderDiscountValue('');
    setCylinderDiscountIsPercentage(false);
    setCylinderDiscountEnabled(true);
    setCylinderDiscountError('');
  }

  // Price the discount is validated against: the customer's agreed rate when one exists, else the list price.
  function cylinderPriceFor(customer: Customer, cylinderTypeId: number) {
    const custom = customer.custom_rates?.find((rate) => rate.cylinder_type === cylinderTypeId)?.custom_price;
    const type = cylinderTypes.find((t) => t.id === cylinderTypeId);
    const raw = custom ?? type?.selling_price;
    const price = Number(raw);
    return raw !== undefined && Number.isFinite(price) ? price : null;
  }

  function availableCylinderOptions(customer: Customer, currentCylinderId?: number) {
    const usedIds = new Set(
      (customer.cylinder_discounts || [])
        .filter((discount) => discount.cylinder_type !== currentCylinderId)
        .map((discount) => discount.cylinder_type),
    );
    return cylinderTypes.filter((type) => !usedIds.has(type.id));
  }

  function startEdit(c: Customer) {
    setCredsId(null); setCreds(null); setCredsError(''); setPwMsg('');
    closeDiscount();
    setEditName(c.name); setEditPhone(c.phone);
    setEditEmail(c.email || ''); setEditAddress(c.address);
    setEditError('');
    setEditingId(c.id);
  }

  function cancelEdit() { setEditingId(null); setEditError(''); }

  async function handleEdit(e: FormEvent, customerId: number) {
    e.preventDefault();
    setEditError(''); setEditSaving(true);
    try {
      const { data } = await api.patch(`/customers/${customerId}/`, {
        name: editName.trim(), phone: editPhone.trim(),
        email: editEmail.trim(), address: editAddress.trim(),
      });
      syncCustomerRecord(customerId, data);
      setEditingId(null);
    } catch (err) {
      setEditError(extractApiError(err, ['name', 'full_name', 'phone', 'email', 'address'], 'Failed to save. Try again.'));
    } finally {
      setEditSaving(false);
    }
  }

  async function loadCreds(customerId: number) {
    setEditingId(null); closeDiscount();
    setCredsError(''); setCreds(null); setPwMsg('');
    setCredsId(customerId);
    try {
      const { data } = await api.get(`/customers/${customerId}/credentials/`);
      setCreds(data);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setCredsError(detail || 'No login account linked.');
    }
  }

  function closeCreds() { setCredsId(null); setCreds(null); setCredsError(''); setPwMsg(''); }

  async function resetPassword(customerId: number) {
    setPwSaving(true); setPwMsg('');
    try {
      const { data } = await api.post(`/customers/${customerId}/credentials/`, {});
      setPwMsg(data.temporary_password || 'Password reset successfully.');
    } catch (err) {
      setPwMsg(extractApiError(err, [], 'Failed to reset password.'));
    } finally {
      setPwSaving(false);
    }
  }

  async function handleDeleteCustomer(customerId: number, name: string) {
    const ok = window.confirm(
      `Delete customer ${name}? Customers with sales, payments or bookings cannot be deleted and can only be deactivated.`
    );
    if (!ok) return;
    setDeletingId(customerId);
    setRowNotice(null);
    try {
      await api.delete(`/customers/${customerId}/`);
      setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      if (selected && selected.customer.id === customerId) setSelected(null);
    } catch (err) {
      const detail = extractApiError(err, [], 'Failed to delete customer.');
      if (getApiStatus(err) === 409 && getApiErrorCode(err) === 'has_history') {
        const body = (err as { response?: { data?: { is_active?: boolean } } })?.response?.data;
        const alreadyInactive = body?.is_active === false || customers.find((c) => c.id === customerId)?.is_active === false;
        if (alreadyInactive) {
          setRowNotice({
            id: customerId,
            text: 'This customer has transaction history and cannot be deleted. The account is already deactivated; ledger and order history are preserved.',
            tone: 'info',
          });
        } else {
          setRowNotice({ id: customerId, text: detail, tone: 'confirm' });
        }
      } else {
        setRowNotice({ id: customerId, text: detail, tone: 'error' });
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function deactivateCustomer(customerId: number) {
    setDeletingId(customerId);
    try {
      const { data } = await api.post(`/customers/${customerId}/deactivate/`, {});
      const updated = (data as { customer?: Partial<Customer> } | undefined)?.customer;
      syncCustomerRecord(customerId, { ...(updated ?? {}), is_active: false });
      setRowNotice({ id: customerId, text: (data as { detail?: string })?.detail || 'Customer deactivated. Ledger and order history are preserved.', tone: 'info' });
    } catch (err) {
      setRowNotice({ id: customerId, text: extractApiError(err, [], 'Failed to deactivate customer.'), tone: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  async function reactivateCustomer(customerId: number) {
    setDeletingId(customerId);
    setRowNotice(null);
    try {
      const { data } = await api.post(`/customers/${customerId}/reactivate/`, {});
      const updated = (data as { customer?: Partial<Customer> } | undefined)?.customer;
      syncCustomerRecord(customerId, { ...(updated ?? {}), is_active: true });
      setRowNotice({ id: customerId, text: (data as { detail?: string })?.detail || 'Customer reactivated.', tone: 'info' });
    } catch (err) {
      setRowNotice({ id: customerId, text: extractApiError(err, [], 'Failed to reactivate customer.'), tone: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  async function openDiscount(customer: Customer) {
    setEditingId(null);
    setCredsId(null);
    setDiscountId(customer.id);
    setDiscountTab('global');
    setDiscountType(customer.global_discount_type || 'percentage');
    setDiscountValue(String(customer.global_discount_value || ''));
    setDiscountEnabled(Boolean(customer.global_discount_is_active));
    setDiscountError('');
    setDiscountMessage('');
    resetCylinderDiscountEditor();
    try {
      await ensureCylinderTypes();
    } catch {
      setDiscountError('Failed to load cylinder sizes.');
    }
  }

  function closeDiscount() {
    setDiscountId(null);
    setDiscountTab('global');
    setDiscountValue('');
    setDiscountEnabled(true);
    setDiscountError('');
    setDiscountMessage('');
    resetCylinderDiscountEditor();
  }

  async function handleSaveDiscount(e: FormEvent, customerId: number) {
    e.preventDefault();
    setDiscountSaving(true);
    setDiscountError('');
    setDiscountMessage('');
    try {
      const { data } = await api.patch(`/customers/${customerId}/`, {
        global_discount_type: discountType,
        global_discount_value: discountValue || '0',
        global_discount_is_active: discountEnabled,
      });
      syncCustomerRecord(customerId, data);
      setDiscountMessage('Global discount saved.');
    } catch (err: unknown) {
      setDiscountError(extractApiError(err, ['global_discount_value', 'global_discount_type', 'global_discount_is_active'], 'Failed to save discount settings.'));
    } finally {
      setDiscountSaving(false);
    }
  }

  async function startNewCylinderDiscount(customer: Customer) {
    setDiscountTab('cylinder');
    setDiscountError('');
    setDiscountMessage('');
    try {
      const types = await ensureCylinderTypes();
      const usedIds = new Set((customer.cylinder_discounts || []).map((discount) => discount.cylinder_type));
      const nextType = types.find((type) => !usedIds.has(type.id));
      if (!nextType) {
        setDiscountError('All cylinder sizes already have a discount rule. Edit an existing one instead.');
        return;
      }
      setEditingCylinderDiscountId('new');
      // No pre-selection: the admin must pick the cylinder explicitly.
      setCylinderDiscountCylinderId('');
      setCylinderDiscountValue('');
      setCylinderDiscountIsPercentage(false);
      setCylinderDiscountEnabled(true);
      setCylinderDiscountError('');
    } catch {
      setDiscountError('Failed to load cylinder sizes.');
    }
  }

  function startEditCylinderDiscount(discount: CylinderDiscount) {
    setDiscountTab('cylinder');
    setDiscountError('');
    setDiscountMessage('');
    setEditingCylinderDiscountId(discount.id);
    setCylinderDiscountCylinderId(String(discount.cylinder_type));
    setCylinderDiscountValue(String(discount.discount_value || ''));
    setCylinderDiscountIsPercentage(discount.discount_type === 'percentage');
    setCylinderDiscountEnabled(discount.is_active);
    setCylinderDiscountError('');
  }

  async function handleSaveCylinderDiscount(e: FormEvent, customer: Customer) {
    e.preventDefault();
    setCylinderDiscountError('');
    if (!cylinderDiscountCylinderId) {
      setCylinderDiscountError('Select a cylinder size.');
      return;
    }
    const cylinderTypeId = Number(cylinderDiscountCylinderId);
    const value = Number(cylinderDiscountValue);
    if (!cylinderDiscountValue.trim() || !Number.isFinite(value) || value <= 0) {
      setCylinderDiscountError('Enter a discount greater than 0.');
      return;
    }
    if (cylinderDiscountIsPercentage && value > 100) {
      setCylinderDiscountError('Percentage discount cannot exceed 100%.');
      return;
    }
    if (!cylinderDiscountIsPercentage) {
      const price = cylinderPriceFor(customer, cylinderTypeId);
      if (price !== null && value > price) {
        setCylinderDiscountError(`Fixed discount cannot exceed the cylinder price (${money(price)}).`);
        return;
      }
    }
    setCylinderDiscountSaving(true);
    setDiscountError('');
    setDiscountMessage('');
    try {
      const payload = {
        customer: customer.id,
        cylinder_type: cylinderTypeId,
        discount_type: cylinderDiscountIsPercentage ? 'percentage' : 'fixed',
        discount_value: cylinderDiscountValue.trim(),
        is_active: cylinderDiscountEnabled,
      };
      if (editingCylinderDiscountId === 'new') {
        await api.post('/customer-cylinder-discounts/', payload);
        setDiscountMessage('Cylinder-wise discount added.');
      } else if (editingCylinderDiscountId) {
        await api.patch(`/customer-cylinder-discounts/${editingCylinderDiscountId}/`, payload);
        setDiscountMessage('Cylinder-wise discount updated.');
      }
      await refreshCustomerRecord(customer.id);
      resetCylinderDiscountEditor();
    } catch (err: unknown) {
      setCylinderDiscountError(extractApiError(err, ['discount_value', 'cylinder_type', 'discount_type', 'non_field_errors'], 'Failed to save cylinder discount.'));
    } finally {
      setCylinderDiscountSaving(false);
    }
  }

  async function handleDeleteCylinderDiscount(customer: Customer, discount: CylinderDiscount) {
    const confirmed = window.confirm(
      `Remove ${discount.cylinder_type_name} discount? This will stop applying this cylinder-specific discount to future bookings.`,
    );
    if (!confirmed) return;
    setDiscountError('');
    setDiscountMessage('');
    setCylinderDiscountSaving(true);
    try {
      await api.delete(`/customer-cylinder-discounts/${discount.id}/`);
      await refreshCustomerRecord(customer.id);
      if (editingCylinderDiscountId === discount.id) {
        resetCylinderDiscountEditor();
      }
      setDiscountMessage(`${discount.cylinder_type_name} discount removed.`);
    } catch (err) {
      setDiscountError(extractApiError(err, [], 'Failed to remove cylinder discount.'));
    } finally {
      setCylinderDiscountSaving(false);
    }
  }

  async function handleAddCustomer(e: FormEvent) {
    e.preventDefault();
    setAddError(''); setCredUserId(null); setCredMsg('');
    setAddSaving(true);
    try {
      const username = addUsername.trim();
      const fullName = addName.trim();
      const { data } = await api.post('/auth/register/', {
        full_name: fullName, username,
        phone: addPhone.trim(), email: addEmail.trim(),
        address: addAddress.trim(), role: 'customer',
        linked_customer: linkedCustomerId || undefined,
      });
      const tempPassword = (data as { temporary_password?: string }).temporary_password;
      const createdPhoneNum = addPhone.trim();
      setAddName(''); setAddUsername(''); setAddPhone(''); setAddEmail(''); setAddAddress(''); setLinkedCustomerId('');
      setShowAdd(false);
      await fetchCustomers();
      if (data.id) {
        setCredUserId(data.id);
        setCredMsg(tempPassword || 'Password securely generated.');
        setCreatedPhone(createdPhoneNum);
        setCreatedUsername(username);
      }
    } catch (err: unknown) {
      setAddError(extractApiError(err, ['full_name', 'name', 'username', 'phone', 'email', 'address', 'linked_customer'], 'Failed to save. Try again.'));
    } finally {
      setAddSaving(false);
    }
  }

  const fetchCustomers = useCallback(() => {
    const params = search ? { search } : {};
    setListStatus((prev) => (prev === 'ready' ? prev : 'loading'));
    setListError('');
    return fetchAllPages<Customer>('/customers/', params)
      .then((rows) => {
        setCustomers(rows);
        setListStatus('ready');
      })
      .catch((err) => {
        setListError(extractApiError(err, [], 'Could not load customers.'));
        setListStatus('error');
      });
  }, [search]);

  const loadBookingData = useCallback(() => {
    // Only pending bookings feed the per-customer request badges.
    Promise.allSettled([
      fetchAllPages<Booking>('/bookings/', { status: 'pending' }),
      fetchAllPages<Staff>('/staff-profiles/'),
    ])
      .then(([bookingsResult, staffResult]) => {
        let problem = '';
        if (bookingsResult.status === 'fulfilled') {
          const bookingRows = bookingsResult.value;
          setBookings(bookingRows);
          setStaffByBooking((prev) => ({
            ...Object.fromEntries(bookingRows.map((b: Booking) => [b.id, String(b.assigned_staff || '')])),
            ...prev,
          }));
        } else {
          problem = extractApiError(bookingsResult.reason, [], 'Booking requests unavailable.');
        }
        if (staffResult.status === 'fulfilled') {
          setStaff(staffResult.value);
        } else if (!problem) {
          problem = extractApiError(staffResult.reason, [], 'Staff list unavailable.');
        }
        setBookingsError(problem);
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(t);
  }, [fetchCustomers]);

  useEffect(() => {
    loadBookingData();
  }, [loadBookingData]);

  async function approveBooking(id: number) {
    if (requestsBusyId !== null) return;
    const assigned_staff = staffByBooking[id];
    setRequestsMessage('');
    const booking = bookings.find((b) => b.id === id);
    if (booking?.needs_reassignment && !assigned_staff) {
      setRequestsMessageTone('error');
      setRequestsMessage('Pick a different staff member before reassigning.');
      return;
    }
    setRequestsBusyId(id);
    try {
      await api.post(`/bookings/${id}/approve/`, { assigned_staff });
      setRequestsMessageTone('info');
      setRequestsMessage('Booking approved and assigned.');
      loadBookingData();
    } catch (err) {
      setRequestsMessageTone('error');
      setRequestsMessage(extractApiError(err, ['assigned_staff'], 'Failed to approve booking.'));
    } finally {
      setRequestsBusyId(null);
    }
  }

  async function rejectBooking(id: number) {
    if (requestsBusyId !== null) return;
    setRequestsBusyId(id);
    setRequestsMessage('');
    try {
      await api.post(`/bookings/${id}/reject/`, { reason: 'Rejected by admin' });
      setRequestsMessageTone('info');
      setRequestsMessage('Booking rejected.');
      loadBookingData();
    } catch (err) {
      setRequestsMessageTone('error');
      setRequestsMessage(extractApiError(err, ['reason'], 'Failed to reject booking.'));
    } finally {
      setRequestsBusyId(null);
    }
  }

  function openLedger(id: number) {
    setLoading(true);
    setLedgerError('');
    setLedgerErrorId(null);
    setEditingId(null); setCredsId(null); setCreds(null); setCredsError(''); setPwMsg(''); closeDiscount();
    api.get(`/customers/${id}/ledger/`)
      .then((r) => setSelected(r.data))
      .catch((err) => {
        setLedgerError(extractApiError(err, [], 'Could not load the customer ledger.'));
        setLedgerErrorId(id);
      })
      .finally(() => setLoading(false));
  }

  async function handleReceivePayment(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    
    const totalPayment = paymentMode === 'split' 
      ? Number(paymentSplit.cash) + Number(paymentSplit.gpay) + Number(paymentSplit.bank)
      : Number(paymentAmount);
      
    if (totalPayment > Number(selected.customer.pending_balance)) {
      alert(`Cannot receive more than the pending balance of Rs. ${selected.customer.pending_balance}.`);
      return;
    }

    setPaymentSaving(true);
    try {
      if (paymentMode === 'split') {
        if (Number(paymentSplit.cash) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.cash), payment_mode: 'cash', note: 'Balance clearance' });
        if (Number(paymentSplit.gpay) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.gpay), payment_mode: 'gpay', note: 'Balance clearance' });
        if (Number(paymentSplit.bank) > 0) await api.post('/payments/', { customer: selected.customer.id, amount: Number(paymentSplit.bank), payment_mode: 'bank', note: 'Balance clearance' });
      } else {
        await api.post('/payments/', {
          customer: selected.customer.id,
          amount: Number(paymentAmount),
          payment_mode: paymentMode,
          note: 'Balance clearance',
        });
      }
      setShowPaymentModal(false);
      setPaymentAmount('');
      setPaymentMode('cash');
      setPaymentSplit({ cash: '', gpay: '', bank: '' });
      openLedger(selected.customer.id);
      fetchCustomers();
    } catch {
      alert('Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  }

  function renderSwitch(
    checked: boolean,
    onChange: (checked: boolean) => void,
    label: string,
    compact = false,
    disabled = false,
  ) {
    return <Switch checked={checked} onChange={onChange} label={label} compact={compact} disabled={disabled} />;
  }

  function renderDiscountTypePills(
    value: 'percentage' | 'fixed',
    onChange: (value: 'percentage' | 'fixed') => void,
    disabled = false,
  ) {
    return (
      <ChoiceChips
        ariaLabel="Discount type"
        size="sm"
        layout="grid"
        columns={2}
        className="discount-type-chips"
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={[{ value: 'fixed', label: 'Amount' }, { value: 'percentage', label: 'Percentage' }]}
      />
    );
  }

  function renderDiscountValueInput(
    value: string,
    onChange: (value: string) => void,
    isPercentage: boolean,
    placeholder: string,
    disabled = false,
  ) {
    return (
      <div className={`discount-value-group${disabled ? ' disabled' : ''}`}>
        {!isPercentage && <span className="discount-value-prefix">Rs</span>}
        <input
          type="number"
          min="0"
          max={isPercentage ? '100' : undefined}
          step="0.01"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <span className="discount-value-suffix">{isPercentage ? '%' : 'off'}</span>
      </div>
    );
  }

  function renderDiscountManager(customer: Customer, useCardClass = false) {
    const cylinderDiscounts = customer.cylinder_discounts || [];
    const currentCylinderId = editingCylinderDiscountId && editingCylinderDiscountId !== 'new'
      ? cylinderDiscounts.find((discount) => discount.id === editingCylinderDiscountId)?.cylinder_type
      : undefined;
    const cylinderOptions = availableCylinderOptions(customer, currentCylinderId);

    return (
      <div className={useCardClass ? 'ui-card ui-card--pad-md discount-manager cd-block' : 'ui-list-panel discount-manager'}>
        <div className="discount-header">
          <div className="discount-header-copy">
            <h2 className="discount-heading">
              <IndianRupee size={18} /> Customer Discount
            </h2>
            <p className="discount-subtitle">
              Configure one global rule and optional cylinder-wise overrides for future bookings.
            </p>
          </div>
          <Badge tone={hasActiveDiscount(customer) ? 'primary' : 'neutral'}>
            {formatCustomerDiscount(customer)}
          </Badge>
        </div>

        <Tabs
          ariaLabel="Discount type"
          block
          value={discountTab}
          onChange={(tab) => {
            setDiscountTab(tab);
            setDiscountError('');
            setDiscountMessage('');
          }}
          items={[
            { value: 'global', label: 'Global Discount' },
            { value: 'cylinder', label: 'Cylinder-wise Discount' },
          ]}
        />

        {discountMessage && <Alert tone="success" compact>{discountMessage}</Alert>}
        {discountError && <Alert tone="danger" compact>{discountError}</Alert>}

        {discountTab === 'global' ? (
          <form onSubmit={(e) => handleSaveDiscount(e, customer.id)} className="discount-surface form-stack">
            <div>
              <h3 className="discount-panel-title">Global Discount</h3>
              <p className="discount-panel-subtitle">
                This discount will apply to all cylinder types unless a cylinder-specific discount overrides it.
              </p>
            </div>

            <div className="discount-form-grid global">
              <label className="discount-field">
                <span>Discount Type</span>
                {renderDiscountTypePills(discountType, setDiscountType)}
              </label>

              <label className="discount-field">
                <span>{discountType === 'percentage' ? 'Discount' : 'Discount Amount'}</span>
                {renderDiscountValueInput(
                  discountValue,
                  setDiscountValue,
                  discountType === 'percentage',
                  discountType === 'percentage' ? '5' : '50',
                )}
              </label>

              <div className="discount-field switch-field">
                <span>Discount Active</span>
                {renderSwitch(discountEnabled, setDiscountEnabled, discountEnabled ? 'On' : 'Off')}
              </div>
            </div>

            <Alert tone="info" compact>
              If a cylinder-specific discount exists and is active, it will be applied instead of the global discount.
            </Alert>

            <div className="discount-actions">
              <Button type="submit" disabled={discountSaving}>
                {discountSaving ? 'Saving…' : 'Save Global Discount'}
              </Button>
              <Button type="button" variant="secondary" disabled={discountSaving} onClick={() => setDiscountEnabled(false)}>
                Disable
              </Button>
              <Button type="button" variant="ghost" disabled={discountSaving} onClick={closeDiscount}>
                Close
              </Button>
            </div>
          </form>
        ) : (
          <div className="discount-surface form-stack">
            <div className="discount-row-head">
              <div>
                <h3 className="discount-panel-title">Cylinder-wise Discount</h3>
                <p className="discount-panel-subtitle">
                  Set different discounts for specific cylinder sizes. These will override the global discount.
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" icon={<Tag />} onClick={() => startNewCylinderDiscount(customer)}>
                Add Cylinder Discount
              </Button>
            </div>

            {cylinderDiscounts.length === 0 && editingCylinderDiscountId !== 'new' ? (
              <EmptyState compact icon={<Tag size={24} />} title="No cylinder-wise discounts configured yet." />
            ) : (
              <div className="discount-card-list">
                {cylinderDiscounts.map((discount) => {
                  const isEditing = editingCylinderDiscountId === discount.id;
                  const isPercentage = isEditing ? cylinderDiscountIsPercentage : discount.discount_type === 'percentage';
                  const value = isEditing ? cylinderDiscountValue : String(discount.discount_value);
                  const isActive = isEditing ? cylinderDiscountEnabled : discount.is_active;

                  return (
                    <div key={discount.id} className="cylinder-discount-card">
                      <div className="cylinder-discount-title">
                        <strong>{discount.cylinder_type_name}</strong>
                        <Badge tone={isActive ? 'success' : 'neutral'} size="sm">{isActive ? 'Active' : 'Inactive'}</Badge>
                      </div>

                      {isEditing ? (
                        <form onSubmit={(e) => handleSaveCylinderDiscount(e, customer)} className="discount-inline-form">
                          <Field label="Cylinder Size" className="discount-field">
                            <Select value={cylinderDiscountCylinderId} onChange={(e) => setCylinderDiscountCylinderId(e.target.value)}>
                              {cylinderOptions.map((type) => (
                                <option key={type.id} value={type.id}>{type.name}</option>
                              ))}
                            </Select>
                          </Field>

                          <div className="discount-field">
                            <span>Discount Type</span>
                            {renderDiscountTypePills(
                              cylinderDiscountIsPercentage ? 'percentage' : 'fixed',
                              (next) => setCylinderDiscountIsPercentage(next === 'percentage'),
                            )}
                          </div>

                          <label className="discount-field">
                            <span>Discount Amount</span>
                            {renderDiscountValueInput(
                              cylinderDiscountValue,
                              setCylinderDiscountValue,
                              cylinderDiscountIsPercentage,
                              cylinderDiscountIsPercentage ? '5' : '50',
                            )}
                          </label>

                          <div className="discount-field switch-field">
                            <span>Is %</span>
                            {renderSwitch(
                              cylinderDiscountIsPercentage,
                              setCylinderDiscountIsPercentage,
                              cylinderDiscountIsPercentage ? 'Yes' : 'No',
                              true,
                            )}
                          </div>

                          <div className="discount-field switch-field">
                            <span>Active</span>
                            {renderSwitch(cylinderDiscountEnabled, setCylinderDiscountEnabled, isActive ? 'On' : 'Off', true)}
                          </div>

                          {cylinderDiscountError && <Alert tone="danger" role="alert" compact className="discount-span">{cylinderDiscountError}</Alert>}

                          <div className="discount-row-actions">
                            <Button type="submit" size="sm" disabled={cylinderDiscountSaving}>
                              {cylinderDiscountSaving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button type="button" variant="secondary" size="sm" disabled={cylinderDiscountSaving} onClick={resetCylinderDiscountEditor}>
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <div className="discount-inline-form readonly">
                          <div className="discount-field">
                            <span>Discount Type</span>
                            {renderDiscountTypePills(discount.discount_type, () => undefined, true)}
                          </div>

                          <div className="discount-field">
                            <span>Discount Amount</span>
                            {renderDiscountValueInput(value, () => undefined, isPercentage, isPercentage ? '5' : '50', true)}
                          </div>

                          <div className="discount-field switch-field">
                            <span>Is %</span>
                            {renderSwitch(isPercentage, () => undefined, isPercentage ? 'Yes' : 'No', true, true)}
                          </div>

                          <div className="discount-field switch-field">
                            <span>Active</span>
                            {renderSwitch(isActive, () => undefined, isActive ? 'On' : 'Off', true, true)}
                          </div>

                          <div className="discount-row-actions">
                            <Button type="button" variant="secondary" size="sm" icon={<Pencil />} onClick={() => startEditCylinderDiscount(discount)}>
                              Edit
                            </Button>
                            <Button type="button" variant="danger" size="sm" icon={<Trash2 />} onClick={() => handleDeleteCylinderDiscount(customer, discount)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {editingCylinderDiscountId === 'new' && (
                  <div className="cylinder-discount-card new">
                    <div className="cylinder-discount-title">
                      <strong>New Cylinder Discount</strong>
                      <Badge size="sm" variant="outline">Draft</Badge>
                    </div>

                    <form onSubmit={(e) => handleSaveCylinderDiscount(e, customer)} className="discount-inline-form">
                      <Field label="Cylinder Size" className="discount-field">
                        <Select value={cylinderDiscountCylinderId} required aria-invalid={Boolean(cylinderDiscountError) && !cylinderDiscountCylinderId} onChange={(e) => { setCylinderDiscountCylinderId(e.target.value); setCylinderDiscountError(''); }}>
                          <option value="">Select cylinder</option>
                          {cylinderOptions.map((type) => (
                            <option key={type.id} value={type.id}>{type.name}</option>
                          ))}
                        </Select>
                      </Field>

                      <div className="discount-field">
                        <span>Discount Type</span>
                        {renderDiscountTypePills(
                          cylinderDiscountIsPercentage ? 'percentage' : 'fixed',
                          (next) => setCylinderDiscountIsPercentage(next === 'percentage'),
                        )}
                      </div>

                      <label className="discount-field">
                        <span>Discount Amount</span>
                        {renderDiscountValueInput(
                          cylinderDiscountValue,
                          setCylinderDiscountValue,
                          cylinderDiscountIsPercentage,
                          cylinderDiscountIsPercentage ? '5' : '50',
                        )}
                      </label>

                      <div className="discount-field switch-field">
                        <span>Is %</span>
                        {renderSwitch(
                          cylinderDiscountIsPercentage,
                          setCylinderDiscountIsPercentage,
                          cylinderDiscountIsPercentage ? 'Yes' : 'No',
                          true,
                        )}
                      </div>

                      <div className="discount-field switch-field">
                        <span>Active</span>
                        {renderSwitch(cylinderDiscountEnabled, setCylinderDiscountEnabled, cylinderDiscountEnabled ? 'On' : 'Off', true)}
                      </div>

                      {cylinderDiscountError && <Alert tone="danger" role="alert" compact className="discount-span">{cylinderDiscountError}</Alert>}

                      <div className="discount-row-actions">
                        <Button type="submit" size="sm" disabled={cylinderDiscountSaving}>
                          {cylinderDiscountSaving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button type="button" variant="secondary" size="sm" disabled={cylinderDiscountSaving} onClick={resetCylinderDiscountEditor}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            )}

            <Alert tone="info" compact>
              Cylinder-wise discounts are used instead of the global discount for matching cylinders. Discounts are never stacked.
            </Alert>
          </div>
        )}
      </div>
    );
  }

  // ── Detail / ledger view ─────────────────────────────────────────────────

  if (selected) {
    const { customer, sales, payments, bookings = [] } = selected;

    type PaymentGroup = { payments: Payment[]; total: number; date: string; note: string; empties: number };
    type Entry =
      | { kind: 'sale'; date: string; sale: Sale }
      | { kind: 'payment_group'; date: string; group: PaymentGroup };

    // Hide payments linked to a sale — the sale row already shows payment breakdown
    const standalonePayments = payments.filter((p) => !p.sale);

    // Group payments that happened at the same time with the same note
    const groupMap = new Map<string, PaymentGroup>();
    for (const p of standalonePayments) {
      const key = `${p.created_at.slice(0, 16)}_${p.note}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.payments.push(p);
        existing.total += Number(p.amount);
        existing.empties += p.empty_collected || 0;
      } else {
        groupMap.set(key, { payments: [p], total: Number(p.amount), date: p.created_at, note: p.note, empties: p.empty_collected || 0 });
      }
    }

    const timeline: Entry[] = [
      ...sales.map((s) => ({ kind: 'sale' as const, date: s.created_at, sale: s })),
      ...[...groupMap.values()].map((g) => ({ kind: 'payment_group' as const, date: g.date, group: g })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const emptiesOwedTotal = Object.values(customer.empties_owed || {}).reduce((s, x) => s + x.owed, 0);

    return (
      <div className="cd">
        <PageHeader
          className="cd-header"
          leading={(
            <IconButton label="Back to customers" variant="outline" onClick={() => setSelected(null)}>
              <ArrowLeft size={20} />
            </IconButton>
          )}
          title={<span className="cd-name">{customer.name}</span>}
          meta={(
            <>
              {customer.phone && (
                <span><Phone size={14} /> {customer.phone}</span>
              )}
              {customer.email && (
                <span><Mail size={14} /> {customer.email}</span>
              )}
              {customer.address && (
                <span><MapPin size={14} /> {customer.address}</span>
              )}
            </>
          )}
          actions={(
            <>
              <Badge tone={hasActiveDiscount(customer) ? 'primary' : 'neutral'} className="ui-badge--wrap">
                {formatCustomerDiscount(customer)}
              </Badge>
              <Button
                type="button"
                variant={discountId === customer.id ? 'secondary' : 'primary'}
                icon={<IndianRupee />}
                onClick={() => discountId === customer.id ? closeDiscount() : openDiscount(customer)}
              >
                {discountId === customer.id ? 'Close Discount' : 'Manage Discount'}
              </Button>
            </>
          )}
        />

        {discountId === customer.id && renderDiscountManager(customer, true)}

        {/* Summary cards */}
        <section className="cd-stats" aria-label="Customer summary">
          <StatCard
            label="Pending"
            value={money(customer.pending_balance)}
            icon={<IndianRupee />}
            footer={customer.pending_balance > 0 ? (
              <Button
                type="button"
                size="sm"
                block
                onClick={() => {
                  setPaymentAmount(String(customer.pending_balance));
                  setShowPaymentModal(true);
                }}
              >
                Receive Payment
              </Button>
            ) : undefined}
          />
          <StatCard
            label="Empties Owed"
            value={`${emptiesOwedTotal} cylinder${emptiesOwedTotal !== 1 ? 's' : ''}`}
            icon={<RotateCcw />}
            className={emptiesOwedTotal > 0 ? 'cd-stat--danger' : undefined}
          />
          <StatCard
            label="Total Sales"
            value={sales.length}
            icon={<Package />}
          />
          <StatCard
            label="Total Billed"
            value={money(sales.reduce((s, x) => s + Number(x.total_amount), 0))}
            icon={<IndianRupee />}
          />
        </section>

        {Object.values(customer.empty_credits || {}).length > 0 && (
          <Alert tone="success" icon={<RotateCcw size={16} />} className="ui-alert--block-sm cd-cylinders-alert">
            <span className="cd-cylinders-alert__title">Available Credits:</span>
            <span className="cd-cylinders-alert__list">
              {Object.values(customer.empty_credits).map((c, i) => (
                <span key={i}><strong>{c.credit}</strong> × {c.name}</span>
              ))}
            </span>
          </Alert>
        )}

        {/* Full-width Owed Banner */}
        {Object.values(customer.empties_owed || {}).length > 0 && (
          <Alert tone="danger" role="status" icon={<RotateCcw size={16} />} className="ui-alert--block-sm cd-cylinders-alert">
            <span className="cd-cylinders-alert__title">Empties Owed:</span>
            <span className="cd-cylinders-alert__list">
              {Object.values(customer.empties_owed).map((c, i) => (
                <span key={i}><strong>{c.owed}</strong> × {c.name}</span>
              ))}
            </span>
          </Alert>
        )}

        {/* Receive Payment Modal */}
        <Modal
          open={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          title="Receive Payment"
          size="sm"
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setShowPaymentModal(false)}>Cancel</Button>
              <Button type="submit" form="receive-payment-form" disabled={paymentSaving}>
                {paymentSaving ? 'Saving...' : 'Confirm Payment'}
              </Button>
            </>
          )}
        >
          <form id="receive-payment-form" onSubmit={handleReceivePayment} className="form-stack">
            <Field label="Amount Received (Rs.)" className={paymentMode === 'split' ? 'ui-hidden' : undefined}>
              <Input
                type="number"
                step="0.01"
                min="1"
                max={customer.pending_balance}
                required={paymentMode !== 'split'}
                value={paymentAmount}
                onChange={e => setPaymentAmount(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Payment Mode">
              <Select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="gpay">GPay</option>
                <option value="split">Split Payment</option>
              </Select>
            </Field>
            {paymentMode === 'split' && (
              <div className="split-grid">
                <Field label="Cash">
                  <Input type="number" min="0" value={paymentSplit.cash} onChange={e => setPaymentSplit(s => ({ ...s, cash: e.target.value }))} placeholder="0" />
                </Field>
                <Field label="GPay">
                  <Input type="number" min="0" value={paymentSplit.gpay} onChange={e => setPaymentSplit(s => ({ ...s, gpay: e.target.value }))} placeholder="0" />
                </Field>
                <Field label="Bank">
                  <Input type="number" min="0" value={paymentSplit.bank} onChange={e => setPaymentSplit(s => ({ ...s, bank: e.target.value }))} placeholder="0" />
                </Field>
                <Field label="Credit Remaining">
                  <Input type="number" disabled className="split-grid__remaining" value={Math.max(0, customer.pending_balance - (Number(paymentSplit.cash || 0) + Number(paymentSplit.gpay || 0) + Number(paymentSplit.bank || 0)))} />
                </Field>
              </div>
            )}
          </form>
        </Modal>

        {/* Booking History */}
        <Card padding="none" className="cd-block">
          <CardHeader title="Booking History" />
          <div className="cd-card-body">
            <div className="ui-tiles cd-tiles">
              <div className="ui-tile">
                <span className="ui-tile__label">Total Bookings</span>
                <strong className="ui-tile__value">{bookings.length}</strong>
              </div>
              <div className="ui-tile">
                <span className="ui-tile__label">Active Bookings</span>
                <strong className="ui-tile__value">{bookings.filter(b => ['pending', 'approved', 'accepted', 'out_for_delivery'].includes(b.status)).length}</strong>
              </div>
              <div className="ui-tile">
                <span className="ui-tile__label">Delivered</span>
                <strong className="ui-tile__value">{bookings.filter(b => b.status === 'delivered').length}</strong>
              </div>
              <div className="ui-tile">
                <span className="ui-tile__label">Pending</span>
                <strong className="ui-tile__value">{bookings.filter(b => b.status === 'pending').length}</strong>
              </div>
            </div>

            {bookings.length === 0 && <EmptyState compact icon={<ClipboardList size={24} />} title="No bookings found for this customer." />}
            <div className="cd-bookings">
              {bookings.map((booking) => (
                <div key={`history-${booking.id}`} className="cd-booking">
                  <div className="cd-booking__head">
                    <div className="cd-booking__id">
                      <strong>#{booking.id}</strong>
                      <span className="ui-cell-sub">{booking.quantity} × {booking.cylinder_type_name}</span>
                    </div>
                    <div className="cd-booking__amount">
                      {getBookingDiscountAmount(booking) > 0 && (
                        <s className="cd-strike">{money(getBookingOriginalAmount(booking))}</s>
                      )}
                      <strong>{money(getBookingFinalAmount(booking))}</strong>
                      {getBookingDiscountAmount(booking) > 0 && (
                        <span className="cd-discount">Discount {money(getBookingDiscountAmount(booking))}</span>
                      )}
                      <Badge tone={bookingStatusTone(booking.status)}>{booking.status.replaceAll('_', ' ')}</Badge>
                    </div>
                  </div>

                  <div className="cd-booking__meta">
                    <span>
                      <span className="cd-meta-label">Payment: </span>
                      <span className="cd-meta-value">
                        {(booking.payment_method?.toUpperCase() === 'ONLINE' && booking.payment_status?.toUpperCase() === 'PAID') ? 'Paid Online' :
                         (booking.payment_method?.toUpperCase() === 'COD' && booking.payment_status?.toUpperCase() === 'COLLECTED') ? 'COD — Collected' :
                         booking.payment_method?.toUpperCase() === 'COD' ? 'COD' :
                         (booking.payment_method || 'COD')}
                      </span>
                    </span>
                    <span>
                      <span className="cd-meta-label">Staff: </span>
                      <span className="cd-meta-value">{booking.assigned_staff_name || 'Unassigned'}</span>
                    </span>
                    <span>
                      <span className="cd-meta-label">Date: </span>
                      <span className="cd-meta-value">{fmtDate(booking.created_at)}</span>
                    </span>
                    <Button type="button" variant="secondary" size="sm" className="cd-booking__view" onClick={() => alert('View booking detail component not implemented in existing codebase')}>View</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Timeline */}
        <Card padding="none" className="cd-block">
          <CardHeader title="Transaction History" />
          {timeline.length === 0 && <EmptyState compact icon={<Receipt size={24} />} title="No transactions yet." />}
          <div className="cd-timeline">
            {timeline.map((entry) => {
              if (entry.kind === 'payment_group') {
                const g = entry.group;
                const isSplit = g.payments.length > 1;
                return (
                  <div className="cd-entry" key={`payg-${g.payments[0].id}`}>
                    <div className="cd-entry__head">
                      <div className="cd-entry__title">
                        <span className="cd-entry__icon cd-entry__icon--success" aria-hidden="true"><Wallet size={16} /></span>
                        <div>
                          <strong className="cd-entry__name cd-entry__name--success">Payment Received</strong>
                          <p className="cd-entry__meta">
                            {fmtDate(g.date)}
                            {isSplit
                              ? ` · ${g.payments.map(p => `${p.payment_mode.toUpperCase()} ${p.amount}`).join(' + ')}`
                              : ` · ${g.payments[0].payment_mode.toUpperCase()}`
                            }
                            {g.empties > 0 && ` · ${g.empties} empty cylinder${g.empties > 1 ? 's' : ''} collected`}
                            {g.note ? ` · ${g.note}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="cd-entry__side">
                        <Badge tone="success">{money(g.total)}</Badge>
                        {g.empties > 0 && (
                          <Badge tone="success" icon={<RotateCcw />}>{g.empties} empty back</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              const s = entry.sale;
              const returnOnlyItems = s.items.filter(i => i.quantity === 0);
              const regularItems = s.items.filter(i => i.quantity > 0);
              const isPureReturn = Number(s.total_amount) === 0 && returnOnlyItems.length === s.items.length && s.items.length > 0;

              return (
                <div className="cd-entry" key={`sale-${s.id}`}>
                  <div className="cd-entry__head">
                    <div className="cd-entry__title">
                      <span className="cd-entry__icon" aria-hidden="true">{isPureReturn ? <RotateCcw size={16} /> : <Receipt size={16} />}</span>
                      <div>
                        <strong className="cd-entry__name">{isPureReturn ? `Empty Return #${s.id}` : `Sale #${s.id}`}</strong>
                        <p className="cd-entry__meta">
                          {fmtDate(s.created_at)} · {s.location_name} · {s.payment_mode.toUpperCase()}
                          {(s.payment_mode === 'split' || s.payment_mode === 'credit') && s.payments && s.payments.length > 0 && (
                            <Badge size="sm" className="cd-entry__count">{s.payments.length} Payments</Badge>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="cd-entry__side">
                      {!isPureReturn && <strong className="cd-entry__amount">{money(s.total_amount)}</strong>}
                      {Number(s.balance_due) > 0
                        ? <Badge tone="warning">On Credit {money(s.balance_due)}</Badge>
                        : <Badge tone="success">{isPureReturn ? 'Recorded' : 'Paid'}</Badge>}
                    </div>
                  </div>
                  <div className="cd-entry__items">
                    {regularItems.map((item, i) => (
                      <div key={`reg-${i}`} className="cd-item">
                        <span>
                          <strong>{item.quantity} × {item.cylinder_type_name}</strong>
                          {item.empty_returned > 0 && (
                            <span className="cd-returned">
                              <RotateCcw size={12} aria-hidden="true" />
                              {item.empty_returned} returned
                            </span>
                          )}
                        </span>
                        <span className="cd-item__rate">@ {money(item.rate)}</span>
                      </div>
                    ))}

                    {returnOnlyItems.length > 0 && (() => {
                      const totalReturns = returnOnlyItems.reduce((acc, i) => acc + i.empty_returned, 0);
                      const names = returnOnlyItems.map(i => `${i.empty_returned} × ${i.cylinder_type_name}`).join(', ');
                      return (
                        <div key="returns" className="cd-item cd-item--returns">
                          <span className="cd-returned cd-returned--strong">
                            <RotateCcw size={12} aria-hidden="true" />
                            {totalReturns} empty cylinder{totalReturns > 1 ? 's' : ''} returned <span className="cd-item__rate">({names})</span>
                          </span>
                        </div>
                      );
                    })()}

                    {(s.payment_mode === 'split' || s.payment_mode === 'credit') && s.payments && s.payments.length > 0 && (
                      <div key="payments" className="cd-breakdown">
                        <div className="cd-breakdown__head">
                          <span>Payment Breakdown</span>
                          <span>Total Paid: {money(s.paid_amount)}</span>
                        </div>
                        {s.payments.map((p, idx) => (
                          <div key={`pay-${idx}`} className="cd-breakdown__row">
                            <span>{p.date ? new Date(p.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''} · {p.mode.toUpperCase()}</span>
                            <span className="ui-num-success">{money(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  }

  // ── Customer list ────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Cashbook — pending balances and cylinder history."
        actions={(
          <Button
            type="button"
            variant={showAdd ? 'secondary' : 'primary'}
            icon={showAdd ? <X /> : <UserPlus />}
            onClick={() => { setShowAdd((v) => !v); setAddError(''); setCredUserId(null); setCredMsg(''); setCreatedPhone(''); setCreatedUsername(''); }}
          >
            {showAdd ? 'Cancel' : 'Add'}
          </Button>
        )}
      />

      {/* Add customer form */}
      {showAdd && (
        <form onSubmit={handleAddCustomer} className="ui-card ui-card--pad-md form-stack cust-add">
          <h2 className="ui-card__title">New Customer</h2>
          <div className="grid-2">
            <Field label="Name *">
              <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Ravi Kumar" maxLength={LIMITS.name} required autoFocus />
            </Field>
            <Field label="Phone *">
              <Input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} pattern="[0-9]*" inputMode="numeric" maxLength={LIMITS.phone} title="Only digits allowed" placeholder="Required" required />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Username">
              <Input value={addUsername} onChange={(e) => setAddUsername(e.target.value)} placeholder="e.g. ravi" maxLength={LIMITS.username} autoComplete="off" required />
            </Field>
            <Field label="Password">
              <Input value="Auto-generated on create" disabled />
            </Field>
          </div>
          <div className="grid-2">
            <Field label="Email">
              <Input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Optional" maxLength={LIMITS.email} />
            </Field>
            <Field label="Address">
              <Input value={addAddress} onChange={(e) => setAddAddress(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          {addError && <Alert tone="danger" role="alert">{addError}</Alert>}
          <div className="form-actions-row">
            <Button type="submit" disabled={addSaving} icon={<UserPlus />}>
              {addSaving ? 'Saving…' : 'Save Customer'}
            </Button>
          </div>
        </form>
      )}

      <div className="ui-toolbar">
        <div className="ui-toolbar__grow">
          <SearchInput
            aria-label="Search customers"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading && <LoadingState label="Loading…" />}

      {ledgerError && ledgerErrorId !== null && (
        <ErrorState message={ledgerError} onRetry={() => openLedger(ledgerErrorId)} compact />
      )}

      {bookingsError && (
        <Alert
          tone="danger"
          role="alert"
          className="ui-alert--block-sm"
          actions={<Button type="button" variant="link" size="sm" onClick={loadBookingData}>Retry</Button>}
        >
          Booking requests unavailable. {bookingsError}
        </Alert>
      )}

      {listStatus === 'error' && <ErrorState message={listError} onRetry={() => void fetchCustomers()} />}

      {listStatus !== 'error' && (
      <Card padding="none" className="ui-list">
        {listStatus === 'loading' && (
          <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={3} label="Loading customers…" /></div>
        )}
        {listStatus === 'ready' && customers.length === 0 && (
          <EmptyState title="No customers found." hint={search ? 'Try a different name or phone number.' : undefined} />
        )}

        {listStatus === 'ready' && listPager.pageItems.map((c) => {
          const customerBookings = bookings
            .filter((b) => b.customer === c.id && b.status === 'pending')
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          const pendingCount = customerBookings.length;
          const hasRequests = pendingCount > 0;
          const inactive = c.is_active === false;
          const rowBusy = deletingId === c.id;
          const emptiesOwed = Object.values(c.empties_owed || {}).reduce((s, x) => s + x.owed, 0);

          return (
          <div key={c.id}>
            {/* ── Row ── */}
            <div className={`ui-list-row${inactive ? ' ui-list-row--muted' : ''}`}>
              <div className="ui-list-row__main">
                <div className="ui-list-row__title">
                  <span className="ui-list-row__name">{c.name}</span>
                  {inactive && <Badge variant="outline" size="sm">INACTIVE</Badge>}
                </div>
                <div className="ui-list-row__meta">
                  {c.phone && <span>{c.phone}</span>}
                  {c.email && <span>{c.email}</span>}
                  {c.address && <span>{c.address}</span>}
                </div>
              </div>

              {/* Badges (wrap onto their own line on phones) */}
              <div className="ui-list-row__badges">
                {Number(c.pending_balance) > 0 && (
                  <Badge tone="warning">{money(c.pending_balance)}</Badge>
                )}
                {hasActiveDiscount(c) && (
                  <Badge tone="primary">{formatCustomerDiscount(c)}</Badge>
                )}
                {emptiesOwed > 0 && (
                  <Badge tone="danger" icon={<RotateCcw />}>{emptiesOwed} empty</Badge>
                )}
              </div>

              {/* Action buttons + ledger arrow */}
              <div className="ui-list-row__actions">
                {hasRequests && (
                  <IconButton
                    label={`${pendingCount} new booking request${pendingCount > 1 ? 's' : ''}`}
                    tone="primary"
                    active={requestsId === c.id}
                    onClick={() => {
                      setRequestsMessage('');
                      setRequestsId((current) => current === c.id ? null : c.id);
                    }}
                  >
                    <ClipboardList size={16} />
                    <span className="ui-count-dot" aria-hidden="true">{pendingCount}</span>
                  </IconButton>
                )}
                <IconButton
                  label="Edit"
                  active={editingId === c.id}
                  onClick={() => editingId === c.id ? cancelEdit() : startEdit(c)}
                >
                  {editingId === c.id ? <X size={16} /> : <Pencil size={16} />}
                </IconButton>
                <IconButton
                  label="Customer Discount"
                  active={discountId === c.id}
                  onClick={() => discountId === c.id ? closeDiscount() : openDiscount(c)}
                >
                  <IndianRupee size={16} />
                </IconButton>
                <IconButton
                  label="Credentials / Reset Password"
                  active={credsId === c.id}
                  onClick={() => credsId === c.id ? closeCreds() : loadCreds(c.id)}
                >
                  <KeyRound size={16} />
                </IconButton>
                {inactive ? (
                  <IconButton
                    label="Reactivate Customer"
                    tone="primary"
                    disabled={rowBusy}
                    onClick={() => reactivateCustomer(c.id)}
                  >
                    <UserCheck size={16} />
                  </IconButton>
                ) : (
                  <IconButton
                    label="Deactivate Customer"
                    tone="danger"
                    disabled={rowBusy}
                    onClick={() => {
                      if (window.confirm(`Deactivate ${c.name}? They will no longer be able to sign in or order. Ledger and order history are preserved.`)) void deactivateCustomer(c.id);
                    }}
                  >
                    <UserX size={16} />
                  </IconButton>
                )}
                <IconButton
                  label="Delete Customer"
                  tone="danger"
                  disabled={rowBusy}
                  onClick={() => handleDeleteCustomer(c.id, c.name)}
                >
                  <Trash2 size={16} />
                </IconButton>
                <IconButton
                  label="View Ledger"
                  variant="outline"
                  onClick={() => openLedger(c.id)}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </div>
            </div>

            {rowNotice?.id === c.id && (
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
                          disabled={rowBusy}
                          onClick={() => {
                            if (window.confirm(`Deactivate ${c.name} instead? They will no longer be able to sign in or order. Ledger and order history are preserved.`)) void deactivateCustomer(c.id);
                          }}
                        >
                          {rowBusy ? 'Deactivating…' : 'Deactivate instead'}
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

            {/* ── Inline Booking Requests panel ── */}
            {requestsId === c.id && hasRequests && (
              <div className="ui-list-panel req-panel">
                <div className="req-panel__head">
                  <h3>
                    <ClipboardList size={16} aria-hidden="true" />
                    New Booking Requests
                  </h3>
                  <Badge tone="warning">{customerBookings.length} pending</Badge>
                </div>

                {requestsMessage && (
                  <Alert tone={requestsMessageTone === 'error' ? 'danger' : 'success'} compact role={requestsMessageTone === 'error' ? 'alert' : 'status'}>
                    {requestsMessage}
                  </Alert>
                )}

                {customerBookings.map((booking) => (
                  <div key={booking.id} className="req-card">
                    <div className="req-card__head">
                      <div className="req-card__info">
                        <strong>Booking #{booking.id}</strong>
                        <span className="ui-cell-sub">
                          {booking.quantity} x {booking.cylinder_type_name} · {money(booking.rate)} each
                        </span>
                        {getBookingDiscountAmount(booking) > 0 && (
                          <span className="req-card__discount">
                            {money(getBookingOriginalAmount(booking))} - {money(getBookingDiscountAmount(booking))} = {money(getBookingFinalAmount(booking))}
                          </span>
                        )}
                        <span className="ui-cell-sub">
                          {fmtDate(booking.created_at)}
                        </span>
                        {booking.note && (
                          <span className="ui-cell-sub req-card__note">{booking.note}</span>
                        )}
                        {booking.status === 'pending' && booking.needs_reassignment && (
                          <Badge tone="warning" square className="ui-badge--wrap">
                            Declined by {booking.delivery_staff_name || 'staff'}
                            {booking.delivery_rejection_reason ? `: ${booking.delivery_rejection_reason}` : ''}
                          </Badge>
                        )}
                      </div>
                      <Badge tone={bookingStatusTone(booking.status)}>
                        {booking.status.replaceAll('_', ' ')}
                      </Badge>
                    </div>

                    {booking.status === 'pending' ? (
                      <div className="req-card__actions">
                        <Select
                          selectSize="sm"
                          aria-label="Assign staff"
                          value={staffByBooking[booking.id] || ''}
                          onChange={(e) => setStaffByBooking((prev) => ({ ...prev, [booking.id]: e.target.value }))}
                        >
                          <option value="">{booking.needs_reassignment ? 'Select staff (required)' : 'Select staff'}</option>
                          {staff.map((s) => {
                            const name = s.full_name || s.username;
                            const declined = Boolean(booking.needs_reassignment && booking.delivery_staff_name && name === booking.delivery_staff_name);
                            return (
                              <option key={s.id} value={s.user} disabled={declined}>
                                {declined ? `${name} (declined)` : name}
                              </option>
                            );
                          })}
                        </Select>
                        <div className="req-card__buttons">
                          <IconButton
                            variant="outline"
                            tone="primary"
                            label={booking.needs_reassignment ? 'Reassign & Approve' : 'Approve & Assign'}
                            disabled={requestsBusyId !== null}
                            aria-busy={requestsBusyId === booking.id}
                            onClick={() => approveBooking(booking.id)}
                          >
                            <Check size={18} />
                          </IconButton>
                          <IconButton
                            variant="outline"
                            tone="danger"
                            label="Reject Booking"
                            disabled={requestsBusyId !== null}
                            onClick={() => rejectBooking(booking.id)}
                          >
                            <X size={18} />
                          </IconButton>
                        </div>
                      </div>
                    ) : (
                      <div className="req-card__staff">
                        <Truck size={14} aria-hidden="true" />
                        <span>{booking.assigned_staff_name || 'Staff not assigned yet'}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {discountId === c.id && renderDiscountManager(c)}

            {/* ── Inline Edit panel ── */}
            {editingId === c.id && (
              <form onSubmit={(e) => handleEdit(e, c.id)} className="ui-list-panel form-stack">
                <h3>Edit Customer</h3>
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
                {editError && <Alert tone="danger" role="alert">{editError}</Alert>}
                <div className="form-actions-row">
                  <Button type="button" variant="secondary" onClick={cancelEdit} disabled={editSaving}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={editSaving} icon={<Check />}>
                    {editSaving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            )}

            {/* ── Inline Credentials panel ── */}
            {credsId === c.id && (
              <div className="ui-list-panel cred-panel">
                <div className="cred-panel__title">
                  <KeyRound size={16} />
                  <span>Login Credentials</span>
                </div>

                <div className="cred-panel__body">
                  {credsError && <Alert tone="danger" compact>{credsError}</Alert>}

                  {creds && !pwMsg && (
                    <Button
                      type="button"
                      size="sm"
                      icon={<Check />}
                      onClick={() => resetPassword(c.id)}
                      disabled={pwSaving}
                    >
                      {pwSaving ? 'Generating…' : 'Generate Temporary Password'}
                    </Button>
                  )}

                  {creds && pwMsg && (
                    <div className="cred-panel__values">
                      <div className="cred-panel__pair">
                        <span className="cred-panel__label">USERNAME</span>
                        <span className="cred-panel__value">{creds.username}</span>
                      </div>

                      <div className="cred-panel__pair">
                        <span className="cred-panel__label">TEMPORARY PASSWORD</span>
                        <span className="cred-panel__value cred-panel__value--mono">{pwMsg}</span>

                        <div className="cred-panel__tools">
                          <IconButton
                            size="sm"
                            variant="outline"
                            label="Copy Details"
                            onClick={() => {
                              const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.`;
                              navigator.clipboard.writeText(msg);
                              alert('Credentials copied to clipboard!');
                            }}
                          >
                            <Copy size={14} />
                          </IconButton>
                          <a
                            href={c.email ? `mailto:${c.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                            className={`ui-iconbtn ui-iconbtn--outline ui-iconbtn--sm${c.email ? '' : ' cred-panel__link--disabled'}`}
                            title={c.email ? "Email Details" : "No email saved"}
                            aria-label={c.email ? "Email Details" : "No email saved"}
                            onClick={(e) => {
                              if (!c.email) {
                                e.preventDefault();
                                alert('No email address saved for this customer.');
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
                              const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${creds.username}\nPassword: ${pwMsg}\n\nPlease login and change your password immediately.`;
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
                                alert('Share not supported on this device. Credentials copied to clipboard instead!');
                              }
                            }}
                          >
                            <Share2 size={14} />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  )}

                  <IconButton size="sm" variant="outline" label="Close" onClick={closeCreds}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            )}

            {/* ── New-customer temp password banner ── */}
            {credUserId && credMsg && c.phone === createdPhone && (
              <div className="ui-list-panel cred-panel">
                <div className="cred-panel__title">
                  <KeyRound size={16} />
                  <span>Login Credentials</span>
                </div>

                <div className="cred-panel__body">
                  <div className="cred-panel__values">
                    <div className="cred-panel__pair">
                      <span className="cred-panel__label">USERNAME</span>
                      <span className="cred-panel__value">{createdUsername}</span>
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
                            const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
                            navigator.clipboard.writeText(msg);
                            alert('Credentials copied to clipboard!');
                          }}
                        >
                          <Copy size={14} />
                        </IconButton>
                        <a
                          href={c.email ? `mailto:${c.email}?subject=${encodeURIComponent('Your GasBook Account Details')}&body=${encodeURIComponent(`Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.\n\nBest regards,\nGasBook Admin`)}` : '#'}
                          className={`ui-iconbtn ui-iconbtn--outline ui-iconbtn--sm${c.email ? '' : ' cred-panel__link--disabled'}`}
                          title={c.email ? "Email Details" : "No email saved"}
                          aria-label={c.email ? "Email Details" : "No email saved"}
                          onClick={(e) => {
                            if (!c.email) {
                              e.preventDefault();
                              alert('No email address saved for this customer.');
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
                            const msg = `Hello ${c.name},\n\nHere are your GasBook login details:\n\nUsername: ${createdUsername}\nPassword: ${credMsg}\n\nPlease login and change your password immediately.`;
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

                  <IconButton size="sm" variant="outline" label="Close" onClick={() => { setCredUserId(null); setCredMsg(''); setCreatedUsername(''); }}>
                    <X size={14} />
                  </IconButton>
                </div>
              </div>
            )}
          </div>
        );
        })}
        {listStatus === 'ready' && listPager.pageCount > 1 && (
          <CardFooter>
            <Pager page={listPager.page} pageCount={listPager.pageCount} onChange={listPager.setPage} total={listPager.total} />
          </CardFooter>
        )}
      </Card>
      )}
    </div>
  );
}
