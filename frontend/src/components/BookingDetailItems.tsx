import type { BookingItem } from './BookingItems';
import { PricingBreakdown } from './PricingBreakdown';

const money = (value: string | number) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Compact read-only summary using the order's saved prices, including legacy items. */
export function BookingDetailItems({ items }: { items: BookingItem[] }) {
  return <div className="bk-detail-items">
    {items.map(item => {
      const discount = Math.max(0, Number(item.rate) * item.quantity - Number(item.total_amount));
      const hasBreakdown = item.rate_type && item.deposit_unit_amount != null && item.refill_unit_amount != null;
      return <article className="bk-detail-item" key={item.id}>
        <div className="bk-detail-item-row">
          <div>
            <strong>{item.name}{item.type === 'cylinder' ? ' cylinder' : ''}</strong>
            <span className="bk-detail-muted">{item.type === 'accessory' ? 'Accessory' : item.rate_type === 'new' ? 'New cylinder' : item.rate_type === 'refill' ? 'Refill' : 'Cylinder'}</span>
            <span className="bk-detail-muted">Qty {item.quantity} × {money(item.rate)} each</span>
            {discount > 0.005 && <span className="bk-detail-saving">{money(discount)} discount applied</span>}
          </div>
          <strong className="bk-detail-item-amount">{money(item.total_amount)}</strong>
        </div>
        {hasBreakdown && <details className="bk-detail-breakdown">
          <summary>{item.rate_type === 'new' ? 'Deposit & refill breakdown' : 'Refill breakdown'}</summary>
          <PricingBreakdown value={item} />
        </details>}
      </article>;
    })}
  </div>;
}
