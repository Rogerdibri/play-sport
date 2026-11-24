const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { trialPlans, statisticsExampleObservation, fieldPositionLabels, exampleStatisticsGames, readScorekeeperAccess } = require('@playsport/shared');
const { default: Plans } = require('../app/account/access/scorekeeper-plan-levels');
test('Anotador catalog specifies 1/3/unlimited tournaments, baseball/softball innings, per-match extras and no global profile access', () => {
  const html = renderToStaticMarkup(React.createElement(Plans, { currentLevel: 3 }));
  assert.equal((html.match(/<article /g) ?? []).length, 3);
  for (const text of ['Un torneo', 'Hasta tres torneos', 'Torneos ilimitados', '9 innings', '7 en softbol', 'solo del torneo seleccionado',
    'Ningún nivel abre perfiles ajenos', 'Sin precios ni cobros habilitados', 'aria-current="true"']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /\$|USD|acumulados globales del jugador habilitados/);
});
test('Anotador basic never shows averages or detailed columns even with a Player or Manager membership; level two restores game details', t => {
  const { default: Scorecard } = require('../app/demo/[slug]/private-scorecard-view');
  const platform = require('../app/platform-session');
  for (const sport of ['baseball', 'softball']) {
    const state = statisticsExampleObservation(sport === 'baseball' ? 'example-stats-baseball-1' : 'example-stats-softball-live');
    const props = { apiBase: '/api/official-scoring', tournamentId: 'tour', gameId: 'game', managerId: 'person:scorer',
      homeId: 'home', awayId: 'away', ownSide: 'away', homeName: state.seed.names.home, awayName: state.seed.names.away,
      initialLineup: state.seed.lineups.away, observation: state, positionLabels: fieldPositionLabels, onBack() {} };
    for (const [planId, detailed] of [['player', false], ['manager', false], ['scorekeeper-numbers', true], ['scorekeeper', true]]) {
      t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, account: { id: 'owner',
        features: trialPlans.find(plan => plan.id === planId).features }, session: { role: 'scorekeeper' } }));
      const html = renderToStaticMarkup(React.createElement(Scorecard, props));
      assert.equal(html.includes('Promedio de bateo'), detailed);
      assert.equal(html.includes('class="privateBattingAverage"'), detailed);
      assert.equal(html.includes('Carreras limpias y sucias · CL'), detailed);
      if (!detailed) assert.doesNotMatch(html, /aria-label="Carreras permitidas por lanzador"/);
      assert.match(html, /Entrada 1/);
      if (sport === 'baseball') assert.match(html, />9<\/th>/);
      else assert.doesNotMatch(html, />9<\/th>/);
    }
  }
});
test('scorekeeper scoped report reader rejects cross-account, cross-tournament and cross-game mixtures and per-game totals', () => {
  const { readScorekeeperStatistics } = require('@playsport/shared');
  const game = exampleStatisticsGames('player')[0];
  const snapshot = { accountId: 'owner', tournamentId: game.tournamentId, gameId: game.gameId, games: [game],
    players: [{ id: `player-${'a'.repeat(64)}`, name: 'Jugador', activeTournament: true, game }], totals: [] };
  assert.equal(readScorekeeperStatistics(snapshot, 'owner', game.tournamentId, game.gameId).players.length, 1);
  assert.throws(() => readScorekeeperStatistics(snapshot, 'foreign', game.tournamentId, game.gameId));
  assert.throws(() => readScorekeeperStatistics({ ...snapshot, games: [{ ...game, tournamentId: 'foreign' }] }, 'owner', game.tournamentId, game.gameId));
  assert.throws(() => readScorekeeperStatistics({ ...snapshot, players: [{ ...snapshot.players[0], game: { ...game, gameId: 'foreign' } }] }, 'owner', game.tournamentId, game.gameId));
  assert.throws(() => readScorekeeperStatistics({ ...snapshot, totals: [{ id: snapshot.players[0].id, name: 'Jugador', group: 'grupo', line: game.line }] }, 'owner', game.tournamentId, game.gameId));
});
test('scorekeeper statistics surface gates basic, offers no accumulation in level two, and only explicit single-tournament totals in level three', t => {
  const { default: View } = require('../app/sports-sheet/scorekeeper/scorekeeper-statistics-view');
  for (const level of [1, 2, 3]) {
    const access = readScorekeeperAccess({ accountId: 'owner', level, limit: level === 1 ? 1 : level === 2 ? 3 : null,
      revision: 0, selectionRequired: false, tournaments: [{ tournamentId: 'own', tournamentName: 'Copa propia', active: true, enabled: true }], extras: [] }, 'owner');
    const html = renderToStaticMarkup(React.createElement(View, { account: { id: 'owner' }, example: { access, games: [], statistics: [] } }));
    assert.ok(html.includes('Nunca perfiles ajenos'));
    assert.equal(html.includes('Acumulados individuales únicamente de este torneo'), level === 3);
    assert.equal(html.includes('Selecciona un torneo'), level >= 2);
    assert.equal(html.includes('El box score completo requiere nivel 2 o 3'), level === 1);
    const changedAccount = renderToStaticMarkup(React.createElement(View, { account: { id: 'another-owner' }, example: { access, games: [], statistics: [] } }));
    assert.doesNotMatch(changedAccount, /Copa propia|Selecciona un torneo/);
  }
});
test('Anotador scoped statistics proxy rejects global identity and duplicate tournament queries before forwarding the cookie', async t => {
  const proxy = require('../app/api/sports-sheet/[...path]/route');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([String(url), options]); return Response.json({ ok: true }); });
  const request = query => new NextRequest(`http://localhost:3000/api/sports-sheet/scorekeeper-statistics?${query}`, { headers: { cookie: 'playsport-account=own' } });
  for (const query of ['tournamentId=own&playerId=foreign', 'tournamentId=own&accountId=foreign', 'tournamentId=own&tournamentId=other'])
    assert.equal((await proxy.GET(request(query), { params: { path: ['scorekeeper-statistics'] } })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await proxy.GET(request('tournamentId=own&gameId=one'), { params: { path: ['scorekeeper-statistics'] } })).status, 200);
  assert.equal(calls[0][1].headers.get('cookie'), 'playsport-account=own');
  assert.match(calls[0][0], /scorekeeper-statistics\?tournamentId=own&gameId=one$/);
});
test('administrative extra proxy admits only its own route without query impersonation', async t => {
  const proxy = require('../app/api/accounts/[action]/route');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls++; assert.equal(options.headers.get('cookie'), 'playsport-account=admin'); return Response.json({ requests: [] }); });
  const request = query => new NextRequest(`http://localhost:3000/api/accounts/scorekeeper-extras${query}`, { headers: { cookie: 'playsport-account=admin' } });
  assert.equal((await proxy.GET(request('?accountId=foreign'), { params: { action: 'scorekeeper-extras' } })).status, 400);
  assert.equal(calls, 0);
  assert.equal((await proxy.GET(request(''), { params: { action: 'scorekeeper-extras' } })).status, 200);
});
