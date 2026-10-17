// All API calls are mocked: these checks never write business records.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => { localStorage.setItem('gasbook_access', 'test'); localStorage.setItem('gasbook_role', 'admin'); });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const list = results => ({ results, count: results.length, next: null, previous: null });
const products = [
  { id: 9, name: 'Gas regulator with a long product name for mobile testing', selling_price: '250', stock: 10, reserved: 2, available: true, is_active: true },
  { id: 3, name: 'Gas hose', selling_price: '180', stock: 12, reserved: 0, available: true, is_active: true },
  { id: 4, name: 'Inactive product', selling_price: '50', stock: 10, reserved: 0, available: false, is_active: false },
  { id: 5, name: 'Fully reserved product', selling_price: '50', stock: 10, reserved: 10, available: false, is_active: true },
];
let productsFail = false, requests = [];
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 1, name: 'Admin', username: 'admin', role: 'admin' } });
  if (path.endsWith('/products/')) return route.fulfill(productsFail ? { status: 503, json: { detail: 'Catalog temporarily unavailable' } } : { json: list(products) });
  if (path.endsWith('/cylinder-types/')) return route.fulfill({ json: list([{ id: 1, name: '5kg', refill_rate: '360', deposit_amount: '300' }]) });
  if (path.endsWith('/locations/')) return route.fulfill({ json: list([{ id: 1, name: 'Shop', code: 'shop', is_main_supplier: false }]) });
  if (path.endsWith('/stock/')) return route.fulfill({ json: list([{ cylinder_type: 1, location: 1, status: 'filled', quantity: 50 }]) });
  if (path.endsWith('/customers/')) return route.fulfill({ json: list([{ id: 2, name: 'Test customer', phone: '9000000000', address: '', pending_balance: 0, empties_owed: {}, empty_credits: {}, custom_rates: [], is_active: true }]) });
  if (path.endsWith('/sales/preview/')) {
    const body = request.postDataJSON();
    for (const item of body.accessory_lines) assert.deepEqual(Object.keys(item).sort(), ['product', 'quantity']);
    if (body.accessory_lines.some(item => item.quantity > 8 || item.quantity < 1)) return route.fulfill({ status: 400, json: { detail: 'Insufficient accessory stock.' } });
    // The trusted quote has a newer regulator price than the cached catalog.
    const accessory_items = [...body.accessory_lines].sort((a, b) => a.product - b.product).map(line => ({ name: products.find(p => p.id === line.product).name, quantity: line.quantity, rate: String(line.product === 9 ? 275 : 180), total_amount: String(line.quantity * (line.product === 9 ? 275 : 180)) }));
    const cylinderTotal = body.sale_items.reduce((sum, line) => sum + line.quantity * (Number(line.refill_charge) + Number(line.deposit)), 0);
    return route.fulfill({ json: { accessory_items, total_amount: String(cylinderTotal + accessory_items.reduce((sum, line) => sum + Number(line.total_amount), 0)), discount_amount: '0' } });
  }
  if (path.endsWith('/sales/') && request.method() === 'POST') { requests.push(request.postDataJSON()); return route.fulfill({ json: { id: 80 + requests.length } }); }
  assert.equal(request.method(), 'GET', `Unexpected write: ${path}`);
  return route.fulfill({ json: list([]) });
});
const panel = page.getByLabel('Accessories', { exact: true });
const total = page.locator('.sale-total__value');
async function customer() { await page.getByPlaceholder('Search or enter new customer').fill('Test'); await page.getByRole('button', { name: /Test customer/ }).click(); }
try {
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/sales`);
  await customer();
  await panel.getByRole('button', { name: 'Add accessory' }).click();
  await expect(panel.getByLabel('Product').locator('option')).toHaveText([products[0].name, 'Gas hose']);
  await expect(panel.getByLabel('Rate (Rs.)')).toHaveValue('275');
  await expect(panel.getByLabel('Rate (Rs.)')).toHaveAttribute('readonly', '');
  await panel.getByLabel('Accessory quantity').fill('2');
  await expect(total).toHaveText('Rs. 550');
  await panel.getByRole('button', { name: 'Add accessory' }).click();
  await expect(panel.getByRole('button', { name: 'Add accessory' })).toBeDisabled();
  await expect(panel.getByLabel('Product').last().locator('option[value="9"]')).toHaveAttribute('disabled', '');
  await expect(panel.locator('.sale-accessory__subtotal strong')).toHaveText(['Rs. 550', 'Rs. 180']);
  await expect(total).toHaveText('Rs. 730');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(total).toHaveText('Rs. 1,090');
  await page.getByRole('radio', { name: 'Split', exact: true }).click();
  await page.getByLabel('Cash Paid', { exact: true }).fill('400');
  await page.getByLabel('GPay Paid', { exact: true }).fill('690');
  await expect(page.getByLabel('Credit (Pending)')).toHaveValue('0');
  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
    assert.equal(await panel.locator('.sale-accessory').evaluateAll(rows => rows.some(row => row.scrollWidth > row.clientWidth)), false);
  }
  await page.getByRole('button', { name: 'Complete Sale', exact: true }).click();
  await expect(page.getByText(/Sale saved!/)).toBeVisible();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].accessory_lines, [{ product: 9, quantity: 2 }, { product: 3, quantity: 1 }]);
  assert.equal(requests[0].sale_items.length, 1);
  assert.equal(requests[0].quoted_total, '1090.00'); assert.equal(requests[0].paid_amount, '1090.00');
  assert.deepEqual(requests[0].split_payments, [{ mode: 'cash', amount: 400 }, { mode: 'gpay', amount: 690 }]);
  await expect(panel.locator('.sale-accessory')).toHaveCount(0);
  await expect(total).toHaveText('—');
  await customer(); await panel.getByRole('button', { name: 'Add accessory' }).click();
  await panel.getByLabel('Accessory quantity').fill('9');
  await expect(page.getByText('Insufficient accessory stock.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Sale', exact: true })).toBeDisabled();
  await panel.getByLabel('Accessory quantity').fill('1');
  await expect(total).toHaveText('Rs. 275');
  await page.getByRole('radio', { name: 'Credit', exact: true }).click();
  await page.getByLabel('Amount Received (Rs.)').fill('100');
  await expect(page.locator('.sale-total__pending')).toHaveText('Pending: Rs. 175');
  await page.getByRole('button', { name: 'Complete Sale', exact: true }).click();
  await expect(panel.locator('.sale-accessory')).toHaveCount(0);
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].sale_items, []);
  assert.equal(requests[1].quoted_total, '275.00'); assert.equal(requests[1].paid_amount, '100.00');
  await panel.getByRole('button', { name: 'Add accessory' }).click();
  await expect(total).toHaveText('Rs. 275');
  await panel.getByRole('button', { name: 'Remove accessory' }).click();
  await expect(total).toHaveText('—');
  await page.getByRole('tab', { name: 'Return Empties Only' }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sale', exact: true }).click();
  productsFail = true; await page.reload();
  await expect(panel).toContainText('Catalog temporarily unavailable');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(total).toHaveText('Rs. 360'); // Catalog failure must not block cylinders.
  productsFail = false; await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(panel.getByRole('button', { name: 'Add accessory' })).toBeEnabled();
  assert.deepEqual(errors, []);
  console.log('PASS: admin mixed and accessory-only sales, trusted quote rates, split/credit totals, availability, duplicate selection prevention, insufficient stock, reset/removal, empty-return isolation, catalog retry, cylinder compatibility, six responsive widths. All APIs mocked.');
} catch (e) { console.error((await page.locator('body').innerText()).slice(0, 5000)); await page.screenshot({ path: '/private/tmp/admin-sale-accessories-failure.png', fullPage: true }); throw e; }
finally { await browser.close(); }
