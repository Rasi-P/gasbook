// Run against local Vite; all API requests are mocked and no business records change.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem('gasbook_access', 'test'); localStorage.setItem('gasbook_role', 'staff'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const delivery = { id: 10, booking: 47, order_id: 'GB47', status: 'delivered', customer_name: 'Customer With A Very Long Name For Responsive Layout Testing', cylinder_type_name: '5kg', quantity: 1, rate: '660', original_amount: '2160', final_amount: '2124', booked_at: '2026-10-16T07:07:00Z', completed_at: '2026-10-16T07:09:00Z', order_items: [
    { id: 1, name: '5kg', type: 'cylinder', quantity: 1, rate: '660', total_amount: '624', rate_type: 'new', deposit_unit_amount: '300', refill_unit_amount: '360' },
    { id: 2, name: 'Hose Clips With A Long Accessory Name', type: 'accessory', quantity: 25, rate: '60', total_amount: '1500' },
  ] };
  const sale = { id: 35, customer_name: 'Customer', total_amount: '450', status: 'completed', created_at: '2026-10-14T15:11:00Z', cancelled_at: null, items: [{ id: 1, cylinder_type_name: '5kg', quantity: 1, total_amount: '450' }] };
  const entries = [
    { history_source: 'delivery', source_id: 10, delivery },
    { history_source: 'sale', source_id: 35, sale },
    { history_source: 'sale', source_id: 34, sale: { ...sale, id: 34, status: 'cancelled', cancelled_at: '2026-10-15T10:00:00Z' } },
    { history_source: 'delivery', source_id: 11, delivery: { ...delivery, id: 11, booking: 48, order_id: 'GB48', order_items: [], rate_type: 'refill', deposit_unit_amount: '0', refill_unit_amount: '360', total_amount: '0', final_amount: '0' } },
  ];
  const list = results => ({ count: results.length, results, next: null, previous: null });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    assert.equal(route.request().method(), 'GET');
    if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 5, username: 'staff', role: 'staff', name: 'Staff Member' } });
    if (path.endsWith('/deliveries/history/')) return route.fulfill({ json: list(entries) });
    if (path.endsWith('/deliveries/')) return route.fulfill({ json: list([delivery]) });
    return route.fulfill({ json: list([]) });
  });
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff-dashboard`);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const cards = page.locator('.sa-history-card');
  await expect(cards).toHaveCount(4);
  const first = cards.first();
  await expect(first).toContainText('Order #GB47');
  await expect(first).toContainText('12:37 pm IST');
  await expect(first).toContainText('12:39 pm IST');
  await expect(first.locator('.sa-amount-row')).toHaveText('Order total₹2,124');
  await expect(first.locator('.sa-history-card__summary')).toContainText('Hose Clips');
  await expect(first.getByText('New Cylinder', { exact: true })).not.toBeVisible();
  await expect(cards.nth(2).locator('.sa-order__top')).toContainText('Cancelled');
  await expect(cards.nth(2).locator('.sa-amount-row')).toContainText('Original sale amount');
  await expect(cards.last().locator('.sa-amount-row')).toHaveText('Order total₹0');
  for (const width of [320, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `page overflow at ${width}`);
    const heights = await cards.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    assert.ok(Math.max(...heights) - Math.min(...heights) < 2, `card heights at ${width}: ${heights}`);
    const summary = first.locator('.sa-history-card__details > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('.bk-detail-item')).toHaveCount(2);
    await expect(first.locator('.bk-detail-item-amount')).toHaveText(['₹624', '₹1,500']);
    await expect(first.getByText('₹36 discount applied', { exact: true })).toBeVisible();
    await expect(first.locator('.pricing-components')).not.toBeVisible();
    const breakdown = first.getByText('Deposit & refill breakdown', { exact: true });
    await breakdown.click();
    await expect(first.locator('.pricing-components')).toBeVisible();
    await expect(first.locator('.sa-history-card__breakdown')).toContainText('Refill discount: −₹36.00');
    await expect(first.locator('.sa-history-card__breakdown')).toContainText('₹1,500');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await breakdown.click();
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('.pricing-components')).not.toBeVisible();
  }
  await first.locator('.sa-history-card__details > summary').click();
  await page.screenshot({ path: '/private/tmp/gasbook-staff-history-layout.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: mixed and legacy bookings, Direct Sales, cancellation, saved totals/IST timestamps, collapsed pricing, keyboard expand/collapse, equal card heights and no overflow at seven widths. APIs mocked.');
} finally { await browser.close(); }
