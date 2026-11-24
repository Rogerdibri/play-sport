const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { organizerCapacityExamples, estimateTournamentCapacity, readOrganizerCapacity, readTournament } = require('@playsport/shared');
const { OrganizerCapacityEstimate } = require('../app/demo/[slug]/organizer-capacity-panel');
const Example = require('../app/account/organizer-capacity/example/page').default;
test('capacity example is reusable, readonly, honest about billing and independent of scorer plans', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ ready: true }));
  const html = renderToStaticMarkup(React.createElement(Example));
  assert.match(html, /Solo lectura/); assert.match(html, /2 a 5 equipos/); assert.match(html, /13 partidos/);
  assert.match(html, /Formato a comparar/); assert.match(html, /Estado de la oportunidad/);
  assert.match(html, /Precios y cobros todavía deshabilitados/);
  assert.doesNotMatch(html, /Reservar mi único torneo|Liberar reserva/);
  const additional = renderToStaticMarkup(React.createElement(OrganizerCapacityEstimate, { document: organizerCapacityExamples[1] }));
  assert.match(additional, /27 partidos/); assert.match(additional, /capacidad adicional/);
  assert.match(additional, /no cambia el nivel, los cupos ni el precio del Anotador/);
});
test('manual budgets round-trip strictly and declaration cannot understate series or physical games', () => {
  const doc = structuredClone(organizerCapacityExamples[2]);
  assert.equal(readTournament(doc).phases[0].maxGames, 13);
  for (const maxGames of [0, -1, 1.5, '13']) {
    doc.phases[0].maxGames = maxGames; assert.throws(() => readTournament(doc));
  }
  doc.phases[0].maxGames = null;
  assert.equal(estimateTournamentCapacity(doc).complete, false);
});
test('capacity snapshots reject foreign owners, duplicate games, invalid consumption and unowned reservations', () => {
  const value = { accountId: 'owner', free: { tournamentId: 'cup', consumedAt: null, revision: 1 },
    tournaments: [{ tournamentId: 'cup', legacy: false, played: [] }] };
  assert.equal(readOrganizerCapacity(value, 'owner').free.tournamentId, 'cup');
  assert.throws(() => readOrganizerCapacity(value, 'other'));
  assert.throws(() => readOrganizerCapacity({ ...value, tournaments: [] }, 'owner'));
  assert.throws(() => readOrganizerCapacity({ ...value, free: { ...value.free, tournamentId: null, consumedAt: '2026-11-23T16:00:00.000Z' } }, 'owner'));
  assert.throws(() => readOrganizerCapacity({ ...value, tournaments: [...value.tournaments, ...value.tournaments] }, 'owner'));
});
test('own capacity proxy accepts only intended routes, preserves session and rejects targeting queries', async t => {
  const proxy = require('../app/api/tournaments/[...path]/route'), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url, options]); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); });
  const request = (method, path, search = '') => new NextRequest(`http://localhost:3000/api/tournaments/${path}${search}`,
    { method, headers: { origin: 'http://localhost:3000', cookie: 'playsport-account=owner', 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}) });
  const context = path => ({ params: Promise.resolve({ path: [path] }) });
  assert.equal((await proxy.GET(request('GET','capacity','?accountId=other'), context('capacity'))).status, 400);
  assert.equal((await proxy.POST(request('POST','free-reservation','?accountId=other'), context('free-reservation'))).status, 404);
  assert.equal((await proxy.GET(request('GET','free-reservation'), context('free-reservation'))).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await proxy.GET(request('GET','capacity'), context('capacity'))).status, 200);
  assert.equal((await proxy.POST(request('POST','free-reservation'), context('free-reservation'))).status, 200);
  assert.match(calls[1][0], /\/tournaments\/free-reservation$/);
  assert.equal(calls[1][1].headers.get('cookie'), 'playsport-account=owner');
});
test('example selectors wait for account recovery so a provider remount cannot discard a selected format', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ ready: false }));
  const html = renderToStaticMarkup(React.createElement(Example));
  assert.equal((html.match(/<select[^>]*disabled=""/g) ?? []).length, 2);
  assert.match(html, /<fieldset[^>]*disabled=""/);
});
