import { api } from '../src/lib/api';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { MediaImage } from '../src/components/MediaImage';
import { privateMediaUrl } from '../src/lib/mediaUrl';
import { ImageUpload } from '../src/components/ImageUpload';
test('private image URLs accept only the backend origin without credentials or queries', () => {
  expect(privateMediaUrl('https://api.invalid/media/staff-images/photo.bin', 'https://api.invalid/api')).toBe('https://api.invalid/media/staff-images/photo.bin');
  for (const value of ['https://other.invalid/media/staff-images/photo.bin', 'https://api.invalid/media/staff-images/photo.bin?token=x', 'https://user:pass@api.invalid/media/staff-images/photo.bin']) expect(() => privateMediaUrl(value, 'https://api.invalid/api')).toThrow();
});
test('media placeholders and capability loading never expose unauthenticated private image sources', () => {
  const image = renderToStaticMarkup(<MediaImage src={new URL("/media/staff-images/photo.png", api.defaults.baseURL).href} alt="Staff" />);
  expect(image).toContain('Loading image'); expect(image).not.toContain('<img');
  const input = renderToStaticMarkup(<ImageUpload />); expect(input).toContain('disabled'); expect(input).toContain('Checking image availability');
});
test('customer booking details link uses the existing refreshable booking route', () => {
  const source = readFileSync(new URL('../src/pages/Customers.tsx', import.meta.url), 'utf8');
  expect(source).toContain('navigate(`/bookings?booking=${booking.id}`)');
  expect(source).not.toContain('not implemented in existing codebase');
});
