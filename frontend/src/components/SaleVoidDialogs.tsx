import { useEffect, useState } from 'react';
import { api, extractApiError } from '../lib/api';
import { Alert } from './ui/Alert';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ChoiceChips } from './ui/ChoiceChips';
import { Field, Input, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';
import { formatDateTime } from '../lib/dateTime';

/** The cancellation of a sale, as SaleSerializer.void returns it. */
export type SaleVoidInfo = {
  id: number;
  outcome: 'none' | 'refund' | 'credit';
  status: 'cancelled' | 'refund_pending' | 'refunded' | 'credited';
  reason: string;
  voided_at: string;
  voided_by_name: string | null;
  paid_amount: string;
  cancelled_balance: string;
  refund_due: string;
  refund: { amount: string; references: Record<string, string>; confirmed_at: string; confirmed_by_name: string | null } | null;
};

export type SalePaymentRow = { id: number; amount: number | string; mode: string; kind: 'payment' | 'refund' | 'credit_reversal' | 'reversal' };

type VoidPreview = {
  created_at?: string;
  can_void: boolean;
  blockers: { code: string; detail: string }[];
  location: { id: number; name: string };
  stock_changes: { cylinder_type: number; name: string; filled_back: number; empties_out: number }[];
  total: string;
  paid: string;
  payments: { id: number; mode: string; amount: string }[];
  cancelled_balance: string;
  outcomes: ('none' | 'refund' | 'credit')[];
};

const MODE_LABELS: Record<string, string> = { cash: 'Cash', gpay: 'GPay', bank: 'Bank' };
const REASON_MAX = 300;
const REFERENCE_MAX = 100;

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

/** One line for a cancelled sale: what happened to its money. */
function voidStatusText(v: SaleVoidInfo) {
  if (v.status === 'refund_pending') return `Refund owed ${money(v.refund_due)}`;
  if (v.status === 'refunded') return `Refunded ${money(v.refund?.amount ?? v.refund_due)}`;
  if (v.status === 'credited') return `Credit ${money(v.paid_amount)}`;
  return Number(v.cancelled_balance) > 0 ? `${money(v.cancelled_balance)} no longer due` : 'Nothing due';
}

export function VoidStatusBadges({ saleVoid }: { saleVoid: SaleVoidInfo }) {
  return (
    <span className="sv-badges">
      <Badge tone="danger">Cancelled</Badge>
      <Badge tone={saleVoid.status === 'refund_pending' ? 'warning' : 'neutral'} variant="outline">{voidStatusText(saleVoid)}</Badge>
    </span>
  );
}

/**
 * Cancel a direct sale. Shows the server's preview (stock and money effects, and anything that
 * blocks it); the void request itself repeats every check under lock.
 */
export function VoidSaleModal({ saleId, onClose, onDone }: { saleId: number | null; onClose: () => void; onDone: () => void }) {
  // Keyed by sale, so every opening starts from a clean form.
  return saleId === null ? null : <VoidSaleDialog key={saleId} saleId={saleId} onClose={onClose} onDone={onDone} />;
}

function VoidSaleDialog({ saleId, onClose, onDone }: { saleId: number; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<VoidPreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<'refund' | 'credit' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get(`/sales/${saleId}/void-preview/`)
      .then((r) => { if (!cancelled) setPreview(r.data as VoidPreview); })
      .catch((err) => { if (!cancelled) setLoadError(extractApiError(err, [], 'Could not check this sale.')); });
    return () => { cancelled = true; };
  }, [saleId]);

  const paid = Number(preview?.paid || 0);
  const needsOutcome = paid > 0;

  async function submit() {
    if (busy) return;
    setError('');
    if (!reason.trim()) { setError('Enter the reason for cancelling this sale.'); return; }
    if (needsOutcome && !outcome) { setError('Choose a refund or customer credit for the money paid.'); return; }
    setBusy(true);
    try {
      await api.post(`/sales/${saleId}/void/`, needsOutcome ? { reason: reason.trim(), outcome } : { reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(extractApiError(err, ['reason', 'outcome'], 'Could not cancel this sale.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="md"
      title={`Cancel sale #${saleId}`}
      description="The sale stays on record, marked Cancelled. This cannot be undone; to correct a sale, cancel it and record a new one."
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Keep sale</Button>
          <Button type="button" variant="danger" disabled={busy || !preview || !preview.can_void} onClick={() => void submit()}>
            {busy ? 'Cancelling…' : 'Cancel sale'}
          </Button>
        </>
      )}
    >
      <div className="form-stack">
        {!preview && !loadError && <p className="sv-muted">Checking this sale…</p>}
        {loadError && <Alert tone="danger" role="alert" compact>{loadError}</Alert>}
        {preview && preview.blockers.length > 0 && (
          <Alert tone="danger" role="alert">
            <strong>This sale cannot be cancelled now.</strong>
            <ul className="sv-list">{preview.blockers.map((b) => <li key={b.code}>{b.detail}</li>)}</ul>
          </Alert>
        )}
        {preview && (
          <div className="sv-effects" aria-label="What cancelling does">
            <span className="event-times">Recorded {formatDateTime(preview.created_at)}</span>
            <div>
              <span className="sv-effects__label">Stock at {preview.location.name}</span>
              <ul className="sv-list">
                {preview.stock_changes.map((c) => (
                  <li key={c.cylinder_type}>
                    {c.name}: {c.filled_back > 0 && `+${c.filled_back} filled back`}
                    {c.filled_back > 0 && c.empties_out > 0 && ', '}
                    {c.empties_out > 0 && `${c.empties_out} empty handed back`}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span className="sv-effects__label">Money</span>
              <ul className="sv-list">
                <li>Sale total {money(preview.total)}</li>
                <li>
                  Paid {money(preview.paid)}
                  {preview.payments.length > 0 && ` (${preview.payments.map((p) => `${MODE_LABELS[p.mode] ?? p.mode} ${money(p.amount)}`).join(', ')})`}
                </li>
                {Number(preview.cancelled_balance) > 0 && <li>Unpaid {money(preview.cancelled_balance)}: no longer due</li>}
              </ul>
            </div>
          </div>
        )}
        {preview && preview.can_void && needsOutcome && (
          <Field as="div" label="What happens to the money paid" hint={
            outcome === 'refund' ? `${money(paid)} is owed back to the customer. Confirm the refund once it has been paid.`
              : outcome === 'credit' ? `${money(paid)} stays on the customer's account and reduces what they owe.`
                : 'Required.'
          }>
            <ChoiceChips
              ariaLabel="Refund or credit"
              value={outcome}
              onChange={(v) => setOutcome(v as 'refund' | 'credit')}
              options={[{ value: 'refund', label: 'Refund the customer' }, { value: 'credit', label: 'Keep as customer credit' }]}
            />
          </Field>
        )}
        {preview && preview.can_void && (
          <Field label="Reason" hint={`${reason.length}/${REASON_MAX}`}>
            <Textarea rows={2} value={reason} maxLength={REASON_MAX} disabled={busy}
              placeholder="e.g. Entered for the wrong customer" onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {error && <Alert tone="danger" role="alert" compact>{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Record that the refund owed for a cancelled sale has been paid back, all at once. */
type RefundSale = { id: number; created_at?: string; void: SaleVoidInfo | null; payments: SalePaymentRow[] };

export function ConfirmRefundModal({ sale, onClose, onDone }: { sale: RefundSale | null; onClose: () => void; onDone: () => void }) {
  return sale === null ? null : <ConfirmRefundDialog key={sale.id} sale={sale} onClose={onClose} onDone={onDone} />;
}

function ConfirmRefundDialog({ sale, onClose, onDone }: { sale: RefundSale; onClose: () => void; onDone: () => void }) {
  const [references, setReferences] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const byMode = new Map<string, number>();
  for (const p of sale.payments) {
    if (p.kind === 'payment') byMode.set(p.mode, (byMode.get(p.mode) ?? 0) + Number(p.amount));
  }
  const modes = [...byMode.keys()].sort();

  async function submit() {
    if (!sale.void || busy) return;
    setError('');
    const missing = modes.filter((m) => m !== 'cash' && !(references[m] || '').trim());
    if (missing.length) { setError(`Enter the transaction reference for ${missing.map((m) => MODE_LABELS[m] ?? m).join(' and ')}.`); return; }
    setBusy(true);
    try {
      const refs = Object.fromEntries(modes.filter((m) => (references[m] || '').trim()).map((m) => [m, references[m].trim()]));
      await api.post(`/sales/${sale.id}/confirm-refund/`, { references: refs, amount: sale.void.refund_due });
      onDone();
    } catch (err) {
      setError(extractApiError(err, ['references', 'amount'], 'Could not confirm the refund.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      size="sm"
      title={`Confirm refund for sale #${sale.id}`}
      description="Confirm only after the money has been paid back. The whole refund is recorded at once, in the modes it was paid."
      footer={(
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Not yet</Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>{busy ? 'Confirming…' : `Confirm ${money(sale.void?.refund_due ?? 0)} refunded`}</Button>
        </>
      )}
    >
      <div className="form-stack">
        <span className="event-times">
          <span>Recorded {formatDateTime(sale.created_at)}</span>
          <span>Cancelled {formatDateTime(sale.void?.voided_at)}</span>
        </span>
        {modes.map((mode) => (
          <Field key={mode} label={`${MODE_LABELS[mode] ?? mode} ${money(byMode.get(mode) ?? 0)}`}
            hint={mode === 'cash' ? 'Reference optional.' : 'Transaction reference required.'}>
            <Input value={references[mode] ?? ''} maxLength={REFERENCE_MAX} disabled={busy}
              placeholder={mode === 'cash' ? 'Optional' : mode === 'gpay' ? 'UPI / GPay reference' : 'Bank reference'}
              onChange={(e) => setReferences((r) => ({ ...r, [mode]: e.target.value }))} />
          </Field>
        ))}
        {error && <Alert tone="danger" role="alert" compact>{error}</Alert>}
      </div>
    </Modal>
  );
}
