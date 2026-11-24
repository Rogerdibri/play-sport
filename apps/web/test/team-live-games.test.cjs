const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { playerLiveGames, playerDemoMemberships, playerDemoGames, demoProfileLocation } = require('@playsport/shared');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const { PublicLiveGames } = require('../app/demo/[slug]/player-game-browser');

const member = { ...playerDemoMemberships[0], tournamentId: 'own-tour', teamId: 'ours' };
const game = (gameId, patch = {}) => ({
  gameId, tournamentId: 'own-tour', homeTeamId: 'ours', awayTeamId: 'opponent',
  status: 'in_progress', homeScore: 0, awayScore: 0,
  details: { homeTeamName: 'Equipo propio', awayTeamName: 'Rival', tournamentName: 'Copa propia',
    date: '2026-11-10', time: '16:00', venue: 'Campo de prueba' },
  ...patch,
});
const source = [
  game('home'), game('away', { homeTeamId: 'opponent', awayTeamId: 'ours' }),
  game('foreign', { homeTeamId: 'foreign' }),
  game('another-tournament', { tournamentId: 'another-tour' }),
  ...['scheduled', 'final', 'suspended', 'protested'].map(status => game(status, { status })),
];

test('only in-progress games with an exact tournament/team membership are eligible, without mutating inputs', () => {
  const games = Object.freeze(source.map(row => Object.freeze(row)));
  const memberships = Object.freeze([Object.freeze(member)]);
  assert.deepEqual(playerLiveGames(games, memberships).map(row => row.gameId), ['home', 'away']);
  assert.deepEqual(playerLiveGames(games, []), []);
  assert.equal(games.length, 8);
  assert.deepEqual(playerLiveGames([game('same-name', { homeTeamId: 'different-id' })], memberships), []);
});
function setup(t, { role = 'player', games = source, teams = [member], demo = false, ready = true, error = '', signedIn = true } = {}) {
  let observed = games;
  const calls = [], examples = [], push = t.mock.fn(), refresh = t.mock.fn();
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({
    ready: true, session: { role }, account: signedIn ? { id: 'test-account' } : null,
  }));
  t.mock.method(require('../app/player-sports-context'), 'usePlayerSports', () => ({
    role, ready, error, notice: '', demo, teams, selectedTeam: teams[0] ?? null,
    preference: { filter: { scope: 'all', location: demoProfileLocation } }, refresh,
  }));
  t.mock.method(require('../app/demo/[slug]/use-public-official-games'), 'default', () => ({ games: observed, error: '', refresh }));
  t.mock.method(require('../app/demo/[slug]/official-run-scoring'), 'default', props => {
    calls.push(props);
    return React.createElement('section', { 'data-scoreboard': props.gameId }, 'PIZARRA RESUMEN · TABLAS DE ANOTACIÓN');
  });
  t.mock.method(require('../app/demo/[slug]/private-scorecard-view'), 'default', props => {
    examples.push(props);
    return React.createElement('section', { 'data-example': props.gameId }, 'PIZARRA RESUMEN · TABLAS DE ANOTACIÓN');
  });
  return {
    calls, examples, push, refresh,
    render: props => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push } },
      React.createElement(PublicLiveGames, props))),
    catalog: value => { observed = value; },
  };
}
test('both team roles open their own live scoreboard directly, not the calendar or geographic filters', async t => {
  for (const role of ['player', 'manager']) await t.test(role, child => {
    const e = setup(child, { role });
    const html = e.render();
    assert.match(html, /PIZARRA RESUMEN · TABLAS DE ANOTACIÓN/);
    assert.doesNotMatch(html, /Actualizar partidos|Todas las situaciones|Ver resultado|Qué quieres consultar|Estado \/ entidad/);
    assert.equal(e.calls.length, 1);
    assert.equal(e.calls[0].gameId, 'home');
    assert.equal(e.calls[0].tournamentId, 'own-tour');
    assert.equal(e.calls[0].publicView, true);
    assert.equal(e.calls[0].actorId, undefined);
    assert.equal((html.match(/aria-pressed=/g) ?? []).length, 2);
  });
});
test('direct links cannot show foreign, finished, suspended, scheduled or wrong-tournament games', async t => {
  for (const id of ['foreign', 'another-tournament', 'scheduled', 'final', 'suspended', 'protested', 'missing']) {
    await t.test(id, child => {
      const e = setup(child);
      assert.match(e.render({ gameId: id }), /no está en curso o no pertenece a tus equipos/);
      assert.equal(e.calls.length, 0);
    });
  }
});
test('no memberships or no live games produce an explicit empty state, never an arbitrary game', async t => {
  for (const options of [{ teams: [] }, { games: source.filter(row => row.status !== 'in_progress') }, { games: [] }]) {
    await t.test(JSON.stringify(options), child => {
      const e = setup(child, options);
      assert.match(e.render(), /No tienes juegos en curso con tus equipos/);
      assert.equal(e.calls.length, 0);
    });
  }
});
test('favorites and consultation scope cannot grant access to another team', t => {
  const e = setup(t, { games: [source[2], source[0]] });
  t.mock.method(require('../app/favorites'), 'useFavorites', () => ({
    matchesGame: row => row.gameId === 'foreign', catalog: [], isFavorite: () => false,
  }));
  e.render();
  assert.equal(e.calls[0].gameId, 'home');
  assert.equal(e.calls.length, 1);
});
test('a saved role without an authenticated account cannot inherit demo memberships as real assignments', t => {
  const e = setup(t, { signedIn: false, demo: true, teams: [member] });
  assert.match(e.render(), /Inicia sesión en Mi cuenta/);
  assert.equal(e.calls.length, 0);
  assert.equal(e.examples.length, 0);
});
test('loading and context failures do not fall back to another game', async t => {
  for (const options of [{ ready: false }, { error: 'No se pudieron comprobar tus equipos.' }]) {
    await t.test(JSON.stringify(options), child => {
      const e = setup(child, options);
      const html = e.render();
      assert.match(html, options.error ? /No se pudieron comprobar tus equipos/ : /Consultando los juegos en curso/);
      assert.equal(e.calls.length, 0);
    });
  }
});
test('only an explicitly permitted local example is shown using its read-only observation', t => {
  const live = playerDemoGames.find(row => row.status === 'in_progress' &&
    playerDemoMemberships.some(team => team.tournamentId === row.tournamentId && [row.homeTeamId, row.awayTeamId].includes(team.teamId)));
  assert.ok(live);
  const e = setup(t, { games: [], teams: playerDemoMemberships, demo: true });
  assert.match(e.render({ gameId: live.gameId }), /PIZARRA RESUMEN/);
  assert.equal(e.calls.length, 0);
  assert.equal(e.examples.length, 1);
  assert.ok(e.examples[0].observation);
  assert.equal(e.examples[0].official, undefined);
  assert.equal(e.examples[0].example, undefined);
});
test('an immediate status change removes the scoreboard before the catalog next refreshes', t => {
  const e = setup(t, { games: [source[0]] });
  const states = [];
  let index = 0;
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  });
  const render = () => { index = 0; return e.render(); };
  assert.match(render(), /PIZARRA RESUMEN/);
  e.calls[0].onState({ status: 'final' });
  assert.match(render(), /No tienes juegos en curso con tus equipos/);
  assert.equal(e.calls.length, 1);
});
