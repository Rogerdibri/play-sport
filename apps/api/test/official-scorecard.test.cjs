const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyPrivateCommand, minimumDestinations, isScorecardState, privateStats } = require('@playsport/shared');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');

function setup({ away = true } = {}) {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['scorer'] });
  const entries = (prefix) => Array.from({ length: 9 }, (_, i) => ({
    identificationNumber: `${prefix}${i}`, battingOrder: i + 1,
    fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i], jerseyNumber: String(i + 1)
  }));
  for (const [teamId, prefix] of [['home', 'HOME'], ['away', 'AWAY']]) {
    const ids = Array.from({ length: 11 }, (_, i) => `${prefix}${i}`);
    for (const id of ids) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: id, displayName: `Jugador ${id}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`, playerIdentificationNumbers: ids });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  const deliver = (teamId) => service.configureGameLineup({
    gameId: 'game', tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
    lineupEntries: entries(teamId === 'home' ? 'HOME' : 'AWAY'),
    presentSubstituteIdentificationNumbers: [teamId === 'home' ? 'HOME9' : 'AWAY9']
  });
  deliver('home');
  if (away) deliver('away');
  const get = () => structuredClone(service.getOfficialState('game', 'tour'));
  const send = (payload, actor = {}) => service.submitOfficialUpdate({
    gameId: 'game', tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    patch: {}, expectedOfficialVersion: get().state.officialVersion, ...payload, ...actor
  });
  const command = (scorecardCommand) => send({ scorecardCommand });
  const play = (result) => command({ kind: 'play', result });
  const personnel = (action, teamId = 'home', patch = {}) => service.recordPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId, actorId: 'scorer', actorRole: 'scorekeeper',
    expectedRevision: service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper').sheets.find((s) => s.teamId === teamId).revision,
    expectedOfficialVersion: get().state.officialVersion, action, ...patch
  });
  return { service, get, send, command, play, personnel, deliver };
}
const bad = (fn, status) => assert.throws(fn, (error) => error.getStatus?.() === status);

test('manager delivers only approved roster members and has read-only scoring permissions', () => {
  const e = setup();
  const permissions = e.service.getGamePermissions({ gameId: 'game', tournamentId: 'tour', userId: 'mgr-home', role: 'manager' });
  assert.equal(permissions.canSubmitLineup, true);
  assert.equal(permissions.canPrivateWrite, false);
  assert.equal(permissions.canOfficialWrite, false);
  assert.equal(permissions.canRegisterPlayers, false);
  assert.equal(permissions.scoringMode, 'read_only');
  const before = e.get();
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } }, { actorId: 'mgr-home', actorRole: 'manager' }), 403);
  bad(() => e.personnel({ kind: 'arrival', identificationNumber: 'HOME10' }, 'home', { actorId: 'mgr-home', actorRole: 'manager' }), 403);
  bad(() => e.service.configureTournamentTeamRoster({ tournamentId: 'tour', teamId: 'home', managerId: 'mgr-home', playerIdentificationNumbers: ['HOME0'] }), 403);
  assert.deepEqual(e.get(), before);
});

test('both lineups must be delivered and an existing delivery cannot be overwritten', () => {
  const e = setup({ away: false });
  bad(() => e.play('single'), 400);
  e.deliver('away');
  const sheet = e.service.getTeamSheets('game', 'tour', 'mgr-away', 'manager').sheets.find((s) => s.teamId === 'away');
  bad(() => e.service.configureGameLineup({
    gameId: 'game', tournamentId: 'tour', teamId: 'away', managerId: 'mgr-away',
    lineupEntries: sheet.initialLineup.map((p, i) => ({ ...p, identificationNumber: i === 0 ? 'HOME0' : p.identificationNumber }))
  }), 400);
  e.play('single');
  assert.equal(e.get().playByPlay.baseRunners.first, 'AWAY0');
});

for (const result of ['single', 'double', 'triple', 'homeRun', 'hitByPitch', 'error', 'battedOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt']) {
  test(`official one-touch ${result} preserves the designed engine's advances and statistics`, () => {
    const e = setup();
    e.play('triple');
    const before = e.get().playByPlay.scorecard;
    const expected = applyPrivateCommand(before, { kind: 'play', result, destinations: minimumDestinations(before, result) });
    e.play(result);
    const actual = e.get().playByPlay.scorecard;
    assert.ok(isScorecardState(actual));
    for (const key of ['bases', 'scores', 'outs', 'balls', 'strikes', 'inning', 'side', 'indexes', 'log']) assert.deepEqual(actual[key], expected[key], key);
    assert.deepEqual(privateStats(actual, 'away', 'AWAY1'), privateStats(expected, 'away', 'AWAY1'));
    const stats = e.get().playByPlay.batterStats.find((s) => s.identificationNumber === 'AWAY1');
    const expectedStats = privateStats(expected, 'away', 'AWAY1');
    assert.equal(stats.atBats, expectedStats.atBats);
    assert.equal(stats.hits, expectedStats.hits);
    assert.equal(stats.walks, expectedStats.walks);
  });
}

test('pitch buttons complete walks and strikeouts, and six outs complete exactly one inning', () => {
  const e = setup();
  for (let i = 0; i < 4; i++) e.command({ kind: 'pitch', value: 'ball' });
  assert.equal(e.get().playByPlay.baseRunners.first, 'AWAY0');
  for (let i = 0; i < 3; i++) e.command({ kind: 'pitch', value: 'strike' });
  e.play('battedOut'); e.play('battedOut');
  assert.equal(e.get().playByPlay.scorecard.side, 'home');
  assert.equal(e.get().state.inning, 1);
  e.play('battedOut'); e.play('battedOut'); e.play('battedOut');
  assert.equal(e.get().playByPlay.scorecard.side, 'away');
  assert.equal(e.get().state.inning, 2);
});

test('independent runner plays preserve turn/count and attribute home outs without a fictitious PA', () => {
  const e = setup();
  e.play('single');
  e.command({ kind: 'pitch', value: 'ball' });
  e.command({ kind: 'runner', action: 'steal', from: 1, to: 2 });
  e.command({ kind: 'runner', action: 'advanceOut', from: 2, to: 0, attemptedBase: 4 });
  const state = e.get().playByPlay.scorecard;
  assert.equal(state.balls, 1);
  assert.equal(state.indexes.away, 1);
  assert.equal(state.outs, 1);
  assert.equal(state.log.at(-1).runnerId, 'AWAY0');
  assert.equal(state.log.at(-1).batterId, null);
  assert.equal(e.get().playByPlay.batterStats.find((s) => s.identificationNumber === 'AWAY0').caughtStealing, 0);
});

test('same-command error evidence and repeated undo restore score, runners, stats and ledger with increasing versions', () => {
  const e = setup();
  const before = e.get().playByPlay.scorecard;
  e.play('error');
  const version = e.get().state.officialVersion;
  e.send({ lastErrorOuts: 1 });
  let state = e.get();
  assert.equal(state.playByPlay.scorecard.log.length, 1);
  assert.equal(state.playByPlay.totalEvents, 1);
  assert.equal(state.playByPlay.lastScorecardCommand.errorOuts, 1);
  assert.ok(state.state.officialVersion > version);
  e.play('homeRun');
  assert.equal(e.get().state.awayScore, 2);
  e.send({ undoLast: true });
  e.send({ undoLast: true });
  state = e.get();
  assert.deepEqual(state.playByPlay.scorecard, before);
  assert.equal(state.playByPlay.canUndo, false);
  assert.deepEqual(state.playByPlay.batterStats, []);
  assert.deepEqual(state.playByPlay.pitcherStats, []);
  assert.ok(state.state.officialVersion > version);
});

test('official personnel is recorded directly, retains pitcher responsibility and blocks stale writes and crossing undo', () => {
  const e = setup();
  e.play('single');
  const stale = e.get().state.officialVersion;
  const action = { kind: 'substitution', outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME9', fieldPosition: 'P', jerseyNumber: '10' };
  const updated = e.personnel(action);
  assert.equal(updated.requests.at(-1).status, 'approved');
  assert.equal(updated.requests.at(-1).decidedBy.id, 'scorer');
  assert.equal(updated.sheets.find((s) => s.teamId === 'home').lineup[0].identificationNumber, 'HOME9');
  assert.equal(e.get().playByPlay.canUndo, false);
  bad(() => e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' }, expectedOfficialVersion: stale }), 409);
  bad(() => e.send({ undoLast: true }), 400);
  e.play('homeRun');
  assert.deepEqual(e.get().playByPlay.runAccounting.runs.map((r) => r.pitcherId), ['HOME0', 'HOME9']);
});

test('arrival, defense and courtesy changes require approved membership and actual official bases', () => {
  const e = setup();
  const before = e.get();
  bad(() => e.personnel({ kind: 'arrival', identificationNumber: 'AWAY10' }), 400);
  assert.deepEqual(e.get(), before);
  e.personnel({ kind: 'arrival', identificationNumber: 'HOME10' });
  e.personnel({ kind: 'defense', identificationNumber: 'HOME0', fieldPosition: 'C' });
  const home = e.get().playByPlay.scorecard.lineups.home;
  assert.equal(home.find((p) => p.id === 'HOME0').position, 'C');
  assert.equal(home.find((p) => p.id === 'HOME1').position, 'P');
  const courtesy = { kind: 'courtesy', fromBase: 1, outgoingIdentificationNumber: 'AWAY0', incomingIdentificationNumber: 'AWAY9' };
  bad(() => e.personnel(courtesy, 'away'), 400);
  e.play('single');
  e.personnel(courtesy, 'away');
  assert.equal(e.get().playByPlay.baseRunners.first, 'AWAY9');
  assert.equal(e.get().playByPlay.scorecard.courtesyFor.AWAY9, 'AWAY0');
});

test('9-inning duration survives scoring/undo and official final can be undone without changing personnel', () => {
  const e = setup();
  e.send({ regulationInnings: 9 });
  e.play('homeRun');
  e.command({ kind: 'finish' });
  assert.equal(e.get().state.status, 'final');
  bad(() => e.play('single'), 409);
  e.send({ undoLast: true });
  assert.equal(e.get().state.status, 'in_progress');
  assert.equal(e.get().playByPlay.scorecard.seed.regulationInnings, 9);
  e.send({ undoLast: true });
  assert.equal(e.get().state.awayScore, 0);
  assert.equal(e.get().playByPlay.scorecard.seed.regulationInnings, 9);
});

test('both manager streams receive identical official pitches and direct personnel updates without sending requests', () => {
  const e = setup(), home = [], away = [];
  const a = e.service.createGameStream('game', 'tour').subscribe((event) => home.push(event));
  const b = e.service.createGameStream('game', 'tour').subscribe((event) => away.push(event));
  e.command({ kind: 'pitch', value: 'ball' });
  e.personnel({ kind: 'defense', identificationNumber: 'HOME0', fieldPosition: 'C' });
  assert.deepEqual(home, away);
  assert.equal(home.at(-1).playByPlay.scorecard.lineups.home.find((p) => p.id === 'HOME0').position, 'C');
  assert.equal(home.at(-1).playByPlay.scorecard.balls, 1);
  a.unsubscribe(); b.unsubscribe();
});

test('invalid input, impossible sacrifice and stale undo fail atomically', () => {
  const e = setup();
  for (const command of [{ kind: 'pitch', value: ['ball'] }, { kind: 'received-lineup', side: 'away', players: [] }, { kind: 'play', result: 'sacrificeFly' }]) {
    const before = e.get();
    bad(() => e.command(command), 400);
    assert.deepEqual(e.get(), before);
  }
  e.play('single');
  const before = e.get();
  bad(() => e.send({ undoLast: true, expectedOfficialVersion: 0 }), 409);
  assert.deepEqual(e.get(), before);
});

test('controller forwards official commands, duration, undo and direct personnel versions', () => {
  const e = setup(), controller = new OfficialScoringController(e.service);
  const update = (operation) => controller.submitOfficialUpdate('game', {
    tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper', expectedOfficialVersion: e.get().state.officialVersion, ...operation
  });
  update({ regulationInnings: 9 });
  update({ scorecardCommand: { kind: 'play', result: 'error' } });
  update({ lastErrorOuts: 1 });
  update({ undoLast: true });
  assert.equal(e.get().playByPlay.scorecard.log.length, 0);
  controller.recordPersonnelChange('game', 'home', {
    tournamentId: 'tour', actorId: 'org', actorRole: 'organizer', expectedRevision: 1,
    expectedOfficialVersion: e.get().state.officialVersion, action: { kind: 'arrival', identificationNumber: 'HOME10' }
  });
  assert.equal(e.service.getTeamSheets('game', 'tour', 'mgr-home', 'manager').sheets.find((s) => s.teamId === 'home').presentSubstitutes.length, 2);
});
