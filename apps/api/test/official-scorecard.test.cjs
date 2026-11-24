const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applyPrivateCommand, minimumDestinations, isScorecardState, privateStats, privateFieldingStats } = require('@playsport/shared');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');

function setup({ away = true } = {}) {
  const service = new OfficialScoringService();
  service.nowIso = () => '2026-11-17T02:00:00.000Z';
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['scorer'], scorekeeperIdentities: [{ actorId: 'scorer', identificationNumber: 'SCORER0001' }] });
  const entries = (prefix) => Array.from({ length: 9 }, (_, i) => ({
    identificationNumber: `${prefix}${i}`, battingOrder: i + 1,
    fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i], jerseyNumber: String(i + 1)
  }));
  for (const [teamId, prefix] of [['home', 'HOME'], ['away', 'AWAY']]) {
    const ids = Array.from({ length: 11 }, (_, i) => `${prefix}${i}`);
    for (const id of ids) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: id, displayName: `Jugador ${id}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['scorer'] });
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
  const play = (result) => command({ kind: 'play', result,
    ...(result === 'error' ? { errors: [{ playerId: 'HOME5', position: 'SS', type: 'fielding' }] } : {}) });
  const personnel = (action, teamId = 'home', patch = {}) => service.recordPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId, actorId: 'scorer', actorRole: 'scorekeeper',
    expectedRevision: service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper').sheets.find((s) => s.teamId === teamId).revision,
    expectedOfficialVersion: get().state.officialVersion, action, ...patch
  });
  return { service, get, send, command, play, personnel, deliver };
}
const bad = (fn, status) => assert.throws(fn, (error) => error.getStatus?.() === status);

test('the catching fielder is projected in official events without extra outs or fabricated error attribution', () => {
  const e = setup(); e.play('walk');
  const before = e.get().playByPlay.scorecard;
  for (const [result, type, position, playerId] of [['lineOut', 'line', 6, 'HOME5'], ['flyOut', 'fly', 8, 'HOME7']]) {
    const caughtBy = { playerId, position };
    e.command({ kind: 'play', result, battedBallType: type, fieldingSequence: [position], caughtBy });
    const actual = e.get().playByPlay;
    assert.deepEqual(actual.scorecard.log.at(-1).caughtBy, caughtBy);
    assert.deepEqual(actual.recentEvents.at(-1).caughtBy, caughtBy);
    assert.equal(actual.recentEvents.at(-1).fielderIdentificationNumber, playerId);
    assert.equal(actual.recentEvents.at(-1).outsRecorded, 1);
    assert.deepEqual(actual.scorecard.bases, before.bases);
    assert.equal(actual.scorecard.log.at(-1).errors, undefined);
    e.send({ undoLast: true });
    assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
  }
});

test('every batter rule-out cause projects as OUT, preserves bases and official AB, and undoes without classifying it as a force play', () => {
  const { batterRuleOutLabels } = require('@playsport/shared'), e = setup();
  e.play('walk');
  const before = e.get().playByPlay.scorecard;
  for (const reason of Object.keys(batterRuleOutLabels)) {
    e.command({ kind: 'play', result: 'ruleOut', batterRuleOut: { reason, umpireConfirmed: true,
      ...(reason === 'battingOutOfTurn' ? { appealConfirmed: true } : {}) },
      ...(reason === 'intentionalDrop' ? { battedBallType: 'line' } : {}),
      ...(reason === 'other' ? { note: 'Causa arbitral de prueba' } : {}) });
    const actual = e.get().playByPlay;
    assert.equal(actual.recentEvents.at(-1).type, 'OUT');
    assert.deepEqual(actual.recentEvents.at(-1).batterRuleOut, actual.scorecard.log.at(-1).batterRuleOut);
    assert.deepEqual(actual.scorecard.bases, before.bases); assert.equal(actual.scorecard.outs, 1);
    assert.equal(privateStats(actual.scorecard, 'away', 'AWAY1').atBats, 1);
    assert.equal(privateStats(actual.scorecard, 'away', 'AWAY1').strikeouts, 0);
    assert.equal(isScorecardState(actual.scorecard), true);
    e.send({ undoLast: true });
    assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
    assert.equal(e.get().playByPlay.scorecard.outs, 0);
  }
  const snapshot = e.get();
  bad(() => e.command({ kind: 'play', result: 'ruleOut', batterRuleOut: { reason: 'outsideBox', umpireConfirmed: false } }), 400);
  assert.deepEqual(e.get(), snapshot);
});

test('selection and all defensive runner outs project their routes while preserving batter, counts and undo', () => {
  const e = setup();
  e.play('walk');
  e.command({ kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 0, AWAY1: 1 },
    battedBallType: 'ground', fieldingSequence: [6, 4] });
  assert.deepEqual(e.get().playByPlay.scorecard.bases, ['AWAY1', null, null]);
  assert.equal(e.get().playByPlay.scorecard.outs, 1);
  assert.deepEqual(e.get().playByPlay.recentEvents.at(-1).fieldingSequence, [6, 4]);
  e.send({ undoLast: true });
  for (const action of ['caught', 'pickoff', 'advanceOut']) {
    e.command({ kind: 'runner', action, from: 1, to: 0, fieldingSequence: [2, 4],
      ...(action === 'advanceOut' ? { attemptedBase: 2 } : {}) });
    const actual = e.get().playByPlay;
    assert.equal(actual.scorecard.outs, 1);
    assert.deepEqual(actual.scorecard.log.at(-1).fieldingSequence, [2, 4]);
    assert.equal(actual.scorecard.log.at(-1).battedBallType, undefined);
    assert.deepEqual(actual.recentEvents.at(-1).fieldingSequence, [2, 4]);
    assert.equal(actual.recentEvents.at(-1).battedBallType, undefined);
    e.send({ undoLast: true });
    assert.equal(e.get().playByPlay.scorecard.outs, 0);
    assert.deepEqual(e.get().playByPlay.scorecard.bases, ['AWAY0', null, null]);
  }
});

test('official defensive sequences survive projection, history, multiple outs and undo without changing old plays', () => {
  const e = setup();
  e.command({ kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] });
  let actual = e.get().playByPlay;
  assert.deepEqual(actual.scorecard.log.at(-1).fieldingSequence, [6, 3]);
  assert.equal(actual.recentEvents.at(-1).battedBallType, 'ground');
  assert.match(actual.recentEvents.at(-1).description, /vía 6-3/);
  assert.deepEqual(actual.recentEvents.at(-1).fieldingSequence, [6, 3]);
  e.play('walk');
  e.command({ kind: 'play', result: 'doublePlay', battedBallType: 'ground', fieldingSequence: [4, 6, 3] });
  actual = e.get().playByPlay;
  assert.equal(actual.scorecard.side, 'home');
  assert.deepEqual(actual.scorecard.log.at(-1).fieldingSequence, [4, 6, 3]);
  assert.deepEqual(actual.recentEvents.at(-1).fieldingSequence, [4, 6, 3]);
  e.send({ undoLast: true });
  actual = e.get().playByPlay;
  assert.equal(actual.scorecard.side, 'away');
  assert.equal(actual.scorecard.outs, 1);
  assert.equal(actual.scorecard.log.at(-1).result, 'walk');
  const version = e.get().state.officialVersion;
  bad(() => e.command({ kind: 'play', result: 'groundOut', battedBallType: 'line', fieldingSequence: [6, 3] }), 400);
  assert.equal(e.get().state.officialVersion, version);
});

test('official shared and low-level plays place the same softball runner in both extra halves and undo cleanly', () => {
  for (const legacy of [false, true]) {
    const e = setup();
    e.command({ kind: 'rules', rules: 'softball-fastpitch' });
    const out = () => legacy ? e.send({ playEvent: { type: 'OUT' } }) : e.play('groundOut');
    for (let index = 0; index < 41; index++) out();
    const before = e.get().playByPlay.scorecard;
    out();
    let state = e.get().playByPlay.scorecard;
    assert.equal(state.inning, 8); assert.equal(state.side, 'away');
    assert.deepEqual(state.bases, [null, 'AWAY2', null]);
    assert.equal(state.tieBreakerRunner.runnerId, 'AWAY2');
    assert.equal(isScorecardState(state), true);
    assert.equal(state.log.filter(e => !e.scoringRules).length, 42);
    e.send({ undoLast: true }); assert.deepEqual(e.get().playByPlay.scorecard, before); out();
    const placed = e.get().playByPlay.scorecard;
    e.play('homeRun');
    const accounting = e.get().playByPlay.scorecard.runAccounting.runs.slice(-2);
    assert.deepEqual(accounting.map(r => [r.runnerId, r.team, r.pitcher]),
      [['AWAY2', 'unearned', 'unearned'], ['AWAY3', 'earned', 'earned']]);
    assert.equal(e.get().state.awayScore, 2);
    e.send({ undoLast: true }); assert.deepEqual(e.get().playByPlay.scorecard, placed);
    for (let index = 0; index < 3; index++) out();
    state = e.get().playByPlay.scorecard;
    assert.equal(state.side, 'home'); assert.deepEqual(state.bases, [null, 'HOME2', null]);
    for (let index = 0; index < 3; index++) out();
    state = e.get().playByPlay.scorecard;
    assert.equal(state.inning, 9); assert.deepEqual(state.bases, [null, 'AWAY5', null]);
    bad(() => e.send({ regulationInnings: 9 }), 400);
  }
});

test('the organizer modality enables the default in all softball variants without a scorer rules command', () => {
  for (const [modality, expected] of [['Rápido', 'softball-fastpitch'], ['Modificado', 'softball-modified'], ['Lento', 'softball-slowpitch']]) {
    const e = setup();
    e.service.setTournamentPlanning({ document: () => ({ id: 'tour', sport: 'Sóftbol', modality, teams: [] }),
      assertParticipation: () => {} });
    for (let out = 0; out < 42; out++) e.send({ playEvent: { type: 'OUT' } });
    const state = e.get().playByPlay.scorecard;
    assert.equal(state.seed.scoringRules, expected);
    assert.equal(state.inning, 8); assert.deepEqual(state.bases, [null, 'AWAY2', null]);
    assert.equal(state.log.length, 42); assert.equal(state.log.some(entry => entry.scoringRules), false);
  }
});

test('a direct official substitute inherits the automatic runner responsibility before the first pitch', () => {
  const e = setup();
  e.command({ kind: 'rules', rules: 'softball-fastpitch' });
  for (let out = 0; out < 42; out++) e.play('groundOut');
  e.personnel({ kind: 'substitution', outgoingIdentificationNumber: 'AWAY2', incomingIdentificationNumber: 'AWAY9',
    fieldPosition: '1B', jerseyNumber: '10' }, 'away');
  e.personnel({ kind: 'substitution', outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME9',
    fieldPosition: 'P', jerseyNumber: '10' }, 'home');
  e.play('homeRun');
  assert.deepEqual(e.get().playByPlay.scorecard.runAccounting.runs.slice(-2).map(run => [run.runnerId, run.team, run.pitcher]),
    [['AWAY9', 'unearned', 'unearned'], ['AWAY3', 'earned', 'earned']]);
});

test('baseball can still configure nine regulation innings after the seventh without a softball runner', () => {
  const e = setup();
  e.command({ kind: 'rules', rules: 'baseball' });
  for (let out = 0; out < 42; out++) e.play('groundOut');
  assert.doesNotThrow(() => e.send({ regulationInnings: 9 }));
  assert.deepEqual(e.get().playByPlay.scorecard.bases, [null, null, null]);
});

test('official runner rule outs preserve causes in events and scorecards without completing the batter turn', () => {
  const { runnerRuleOutOptions } = require('@playsport/shared'), e = setup();
  e.command({ kind: 'rules', rules: 'softball-fastpitch' });
  for (let index = 0; index < 3; index++) e.play('walk');
  for (const value of ['ball', 'ball', 'strike', 'strike']) e.command({ kind: 'pitch', value });
  const before = e.get();
  for (const reason of runnerRuleOutOptions(before.playByPlay.scorecard)) {
    const ruleOut = { reason, ...(['missedBase', 'missedRetouch'].includes(reason) ? { appealBase: 1 } : {}) };
    e.command({ kind: 'runner', action: 'ruleOut', from: 2, to: 0, ruleOut,
      ...(reason === 'other' ? { note: 'Abandono según el árbitro.' } : {}) });
    const actual = e.get().playByPlay;
    assert.deepEqual(actual.scorecard.log.at(-1).ruleOut, ruleOut);
    assert.deepEqual(actual.recentEvents.at(-1).ruleOut, ruleOut);
    assert.equal(actual.recentEvents.at(-1).type, 'RUNNER_OUT');
    assert.equal(actual.scorecard.outs, 1); assert.equal(actual.scorecard.balls, 2); assert.equal(actual.scorecard.strikes, 2);
    assert.deepEqual(actual.batterStats, before.playByPlay.batterStats);
    assert.deepEqual(actual.scorecard.indexes, before.playByPlay.scorecard.indexes);
    e.send({ undoLast: true }); assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  }
});

test('official two-out selections preserve every valid ordered pair, safe batter, double-play event and undo', () => {
  const { scorecardPracticeScenarios, scorecardPracticeCommands, fieldersChoiceTwoOutOptions, currentBatter } = require('@playsport/shared');
  for (const scenario of Object.keys(scorecardPracticeScenarios).filter(key => key.startsWith('fieldersChoice'))) {
    for (const outs of [0, 1]) {
      const e = setup();
      for (const command of scorecardPracticeCommands(e.get().playByPlay.scorecard.seed, scenario)) e.command(command);
      if (outs) e.play('battedOut');
      const before = e.get(), state = before.playByPlay.scorecard, batter = currentBatter(state);
      for (const option of fieldersChoiceTwoOutOptions(state)) {
        e.command({ kind: 'play', result: 'fieldersChoice', destinations: option.destinations,
          selectionOuts: option.selectionOuts, note: option.label });
        const actual = e.get().playByPlay;
        assert.equal(actual.recentEvents.at(-1).type, 'DOUBLE_PLAY');
        assert.equal(actual.recentEvents.at(-1).outsRecorded, 2);
        assert.equal(actual.scorecard.side, outs ? 'home' : 'away'); assert.equal(actual.scorecard.outs, outs ? 0 : 2);
        assert.equal(actual.batterStats.find(row => row.identificationNumber === batter).hits, 0);
        assert.equal(actual.pitcherStats[0].hitsAllowed, before.playByPlay.pitcherStats[0].hitsAllowed);
        assert.equal(actual.pitcherStats[0].outsRecorded, outs + 2);
        assert.deepEqual(actual.scorecard.log.at(-1).selectionOuts, option.selectionOuts);
        if (!outs) assert.equal(actual.baseRunners.first, batter);
        e.send({ undoLast: true }); assert.deepEqual(e.get().playByPlay.scorecard, state);
        assert.deepEqual(e.get().playByPlay.batterStats, before.playByPlay.batterStats);
        assert.deepEqual(e.get().playByPlay.pitcherStats, before.playByPlay.pitcherStats);
      }
    }
  }
});

test('official reverse-force selection counts a preceding run only with timing evidence and no RBI', () => {
  const { fieldersChoiceTwoOutOptions } = require('@playsport/shared');
  const e = setup();
  e.play('walk'); e.play('walk'); e.play('walk'); e.play('battedOut');
  const before = e.get(), state = before.playByPlay.scorecard;
  const option = fieldersChoiceTwoOutOptions(state).find(option =>
    option.selectionOuts[0].runnerId === state.bases[0] && option.selectionOuts[1].runnerId === state.bases[1] && option.selectionOuts[1].base === 3);
  const command = { kind: 'play', result: 'fieldersChoice', selectionOuts: option.selectionOuts,
    destinations: { ...option.destinations, [state.bases[2]]: 4 } };
  for (const validThirdOutRuns of [false, true]) {
    e.command({ ...command, validThirdOutRuns });
    const actual = e.get().playByPlay;
    assert.equal(actual.recentEvents.at(-1).runsScored, Number(validThirdOutRuns));
    assert.equal(actual.scorecard.log.at(-1).rbis, 0);
    e.send({ undoLast: true });
  }
  for (const invalid of [{ ...command, destinations: { ...command.destinations, AWAY4: 0 } },
    { ...command, selectionOuts: [option.selectionOuts[0], option.selectionOuts[0]] },
    { ...command, selectionOuts: [{ runnerId: 'AWAY8', base: 4 }, option.selectionOuts[1]] }]) {
    bad(() => e.command(invalid), 400); assert.deepEqual(e.get().playByPlay.scorecard, state);
  }
  e.play('battedOut');
  const twoOuts = e.get();
  bad(() => e.command(command), 400); assert.deepEqual(e.get(), twoOuts);
});

test('official selection plus error preserves all occupied scenarios, actual outs and each attribution, then undoes', () => {
  const { scorecardPracticeScenarios, scorecardPracticeCommands, fieldersChoiceOptions, currentBatter } = require('@playsport/shared');
  for (const scenario of Object.keys(scorecardPracticeScenarios).filter(key => key.startsWith('fieldersChoice'))) {
    for (const outs of [0, 1, 2]) {
      const e = setup();
      for (const command of scorecardPracticeCommands(e.get().playByPlay.scorecard.seed, scenario)) e.command(command);
      for (let index = 0; index < outs; index++) e.play('battedOut');
      const before = e.get(), state = before.playByPlay.scorecard, batter = currentBatter(state);
      for (const option of fieldersChoiceOptions(state, true)) {
        e.command({ kind: 'play', result: 'fieldersChoice', destinations: option.destinations,
          errorSavedRunnerId: option.errorSavedRunnerId, note: option.label, rbis: 0, errorOuts: 1,
          errors: [{ playerId: 'HOME5', position: 'SS', type: 'throwing' }, { playerId: 'HOME3', position: '2B', type: 'fielding' }] });
        const actual = e.get().playByPlay;
        assert.equal(actual.scorecard.outs, outs); assert.equal(actual.scorecard.side, 'away');
        assert.equal(actual.recentEvents.at(-1).outsRecorded, 0);
        assert.equal(actual.scorecard.log.at(-1).errorSavedRunnerId, option.errorSavedRunnerId);
        assert.equal(actual.batterStats.find(row => row.identificationNumber === batter).hits, 0);
        assert.equal(actual.pitcherStats[0].hitsAllowed, before.playByPlay.pitcherStats[0].hitsAllowed);
        assert.equal(actual.pitcherStats[0].outsRecorded, outs);
        for (const defender of ['HOME5', 'HOME3']) {
          const stats = actual.fieldingStats.find(row => row.identificationNumber === defender);
          assert.equal(stats.errors, 1); assert.equal(stats.outsRecorded, 0);
        }
        e.send({ undoLast: true });
        assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
        assert.deepEqual(e.get().playByPlay.fieldingStats, before.playByPlay.fieldingStats);
      }
    }
  }
});

test('official selection error rejects a retired, absent or unattributed saved runner atomically', () => {
  const e = setup(); e.play('single');
  const before = e.get(), command = { kind: 'play', result: 'fieldersChoice', errorSavedRunnerId: 'AWAY0',
    destinations: { AWAY0: 2, AWAY1: 1 }, errorOuts: 1, rbis: 0,
    errors: [{ playerId: 'HOME5', position: 'SS', type: 'throwing' }] };
  for (const invalid of [{ ...command, errors: [] }, { ...command, errorOuts: 0 },
    { ...command, errorSavedRunnerId: 'AWAY8' }, { ...command, destinations: { AWAY0: 0, AWAY1: 1 } }]) {
    bad(() => e.command(invalid), 400); assert.deepEqual(e.get(), before);
  }
});

test('selection error with an actual force third out counts no run or putout for the error fielder', () => {
  const e = setup();
  e.play('walk'); e.play('walk'); e.play('walk'); e.play('battedOut'); e.play('battedOut');
  e.command({ kind: 'play', result: 'fieldersChoice', errorSavedRunnerId: 'AWAY2',
    destinations: { AWAY0: 4, AWAY1: 0, AWAY2: 2, AWAY5: 1 }, errorOuts: 1, rbis: 0,
    errors: [{ playerId: 'HOME5', position: 'SS', type: 'throwing' }] });
  const actual = e.get().playByPlay;
  assert.equal(actual.scorecard.side, 'home'); assert.equal(actual.recentEvents.at(-1).outsRecorded, 1);
  assert.equal(actual.recentEvents.at(-1).runsScored, 0); assert.equal(actual.scorecard.scores.away, 0);
  assert.equal(actual.pitcherStats[0].outsRecorded, 3);
  assert.equal(actual.fieldingStats.find(row => row.identificationNumber === 'HOME5').outsRecorded, 0);
});

test('selection error with an actual tag third out uses timing evidence and retains the saved runner unearned', () => {
  const e = setup();
  e.play('double'); e.command({ kind: 'runner', action: 'advance', from: 2, to: 3 });
  e.play('walk'); e.command({ kind: 'runner', action: 'advance', from: 1, to: 2 });
  e.play('battedOut'); e.play('battedOut');
  const before = e.get();
  for (const validThirdOutRuns of [false, true]) {
    e.command({ kind: 'play', result: 'fieldersChoice', errorSavedRunnerId: 'AWAY0',
      destinations: { AWAY0: 4, AWAY1: 0, AWAY4: 1 }, validThirdOutRuns, errorOuts: 1, rbis: 0,
      errors: [{ playerId: 'HOME1', position: 'C', type: 'fielding' }] });
    const actual = e.get().playByPlay;
    assert.equal(actual.recentEvents.at(-1).runsScored, Number(validThirdOutRuns));
    if (validThirdOutRuns) {
      const run = actual.runAccounting.runs.at(-1);
      assert.equal(run.runnerId, 'AWAY0'); assert.equal(run.team, 'unearned'); assert.equal(run.pitcher, 'unearned');
    }
    e.send({ undoLast: true }); assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  }
});

test('official fielders choice retires the runner, credits no hit, preserves pitcher hits and undoes', () => {
  const e = setup();
  e.play('single');
  e.command({ kind: 'pitch', value: 'ball' });
  const before = e.get();
  e.command({ kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 0, AWAY1: 1 } });
  const actual = e.get().playByPlay;
  assert.deepEqual(actual.baseRunners, { first: 'AWAY1', second: null, third: null });
  assert.equal(actual.scorecard.outs, 1); assert.equal(actual.scorecard.balls, 0);
  assert.equal(actual.batterStats.find(row => row.identificationNumber === 'AWAY1').hits, 0);
  assert.equal(actual.pitcherStats[0].hitsAllowed, before.playByPlay.pitcherStats[0].hitsAllowed);
  assert.equal(actual.recentEvents.at(-1).outsRecorded, 1);
  assert.equal(actual.recentEvents.at(-1).runsScored, 0);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.batterStats, before.playByPlay.batterStats);
  assert.deepEqual(e.get().playByPlay.pitcherStats, before.playByPlay.pitcherStats);
});

test('official fielders choice third out clears the bases without inventing a run', () => {
  const e = setup();
  e.play('walk'); e.play('walk'); e.play('walk'); e.play('battedOut'); e.play('battedOut');
  const before = e.get();
  bad(() => e.command({ kind: 'play', result: 'fieldersChoice',
    destinations: { AWAY0: 4, AWAY1: 3, AWAY2: 0, AWAY5: 1 }, validThirdOutRuns: true }), 400);
  assert.deepEqual(e.get(), before);
  e.command({ kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 4, AWAY1: 3, AWAY2: 0, AWAY5: 1 } });
  const actual = e.get().playByPlay;
  assert.equal(actual.scorecard.side, 'home'); assert.equal(actual.scorecard.outs, 0);
  assert.deepEqual(actual.baseRunners, { first: null, second: null, third: null });
  assert.deepEqual(actual.scorecard.scores, before.playByPlay.scorecard.scores);
  assert.equal(actual.recentEvents.at(-1).runsScored, 0);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
});

test('official selection rejects missing runners and incomplete destinations without changing state', () => {
  const e = setup(), empty = e.get();
  bad(() => e.play('fieldersChoice'), 400);
  assert.deepEqual(e.get(), empty);
  e.play('single');
  const occupied = e.get();
  for (const destinations of [undefined, {}, { AWAY1: 1 }]) {
    bad(() => e.command({ kind: 'play', result: 'fieldersChoice', destinations }), 400);
    assert.deepEqual(e.get(), occupied);
  }
});

test('official contextual selections match all occupied scenarios, stats and undo', () => {
  const { scorecardPracticeScenarios, scorecardPracticeCommands, fieldersChoiceOptions, currentBatter } = require('@playsport/shared');
  for (const scenario of Object.keys(scorecardPracticeScenarios).filter(key => key.startsWith('fieldersChoice'))) {
    const e = setup();
    for (const command of scorecardPracticeCommands(e.get().playByPlay.scorecard.seed, scenario)) e.command(command);
    const before = e.get(), state = before.playByPlay.scorecard, batter = currentBatter(state);
    for (const option of fieldersChoiceOptions(state)) {
      e.command({ kind: 'play', result: 'fieldersChoice', destinations: option.destinations, note: option.label });
      const actual = e.get().playByPlay;
      assert.equal(actual.scorecard.outs, option.outRunnerId ? 1 : 0);
      assert.equal(actual.batterStats.find(row => row.identificationNumber === batter).hits, 0);
      assert.equal(actual.pitcherStats[0].hitsAllowed, before.playByPlay.pitcherStats[0].hitsAllowed);
      assert.equal(actual.recentEvents.at(-1).outsRecorded, option.outRunnerId ? 1 : 0);
      assert.match(actual.scorecard.log.at(-1).text, new RegExp(option.label));
      e.send({ undoLast: true });
      assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
    }
  }
});

test('official tag third out counts a preceding runner only with explicit timing evidence', () => {
  const e = setup();
  e.play('double');
  e.command({ kind: 'runner', action: 'advance', from: 2, to: 3 });
  e.play('walk'); e.command({ kind: 'runner', action: 'advance', from: 1, to: 2 });
  e.play('battedOut'); e.play('battedOut');
  const before = e.get();
  for (const validThirdOutRuns of [false, true]) {
    e.command({ kind: 'play', result: 'fieldersChoice', destinations: { AWAY0: 4, AWAY1: 0, AWAY4: 1 },
      note: 'Out por toque en tercera · corredor de segunda', ...(validThirdOutRuns ? { validThirdOutRuns } : {}) });
    const actual = e.get().playByPlay;
    assert.equal(actual.scorecard.side, 'home');
    assert.equal(actual.recentEvents.at(-1).runsScored, validThirdOutRuns ? 1 : 0);
    assert.equal(actual.scorecard.scores.away, validThirdOutRuns ? 1 : 0);
    e.send({ undoLast: true });
    assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  }
});

test('official obstruction records a single attributed error and run without changing the batter, count or other runner', () => {
  const e = setup();
  e.play('single'); e.play('single');
  e.command({ kind: 'pitch', value: 'ball' }); e.command({ kind: 'pitch', value: 'strike' });
  const before = e.get(), command = { kind: 'runner', action: 'obstruction', from: 1, to: 4, errorOuts: 0,
    errors: [{ playerId: 'HOME5', position: 'SS', type: 'obstruction' }] };
  for (const invalid of [{ ...command, errors: undefined }, { ...command, to: 2 },
    { ...command, errors: [...command.errors, ...command.errors] }]) {
    bad(() => e.command(invalid), 400); assert.deepEqual(e.get(), before);
  }
  e.command(command);
  const actual = e.get(), event = actual.playByPlay.recentEvents.at(-1);
  assert.equal(actual.state.officialVersion, before.state.officialVersion + 1);
  assert.deepEqual(actual.playByPlay.baseRunners, { first: null, second: 'AWAY0', third: null });
  assert.equal(actual.playByPlay.scorecard.balls, 1); assert.equal(actual.playByPlay.scorecard.strikes, 1);
  assert.equal(actual.playByPlay.scorecard.outs, 0);
  assert.equal(event.type, 'ERROR_ADVANCE'); assert.match(event.description, /obstrucción defensiva/);
  assert.equal(event.runsScored, 1); assert.equal(event.outsRecorded, 0);
  assert.equal(actual.playByPlay.fieldingErrors.length, 1);
  assert.equal(actual.playByPlay.fieldingErrors[0].type, 'obstruction');
  assert.equal(actual.playByPlay.fieldingStats.find(row => row.identificationNumber === 'HOME5').errors, 1);
  assert.equal(actual.playByPlay.batterStats.find(row => row.identificationNumber === 'AWAY1').runs, 1);
  assert.equal(actual.playByPlay.batterStats.reduce((sum, row) => sum + row.rbis, 0), 0);
  assert.equal(actual.playByPlay.batterStats.reduce((sum, row) => sum + row.stolenBases, 0), 0);
  assert.equal(actual.playByPlay.pitcherStats[0].pitches, before.playByPlay.pitcherStats[0].pitches);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
  assert.deepEqual(e.get().playByPlay.batterStats, before.playByPlay.batterStats);
  assert.deepEqual(e.get().playByPlay.fieldingStats, before.playByPlay.fieldingStats);
});

for (const strikeoutType of ['swinging', 'looking']) {
  test(`official ${strikeoutType} strikeout preserves counts, pitcher/batter stats, metadata and undo`, () => {
    const e = setup();
    e.play('triple');
    e.command({ kind: 'pitch', value: 'strike' }); e.command({ kind: 'pitch', value: 'strike' });
    const before = e.get();
    e.command({ kind: 'pitch', value: 'strike', strikeoutType });
    const actual = e.get().playByPlay;
    assert.equal(actual.scorecard.log.at(-1).strikeoutType, strikeoutType);
    assert.equal(actual.recentEvents.at(-1).strikeoutType, strikeoutType);
    assert.equal(actual.scorecard.outs, 1);
    assert.equal(actual.scorecard.strikes, 0);
    assert.equal(actual.scorecard.bases[2], 'AWAY0');
    assert.equal(actual.batterStats.find(row => row.identificationNumber === 'AWAY1').strikeouts, 1);
    assert.equal(actual.pitcherStats[0].strikeouts, 1);
    assert.equal(actual.pitcherStats[0].pitches, before.playByPlay.pitcherStats[0].pitches + 1);
    e.send({ undoLast: true });
    assert.deepEqual(e.get().playByPlay.scorecard, before.playByPlay.scorecard);
    assert.deepEqual(e.get().playByPlay.pitcherStats, before.playByPlay.pitcherStats);
    e.command({ kind: 'play', result: 'droppedThirdStrike', thirdStrikeCause: 'passed', strikeoutType });
    const dropped = e.get().playByPlay;
    assert.equal(dropped.scorecard.outs, 0);
    assert.equal(dropped.scorecard.bases[0], 'AWAY1');
    assert.equal(dropped.scorecard.log.at(-1).strikeoutType, strikeoutType);
    assert.equal(dropped.pitcherStats[0].strikeouts, 1);
  });
}
test('official invalid strikeout metadata is rejected atomically', () => {
  const e = setup(), before = e.get();
  for (const scorecardCommand of [
    { kind: 'pitch', value: 'strike', strikeoutType: 'looking' },
    { kind: 'play', result: 'single', strikeoutType: 'looking' },
    { kind: 'pitch', value: 'strike', strikeoutType: 'invalid' }
  ]) {
    bad(() => e.command(scorecardCommand), 400);
    assert.deepEqual(e.get(), before);
  }
});

for (const result of ['single', 'double', 'triple', 'error']) {
test(`official ${result} counts every attributed error in details and totals with undo`, () => {
  const e = setup(), before = e.get();
  bad(() => e.command({ kind: 'play', result: 'error' }), 400);
  bad(() => e.command({ kind: 'play', result: 'error', errors: [{ playerId: 'HOME5', position: 'C', type: 'fielding' }] }), 400);
  assert.deepEqual(e.get(), before);
  e.command({ kind: 'play', result, destinations: { AWAY0: 3 }, rbis: 0, errorOuts: 0, errors: [
    { playerId: 'HOME5', position: 'SS', type: 'fielding' }, { playerId: 'HOME2', position: '1B', type: 'throwing' },
  ] });
  const actual = e.get().playByPlay;
  assert.equal(actual.batterStats[0].hits, result === 'error' ? 0 : 1);
  assert.equal(actual.baseRunners.third, 'AWAY0');
  assert.equal(actual.fieldingStats.reduce((sum, row) => sum + row.errors, 0), 2);
  assert.deepEqual(actual.fieldingErrors.map(row => [row.sequence, row.errorIndex, row.fielderIdentificationNumber, row.position, row.type]), [
    [1, 1, 'HOME5', 'SS', 'fielding'], [1, 2, 'HOME2', '1B', 'throwing']
  ]);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, { ...before.playByPlay.scorecard, clock: e.get().state.clock });
  assert.equal(e.get().state.clock.runningSince, '2026-11-17T02:00:00.000Z');
  assert.deepEqual(e.get().playByPlay.fieldingStats, []);
  assert.deepEqual(e.get().playByPlay.fieldingErrors, []);
});
}

for (const type of ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL']) {
  test(`legacy ${type} requires an active defensive player without changing its route or payload`, () => {
    const e = setup();
    e.play('single');
    const playEvent = { type, ...(type === 'ERROR_ADVANCE' ? { fromBase: 1, toBase: 2, runnerIdentificationNumber: 'AWAY0' } : {}) };
    const before = e.get();
    for (const fielderIdentificationNumber of [undefined, '', 'AWAY5', 'HOME9', 'UNKNOWN']) {
      bad(() => e.send({ playEvent: { ...playEvent, fielderIdentificationNumber } }), 400);
      assert.deepEqual(e.get(), before);
    }
    e.send({ playEvent: { ...playEvent, fielderIdentificationNumber: 'HOME5' } });
    const detail = e.get().playByPlay.fieldingErrors;
    assert.equal(detail.length, 1);
    assert.equal(detail[0].fielderIdentificationNumber, 'HOME5');
    assert.equal(detail[0].position, 'SS');
    assert.equal(detail[0].type, null);
    assert.equal(e.get().playByPlay.fieldingStats[0].errors, 1);
    assert.equal(privateFieldingStats(e.get().playByPlay.scorecard, 'home', 'HOME5').errors, 1);
    assert.equal(isScorecardState(e.get().playByPlay.scorecard), true);
    e.personnel({ kind: 'defense', identificationNumber: 'HOME5', fieldPosition: '2B' });
    assert.equal(e.get().playByPlay.fieldingErrors[0].position, 'SS', 'historical position must not follow later defensive swaps');
    assert.equal(privateFieldingStats(e.get().playByPlay.scorecard, 'home').entries[0].position, 'SS');
  });
}

test('legacy controller aliases still identify the responsible defender', () => {
  const e = setup(), controller = new OfficialScoringController(e.service);
  controller.submitOfficialUpdate('game', { tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    patch: {}, playEvent: { eventType: 'error', fielderId: 'HOME5' } });
  assert.equal(e.get().playByPlay.fieldingErrors[0].fielderIdentificationNumber, 'HOME5');
});

for (const result of ['insideParkHomeRun', 'groundRuleDouble', 'buntHit', 'buntOut', 'intentionalWalk', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference']) {
  test(`official ${result} agrees with shared bases, outs, batting and pitching`, () => {
    const e = setup();
    e.play('triple');
    const before = e.get().playByPlay.scorecard;
    const errorPlay = ['sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference'].includes(result);
    const command = { kind: 'play', result, destinations: minimumDestinations(before, result),
      ...(errorPlay ? { errors: [{ playerId: result === 'catcherInterference' ? 'HOME1' : 'HOME5',
        position: result === 'catcherInterference' ? 'C' : 'SS', type: 'fielding' }], errorOuts: 1 } : {}) };
    const expected = applyPrivateCommand(before, command);
    e.command(command);
    const actual = e.get().playByPlay;
    for (const key of ['bases', 'scores', 'outs', 'indexes', 'log']) assert.deepEqual(actual.scorecard[key], expected[key], key);
    const stats = actual.batterStats.find(row => row.identificationNumber === 'AWAY1');
    const expectedStats = privateStats(expected, 'away', 'AWAY1');
    assert.equal(stats.atBats, expectedStats.atBats);
    assert.equal(stats.hits, expectedStats.hits);
    assert.equal(stats.walks, expectedStats.walks);
    assert.equal(stats.rbis, expectedStats.rbis);
    assert.equal(actual.pitcherStats[0].outsRecorded, expected.outs);
    assert.equal(actual.fieldingErrors.length, errorPlay ? 1 : 0);
    if (errorPlay) assert.equal(actual.fieldingErrors[0].fielderIdentificationNumber, command.errors[0].playerId);
  });
}

for (const thirdStrikeCause of ['wild', 'passed']) test(`official uncaught third strike: ${thirdStrikeCause}, no fabricated out`, () => {
  const e = setup();
  e.play('battedOut'); e.play('battedOut');
  e.command({ kind: 'pitch', value: 'strike' }); e.command({ kind: 'pitch', value: 'strike' });
  e.command({ kind: 'play', result: 'droppedThirdStrike', thirdStrikeCause });
  assert.equal(e.get().state.outs, 2);
  assert.equal(e.get().playByPlay.pitcherStats[0].strikeouts, 1);
  assert.equal(e.get().playByPlay.pitcherStats[0].outsRecorded, 2);
  e.play('homeRun');
  assert.ok(e.get().playByPlay.scorecard.runAccounting.runs.every(run => run.team === (thirdStrikeCause === 'passed' ? 'unearned' : 'earned')));
});

test('official rules are durable in the projection, enforce slowpitch and can be undone before play', () => {
  const e = setup(), before = e.get().playByPlay.scorecard;
  e.command({ kind: 'rules', rules: 'softball-slowpitch' });
  assert.equal(e.get().playByPlay.scorecard.seed.scoringRules, 'softball-slowpitch');
  bad(() => e.play('hitByPitch'), 400);
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.scorecard, before);
  e.command({ kind: 'rules', rules: 'softball-fastpitch' });
  e.play('buntHit');
  bad(() => e.command({ kind: 'rules', rules: 'softball-slowpitch' }), 400);
});

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

for (const role of ['player', 'fan', 'scout']) {
  test(`${role} can observe but cannot score, undo, finish, configure or change personnel`, () => {
    const e = setup();
    const permissions = e.service.getGamePermissions({ gameId: 'game', tournamentId: 'tour', userId: 'HOME0', role });
    assert.equal(permissions.canReadOfficial, true);
    for (const permission of ['canOfficialWrite', 'canPrivateWrite', 'canSubmitLineup', 'canRegisterPlayers']) {
      assert.equal(permissions[permission], false, permission);
    }
    assert.equal(permissions.scoringMode, 'read_only');
    const before = e.get();
    for (const actorId of ['HOME0', 'org', 'scorer']) {
      const actor = { actorId, actorRole: role };
      for (const payload of [
        { scorecardCommand: { kind: 'pitch', value: 'ball' } },
        { scorecardCommand: { kind: 'play', result: 'single' } },
        { scorecardCommand: { kind: 'finish' } },
        { undoLast: true }, { regulationInnings: 9 }, { lastErrorOuts: 1 }, { patch: { homeScore: 100 } }
      ]) bad(() => e.send(payload, actor), 403);
      bad(() => e.personnel({ kind: 'arrival', identificationNumber: 'HOME10' }, 'home', actor), 403);
    }
    assert.deepEqual(e.get(), before);
  });
}

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
    const expected = applyPrivateCommand(before, { kind: 'play', result, destinations: minimumDestinations(before, result),
      ...(result === 'error' ? { errors: [{ playerId: 'HOME5', position: 'SS', type: 'fielding' }] } : {}) });
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
  assert.deepEqual(state.playByPlay.scorecard, { ...before, clock: state.state.clock });
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

for (const actor of [{ actorId: 'scorer', actorRole: 'scorekeeper' }, { actorId: 'org', actorRole: 'organizer' }]) {
  test(`${actor.actorRole}: substitute the fourth batter and swap defense with the seventh without moving their batting slots`, () => {
    const e = setup();
    for (let i = 0; i < 3; i++) e.play('single');
    e.command({ kind: 'pitch', value: 'ball' });
    e.command({ kind: 'pitch', value: 'strike' });
    const before = e.get();
    const initialLineup = structuredClone(e.service.getTeamSheets('game', 'tour', 'org', 'organizer')
      .sheets.find(sheet => sheet.teamId === 'away').initialLineup);
    e.personnel({ kind: 'substitution', outgoingIdentificationNumber: 'AWAY3', incomingIdentificationNumber: 'AWAY9',
      fieldPosition: '2B', jerseyNumber: '10' }, 'away', actor);
    const sheets = e.personnel({ kind: 'defense', identificationNumber: 'AWAY9', fieldPosition: 'LF' }, 'away', actor);
    const actual = e.get();
    const lineup = actual.playByPlay.scorecard.lineups.away;
    assert.deepEqual(lineup.map(player => [player.id, player.order]), [
      ['AWAY0', 1], ['AWAY1', 2], ['AWAY2', 3], ['AWAY9', 4], ['AWAY4', 5], ['AWAY5', 6], ['AWAY6', 7], ['AWAY7', 8], ['AWAY8', 9]
    ]);
    assert.equal(lineup[3].position, 'LF');
    assert.equal(lineup[6].position, '2B');
    assert.equal(lineup[3].jersey, '10');
    assert.equal(actual.state.nextBatterId, 'AWAY9');
    for (const key of ['inning', 'outs', 'balls', 'strikes', 'homeScore', 'awayScore']) assert.equal(actual.state[key], before.state[key], key);
    for (const key of ['indexes', 'bases', 'scores']) assert.deepEqual(actual.playByPlay.scorecard[key], before.playByPlay.scorecard[key], key);
    assert.deepEqual(actual.playByPlay.batterStats, before.playByPlay.batterStats);
    assert.deepEqual(sheets.sheets.find(sheet => sheet.teamId === 'away').initialLineup, initialLineup);
    for (const [userId, role] of [['mgr-home', 'manager'], ['mgr-away', 'manager'], ['scorer', 'scorekeeper'], ['org', 'organizer']]) {
      const observed = e.service.getTeamSheets('game', 'tour', userId, role).sheets.find(sheet => sheet.teamId === 'away');
      assert.equal(observed.lineup[3].battingOrder, 4);
      assert.equal(observed.lineup[6].battingOrder, 7);
      assert.equal(observed.lineup[3].fieldPosition, 'LF');
      assert.equal(observed.initialLineup[3].identificationNumber, 'AWAY3');
    }
    e.play('single');
    assert.equal(e.get().state.nextBatterId, 'AWAY4');
  });
}

test('official personnel rejects order changes atomically instead of silently ignoring them', () => {
  const e = setup();
  const before = e.get();
  const sheets = e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper');
  for (const action of [
    { kind: 'substitution', outgoingIdentificationNumber: 'HOME3', incomingIdentificationNumber: 'HOME9', fieldPosition: '2B', jerseyNumber: '10' },
    { kind: 'defense', identificationNumber: 'HOME3', fieldPosition: 'LF' }
  ]) for (const key of ['order', 'battingOrder']) {
    assert.throws(() => e.personnel({ ...action, [key]: 7 }), error => error.getStatus?.() === 400 && /orden de bateo es fijo/.test(error.message));
  }
  assert.deepEqual(e.get(), before);
  assert.deepEqual(e.service.getTeamSheets('game', 'tour', 'scorer', 'scorekeeper'), sheets);
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

test('official shortstop fly advancing first to second is an ordinary out, never a sacrifice without a run', () => {
  const e = setup();
  e.play('walk');
  const before = e.get(), state = before.playByPlay.scorecard;
  const runner = state.bases[0], batter = require('@playsport/shared').currentBatter(state);
  const command = { kind: 'play', result: 'flyOut', destinations: { [runner]: 2, [batter]: 0 },
    battedBallType: 'fly', fieldingSequence: [6] };
  bad(() => e.command({ ...command, result: 'sacrificeFly' }), 400);
  assert.deepEqual(e.get(), before);
  e.command(command);
  const next = e.get().playByPlay.scorecard;
  assert.equal(next.outs, 1); assert.equal(next.bases[1], runner);
  assert.equal(next.log.at(-1).result, 'flyOut');
  assert.equal(next.log.at(-1).rbis, 0);
  assert.deepEqual(next.log.at(-1).fieldingSequence, [6]);
});

test('official infield fly preserves its declaration in the scorecard and event and undoes only the batter out', () => {
  const e = setup();
  e.play('walk'); e.play('walk');
  const before = e.get().playByPlay.scorecard;
  e.command({ kind: 'play', result: 'flyOut', infieldFly: true });
  const result = e.get();
  assert.equal(result.playByPlay.scorecard.outs, 1);
  assert.deepEqual(result.playByPlay.scorecard.bases, before.bases);
  assert.equal(result.playByPlay.scorecard.log.at(-1).infieldFly, true);
  assert.equal(result.playByPlay.recentEvents.at(-1).infieldFly, true);
  assert.equal(result.playByPlay.recentEvents.at(-1).type, 'FLY_OUT');
  e.send({ undoLast: true, expectedOfficialVersion: result.state.officialVersion });
  assert.deepEqual(e.get().playByPlay.scorecard.bases, before.bases);
  assert.equal(e.get().playByPlay.scorecard.log.at(-1).infieldFly, undefined);
});

test('controller forwards official commands, duration, undo and direct personnel versions', () => {
  const e = setup(), controller = new OfficialScoringController(e.service);
  const update = (operation) => controller.submitOfficialUpdate('game', {
    tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper', expectedOfficialVersion: e.get().state.officialVersion, ...operation
  });
  update({ regulationInnings: 9 });
  update({ scorecardCommand: { kind: 'play', result: 'error', errors: [{ playerId: 'HOME5', position: 'SS', type: 'fielding' }] } });
  update({ lastErrorOuts: 1 });
  update({ undoLast: true });
  assert.equal(e.get().playByPlay.scorecard.log.length, 0);
  controller.recordPersonnelChange('game', 'home', {
    tournamentId: 'tour', actorId: 'org', actorRole: 'organizer', expectedRevision: 1,
    expectedOfficialVersion: e.get().state.officialVersion, action: { kind: 'arrival', identificationNumber: 'HOME10' }
  });
  assert.equal(e.service.getTeamSheets('game', 'tour', 'mgr-home', 'manager').sheets.find((s) => s.teamId === 'home').presentSubstitutes.length, 2);
});
