const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  demoProfileLocation,
  venezuelaStates,
  playerTeamKey,
  playerTeamPreference,
  isPlayerSportsPreference,
  readSportsTournaments,
  readPlayerTeams,
  playerScopeGames,
  playerScopeStandings,
  calculateOfficialStandings,
} = require('@playsport/shared');
const here = demoProfileLocation;
const elsewhere = { stateId: 'VE-D', municipalityId: 'VE-D:girardot' };
const tournament = (id, leagueId, location = here) => ({
  id,
  name: id,
  leagueId,
  leagueName: leagueId,
  location,
  teams: ['A', 'B', 'C'].map((id) => ({ id, name: id })),
});
const catalog = [
  tournament('first', 'league-1'),
  tournament('second', 'league-1', elsewhere),
  tournament('third', 'league-2'),
];
const membership = (tournamentId = 'first', teamId = 'A') => ({
  tournamentId,
  teamId,
  tournamentName: tournamentId,
  teamName: teamId,
  leagueId: 'league-1',
  leagueName: 'Liga de pruebas',
  location: here,
});
const game = (
  gameId,
  tournamentId,
  homeTeamId = 'A',
  awayTeamId = 'B',
  location = here,
) => ({
  gameId,
  tournamentId,
  homeTeamId,
  awayTeamId,
  status: 'final',
  homeScore: 2,
  awayScore: 1,
  details: {
    tournamentName: tournamentId,
    homeTeamName: homeTeamId,
    awayTeamName: awayTeamId,
    date: '2026-11-09',
    time: '10:00',
    venue: 'Estadio de pruebas',
    ...location,
  },
});
const games = [
  game('one', 'first'),
  game('other-teams', 'first', 'B', 'C', elsewhere),
  game('two', 'second', 'A', 'C', elsewhere),
  game('three', 'third'),
];
const ids = (games) => games.map((game) => game.gameId);
const filter = (scope) => ({
  ...playerTeamPreference(membership(), here).filter,
  scope,
});

test('a player defaults to the complete tournament, and selecting a second membership changes that default', () => {
  const first = playerTeamPreference(membership(), here);
  assert.ok(isPlayerSportsPreference(first));
  assert.equal(first.filter.scope, 'tournament');
  assert.deepEqual(ids(playerScopeGames(games, catalog, first.filter)), [
    'one',
    'other-teams',
  ]);
  const second = playerTeamPreference(membership('second', 'C'), here);
  assert.deepEqual(second.selectedTeam, {
    tournamentId: 'second',
    teamId: 'C',
  });
  assert.deepEqual(ids(playerScopeGames(games, catalog, second.filter)), [
    'two',
  ]);
  assert.notEqual(
    playerTeamKey(first.selectedTeam),
    playerTeamKey(second.selectedTeam),
  );
});
test('team, league and all scopes never confuse identical team IDs in different tournaments', () => {
  assert.deepEqual(ids(playerScopeGames(games, catalog, filter('team'))), [
    'one',
  ]);
  assert.deepEqual(ids(playerScopeGames(games, catalog, filter('league'))), [
    'one',
    'other-teams',
    'two',
  ]);
  assert.deepEqual(
    ids(playerScopeGames(games, catalog, filter('all'))),
    ids(games),
  );
  assert.deepEqual(
    playerScopeGames(games, catalog, {
      ...filter('league'),
      leagueId: 'unavailable',
    }),
    [],
  );
});
test('a player with no approved roster starts in the profile municipality, without a fictitious membership', () => {
  const initial = playerTeamPreference(null, here);
  assert.equal(initial.selectedTeam, null);
  assert.equal(initial.filter.scope, 'municipality');
  assert.deepEqual(ids(playerScopeGames(games, catalog, initial.filter)), [
    'one',
    'three',
  ]);
});
test('territorial browsing uses the venue, includes all municipalities of a state, and excludes unlocated games', () => {
  const state = venezuelaStates.find((state) => state.id === 'VE-D');
  const anotherMunicipality = {
    stateId: state.id,
    municipalityId: state.municipalities.find(
      (item) => item.id !== elsewhere.municipalityId,
    ).id,
  };
  const fixtures = [
    ...games,
    game('nearby', 'third', 'A', 'B', anotherMunicipality),
    { ...game('unlocated', 'first'), details: null },
  ];
  const municipal = { ...filter('municipality'), location: elsewhere };
  assert.deepEqual(ids(playerScopeGames(fixtures, catalog, municipal)), [
    'other-teams',
    'two',
  ]);
  assert.deepEqual(
    ids(playerScopeGames(fixtures, catalog, { ...municipal, scope: 'state' })),
    ['other-teams', 'two', 'nearby'],
  );
  assert.deepEqual(municipal.location, elsewhere);
  assert.deepEqual(here, demoProfileLocation);
});
test('positions retain every opponent and away-venue result of a selected tournament, not a partial classification', () => {
  for (const scope of ['team', 'municipality']) {
    const scoped = playerScopeStandings(games, catalog, filter(scope));
    const first = calculateOfficialStandings(scoped).find(
      (row) => row.id === 'first',
    );
    assert.deepEqual(
      new Set(first.rows.map((row) => row.team)),
      new Set(['A', 'B', 'C']),
    );
    assert.equal(first.rows.find((row) => row.team === 'B').played, 2);
    assert.equal(first.rows.find((row) => row.team === 'C').played, 1);
  }
  assert.deepEqual(
    ids(playerScopeStandings(games, catalog, filter('league'))),
    ['one', 'other-teams', 'two'],
  );
});
test('persisted player preferences validate scope, territorial catalog and required identifiers', () => {
  assert.ok(isPlayerSportsPreference(null));
  for (const value of [
    {},
    {
      ...playerTeamPreference(null, here),
      filter: { ...filter('team'), teamId: '' },
    },
    {
      ...playerTeamPreference(null, here),
      filter: { ...filter('league'), leagueId: '' },
    },
    {
      ...playerTeamPreference(null, here),
      filter: {
        ...filter('municipality'),
        location: { stateId: 'VE-D', municipalityId: here.municipalityId },
      },
    },
  ]) {
    assert.equal(isPlayerSportsPreference(value), false);
  }
});
test('catalog and own-team responses reject duplicate IDs, foreign accounts and malformed locations', () => {
  assert.deepEqual(readSportsTournaments({ tournaments: catalog }), catalog);
  assert.deepEqual(
    readPlayerTeams({ accountId: 'owner', teams: [membership()] }, 'owner'),
    [membership()],
  );
  assert.throws(() =>
    readPlayerTeams({ accountId: 'other', teams: [membership()] }, 'owner'),
  );
  assert.throws(() =>
    readPlayerTeams(
      { accountId: 'owner', teams: [membership(), membership()] },
      'owner',
    ),
  );
  assert.throws(() =>
    readSportsTournaments({ tournaments: [catalog[0], catalog[0]] }),
  );
  assert.throws(() =>
    readSportsTournaments({
      tournaments: [{ ...catalog[0], location: { stateId: 'invalid' } }],
    }),
  );
});
