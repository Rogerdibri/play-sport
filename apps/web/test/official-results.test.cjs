const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const { officialGameResult, readOfficialObservation, createPrivateState, calculateOfficialStandings, demoProfileLocation } = require('@playsport/shared');
const catalog = require('../app/demo/[slug]/use-public-official-games');
const navigation = require('../app/navigation-hooks');
const board = require('../app/demo/[slug]/official-run-scoring');
const Result = require('../app/demo/[slug]/official-result').default;
const Calendar = require('../app/demo/[slug]/official-calendar').default;
const Cartelera = require('../app/demo/[slug]/events-map').default;
const platformSession = require('../app/platform-session');
const Details = require('../app/demo/[slug]/official-game-details').default;
const Standings = require('../app/demo/[slug]/official-standings').default;
const Manager = require('../app/demo/[slug]/live-scoring-manager-demo').default;
const { GameLocation } = require('../app/demo/[slug]/official-game-workspace');
const Workspace = require('../app/demo/[slug]/official-game-workspace').default;
const sharing = require('../app/public-share');
const protest = {
  teamId: 'home', reason: 'Regla cuestionada', declaredAt: '2026-11-05T21:00:00Z', declaredBy: 'score',
  moment: { inning: 3, outs: 2, balls: 1, strikes: 2, homeScore: 5, awayScore: 1, officialVersion: 12, lastPlay: 'Bola' },
  resolution: { winnerTeamId: 'away', loserTeamId: 'home', reason: 'Decisión documentada', recordReference: 'Acta MT-RESULT',
    recordedBy: 'org', recordedAt: '2026-11-05T22:00:00Z' }
};
const game = {
  gameId: 'selected-official', tournamentId: 'tour-selected', homeTeamId: 'home', awayTeamId: 'away',
  status: 'final', homeScore: 5, awayScore: 1, protest,
  details: { tournamentName: 'Torneo seleccionado', homeTeamName: 'Locales seleccionados', awayTeamName: 'Visitantes seleccionados',
    date: '2026-11-05', time: '18:00', venue: 'Sede seleccionada' }
};
const render = (Component, props) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider,
  { value: { push() {} } }, React.createElement(Component, props)));
const mockCatalog = (t, games = [game], error = '') => t.mock.method(catalog, 'default', () => ({ games, error, refresh() {} }));
const mockFilters = (t, filters = { ...demoProfileLocation, date: '2026-11-05' }) => {
  t.mock.method(platformSession, 'usePlatformSession', () => ({ session: { version: 1, role: 'fan', team: 'team-A' }, enter() {} }));
  t.mock.method(navigation, 'useNavigationDraft', () => [filters, () => {}, true]);
};

test('one immutable projection gives the acta precedence over runs, including a contrary score and a tie', () => {
  const before = structuredClone(game);
  for (const scores of [{ homeScore: 5, awayScore: 1 }, { homeScore: 0, awayScore: 0 }]) {
    const result = officialGameResult({ ...game, ...scores });
    assert.equal(result.source, 'technical');
    assert.equal(result.winnerTeamId, 'away');
    assert.equal(result.loserTeamId, 'home');
  }
  assert.deepEqual(game, before);
  for (const status of ['scheduled', 'in_progress', 'protested']) {
    const result = officialGameResult({ ...game, status, protest: status === 'protested' ? { ...protest, resolution: null } : undefined });
    assert.equal(result.source, 'pending');
    assert.equal(result.winnerTeamId, null);
    assert.equal(result.loserTeamId, null);
  }
  assert.equal(officialGameResult({ ...game, protest: null }).winnerTeamId, 'home');
  assert.equal(officialGameResult({ ...game, protest: null, homeScore: 1 }).label, 'Empate');
  assert.throws(() => officialGameResult({ ...game, protest: { ...protest, resolution: null } }), /requiere la resolución/);
});
test('official observation reads the actual status, not scorecard.finished, and rejects malformed snapshots', () => {
  const scorecard = createPrivateState({ names: { home: 'Local', away: 'Visitante' }, lineups: { home: [], away: [] },
    rosters: { home: [], away: [] }, courtesyRunnerSource: 'BENCH' });
  const state = { status: 'final', protest, officialVersion: 14, inning: 3, outs: 2, balls: 1, strikes: 2,
    homeScore: 5, awayScore: 1, lastPlay: 'Bola' };
  const raw = { state, playByPlay: { scorecard } };
  const before = structuredClone(raw);
  assert.equal(scorecard.finished, false);
  assert.equal(readOfficialObservation(raw).status, 'final');
  for (const status of ['scheduled', 'in_progress', 'protested']) {
    assert.equal(readOfficialObservation({ ...raw, state: { ...state, status,
      protest: status === 'protested' ? { ...protest, resolution: null } : undefined } }).status, status);
  }
  for (const patch of [{ status: 'unknown' }, { officialVersion: -1 }, { homeScore: '5' },
    { protest: {} }, { status: 'protested', protest: undefined }, { protest: { ...protest, resolution: null } }]) {
    assert.throws(() => readOfficialObservation({ ...raw, state: { ...state, ...patch } }));
  }
  assert.deepEqual(raw, before);
});
test('public result identifies technical winner and loser without implying the larger score won', () => {
  const html = render(Result, { game });
  assert.match(html, /Ganador: Visitantes seleccionados · Perdedor: Locales seleccionados/);
  assert.match(html, /Marcador anotado conservado/);
  assert.match(html, /por el acta, no por estas carreras/);
  assert.doesNotMatch(html, /Ganador: Locales|<input|<form|<button/);
});
test('official calendar card links the selected game and preserves technical results without adding a second list', () => {
  const html = render(Calendar, { game });
  assert.match(html, /data-official-game-id="selected-official"/);
  assert.match(html, /Ganador: Visitantes seleccionados/);
  assert.match(html, /href="\/demo\/events-map\?official=selected-official"/);
  assert.doesNotMatch(html, /Partidos oficiales de la fecha|No son los ejemplos de abajo|google.com\/maps/);
});
test('cartelera integrates matching official games and archives in one chronological list with accurate status counts', t => {
  const located = { ...game, details: { ...game.details, ...demoProfileLocation } };
  mockCatalog(t, [located,
    { ...located, gameId: 'live-official', status: 'in_progress', protest: null, details: { ...located.details, time: '09:00' } },
    { ...located, gameId: 'pending-protest', status: 'protested', protest: { ...protest, resolution: null }, details: { ...located.details, time: '20:00' } }]);
  mockFilters(t);
  const html = render(Cartelera);
  assert.equal((html.match(/class="eventsResults"/g) ?? []).length, 1);
  assert.equal((html.match(/class="eventsGameGrid"/g) ?? []).length, 1);
  assert.match(html, /6 partidos/);
  assert.match(html, /En juego: 1/);
  assert.match(html, /Por jugar: 1/);
  assert.match(html, /Finalizados: 3/);
  assert.match(html, /Bajo protesta: 1/);
  assert.match(html, /Ganador: Visitantes seleccionados · Perdedor: Locales seleccionados/);
  assert.match(html, /ejemplo-caracas-finalizado-5/);
  assert.match(html, /Cómo llegar en Google Maps/);
  assert.ok(html.indexOf('data-official-game-id="live-official"') < html.indexOf('data-official-game-id="selected-official"'));
  assert.doesNotMatch(html, /Partidos oficiales de la fecha|No son los ejemplos de abajo|se muestran aparte/);
});
test('cartelera applies the same territorial and date filters to every source without inventing missing locations', t => {
  mockCatalog(t, [game, { ...game, gameId: 'other-state', details: { ...game.details, stateId: 'VE-D', municipalityId: 'VE-D:girardot' } },
    { ...game, gameId: 'other-municipality', details: { ...game.details, stateId: 'VE-V', municipalityId: 'VE-V:maracaibo' } },
    { ...game, gameId: 'other-date', details: { ...game.details, ...demoProfileLocation, date: '2026-11-06' } }]);
  mockFilters(t);
  const html = render(Cartelera);
  assert.match(html, /3 partidos/);
  assert.match(html, /ubicación de su sede pendiente/);
  assert.doesNotMatch(html, /data-official-game-id|other-state|other-municipality|other-date/);
  assert.match(html, /data-game-id="ejemplo-caracas-finalizado-5"/);
});
test('organizer venue configuration does not default to a personal location and stays locked after protest or finalization', t => {
  t.mock.method(navigation, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  const html = render(GameLocation, { apiBase: '', organizerId: 'org', game: { ...game, status: 'scheduled', protest: null } });
  assert.match(html, /Selecciona el estado/);
  assert.match(html, /value="" selected=""/);
  assert.doesNotMatch(html, /value="VE-A" selected=""/);
  for (const status of ['protested', 'final']) {
    const locked = render(GameLocation, { apiBase: '', organizerId: 'org', game: { ...game, status } });
    assert.match(locked, /<fieldset[^>]*disabled=""/);
    assert.match(locked, /No se modifican los datos/);
  }
});
test('official details pass actual selected IDs and team names to the read-only board, not the global default', t => {
  mockCatalog(t);
  t.mock.method(navigation, 'useScreenBack', () => {});
  let received;
  t.mock.method(board, 'default', props => { received = props; return React.createElement('section', null, 'Pizarra seleccionada'); });
  const html = render(Details, { gameId: game.gameId });
  assert.equal(received.gameId, 'selected-official');
  assert.equal(received.tournamentId, 'tour-selected');
  assert.equal(received.publicView, true);
  assert.equal(received.teamNames.away, 'Visitantes seleccionados');
  assert.equal(received.actorId, undefined);
  assert.match(html, /Torneo seleccionado/);
  assert.match(html, /Pizarra seleccionada/);
  assert.match(html, /class="eventsGameDetails"/);
  const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
  assert.match(css, /\.managerWorkspace\s*>\s*\.eventsGameDetails\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;/,
    'A public or manager match detail must fill the workspace, not one of its twelve columns');
});
test('official standings and cards agree on the technical winner and preserve the score', t => {
  mockCatalog(t);
  const table = calculateOfficialStandings([game])[0];
  assert.equal(table.rows[0].team, officialGameResult(game).winnerTeamId);
  assert.deepEqual(table.rows.map(row => [row.team, row.wins, row.losses, row.runsFor, row.runsAgainst]),
    [['away', 1, 0, 1, 5], ['home', 0, 1, 5, 1]]);
  const html = render(Standings);
  assert.match(html, /Visitantes seleccionados<\/strong> ganador/);
  assert.match(html, /href="\/demo\/events-map\?official=selected-official"/);
});
test('completed workspaces lead to the exact public result, whose sharing control keeps that identity', t => {
  const selected = { ...game, gameId: 'plan:tour-selected:opening', canOperate: false, organizerCapacityBlocked: true };
  mockCatalog(t, [selected]);
  mockFilters(t);
  t.mock.method(navigation, 'useScreenBack', () => {});
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  t.mock.method(board, 'default', () => React.createElement('p', null, 'Pizarra oficial'));
  let shared;
  t.mock.method(sharing, 'default', props => {
    shared = props;
    return React.createElement('p', null, 'Compartir enlace público');
  });
  const href = '/demo/events-map?official=plan%3Atour-selected%3Aopening';
  assert.match(render(Workspace, { view: 'scorekeeper', game: selected, onBack() {} }),
    /href="\/demo\/events-map\?official=plan%3Atour-selected%3Aopening">Consultar y compartir resultado oficial/);
  render(Details, { gameId: selected.gameId });
  assert.equal(shared.path, href);
  assert.equal(shared.title, 'Visitantes seleccionados vs. Locales seleccionados · PlaySport');
  assert.doesNotMatch(shared.title, /Ganador|5|1|person:/);
});
test('both web managers see the current official decision and acta before opening the scoreboard', t => {
  mockCatalog(t, [{ ...game, gameId: 'game-global-1', tournamentId: 'tour-global-1', homeTeamId: 'team-A', awayTeamId: 'team-B',
    protest: { ...protest, teamId: 'team-A', resolution: { ...protest.resolution, winnerTeamId: 'team-B', loserTeamId: 'team-A' } } }]);
  t.mock.method(navigation, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  t.mock.method(navigation, 'useScreenBack', () => {});
  for (const rival of [false, true]) {
    const html = render(Manager, { rival });
    assert.match(html, /Ganador: Visitantes seleccionados · Perdedor: Locales seleccionados/);
    assert.match(html, /Acta MT-RESULT/);
    assert.match(html, /Ver partido y acta · Solo lectura/);
  }
});
test('public catalog loading, failure, empty and missing-game states never substitute fictional data', async t => {
  for (const [name, games, error, expected] of [
    ['loading', null, '', /Consultando partidos…/], ['error', null, 'API no disponible', /API no disponible/],
    ['empty', [], '', /3 partidos/]
  ]) await t.test(name, child => {
    mockCatalog(child, games, error);
    mockFilters(child);
    const html = render(Cartelera);
    assert.match(html, expected);
    assert.doesNotMatch(html, /data-official-game-id|Tigres del Valle|Leones del Norte/);
    assert.match(html, /ejemplo-caracas-finalizado-5/);
    assert.doesNotMatch(html, /No hay partidos registrados/);
  });
  await t.test('missing detail', child => {
    mockCatalog(child);
    child.mock.method(navigation, 'useScreenBack', () => {});
    assert.match(render(Details, { gameId: 'not-there' }), /no está disponible/);
  });
});
