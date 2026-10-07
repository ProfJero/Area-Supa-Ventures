import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GCLOUD_PROJECT ||= 'demo-test';
const { ghanaPhone, amountGhs, isoDate, toPesewas, fromPesewas } = await import('../src/common.js');
const { nameKeywords, formatAccountNumber, ACCOUNT_START } = await import('../src/customers.js');

test('Ghana phone numbers normalise to 0XXXXXXXXX', () => {
  for (const v of ['0241234567', '241234567', '233241234567', '+233 24 123 4567', '024-123-4567']) {
    assert.equal(ghanaPhone(v, { label: 'P' }), '0241234567');
  }
  assert.equal(ghanaPhone('', { label: 'P' }), '');
  assert.throws(() => ghanaPhone('12345', { label: 'P' }));
  assert.throws(() => ghanaPhone('0941234567', { label: 'P' }));
});

test('amounts', () => {
  assert.equal(amountGhs('50.10'), 50.1);
  for (const bad of [0, -1, 1.234, 'abc', Infinity, 2e6]) assert.throws(() => amountGhs(bad));
  assert.equal(fromPesewas(toPesewas(0.1) + toPesewas(0.2)), 0.3);
});

test('dates', () => {
  assert.equal(isoDate('2024-02-29', { label: 'D' }), '2024-02-29');
  assert.throws(() => isoDate('2023-02-29', { label: 'D' }));
  assert.throws(() => isoDate('2999-01-01', { label: 'D', notFuture: true }));
});

test('customer IDs start at ASV-10001', () => {
  assert.equal(formatAccountNumber(ACCOUNT_START + 1), 'ASV-10001');
  assert.ok(nameKeywords('Ama Boateng').includes('boa'));
});
