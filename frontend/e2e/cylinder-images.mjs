// Cylinder pictures in a real browser, against a production build (APP_URL). All API traffic is mocked and writes are
// refused, so no records are created or modified. Custom upload first, else the weight's SABCO default from the
// backend's /static/cylinders/, else the generic cylinder; a missing (404) or broken picture steps down.
import assert from 'node:assert/strict';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '../../../gasbook-customer/node_modules/@playwright/test/index.mjs');
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5193';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const list = results => ({ count: results.length, results, next: null, previous: null });
const type = (id, kg, image = null, name = `${kg}kg`) => ({
  id, name, weight: `${kg}.00`, refill_rate: '100.00', deposit_amount: '0.00', low_stock_threshold: 5, is_active: true, image,
});
const browser = await chromium.launch({ headless: true });

async function open(role, path, fixtures) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const token = `test.${Buffer.from(JSON.stringify({ user_id: 7 })).toString('base64')}.test`;
  await context.addInitScript(([token, role]) => { localStorage.setItem('gasbook_access', token); localStorage.setItem('gasbook_role', role); }, [token, role]);
  const page = await context.newPage(), errors = [], requested = [];
  page.on('pageerror', error => errors.push(error.message));
  const app = new URL(APP_URL).origin;
  await page.route(url => url.origin !== app, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/static/cylinders/') || url.pathname.startsWith('/media/')) {
      requested.push(url.pathname);
      const missing = url.pathname.endsWith('/sabco-14kg.png') || url.pathname.endsWith('/gone.png');
      return route.fulfill(missing ? { status: 404, body: 'Not found' } : { contentType: 'image/png', body: PNG });
    }
    if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: { detail: 'Offline test' } });
    const path = url.pathname.replace(/^.*\/api/, '');
    const body = fixtures(path, url.origin);
    return route.fulfill({ json: body ?? list([]) });
  });
  await page.goto(`${APP_URL}${path}`);
  return { page, errors, requested, close: () => context.close() };
}

/** Every visible cylinder picture has loaded and decoded: nothing broken or blank. */
async function pictures(locator) {
  await expect(locator.first()).toBeVisible();
  await expect.poll(() => locator.evaluateAll(list => list.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  return locator.evaluateAll(list => list.map(img => ({ alt: img.alt, src: img.getAttribute('src'), state: img.dataset.cylinderImage })));
}
const isGeneric = src => src.startsWith('data:image/svg+xml,');

try {
  // Admin: the cylinder types table and the edit form.
  const catalog = origin => [
    ...[2, 3, 4, 5, 12, 14, 19, 21, 33].map((kg, i) => type(i + 1, kg)),
    type(20, 19, `${origin}/media/cylinder-images/ok.png`, 'Commercial custom'),
    type(21, 21, `${origin}/media/cylinder-images/gone.png`, 'Commercial broken'),
    type(22, 35, null, 'Industrial 35'),
  ];
  const admin = await open('admin', '/products?tab=cylinders', (path, origin) => {
    if (path === '/auth/me/') return { id: 7, role: 'admin', username: 'admin', name: 'Admin' };
    if (path === '/cylinder-types/') return list(catalog(origin));
  });
  const thumbs = admin.page.locator('.catalog-table img.catalog-thumb');
  await expect(thumbs).toHaveCount(12);
  const shown = await pictures(thumbs);
  const row = alt => shown.find(img => img.alt === `${alt} cylinder`);
  for (const kg of [2, 3, 4, 5, 12, 19, 21, 33]) {
    assert.match(row(`${kg}kg`).src, new RegExp(`/static/cylinders/sabco-${kg}kg\\.png$`), `${kg} kg default`);
    assert.equal(row(`${kg}kg`).state, 'primary');
  }
  assert.ok(isGeneric(row('14kg').src) && row('14kg').state === 'fallback', '14 kg file missing → generic cylinder');
  assert.match(row('Commercial custom').src, /\/media\/cylinder-images\/ok\.png$/, 'custom picture wins');
  assert.match(row('Commercial broken').src, /\/static\/cylinders\/sabco-21kg\.png$/, 'broken custom → weight default');
  assert.equal(row('Commercial broken').state, 'fallback');
  assert.ok(isGeneric(row('Industrial 35').src) && row('Industrial 35').state === 'primary', 'unsupported weight → generic');
  assert.ok(!admin.requested.some(path => path.includes('35kg')), 'no request for a weight without a default');

  // Weight change in the form: the preview switches to the new weight's default straight away.
  await admin.page.getByRole('button', { name: 'Edit 19kg', exact: true }).click();
  const dialog = admin.page.getByRole('dialog');
  const preview = dialog.locator('img.catalog-thumb');
  assert.match((await pictures(preview))[0].src, /sabco-19kg\.png$/);
  await expect(dialog).toContainText('Showing the standard 19 kg picture.');
  await dialog.getByLabel('Weight (kg)').fill('33');
  await expect(preview).toHaveAttribute('src', /sabco-33kg\.png$/);
  await dialog.getByLabel('Weight (kg)').fill('14');
  await expect.poll(async () => isGeneric((await pictures(preview))[0].src)).toBe(true); // missing file
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Removing a custom picture shows the weight default immediately (before and without saving).
  await admin.page.getByRole('button', { name: 'Edit Commercial custom', exact: true }).click();
  assert.match((await pictures(preview))[0].src, /\/media\/cylinder-images\/ok\.png$/);
  await dialog.getByRole('button', { name: 'Remove picture' }).click();
  await expect(preview).toHaveAttribute('src', /sabco-19kg\.png$/);
  await expect(dialog.getByRole('button', { name: 'Remove picture' })).toHaveCount(0); // a default cannot be removed
  assert.deepEqual(admin.errors, []);
  await admin.close();

  // Staff: the active delivery card shows its cylinder type's picture, not one fixed image.
  const delivery = (id, kg, image = null) => ({
    id, booking: 40 + id, status: 'out_for_delivery', customer_name: 'Test Customer', customer_phone: '9000000001',
    customer_address: 'Test address', cylinder_type_name: `${kg}kg`, cylinder_type_weight: `${kg}.00`, cylinder_type_image: image,
    quantity: 1, rate: '100', final_amount: '100', original_amount: '100', discount_amount: '0', order_items: [],
    payment_summary: { status: 'PENDING', paid_amount: '0', balance_due: '100', payments: [] },
  });
  for (const [kg, image, expected] of [[2, null, /sabco-2kg\.png$/], [33, null, /sabco-33kg\.png$/], [14, null, /^data:image\/svg\+xml,/], [5, 'ORIGIN/media/cylinder-images/ok.png', /\/media\/cylinder-images\/ok\.png$/]]) {
    const staff = await open('staff', '/staff-dashboard', (path, origin) => {
      if (path === '/auth/me/') return { id: 7, role: 'staff', name: 'Test Staff', username: 'staff' };
      if (path === '/deliveries/') return list([delivery(1, kg, image?.replace('ORIGIN', origin) ?? null)]);
      if (path === '/staff-sales/collections-today/') return { date: '2026-10-21', total: '0', methods: { cash: '0', gpay: '0', bank: '0' }, refunds: '0' };
    });
    const [card] = await pictures(staff.page.locator('img.sa-cylinder__img'));
    assert.match(card.src, expected, `staff card for ${kg} kg`);
    assert.deepEqual(staff.errors, []);
    await staff.close();
  }
  console.log('cylinder-images: all checks passed');
} finally {
  await browser.close();
}
