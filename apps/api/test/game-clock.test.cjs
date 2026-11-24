const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { changeGameClock, pauseGameClock, gameClockElapsed, formatGameClock, isGameClock, isTimedScoringCommand, startOrResumeGameClock, readPrivateSave } = require('@playsport/shared');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const start = '2026-11-13T01:00:00.000Z';
const at = seconds => new Date(Date.parse(start) + seconds * 1000).toISOString();
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-clock-')), path = join(dir, 'official.sqlite');
  let service = new OfficialScoringService(undefined, { path }), now = start;
  const setTime = value => { now = value; };
  const setClock = () => { service.nowIso = () => now; };
  setClock();
  t.after(() => { service.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); });
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['scorer'], scorekeeperIdentities: [{ actorId: 'scorer', identificationNumber: 'SCORER0001' }] });
  for (const teamId of ['home', 'away']) {
    const ids = Array.from({ length: 9 }, (_, i) => `${teamId.toUpperCase()}${i}`);
    for (const id of ids) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: id, displayName: `Jugador ${id}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['scorer'] });
  service.configureGameDetails({ gameId: 'game', tournamentId: 'tour', organizerId: 'org',
    details: { tournamentName: 'Copa de ejemplo', homeTeamName: 'Local', awayTeamName: 'Visitante', date: '2026-11-13', time: '10:00', venue: 'Campo de ejemplo' } });
  for (const teamId of ['home', 'away']) service.configureGameLineup({ gameId: 'game', tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
    lineupEntries: Array.from({ length: 9 }, (_, i) => ({ identificationNumber: `${teamId.toUpperCase()}${i}`, battingOrder: i + 1,
      fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i], jerseyNumber: String(i + 1) })) });
  const get = () => structuredClone(service.getOfficialState('game', 'tour'));
  const send = (payload, actor = {}) => service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer',
    actorRole: 'scorekeeper', patch: {}, expectedOfficialVersion: get().state.officialVersion, ...payload, ...actor });
  return { get service() { return service; }, get, send, setTime,
    reopen() { service.onModuleDestroy(); service = new OfficialScoringService(undefined, { path }); setClock(); } };
}

test('clock rules exclude pauses, reject invalid transitions and support more than 24 hours', () => {
  const running = changeGameClock(undefined, 'start', start);
  assert.equal(gameClockElapsed(running, Date.parse(at(61))), 61000);
  const paused = changeGameClock(running, 'pause', at(61));
  assert.equal(gameClockElapsed(paused, Date.parse(at(500))), 61000);
  const resumed = changeGameClock(paused, 'resume', at(600));
  assert.equal(gameClockElapsed(resumed, Date.parse(at(602))), 63000);
  assert.equal(formatGameClock(90061000), '25:01:01');
  assert.equal(isGameClock({ ...running, elapsedMs: -1 }), false);
  assert.throws(() => changeGameClock(running, 'start', at(1)));
  assert.throws(() => changeGameClock(running, 'resume', at(1)));
  assert.throws(() => changeGameClock(undefined, 'resume', at(1)));
  assert.throws(() => changeGameClock(paused, 'pause', at(100)));
  assert.throws(() => changeGameClock(running, 'pause', at(-1)));
  assert.deepEqual(pauseGameClock(paused, at(100)), paused);
});

test('automatic clock transitions are idempotent and only actual scoring commands qualify', () => {
  const clock = startOrResumeGameClock(undefined, start);
  assert.equal(startOrResumeGameClock(clock, at(10)), clock);
  const paused = changeGameClock(clock, 'pause', at(20));
  const resumed = startOrResumeGameClock(paused, at(100));
  assert.equal(resumed.startedAt, start);
  assert.equal(resumed.elapsedMs, 20000);
  assert.equal(gameClockElapsed(resumed, Date.parse(at(105))), 25000);
  assert.equal(paused.runningSince, null);
  assert.throws(() => startOrResumeGameClock(paused, 'invalid'));
  for (const kind of ['pitch', 'play', 'runner', 'misplay']) assert.equal(isTimedScoringCommand({ kind }), true);
  for (const kind of ['rules', 'note', 'received-lineup', 'substitution', 'position', 'courtesy', 'run-review', 'finish'])
    assert.equal(isTimedScoringCommand({ kind }), false);
});

test('successful official scoring starts or resumes the clock atomically, never backdates pauses or rewinds on undo', t => {
  const e = fixture(t), initial = e.get(), stream = [];
  const subscription = e.service.createGameStream('game', 'tour').subscribe(event => stream.push(event));
  t.after(() => subscription.unsubscribe());
  bad(() => e.send({ scorecardCommand: { kind: 'play', result: 'error' } }), 400);
  assert.deepEqual(e.get(), initial);
  e.send({ scorecardCommand: { kind: 'rules', rules: 'baseball' } });
  assert.equal(e.get().state.clock, undefined);
  e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  assert.deepEqual(e.get().state.clock, { startedAt: start, runningSince: start, elapsedMs: 0 });
  assert.equal(stream.at(-1).state.clock.runningSince, start);
  e.setTime(at(10)); e.send({ scorecardCommand: { kind: 'pitch', value: 'strike' } });
  assert.equal(e.get().state.clock.runningSince, start);
  e.setTime(at(60)); e.send({ clockAction: 'pause' });
  const paused = e.get().state.clock;
  e.setTime(at(300));
  bad(() => e.send({ scorecardCommand: { kind: 'play', result: 'error' } }), 400);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }, { actorRole: 'manager' }), 403);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' }, expectedOfficialVersion: 0 }), 409);
  e.send({ regulationInnings: 9 });
  e.send({ undoLast: true });
  assert.deepEqual(e.get().state.clock, paused);
  e.setTime(at(600)); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  assert.deepEqual(e.get().state.clock, { ...paused, runningSince: at(600) });
  assert.equal(gameClockElapsed(e.get().state.clock, Date.parse(at(602))), 62000);
  e.send({ undoLast: true });
  assert.equal(e.get().state.clock.runningSince, at(600));
  e.reopen();
  assert.equal(e.get().state.clock.runningSince, at(600));
  assert.equal(e.get().state.clock.elapsedMs, 60000);
});

test('runner movements, errors and legacy scoring resume time, but corrections do not', t => {
  const e = fixture(t);
  const send = scorecardCommand => e.send({ scorecardCommand });
  send({ kind: 'play', result: 'single' });
  e.setTime(at(5)); e.send({ clockAction: 'pause' });
  e.setTime(at(100)); send({ kind: 'runner', action: 'steal', from: 1, to: 2 });
  assert.equal(e.get().state.clock.runningSince, at(100));
  e.setTime(at(105)); e.send({ clockAction: 'pause' });
  e.setTime(at(200)); send({ kind: 'misplay', errorOuts: 1, errors: [{ playerId: 'HOME1', position: 'C', type: 'fielding' }] });
  assert.equal(e.get().state.clock.runningSince, at(200));
  e.setTime(at(205)); e.send({ clockAction: 'pause' });
  e.setTime(at(300)); e.send({ playEvent: { type: 'BALL' } });
  assert.equal(e.get().state.clock.runningSince, at(300));
  e.setTime(at(305)); e.send({ clockAction: 'pause' });
  e.setTime(at(400)); e.send({ plateAppearance: { result: 'OUT' } });
  assert.equal(e.get().state.clock.runningSince, at(400));
  e.setTime(at(405)); e.send({ clockAction: 'pause' });
  e.setTime(at(500)); send({ kind: 'play', result: 'error', errors: [{ playerId: 'HOME5', position: 'SS', type: 'fielding' }] });
  assert.equal(e.get().state.clock.runningSince, at(500));
  e.setTime(at(505)); e.send({ clockAction: 'pause' });
  const paused = e.get().state.clock;
  e.setTime(at(600)); e.send({ lastErrorOuts: 1 });
  assert.deepEqual(e.get().state.clock, paused);
  assert.equal(paused.elapsedMs, 30000);
});

test('a friendly starts and resumes only on successful new scoring, preserving paused and historical time', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(start) });
  const dir = mkdtempSync(join(tmpdir(), 'playsport-friendly-auto-clock-')), path = join(dir, 'games.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let service = new FriendlyGamesService(path);
  let game = service.create('owner', { sport: 'baseball', names: { home: 'Local', away: 'Visitante' },
    lineups: { home: Array.from({ length: 9 }, (_, i) => `Local ${i}`), away: Array.from({ length: 9 }, (_, i) => `Visita ${i}`) } });
  const update = payload => { game = service.update('owner', game.id, { expectedRevision: game.revision, ...payload }); };
  assert.equal(game.clock, undefined);
  bad(() => update({ command: { kind: 'play', result: 'error' } }), 400);
  assert.equal(service.list('owner').games[0].clock, undefined);
  update({ command: { kind: 'pitch', value: 'ball' } });
  assert.equal(game.clock.runningSince, start);
  t.mock.timers.tick(10000); update({ clockAction: 'pause' });
  const paused = game.clock;
  t.mock.timers.tick(90000); update({ undo: true });
  assert.deepEqual(game.clock, paused);
  update({ command: { kind: 'pitch', value: 'strike' } });
  assert.equal(game.clock.runningSince, at(100));
  assert.equal(game.clock.elapsedMs, 10000);
  t.mock.timers.tick(2000);
  assert.equal(gameClockElapsed(game.clock, Date.now()), 12000);
  service = new FriendlyGamesService(path);
  assert.deepEqual(service.list('owner').games[0].clock, game.clock);
});

test('official clock persists across restarts without entering scoring undo history or altering statistics', t => {
  const e = fixture(t), before = e.get(), events = [];
  const subscription = e.service.createGameStream('game', 'tour').subscribe(event => events.push(event));
  t.after(() => subscription.unsubscribe());
  new OfficialScoringController(e.service).submitOfficialUpdate('game', { tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    clockAction: 'start', expectedOfficialVersion: before.state.officialVersion });
  assert.deepEqual(e.get().state.clock, { startedAt: start, runningSince: start, elapsedMs: 0 });
  assert.equal(e.get().state.status, 'in_progress');
  assert.equal(events.at(-1).state.clock.runningSince, start);
  assert.deepEqual(e.get().playByPlay.scorecard.scores, before.playByPlay.scorecard.scores);
  bad(() => e.send({ undoLast: true }), 400);
  e.setTime(at(60)); e.send({ clockAction: 'pause' });
  e.reopen();
  assert.equal(e.get().state.clock.elapsedMs, 60000);
  e.setTime(at(300)); e.send({ clockAction: 'resume' }, { actorId: 'org', actorRole: 'organizer' });
  e.setTime(at(330)); e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  e.send({ undoLast: true });
  assert.equal(e.get().state.clock.runningSince, at(300));
  e.send({ scorecardCommand: { kind: 'finish' } });
  assert.equal(e.get().state.clock.runningSince, null);
  assert.equal(e.get().state.clock.elapsedMs, 90000);
  bad(() => e.send({ clockAction: 'resume' }), 409);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }), 409);
  e.send({ undoLast: true });
  assert.equal(e.get().state.clock.elapsedMs, 90000);
  assert.equal(e.get().state.clock.runningSince, null);
  e.reopen();
  assert.equal(e.get().state.clock.elapsedMs, 90000);
});

test('clock writes require an assigned official, one operation and the current version', t => {
  const e = fixture(t), initial = e.get();
  for (const role of ['manager', 'player', 'fan', 'scout']) bad(() => e.send({ clockAction: 'start' }, { actorRole: role }), 403);
  bad(() => e.send({ clockAction: 'start' }, { actorId: 'unknown' }), 403);
  bad(() => e.send({ clockAction: 'start', expectedOfficialVersion: undefined }), 400);
  bad(() => e.send({ clockAction: 'reset' }), 400);
  bad(() => e.send({ clockAction: 'start', scorecardCommand: { kind: 'pitch', value: 'ball' } }), 400);
  assert.deepEqual(e.get(), initial);
  e.send({ clockAction: 'start' });
  bad(() => e.send({ clockAction: 'start', expectedOfficialVersion: initial.state.officialVersion }), 409);
  bad(() => e.send({ clockAction: 'start' }), 400);
});

test('suspensions pause the clock and a preserved game resumes without counting the interruption', t => {
  const e = fixture(t);
  e.send({ clockAction: 'start' }); e.setTime(at(45));
  e.service.suspendGame({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    expectedOfficialVersion: e.get().state.officialVersion, cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia' });
  assert.equal(e.get().state.clock.elapsedMs, 45000);
  assert.equal(e.get().state.clock.runningSince, null);
  bad(() => e.send({ clockAction: 'resume' }), 409);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }), 409);
  assert.equal(e.get().state.clock.runningSince, null);
  e.service.rescheduleGame({ gameId: 'game', tournamentId: 'tour', organizerId: 'org',
    expectedOfficialVersion: e.get().state.officialVersion, date: '2026-11-14', time: '10:00' });
  e.setTime(at(86400)); e.send({ clockAction: 'resume' });
  assert.equal(gameClockElapsed(e.get().state.clock, Date.parse(at(86410))), 55000);
});

test('friendly clock is creator-only, persists independently of pitches and stops on finish', t => {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-friendly-clock-')), path = join(dir, 'games.json');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let service = new FriendlyGamesService(path);
  let game = service.create('owner', { sport: 'softball', names: { home: 'Local', away: 'Visitante' },
    lineups: { home: Array.from({ length: 9 }, (_, i) => `Local ${i}`), away: Array.from({ length: 9 }, (_, i) => `Visita ${i}`) } });
  bad(() => service.update('other', game.id, { expectedRevision: game.revision, clockAction: 'start' }), 403);
  game = service.update('owner', game.id, { expectedRevision: game.revision, clockAction: 'start' });
  assert.equal(game.commands.length, 0);
  assert.ok(game.clock.runningSince);
  service = new FriendlyGamesService(path); game = service.list('owner').games[0];
  assert.ok(game.state.clock.runningSince);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: game.seed, commands: game.commands, clock: game.clock }));
  assert.deepEqual(saved.clock, game.clock);
  game = service.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'finish' } });
  assert.equal(game.clock.runningSince, null);
  bad(() => service.update('owner', game.id, { expectedRevision: game.revision, clockAction: 'resume' }), 409);
});

test('protest freezes elapsed time without adding interruption time', t => {
  const e = fixture(t);
  e.send({ clockAction: 'start' }); e.setTime(at(12));
  e.service.declareGameProtest({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    expectedOfficialVersion: e.get().state.officialVersion, teamId: 'home', reason: 'Regla consultada' });
  assert.equal(e.get().state.clock.elapsedMs, 12000);
  assert.equal(e.get().state.clock.runningSince, null);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }), 409);
  assert.equal(e.get().state.clock.runningSince, null);
});

test('resetting a suspended game archives the old clock and requires a fresh start', t => {
  const e = fixture(t);
  e.send({ clockAction: 'start' }); e.setTime(at(30));
  e.service.suspendGame({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    expectedOfficialVersion: e.get().state.officialVersion, cause: 'weather', scoreHandling: 'reset', reason: 'Se reinicia completo' });
  assert.equal(e.get().state.clock, undefined);
  const archive = e.service.suspensionArchive('game', 'tour');
  const stored = e.service.suspensionArchive('game', 'tour', archive.interruptions[0].id);
  assert.equal(stored.state.clock.elapsedMs, 30000);
  assert.equal(stored.state.clock.runningSince, null);
});
