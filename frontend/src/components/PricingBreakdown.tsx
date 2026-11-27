export type PricingSnapshot = {
  rate_type?: 'new' | 'refill' | null;
  deposit_unit_amount?: string | number | null;
  refill_unit_amount?: string | number | null;
  quantity?: number;
  final_amount?: string | number | null;
  total_amount?: string | number | null;
};

const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Only saved/quoted snapshots are rendered; legacy rows never use current rates. */
export function PricingBreakdown({ value }: { value?: PricingSnapshot | null }) {
  if (!value?.rate_type || value.deposit_unit_amount == null || value.refill_unit_amount == null) return null;
  const quantity = Number(value.quantity ?? 0);
  const deposit = Number(value.deposit_unit_amount);
  const refill = Number(value.refill_unit_amount);
  const total = value.final_amount ?? value.total_amount;
  const discount = total == null ? 0 : Math.max(0, (deposit + refill) * quantity - Number(total));
  return <div className="pricing-components" style={{ display: 'grid', gap: 4, minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: '0.85rem' }}>
    <strong>{value.rate_type === 'new' ? 'New Cylinder' : 'Refill'}</strong>
    {value.rate_type === 'new' && <span>Deposit: {money(deposit)} × {quantity} = {money(deposit * quantity)}</span>}
    <span>Refill Charge: {money(refill)} × {quantity} = {money(refill * quantity)}</span>
    {discount > 0.005 && <span>Refill discount: −{money(discount)}</span>}
    {total != null && <strong>Total: {money(Number(total))}</strong>}
  </div>;
}
