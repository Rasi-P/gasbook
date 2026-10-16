import { pendingTransaction, transactionRequest } from '../lib/transactionRequest';
import { useState } from 'react';
import { extractApiError } from '../lib/api';
import { formatDateTime } from '../lib/dateTime';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Alert } from './ui/Alert';
import { PaymentCollectionForm } from './PaymentCollectionForm';
import { emptyCollection, receiptParts, receiptLabels, collectionError } from '../lib/paymentCollection';
export type PaymentFacts = {
    sale_id: number;
    total_amount: string;
    paid_amount: string;
    balance_due: string;
    status: string;
    payments: {
        id: number;
        amount: string;
        mode: string;
        created_at: string;
        kind: string;
        received_by_name?: string;
    }[];
};
const money = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;
export function PaymentSummary({ value, allowCollection = false, onCollected }: {
    value?: PaymentFacts | null;
    allowCollection?: boolean;
    onCollected?: () => void;
}) {
    const [open, setOpen] = useState(false);
    if (!value)
        return null;
    return <section className="sa-stack sa-stack--tight" aria-label="Payment details">
    <div className="sa-amount-row"><span>{value.status === 'CANCELLED' ? 'Originally paid' : 'Amount paid'}</span><strong>{money(value.paid_amount)}</strong></div>
    <div className="sa-amount-row"><span>Outstanding balance</span><strong>{money(value.balance_due)}</strong></div>
    <details><summary>Payment history</summary>{value.payments.map(p => <div key={p.id} className="sa-history-card__item-heading"><span>{receiptLabels[p.mode as keyof typeof receiptLabels] || p.mode} · {p.kind}<br /><small>{formatDateTime(p.created_at)}{p.received_by_name && ` · Collected by ${p.received_by_name}`}</small></span><strong>{money(p.amount)}</strong></div>)}</details>
    {allowCollection && Number(value.balance_due) > 0 && value.status !== 'CANCELLED' && <Button variant="secondary" onClick={() => setOpen(true)}>Collect outstanding balance</Button>}
    {open && <CollectDialog value={value} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onCollected?.(); }}/>}
  </section>;
}
function CollectDialog({ value, onClose, onDone }: {
    value: PaymentFacts;
    onClose: () => void;
    onDone: () => void;
}) {
    const [form, setForm] = useState(emptyCollection);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const scope = `balance-${value.sale_id}`;
    const [pending, setPending] = useState(() => pendingTransaction(scope));
    const due = Number(value.balance_due);
    async function submit() {
        if (busy)
            return;
        const problem = collectionError(form, due);
        if (!pending && (problem || !receiptParts(form).length)) {
            setError(problem || 'Enter a payment received.');
            return;
        }
        setBusy(true);
        setError('');
        // Keep the exact request for a retry after an uncertain network result.
        try {
            await transactionRequest(scope, `/staff-sales/${value.sale_id}/collect-payment/`, pending ? undefined : { payments: receiptParts(form) });
            onDone();
        }
        catch (e) {
            setError(extractApiError(e, [], 'Collection failed. Retry the same payment.'));
        }
        finally {
            setBusy(false);
            setPending(pendingTransaction(scope));
        }
    }
    return <Modal open title="Collect outstanding balance" onClose={busy ? () => { } : onClose} footer={<Button disabled={busy} loading={busy} onClick={submit}>{pending ? 'Retry saved payment' : 'Record payment'}</Button>}>
    <p>Amount due: {money(value.balance_due)}</p>
    {pending ? <p>A previous collection is awaiting confirmation. Retry the saved payment to confirm its result without collecting twice.</p> : <PaymentCollectionForm value={form} total={due} disabled={busy} onChange={setForm}/>}
    {error && <Alert tone="danger">{error}</Alert>}
  </Modal>;
}
