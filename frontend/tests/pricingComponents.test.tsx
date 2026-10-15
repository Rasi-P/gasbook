import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricingBreakdown } from '../src/components/PricingBreakdown';

const line = { rate_type: 'new' as const, deposit_unit_amount: '450.00', refill_unit_amount: '300.00', quantity: 3, total_amount: '2150.00' };
it('shows both quantity-scaled components, refill discount and exact saved total', () => {
  const html = renderToStaticMarkup(<PricingBreakdown value={line} />);
  for (const text of ['New Cylinder', 'Deposit: ₹450.00 × 3 = ₹1,350.00', 'Refill Charge: ₹300.00 × 3 = ₹900.00', 'Refill discount: −₹100.00', 'Total: ₹2,150.00']) expect(html).toContain(text);
});
it('refills display no deposit and preserve a fully discounted zero total', () => {
  const html = renderToStaticMarkup(<PricingBreakdown value={{ ...line, rate_type: 'refill', deposit_unit_amount: '0', total_amount: '0' }} />);
  expect(html).not.toContain('Deposit:');
  expect(html).toContain('Refill discount: −₹900.00');
  expect(html).toContain('Total: ₹0.00');
});
it('does not fabricate legacy or missing component breakdowns', () => {
  expect(renderToStaticMarkup(<PricingBreakdown value={{ total_amount: '777', quantity: 1 }} />)).toBe('');
  expect(renderToStaticMarkup(<PricingBreakdown value={{ ...line, deposit_unit_amount: null }} />)).toBe('');
});

import { SaleItemsCell } from '../src/components/SaleItemsCell';
import { StaffDirectSaleCard } from '../src/components/StaffHistory';
import RatesPanel from '../src/components/RatesPanel';
it('admin sales/reports and staff history render the same saved line components', () => {
  const item = { ...line, id: 1, cylinder_type_name: '5kg', rate: 716.67 };
  const admin = renderToStaticMarkup(<SaleItemsCell customerName="Buyer" items={[item]} />);
  const staff = renderToStaticMarkup(<StaffDirectSaleCard sale={{ id: 32, customer_name: 'Buyer', items: [item], total_amount: '2150', status: 'cancelled', created_at: '2026-10-15T04:00:00Z', cancelled_at: '2026-10-15T05:00:00Z' }} />);
  for (const html of [admin, staff]) {
    expect(html).toContain('Deposit: ₹450.00 × 3 = ₹1,350.00');
    expect(html).toContain('Total: ₹2,150.00');
  }
  expect(staff).toContain('Direct Sale #32');
  expect(staff).toContain('Cancelled');
});
it('rates editor uses the explicit deposit label', () => {
  const html = renderToStaticMarkup(<RatesPanel open onClose={() => {}} />);
  expect(html).toContain('New Cylinder Deposit (Rs.)');
  expect(html).toContain('Refill (Rs.)');
  expect(html).not.toContain('Sale (Rs.)');
});
