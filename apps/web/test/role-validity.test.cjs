const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { addMembershipMonths, readRoleValidity, readOwnAccountAccess, readTrialChange } = require('@playsport/shared');
const { default: Panel } = require('../app/account/access/role-validity-panel');
const now = '2026-11-23T12:00:00.000Z';
const roles = [
  { role: 'player', status: 'permanent', activatedAt: null, freeExpiresAt: null, expiresAt: null, now },
  { role: 'manager', status: 'not_activated', activatedAt: null, freeExpiresAt: null, expiresAt: null, now },
  { role: 'scorekeeper', status: 'active', activatedAt: '2026-05-26T12:00:00.000Z',
    freeExpiresAt: addMembershipMonths('2026-05-26T12:00:00.000Z', 6), expiresAt: '2026-11-26T12:00:00.000Z', now }
];
test('validity example explains permanent player and explicit single activation without charging or transferring premium features', () => {
  const snapshot = { accountId: 'owner', now, features: [], trials: [], roles };
  const html = renderToStaticMarkup(React.createElement(Panel, { snapshot, verified: false, example: true }));
  for (const text of ['Básico gratuito permanente', 'Pendiente de activación', 'Seis meses gratuitos vigentes', 'próximos 30 días',
    'Activar Manager', 'disabled=""', 'mensual, trimestral, semestral, anual', 'sin obligación de subir', 'una sola vez por cuenta',
    'renovaciones automáticas todavía deshabilitados']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /V-\d{7,}|birthDate|type="password"/);
});
test('role readers reject forged perpetual operation, inconsistent dates, wrong scopes and duplicated roles', () => {
  assert.equal(readRoleValidity(roles[2], 'scorekeeper').status, 'active');
  for (const invalid of [{ ...roles[2], status: 'permanent' }, { ...roles[2], freeExpiresAt: '2028-11-26T12:00:00.000Z' },
    { ...roles[2], status: 'expired' }, { ...roles[0], expiresAt: now }]) assert.throws(() => readRoleValidity(invalid));
  assert.throws(() => readRoleValidity(roles[2], 'manager'));
  const snapshot = { accountId: 'owner', now, features: [], trials: [], roles };
  assert.equal(readOwnAccountAccess(snapshot, 'owner').roles.length, 3);
  assert.throws(() => readOwnAccountAccess({ ...snapshot, roles: [roles[0], roles[1], roles[1]] }, 'owner'));
  assert.throws(() => readOwnAccountAccess(snapshot, 'other'));
});
test('trial duration commands accept only explicit calendar periods and never combine price, role or custom expiry', () => {
  const base = { expectedAdminId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222',
    requestId: '33333333-3333-4333-8333-333333333333', expectedRevision: 0, planId: 'scorekeeper-basic', action: 'grant', reason: 'Prueba de vigencia' };
  for (const months of [1,3,6,12]) assert.equal(readTrialChange({ ...base, months }).months, months);
  for (const patch of [{ months: 2 }, { months: '6' }, { months: 6, price: 0 }, { months: 6, expiresAt: now }, { months: 6, role: 'manager' }])
    assert.throws(() => readTrialChange({ ...base, ...patch }));
});
test('activation proxy forwards only own-session POST without query; GET and forged scope fail before contacting API', async t => {
  const proxy = require('../app/api/accounts/[action]/route'), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([String(url),options]); return Response.json({ accountId: 'owner', now, features: [], trials: [], roles }); });
  const context = { params: Promise.resolve({ action: 'activate-role' }) };
  const request = (method, query = '') => new NextRequest('http://localhost:3000/api/accounts/activate-role' + query,
    { method, headers: { cookie: 'playsport-account=owner', origin: 'http://localhost:3000', 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ expectedAccountId: 'owner', role: 'manager' }) } : {}) });
  assert.equal((await proxy.GET(request('GET'), context)).status, 404);
  assert.equal((await proxy.POST(request('POST','?accountId=other'), context)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await proxy.POST(request('POST'), context)).status, 200);
  assert.match(calls[0][0], /\/accounts\/activate-role$/);
  assert.equal(calls[0][1].headers.get('cookie'), 'playsport-account=owner');
});
