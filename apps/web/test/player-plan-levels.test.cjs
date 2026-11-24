const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { playerPlanLevel, trialPlans, exampleStatisticsGames, readStatisticsSnapshot, readStatisticsFilters } = require('@playsport/shared');
const { default: AccountStatistics } = require('../app/sports-sheet/statistics/statistics-view');
const PlayerPlanLevels = require('../app/account/access/player-plan-levels').default;

const empty = () => ({ group: '', season: '', league: '', tournament: '', team: '', game: '', from: '', to: '' });
function fixture(t, analysisAllowed, filters = empty()) {
  const games = exampleStatisticsGames('player');
  const account = { id: 'owner', features: trialPlans.find(plan => plan.id === (analysisAllowed ? 'player' : 'player-numbers')).features };
  const states = ['player', 'official', { accountId: 'owner', mode: 'player', source: 'official', identityVerified: true, analysisAllowed, games },
    filters, null, false, '', 0, false, false];
  let index, tree;
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  });
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  function Capture() { tree = AccountStatistics({ account }); return tree; }
  return { games, states, render() { index = 0; return renderToStaticMarkup(React.createElement(Capture)); },
    nodes() { return nodes(tree); } };
}
test('level two lists all participations but only renders the opened game, never an aggregate, even with stale filters', t => {
  const e = fixture(t, false, { ...empty(), from: '2099-01-01', tournament: 'not-owned' });
  const before = JSON.stringify(e.games), html = e.render();
  assert.match(html, /Nivel 2 · Mis números/);
  assert.doesNotMatch(html, /<h2>Acumulado/);
  assert.equal(e.nodes().filter(node => node.props?.line?.batting).length, 0);
  assert.equal(e.nodes().filter(node => node.type === 'select' || node.type === 'input' && node.props.type === 'date').length, 0);
  const details = e.nodes().filter(node => node.type === 'button' && node.props.children === 'Ver detalle estadístico');
  assert.equal(details.length, 4);
  details[0].props.onClick();
  assert.match(e.render(), /Detalle: Relámpagos del Sur vs. Guardianes del Lago/);
  assert.equal(e.nodes().filter(node => node.props?.line?.batting).length, 1);
  const chosen = e.games.find(game => JSON.stringify([game.tournamentId, game.gameId, game.teamId]) === e.states[4]);
  assert.deepEqual(e.nodes().find(node => node.props?.line?.batting).props.line, chosen.line);
  details[1].props.onClick();
  e.render();
  assert.equal(e.nodes().filter(node => node.props?.line?.batting).length, 1);
  e.nodes().find(node => node.type === 'button' && node.props.children === 'Cerrar detalle').props.onClick();
  e.render();
  assert.equal(e.nodes().filter(node => node.props?.line?.batting).length, 0);
  assert.equal(JSON.stringify(e.games), before);
});
test('level three retains collapsible filters and personal detail while level two cannot render analysis controls', t => {
  const e = fixture(t, true), html = e.render();
  assert.match(html, /Nivel 3 · Análisis completo/);
  assert.equal(e.nodes().filter(node => node.type === 'select').length, 6);
  assert.equal(e.nodes().filter(node => node.type === 'input' && node.props.type === 'date').length, 2);
  assert.match(html, /Acumulado oficial/);
  assert.equal(e.nodes().find(node => node.type === 'details' && node.props.className.includes('sportsStatisticsFilters')).props.open, undefined);
  e.states[2] = { ...e.states[2], analysisAllowed: false };
  assert.doesNotMatch(e.render(), /<h2>Acumulado/);
  assert.equal(e.nodes().filter(node => node.type === 'select').length, 0);
});
test('catalog has exactly three player levels, no price and current level is distinguished without granting other roles', () => {
  const html = renderToStaticMarkup(React.createElement(PlayerPlanLevels, { currentLevel: 2 }));
  assert.equal((html.match(/<article /g) ?? []).length, 3);
  assert.match(html, /aria-current="true"/); assert.match(html, /Tu nivel actual/);
  assert.doesNotMatch(html, /\$|US[D$]|renovación automática/);
  assert.equal(playerPlanLevel(null), 1);
  assert.equal(playerPlanLevel({ features: ['career', 'final-report-details', 'team-statistics'] }), 1);
  assert.equal(playerPlanLevel({ features: trialPlans.find(plan => plan.id === 'player-numbers').features }), 2);
  assert.equal(playerPlanLevel({ features: trialPlans.find(plan => plan.id === 'player').features }), 3);
  assert.equal(playerPlanLevel({ localTestAccess: true }), 3);
});
test('statistics readers reject missing/forged analysis permissions and malformed dates, never defaulting to full access', () => {
  const value = { accountId: 'owner', mode: 'player', source: 'official', identityVerified: true, analysisAllowed: false,
    games: exampleStatisticsGames('player') };
  assert.equal(readStatisticsSnapshot(value, 'owner', 'player', 'official').analysisAllowed, false);
  for (const analysisAllowed of [undefined, 'true', 1, null])
    assert.throws(() => readStatisticsSnapshot({ ...value, analysisAllowed }, 'owner', 'player', 'official'));
  for (const query of [{ from: '2026-02-31' }, { to: ['2026-10-10'] }, { game: '\u007f' }, { team: 'a'.repeat(1001) },
    { from: '2026-11-22', to: '2026-01-01' }]) assert.throws(() => readStatisticsFilters(query));
});
test('web proxy forwards advanced filters to authenticated API but rejects duplicates and forged capabilities', async t => {
  const proxy = require('../app/api/service-proxy'), calls = [];
  t.mock.method(proxy, 'proxyJsonService', async (_request, url) => { calls.push(url); return new Response('{}'); });
  const { GET } = require('../app/api/sports-sheet/[...path]/route');
  const context = { params: Promise.resolve({ path: ['statistics'] }) };
  const response = await GET(new NextRequest('http://localhost:3000/api/sports-sheet/statistics?mode=player&from=2026-10-10&tournament=cup'), context);
  assert.equal(response.status, 200); assert.match(calls[0], /from=2026-10-10&tournament=cup/);
  for (const query of ['from=2026-10-10&from=2026-10-11', 'analysisAllowed=true', 'accountId=other'])
    assert.equal((await GET(new NextRequest(`http://localhost:3000/api/sports-sheet/statistics?${query}`), context)).status, 400);
  assert.equal(calls.length, 1);
});
