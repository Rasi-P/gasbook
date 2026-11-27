// UI-only checks: every API request is mocked; no development records are changed.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
const token = `test.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64')}.test`;
await context.addInitScript(token => { localStorage.setItem('gasbook_access', token); localStorage.setItem('gasbook_role', 'staff'); }, token);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const list = results => ({ count: results.length, results, next: null, previous: null });
let collectionState = 'loading', releaseCollection;
const initialCollection = new Promise(resolve => { releaseCollection = resolve; });
let saleBody, releaseSale, loseSaleResponse = false, requests = 0;
const pendingSale = new Promise(resolve => { releaseSale = resolve; });
const customer = { id: 3, name: 'Test Customer With A Long Name', phone: '9000000001', address: 'Test address', pending_amount: '120', custom_rates: [{ cylinder_type: 2, custom_price: '360.00' }] };
const products = [{ id: 4, name: 'Regulator with a long accessory name for mobile testing', selling_price: '250.00' }];
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path.endsWith('/collections-today/')) {
    if (collectionState === 'loading') await initialCollection;
    if (collectionState === 'error') return route.fulfill({ status: 503, json: { detail: 'Please try again.' } });
    return route.fulfill({ json: { date: '2026-10-17', total: collectionState === 'empty' ? '0' : '1275.50', methods: collectionState === 'empty' ? { cash: '0', gpay: '0', bank: '0' } : { cash: '400', gpay: '600', bank: '275.50' }, refunds: '0' } });
  }
  if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 7, role: 'staff', username: 'staff', name: 'Test Staff' } });
  if (path.endsWith('/customers/')) return route.fulfill({ json: list(new URL(request.url()).searchParams.get('search') === 'none' ? [] : [customer]) });
  if (path.endsWith('/cylinder-types/')) return route.fulfill({ json: list([{ id: 2, name: '5kg', is_active: true, refill_rate: '380.00', deposit_amount: '300.00' }]) });
  if (path.endsWith('/products/')) return route.fulfill({ json: list(products) });
  if (path.endsWith('/locations/')) return route.fulfill({ json: list([{ id: 1, name: 'Shop', code: 'shop', is_active: true }]) });
  if (path.endsWith('/stock/')) return route.fulfill({ json: list([{ location: 1, cylinder_type: 2, quantity: 20 }]) });
  if (path.endsWith('/staff-sales/preview/')) {
    const body = request.postDataJSON();
    if (body.sale_items.some(line => ['refill_charge', 'deposit'].some(field => field in line && (line[field] === '' || Number(line[field]) < 0)))) {
      return route.fulfill({ status: 400, json: { detail: 'Enter a valid non-negative rate.' } });
    }
    const items = body.sale_items.map(line => {
      const refill = Number(line.refill_charge ?? 360), deposit = line.rate_type === 'new' ? Number(line.deposit ?? 300) : 0;
      return { ...line, cylinder_type_name: '5kg', rate: String(deposit + refill), discount_amount: String(refill * line.quantity * .1), deposit_unit_amount: String(deposit), refill_unit_amount: String(refill), final_amount: String((deposit + refill * .9) * line.quantity) };
    });
    const accessory_items = body.accessory_lines.map(line => ({ name: products[0].name, quantity: line.quantity, rate: '250', total_amount: String(line.quantity * 250) }));
    return route.fulfill({ json: { items, accessory_items, total_amount: String(items.reduce((sum, line) => sum + Number(line.final_amount), 0) + accessory_items.reduce((sum, line) => sum + Number(line.total_amount), 0)) } });
  }
  if (path.endsWith('/staff-sales/') && request.method() === 'POST') {
    assert.equal(request.headers().authorization, `Bearer ${token}`);
    saleBody = request.postDataJSON(); requests++;
    await pendingSale;
    if (loseSaleResponse) { loseSaleResponse = false; return route.abort('failed'); }
    return route.fulfill({ json: { id: 81, total_amount: '874', paid_amount: '400', balance_due: '474', payment_summary: { sale_id: 81, total_amount: '874', paid_amount: '400', balance_due: '474', status: 'PARTIAL', payments: [] } } });
  }
  assert.equal(request.method(), 'GET', `Unexpected mutation: ${path}`);
  return route.fulfill({ json: list([]) });
});
const nav = page.getByRole('navigation', { name: 'Staff navigation' });
async function go(label) {
  await nav.getByRole('button', { name: label, exact: true }).click();
  await expect(nav.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
}
async function responsive(name) {
  for (const width of [320, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: overflow at ${width}`);
    const buttons = await nav.getByRole('button').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height, clipped: node.scrollWidth > node.clientWidth }; }));
    assert.equal(buttons.length, 5);
    buttons.forEach((b, i) => { assert.ok(b.width >= 50 && b.height >= 44 && !b.clipped, `${name}: tab target at ${width}`); if (i) assert.ok(b.x >= buttons[i - 1].right); });
    if (name === 'home') {
      const amounts = await page.locator('.sa-collections__method strong').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().bottom));
      assert.ok(Math.max(...amounts) - Math.min(...amounts) < 1, `Collection amounts misaligned at ${width}`);
    }
    if (name === 'sale-items') {
      const rates = await page.locator('.sa-sale__rates input').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, width: r.width, height: r.height }; }));
      assert.equal(rates.length, 2);
      assert.ok(Math.abs(rates[0].top - rates[1].top) < 1, `Rate fields misaligned at ${width}`);
      assert.ok(Math.abs(rates[0].width - rates[1].width) < 1, `Rate widths differ at ${width}`);
      for (const rate of rates) assert.equal(rate.height, width < 768 ? 44 : 40);
      const quantity = await page.getByLabel('Quantity', { exact: true }).boundingBox();
      const returned = await page.getByLabel('Empty returned', { exact: true }).boundingBox();
      assert.ok(Math.abs(quantity.y - returned.y) < 1, `Handling fields misaligned at ${width}`);
      const clipped = await page.locator('.sa-sale__item input, .sa-sale__item select, .sa-sale__item button').evaluateAll(nodes => nodes.some(node => {
        const r = node.getBoundingClientRect(), item = node.closest('.sa-sale__item').getBoundingClientRect();
        return r.left < item.left || r.right > item.right;
      }));
      assert.equal(clipped, false, `Item controls clipped at ${width}`);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastCard = page.locator('.sa-sale__section').last();
    if (await lastCard.count()) assert.ok(await lastCard.evaluate(n => n.getBoundingClientRect().bottom) <= await nav.evaluate(n => n.getBoundingClientRect().top), `${name}: content behind navigation at ${width}`);
    await page.screenshot({ path: `/private/tmp/staff-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 900 });
}
try {
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff-dashboard`);
  const collections = page.getByLabel("Today's Collection", { exact: true });
  await expect(collections).toHaveAttribute('aria-busy', 'true');
  await expect(collections).not.toContainText('₹0');
  collectionState = 'ready'; releaseCollection();
  await expect(collections).toContainText('₹1,275.5');
  await expect(collections.locator('.sa-collections__method')).toHaveText(['Cash₹400.00', 'UPI / GPay₹600.00', 'Bank Transfer₹275.50']);
  await expect(page.getByRole('button', { name: 'New Direct Sale', exact: true })).toHaveCount(0);
  await responsive('home');
  for (const tab of ['Deliveries', 'Sale', 'History', 'Profile', 'Home']) await go(tab);
  collectionState = 'empty'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(collections).toContainText('No payments collected today yet.');
  collectionState = 'error'; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(collections.getByRole('button', { name: /retry/i })).toBeVisible();
  collectionState = 'ready'; await collections.getByRole('button', { name: /retry/i }).click();
  await expect(collections).toContainText('₹1,275.5');
  await go('Sale'); await expect(page).toHaveURL(/tab=sale/); await page.reload();
  await expect(nav.getByRole('button', { name: 'Sale', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'New Direct Sale' })).toBeVisible();
  await responsive('sale-empty');
  await page.getByLabel('Search by name or phone').fill('none');
  await expect(page.getByText('No customers found. Try another name or phone number.')).toBeVisible();
  await page.getByLabel('Search by name or phone').fill('9000');
  await page.getByRole('button', { name: /Test Customer With A Long Name/ }).click();
  await page.getByRole('button', { name: 'Continue to items', exact: true }).click();
  await page.getByRole('button', { name: 'Add cylinder', exact: true }).click();
  const refillRate = page.getByLabel('Refill Rate (Rs.)', { exact: true });
  const depositRate = page.getByLabel('Deposit (Rs.)', { exact: true });
  await expect(refillRate).toHaveValue('360.00'); // customer-agreed rate, not catalog 380
  await expect(depositRate).toHaveCount(0);
  await refillRate.fill('400');
  await expect(page.getByLabel('Order summary')).toContainText('₹360');
  await refillRate.fill('-1');
  await expect(page.getByText('Enter a valid non-negative rate.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to payment', exact: true })).toBeDisabled();
  await refillRate.fill('');
  await expect(page.getByRole('button', { name: 'Continue to payment', exact: true })).toBeDisabled();
  await refillRate.fill('0');
  await expect(page.getByLabel('Order summary').locator('.sa-sale__total')).toContainText('₹0');
  await refillRate.fill('400');
  await page.getByLabel('Rate type').selectOption('new');
  await expect(depositRate).toHaveValue('300.00');
  await depositRate.fill('500');
  await expect(page.getByLabel('Order summary').locator('.sa-sale__total')).toContainText('₹860');
  await page.getByLabel('Rate type').selectOption('refill');
  await expect(depositRate).toHaveCount(0);
  await expect(page.getByLabel('Order summary').locator('.sa-sale__total')).toContainText('₹360');
  await page.getByLabel('Rate type').selectOption('new');
  await expect(depositRate).toHaveValue('500');
  await refillRate.fill('360');
  await depositRate.fill('300');
  await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Decrease quantity', exact: true }).click();
  await page.getByRole('button', { name: 'Add accessory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue to payment', exact: true })).toBeEnabled();
  await responsive('sale-items');
  await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  const review = page.getByLabel('Order summary'); await expect(review).toContainText('₹874');
  await review.getByText('Pricing breakdown', { exact: true }).click();
  await expect(review).toContainText('Refill discount: −₹36.00');
  await review.getByText('Pricing breakdown', { exact: true }).click();
  await page.getByRole('radio', { name: 'Split payment', exact: true }).click();
  await page.getByLabel('Cash received (Rs.)', { exact: true }).fill('100');
  await page.getByLabel('UPI / GPay received (Rs.)', { exact: true }).fill('300');
  await expect(page.locator('.sa-sale__payment')).toContainText('₹474');
  await page.getByRole('navigation', { name: 'Sale steps' }).getByRole('button', { name: /Items/ }).click();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Accessory quantity', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Continue to payment', exact: true }).click();
  await expect(page.getByLabel('Cash received (Rs.)', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('UPI / GPay received (Rs.)', { exact: true })).toHaveValue('300');
  await page.getByLabel('Bank Transfer received (Rs.)').fill('600');
  await expect(page.getByRole('button', { name: 'Complete sale', exact: true })).toBeDisabled();
  await page.getByLabel('Bank Transfer received (Rs.)').fill('');
  await responsive('sale-split');
  await page.getByRole('radio', { name: 'Credit / Pay later', exact: true }).click();
  await expect(page.locator('.sa-sale__payment')).toContainText('₹874');
  await expect(page.getByRole('button', { name: 'Complete sale', exact: true })).toBeEnabled();
  await page.getByRole('radio', { name: 'Split payment', exact: true }).click();
  await page.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Home', exact: true })).toBeDisabled();
  await expect.poll(() => requests).toBe(1);
  const submitted = structuredClone(saleBody);
  assert.deepEqual(saleBody.split_payments, [{ mode: 'cash', amount: '100.00' }, { mode: 'gpay', amount: '300.00' }]);
  for (const field of ['sold_by', 'received_by', 'handover_staff']) assert.ok(!(field in saleBody));
  assert.ok(saleBody.client_ref);
  assert.equal(saleBody.sale_items[0].refill_charge, '360');
  assert.equal(saleBody.sale_items[0].deposit, '300');
  assert.deepEqual(saleBody.accessory_lines, [{ product: 4, quantity: 1 }]);
  loseSaleResponse = true; releaseSale();
  await expect(page.getByRole('button', { name: 'Retry saved sale' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Retry saved sale' }).click();
  await expect(page.getByText('Direct Sale #81 completed')).toBeVisible();
  assert.deepEqual(saleBody, submitted); assert.equal(requests, 2);
  await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await go('Sale'); await page.goBack();
  await expect(nav.getByRole('button', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  assert.deepEqual(errors, []);
  console.log('PASS staff UI: collection loading/empty/error/retry, five route-backed tabs, search, mixed items, quantity controls, edited refill/deposit rates, agreed defaults, invalid/zero rates, quoted prices, fixed accessories, split/credit, overpayment validation, authenticated request, durable retry, seven responsive widths, compact aligned fields and bottom-nav clearance. All APIs mocked.');
} catch (error) {
  await page.screenshot({ path: '/private/tmp/staff-sale-ui-failure.png', fullPage: true });
  console.error((await page.locator('body').innerText()).slice(0, 6000)); throw error;
} finally { await browser.close(); }
