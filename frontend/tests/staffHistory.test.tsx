import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaffDirectSaleCard, StaffHistoryRows, type StaffDirectSale, type StaffHistoryEntry } from '../src/components/StaffHistory';

const sale: StaffDirectSale = {
  id: 32, customer_name: 'Test Customer', total_amount: '1800.00', status: 'completed',
  created_at: '2026-10-13T20:45:00Z', cancelled_at: null,
  items: [{ id: 1, cylinder_type_name: '19 KG Cylinder', quantity: 2, total_amount: '1800.00' }],
};

it('renders a sale as a sale with its customer, cylinders, amount and recorded IST time', () => {
  const html = renderToStaticMarkup(<StaffDirectSaleCard sale={sale} />);
  for (const text of ['Direct Sale #32', 'Test Customer', '19 KG Cylinder (2 qty)', '₹1,800', 'Sale completed', 'Recorded 14 Oct 2026']) {
    expect(html).toContain(text);
  }
  expect(html).toMatch(/02:15 am IST/i);
  expect(html).not.toContain('Delivered');
  expect(html).not.toContain('Amount Collected');
});

it('keeps cancelled sales visible with their cancellation time', () => {
  const html = renderToStaticMarkup(<StaffDirectSaleCard sale={{ ...sale, status: 'cancelled', cancelled_at: '2026-10-15T01:00:00Z' }} />);
  expect(html).toContain('Cancelled');
  expect(html).toContain('15 Oct 2026');
  expect(html).toMatch(/06:30 am IST/i);
  expect(html).not.toContain('Sale completed');
});

it('keeps server ordering and both source types even when numeric IDs collide', () => {
  const entries: StaffHistoryEntry<{ reference: string }>[] = [
    { history_source: 'sale', source_id: 32, occurred_at: sale.created_at, sale },
    { history_source: 'delivery', source_id: 32, occurred_at: null, delivery: { reference: 'Order #GB91' } },
    { history_source: 'sale', source_id: 33, occurred_at: sale.created_at, sale: { ...sale, id: 33 } },
  ];
  const html = renderToStaticMarkup(<StaffHistoryRows entries={entries} renderDelivery={delivery => <div>{delivery.reference} · Delivered</div>} />);
  expect(html.match(/Direct Sale #32/g)?.length).toBe(1);
  expect(html.match(/Order #GB91/g)?.length).toBe(1);
  expect(html.indexOf('Direct Sale #32')).toBeLessThan(html.indexOf('Order #GB91'));
  expect(html.indexOf('Order #GB91')).toBeLessThan(html.indexOf('Direct Sale #33'));
});
