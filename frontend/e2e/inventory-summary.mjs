// Local Vite browser regression; every API request is mocked, including stock/edit writes.
// PLAYWRIGHT_MODULE=<path-to-playwright/index.mjs> node e2e/inventory-summary.mjs
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => { localStorage.setItem('gasbook_access', 'browser-test-token'); localStorage.setItem('gasbook_role', 'admin'); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const products = [
    { stock: 10, reserved: 8, low_stock_threshold: 2, is_active: true },
    { stock: 0, reserved: 0, low_stock_threshold: 5, is_active: true },
    { stock: 4, reserved: 4, low_stock_threshold: 5, is_active: true },
    { stock: 20, reserved: 0, low_stock_threshold: 3, is_active: true },
    { stock: 0, reserved: 0, low_stock_threshold: 5, is_active: false },
    { stock: 3, reserved: 1, low_stock_threshold: 0, is_active: true },
  ].map((p, index) => ({ ...p, id: index + 1, name: `Accessory ${index + 1}`, category: 'Accessory', description: 'Test item', selling_price: '250.00', image: null }));
  let release;
  const loadingGate = new Promise(resolve => { release = resolve; });
  let failList = false, failStock = false;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/me/')) return route.fulfill({ json: { role: 'admin', name: 'Test Admin' } });
    if (url.pathname.endsWith('/products/')) {
      await loadingGate;
      if (failList) return route.fulfill({ status: 500, json: { detail: 'Inventory temporarily unavailable.' } });
      const number = Number(url.searchParams.get('page') || '1');
      return route.fulfill({ json: { count: products.length, next: number === 1 ? `${url.origin}/api/products/?page=2` : null, results: products.slice((number - 1) * 3, number * 3) } });
    }
    if (url.pathname.endsWith('/stock/')) {
      if (failStock) return route.fulfill({ status: 400, json: { detail: 'Stock update failed.' } });
      const product = products.find(p => p.id === Number(url.pathname.split('/').at(-3)));
      const body = request.postDataJSON();
      product.stock = body.quantity ?? product.stock + body.delta;
      return route.fulfill({ json: product });
    }
    if (request.method() === 'PATCH') {
      const product = products.find(p => p.id === Number(url.pathname.split('/').at(-2)));
      product.is_active = false;
      return route.fulfill({ json: product });
    }
    return route.fulfill({ json: { count: 0, next: null, results: [] } });
  });
  await page.goto(`${process.env.APP_URL || 'http://localhost:5173'}/products`);
  await expect(page.getByRole('status', { name: 'Loading inventory summary' })).toBeVisible();
  await expect(page.locator('.inventory-summary .ui-stat__value')).toHaveCount(0);
  release();
  const summary = page.getByRole('region', { name: 'Inventory summary' });
  const values = summary.locator('.ui-stat__value');
  await expect(values).toHaveText(['6', '37', '1', '2']);
  await expect(summary).toContainText('5 active · 1 inactive');
  await expect(summary).toContainText('13 reserved');
  const rows = page.locator('.inventory-table tbody tr');
  await expect(rows).toHaveCount(6);
  await summary.getByRole('button', { name: 'Filter unavailable products' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Out of stock');
  await expect(rows.last()).toContainText('Fully reserved');
  await expect(values).toHaveText(['6', '37', '1', '2']);
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await summary.getByRole('button', { name: 'Filter low-stock products' }).focus();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Accessory 1');
  failStock = true;
  await page.getByRole('button', { name: 'Increase Accessory 1 stock', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Stock update failed');
  await expect(values).toHaveText(['6', '37', '1', '2']);
  failStock = false;
  await page.getByRole('button', { name: 'Increase Accessory 1 stock', exact: true }).click();
  await expect(values).toHaveText(['6', '38', '0', '2']);
  await expect(page.getByText('No active products have low stock.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await page.getByRole('button', { name: 'Decrease Accessory 1 stock', exact: true }).click();
  await expect(values).toHaveText(['6', '37', '1', '2']);
  await rows.first().getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('checkbox', { name: /Active/ }).uncheck();
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(values).toHaveText(['6', '37', '0', '2']);
  await expect(summary).toContainText('4 active · 2 inactive');
  for (const width of [320, 375, 390, 414, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const columns = await summary.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns, width < 540 ? 1 : width < 1200 ? 2 : 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const cards = summary.locator('.ui-stat');
    assert.equal(await cards.evaluateAll(cards => cards.some(c => c.scrollWidth > c.clientWidth)), false);
  }
  failList = true;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Inventory temporarily unavailable');
  await expect(values).toHaveText(['—', '—', '—', '—']);
  await expect(summary.getByRole('button', { name: 'Filter low-stock products' })).toBeDisabled();
  failList = false;
  await page.getByRole('button', { name: 'Reload products' }).click();
  await expect(values).toHaveText(['6', '37', '0', '2']);
  assert.deepEqual(errors, []);
  console.log('PASS: paginated totals, loading/error states, reserved/inactive/custom thresholds, filters/clear/keyboard, stock success/failure, edit refresh, and responsive 1/2/4 columns at eight widths. All API traffic mocked.');
} finally { await browser.close(); }
