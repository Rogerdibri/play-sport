const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  playerDemoGames,
  playerDemoMemberships,
  playerDemoTournaments,
  playerDemoSource,
  readOfficialStandingGames,
  readPlayerTeams,
  readSportsTournaments,
  playerTeamPreference,
  playerScopeGames,
  playerScopeStandings,
  calculateOfficialStandings,
  demoStandings,
  demoProfileLocation,
} = require('@playsport/shared');
const Card = require('../app/demo/[slug]/official-calendar').default;

test('only the player home replaces its selector with the current team and available tournament choices', async t => {
  const { PlayerTeamCard } = require('../app/player-sports-controls');
  const sports = require('../app/player-sports-context');
  const platform = require('../app/platform-session');
  const cases = [
    { name: 'multiple teams', teams: playerDemoMemberships, picker: true },
    { name: 'same club in two tournaments', teams: [playerDemoMemberships[0],
      { ...playerDemoMemberships[0], tournamentId: 'other-tournament', tournamentName: 'Otro torneo' }], picker: true },
    { name: 'one team', teams: playerDemoMemberships.slice(0, 1) },
    { name: 'no teams', teams: [] },
    { name: 'loading', teams: playerDemoMemberships, ready: false },
    { name: 'manager unchanged', teams: playerDemoMemberships, role: 'manager' },
  ];
  for (const item of cases) await t.test(item.name, child => {
    const role = item.role ?? 'player';
    const team = item.teams[0] ?? null;
    child.mock.method(sports, 'usePlayerSports', () => ({
      role, ready: item.ready ?? true, demo: true, error: '', notice: '',
      teams: item.teams, selectedTeam: team, profile: demoProfileLocation,
      chooseTeam: assert.fail, refresh: assert.fail,
    }));
    child.mock.method(platform, 'usePlatformSession', () => ({
      session: { version: 1, role, team: 'team-A' }, account: null,
    }));
    const html = renderToStaticMarkup(React.createElement(PlayerTeamCard));
    assert.equal(html.includes('<details class="playerTeamPicker"'), Boolean(item.picker));
    assert.equal(html.includes('<select'), role === 'manager');
    if (item.picker) {
      assert.match(html, /<summary aria-label="Cambiar equipo: [^"]+"><h1>/);
      assert.equal((html.match(/class="playerTeamChoice"/g) ?? []).length, item.teams.length);
      assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
      for (const team of item.teams) assert.ok(html.includes(team.tournamentName));
    }
    if (!item.teams.length) assert.match(html, /Aún no tienes un equipo con roster aprobado/);
    if (item.ready === false) assert.match(html, /Consultando tus equipos/);
  });
});

test('a real player without approved teams never receives the fictional memberships, games or demo notice', (t) => {
  const sports = require('../app/player-sports-context');
  const platform = require('../app/platform-session');
  const navigation = require('../app/navigation-hooks');
  const catalog = require('../app/demo/[slug]/use-public-official-games');
  t.mock.method(sports, 'usePlayerSports', () => ({
    ready: true,
    demo: false,
    error: '',
    notice: '',
    teams: [],
    tournaments: [],
    profile: demoProfileLocation,
    preference: playerTeamPreference(null, demoProfileLocation),
    selectedTeam: null,
    chooseTeam() {},
    updateFilter() {},
    refresh() {},
  }));
  t.mock.method(platform, 'usePlatformSession', () => ({
    account: { id: 'real-account' },
    reportNavigationError: assert.fail,
  }));
  t.mock.method(navigation, 'useNavigationDraft', () => [
    null,
    assert.fail,
    true,
  ]);
  t.mock.method(catalog, 'default', () => ({
    games: [],
    error: '',
    refresh() {},
  }));
  const Browser = require('../app/demo/[slug]/player-game-browser').default;
  const markup = renderToStaticMarkup(React.createElement(Browser));
  assert.doesNotMatch(
    markup,
    /data-player-game-id=|JUEGO FICTICIO|Recorrido ficticio|Cóndores del Ávila|Guardianes del Lago|Toros de Maracay/,
  );
});

test('the persistent fictional player has three teams and leagues, with valid public fixture contracts', () => {
  assert.equal(playerDemoMemberships.length, 3);
  assert.equal(
    new Set(playerDemoMemberships.map((team) => team.leagueId)).size,
    3,
  );
  assert.deepEqual(
    readPlayerTeams(
      { accountId: 'example-owner', teams: playerDemoMemberships },
      'example-owner',
    ),
    playerDemoMemberships,
  );
  assert.deepEqual(
    readSportsTournaments({ tournaments: playerDemoTournaments }),
    playerDemoTournaments,
  );
  assert.equal(
    readOfficialStandingGames({ games: playerDemoGames }).length,
    playerDemoGames.length,
  );
  assert.ok(
    playerDemoGames.every((game) =>
      game.gameId.startsWith('example-player-game:'),
    ),
  );
});

test('every projected game keeps its recorded source, date, location and score and never becomes an official game', () => {
  for (const game of playerDemoGames) {
    const source = playerDemoSource(game.gameId);
    assert.ok(source);
    assert.notEqual(source.status, 'cancelled');
    assert.equal(game.details.date, source.date);
    assert.equal(game.homeScore, source.score?.home ?? 0);
    assert.equal(game.awayScore, source.score?.away ?? 0);
    const tournament = playerDemoTournaments.find(
      (tournament) => tournament.id === game.tournamentId,
    );
    assert.ok(tournament.teams.some((team) => team.id === game.homeTeamId));
    assert.ok(tournament.teams.some((team) => team.id === game.awayTeamId));
  }
  assert.equal(playerDemoSource('game-global-1'), undefined);
  assert.equal(
    playerDemoSource('example-player-game:ejemplo-cancelado'),
    undefined,
  );
});

test('switching the example membership visibly demonstrates final, live and scheduled games in different locations', () => {
  const expected = [
    ['final', 'VE-A'],
    ['in_progress', 'VE-V'],
    ['scheduled', 'VE-D'],
  ];
  playerDemoMemberships.forEach((team, index) => {
    const preference = playerTeamPreference(team, demoProfileLocation);
    const games = playerScopeGames(
      playerDemoGames,
      playerDemoTournaments,
      preference.filter,
    );
    assert.ok(games.length);
    assert.ok(
      games.every(
        (game) =>
          game.status === expected[index][0] &&
          game.details.stateId === expected[index][1],
      ),
    );
    assert.ok(games.every((game) => game.tournamentId === team.tournamentId));
  });
});

test('fictional standings preserve the existing complete classification and unplayed games never award wins', () => {
  for (const team of playerDemoMemberships) {
    const filter = playerTeamPreference(team, demoProfileLocation).filter;
    const [table] = calculateOfficialStandings(
      playerScopeStandings(playerDemoGames, playerDemoTournaments, filter),
    );
    const leagueId = team.leagueId.replace('example-player-league:', '');
    const expected = demoStandings(leagueId, team.tournamentName);
    for (const row of table.rows) {
      const source = expected.rows.find(
        (source) => source.team === table.teamNames[row.team],
      );
      assert.deepEqual(
        [row.played, row.wins, row.losses, row.runsFor, row.runsAgainst],
        [
          source.played,
          source.wins,
          source.losses,
          source.runsFor,
          source.runsAgainst,
        ],
      );
    }
  }
});

test('fictional live and final cards open existing read-only examples, never nonexistent official endpoints', () => {
  for (const status of ['in_progress', 'final']) {
    const game = playerDemoGames.find((game) => game.status === status);
    const source = playerDemoSource(game.gameId);
    const markup = renderToStaticMarkup(
      React.createElement(Card, { game, example: true, showDate: true }),
    );
    assert.doesNotMatch(markup, /JUEGO FICTICIO|Recorrido ficticio/);
    assert.ok(markup.includes(`/demo/events-map?game=${source.id}`));
    assert.doesNotMatch(
      markup,
      /data-official-game-id=|\?official=|Ver partido oficial/,
    );
    assert.match(markup, /data-player-game-id=/);
  }
});

test('scheduled fictional cards show no invented result or unavailable scorecard link', () => {
  const game = playerDemoGames.find((game) => game.status === 'scheduled');
  const markup = renderToStaticMarkup(
    React.createElement(Card, { game, example: true }),
  );
  assert.match(markup, /Sin resultado registrado/);
  assert.match(markup, /Cómo llegar a la sede/);
  assert.doesNotMatch(
    markup,
    /Ver resultado|\?official=|href="\/demo\/events-map\?game=/,
  );
});

test('the calendar has its own full-width composition instead of inheriting the twelve-column management layout', (t) => {
  const sports = require('../app/player-sports-context');
  const platform = require('../app/platform-session');
  const navigation = require('../app/navigation-hooks');
  const catalog = require('../app/demo/[slug]/use-public-official-games');
  const team = playerDemoMemberships[0];
  t.mock.method(sports, 'usePlayerSports', () => ({
    ready: true,
    demo: true,
    error: '',
    notice: '',
    teams: playerDemoMemberships,
    tournaments: playerDemoTournaments,
    profile: demoProfileLocation,
    preference: playerTeamPreference(team, demoProfileLocation),
    selectedTeam: team,
    chooseTeam() {},
    updateFilter() {},
    refresh() {},
  }));
  t.mock.method(platform, 'usePlatformSession', () => ({
    account: null,
    reportNavigationError: assert.fail,
  }));
  t.mock.method(navigation, 'useNavigationDraft', () => [
    null,
    assert.fail,
    true,
  ]);
  t.mock.method(catalog, 'default', () => ({
    games: [],
    error: '',
    refresh() {},
  }));
  const Browser = require('../app/demo/[slug]/player-game-browser').default;
  const markup = renderToStaticMarkup(React.createElement(Browser));
  assert.match(markup, /class="calendarBrowser"/);
  assert.doesNotMatch(markup, /class="managerWorkspace"/);
  assert.match(markup, /Ver resultado/);
  assert.match(markup, /aria-label="Ubicación geográfica de la consulta"/);
  assert.match(markup, /Estado \/ entidad federal/);
  for (const state of ['Trujillo', 'Mérida', 'Barinas', 'Apure'])
    assert.ok(markup.includes(`>${state}</option>`));
  assert.doesNotMatch(markup, /Estado del partido/);
  assert.match(markup, /<option value="all">Todos los estados<\/option>/);
  assert.match(
    markup,
    /<details class="calendarGameOptions"><summary>Situación del juego \(opcional\)<\/summary>/,
  );
  assert.equal(
    (markup.match(/<span>Estado \/ entidad federal<\/span>/g) ?? []).length,
    1,
  );
  const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
  assert.match(
    css,
    /\.calendarBrowser\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
  );
  assert.match(css, /\.calendarBrowser\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
  assert.match(
    css,
    /\.calendarBrowser \.eventsGame h3 \.institutionName,\s*\.calendarBrowser \.eventsGame h3 \.institutionName > span\s*\{[^}]*font-size:\s*inherit;[^}]*font-weight:\s*700;/,
  );
});
