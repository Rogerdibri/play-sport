const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { isOfficialGameDetails, readOfficialGames } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const details = { tournamentName: 'Torneo de prueba', homeTeamName: 'Locales', awayTeamName: 'Visitantes',
  date: '2026-11-05', time: '18:30', venue: 'Estadio de prueba' };

function setup() {
  const service = new OfficialScoringService();
  const controller = new OfficialScoringController(service);
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000',
    scorekeeperIds: ['score', 'other'], scorekeeperIdentities: [
      { actorId: 'score', identificationNumber: 'SCORE1000' }, { actorId: 'other', identificationNumber: 'OTHER1000' }
    ] });
  for (const teamId of ['home', 'away']) {
    service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: `PLAYER${teamId}`, displayName: `Jugador ${teamId}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: [`PLAYER${teamId}`] });
  }
  for (const gameId of ['game-1', 'game-2']) service.configureGameTeams({
    tournamentId: 'tour', organizerId: 'org', gameId, homeTeamId: 'home', awayTeamId: 'away'
  });
  const assign = (scorekeeperIds, gameId = 'game-1', organizerId = 'org') => controller.configureGameAuthorization(gameId, {
    tournamentId: 'tour', organizerId, scorekeeperIds
  });
  const permissions = (gameId = 'game-1', userId = 'score', role = 'scorekeeper') => service.getGamePermissions({ gameId, tournamentId: 'tour', userId, role });
  return { service, controller, assign, permissions };
}

test('tournament authorization alone neither assigns games nor permits scoring or team-sheet access', () => {
  const e = setup();
  assert.deepEqual(e.controller.listOfficialGames('score', 'scorekeeper').games, []);
  assert.equal(e.permissions().canOfficialWrite, false);
  assert.deepEqual(e.service.getGameAuthorization('game-1', 'tour').effectiveScorekeeperIds, []);
  bad(() => e.service.getTeamSheets('game-1', 'tour', 'score', 'scorekeeper'), 403);
  bad(() => e.service.submitOfficialUpdate({ gameId: 'game-1', tournamentId: 'tour', actorId: 'score',
    actorRole: 'scorekeeper', patch: {}, playEvent: { type: 'BALL' } }), 403);
  assert.equal(e.permissions('game-1', 'org', 'organizer').canOfficialWrite, true);
});

test('assignment lists only the configured assigned game and preserves fixed metadata', () => {
  const e = setup();
  e.service.configureGameDetails({ gameId: 'game-1', tournamentId: 'tour', organizerId: 'org', details });
  e.assign(['score']);
  e.service.getOfficialState('phantom', 'tour');
  const catalog = readOfficialGames(e.controller.listOfficialGames('score', 'scorekeeper'), 'score', 'scorekeeper');
  assert.equal(catalog.games.length, 1);
  assert.equal(catalog.games[0].gameId, 'game-1');
  assert.deepEqual(catalog.games[0].details, details);
  assert.equal(catalog.games[0].status, 'scheduled');
  assert.equal(e.permissions().canOfficialWrite, true);
  assert.equal(e.permissions('game-2').canOfficialWrite, false);
  assert.equal(e.service.getTeamSheets('game-1', 'tour', 'score', 'scorekeeper').canDecide, true);
  assert.deepEqual(e.controller.listOfficialGames('other', 'scorekeeper').games, []);
  catalog.games[0].details.homeTeamName = 'Changed outside';
  assert.equal(e.controller.listOfficialGames('score', 'scorekeeper').games[0].details.homeTeamName, details.homeTeamName);
});

test('only the owning organizer lists and assigns its games; observers cannot use assignment endpoints', () => {
  const e = setup();
  assert.equal(e.controller.listOfficialGames('org', 'organizer').games.length, 2);
  assert.deepEqual(e.controller.listOfficialGames('stranger', 'organizer').games, []);
  for (const role of ['fan', 'player', 'scout']) bad(() => e.controller.listOfficialGames('org', role), 403);
  assert.deepEqual(e.controller.listOfficialGames('org', 'manager').games, []);
  bad(() => e.controller.listOfficialGames('org', 'unknown'), 400);
  bad(() => e.controller.listOfficialGames('', 'scorekeeper'), 400);
  bad(() => e.assign(['score'], 'game-1', 'stranger'), 403);
  bad(() => e.assign(['not-authorized']), 400);
  assert.equal(e.permissions().canOfficialWrite, false);
});

test('revocation and reassignment immediately remove writes and notify team-sheet observers without changing scores', () => {
  const e = setup();
  e.assign(['score']);
  const before = structuredClone(e.service.getOfficialState('game-1', 'tour'));
  let streamError = null;
  const subscription = e.service.createTeamSheetStream('game-1', 'tour', 'score', 'scorekeeper').subscribe({
    error: error => { streamError = error; }
  });
  e.assign(['other']);
  assert.equal(streamError.getStatus(), 403);
  subscription.unsubscribe();
  assert.equal(e.permissions().canOfficialWrite, false);
  assert.equal(e.permissions('game-1', 'other').canOfficialWrite, true);
  assert.deepEqual(e.controller.listOfficialGames('score', 'scorekeeper').games, []);
  assert.equal(e.controller.listOfficialGames('other', 'scorekeeper').games.length, 1);
  assert.deepEqual(e.service.getOfficialState('game-1', 'tour'), before);
  e.assign([]);
  assert.equal(e.permissions('game-1', 'other').canOfficialWrite, false);
});

test('removing tournament authorization overrides a previous per-game assignment', () => {
  const e = setup();
  e.assign(['score']);
  e.service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['other'] });
  assert.equal(e.permissions().canOfficialWrite, false);
  assert.deepEqual(e.service.getGameAuthorization('game-1', 'tour').effectiveScorekeeperIds, []);
  assert.deepEqual(e.controller.listOfficialGames('score', 'scorekeeper').games, []);
});

test('games and organizer privileges do not leak between tournaments', () => {
  const e = setup();
  e.assign(['score']);
  e.service.configureTournamentAuthorization({ tournamentId: 'other-tour', organizerId: 'other-org', organizerIdentificationNumber: 'OTHERORG1000', scorekeeperIds: ['score'] });
  for (const teamId of ['home', 'away']) e.service.configureTournamentTeamRoster({
    tournamentId: 'other-tour', organizerId: 'other-org', teamId, managerId: `mgr-${teamId}`,
    playerIdentificationNumbers: [`PLAYER${teamId}`]
  });
  e.service.configureGameTeams({ gameId: 'other-game', tournamentId: 'other-tour', organizerId: 'other-org', homeTeamId: 'home', awayTeamId: 'away' });
  assert.deepEqual(e.controller.listOfficialGames('score', 'scorekeeper').games.map(game => game.gameId), ['game-1']);
  assert.deepEqual(e.controller.listOfficialGames('org', 'organizer').games.map(game => game.gameId), ['game-1', 'game-2']);
  assert.deepEqual(e.controller.listOfficialGames('other-org', 'organizer').games.map(game => game.gameId), ['other-game']);
  bad(() => e.service.configureGameAuthorization({ gameId: 'other-game', tournamentId: 'other-tour', organizerId: 'org', scorekeeperIds: ['score'] }), 403);
  e.service.configureGameAuthorization({ gameId: 'other-game', tournamentId: 'other-tour', organizerId: 'other-org', scorekeeperIds: ['score'] });
  assert.deepEqual(e.controller.listOfficialGames('score', 'scorekeeper').games.map(game => game.tournamentId), ['tour', 'other-tour']);
});

test('schedule metadata rejects invalid dates, fields and non-organizer edits', () => {
  const e = setup();
  bad(() => e.controller.configureGameDetails('game-1', { tournamentId: 'tour', organizerId: 'score', details }), 403);
  for (const invalid of [{ ...details, date: '2026-02-29' }, { ...details, time: '25:00' }, { ...details, venue: '' }, null]) {
    assert.equal(isOfficialGameDetails(invalid), false);
    bad(() => e.controller.configureGameDetails('game-1', { tournamentId: 'tour', organizerId: 'org', details: invalid }), 400);
  }
  assert.equal(e.controller.listOfficialGames('org', 'organizer').games[0].details, null);
});
test('official venue territory is optional for old games, but must be a real state/municipality pair when supplied', () => {
  const e = setup();
  assert.equal(isOfficialGameDetails(details), true);
  for (const location of [
    { stateId: 'VE-A', municipalityId: 'VE-A:libertador' },
    { stateId: 'VE-D', municipalityId: 'VE-D:girardot' }
  ]) {
    const located = { ...details, ...location };
    e.controller.configureGameDetails('game-1', { tournamentId: 'tour', organizerId: 'org', details: located });
    assert.deepEqual(e.controller.listOfficialGames('org', 'organizer').games[0].details, located);
    assert.deepEqual(e.service.getOfficialStandings().games.find(game => game.gameId === 'game-1').details, located);
  }
  for (const location of [{ stateId: 'VE-A' }, { municipalityId: 'VE-A:libertador' },
    { stateId: 'VE-A', municipalityId: 'VE-D:girardot' }, { stateId: 'UNKNOWN', municipalityId: '' }]) {
    assert.equal(isOfficialGameDetails({ ...details, ...location }), false);
    bad(() => e.controller.configureGameDetails('game-1', { tournamentId: 'tour', organizerId: 'org', details: { ...details, ...location } }), 400);
  }
});

test('catalog reader rejects foreign identities, unassigned games, malformed statuses and corrupt scores', () => {
  const e = setup();
  e.assign(['score']);
  const catalog = e.controller.listOfficialGames('score', 'scorekeeper');
  for (const invalid of [null, { ...catalog, userId: 'other' }, { ...catalog, role: 'organizer' },
    { ...catalog, games: [...catalog.games, ...catalog.games] }]) {
    assert.throws(() => readOfficialGames(invalid, 'score', 'scorekeeper'), /datos inválidos/);
  }
  for (const patch of [{ assignedScorekeeperIds: [] }, { status: ['scheduled'] }, { homeScore: -1 },
    { details: { ...details, date: 'wrong' } }, { availableScorekeeperIds: [] }, { scoringBlockReason: true }, { scoringBlockReason: '' }]) {
    assert.throws(() => readOfficialGames({ ...catalog, games: [{ ...catalog.games[0], ...patch }] }, 'score', 'scorekeeper'), /datos inválidos/);
  }
});

test('manager catalogs contain only their participating team and reuse the existing manager identity checks', () => {
  const e = setup();
  e.service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'PLAYERC', displayName: 'Jugador tercero' } });
  e.service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId: 'third', managerId: 'mgr-third',
    managerIdentificationNumber: 'MANAGERTHIRD', playerIdentificationNumbers: ['PLAYERC'] });
  e.service.configureGameTeams({ tournamentId: 'tour', organizerId: 'org', gameId: 'other-game', homeTeamId: 'away', awayTeamId: 'third' });
  e.service.getOfficialState('unconfigured', 'tour');
  const home = readOfficialGames(e.controller.listOfficialGames('mgr-home', 'manager'), 'mgr-home', 'manager');
  assert.deepEqual(home.games.map(g => [g.gameId, g.managerTeamId]), [['game-1', 'home'], ['game-2', 'home']]);
  const away = readOfficialGames(e.controller.listOfficialGames('mgr-away', 'manager'), 'mgr-away', 'manager');
  assert.deepEqual(away.games.map(g => g.gameId), ['game-1', 'game-2', 'other-game']);
  assert.ok(away.games.every(g => g.managerTeamId === 'away'));
  assert.deepEqual(e.controller.listOfficialGames('stranger', 'manager').games, []);
  assert.equal(e.permissions('game-1', 'mgr-home', 'manager').canOfficialWrite, false);
  assert.equal(e.service.getTeamSheets('game-1', 'tour', 'mgr-home', 'manager').ownTeamId, home.games[0].managerTeamId);
  assert.equal(e.service.getTeamSheets('game-1', 'tour', 'mgr-home', 'manager').canDecide, false);
  bad(() => e.service.getTeamSheets('other-game', 'tour', 'mgr-home', 'manager'), 403);
  bad(() => e.service.submitOfficialUpdate({ gameId: 'game-1', tournamentId: 'tour', actorId: 'mgr-home', actorRole: 'manager',
    patch: { homeScore: 99 } }), 403);
  bad(() => e.service.suspendGame({ gameId: 'game-1', tournamentId: 'tour', actorId: 'mgr-home', actorRole: 'manager',
    cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia', expectedOfficialVersion: 0 }), 403);
  bad(() => e.service.rescheduleGame({ gameId: 'game-1', tournamentId: 'tour', organizerId: 'mgr-home',
    date: '2026-11-12', time: '18:00', expectedOfficialVersion: 0 }), 403);
  bad(() => e.assign(['score'], 'game-1', 'mgr-home'), 403);
});
test('manager catalogs support several tournaments without confusing the assigned side', () => {
  const e = setup();
  e.service.configureTournamentAuthorization({ tournamentId: 'tour-two', organizerId: 'org', organizerIdentificationNumber: 'ORG1000', scorekeeperIds: [] });
  for (const teamId of ['away', 'third']) e.service.configureTournamentTeamRoster({ tournamentId: 'tour-two', organizerId: 'org',
    teamId, managerId: teamId === 'third' ? 'mgr-home' : 'mgr-away', managerIdentificationNumber: teamId === 'third' ? 'MANAGERhome' : 'MANAGERaway',
    playerIdentificationNumbers: [teamId === 'third' ? 'PLAYERhome' : 'PLAYERaway'] });
  e.service.configureGameTeams({ tournamentId: 'tour-two', organizerId: 'org', gameId: 'tour-two-game', homeTeamId: 'away', awayTeamId: 'third' });
  const games = readOfficialGames(e.controller.listOfficialGames('mgr-home', 'manager'), 'mgr-home', 'manager').games;
  assert.deepEqual(games.map(g => [g.gameId, g.tournamentId, g.managerTeamId]),
    [['game-1','tour','home'], ['game-2','tour','home'], ['tour-two-game','tour-two','third']]);
});
test('manager catalog parsing rejects missing or foreign own-team metadata instead of opening a default game', () => {
  const e = setup();
  const catalog = e.controller.listOfficialGames('mgr-home', 'manager');
  for (const managerTeamId of [undefined, '', 'third']) assert.throws(() => readOfficialGames({
    ...catalog, games: [{ ...catalog.games[0], managerTeamId }]
  }, 'mgr-home', 'manager'), /datos inválidos/);
  assert.throws(() => readOfficialGames(catalog, 'mgr-away', 'manager'), /datos inválidos/);
});
