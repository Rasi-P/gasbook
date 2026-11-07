import { Banknote, Smartphone, Landmark, Split, Clock } from 'lucide-react';
import { ChoiceChips } from './ui/ChoiceChips';
import { Field, Input } from './ui/Field';
import { Alert } from './ui/Alert';
import { receiptLabels, receiptParts, collectionError, type ReceiptMode, type CollectionForm } from '../lib/paymentCollection';
export function PaymentCollectionForm({ value, onChange, total, disabled = false, presentation = 'default' }: {
    value: CollectionForm;
    onChange: (value: CollectionForm) => void;
    total: number;
    disabled?: boolean;
    presentation?: 'default' | 'tiles';
}) {
    const modes: ReceiptMode[] = value.mode === 'split' ? ['cash', 'gpay', 'bank'] : value.mode === 'credit' ? [] : [value.mode];
    const paid = receiptParts(value).reduce((sum, p) => sum + Number(p.amount), 0);
    const error = collectionError(value, total);
    const icons = { cash: <Banknote size={20} />, gpay: <Smartphone size={20} />, bank: <Landmark size={20} /> };
    const untouched = modes.every(mode => value[mode] === '');
    const amountFields = modes.map(mode => <Field key={mode} label={`${receiptLabels[mode]} received (Rs.)`}><Input type="number" min="0" step="0.01" inputMode="decimal" disabled={disabled} value={value[mode]} onChange={e => onChange({ ...value, [mode]: e.target.value })}/></Field>);
    const totals = <>
    <div className="sa-amount-row"><span>Collected now</span><strong>₹{paid.toLocaleString('en-IN')}</strong></div>
    <div className="sa-amount-row"><span>Outstanding credit</span><strong>₹{Math.max(0, total - paid).toLocaleString('en-IN')}</strong></div>
    </>;
    return <div className="sa-stack sa-stack--tight">
    <ChoiceChips className={presentation === 'tiles' ? 'sa-sale__payment-methods' : undefined} ariaLabel="Payment method" value={value.mode} disabled={disabled} onChange={mode => onChange({ ...value, mode })} options={[...Object.entries(receiptLabels).map(([value, label]) => ({ value: value as ReceiptMode, label, icon: presentation === 'tiles' ? icons[value as ReceiptMode] : undefined })), { value: 'split', label: 'Split payment', icon: presentation === 'tiles' ? <Split size={20} /> : undefined }, { value: 'credit', label: 'Credit / Pay later', icon: presentation === 'tiles' ? <Clock size={20} /> : undefined }]}/>
    {presentation === 'tiles' ? <div className={`sa-sale__amounts${modes.length > 1 ? ' sa-sale__amounts--split' : ''}`}>{amountFields}</div> : amountFields}
    {presentation === 'tiles' ? <div className="sa-sale__payment-totals">{totals}</div> : totals}
    {error && (presentation === 'tiles' && untouched ? <p className="sa-muted">Enter the amount received to complete this sale.</p> : <Alert tone="warning" compact>{error}</Alert>)}
  </div>;
}
