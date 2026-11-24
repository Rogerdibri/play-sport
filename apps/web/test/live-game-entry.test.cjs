const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const navigation = require('../app/navigation-hooks');
const workspace = require('../app/demo/[slug]/official-game-workspace');
const Inbox = require('../app/demo/[slug]/team-sheet-inbox').default;

const game = (gameId, status = 'scheduled', time = '18:00') => ({
  gameId, tournamentId: 'tournament', homeTeamId: 'home', awayTeamId: 'away',
  status, homeScore: 0, awayScore: 0, assignedScorekeeperIds: ['scorer-demo'], availableScorekeeperIds: ['scorer-demo'],
  details: { tournamentName: `Torneo ${gameId}`, homeTeamName: `Local ${gameId}`, awayTeamName: `Visitante ${gameId}`,
    date: '2026-11-05', time, venue: 'Estadio de prueba' }
});

function render(t, games, error = '') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T17:00:00-04:00').getTime() });
  t.mock.method(navigation, 'useNavigationDraft', () => ['old-selection', () => {}, true]);
  t.mock.method(navigation, 'useScreenBack', () => {});
  const useState = React.useState;
  let index = 0;
  t.mock.method(React, 'useState', initial => {
    const position = index++;
    if (position === 0) return [games === null ? null : { userId: 'scorer-demo', role: 'scorekeeper', games }, () => {}];
    if (position === 3) return [error, () => {}];
    return useState(initial);
  });
  t.mock.method(workspace, 'default', ({ game: selected }) => React.createElement('section', { 'data-workspace': selected.gameId }, selected.details.tournamentName));
  return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push() {} } },
    React.createElement(Inbox, { view: 'scorekeeper', liveEntry: true })));
}

function assertNoCatalog(html) {
  assert.doesNotMatch(html, /Explora con ejemplos|assignedMetrics|Partidos oficiales|Próximos partidos|Finalizados/);
  assert.match(html, /href="\/demo\/live-scoring\?view=scorekeeper"/);
}

test('live entry shows only the eligible game, not another assignment or a stale preferred selection', t => {
  const html = render(t, [game('current'), game('old-selection', 'scheduled', '23:00'), game('finished', 'final')]);
  assert.equal((html.match(/class="assignedGameCard"/g) ?? []).length, 1);
  assert.match(html, /Torneo current/);
  assert.match(html, /Comenzar anotación/);
  assert.doesNotMatch(html, /old-selection|finished/);
  assertNoCatalog(html);
});

test('an in-progress annotation opens its workspace instead of any pending game', t => {
  const html = render(t, [game('current'), game('live', 'in_progress')]);
  assert.match(html, /data-workspace="live"/);
  assert.doesNotMatch(html, /Torneo current|Comenzar anotación|Explora con ejemplos/);
});

test('empty or overlapping assignments show guidance without exposing other games', async t => {
  for (const [name, games, message] of [
    ['empty', [], /No tienes un partido para anotar/],
    ['overlap', [game('first'), game('second')], /más de un partido/]
  ]) await t.test(name, child => {
    const html = render(child, games);
    assert.match(html, message);
    assert.doesNotMatch(html, /assignedGameCard|Torneo first|Torneo second|Comenzar anotación/);
    assertNoCatalog(html);
  });
});

test('loading and API failure never fall back to the catalog or examples', async t => {
  for (const [name, error, message] of [
    ['loading', '', /Consultando tu partido actual/],
    ['error', 'No se pudieron consultar tus partidos.', /role="alert"/]
  ]) await t.test(name, child => {
    const html = render(child, null, error);
    assert.match(html, message);
    assertNoCatalog(html);
  });
});
