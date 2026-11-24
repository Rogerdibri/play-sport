const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { readScorekeeperAccess, readScorekeeperSubstitutions } = require('@playsport/shared');
const { default: Panel } = require('../app/demo/[slug]/scorekeeper-substitutions');
const fixture = { accountId: 'owner', tournamentId: 'cup', gameId: 'a', revision: 1,
  members: [{ actorId: 'person:substitute', name: 'Suplente del Lago', status: 'granted' }],
  audit: [{ revision: 1, actorId: 'person:substitute', organizerId: 'person:organizer', action: 'grant', reason: 'Ausencia temporal', at: '2026-11-23T10:00:00.000Z' }] };
test('organizer substitution example is scoped to one game, free, read-only and never fabricates a real account or posts a grant', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ account: null }));
  const html = renderToStaticMarkup(React.createElement(Panel, { tournamentId: 'cup', gameId: 'a', status: 'scheduled', example: fixture }));
  for (const text of ['Suplencia gratuita de Anotador', 'Cédula del suplente', 'Sin pagos ni consumo de cupos', 'Suplente del Lago',
    'No abre otros partidos', 'Registro de autorizaciones', 'Autoría de anotaciones', 'disabled=""']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /V-993|birthDate|type="password"/);
});
test('substitution readers reject cross-account/game scope, duplicate authorizations and inconsistent or forged audits', () => {
  assert.equal(readScorekeeperSubstitutions(fixture, 'owner', 'cup', 'a').revision, 1);
  for (const args of [['other', 'cup', 'a'], ['owner', 'foreign', 'a'], ['owner', 'cup', 'b']])
    assert.throws(() => readScorekeeperSubstitutions(fixture, ...args));
  for (const overrides of [{ revision: 2 }, { members: [...fixture.members, ...fixture.members] },
    { members: [{ ...fixture.members[0], status: 'revoked' }] }, { audit: [{ ...fixture.audit[0], reason: '' }] },
    { movements: [{ version: 1, actorId: 'person:substitute', role: 'manager', action: 'play', at: fixture.audit[0].at }] }])
    assert.throws(() => readScorekeeperSubstitutions({ ...fixture, ...overrides }, 'owner', 'cup', 'a'));
  const base = { accountId: 'owner', level: 1, limit: 1, revision: 0, selectionRequired: false,
    tournaments: [{ tournamentId: 'own', tournamentName: 'Copa propia', active: true, enabled: true }], extras: [],
    substitutions: [{ tournamentId: 'cup', tournamentName: 'Copa ajena asignada por partido', gameId: 'a' }] };
  const access = readScorekeeperAccess(base, 'owner');
  assert.equal(access.tournaments.length, 1); assert.equal(access.limit, 1); assert.equal(access.extras.length, 0);
  assert.equal(access.substitutions.length, 1);
  assert.throws(() => readScorekeeperAccess({ ...base, substitutions: [...base.substitutions, ...base.substitutions] }, 'owner'));
});
test('statistics offers a substitute-only tournament without enabling its tournament-wide accumulation or changing its own cup', () => {
  const { default: View } = require('../app/sports-sheet/scorekeeper/scorekeeper-statistics-view');
  const access = { accountId: 'owner', level: 3, limit: null, revision: 0, selectionRequired: false, tournaments: [], extras: [],
    substitutions: [{ tournamentId: 'cup', tournamentName: 'Copa de suplencia', gameId: 'a' }] };
  const html = renderToStaticMarkup(React.createElement(View, { account: { id: 'owner' }, example: { access, games: [], statistics: [] } }));
  assert.match(html, /Copa de suplencia.*Solo partido puntual/);
  assert.match(html, /type="checkbox" disabled=""/);
});
test('substitution proxy rejects duplicate scope and identity queries, passes only authenticated GET scopes and forbids POST queries', async t => {
  const proxy = require('../app/api/sports-sheet/[...path]/route');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([String(url), options]); return Response.json(fixture); });
  const context = { params: Promise.resolve({ path: ['scorekeeper-substitutions'] }) };
  const request = (query, method = 'GET') => new NextRequest(`http://localhost:3000/api/sports-sheet/scorekeeper-substitutions${query}`,
    { method, headers: { cookie: 'playsport-account=owner', ...(method === 'POST' ? { origin: 'http://localhost:3000', 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ expectedAccountId: 'owner', tournamentId: 'cup', gameId: 'a', action: 'grant', identification: 'V-99300103' }) } : {}) });
  for (const query of ['?tournamentId=cup&tournamentId=other&gameId=a', '?tournamentId=cup&gameId=a&accountId=foreign'])
    assert.equal((await proxy.GET(request(query), context)).status, 400);
  assert.equal((await proxy.POST(request('?gameId=a', 'POST'), context)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await proxy.GET(request('?tournamentId=cup&gameId=a'), context)).status, 200);
  assert.match(calls[0][0], /scorekeeper-substitutions\?tournamentId=cup&gameId=a$/);
  assert.equal(calls[0][1].headers.get('cookie'), 'playsport-account=owner');
  assert.equal((await proxy.POST(request('', 'POST'), context)).status, 200);
});
