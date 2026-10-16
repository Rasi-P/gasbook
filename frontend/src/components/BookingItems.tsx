import { PricingBreakdown, type PricingSnapshot } from './PricingBreakdown';
import '../styles/products.css';
export type BookingItem = PricingSnapshot & { id: number; name: string; type: 'cylinder' | 'accessory'; cylinder_type?: number; quantity: number; rate: string; total_amount: string };
export function BookingItems({ items }: { items?: BookingItem[] }) {
  if (!items?.length) return null;
  return <div className="booking-item-list" aria-label="Booking items">{items.map(item => <section key={item.id}>
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><span>{item.name} · {item.type === 'cylinder' ? 'Cylinder' : 'Accessory'}<br />{item.quantity} × ₹{Number(item.rate).toLocaleString('en-IN')}</span><strong>₹{Number(item.total_amount).toLocaleString('en-IN')}</strong></div>
    <PricingBreakdown value={item} />
  </section>)}</div>;
}
