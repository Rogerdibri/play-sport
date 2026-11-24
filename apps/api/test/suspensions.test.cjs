const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { NestFactory } = require('@nestjs/core');
const { readOfficialGames, readOfficialObservation, readOfficialInterruptionArchive, readOfficialStandingGames, calculateOfficialStandings, currentAssignedGame, isGameSuspension } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, e => e.getStatus?.() === status);
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') }));
function setup(scorer = { actorId: 'score', identificationNumber: 'SCORE1000' }) {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000',
    scorekeeperIds: [scorer.actorId, 'other'], scorekeeperIdentities: [scorer, { actorId: 'other', identificationNumber: 'OTHER1000' }] });
  for (const teamId of ['home', 'away']) {
    for (let i = 0; i < 9; i++) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: `${teamId}${i}`, displayName: `Jugador ${teamId}${i}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `${teamId}${i}`) });
  }
  for (const gameId of ['one', 'two']) {
    service.configureGameTeams({ gameId, tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
    service.configureGameAuthorization({ gameId, tournamentId: 'tour', organizerId: 'org', scorekeeperIds: [scorer.actorId] });
    service.configureGameDetails({ gameId, tournamentId: 'tour', organizerId: 'org', details: { tournamentName: 'Prueba', homeTeamName: 'Locales',
      awayTeamName: 'Visitantes', date: '2026-11-05', time: '18:00', venue: 'Estadio', stateId: 'VE-A', municipalityId: 'VE-A:libertador' } });
    for (const teamId of ['home', 'away']) service.configureGameLineup({ gameId, tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
      lineupEntries: Array.from({ length: 9 }, (_, i) => ({ identificationNumber: `${teamId}${i}`, battingOrder: i + 1,
        jerseyNumber: String(i + 1), fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i] })) });
  }
  const state = (gameId = 'one') => structuredClone(service.getOfficialState(gameId, 'tour'));
  const send = (operation, gameId = 'one') => service.submitOfficialUpdate({ gameId, tournamentId: 'tour', actorId: scorer.actorId, actorRole: 'scorekeeper',
    expectedOfficialVersion: state(gameId).state.officialVersion, patch: {}, ...operation });
  const suspend = (patch = {}) => service.suspendGame({ gameId: 'one', tournamentId: 'tour', actorId: scorer.actorId, actorRole: 'scorekeeper',
    expectedOfficialVersion: state().state.officialVersion, cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia intensa', ...patch });
  const reschedule = (patch = {}) => service.rescheduleGame({ gameId: 'one', tournamentId: 'tour', organizerId: 'org',
    expectedOfficialVersion: state().state.officialVersion, date: '2026-11-12', time: '19:30', ...patch });
  return { service, state, send, suspend, reschedule };
}
test('keeping freezes scoring, archives it independently, releases the scorer and resumes the exact moment', t => {
  const e = setup();
  e.send({ scorecardCommand: { kind: 'play', result: 'single' } });
  e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  const before = e.state();
  t.mock.timers.tick(2500);
  const frozen = structuredClone(before);
  frozen.state.clock = { ...before.state.clock, runningSince: null, elapsedMs: 2500 };
  frozen.playByPlay.scorecard.clock = structuredClone(frozen.state.clock);
  const result = e.suspend();
  assert.equal(result.state.status, 'suspended'); assert.equal(result.state.officialVersion, before.state.officialVersion + 1);
  assert.equal(isGameSuspension(result.state.suspension), true);
  assert.equal(result.state.suspension.rescheduled, null);
  assert.deepEqual(result.playByPlay.scorecard, frozen.playByPlay.scorecard);
  const archive = e.service.suspensionArchive('one', 'tour', result.state.suspension.id);
  assert.deepEqual(readOfficialInterruptionArchive(archive).observation.scorecard, frozen.playByPlay.scorecard);
  assert.deepEqual(archive.playByPlay, frozen.playByPlay); assert.deepEqual(archive.state, frozen.state);
  archive.state.homeScore = 99; archive.playByPlay.scorecard.outs = 2;
  assert.deepEqual(e.service.suspensionArchive('one', 'tour', result.state.suspension.id).state, frozen.state);
  const catalog = readOfficialGames(e.service.listOfficialGames('score', 'scorekeeper'), 'score', 'scorekeeper');
  assert.equal(currentAssignedGame([catalog.games.find(g => g.gameId === 'one')]).game, null);
  assert.match(catalog.games.find(g => g.gameId === 'one').scoringBlockReason, /suspendido/i);
  e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }, 'two');
  e.service.suspendGame({ gameId: 'two', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: e.state('two').state.officialVersion, cause: 'force-majeure', scoreHandling: 'keep', reason: 'Cierre de sede' });
  const scheduled = e.reschedule(); assert.equal(scheduled.state.status, 'scheduled');
  assert.deepEqual(scheduled.playByPlay.scorecard, frozen.playByPlay.scorecard);
  t.mock.timers.tick(60000);
  bad(() => e.send({ undoLast: true }), 400);
  const resumed = e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  assert.equal(resumed.state.balls, 2); assert.equal(resumed.state.nextBatterId, before.state.nextBatterId);
  assert.equal(resumed.state.status, 'in_progress');
  assert.equal(resumed.state.clock.elapsedMs, 2500);
  assert.equal(resumed.state.clock.runningSince, new Date().toISOString());
});
test('full reset clears counters, bases, log, all statistics and batting indexes without losing approved personnel', t => {
  const e = setup();
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'single' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'groundOut' } });
  e.send({ scorecardCommand: { kind: 'pitch', value: 'strike' } });
  const before = e.state();
  assert.ok(before.playByPlay.totalEvents > 0); assert.equal(before.state.awayScore, 1);
  const sheets = e.service.getTeamSheets('one', 'tour', 'org', 'organizer').sheets;
  t.mock.timers.tick(1500);
  const frozen = structuredClone(before.playByPlay);
  frozen.scorecard.clock = { ...frozen.scorecard.clock, runningSince: null, elapsedMs: 1500 };
  const result = e.suspend({ scoreHandling: 'reset', actorId: 'org', actorRole: 'organizer' });
  assert.deepEqual([result.state.inning, result.state.outs, result.state.balls, result.state.strikes, result.state.homeScore, result.state.awayScore], [1,0,0,0,0,0]);
  assert.equal(result.state.lastBatterId, null); assert.equal(result.state.nextBatterId, 'AWAY0');
  const fresh = e.state('two').playByPlay;
  for (const key of Object.keys(fresh)) assert.deepEqual(result.playByPlay[key], fresh[key], key);
  assert.deepEqual(e.service.getTeamSheets('one', 'tour', 'org', 'organizer').sheets, sheets);
  assert.deepEqual(e.service.suspensionArchive('one', 'tour', result.state.suspension.id).playByPlay, frozen);
  e.reschedule(); bad(() => e.send({ undoLast: true }), 400);
  const first = e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  assert.equal(first.state.nextBatterId, 'AWAY0'); assert.equal(first.state.balls, 1);
});
test('suspension rejects unauthorized actors, invalid causes or decisions and stale versions atomically', () => {
  const e = setup(); const before = e.state();
  for (const patch of [{ actorId: 'other' }, { actorId: 'org', actorRole: 'scorekeeper' }, { actorId: 'score', actorRole: 'organizer' },
    ...['fan', 'player', 'manager', 'scout'].map(actorRole => ({ actorRole }))]) bad(() => e.suspend(patch), 403);
  for (const patch of [{ cause: 'other' }, { scoreHandling: '' }, { reason: ' ' }, { reason: 'x'.repeat(2001) },
    { expectedOfficialVersion: undefined }]) bad(() => e.suspend(patch), 400);
  bad(() => e.suspend({ expectedOfficialVersion: 0 }), 409);
  assert.deepEqual(e.state(), before);
});
test('suspended games reject every scoring path, personnel edits, metadata changes and forged status patches', () => {
  const e = setup(); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }); e.suspend();
  const before = e.state();
  for (const operation of [{ undoLast: true }, { patch: { status: 'in_progress' } }, { patch: { homeScore: 100 } },
    { scorecardCommand: { kind: 'finish' } }, { scorecardCommand: { kind: 'pitch', value: 'ball' } },
    { regulationInnings: 9 }, { lastErrorOuts: 1 }, { playEvent: { type: 'BALL' } }, { runReview: {} }]) bad(() => e.send(operation), 409);
  bad(() => e.suspend(), 409);
  const revision = e.service.getTeamSheets('one', 'tour', 'score', 'scorekeeper').sheets[0].revision;
  bad(() => e.service.recordPersonnelChange({ gameId: 'one', tournamentId: 'tour', teamId: 'home', actorId: 'score',
    actorRole: 'scorekeeper', expectedRevision: revision, expectedOfficialVersion: before.state.officialVersion,
    action: { kind: 'defense', identificationNumber: 'home0', fieldPosition: 'C' } }), 409);
  bad(() => e.service.configureGameDetails({ gameId: 'one', tournamentId: 'tour', organizerId: 'org',
    details: e.service.listOfficialGames('org', 'organizer').games[0].details }), 409);
  assert.deepEqual(e.state(), before);
});
test('only the organizer may set a valid new date; schedules and repeated interruption history remain traceable', () => {
  const e = setup(); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }); e.suspend();
  const before = e.state();
  for (const organizerId of ['score', 'other']) bad(() => e.reschedule({ organizerId }), 403);
  for (const patch of [{ date: '2026-02-30' }, { time: '25:00' }, { expectedOfficialVersion: undefined }]) bad(() => e.reschedule(patch), 400);
  bad(() => e.reschedule({ expectedOfficialVersion: 0 }), 409);
  assert.deepEqual(e.state(), before);
  const scheduled = e.reschedule();
  assert.equal(scheduled.state.suspension.originalDate, '2026-11-05');
  const details = e.service.listOfficialGames('org', 'organizer').games.find(g => g.gameId === 'one').details;
  assert.equal(details.date, '2026-11-12'); assert.equal(details.time, '19:30');
  assert.equal(e.service.suspensionArchive('one', 'tour').interruptions[0].rescheduled.recordedBy, 'org');
  assert.equal(e.suspend().state.suspension.wasStarted, true);
  const history = e.service.suspensionArchive('one', 'tour').interruptions;
  assert.equal(history.length, 2); assert.equal(history[1].originalDate, '2026-11-12');
  bad(() => e.service.suspensionArchive('one', 'tour', 'unknown'), 404);
});
test('public observations and standings transport suspension but do not count a suspended score as a win', () => {
  const e = setup(); e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } }); e.suspend();
  assert.equal(readOfficialObservation(e.state()).suspension.reason, 'Lluvia intensa');
  const games = readOfficialStandingGames(e.service.getOfficialStandings());
  assert.equal(games.find(g => g.gameId === 'one').suspension.rescheduled, null);
  const table = calculateOfficialStandings(games)[0];
  assert.ok(table.rows.every(r => r.wins === 0 && r.losses === 0));
  const malformed = e.state(); delete malformed.state.suspension;
  assert.throws(() => readOfficialObservation(malformed));
});
test('protested and final games cannot be suspended or reopened through rescheduling', () => {
  const e = setup(); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  e.service.declareGameProtest({ gameId: 'one', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    expectedOfficialVersion: e.state().state.officialVersion, teamId: 'home', reason: 'Regla cuestionada' });
  bad(() => e.suspend(), 409); bad(() => e.reschedule(), 409);
  e.service.resolveGameProtest({ gameId: 'one', tournamentId: 'tour', organizerId: 'org',
    expectedOfficialVersion: e.state().state.officialVersion, winnerTeamId: 'away', reason: 'Decisión', recordReference: 'Acta 1' });
  bad(() => e.suspend(), 409); bad(() => e.reschedule(), 409);
  const other = setup();
  bad(() => other.send({ patch: { status: 'suspended' } }), 400);
  assert.equal(other.state().state.status, 'scheduled');
});
test('HTTP suspension, read-only archive and organizer rescheduling use validated versioned routes', async t => {
  const account = await require('./sporting-account-fixture.cjs')(t);
  const scorer = await account.verifiedScorekeeper();
  const e = setup(scorer); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  const app = await NestFactory.create({ module: class SuspensionTestModule {}, controllers: [OfficialScoringController],
    providers: [account.provider, { provide: OfficialScoringService, useValue: e.service }] }, { logger: false });
  account.manage(app);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/official-scoring/games/one';
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const body = { tournamentId: 'tour', actorId: scorer.actorId, actorRole: 'scorekeeper', expectedOfficialVersion: e.state().state.officialVersion,
    cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia' };
  assert.equal((await post('/suspension', { ...body, actorId: 'other' })).status, 403);
  const response = await post('/suspension', body);
  assert.equal(response.status, 201);
  const suspended = readOfficialObservation(await response.json()); assert.equal(suspended.status, 'suspended');
  const archived = await fetch(`${base}/suspension-archive?tournamentId=tour&id=${encodeURIComponent(suspended.suspension.id)}`);
  assert.equal(archived.status, 200);
  assert.equal(readOfficialInterruptionArchive(await archived.json()).observation.balls, 1);
  assert.equal((await post('/suspension-archive', body)).status, 404);
  const schedule = { tournamentId: 'tour', organizerId: 'org', expectedOfficialVersion: suspended.officialVersion, date: '2026-11-12', time: '19:30' };
  assert.equal((await post('/reschedule', { ...schedule, organizerId: 'score' })).status, 403);
  assert.equal((await post('/reschedule', schedule)).status, 201);
  assert.equal(e.state().state.balls, 1); assert.equal(e.state().state.status, 'scheduled');
});
