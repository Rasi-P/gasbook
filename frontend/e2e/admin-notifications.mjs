// Run against local Vite: PLAYWRIGHT_MODULE=<path-to-playwright/index.mjs> node e2e/admin-notifications.mjs
// All API requests are intercepted. No credentials or database writes are needed.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem('gasbook_access', 'browser-test-token'); localStorage.setItem('gasbook_role', 'admin'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let rows = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, title: `Alert ${index + 1}`, body: 'A booking needs your attention.', booking: index === 0 ? 47 : null, created_at: '2026-10-16T07:07:00Z', is_read: index > 1 }));
  let failList = false, failRead = false, readCalls = 0;
  const booking = { id: 47, customer_name: 'Test Customer', cylinder_type_name: '5kg', quantity: 1, rate: '360', final_amount: '360', status: 'pending', created_at: '2026-10-16T07:07:00Z' };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me/')) return route.fulfill({ json: { role: 'admin', name: 'Test Admin' } });
    if (url.pathname.endsWith('/mark_read/')) {
      readCalls++;
      if (failRead) return route.fulfill({ status: 500, json: { detail: 'Read update failed.' } });
      const row = rows.find(item => item.id === Number(url.pathname.split('/').at(-3)));
      row.is_read = true;
      return route.fulfill({ json: row });
    }
    if (url.pathname.endsWith('/notifications/')) {
      if (failList) return route.fulfill({ status: 500, json: { detail: 'Notification service unavailable.' } });
      return route.fulfill({ json: { count: rows.length, next: null, results: rows } });
    }
    if (url.pathname.endsWith('/bookings/')) return route.fulfill({ json: { count: 1, next: null, results: [booking] } });
    return route.fulfill({ json: { count: 0, next: null, results: [] } });
  });
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/bookings`);
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread');
  await bell.click();
  const dialog = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('article')).toHaveCount(10);
  await expect(dialog.locator('time').first()).toContainText('12:37 pm IST');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.locator('article')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Unread', exact: true }).click();
  await expect(dialog.locator('article')).toHaveCount(2);
  failRead = true;
  await dialog.getByRole('button', { name: 'Mark as read', exact: true }).last().click();
  await expect(dialog.getByRole('alert')).toContainText('Read update failed');
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 2 unread');
  failRead = false;
  await dialog.getByRole('button', { name: 'Mark as read', exact: true }).last().click();
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  await expect(dialog.locator('article')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'View booking', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Booking #47', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(bell).toHaveAttribute('aria-label', 'Notifications');
  assert.equal(readCalls, 3);
  await page.reload();
  await bell.click();
  await expect(dialog.getByText('0 unread notifications', { exact: true })).toBeVisible();
  failList = true;
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Notification service unavailable');
  failList = false;
  rows = [];
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByText('No notifications yet.')).toBeVisible();
  rows = [{ id: 99, title: 'New alert', body: 'A new booking has arrived.', booking: null, is_read: false, created_at: '2026-10-16T07:07:00Z' }];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  for (const width of [320, 375, 390, 414, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Mark as read', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(bell).toBeFocused();
  assert.deepEqual(errors, []);
  console.log('PASS: unread count, pagination, filters, mark-read failure/retry, booking link, persisted read state, list error/retry, empty state, focus refresh, keyboard focus, Escape, and eight responsive widths. All API traffic mocked.');
} finally { await browser.close(); }
