import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InventorySummary, InventoryStockBadge } from '../src/components/InventorySummary';
import { matchesInventoryFilter, stockState, summarizeInventory, type InventoryStock } from '../src/lib/inventorySummary';

const products: InventoryStock[] = [
  { stock: 10, reserved: 8, is_active: true, low_stock_threshold: 2 },
  { stock: 0, reserved: 0, is_active: true, low_stock_threshold: 5 },
  { stock: 4, reserved: 4, is_active: true, low_stock_threshold: 5 },
  { stock: 20, reserved: 0, is_active: true, low_stock_threshold: 3 },
  { stock: 0, reserved: 0, is_active: false, low_stock_threshold: 5 },
  { stock: 3, reserved: 1, is_active: true, low_stock_threshold: 0 },
];

it('counts physical and reserved units separately, with active-only warnings', () => {
  expect(summarizeInventory(products)).toEqual({ total: 6, active: 5, inactive: 1, units: 37, reserved: 13, low: 1, out: 1, fullyReserved: 1, unavailable: 2 });
  expect(summarizeInventory([{ stock: 7, reserved: 2, is_active: false, low_stock_threshold: 10 }])).toMatchObject({ units: 7, reserved: 2, low: 0, unavailable: 0 });
});

it('uses individual thresholds including the boundary and zero, without counting reservations as available', () => {
  expect(products.map(stockState)).toEqual(['low', 'out', 'reserved', 'available', 'inactive', 'available']);
  expect(stockState({ ...products[0], stock: 11 })).toBe('available');
  expect(stockState({ ...products[0], stock: 9 })).toBe('low');
  expect(products.filter(p => matchesInventoryFilter(p, 'low'))).toHaveLength(1);
  expect(products.filter(p => matchesInventoryFilter(p, 'unavailable'))).toHaveLength(2);
  expect(products.filter(p => matchesInventoryFilter(p, 'all'))).toHaveLength(6);
});

it('shows placeholders or unavailable values instead of zero before a successful load', () => {
  const props = { products: [], ready: false, filter: 'all' as const, onFilter: () => {} };
  const loading = renderToStaticMarkup(<InventorySummary {...props} loading />);
  expect(loading).toContain('Loading inventory summary');
  expect(loading).not.toContain('ui-stat__value');
  const failed = renderToStaticMarkup(<InventorySummary {...props} loading={false} />);
  expect(failed.match(/ui-stat__value">—/g)).toHaveLength(4);
  expect(failed.match(/disabled/g)).toHaveLength(2);
  expect(summarizeInventory([])).toMatchObject({ total: 0, units: 0, low: 0, unavailable: 0 });
});

it('exposes keyboard filter buttons and distinct low, empty and reserved labels', () => {
  const html = renderToStaticMarkup(<InventorySummary products={products} loading={false} ready filter="low" onFilter={() => {}} />);
  expect(html).toContain('Filter low-stock products');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('5 active · 1 inactive');
  expect(html).toContain('13 reserved · included in total');
  expect(renderToStaticMarkup(<InventoryStockBadge product={products[0]} />)).toContain('Low stock');
  expect(renderToStaticMarkup(<InventoryStockBadge product={products[1]} />)).toContain('Out of stock');
  expect(renderToStaticMarkup(<InventoryStockBadge product={products[2]} />)).toContain('Fully reserved');
  expect(renderToStaticMarkup(<InventoryStockBadge product={products[4]} />)).toBe('');
});
