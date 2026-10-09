import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, AtSign, Ban, Car, CircleCheck, ClipboardList, FilterX, Mail, MapPin, Phone, Truck } from 'lucide-react';
import { api, extractApiError, type Paginated } from '../../lib/api';
import { ErrorState } from '../../components/AsyncState';
import { Pager } from '../../components/Pager';
import { DEFAULT_PAGE_SIZE } from '../../hooks/usePager';
import { bookingStatusTone } from '../../components/bookingStatus';
import { Alert } from '../../components/ui/Alert';
import { Badge, type BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardFooter, CardHeader } from '../../components/ui/Card';
import { ChoiceChips } from '../../components/ui/ChoiceChips';
import { EmptyState } from '../../components/ui/EmptyState';
import { Field, Input } from '../../components/ui/Field';
import { IconButton } from '../../components/ui/IconButton';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchInput } from '../../components/ui/SearchInput';
import { SkeletonRows, SkeletonStatGrid } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';

export type HistoryStaff = {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  role: string | null;
  phone: string;
  email: string;
  address: string;
  staff_image_url?: string | null;
  is_active?: boolean;
};

type StaffInfo = HistoryStaff & {
  assigned_area?: string;
  vehicle_number?: string;
  vehicle_location_name?: string | null;
};

/** Booking facts shared by both kinds of row of GET /auth/users/{id}/deliveries/. */
type BookingFields = {
  booking: number;
  order_id: string;
  booking_status: string;
  booked_at: string;
  customer_name: string;
  customer_phone: string;
  customer_area: string;
  cylinder_type_name: string;
  quantity: number;
  original_amount: string;
  discount_amount: string;
  final_amount: string;
  booking_payment_method: string;
};

/** The booking's Delivery is this staff member's now. */
type CurrentRow = BookingFields & {
  involvement: 'current';
  id: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  booking_payment_status: string;
  payment_method: string;
  payment_collected: string;
  balance_due: string | null;
  empty_collected: number;
  rejection_reason: string;
  booking_rejection_reason: string | null;
  note: string;
  reassigned_from: { staff_id: number; staff_name: string | null } | null;
  previous_decline: { reason: string | null; declined_at: string } | null;
};

/** A booking this staff member handed over (from the activity log); its delivery fields are null. */
type PreviousRow = BookingFields & {
  involvement: 'previous';
  status: 'reassigned';
  handover: {
    outcome: 'declined' | 'reassigned';
    previous_status: string | null;
    reason: string | null;
    handed_over_at: string;
    to_staff_id: number | null;
    to_staff_name: string | null;
  };
};

type StaffDelivery = CurrentRow | PreviousRow;

type Summary = {
  total: number;
  delivered: number;
  active: number;
  cancelled: number;
  declined: number;
  collected: string;
  reassigned: number;
};

type HistoryResponse = Paginated<StaffDelivery> & { summary: Summary; history_since: string | null; staff: StaffInfo };

type StatusFilter = 'all' | 'active' | 'delivered' | 'cancelled' | 'declined' | 'reassigned';

const STATUS_FILTERS: { value: StatusFilter; label: string; statuses: string }[] = [
  { value: 'all', label: 'All', statuses: '' },
  { value: 'active', label: 'Active', statuses: 'assigned,accepted,out_for_delivery' },
  { value: 'delivered', label: 'Delivered', statuses: 'delivered' },
  { value: 'cancelled', label: 'Cancelled', statuses: 'cancelled' },
  { value: 'declined', label: 'Declined', statuses: 'rejected' },
  { value: 'reassigned', label: 'Reassigned', statuses: 'reassigned' },
];

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Declined',
};

const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: 'Cash',
  gpay: 'GPay',
  bank: 'Bank',
  credit: 'Credit',
  split: 'Split',
};

function fullName(user: HistoryStaff) {
  return user.first_name || user.last_name ? `${user.first_name} ${user.last_name}`.trim() : user.username;
}

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sentenceCase(status: string) {
  const text = status.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Delivery statuses reuse the booking tones; a staff decline is a warning, as on Booking Control. */
function statusTone(status: string): BadgeTone {
  return status === 'rejected' ? 'warning' : bookingStatusTone(status);
}

function paymentTone(status: string): BadgeTone {
  if (status === 'PAID') return 'success';
  if (status === 'COLLECTED') return 'info';
  return 'warning';
}

/** A booking this staff member handed over: booking facts and the handover only — the delivery
 *  times, collection and empties belong to whoever holds the booking now. */
function HandoverRow({ row }: { row: PreviousRow }) {
  const { handover } = row;
  const recipient = handover.to_staff_name ?? 'another staff member';
  const reassignedWhile = handover.previous_status === 'accepted'
    ? 'after acceptance'
    : handover.previous_status === 'assigned' ? 'before acceptance' : '';
  return (
    <tr className="sh-row--previous">
      <Td label="Order">
        <strong>{row.order_id}</strong>
        <span className="ui-cell-sub">Booked {fmtDateTime(row.booked_at)}</span>
      </Td>
      <Td label="Customer">
        <strong className="sh-cell-name">{row.customer_name}</strong>
        {(row.customer_phone || row.customer_area) && (
          <span className="ui-cell-sub">{[row.customer_phone, row.customer_area].filter(Boolean).join(' · ')}</span>
        )}
      </Td>
      <Td label="Cylinder">{row.quantity} × {row.cylinder_type_name}</Td>
      <Td label="Amount" numeric>
        <strong>{money(row.final_amount)}</strong>
        {Number(row.discount_amount) > 0 && <span className="ui-cell-sub"><s>{money(row.original_amount)}</s></span>}
      </Td>
      <Td label="Payment">—</Td>
      <Td label="Status">
        <div className="sh-stack">
          <Badge variant="outline" icon={<ArrowRightLeft />}>Reassigned</Badge>
          {handover.outcome === 'declined' ? (
            <span className="sh-reason">Declined{handover.reason ? `: ${handover.reason}` : ''}</span>
          ) : (
            <span className="ui-cell-sub">Reassigned by admin{reassignedWhile ? ` ${reassignedWhile}` : ''}</span>
          )}
          <span className="ui-cell-sub">To {recipient} · {fmtDateTime(handover.handed_over_at)}</span>
          <span className="ui-cell-sub">Order now: {sentenceCase(row.booking_status)}</span>
        </div>
      </Td>
      <Td label="Delivered">—</Td>
    </tr>
  );
}

export default function StaffHistory({ staff, onBack }: { staff: HistoryStaff; onBack: () => void }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');

  const rangeInvalid = Boolean(start && end && start > end);
  const statuses = STATUS_FILTERS.find((f) => f.value === statusFilter)?.statuses ?? '';
  const params = useMemo(() => ({
    page,
    page_size: DEFAULT_PAGE_SIZE,
    ...(statuses ? { status: statuses } : {}),
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(search ? { search } : {}),
  }), [page, statuses, start, end, search]);
  const requestKey = `${staff.id}|${JSON.stringify(params)}|${reloadKey}`;
  const loading = !rangeInvalid && loadedKey !== requestKey;

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) {
        setSearch(next);
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput, search]);

  useEffect(() => {
    if (rangeInvalid) return;
    let cancelled = false;
    api.get(`/auth/users/${staff.id}/deliveries/`, { params })
      .then((r) => {
        if (cancelled) return;
        setData(r.data as HistoryResponse);
        setError('');
        setLoadedKey(requestKey);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(extractApiError(err, [], 'Could not load delivery history.'));
        setLoadedKey(requestKey);
      });
    return () => { cancelled = true; };
  }, [staff.id, params, requestKey, rangeInvalid]);

  const info: StaffInfo = data?.staff ?? staff;
  const name = fullName(info);
  const inactive = info.is_active === false;
  const summary = data?.summary;
  const filtersActive = statusFilter !== 'all' || Boolean(start || end || searchInput.trim());
  const count = data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(count / DEFAULT_PAGE_SIZE));
  const failed = !loading && Boolean(error);
  const historySince = data?.history_since ?? null;
  const rangeHint = start && end
    ? `Booked ${fmtDate(start)} – ${fmtDate(end)}`
    : start ? `Booked since ${fmtDate(start)}` : end ? `Booked until ${fmtDate(end)}` : 'All time';

  function clearFilters() {
    setStatusFilter('all');
    setStart('');
    setEnd('');
    setSearchInput('');
    setSearch('');
    setPage(1);
  }

  return (
    <div className="sh">
      <PageHeader
        className="sh-header"
        leading={(
          <IconButton label="Back to staff" variant="outline" onClick={onBack}>
            <ArrowLeft size={20} />
          </IconButton>
        )}
        title={(
          <span className="sh-title">
            {info.staff_image_url ? (
              <img className="staff-avatar" src={info.staff_image_url} alt="" />
            ) : (
              <span className="staff-avatar staff-avatar--initial" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
            )}
            <span className="sh-name">{name}</span>
          </span>
        )}
        meta={(
          <>
            <span><AtSign size={14} /> {info.username}</span>
            {info.phone && <span><Phone size={14} /> {info.phone}</span>}
            {info.email && <span><Mail size={14} /> {info.email}</span>}
            {info.address && <span><MapPin size={14} /> {info.address}</span>}
            {info.assigned_area && <span><MapPin size={14} /> Area: {info.assigned_area}</span>}
            {(info.vehicle_number || info.vehicle_location_name) && (
              <span>
                <Car size={14} /> {[info.vehicle_number, info.vehicle_location_name].filter(Boolean).join(' · ')}
              </span>
            )}
          </>
        )}
        actions={(
          <>
            {info.role && (
              <Badge variant="outline" tone={info.role === 'admin' ? 'primary' : 'neutral'} className="staff-role">
                {info.role.toUpperCase()}
              </Badge>
            )}
            <Badge tone={inactive ? 'neutral' : 'success'}>{inactive ? 'Inactive' : 'Active'}</Badge>
          </>
        )}
      />

      {!summary && loading && (
        <div className="sh-stats-skeleton"><SkeletonStatGrid count={5} label="Loading summary" /></div>
      )}
      {summary && (
        <section className="sh-stats" aria-label="Delivery summary">
          <StatCard label="Total Deliveries" value={summary.total} icon={<ClipboardList />} hint={rangeHint} />
          <StatCard
            label="Delivered"
            value={summary.delivered}
            icon={<CircleCheck />}
            hint={`${money(summary.collected)} collected`}
          />
          <StatCard label="Active" value={summary.active} icon={<Truck />} hint="Assigned, accepted or out for delivery" />
          <StatCard
            label="Cancelled / Declined"
            value={summary.cancelled + summary.declined}
            icon={<Ban />}
            hint={`${summary.cancelled} cancelled · ${summary.declined} declined`}
          />
          <StatCard
            label="Reassigned"
            value={summary.reassigned}
            icon={<ArrowRightLeft />}
            hint={historySince ? `Handed over · recorded since ${fmtDay(historySince)}` : 'No handovers recorded yet'}
          />
        </section>
      )}

      <Card className="sh-filters">
        <div className="sh-filters__row">
          <Field label="Search" className="sh-filters__search">
            <SearchInput
              placeholder="Order ID, customer name or phone"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </Field>
          <Field label="Booked from" className="sh-filters__date">
            <Input
              type="date"
              value={start}
              max={end || undefined}
              aria-invalid={rangeInvalid}
              onChange={(e) => { setStart(e.target.value); setPage(1); }}
            />
          </Field>
          <Field label="Booked to" className="sh-filters__date">
            <Input
              type="date"
              value={end}
              min={start || undefined}
              aria-invalid={rangeInvalid}
              onChange={(e) => { setEnd(e.target.value); setPage(1); }}
            />
          </Field>
          {filtersActive && (
            <Button type="button" variant="secondary" icon={<FilterX />} className="sh-filters__clear" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
        {rangeInvalid && (
          <Alert tone="danger" role="alert" compact className="sh-filters__error">
            Start date must be on or before end date.
          </Alert>
        )}
        <ChoiceChips
          ariaLabel="Delivery status"
          size="sm"
          className="sh-filters__chips"
          value={statusFilter}
          onChange={(value) => { setStatusFilter(value); setPage(1); }}
          options={STATUS_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        />
      </Card>

      <Card padding="none">
        <CardHeader
          title="Delivery History"
          description={historySince
            ? `Orders assigned to this staff member now, plus orders they handed over to someone else. Handovers are only recorded from ${fmtDateTime(historySince)}; earlier handovers are not shown.`
            : 'Orders assigned to this staff member now. No handovers have been recorded yet; earlier handovers are not shown.'}
          meta={data && !loading && !failed ? <Badge>{count} {count === 1 ? 'delivery' : 'deliveries'}</Badge> : undefined}
        />
        {loading && (
          <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={6} label="Loading deliveries…" /></div>
        )}
        {failed && (
          <div className="sh-error">
            <ErrorState message={error} onRetry={() => { setPage(1); setReloadKey((k) => k + 1); }} />
          </div>
        )}
        {!loading && !failed && data && count === 0 && (
          filtersActive ? (
            <EmptyState
              icon={<ClipboardList size={24} />}
              title="No deliveries match these filters."
              hint={statusFilter === 'reassigned'
                ? (historySince ? `Handovers before ${fmtDateTime(historySince)} were not recorded.` : 'No handovers have been recorded yet.')
                : undefined}
              action={<Button type="button" variant="secondary" size="sm" icon={<FilterX />} onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<ClipboardList size={24} />}
              title="No deliveries yet."
              hint={`Orders assigned to ${name} will appear here.`}
            />
          )
        )}
        {!loading && !failed && data && count > 0 && (
          <TableWrap>
            <Table cards className="sh-table">
              <thead>
                <tr>
                  <Th className="sh-col-order">Order</Th>
                  <Th className="sh-col-customer">Customer</Th>
                  <Th className="sh-col-cylinder">Cylinder</Th>
                  <Th align="right" className="sh-col-amount">Amount</Th>
                  <Th className="sh-col-payment">Payment</Th>
                  <Th className="sh-col-status">Status</Th>
                  <Th className="sh-col-delivered">Delivered</Th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => {
                  if (row.involvement === 'previous') return <HandoverRow key={row.booking} row={row} />;
                  const discounted = Number(row.discount_amount) > 0;
                  const due = row.balance_due !== null && Number(row.balance_due) > 0;
                  return (
                    <tr key={row.booking}>
                      <Td label="Order">
                        <strong>{row.order_id}</strong>
                        <span className="ui-cell-sub">Booked {fmtDateTime(row.booked_at)}</span>
                        {row.reassigned_from && (
                          <span className="ui-cell-sub">Reassigned from {row.reassigned_from.staff_name ?? 'another staff member'}</span>
                        )}
                      </Td>
                      <Td label="Customer">
                        <strong className="sh-cell-name">{row.customer_name}</strong>
                        {(row.customer_phone || row.customer_area) && (
                          <span className="ui-cell-sub">{[row.customer_phone, row.customer_area].filter(Boolean).join(' · ')}</span>
                        )}
                      </Td>
                      <Td label="Cylinder">
                        {row.quantity} × {row.cylinder_type_name}
                        {row.empty_collected > 0 && <span className="ui-cell-sub">{row.empty_collected} empty collected</span>}
                      </Td>
                      <Td label="Amount" numeric>
                        <strong>{money(row.final_amount)}</strong>
                        {discounted && <span className="ui-cell-sub"><s>{money(row.original_amount)}</s></span>}
                      </Td>
                      <Td label="Payment">
                        <div className="sh-stack">
                          <Badge size="sm" tone={paymentTone(row.booking_payment_status)}>
                            {row.booking_payment_method} · {row.booking_payment_status}
                          </Badge>
                          {row.status === 'delivered' && (
                            <span className="ui-cell-sub">
                              Collected {money(row.payment_collected)}
                              {Number(row.payment_collected) > 0 && ` · ${PAYMENT_MODE_LABELS[row.payment_method] ?? row.payment_method}`}
                            </span>
                          )}
                          {due && <span className="ui-cell-sub sh-due">Due {money(row.balance_due ?? 0)}</span>}
                        </div>
                      </Td>
                      <Td label="Status">
                        <div className="sh-stack">
                          <Badge tone={statusTone(row.status)}>{STATUS_LABELS[row.status] ?? row.status.replaceAll('_', ' ')}</Badge>
                          {row.status === 'rejected' && row.booking_status === 'pending' && (
                            <span className="ui-cell-sub">Awaiting reassignment</span>
                          )}
                          {row.rejection_reason && (
                            <span className="sh-reason">Declined: {row.rejection_reason}</span>
                          )}
                          {row.booking_status === 'rejected' && (
                            <span className="sh-reason">
                              Order rejected{row.booking_rejection_reason ? `: ${row.booking_rejection_reason}` : ''}
                            </span>
                          )}
                          {row.previous_decline && (
                            <span className="ui-cell-sub">
                              Declined earlier{row.previous_decline.reason ? `: ${row.previous_decline.reason}` : ''} · {fmtDateTime(row.previous_decline.declined_at)}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td label="Delivered">
                        {row.completed_at ? fmtDateTime(row.completed_at) : (
                          row.started_at ? <span className="ui-cell-sub">Started {fmtDateTime(row.started_at)}</span> : '—'
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
        {!loading && !failed && pageCount > 1 && (
          <CardFooter>
            <Pager page={page} pageCount={pageCount} onChange={setPage} total={count} />
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
