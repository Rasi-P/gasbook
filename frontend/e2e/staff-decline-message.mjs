// All API calls are mocked; no deliveries or customer records are modified.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [], submitted = [];
let fail = true, releaseRequest;
const token = `test.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64')}.test`;
await page.addInitScript(token => {
  localStorage.setItem('gasbook_access', token);
  localStorage.setItem('gasbook_role', 'staff');
}, token);
page.on('pageerror', error => errors.push(error.message));
const list = results => ({ count: results.length, results, next: null, previous: null });
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() === 'POST') {
    assert.ok(path.endsWith('/deliveries/4/reject/'));
    submitted.push(request.postDataJSON());
    if (fail) return route.fulfill({ status: 400, json: { detail: 'Please try again.' } });
    await new Promise(resolve => { releaseRequest = resolve; });
    return route.fulfill({ json: {} });
  }
  assert.equal(request.method(), 'GET');
  if (path.endsWith('/staff-sales/collections-today/')) return route.fulfill({ json: { date: '2026-10-17', total: '0', methods: { cash: '0', gpay: '0', bank: '0' }, refunds: '0' } });
  if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 7, role: 'staff', name: 'Test Staff' } });
  if (path.endsWith('/deliveries/')) return route.fulfill({ json: list([{
    id: 4, booking: 49, status: 'assigned', customer_name: 'Test Customer', customer_address: 'Test address',
    cylinder_type_name: '12kg', quantity: 1, rate: '820', final_amount: '820', booked_at: '2026-10-17T10:06:00Z',
  }]) });
  return route.fulfill({ json: list([]) });
});
try {
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff-dashboard`);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Decline reason' });
  await selector.selectOption('other');
  const custom = page.getByRole('textbox', { name: 'Custom reason' });
  const confirm = page.getByRole('button', { name: 'Confirm Reject', exact: true });
  await expect(confirm).toBeDisabled();
  await custom.fill('   ');
  await expect(confirm).toBeDisabled();
  await expect(custom).toHaveAttribute('maxlength', '200');
  await custom.fill('  Road is blocked.\nPlease assign someone via the other route.  ');
  for (const width of [320, 375, 390, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await custom.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
    await expect(confirm).toBeEnabled();
  }
  await confirm.click();
  await expect(confirm).toBeEnabled();
  await expect(custom).toHaveValue('  Road is blocked.\nPlease assign someone via the other route.  ');
  assert.deepEqual(submitted, [{ reason: 'Road is blocked.\nPlease assign someone via the other route.' }]);
  fail = false;
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Declining…' })).toBeDisabled();
  assert.equal(submitted.length, 2);
  releaseRequest();
  await expect(custom).toHaveCount(0);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(selector).toHaveValue('Too far');
  await selector.selectOption('other');
  await expect(custom).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(submitted.length, 2);
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await selector.selectOption('Vehicle issue');
  await confirm.click();
  await expect(page.getByRole('button', { name: 'Declining…' })).toBeDisabled();
  assert.deepEqual(submitted.at(-1), { reason: 'Vehicle issue' });
  releaseRequest();
  await expect(selector).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS staff decline: custom/preset payloads, whitespace validation, 200-character limit, error retention, retry, busy protection, cancel/reset and seven responsive widths. APIs mocked.');
} finally { await browser.close(); }
