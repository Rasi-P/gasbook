import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingDetailItems } from '../src/components/BookingDetailItems';

it('keeps mixed item amounts and discounts clear, with optional saved component details', () => {
  const html = renderToStaticMarkup(<BookingDetailItems items={[
    { id: 1, name: '5kg', type: 'cylinder', quantity: 1, rate: '660', total_amount: '624', rate_type: 'new', deposit_unit_amount: '300', refill_unit_amount: '360' },
    { id: 2, name: 'Hose clips', type: 'accessory', quantity: 25, rate: '60', total_amount: '1500' },
  ]} />);
  expect(html).toContain('₹36 discount applied');
  expect(html).toContain('₹624');
  expect(html).toContain('₹1,500');
  expect(html).toContain('Qty 25 × ₹60 each');
  expect(html).toContain('Deposit &amp; refill breakdown');
  expect(html).not.toContain('<details open');
  expect(html.match(/<article/g)).toHaveLength(2);
});

it('does not invent a legacy deposit or refill breakdown', () => {
  const html = renderToStaticMarkup(<BookingDetailItems items={[
    { id: 1, name: '12kg', type: 'cylinder', quantity: 2, rate: '950', total_amount: '1900' },
  ]} />);
  expect(html).toContain('₹1,900');
  expect(html).not.toContain('<details');
  expect(html).not.toContain('discount applied');
});

it('keeps a fully discounted refill at zero without a deposit', () => {
  const html = renderToStaticMarkup(<BookingDetailItems items={[
    { id: 1, name: '5kg', type: 'cylinder', quantity: 1, rate: '360', total_amount: '0', rate_type: 'refill', deposit_unit_amount: '0', refill_unit_amount: '360' },
  ]} />);
  expect(html).toContain('₹360 discount applied');
  expect(html).toContain('bk-detail-item-amount">₹0');
  expect(html).toContain('Refill breakdown');
  expect(html).not.toContain('Deposit:');
});
