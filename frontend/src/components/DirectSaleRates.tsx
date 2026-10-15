import { Field, Input } from './ui/Field';

/** The existing Rate field is the refill charge; only new cylinders add a deposit. */
export function DirectSaleRates({ rateType, rate, deposit, onRateChange, onDepositChange }: {
  rateType: 'new' | 'refill';
  rate: string;
  deposit: string;
  onRateChange: (value: string) => void;
  onDepositChange: (value: string) => void;
}) {
  return <>
    <Field label="Rate (Rs.)">
      <Input type="number" min="0" step="0.01" required value={rate} onChange={event => onRateChange(event.target.value)} />
    </Field>
    {rateType === 'new' && <Field label="Deposit (Rs.)">
      <Input type="number" min="0" step="0.01" required value={deposit} onChange={event => onDepositChange(event.target.value)} />
    </Field>}
  </>;
}
