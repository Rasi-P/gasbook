// Read-only UI checks with mocked APIs; no development records are changed.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
const token = `test.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64')}.test`;
await context.addInitScript(token => {
  localStorage.setItem('gasbook_access', token);
  localStorage.setItem('gasbook_role', 'staff');
}, token);
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
const list = results => ({ count: results.length, results, next: null, previous: null });
const cylinder = { id: 1, type: 'cylinder', cylinder_type: 2, name: '5kg', quantity: 1, rate: '660', total_amount: '624', rate_type: 'new', deposit_unit_amount: '300', refill_unit_amount: '360' };
const hose = { id: 2, type: 'accessory', name: 'Hose Clips (Assorted Set) with a very long product name', quantity: 25, rate: '60', total_amount: '1500' };
const base = { customer_name: 'Test Customer', customer_phone: '9000000001', customer_address: 'Test delivery address', cylinder_type_name: '5kg', quantity: 1, rate: '450', status: 'delivered', booked_at: '2026-10-16T07:07:00Z', completed_at: '2026-10-16T07:09:00Z', final_amount: '405', original_amount: '450', discount_amount: '45', payment_summary: { status: 'PAID', paid_amount: '405', balance_due: '0', payments: [] } };
const deliveries = [
  { ...base, id: 1, booking: 47, customer_name: 'A very long customer name that should remain accessible in order details', customer_address: 'A very long delivery address with house name, street, landmark and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', order_items: [cylinder, hose], final_amount: '2124', original_amount: '2160', discount_amount: '36' },
  { ...base, id: 2, booking: 45 },
  { ...base, id: 3, booking: 1, quantity: 3, rate_type: 'refill', deposit_unit_amount: '0', refill_unit_amount: '360', final_amount: '1080' },
  { ...base, id: 4, booking: 48, status: 'assigned', completed_at: null, payment_summary: { status: 'PENDING', paid_amount: '0', balance_due: '405', payments: [] } },
];
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  assert.equal(request.method(), 'GET', `Unexpected mutation: ${path}`);
  if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 7, role: 'staff', name: 'Test Staff', username: 'staff' } });
  if (path.endsWith('/deliveries/')) return route.fulfill({ json: list(deliveries) });
  return route.fulfill({ json: list([]) });
});
try {
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff-dashboard?tab=deliveries`);
  const filters = page.getByRole('tablist', { name: 'Delivery filter' });
  await filters.getByRole('tab', { name: /Completed/ }).click();
  const cards = page.locator('.sa-ocard');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('25 × Hose Clips');
  await expect(cards.first()).toContainText('₹2,124');
  await expect(cards.first()).not.toContainText('Deposit:');
  await expect(cards.last()).not.toContainText('Refill Charge:');
  await expect(cards.locator('.booking-item-list, .pricing-components')).toHaveCount(0);
  for (const width of [320, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Page overflow at ${width}`);
    const rects = await cards.evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      const amount = node.querySelector('.sa-amount-row--footer').getBoundingClientRect();
      return { height: r.height, width: r.width, footerInset: r.bottom - amount.top };
    }));
    assert.ok(Math.max(...rects.map(r => r.height)) - Math.min(...rects.map(r => r.height)) < 2, `Uneven completed card heights at ${width}`);
    assert.ok(rects.every(r => r.height < 460), `Oversized summary at ${width}`);
    assert.ok(Math.max(...rects.map(r => r.footerInset)) - Math.min(...rects.map(r => r.footerInset)) < 2, `Uneven footers at ${width}`);
    assert.equal(await filters.getByRole('tab').evaluateAll(nodes => nodes.some(node => node.scrollWidth > node.clientWidth)), false, `Clipped filters at ${width}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await cards.last().boundingBox(), nav = await page.getByRole('navigation', { name: 'Staff navigation' }).boundingBox();
    assert.ok(last.y + last.height <= nav.y, `Last card behind navigation at ${width}`);
    await page.screenshot({ path: `/private/tmp/staff-deliveries-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await cards.first().getByRole('button', { name: /View details/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Order #GB47' });
  await expect(dialog).toContainText(deliveries[0].customer_name);
  await expect(dialog).toContainText(deliveries[0].customer_address);
  await expect(dialog).toContainText(hose.name);
  await expect(dialog).toContainText('Qty 25 × ₹60 each');
  await expect(dialog).toContainText('₹1,500');
  await dialog.getByText('Deposit & refill breakdown', { exact: true }).click();
  await expect(dialog).toContainText('Deposit: ₹300.00 × 1 = ₹300.00');
  await expect(dialog).toContainText('Refill discount: −₹36.00');
  assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
  await page.screenshot({ path: '/private/tmp/staff-delivery-details-375.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  for (const [label, count] of [[/All Pending/, 1], [/Assigned/, 1], [/Active/, 0], [/^All 4$/, 4]]) {
    await filters.getByRole('tab', { name: label }).click();
    await expect(cards).toHaveCount(count);
  }
  await filters.getByRole('tab', { name: /Assigned/ }).click();
  await expect(page.getByRole('button', { name: /Accept/ })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('PASS delivery layout: seven widths, aligned compact cards/footers, filters, mixed and legacy summaries, complete detail pricing/address, preserved assignment action, no navigation overlap. APIs mocked.');
} finally { await browser.close(); }
