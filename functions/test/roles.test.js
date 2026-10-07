import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROLES, hasPermission, canManageRole, assignableRoles } from '../src/roles.js';
import { renderTemplate, unknownFields, smsPages } from '../src/sms-template.js';

const web = (f) => new URL(`../../Area Supa Ventres/js/lib/${f}`, import.meta.url);

test('browser copies of shared modules match the server copies', () => {
  for (const f of ['roles.js', 'sms-template.js']) {
    assert.equal(fs.readFileSync(web(f), 'utf8'), fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), f);
  }
});

test('firestore.rules read permissions mirror roles.js', () => {
  const rules = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const readPerms = ['customers.view', 'transactions.view', 'reports.view', 'sms.send', 'sms.billing', 'staff.manage', 'settings.manage', 'audit.view'];
  for (const role of Object.keys(ROLES)) {
    const line = rules.match(new RegExp(`'${role}':\\s*\\[([^\\]]*)\\]`))[1];
    const inRules = [...line.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]).sort();
    const expected = readPerms.filter((p) => hasPermission(role, p)).sort();
    assert.deepEqual(inRules, expected, role);
  }
});

test('role hierarchy', () => {
  assert.ok(canManageRole('owner', 'admin'));
  assert.ok(!canManageRole('admin', 'admin'));
  assert.ok(!canManageRole('admin', 'owner'));
  assert.ok(!canManageRole('manager', 'collector'));
  assert.deepEqual(assignableRoles('admin'), ['manager', 'collector', 'viewer']);
  assert.ok(!hasPermission('collector', 'customers.delete'));
  assert.ok(hasPermission('admin', 'customers.delete'));
});

test('templates', () => {
  assert.equal(renderTemplate('Hi {first_name|friend}, {customer_id}', { customer_id: 'ASV-10001' }), 'Hi friend, ASV-10001');
  assert.deepEqual(unknownFields('{first_name} {amount}'), ['amount']);
  assert.deepEqual(unknownFields('{first_name} {amount}', { allowTransaction: true }), []);
  assert.equal(smsPages('a'.repeat(160)).pages, 1);
  assert.equal(smsPages('a'.repeat(161)).pages, 2);
  assert.equal(smsPages('GH₵ 5').unicode, true);
});
