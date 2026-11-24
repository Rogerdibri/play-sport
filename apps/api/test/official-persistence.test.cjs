const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, statSync, renameSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { demoProfileLocation } = require('@playsport/shared');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { OfficialStateStore } = require('../src/modules/live-scoring/official-state.store');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-durable-'));
  const path = join(dir, 'official.sqlite');
  let registry, service;
  const open = () => {
    registry = new RegistrationService(join(dir, 'registration.json'));
    service = new OfficialScoringService(registry, { path });
    service.nowIso = () => '2026-11-17T02:00:00.000Z';
  };
  open();
  t.after(() => {
    service.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  service.configureTournamentAuthorization({
    tournamentId: 'tour',
    organizerId: 'org',
    organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['scorer'],
    scorekeeperIdentities: [{ actorId: 'scorer', identificationNumber: 'SCORER0001' }]
  });
  for (const teamId of ['home', 'away']) {
    const ids = Array.from({ length: 10 }, (_, i) => `${teamId.toUpperCase()}${i}`);
    for (const id of ids)
      service.registerGlobalPlayer({
        actorId: 'org',
        player: { identificationNumber: id, displayName: `Jugador ${id}` }
      });
    service.configureTournamentTeamRoster({
      tournamentId: 'tour',
      organizerId: 'org',
      teamId,
      managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`,
      playerIdentificationNumbers: ids
    });
  }
  service.configureGameTeams({
    gameId: 'game',
    tournamentId: 'tour',
    organizerId: 'org',
    homeTeamId: 'home',
    awayTeamId: 'away'
  });
  service.configureGameAuthorization({
    gameId: 'game',
    tournamentId: 'tour',
    organizerId: 'org',
    scorekeeperIds: ['scorer']
  });
  service.configureGameDetails({
    gameId: 'game',
    tournamentId: 'tour',
    organizerId: 'org',
    details: {
      tournamentName: 'Copa aislada',
      homeTeamName: 'Local',
      awayTeamName: 'Visitante',
      date: '2026-11-12',
      time: '10:00',
      venue: 'Estadio ficticio',
      ...demoProfileLocation
    }
  });
  for (const teamId of ['home', 'away'])
    service.configureGameLineup({
      gameId: 'game',
      tournamentId: 'tour',
      teamId,
      managerId: `mgr-${teamId}`,
      lineupEntries: Array.from({ length: 9 }, (_, i) => ({
        identificationNumber: `${teamId.toUpperCase()}${i}`,
        battingOrder: i + 1,
        fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i],
        jerseyNumber: String(i + 1)
      })),
      presentSubstituteIdentificationNumbers: [`${teamId.toUpperCase()}9`]
    });
  const get = () => structuredClone(service.getOfficialState('game', 'tour'));
  const send = (operation) =>
    service.submitOfficialUpdate({
      gameId: 'game',
      tournamentId: 'tour',
      actorId: 'scorer',
      actorRole: 'scorekeeper',
      patch: {},
      expectedOfficialVersion: get().state.officialVersion,
      ...operation
    });
  return {
    path,
    get,
    send,
    get service() {
      return service;
    },
    get registry() {
      return registry;
    },
    restart() {
      service.onModuleDestroy();
      open();
    },
    open
  };
}

test('a combined late arrival substitution survives restart as one confirmed personnel change', t => {
  const e = fixture(t);
  e.service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'HOME10', displayName: 'Reserva recién llegada' } });
  e.service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId: 'home',
    managerId: 'mgr-home', managerIdentificationNumber: 'MANAGERhome',
    playerIdentificationNumbers: Array.from({ length: 11 }, (_, i) => `HOME${i}`) });
  const before = e.get(), sheet = e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper').sheets.find(p => p.teamId === 'home');
  e.service.recordPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', actorId: 'scorer', actorRole: 'scorekeeper',
    expectedRevision: sheet.revision, expectedOfficialVersion: before.state.officialVersion,
    action: { kind: 'substitution', outgoingIdentificationNumber: 'HOME3', incomingIdentificationNumber: 'HOME10',
      fieldPosition: '2B', jerseyNumber: '11', arrival: true }
  });
  const after = e.get();
  e.restart();
  assert.deepEqual(e.get(), after);
  const restored = e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper');
  assert.equal(restored.requests.at(-1).action.arrival, true);
  assert.equal(restored.sheets.find(p => p.teamId === 'home').lineup[3].identificationNumber, 'HOME10');
  assert.equal(e.get().state.officialVersion, before.state.officialVersion + 1);
});

test('infield fly declaration survives durable official restart and undo without altering runners', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  const before = e.get().playByPlay.scorecard;
  e.send({ scorecardCommand: { kind: 'play', result: 'flyOut', infieldFly: true } });
  e.restart();
  const restored = e.get().playByPlay;
  assert.equal(restored.scorecard.log.at(-1).infieldFly, true);
  assert.equal(restored.recentEvents.at(-1).infieldFly, true);
  assert.deepEqual(restored.scorecard.bases, before.bases);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
  assert.equal(e.get().playByPlay.scorecard.outs, 0);
});

test('the catching fielder survives an official restart and disappears only when its play is undone', t => {
  const e = fixture(t), caughtBy = { playerId: 'HOME5', position: 6 };
  e.send({ scorecardCommand: { kind: 'play', result: 'lineOut', battedBallType: 'line', fieldingSequence: [6], caughtBy } });
  e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.log.at(-1).caughtBy, caughtBy);
  assert.equal(e.get().playByPlay.recentEvents.at(-1).fielderIdentificationNumber, 'HOME5');
  e.send({ undoLast: true }); e.restart();
  assert.equal(e.get().playByPlay.scorecard.log.length, 0);
});

test('batter rule-out cause and accepted appeal survive durable restart and undo', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  const before = e.get().playByPlay.scorecard;
  const detail = { reason: 'battingOutOfTurn', umpireConfirmed: true, appealConfirmed: true };
  e.send({ scorecardCommand: { kind: 'play', result: 'ruleOut', batterRuleOut: detail } });
  e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.log.at(-1).batterRuleOut, detail);
  assert.deepEqual(e.get().playByPlay.recentEvents.at(-1).batterRuleOut, detail);
  assert.equal(e.get().playByPlay.recentEvents.at(-1).type, 'OUT');
  assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
  assert.equal(e.get().playByPlay.scorecard.outs, 0);
});

test('batted-out type and defensive sequence survive durable official restart and undo', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'groundOut', battedBallType: 'ground',
    fieldingSequence: [6, 3], destinations: { AWAY0: 0 } } });
  const event = e.get().playByPlay.recentEvents.at(-1);
  e.restart();
  const restored = e.get().playByPlay;
  assert.equal(restored.scorecard.log.at(-1).battedBallType, 'ground');
  assert.deepEqual(restored.scorecard.log.at(-1).fieldingSequence, [6, 3]);
  assert.deepEqual(restored.recentEvents.at(-1), event);
  e.send({ undoLast: true });
  e.restart();
  assert.equal(e.get().playByPlay.scorecard.log.length, 0);
  assert.equal(e.get().playByPlay.recentEvents.length, 0);
  e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 0, AWAY1: 1 },
    battedBallType: 'ground', fieldingSequence: [6, 4] } });
  e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.log.at(-1).fieldingSequence, [6, 4]);
  assert.equal(e.get().playByPlay.scorecard.log.at(-1).battedBallType, 'ground');
  e.send({ undoLast: true });
  e.send({ scorecardCommand: { kind: 'runner', action: 'caught', from: 1, to: 0, fieldingSequence: [2, 6] } });
  e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard.log.at(-1).fieldingSequence, [2, 6]);
  assert.deepEqual(e.get().playByPlay.recentEvents.at(-1).fieldingSequence, [2, 6]);
  assert.equal(e.get().playByPlay.scorecard.log.at(-1).battedBallType, undefined);
  e.send({ undoLast: true }); e.restart();
  assert.equal(e.get().playByPlay.scorecard.log.at(-1).fieldingSequence, undefined);
});

test('softball automatic runners and their unearned runs survive durable restart and undo', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'rules', rules: 'softball-fastpitch' } });
  for (let out = 0; out < 42; out++) e.send({ scorecardCommand: { kind: 'play', result: 'groundOut' } });
  const placed = e.get().playByPlay.scorecard;
  assert.deepEqual(placed.bases, [null, 'AWAY2', null]);
  e.restart(); assert.deepEqual(e.get().playByPlay.scorecard, placed);
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  const scored = e.get().playByPlay.scorecard;
  assert.equal(scored.runAccounting.runs[0].pitcher, 'unearned');
  e.restart(); assert.deepEqual(e.get().playByPlay.scorecard, scored);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard, placed);
  e.send({ undoLast: true }); e.restart();
  assert.equal(e.get().playByPlay.scorecard.inning, 7);
  assert.equal(e.get().playByPlay.scorecard.tieBreakerRunner, undefined);
});

test('legacy official extras keep their recorded bases and adopt the rule only at the next inning', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'rules', rules: 'softball-fastpitch' } });
  e.service.games.get('game').softballTieBreakerFromInning = Number.MAX_SAFE_INTEGER;
  for (let out = 0; out < 42; out++) e.send({ scorecardCommand: { kind: 'play', result: 'groundOut' } });
  const history = e.get().playByPlay.scorecard.log;
  e.service.runOfficialMutation(() => { delete e.service.games.get('game').softballTieBreakerFromInning; });
  e.restart();
  let state = e.get().playByPlay.scorecard;
  assert.equal(state.seed.softballTieBreakerFromInning, 9);
  assert.deepEqual(state.bases, [null, null, null]); assert.deepEqual(state.log, history);
  for (let out = 0; out < 6; out++) e.send({ scorecardCommand: { kind: 'play', result: 'groundOut' } });
  state = e.get().playByPlay.scorecard;
  assert.equal(state.inning, 9); assert.deepEqual(state.bases, [null, 'AWAY5', null]);
  e.restart(); assert.deepEqual(e.get().playByPlay.scorecard, state);
});

test('a corrupt persisted tie-breaker threshold is rejected instead of activating an implicit fallback', t => {
  const { serialize } = require('node:v8');
  const e = fixture(t), stored = structuredClone(e.service.storedState());
  stored.games.get('game').softballTieBreakerFromInning = 'eight';
  assert.throws(() => e.service.restoreStoredState(serialize(stored)), /partido persistente no es válido/);
});

test('runner rule out cause and appeal base survive official restart and durable undo', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  const before = e.get().playByPlay.scorecard, ruleOut = { reason: 'missedBase', appealBase: 1 };
  e.send({ scorecardCommand: { kind: 'runner', action: 'ruleOut', from: 1, to: 0, ruleOut } });
  const saved = e.get().playByPlay;
  assert.deepEqual(saved.scorecard.log.at(-1).ruleOut, ruleOut);
  e.restart(); assert.deepEqual(e.get().playByPlay, saved);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard, before);
});

test('ordered home and third selection outs survive restart as a double play with a safe batter', t => {
  const { fieldersChoiceTwoOutOptions } = require('@playsport/shared');
  const e = fixture(t);
  for (let index = 0; index < 3; index++) e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  const before = e.get(), option = fieldersChoiceTwoOutOptions(before.playByPlay.scorecard)
    .find(option => option.selectionOuts[0].base === 4 && option.selectionOuts[1].base === 3);
  e.send({ scorecardCommand: { kind: 'play', result: 'fieldersChoice',
    destinations: option.destinations, selectionOuts: option.selectionOuts, note: option.label } });
  const saved = e.get();
  assert.equal(saved.playByPlay.baseRunners.first, 'AWAY3');
  assert.equal(saved.playByPlay.scorecard.outs, 2);
  assert.equal(saved.playByPlay.recentEvents.at(-1).type, 'DOUBLE_PLAY');
  e.restart(); assert.deepEqual(e.get().playByPlay, saved.playByPlay);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.pitcherStats, before.playByPlay.pitcherStats);
});

test('selection plus multiple errors survives restart and durable undo with the saved runner intact', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'single' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'battedOut' } });
  e.send({ scorecardCommand: { kind: 'play', result: 'battedOut' } });
  const before = e.get();
  e.send({ scorecardCommand: { kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 3, AWAY3: 2 },
    errorSavedRunnerId: 'AWAY0', errorOuts: 1, rbis: 0,
    errors: [{ playerId: 'HOME5', position: 'SS', type: 'throwing' }, { playerId: 'HOME3', position: '2B', type: 'fielding' }] } });
  const saved = e.get();
  assert.equal(saved.playByPlay.scorecard.outs, 2);
  assert.deepEqual(saved.playByPlay.baseRunners, { first: null, second: 'AWAY3', third: 'AWAY0' });
  e.restart(); assert.deepEqual(e.get().playByPlay, saved.playByPlay);
  e.send({ undoLast: true }); e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.fieldingStats, before.playByPlay.fieldingStats);
});

test('contextual selection survives durable restart with exact destinations and undoes', t => {
  const { fieldersChoiceOptions } = require('@playsport/shared'), e = fixture(t);
  for (let index = 0; index < 3; index++) e.send({ scorecardCommand: { kind: 'play', result: 'walk' } });
  const before = e.get(), option = fieldersChoiceOptions(before.playByPlay.scorecard).find(entry => entry.id === 'out-3-4');
  e.send({ scorecardCommand: { kind: 'play', result: 'fieldersChoice', destinations: option.destinations, note: option.label } });
  const recorded = e.get();
  assert.equal(recorded.playByPlay.scorecard.outs, 1);
  assert.equal(recorded.playByPlay.baseRunners.first, 'AWAY3');
  assert.equal(recorded.playByPlay.baseRunners.second, 'AWAY2');
  assert.equal(recorded.playByPlay.baseRunners.third, 'AWAY1');
  e.restart(); assert.deepEqual(e.get(), recorded);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.batterStats, before.playByPlay.batterStats);
});

test('obstruction survives durable restart and undoes without leaving a defensive error', t => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'single' } });
  const before = e.get();
  e.send({ scorecardCommand: { kind: 'runner', action: 'obstruction', from: 1, to: 3, errorOuts: 0,
    errors: [{ playerId: 'HOME5', position: 'SS', type: 'obstruction' }] } });
  const recorded = e.get();
  e.restart();
  assert.deepEqual(e.get(), recorded);
  assert.equal(e.get().playByPlay.fieldingErrors[0].type, 'obstruction');
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.fieldingStats, before.playByPlay.fieldingStats);
});

test('typed strikeouts survive durable restarts and undo without changing historical generic strikeouts', t => {
  const e = fixture(t);
  const send = scorecardCommand => e.send({ scorecardCommand });
  send({ kind: 'play', result: 'strikeout' });
  send({ kind: 'pitch', value: 'strike' }); send({ kind: 'pitch', value: 'strike' });
  const before = e.get().playByPlay;
  send({ kind: 'pitch', value: 'strike', strikeoutType: 'looking' });
  const recorded = e.get().playByPlay;
  e.restart();
  assert.deepEqual(e.get().playByPlay, recorded);
  assert.equal(recorded.scorecard.log[0].strikeoutType, undefined);
  assert.equal(recorded.scorecard.log.at(-1).strikeoutType, 'looking');
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.scorecard);
  assert.deepEqual(e.get().playByPlay.pitcherStats, before.pitcherStats);
  e.restart();
  assert.deepEqual(e.get().playByPlay.scorecard, before.scorecard);
});

test('all official state, delivered lineups, statistics, undo and final results survive successive restarts', (t) => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  const before = e.get();
  const sheets = e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper');
  e.restart();
  assert.deepEqual(e.get(), before);
  assert.deepEqual(e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper'), sheets);
  e.send({ undoLast: true });
  assert.equal(e.get().state.awayScore, 0);
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  e.send({ scorecardCommand: { kind: 'finish' } });
  const final = e.get();
  e.restart();
  assert.deepEqual(e.get(), final);
  assert.equal(e.service.getOfficialStandings().games[0].status, 'final');
  assert.throws(
    () => e.send({ scorecardCommand: { kind: 'play', result: 'single' } }),
    (error) => error.getStatus?.() === 409
  );
  assert.deepEqual(e.get(), final);
  assert.equal(statSync(e.path).mode & 0o777, 0o600);
});

test('a failed durable write rolls back both game state and registration rules without emitting an uncommitted SSE event', (t) => {
  const e = fixture(t);
  const events = [];
  const subscription = e.service.createGameStream('game', 'tour').subscribe((event) => events.push(event));
  t.after(() => subscription.unsubscribe());
  const readRegistry = () => {
    const db = new DatabaseSync(e.path, { readOnly: true });
    try {
      return db.prepare('SELECT document FROM registration_state').get().document;
    } finally {
      db.close();
    }
  };
  const before = e.get(),
    registry = readRegistry(),
    count = events.length;
  const save = t.mock.method(e.service.persistentStore, 'save', () => {
    throw new Error('Simulated disk failure');
  });
  assert.throws(() => e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } }), /Simulated disk failure/);
  assert.deepEqual(e.get(), before);
  assert.equal(readRegistry(), registry);
  assert.equal(events.length, count);
  save.mock.restore();
  e.restart();
  assert.deepEqual(e.get(), before);
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  assert.equal(e.get().state.awayScore, 1);
});

test('suspension archives, rescheduling and technical resolutions remain authoritative after restart', (t) => {
  const e = fixture(t);
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  e.service.suspendGame({
    gameId: 'game',
    tournamentId: 'tour',
    actorId: 'scorer',
    actorRole: 'scorekeeper',
    expectedOfficialVersion: e.get().state.officialVersion,
    cause: 'weather',
    scoreHandling: 'reset',
    reason: 'Lluvia ficticia'
  });
  const suspended = e.get(),
    archive = e.service.suspensionArchive('game', 'tour');
  e.restart();
  assert.deepEqual(e.get(), suspended);
  assert.deepEqual(e.service.suspensionArchive('game', 'tour'), archive);
  e.service.rescheduleGame({
    gameId: 'game',
    tournamentId: 'tour',
    organizerId: 'org',
    expectedOfficialVersion: e.get().state.officialVersion,
    date: '2026-11-13',
    time: '11:00'
  });
  e.send({ scorecardCommand: { kind: 'play', result: 'homeRun' } });
  e.service.declareGameProtest({
    gameId: 'game',
    tournamentId: 'tour',
    actorId: 'scorer',
    actorRole: 'scorekeeper',
    expectedOfficialVersion: e.get().state.officialVersion,
    teamId: 'home',
    reason: 'Protesta ficticia'
  });
  e.restart();
  assert.equal(e.get().state.status, 'protested');
  e.service.resolveGameProtest({
    gameId: 'game',
    tournamentId: 'tour',
    organizerId: 'org',
    expectedOfficialVersion: e.get().state.officialVersion,
    winnerTeamId: 'home',
    reason: 'Decisión ficticia',
    recordReference: 'Acta de prueba'
  });
  const resolved = e.get();
  e.restart();
  assert.deepEqual(e.get(), resolved);
  assert.equal(e.get().state.protest.resolution.winnerTeamId, 'home');
});

test('another writer cannot overwrite a newer committed score from a stale service instance', (t) => {
  const e = fixture(t);
  const second = new OfficialScoringService(new RegistrationService(), { path: e.path });
  t.after(() => second.onModuleDestroy());
  second.submitOfficialUpdate({
    gameId: 'game',
    tournamentId: 'tour',
    actorId: 'scorer',
    actorRole: 'scorekeeper',
    expectedOfficialVersion: second.getOfficialState('game', 'tour').state.officialVersion,
    patch: {},
    scorecardCommand: { kind: 'play', result: 'homeRun' }
  });
  assert.throws(
    () => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }),
    (error) => error.getStatus?.() === 409
  );
  e.restart();
  assert.equal(e.get().state.awayScore, 1);
});

test('corrupt persisted data aborts startup instead of silently creating empty games', (t) => {
  const e = fixture(t);
  const db = new DatabaseSync(e.path);
  try {
    db.prepare('UPDATE official_state SET checksum=?').run('damaged');
  } finally {
    db.close();
  }
  assert.throws(
    () => new OfficialScoringService(new RegistrationService(), { path: e.path }),
    /estado deportivo guardado es inválido/
  );
});
test('a missing previously initialized database cannot silently recreate empty games', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-missing-official-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'official.sqlite'),
    store = new OfficialStateStore(path);
  store.close();
  renameSync(path, `${path}.backup`);
  assert.throws(() => new OfficialStateStore(path), /Falta la base deportiva previamente inicializada/);
});
