const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { NestFactory } = require('@nestjs/core');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { calculateOfficialStandings, readOfficialStandingGames, readOfficialGames, currentAssignedGame, isGameProtest,
  officialGameResult, readOfficialObservation } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') }));

function setup() {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000',
    scorekeeperIds: ['score', 'other'], scorekeeperIdentities: [
      { actorId: 'score', identificationNumber: 'SCORE1000' }, { actorId: 'other', identificationNumber: 'OTHER1000' }
    ] });
  for (const teamId of ['home', 'away']) {
    for (let i = 0; i < 9; i++) service.registerGlobalPlayer({ actorId: 'org',
      player: { identificationNumber: `${teamId}${i}`, displayName: `Jugador ${teamId}${i}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `${teamId}${i}`) });
  }
  for (const gameId of ['one', 'two']) {
    service.configureGameTeams({ gameId, tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
    service.configureGameAuthorization({ gameId, tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
    service.configureGameDetails({ gameId, tournamentId: 'tour', organizerId: 'org',
      details: { tournamentName: 'Torneo de prueba', homeTeamName: 'Locales', awayTeamName: 'Visitantes',
        date: '2026-11-05', time: '18:00', venue: 'Estadio de prueba' } });
    for (const teamId of ['home', 'away']) service.configureGameLineup({ gameId, tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
      lineupEntries: Array.from({ length: 9 }, (_, i) => ({ identificationNumber: `${teamId}${i}`, battingOrder: i + 1,
        fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i] })) });
  }
  const state = (id = 'one') => structuredClone(service.getOfficialState(id, 'tour'));
  const send = (operation, id = 'one') => service.submitOfficialUpdate({ gameId: id, tournamentId: 'tour', actorId: 'score',
    actorRole: 'scorekeeper', expectedOfficialVersion: state(id).state.officialVersion, patch: {}, ...operation });
  const declaration = () => ({ gameId: 'one', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    expectedOfficialVersion: state().state.officialVersion, teamId: 'home', reason: 'Aplicación de la regla cuestionada.' });
  const decision = () => ({ gameId: 'one', tournamentId: 'tour', organizerId: 'org',
    expectedOfficialVersion: state().state.officialVersion, winnerTeamId: 'away',
    reason: 'La mesa técnica adjudica el juego al visitante.', recordReference: 'Acta ficticia MT-001' });
  const start = () => send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  const protest = () => service.declareGameProtest(declaration());
  return { service, state, send, declaration, decision, start, protest };
}
test('protest freezes the exact scoring moment, preserves plays and releases the active scoring slot', t => {
  const e = setup(); e.start();
  const before = e.state();
  t.mock.timers.tick(2500);
  const result = e.protest();
  assert.equal(result.state.status, 'protested');
  assert.equal(result.state.officialVersion, before.state.officialVersion + 1);
  assert.equal(isGameProtest(result.state.protest), true);
  const frozen = structuredClone(before.playByPlay);
  frozen.scorecard.clock = { ...frozen.scorecard.clock, runningSince: null, elapsedMs: 2500 };
  assert.deepEqual(result.playByPlay, frozen);
  assert.deepEqual(result.state.clock, frozen.scorecard.clock);
  assert.equal(result.state.protest.moment.balls, 1);
  assert.equal(result.state.protest.moment.officialVersion, before.state.officialVersion);
  const catalog = readOfficialGames(e.service.listOfficialGames('score', 'scorekeeper'), 'score', 'scorekeeper');
  assert.equal(catalog.games.find(game => game.gameId === 'one').status, 'protested');
  assert.match(catalog.games.find(game => game.gameId === 'one').scoringBlockReason, /protesta/);
  assert.equal(currentAssignedGame([catalog.games.find(game => game.gameId === 'one')]).game, null);
  e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }, 'two');
  assert.equal(e.state('two').state.status, 'in_progress');
});
test('only an assigned scorekeeper can protest an ongoing game with valid team, reason and current version', () => {
  const e = setup();
  bad(() => e.protest(), 409);
  e.start();
  const before = e.state();
  for (const patch of [{ actorId: 'other' }, { actorId: 'org', actorRole: 'organizer' }, { actorRole: 'manager' }]) {
    bad(() => e.service.declareGameProtest({ ...e.declaration(), ...patch }), 403);
  }
  for (const patch of [{ teamId: 'stranger' }, { reason: ' ' }, { reason: 'x'.repeat(2001) }, { expectedOfficialVersion: undefined }]) {
    bad(() => e.service.declareGameProtest({ ...e.declaration(), ...patch }), 400);
  }
  bad(() => e.service.declareGameProtest({ ...e.declaration(), expectedOfficialVersion: 0 }), 409);
  assert.deepEqual(e.state(), before);
});
test('protest rejects every scoring update, including undo, patch and administrative run changes', () => {
  const e = setup(); e.start(); e.protest();
  const before = e.state();
  for (const operation of [
    { undoLast: true }, { patch: { status: 'in_progress' } }, { patch: { homeScore: 100 } },
    { scorecardCommand: { kind: 'finish' } }, { scorecardCommand: { kind: 'pitch', value: 'ball' } },
    { regulationInnings: 9 }, { lastErrorOuts: 1 }, { playEvent: { type: 'BALL' } }, { runReview: {} }
  ]) bad(() => e.send(operation), 409);
  bad(() => e.protest(), 409);
  const revision = e.service.getTeamSheets('one', 'tour', 'score', 'scorekeeper').sheets[0].revision;
  bad(() => e.service.recordPersonnelChange({ gameId: 'one', tournamentId: 'tour', teamId: 'home', actorId: 'score',
    actorRole: 'scorekeeper', expectedRevision: revision, expectedOfficialVersion: before.state.officialVersion,
    action: { kind: 'defense', identificationNumber: 'home0', fieldPosition: 'C' } }), 409);
  bad(() => e.service.configureGameDetails({ gameId: 'one', tournamentId: 'tour', organizerId: 'org',
    details: e.service.listOfficialGames('org', 'organizer').games.find(game => game.gameId === 'one').details }), 409);
  bad(() => e.service.authorizeFieldRepresentative({ gameId: 'one', tournamentId: 'tour', teamId: 'home',
    managerId: 'mgr-home', identificationNumber: 'home0' }), 409);
  assert.deepEqual(e.state(), before);
});
test('only the owning organizer may record a complete, versioned technical decision', () => {
  const e = setup(); e.start(); e.protest();
  const before = e.state();
  for (const organizerId of ['score', 'other', 'stranger']) bad(() => e.service.resolveGameProtest({ ...e.decision(), organizerId }), 403);
  for (const patch of [{ winnerTeamId: 'stranger' }, { reason: '' }, { recordReference: '' }, { reason: 'x'.repeat(4001) },
    { recordReference: 'x'.repeat(501) }, { expectedOfficialVersion: undefined }]) {
    bad(() => e.service.resolveGameProtest({ ...e.decision(), ...patch }), 400);
  }
  bad(() => e.service.resolveGameProtest({ ...e.decision(), expectedOfficialVersion: 0 }), 409);
  assert.deepEqual(e.state(), before);
});
test('a technical decision awards win/loss without fabricating runs and cannot be undone or overwritten', () => {
  const e = setup(); e.start(); e.protest();
  const before = e.state();
  const pending = calculateOfficialStandings(readOfficialStandingGames(e.service.getOfficialStandings()))[0];
  assert.equal(pending.pendingProtests, 1);
  assert.ok(pending.rows.every(row => row.played === 0 && row.wins === 0 && row.losses === 0));
  const resolved = e.service.resolveGameProtest(e.decision());
  assert.equal(resolved.state.status, 'final');
  assert.equal(resolved.state.protest.resolution.winnerTeamId, 'away');
  assert.equal(resolved.state.protest.resolution.loserTeamId, 'home');
  assert.equal(resolved.state.protest.resolution.recordedBy, 'org');
  assert.deepEqual(resolved.playByPlay.scorecard.log, before.playByPlay.scorecard.log);
  assert.deepEqual(resolved.playByPlay.runAccounting, before.playByPlay.runAccounting);
  assert.equal(resolved.state.homeScore, before.state.homeScore);
  assert.equal(resolved.state.awayScore, before.state.awayScore);
  const table = calculateOfficialStandings(readOfficialStandingGames(e.service.getOfficialStandings()))[0];
  assert.equal(table.pendingProtests, 0);
  assert.equal(table.rows.find(row => row.team === 'away').wins, 1);
  assert.equal(table.rows.find(row => row.team === 'home').losses, 1);
  assert.ok(table.rows.every(row => row.runsFor === 0 && row.runsAgainst === 0));
  assert.equal(table.rows[0].results[0].technicalDecision, true);
  bad(() => e.send({ undoLast: true }), 409);
  bad(() => e.service.resolveGameProtest(e.decision()), 409);
  assert.deepEqual(e.state(), resolved);
});
test('one decision propagates to public, manager, organizer, scorekeeper and tables even when the winner trails in runs', () => {
  const e = setup(); e.start();
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  for (let i = 0; i < 3; i++) e.send({ scorecardCommand: { kind: 'play', result: 'flyOut' } });
  for (let i = 0; i < 5; i++) e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  e.protest();
  const before = e.state();
  assert.equal(before.state.homeScore, 5);
  assert.equal(before.state.awayScore, 1);
  assert.equal(before.playByPlay.scorecard.finished, false);
  e.service.resolveGameProtest(e.decision());
  const publicGame = readOfficialStandingGames(e.service.getOfficialStandings()).find(game => game.gameId === 'one');
  for (const [id, role] of [['org', 'organizer'], ['score', 'scorekeeper']]) {
    const game = readOfficialGames(e.service.listOfficialGames(id, role), id, role).games.find(game => game.gameId === 'one');
    assert.equal(officialGameResult(game).winnerTeamId, 'away');
    assert.deepEqual(game.protest, publicGame.protest);
  }
  const observed = readOfficialObservation(e.state());
  assert.equal(observed.status, 'final');
  assert.equal(observed.protest.resolution.winnerTeamId, 'away');
  assert.equal(observed.scorecard.finished, true);
  assert.deepEqual(observed.scorecard, { ...before.playByPlay.scorecard, finished: true });
  for (const teamId of ['home', 'away']) assert.equal(e.service.getTeamSheets('one', 'tour', `mgr-${teamId}`, 'manager').canDecide, false);
  const table = calculateOfficialStandings([publicGame])[0];
  assert.equal(table.rows[0].team, officialGameResult(publicGame).winnerTeamId);
  assert.deepEqual(table.rows.map(row => [row.team, row.wins, row.losses, row.runsFor, row.runsAgainst]),
    [['away', 1, 0, 1, 5], ['home', 0, 1, 5, 1]]);
});
test('HTTP protest and resolution routes enforce the same lifecycle and expose public standings', async t => {
  const e = setup(); e.start();
  const account = await require('./sporting-account-fixture.cjs')(t);
  const app = await NestFactory.create({ module: class ProtestTestModule {},
    controllers: [OfficialScoringController], providers: [account.provider, { provide: OfficialScoringService, useValue: e.service }] }, { logger: false });
  account.manage(app);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/official-scoring';
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/games/one/protest', e.declaration())).status, 201);
  assert.equal((await post('/games/one/protest/decision', { ...e.decision(), organizerId: 'score' })).status, 403);
  assert.equal((await post('/games/one/protest/decision', e.decision())).status, 201);
  const response = await fetch(base + '/standings');
  assert.equal(response.status, 200);
  const table = calculateOfficialStandings(readOfficialStandingGames(await response.json()))[0];
  assert.equal(table.rows.find(row => row.team === 'away').wins, 1);
});
