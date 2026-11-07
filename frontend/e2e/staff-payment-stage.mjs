// Exercise the UI lifecycle with mocked APIs only; no business data is modified.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    let status = 'accepted';
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const token = `test.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64')}.test`;
    await page.addInitScript(token => {
      localStorage.setItem('gasbook_access', token);
      localStorage.setItem('gasbook_role', 'staff');
    }, token);
    const list = results => ({ count: results.length, results, next: null, previous: null });
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === 'POST') {
        requests.push({ path, body: request.postDataJSON() });
        if (path.endsWith('/deliveries/4/start/')) status = 'out_for_delivery';
        else { assert.ok(path.endsWith('/deliveries/4/complete/')); status = 'delivered'; }
        return route.fulfill({ json: {} });
      }
      assert.equal(request.method(), 'GET');
      if (path.endsWith('/auth/me/')) return route.fulfill({ json: { id: 7, role: 'staff', name: 'Test Staff' } });
      if (path.endsWith('/staff-sales/collections-today/')) return route.fulfill({ json: { total: '0', methods: { cash: '0', gpay: '0', bank: '0' }, refunds: '0' } });
      if (path.endsWith('/deliveries/')) return route.fulfill({ json: list([{
        id: 4, booking: 49, status, customer_name: 'Test Customer', customer_address: 'Test address',
        cylinder_type_name: '12kg', quantity: 1, rate: '820', final_amount: '820', payment_method: 'COD',
        booked_at: '2026-10-17T10:06:00Z', payment_summary: { status: 'PENDING', paid_amount: '0', balance_due: '820', payments: [] },
      }]) });
      return route.fulfill({ json: list([]) });
    });
    await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/staff-dashboard`);
    const start = page.getByRole('button', { name: 'Start Delivery & Notify Customer' });
    await expect(start).toBeEnabled();
    await expect(page.getByText('Amount to collect on delivery', { exact: true })).toBeVisible();
    await expect(page.getByText('Record the payment actually received')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Cash', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Staff navigation' }).getByRole('button', { name: 'Deliveries' }).click();
    await expect(start).toBeEnabled();
    await expect(page.getByRole('radio', { name: 'Cash', exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Staff navigation' }).getByRole('button', { name: 'Home' }).click();
    await start.click();
    await expect(page.getByRole('radio', { name: 'Cash', exact: true })).toBeVisible();
    const complete = page.getByRole('button', { name: 'Complete Delivery', exact: true });
    await expect(complete).toBeDisabled();
    await page.getByLabel('Cash received (Rs.)').fill('820');
    await page.getByRole('checkbox', { name: /I confirm the amount actually received/ }).check();
    await expect(complete).toBeEnabled();
    await complete.click();
    await expect(complete).toHaveCount(0);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body, null);
    assert.deepEqual(requests[1].body.split_payments, [{ mode: 'cash', amount: '820.00' }]);
    assert.equal(requests[1].body.payment_collected, '820.00');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS payment stages: no collection form before dispatch on Home/Deliveries; start sends no payments; actual collection and confirmation remain required for COD completion. Mobile/desktop; APIs mocked.');
} finally { await browser.close(); }
