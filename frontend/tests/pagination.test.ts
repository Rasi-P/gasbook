import { describe, expect, test } from 'bun:test';
import { collectPages } from '../src/lib/pagination';
const endpoint = new URL('https://api.invalid/api/products/');
const row = (id: number) => ({ id });
const next = 'https://api.invalid/api/products/?page=2';
describe('complete accessory catalog', () => {
  for (const total of [0, 3, 10, 11, 25]) test(`loads ${total} items without unnecessary requests`, async () => {
    let calls = 0;
    const rows = await collectPages(endpoint, async query => {
      calls++; const page = Number(new URLSearchParams(query).get('page'));
      return { count: total, results: Array.from({ length: Math.max(0, Math.min(10, total - (page - 1) * 10)) }, (_, i) => row((page - 1) * 10 + i + 1)), next: page * 10 < total ? `https://api.invalid/api/products/?page=${page + 1}` : null };
    });
    expect(rows.length).toBe(total); expect(calls).toBe(Math.max(1, Math.ceil(total / 10)));
  });
  test('preserves inactive rows and only returns after all pages succeed', async () => {
    const rows = await collectPages(endpoint, async query => query.includes('page=1') ? { count: 2, results: [{ id: 1, is_active: false }], next } : { count: 2, results: [{ id: 2, is_active: true }], next: null });
    expect(rows.length).toBe(2);
    await expect(collectPages(endpoint, async query => { if (query.includes('page=2')) throw Error('later page failed'); return { count: 2, results: [row(1)], next }; })).rejects.toThrow('later page failed');
  });
  for (const bad of [
    { count: 2, results: [row(1)], next: 'https://attacker.invalid/api/products/?page=2' },
    { count: 2, results: [row(1)], next: '?page=1' },
    { count: 2, results: [row(1)], next: '?page=3' },
    { count: 2, results: [row(1)], next: '?page=2&page=2' },
    { count: 2, results: [row(1)], next: '/api/other/?page=2' },
    { count: 2, results: [row(1), row(1)], next: null },
    { count: 2, results: [], next },
    { count: 2, results: [row(1)], next: null },
    { count: '2', results: [row(1)], next },
  ]) test('rejects malformed or unsafe pagination', async () => {
    let calls = 0;
    await expect(collectPages(endpoint, async () => { calls++; return bad; })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test('rejects duplicate, empty or inconsistent later pages and exhausted bounds', async () => {
    for (const final of [{ count: 2, results: [row(1)], next: null }, { count: 2, results: [], next: null }, { count: 3, results: [row(2)], next: null }]) {
      await expect(collectPages(endpoint, async query => query.includes('page=1') ? { count: 2, results: [row(1)], next } : final)).rejects.toThrow();
    }
    await expect(collectPages(endpoint, async () => ({ count: 2, results: [row(1)], next }), 1)).rejects.toThrow();
  });
});
