const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { exampleStatisticsGames, trialPlans } = require('@playsport/shared');
const { default: AccountStatistics } = require('../app/sports-sheet/statistics/statistics-view');
const { default: ManagerPlanLevels } = require('../app/account/access/manager-plan-levels');
function fixture(t, analysisAllowed) {
  const games = exampleStatisticsGames('team'), individual = exampleStatisticsGames('player');
  const players = individual.map(game => ({ id: `player-${'a'.repeat(64)}`, name: `Jugador de ${game.tournamentName}`,
    activeTournament: game.tournamentId === games[0].tournamentId, game }));
  const data = { accountId: 'owner', mode: 'team', source: 'official', identityVerified: true, analysisAllowed, games, players };
  const states = ['team', 'official', data, { group: '', season: '', league: '', tournament: '', team: '', game: '', from: '', to: '' }, null, false, '', 0, false, false];
  let index = 0, tree;
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(React, 'useState', initial => {
    const key = index++; if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  });
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  function Capture() { tree = AccountStatistics({ account: { id: 'owner', features: trialPlans.find(plan =>
    plan.id === (analysisAllowed ? 'manager' : 'manager-numbers')).features } }); return tree; }
  return { data, states, render() { index = 0; return renderToStaticMarkup(React.createElement(Capture)); }, nodes() { return nodes(tree); } };
}
test('manager catalog has three levels, 1/3/unlimited inscriptions, no individual accumulations and no prices', () => {
  const html = renderToStaticMarkup(React.createElement(ManagerPlanLevels, { currentLevel: 2 }));
  assert.equal((html.match(/<article /g) ?? []).length, 3);
  assert.equal((html.match(/3 inscripciones activas/g) ?? []).length, 1);
  assert.match(html, /1 inscripción activa/); assert.match(html, /aria-current="true"/);
  assert.match(html, /Inscripciones activas ilimitadas/);
  assert.match(html, /cada jugador solo por partido, nunca acumuladas/);
  assert.match(html, /no desbloquea el historial personal global/); assert.doesNotMatch(html, /\$|USD/);
});
test('account access only links to career when that feature or local test access is enabled', t => {
  const { default: Page } = require('../app/account/access/page');
  const platform = require('../app/platform-session');
  t.mock.method(React, 'useEffect', () => {});
  for (const [planId, localTestAccess, allowed] of [['manager-numbers', false, false], ['manager', false, true], ['manager-numbers', true, true]]) {
    const snapshot = { accountId: 'owner', features: trialPlans.find(plan => plan.id === planId).features, trials: [] };
    let index = 0;
    t.mock.method(React, 'useState', () => [[snapshot, '', 0][index++], () => {}]);
    t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, account: { id: 'owner', localTestAccess } }));
    const html = renderToStaticMarkup(React.createElement(Page));
    assert.equal(html.includes('href="/sports-sheet/career"'), allowed);
  }
});
test('personal manager game preparation and roster management require an authenticated selected inscription', t => {
  const { default: Inbox } = require('../app/demo/[slug]/manager-game-inbox');
  const { RosterTeams, RosterEditor } = require('../app/demo/[slug]/manager-roster');
  const platform = require('../app/platform-session'), navigation = require('../app/platform-navigation');
  const accessHook = require('../app/account/manager-teams/use-manager-team-access');
  const context = { managerId: 'person:owner', teamId: 'team', tournamentId: 'tour' };
  t.mock.method(navigation, 'managerWorkContext', () => context);
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(React, 'useMemo', callback => callback());
  t.mock.method(React, 'useState', initial => [initial === null ? [{ ...context, teamName: 'Club', tournamentName: 'Copa' }] : initial, () => {}]);
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  for (const [accountId, managed, allowed] of [[undefined, true, false], ['owner', false, false], ['owner', true, true]]) {
    t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, session: { role: 'manager' }, account: accountId ? { id: accountId } : null }));
    t.mock.method(accessHook, 'useManagerTeamAccess', () => ({ access: { teams: [{ ...context, managed }] }, error: '' }));
    assert.equal(Inbox().props.managementAllowed, allowed);
    const editor = nodes(RosterTeams({ ...context, accountId })).find(node => node.type === RosterEditor);
    assert.equal(editor.props.readOnly, !allowed);
  }
});
test('manager level two opens team and individual lines for exactly one game without analysis or accumulations', t => {
  const e = fixture(t, false), before = JSON.stringify(e.data), initial = e.render();
  assert.match(initial, /Nivel 2 · Mis equipos por juego/); assert.doesNotMatch(initial, /Filtrar estadísticas|Acumulado oficial|managerPlayerTotals/);
  const buttons = e.nodes().filter(node => node.type === 'button' && node.props.children === 'Ver detalle estadístico');
  assert.equal(buttons.length, 4); buttons[0].props.onClick();
  let html = e.render();
  assert.match(html, /Jugadores de este partido/);
  assert.equal((html.match(/class="managerCard managerPlayerGame"/g) ?? []).length, 1);
  buttons[1].props.onClick(); html = e.render();
  assert.equal((html.match(/class="managerCard managerPlayerGame"/g) ?? []).length, 1);
  assert.equal(JSON.stringify(e.data), before);
});
test('manager level three analyzes teams but always shows individual players only for the open game, including closed tournaments', t => {
  const e = fixture(t, true), html = e.render();
  assert.doesNotMatch(html, /managerPlayerTotals|managerPlayerTotal|Jugadores · Acumulado/);
  assert.match(html, /Filtrar estadísticas/); assert.match(html, /Acumulado del equipo/);
  assert.match(html, /cada jugador se consultan solo por partido, nunca acumuladas/);
  const buttons = e.nodes().filter(node => node.type === 'button' && node.props.children === 'Ver detalle estadístico');
  for (const button of buttons) {
    button.props.onClick();
    assert.equal((e.render().match(/class="managerCard managerPlayerGame"/g) ?? []).length, 1);
    const metrics = e.nodes().filter(node => node.type?.name === 'MetricTables');
    assert.equal(metrics.at(-1).props.line.batting.G, 1);
  }
  e.states[2] = { ...e.data, analysisAllowed: false };
  assert.doesNotMatch(e.render(), /managerPlayerTotals|Filtrar estadísticas|Acumulado del equipo/);
});
test('manager proxy preserves authenticated scope and rejects extra or duplicate query parameters before transport', async t => {
  const proxy = require('../app/api/sports-sheet/[...path]/route');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([String(url), options]); return Response.json({ code: 'MANAGER_PLAYER_TOTALS_UNAVAILABLE' }, { status: 403 });
  });
  const request = query => new NextRequest(`http://localhost:3000/api/sports-sheet/manager-player-totals?${query}`, { headers: { cookie: 'playsport-account=own' } });
  assert.equal((await proxy.GET(request('tournamentId=own&teamId=team'), { params: { path: ['manager-player-totals'] } })).status, 403);
  assert.match(calls[0][0], /manager-player-totals\?tournamentId=own&teamId=team/);
  assert.equal(calls[0][1].headers.get('cookie'), 'playsport-account=own');
  for (const query of ['tournamentId=own&teamId=team&accountId=foreign', 'tournamentId=own&tournamentId=foreign&teamId=team']) {
    assert.equal((await proxy.GET(request(query), { params: { path: ['manager-player-totals'] } })).status, 400);
  }
  assert.equal(calls.length, 1);
});
test('manager selection proxy accepts more than three inscriptions beyond the former small request size', async t => {
  const proxy = require('../app/api/sports-sheet/[...path]/route');
  const selected = Array.from({ length: 200 }, (_, i) => JSON.stringify([`tournament-${i}-${'a'.repeat(100)}`, `team-${i}`]));
  const body = { expectedAccountId: 'owner', expectedRevision: 2, selected };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 16384);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(String(url), /\/manager-teams$/); assert.deepEqual(JSON.parse(options.body), body);
    assert.equal(options.headers.get('cookie'), 'playsport-account=own');
    return Response.json({ ok: true });
  });
  const req = new NextRequest('http://localhost:3000/api/sports-sheet/manager-teams', { method: 'POST',
    headers: { cookie: 'playsport-account=own', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await proxy.POST(req, { params: { path: ['manager-teams'] } })).status, 200);
});
test('a player membership does not expose averages in the basic manager scorecard; manager level two restores its game details', t => {
  const { statisticsExampleObservation, fieldPositionLabels } = require('@playsport/shared');
  const { default: Scorecard } = require('../app/demo/[slug]/private-scorecard-view');
  const platform = require('../app/platform-session');
  const state = statisticsExampleObservation('example-stats-softball-live'), before = JSON.stringify(state);
  const props = { apiBase: '/api/official-scoring', tournamentId: 'tour', gameId: 'game', managerId: 'person:owner',
    homeId: 'home', awayId: 'away', ownSide: 'away', homeName: state.seed.names.home, awayName: state.seed.names.away,
    initialLineup: state.seed.lineups.away, observation: state, positionLabels: fieldPositionLabels, onBack() {} };
  for (const [planId, detailed] of [['player', false], ['manager-numbers', true], ['manager', true]]) {
    t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, account: { id: 'owner',
      features: trialPlans.find(plan => plan.id === planId).features }, session: { role: 'manager' } }));
    const html = renderToStaticMarkup(React.createElement(Scorecard, props));
    assert.equal(html.includes('Promedio de bateo'), detailed);
    assert.equal(html.includes('class="privateBattingAverage"'), detailed);
    assert.match(html, /Entrada 1/);
  }
  assert.equal(JSON.stringify(state), before);
});
