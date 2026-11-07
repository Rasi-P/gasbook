// All API traffic is mocked. No business records are created or modified.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem('gasbook_access', 'test'); localStorage.setItem('gasbook_role', 'admin'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const users = [
    { id: 1, username: 'admin', first_name: 'First', role: 'admin', can_hand_over: true },
    { id: 2, username: 'second', first_name: 'Other Admin', role: 'admin', can_hand_over: true },
    { id: 3, username: 'staff', first_name: 'Staff Member', role: 'staff', can_hand_over: true },
    { id: 4, username: 'gone', first_name: 'Inactive Admin', role: 'admin', can_hand_over: false },
  ].map(u => ({ ...u, user: u.id, last_name: '', phone: '', email: '', address: '', is_active: u.can_hand_over }));
  const sales = Array.from({ length: 12 }, (_, i) => ({ id: 100 - i, customer_name: 'Customer With A Long Name', created_at: '2026-10-15T22:00:00Z', sold_by_full_name: 'First', handover_staff_name: 'Other Admin', total_amount: '900.00', paid_amount: '400.00', balance_due: '500.00', payment_mode: 'cash', items: [{ cylinder_type_name: '5kg', quantity: 1, rate: 900, empty_returned: 1 }], void: i === 1 ? { status: 'refund_pending', outcome: 'refund', paid_amount: '400.00', refund_due: '400.00', cancelled_balance: '500.00', voided_at: '2026-10-16T10:00:00Z', refund: null } : null }));
  let release;
  const gate = new Promise(r => { release = r; });
  let fail = false;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const list = results => ({ count: results.length, results, next: null });
    if (p.endsWith('/auth/me/')) return route.fulfill({ json: { ...users[0], name: 'First' } });
    if (p.endsWith('/auth/users/')) return route.fulfill({ json: users });
    if (p.endsWith('/auth/roles/')) return route.fulfill({ json: [{ code: 'admin', name: 'Admin' }, { code: 'staff', name: 'Staff' }] });
    if (p.endsWith('/sales/handover-options/')) return route.fulfill({ json: list(users) });
    if (p.endsWith('/cylinder-types/')) return route.fulfill({ json: list([{ id: 1, name: '5kg', selling_price: '900', refill_rate: '360', deposit_amount: '300' }]) });
    if (p.endsWith('/stock-locations/')) return route.fulfill({ json: list([{ id: 1, name: 'Shop', code: 'shop' }]) });
    if (p.endsWith('/sales/') && url.searchParams.has('involved_user')) {
      assert.equal(url.searchParams.get('involved_user'), '2');
      assert.equal(url.searchParams.get('source'), 'direct');
      await gate;
      if (fail) return route.fulfill({ status: 500, json: { detail: 'History unavailable.' } });
      const status = url.searchParams.get('void_status');
      let filtered = sales.filter(s => status === 'active' ? !s.void : status ? !!s.void : true);
      if (url.searchParams.get('search')) filtered = filtered.filter(s => String(s.id) === url.searchParams.get('search').replace('#', ''));
      if (url.searchParams.get('start') === '2100-01-01') filtered = [];
      const n = Number(url.searchParams.get('page') || 1);
      return route.fulfill({ json: { ...list(filtered), results: filtered.slice((n - 1) * 10, n * 10), summary: { total: filtered.length, completed: filtered.filter(s => !s.void).length, cancelled: filtered.filter(s => s.void).length, sales_amount: String(filtered.filter(s => !s.void).length * 900) } } });
    }
    return route.fulfill({ json: list([]) });
  });
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/sales`);
  const handover = page.getByLabel(/^Handed over by/);
  await expect(handover.locator('option')).toHaveText(['Not specified', 'First · Admin', 'Other Admin · Admin', 'Staff Member · Staff']);
  await handover.selectOption('2');
  await expect(handover).toHaveValue('2');
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff`);
  await page.locator('.ui-list-row').filter({ hasText: 'Other Admin' }).getByRole('button', { name: 'Sales History', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading sales summary' })).toBeVisible();
  release();
  const summary = page.getByRole('region', { name: 'Sales summary' });
  await expect(summary.locator('.ui-stat__value')).toHaveText(['12', '11', '1', 'Rs. 9,900.00']);
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.locator('tbody tr').first()).toContainText('16 Oct 2026, 03:30 am IST');
  await expect(page.locator('tbody tr').first()).toContainText('Part paid');
  await page.getByText('Items & pricing', { exact: true }).first().click();
  await expect(page.locator('tbody tr').first()).toContainText('1×5kg @ Rs. 900');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('radio', { name: 'Cancelled', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Refund owed Rs. 400');
  await expect(summary.locator('.ui-stat__value')).toHaveText(['1', '0', '1', 'Rs. 0.00']);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByPlaceholder('Sale ID, customer name or phone').fill('#100');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  for (const width of [320, 375, 390, 414, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow at ${width}`);
    if (width < 680) assert.equal(await page.locator('tbody td').first().evaluate(el => getComputedStyle(el).flexDirection), 'column');
    assert.equal(await summary.locator('.ui-stat').evaluateAll(cards => cards.some(c => c.scrollWidth > c.clientWidth)), false);
  }
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Recorded from', { exact: true }).fill('2100-01-01');
  await expect(page.getByText('No direct sales match this admin and these filters.')).toBeVisible();
  await page.getByLabel('Recorded to', { exact: true }).fill('2000-01-01');
  await expect(page.getByRole('alert')).toContainText('end date must be');
  fail = true;
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('alert')).toContainText('History unavailable');
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await page.getByRole('button', { name: 'Back to staff and users' }).click();
  await expect(page.getByRole('button', { name: 'Delivery History', exact: true })).toHaveCount(1);
  assert.deepEqual(errors, []);
  console.log('PASS: admin/staff handover choices, admin profile navigation, loading/error/retry, saved prices/payment/IST, pagination/search/status/date filters, cancellation, staff history link, eight responsive widths. APIs mocked.');
} finally { await browser.close(); }
