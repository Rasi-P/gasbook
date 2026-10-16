import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookingItems } from '../src/components/BookingItems';
import { SaleItemsCell } from '../src/components/SaleItemsCell';
it('shows saved mixed items in booking and delivery details', () => {
  const html = renderToStaticMarkup(<BookingItems items={[{ id: 1, name: 'Gas cylinder', type: 'cylinder', quantity: 1, rate: '360', total_amount: '360' }, { id: 2, name: 'Hose', type: 'accessory', quantity: 2, rate: '180', total_amount: '360' }]} />);
  for (const value of ['Gas cylinder', 'Hose', 'Cylinder', 'Accessory', '180', '360']) expect(html).toContain(value);
});
it('includes accessories once in existing sale/history details without cylinder empty markers', () => {
  const html = renderToStaticMarkup(<SaleItemsCell customerName="Customer" items={[{ cylinder_type_name: '5kg', quantity: 1, rate: 360 }]} accessoryItems={[{ id: 2, name: 'Regulator', type: 'accessory', quantity: 1, rate: '250', total_amount: '250' }]} />);
  expect(html.split('Regulator')).toHaveLength(2); expect(html).not.toContain('Regulator empties');
});
