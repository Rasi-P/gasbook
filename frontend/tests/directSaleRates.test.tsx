import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DirectSaleRates } from '../src/components/DirectSaleRates';

const props = { rate: '360.50', deposit: '450.25', onRateChange: () => {}, onDepositChange: () => {} };

it('refill keeps one editable Rate field without a deposit', () => {
  const html = renderToStaticMarkup(<DirectSaleRates {...props} rateType="refill" />);
  expect(html).toContain('Rate (Rs.)');
  expect(html).toContain('value="360.50"');
  expect(html).not.toContain('Deposit');
  expect(html.match(/<input /g)).toHaveLength(1);
  expect(html).not.toMatch(/readonly|disabled/i);
});

it('new cylinder adds exactly one editable deposit field alongside Rate', () => {
  const html = renderToStaticMarkup(<DirectSaleRates {...props} rateType="new" />);
  expect(html).toContain('Rate (Rs.)');
  expect(html).toContain('Deposit (Rs.)');
  expect(html).toContain('value="450.25"');
  expect(html.match(/<input /g)).toHaveLength(2);
  expect(html.match(/step="0.01"/g)).toHaveLength(2);
  expect(html).not.toMatch(/readonly|disabled/i);
});

it('preserves explicitly entered zero rates', () => {
  const html = renderToStaticMarkup(<DirectSaleRates {...props} rateType="new" rate="0" deposit="0" />);
  expect(html.match(/value="0"/g)).toHaveLength(2);
});
