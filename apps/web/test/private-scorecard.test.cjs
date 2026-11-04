const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  applyPrivateCommand: apply, createPrivateState, currentBatter, playerName,
  minimumDestinations, playLabels, privateFinishSuggestion, privateInningRuns, privateInningSummary, privateStats, readPrivateSave, replayPrivate, setLastPrivateErrorOuts, suggestedDestinations, undoPrivateCommand
} = require('../app/demo/[slug]/private-scorecard');

function seed() {
  const players = (side) => Array.from({ length: 11 }, (_, i) => ({
    id: `${side}${i + 1}`, name: `Jugador ${side}${i + 1}`, jersey: String(i + 1),
    position: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'NA', 'NA'][i],
    order: i < 9 ? i + 1 : null
  }));
  const home = players('H');
  const away = players('A');
  return {
    names: { home: 'Local', away: 'Visitante' },
    rosters: { home, away }, lineups: {
      home: home.slice(0, 9).map((p) => ({ ...p })),
      away: away.slice(0, 9).map((p) => ({ ...p }))
    },
    courtesyRunnerSource: 'BENCH'
  };
}
const fresh = () => createPrivateState(seed());
const play = (state, result, extra = {}) => apply(state, { kind: 'play', result, ...extra });
const pitch = (state, value) => apply(state, { kind: 'pitch', value });

function reachHalf(state, inning, side) {
  for (let outs = 0; outs <= inning * 6; outs += 1) {
    if (state.inning === inning && state.side === side) return state;
    state = play(state, 'battedOut');
  }
  assert.fail('The requested half was not reached.');
}

test('one-touch error records the play immediately and optional evidence updates that same play', () => {
  const initial = seed();
  const commands = [{ kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'error' }];
  const original = JSON.stringify(commands);
  const before = replayPrivate(initial, commands);
  assert.equal(before.indexes.away, 3);
  assert.equal(before.bases[0], 'A3');
  const updated = setLastPrivateErrorOuts(initial, commands, 1);
  assert.equal(updated.commands.length, commands.length);
  assert.equal(updated.commands.at(-1).errorOuts, 1);
  for (const field of ['outs', 'bases', 'scores', 'indexes', 'balls', 'strikes', 'log']) {
    assert.deepEqual(updated.state[field], before[field]);
  }
  assert.ok(play(updated.state, 'homeRun').runAccounting.runs.every((run) => run.team === 'unearned'));
  assert.equal(JSON.stringify(commands), original);
  const saved = { version: 1, seed: initial, commands: updated.commands };
  assert.deepEqual(readPrivateSave(JSON.stringify(saved)), saved);
  assert.equal(undoPrivateCommand(initial, updated.commands).commands.length, 2);
});

test('optional error evidence can return to pending without adding another play', () => {
  const initial = seed();
  const commands = [{ kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'error', errorOuts: 1 }];
  const updated = setLastPrivateErrorOuts(initial, commands);
  assert.equal(updated.commands.length, 3);
  assert.equal(Object.hasOwn(updated.commands.at(-1), 'errorOuts'), false);
  assert.equal(play(updated.state, 'homeRun').runAccounting.runs.at(-1).team, 'pending');
});

test('error evidence rejects invalid details and cannot edit a different or shared play', () => {
  const initial = seed();
  const commands = [{ kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'error' }];
  const original = JSON.stringify(commands);
  for (const value of [-1, 2, 4, '1', null]) {
    assert.throws(() => setLastPrivateErrorOuts(initial, commands, value));
    assert.equal(JSON.stringify(commands), original);
  }
  assert.throws(() => setLastPrivateErrorOuts(initial, [], 1), /última jugada privada/);
  assert.throws(() => setLastPrivateErrorOuts(initial, [{ kind: 'play', result: 'single' }], 1), /última jugada privada/);
  assert.throws(() => setLastPrivateErrorOuts(initial, [{ ...commands.at(-1), sharedRequestId: 'confirmed' }], 1), /última jugada privada/);
});

test('regulation innings remain optional for old saves and validate the private 7/9 selection', () => {
  const legacy = { version: 1, seed: seed(), commands: [] };
  assert.deepEqual(readPrivateSave(JSON.stringify(legacy)), legacy);
  for (const regulationInnings of [7, 9]) {
    const saved = { ...legacy, seed: { ...seed(), regulationInnings } };
    assert.deepEqual(readPrivateSave(JSON.stringify(saved)), saved);
    assert.equal(createPrivateState(saved.seed).seed.regulationInnings, regulationInnings);
  }
  for (const regulationInnings of [0, -1, 1, 8, 10, '7', null, false, NaN, Infinity]) {
    assert.throws(() => createPrivateState({ ...seed(), regulationInnings }), /no son válidos/);
    assert.throws(() => readPrivateSave(JSON.stringify({ ...legacy, seed: { ...seed(), regulationInnings } })), /formato válido/);
  }
});

test('a home lead suggests closure only after the final top half and never closes or mutates the game', () => {
  let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 1, 'home');
  state = play(state, 'homeRun');
  assert.equal(privateFinishSuggestion(state), null);
  state = reachHalf(state, 7, 'away');
  assert.equal(privateFinishSuggestion(state), null);
  for (let out = 0; out < 2; out += 1) {
    state = play(state, 'battedOut');
    assert.equal(privateFinishSuggestion(state), null);
  }
  state = play(state, 'battedOut');
  const before = JSON.stringify(state);
  assert.deepEqual(privateFinishSuggestion(state), {
    winner: 'home', inning: 7, eventIndex: state.log.length - 1, reason: 'homeAheadAfterTop'
  });
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.finished, false);
  assert.equal(pitch(state, 'ball').balls, 1);
});

test('a visitor lead requires the final bottom half and its third out before suggesting closure', () => {
  let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 7, 'away');
  state = play(state, 'homeRun');
  assert.equal(privateFinishSuggestion(state), null);
  state = reachHalf(state, 7, 'home');
  assert.equal(privateFinishSuggestion(state), null);
  for (let out = 0; out < 2; out += 1) {
    state = play(state, 'battedOut');
    assert.equal(privateFinishSuggestion(state), null);
  }
  state = play(state, 'battedOut');
  assert.equal(state.inning, 8);
  assert.deepEqual(privateFinishSuggestion(state), {
    winner: 'away', inning: 7, eventIndex: state.log.length - 1, reason: 'completedInning'
  });
});

test('walk-off hits and forced runs suggest confirmation without discarding any runs or changing statistics', () => {
  for (const result of ['single', 'double', 'triple', 'homeRun', 'walk', 'hitByPitch', 'error']) {
    let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 7, 'home');
    for (let runner = 0; runner < 3; runner += 1) state = play(state, 'walk');
    assert.equal(privateFinishSuggestion(state), null);
    state = play(state, result);
    assert.equal(privateFinishSuggestion(state).reason, 'walkOff');
    assert.equal(state.finished, false);
    if (result === 'homeRun') {
      assert.equal(state.scores.home, 4);
      assert.equal(privateStats(state, 'home', state.log.at(-1).batterId).rbis, 4);
    }
  }
});

test('the fourth ball can produce the winning run and runner scoring actions can also end a game', () => {
  let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 7, 'home');
  for (let runner = 0; runner < 3; runner += 1) state = play(state, 'walk');
  for (let ball = 0; ball < 3; ball += 1) {
    state = pitch(state, 'ball');
    assert.equal(privateFinishSuggestion(state), null);
  }
  state = pitch(state, 'ball');
  assert.equal(privateFinishSuggestion(state).reason, 'walkOff');
  for (const action of ['advance', 'steal', 'run', 'wild', 'passed', 'balk']) {
    let runnerState = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 7, 'home');
    runnerState = play(runnerState, 'single');
    runnerState = apply(runnerState, { kind: 'runner', action: 'advance', from: 1, to: 3 });
    assert.equal(privateFinishSuggestion(runnerState), null);
    runnerState = apply(runnerState, { kind: 'runner', action, from: 3, to: 4 });
    assert.equal(privateFinishSuggestion(runnerState).reason, 'walkOff');
    assert.equal(runnerState.finished, false);
  }
});

test('a third runner out or automatic strikeout also triggers the final completed-half suggestion', () => {
  for (const finalOut of ['runner', 'strikeout']) {
    let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 7, 'away');
    state = play(state, 'homeRun');
    state = reachHalf(state, 7, 'home');
    state = play(state, 'single');
    state = play(play(state, 'battedOut'), 'battedOut');
    assert.equal(privateFinishSuggestion(state), null);
    if (finalOut === 'runner') state = apply(state, { kind: 'runner', action: 'caught', from: 1, to: 0 });
    else for (let strike = 0; strike < 3; strike += 1) state = pitch(state, 'strike');
    assert.equal(privateFinishSuggestion(state).winner, 'away');
    assert.equal(privateFinishSuggestion(state).reason, 'completedInning');
  }
});

test('tied games remain open through seven innings and extra innings until a winning condition occurs', () => {
  let state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 7 }), 8, 'away');
  assert.equal(privateFinishSuggestion(state), null);
  state = play(state, 'homeRun');
  assert.equal(privateFinishSuggestion(state), null);
  state = reachHalf(state, 8, 'home');
  assert.equal(privateFinishSuggestion(state), null);
  state = play(state, 'homeRun');
  assert.equal(privateFinishSuggestion(state), null);
  state = play(state, 'homeRun');
  assert.equal(privateFinishSuggestion(state).inning, 8);
  assert.equal(privateFinishSuggestion(state).reason, 'walkOff');

  state = reachHalf(createPrivateState({ ...seed(), regulationInnings: 9 }), 10, 'away');
  state = play(state, 'homeRun');
  state = reachHalf(state, 10, 'home');
  state = play(play(play(state, 'battedOut'), 'battedOut'), 'battedOut');
  assert.equal(privateFinishSuggestion(state).inning, 10);
  assert.equal(privateFinishSuggestion(state).winner, 'away');
});

test('nine-inning games do not suggest closing in the seventh and legacy games never assume a duration', () => {
  for (const regulationInnings of [undefined, 9]) {
    let state = reachHalf(createPrivateState({ ...seed(), regulationInnings }), 7, 'home');
    state = play(state, 'homeRun');
    assert.equal(privateFinishSuggestion(state), null);
    state = reachHalf(state, 9, 'away');
    state = play(play(play(state, 'battedOut'), 'battedOut'), 'battedOut');
    if (regulationInnings === 9) assert.equal(privateFinishSuggestion(state).reason, 'homeAheadAfterTop');
    else assert.equal(privateFinishSuggestion(state), null);
  }
});

test('ending suggestions survive personnel updates, saved replay, confirmed closure and corrective undo', () => {
  const initial = { ...seed(), regulationInnings: 7 };
  const commands = [];
  let state = createPrivateState(initial);
  const record = (command) => {
    commands.push(command);
    state = apply(state, command);
  };
  for (let out = 0; out < 3; out += 1) record({ kind: 'play', result: 'battedOut' });
  record({ kind: 'play', result: 'homeRun' });
  while (state.inning < 7 || state.side !== 'home') record({ kind: 'play', result: 'battedOut' });
  const suggestion = privateFinishSuggestion(state);
  assert.equal(suggestion.reason, 'homeAheadAfterTop');
  record({ kind: 'position', side: 'home', playerId: 'H1', position: 'C',
    sharedRequestId: 'position-at-end', teamSheetSide: 'home', teamSheetRevision: 1 });
  assert.deepEqual(privateFinishSuggestion(state), suggestion);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: initial, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
  const beforeClose = structuredClone(state);
  record({ kind: 'finish' });
  assert.equal(state.finished, true);
  assert.equal(privateFinishSuggestion(state), null);
  const reopened = undoPrivateCommand(initial, commands);
  assert.deepEqual(reopened.state, beforeClose);
  assert.deepEqual(privateFinishSuggestion(reopened.state), suggestion);
  const corrected = undoPrivateCommand(initial, reopened.commands);
  assert.equal(privateFinishSuggestion(corrected.state), null);
  assert.equal(corrected.state.inning, 7);
  assert.equal(corrected.state.side, 'away');
  assert.equal(corrected.state.outs, 2);
});

test('batting records and game averages distinguish 3-3, 3-2, 3-1 and 3-0 using official turns', () => {
  for (let hits = 0; hits <= 3; hits += 1) {
    let state = fresh();
    for (let turn = 0; turn < 3; turn += 1) {
      while (state.side !== 'away' || currentBatter(state) !== 'A1') state = play(state, 'battedOut');
      state = play(state, turn < hits ? 'homeRun' : 'battedOut');
    }
    const stats = privateStats(state, 'away', 'A1');
    assert.equal(`${stats.atBats}-${stats.hits}`, `3-${hits}`);
    assert.equal(stats.average, hits === 3 ? '1.000' : (hits / 3).toFixed(3).replace(/^0/, ''));
  }
});

test('game averages stay unavailable without official at-bats and do not treat errors as hits', () => {
  let state = fresh();
  assert.equal(privateStats(state, 'away', 'A1').average, '—');
  state = play(state, 'walk');
  state = play(state, 'hitByPitch');
  state = play(state, 'error');
  assert.equal(privateStats(state, 'away', 'A1').average, '—');
  assert.equal(privateStats(state, 'away', 'A2').average, '—');
  const reachedByError = privateStats(state, 'away', 'A3');
  assert.equal(reachedByError.atBats, 1);
  assert.equal(reachedByError.hits, 0);
  assert.equal(reachedByError.average, '.000');
});

test('line scores distinguish started scoreless halves from halves not yet played', () => {
  let state = fresh();
  assert.equal(privateInningRuns(state, 'away', 1), 0);
  assert.equal(privateInningRuns(state, 'home', 1), null);
  assert.equal(privateInningRuns(state, 'away', 2), null);
  for (let out = 0; out < 3; out += 1) state = play(state, 'battedOut');
  assert.equal(privateInningRuns(state, 'away', 1), 0);
  assert.equal(privateInningRuns(state, 'home', 1), 0);
  for (let out = 0; out < 3; out += 1) state = play(state, 'battedOut');
  assert.equal(privateInningRuns(state, 'away', 2), 0);
  assert.equal(privateInningRuns(state, 'home', 2), null);
  assert.equal(privateInningRuns(state, 'home', 1), 0);
});

test('line scores count hits and independent runner scores in their own half and inning', () => {
  let state = play(fresh(), 'single');
  state = apply(state, { kind: 'runner', action: 'advance', from: 1, to: 4 });
  state = play(state, 'homeRun');
  for (let out = 0; out < 3; out += 1) state = play(state, 'battedOut');
  state = play(play(state, 'single'), 'homeRun');
  for (let out = 0; out < 3; out += 1) state = play(state, 'battedOut');
  state = play(state, 'homeRun');
  assert.equal(privateInningRuns(state, 'away', 1), 2);
  assert.equal(privateInningRuns(state, 'home', 1), 2);
  assert.equal(privateInningRuns(state, 'away', 2), 1);
  assert.equal(privateInningRuns(state, 'home', 2), null);
  assert.equal(privateInningRuns(state, 'away', 1) + privateInningRuns(state, 'away', 2), state.scores.away);
  assert.equal(privateInningRuns(state, 'home', 1), state.scores.home);
});

test('line scores remain consistent through saved replay and undo without changing history', () => {
  const commands = [
    { kind: 'play', result: 'homeRun' },
    ...Array.from({ length: 3 }, () => ({ kind: 'play', result: 'battedOut' })),
    { kind: 'play', result: 'homeRun' }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  const before = JSON.stringify(state);
  assert.equal(privateInningRuns(state, 'away', 1), 1);
  assert.equal(privateInningRuns(state, 'home', 1), 1);
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.equal(privateInningRuns(undone.state, 'away', 1), 1);
  assert.equal(privateInningRuns(undone.state, 'home', 1), 0);
  assert.equal(JSON.stringify(state), before);
});

test('line scores support extra innings and a private close without inventing unplayed halves', () => {
  let state = fresh();
  for (let out = 0; out < 42; out += 1) state = play(state, 'battedOut');
  assert.equal(state.inning, 8);
  state = play(state, 'homeRun');
  state = apply(state, { kind: 'finish' });
  assert.equal(privateInningRuns(state, 'away', 8), 1);
  assert.equal(privateInningRuns(state, 'home', 8), null);
  assert.equal(privateInningRuns(state, 'away', 9), null);
});

test('inning summaries hide intermediate pitches and show automatic walks and strikeouts once', () => {
  let state = pitch(pitch(pitch(fresh(), 'ball'), 'strike'), 'foul');
  assert.deepEqual(privateInningSummary(state.log, 'A1'), []);
  for (let i = 0; i < 3; i += 1) state = pitch(state, 'ball');
  assert.deepEqual(privateInningSummary(state.log, 'A1'), [{ code: 'BB', label: 'Base por bolas' }]);
  for (let i = 0; i < 3; i += 1) state = pitch(state, 'strike');
  assert.deepEqual(privateInningSummary(state.log, 'A2'), [{ code: 'K', label: 'Ponche' }]);
});

test('inning summaries abbreviate every supported batting result, including historical plays', () => {
  const codes = {
    single: '1B', double: '2B', triple: '3B', homeRun: 'HR',
    walk: 'BB', hitByPitch: 'GP', strikeout: 'K', groundOut: 'OUT', flyOut: 'OUT',
    lineOut: 'OUT', battedOut: 'OUT', ruleOut: 'OR', sacrificeFly: 'SF',
    sacrificeBunt: 'SH', error: 'E', fieldersChoice: 'FC', doublePlay: 'DP', triplePlay: 'TP'
  };
  assert.deepEqual(Object.keys(codes).sort(), Object.keys(playLabels).sort());
  for (const [result, code] of Object.entries(codes)) {
    const entry = {
      inning: 1, side: 'away', batterId: 'A1', runnerId: null, result, pitch: null,
      text: playLabels[result], runs: [], outs: 0, stolenBy: null, rbis: 0
    };
    assert.deepEqual(privateInningSummary([entry], 'A1'), [{ code, label: playLabels[result] }]);
    assert.deepEqual(privateInningSummary([entry], 'A2'), []);
  }
});

test('inning summaries retain repeated steals and a run in order without changing their source', () => {
  let state = play(fresh(), 'single');
  state = apply(state, { kind: 'runner', action: 'steal', from: 1, to: 2 });
  state = apply(state, { kind: 'runner', action: 'steal', from: 2, to: 3 });
  state = apply(state, { kind: 'runner', action: 'advance', from: 3, to: 4 });
  const before = JSON.stringify(state);
  assert.deepEqual(privateInningSummary(state.log, 'A1').map((item) => item.code), ['1B', 'BR', 'BR', 'C']);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(privateInningSummary(state.log, 'A2'), []);
});

test('inning summaries credit a run to its runner without assigning the other batter result', () => {
  const state = play(play(fresh(), 'single'), 'homeRun');
  assert.deepEqual(privateInningSummary(state.log, 'A1').map((item) => item.code), ['1B', 'C']);
  assert.deepEqual(privateInningSummary(state.log, 'A2').map((item) => item.code), ['HR', 'C']);
});

test('inning summaries include runner outs without retiring the current batter', () => {
  let state = play(fresh(), 'single');
  state = apply(state, { kind: 'runner', action: 'advanceOut', from: 1, to: 0, attemptedBase: 2 });
  assert.deepEqual(privateInningSummary(state.log, 'A1').map((item) => item.code), ['1B', 'OUT']);
  assert.deepEqual(privateInningSummary(state.log, currentBatter(state)), []);
});

test('inning summaries preserve multiple appearances in the same inning rather than merging their results', () => {
  let state = fresh();
  for (let i = 0; i < 9; i += 1) state = play(state, 'homeRun');
  state = play(state, 'double');
  assert.deepEqual(privateInningSummary(state.log, 'A1').map((item) => item.code), ['HR', 'C', '2B']);
});

test('four balls force only occupied runners, score with loaded bases and advance batting order', () => {
  let state = fresh();
  for (let turn = 0; turn < 4; turn += 1) for (let ball = 0; ball < 4; ball += 1) state = pitch(state, 'ball');
  assert.equal(state.scores.away, 1);
  assert.equal(state.balls, 0);
  assert.equal(state.strikes, 0);
  assert.equal(currentBatter(state), 'A5');
  assert.deepEqual(state.bases, ['A4', 'A3', 'A2']);
  assert.equal(privateStats(state, 'away', 'A4').rbis, 1);
  assert.equal(privateStats(state, 'away', 'A4').walks, 1);
  assert.equal(privateStats(state, 'away', 'A1').atBats, 0);
  assert.equal(state.outs, 0);
  assert.equal(state.log.filter((entry) => entry.result === 'walk').length, 4);
  state = pitch(state, 'ball');
  assert.equal(state.balls, 1);
  assert.equal(currentBatter(state), 'A5');
  assert.equal(state.log.filter((entry) => entry.result === 'walk').length, 4);
});

test('walk does not force an isolated runner at second or third', () => {
  let state = play(fresh(), 'triple');
  for (let ball = 0; ball < 4; ball += 1) state = pitch(state, 'ball');
  assert.deepEqual(state.bases, ['A2', null, 'A1']);
  assert.equal(state.scores.away, 0);
});

test('fouls stop at two strikes and the third strike automatically records one strikeout', () => {
  let state = fresh();
  state = pitch(state, 'ball');
  for (let i = 0; i < 4; i += 1) state = pitch(state, 'foul');
  assert.equal(state.strikes, 2);
  assert.equal(state.outs, 0);
  state = pitch(state, 'strike');
  assert.equal(state.outs, 1);
  assert.equal(state.strikes, 0);
  assert.equal(state.balls, 0);
  assert.equal(currentBatter(state), 'A2');
  assert.equal(privateStats(state, 'away', 'A1').strikeouts, 1);
  assert.equal(state.log.filter((entry) => entry.result === 'strikeout').length, 1);
  state = pitch(state, 'strike');
  assert.equal(state.outs, 1);
  assert.equal(state.strikes, 1);
  assert.equal(currentBatter(state), 'A2');
  assert.equal(state.log.filter((entry) => entry.result === 'strikeout').length, 1);
});

test('hits advance bases, calculate runs and keep per-player statistics', () => {
  const original = fresh();
  const state = ['single', 'double', 'triple', 'homeRun'].reduce((s, result) => play(s, result), original);
  assert.equal(state.scores.away, 4);
  assert.equal(state.scores.home, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(privateStats(state, 'away', 'A3').rbis, 2);
  assert.equal(privateStats(state, 'away', 'A4').homeRuns, 1);
  assert.equal(privateStats(state, 'away', 'A1').average, '1.000');
  assert.equal(original.log.length, 0);
  assert.equal(original.scores.away, 0);
});

test('explicit destinations record actual extra advances instead of assuming them', () => {
  const state = play(play(fresh(), 'double'), 'single', { destinations: { A1: 4, A2: 1 } });
  assert.equal(state.scores.away, 1);
  assert.deepEqual(state.bases, ['A2', null, null]);
  assert.equal(privateStats(state, 'away', 'A2').rbis, 1);
});

test('minimal single destinations keep unforced runners on their bases for every occupancy pattern', () => {
  const expected = [
    ['A4', null, null], ['A4', 'A3', null], ['A4', 'A2', null], ['A4', 'A3', 'A2'],
    ['A4', null, 'A1'], ['A4', 'A3', 'A1'], ['A4', 'A2', 'A1'], ['A4', 'A3', 'A2']
  ];
  for (let mask = 0; mask < 8; mask += 1) {
    const state = ['single', 'single', 'single'].reduce((current, result) => play(current, result), fresh());
    state.bases = state.bases.map((runner, index) => mask & (1 << index) ? runner : null);
    const before = structuredClone(state);
    const next = play(state, 'single', { destinations: minimumDestinations(state, 'single') });
    assert.deepEqual(next.bases, expected[mask], `Occupancy ${mask}`);
    assert.equal(next.scores.away, mask === 7 ? 1 : 0);
    assert.equal(next.outs, 0);
    assert.equal(currentBatter(next), 'A5');
    assert.equal(privateStats(next, 'away', 'A4').hits, 1);
    assert.deepEqual(state, before);
  }
});

test('minimal extra-base hits clear the batter destination without passing or colliding with runners', () => {
  const doubleBases = [
    [null, 'A4', null], [null, 'A4', 'A3'], [null, 'A4', 'A2'], [null, 'A4', 'A3'],
    [null, 'A4', 'A1'], [null, 'A4', 'A3'], [null, 'A4', 'A2'], [null, 'A4', 'A3']
  ];
  const doubleRuns = [0, 0, 0, 1, 0, 1, 1, 2];
  for (let mask = 0; mask < 8; mask += 1) {
    const state = ['single', 'single', 'single'].reduce((current, result) => play(current, result), fresh());
    state.bases = state.bases.map((runner, index) => mask & (1 << index) ? runner : null);
    const double = play(state, 'double', { destinations: minimumDestinations(state, 'double') });
    assert.deepEqual(double.bases, doubleBases[mask]);
    assert.equal(double.scores.away, doubleRuns[mask]);
    for (const result of ['triple', 'homeRun']) {
      const next = play(state, result, { destinations: minimumDestinations(state, result) });
      assert.deepEqual(next.bases, result === 'triple' ? [null, null, 'A4'] : [null, null, null]);
      assert.equal(next.scores.away, state.bases.filter(Boolean).length + (result === 'homeRun' ? 1 : 0));
    }
  }
});

test('minimal hit advances do not change compulsory walk advances or other play suggestions', () => {
  const state = play(fresh(), 'triple');
  for (const result of ['walk', 'hitByPitch', 'groundOut', 'flyOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt']) {
    assert.deepEqual(minimumDestinations(state, result), suggestedDestinations(state, result));
  }
});

test('new minimal destinations replay and undo exactly while old saved hits retain their original advances', () => {
  const original = seed();
  const firstHit = { kind: 'play', result: 'double' };
  const state = apply(createPrivateState(original), firstHit);
  const single = { kind: 'play', result: 'single', destinations: minimumDestinations(state, 'single') };
  assert.deepEqual(single.destinations, { A1: 2, A2: 1 });
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands: [firstHit, single] }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands).bases, ['A2', 'A1', null]);
  assert.deepEqual(undoPrivateCommand(saved.seed, saved.commands).state, state);
  const legacy = readPrivateSave(JSON.stringify({
    version: 1, seed: original, commands: [firstHit, { kind: 'play', result: 'single' }]
  }));
  assert.deepEqual(replayPrivate(legacy.seed, legacy.commands).bases, ['A2', null, 'A1']);
});

test('out after batting records an ordinary at-bat and out without advancing runners or adding a strikeout', () => {
  const state = pitch(pitch(play(fresh(), 'triple'), 'ball'), 'strike');
  const command = { kind: 'play', result: 'battedOut', destinations: minimumDestinations(state, 'battedOut') };
  const next = apply(state, command);
  assert.equal(next.outs, 1);
  assert.equal(currentBatter(next), 'A3');
  assert.equal(next.balls, 0);
  assert.equal(next.strikes, 0);
  assert.deepEqual(next.bases, state.bases);
  assert.deepEqual(next.scores, state.scores);
  assert.equal(next.log.at(-1).text, 'Jugador A2: Out al batear');
  assert.equal(privateStats(next, 'away', 'A2').pa, 1);
  assert.equal(privateStats(next, 'away', 'A2').atBats, 1);
  assert.equal(privateStats(next, 'away', 'A2').hits, 0);
  assert.equal(privateStats(next, 'away', 'A2').strikeouts, 0);
  assert.throws(() => play(state, 'battedOut', { destinations: { A1: 3, A2: 1 } }), /bateador debe quedar eliminado/);
});

test('generic batting outs persist, undo and close the half while older specific outs remain readable', () => {
  const commands = [
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'battedOut' },
    { kind: 'play', result: 'battedOut' },
    { kind: 'play', result: 'battedOut' }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  assert.equal(state.side, 'home');
  assert.equal(state.outs, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.deepEqual(state.scores, { home: 0, away: 0 });
  assert.deepEqual(undoPrivateCommand(saved.seed, saved.commands).state, replayPrivate(seed(), commands.slice(0, -1)));
  const legacy = ['groundOut', 'lineOut', 'flyOut'].map((result) => ({ kind: 'play', result }));
  const old = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands: legacy }));
  assert.deepEqual(old.commands, legacy);
  assert.deepEqual(replayPrivate(old.seed, old.commands).log.map((entry) => entry.result), ['groundOut', 'lineOut', 'flyOut']);
});

test('out by rule needs no reason, retires the batter and does not advance runners or record a strikeout', () => {
  let state = ['walk', 'walk', 'walk'].reduce((current, result) => play(current, result), fresh());
  state = pitch(pitch(state, 'ball'), 'strike');
  const before = structuredClone(state);
  const next = play(state, 'ruleOut');
  assert.equal(next.outs, 1);
  assert.equal(currentBatter(next), 'A5');
  assert.equal(next.balls, 0);
  assert.equal(next.strikes, 0);
  assert.deepEqual(next.bases, before.bases);
  assert.deepEqual(next.scores, before.scores);
  assert.equal(next.log.at(-1).text, 'Jugador A4: Out por regla');
  assert.equal(next.log.at(-1).outs, 1);
  assert.equal(privateStats(next, 'away', 'A4').pa, 1);
  assert.equal(privateStats(next, 'away', 'A4').atBats, 1);
  assert.equal(privateStats(next, 'away', 'A4').strikeouts, 0);
  assert.equal(privateStats(next, 'away', 'A4').hits, 0);
  assert.throws(() => play(state, 'ruleOut', { destinations: { A1: 3, A2: 2, A3: 1, A4: 1 } }), /bateador debe quedar eliminado/);
  assert.deepEqual(state, before);
});

test('out by rule closes each half at the third out and clears the bases without scoring', () => {
  let state = play(fresh(), 'single');
  for (let out = 0; out < 3; out += 1) state = play(state, 'ruleOut');
  assert.equal(state.side, 'home');
  assert.equal(state.inning, 1);
  assert.equal(state.outs, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.deepEqual(state.scores, { home: 0, away: 0 });
  assert.equal(state.log.at(-1).result, 'ruleOut');
  assert.equal(state.log.at(-1).outs, 1);
  for (let out = 0; out < 3; out += 1) state = play(state, 'ruleOut');
  assert.equal(state.side, 'away');
  assert.equal(state.inning, 2);
  assert.equal(currentBatter(state), 'A5');
});

test('out by rule survives save replay and can be undone without losing the previous count or runners', () => {
  const commands = [
    { kind: 'play', result: 'single' },
    { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' },
    { kind: 'play', result: 'ruleOut' }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), replayPrivate(seed(), commands));
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.deepEqual(undone.state, replayPrivate(seed(), commands.slice(0, -1)));
  assert.equal(undone.state.outs, 0);
  assert.equal(undone.state.balls, 1);
  assert.equal(undone.state.strikes, 1);
  assert.deepEqual(undone.state.bases, ['A1', null, null]);
  assert.equal(currentBatter(undone.state), 'A2');
});

test('rejects collisions, incomplete destinations and modified compulsory walk advances atomically', () => {
  const state = play(fresh(), 'single');
  const snapshot = structuredClone(state);
  for (const command of [
    { kind: 'play', result: 'single', destinations: { A1: 1, A2: 1 } },
    { kind: 'play', result: 'single', destinations: { A2: 1 } },
    { kind: 'play', result: 'walk', destinations: { A1: 3, A2: 1 } },
    { kind: 'play', result: 'homeRun', destinations: { A1: 4, A2: 3 } }
  ]) assert.throws(() => apply(state, command));
  assert.deepEqual(state, snapshot);
});

test('three outs clear bases and counts, preserve each team turn and advance full innings', () => {
  let state = play(fresh(), 'single');
  state = pitch(state, 'ball');
  state = ['groundOut', 'flyOut', 'strikeout'].reduce((s, result) => play(s, result), state);
  assert.equal(state.side, 'home');
  assert.equal(state.inning, 1);
  assert.equal(state.outs, 0);
  assert.equal(state.balls, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.equal(currentBatter(state), 'H1');
  for (let i = 0; i < 3; i += 1) state = play(state, 'groundOut');
  assert.equal(state.side, 'away');
  assert.equal(state.inning, 2);
  assert.equal(currentBatter(state), 'A5');
});

test('double and triple plays require the right number of runners and outs', () => {
  assert.throws(() => play(fresh(), 'doublePlay'), /cantidad de eliminados/);
  const double = play(play(fresh(), 'single'), 'doublePlay');
  assert.equal(double.outs, 2);
  assert.deepEqual(double.bases, [null, null, null]);
  const triple = play(play(play(fresh(), 'single'), 'single'), 'triplePlay');
  assert.equal(triple.side, 'home');
  assert.equal(triple.log.at(-1).outs, 3);
  const twoOuts = play(play(play(fresh(), 'groundOut'), 'groundOut'), 'single');
  assert.throws(() => play(twoOuts, 'doublePlay'), /tres/);
});

test('third-out runs require confirmation of timing and a non-forced final out', () => {
  let state = play(play(fresh(), 'single'), 'single');
  state = play(play(state, 'groundOut'), 'groundOut');
  const destinations = { A1: 4, A2: 0, A5: 1 };
  assert.equal(play(state, 'single', { destinations }).scores.away, 0);
  assert.equal(play(state, 'single', { destinations, validThirdOutRuns: true }).scores.away, 1);
  const oneOut = play(play(play(fresh(), 'single'), 'single'), 'groundOut');
  const destinationsDouble = { A1: 4, A2: 0, A4: 0 };
  assert.equal(play(oneOut, 'doublePlay', { destinations: destinationsDouble }).scores.away, 0);
  assert.equal(play(oneOut, 'doublePlay', { destinations: destinationsDouble, validThirdOutRuns: true }).scores.away, 1);
  const twoOuts = play(play(play(fresh(), 'triple'), 'groundOut'), 'groundOut');
  assert.equal(play(twoOuts, 'groundOut', { destinations: { A1: 4, A4: 0 }, validThirdOutRuns: true }).scores.away, 0);
  const stretchingHit = play(twoOuts, 'single', { destinations: { A1: 4, A4: 0 }, validThirdOutRuns: true });
  assert.equal(stretchingHit.scores.away, 1);
});

test('sacrifices and errors do not distort batting average or error RBI', () => {
  let state = play(play(fresh(), 'triple'), 'sacrificeFly');
  assert.equal(state.scores.away, 1);
  assert.equal(privateStats(state, 'away', 'A2').atBats, 0);
  assert.equal(privateStats(state, 'away', 'A2').rbis, 1);
  assert.throws(() => play(fresh(), 'sacrificeFly'), /sacrificio/);
  state = play(state, 'triple');
  state = play(state, 'error');
  assert.equal(privateStats(state, 'away', 'A4').rbis, 0);
  assert.equal(privateStats(state, 'away', 'A4').atBats, 1);
  assert.equal(privateStats(state, 'away', 'A4').hits, 0);
});

test('steals, caught stealing and pickoff do not finish the batter turn or reset the count before third out', () => {
  let state = pitch(play(fresh(), 'single'), 'ball');
  state = pitch(state, 'strike');
  state = apply(state, { kind: 'runner', action: 'steal', from: 1, to: 2 });
  assert.equal(privateStats(state, 'away', 'A1').steals, 1);
  assert.equal(state.balls, 1);
  assert.equal(state.strikes, 1);
  assert.equal(currentBatter(state), 'A2');
  state = apply(state, { kind: 'runner', action: 'caught', from: 2, to: 0 });
  assert.equal(state.outs, 1);
  assert.equal(currentBatter(state), 'A2');
  assert.throws(() => apply(state, { kind: 'runner', action: 'pickoff', from: 1, to: 0 }), /No hay corredor/);
});

test('wild pitch, passed ball and balk advances can score without charging an RBI', () => {
  let state = play(fresh(), 'single');
  for (const [action, from, to] of [['wild', 1, 2], ['passed', 2, 3], ['balk', 3, 4]]) {
    state = apply(state, { kind: 'runner', action, from, to });
  }
  assert.equal(state.scores.away, 1);
  assert.equal(privateStats(state, 'away', 'A1').runs, 1);
  assert.equal(privateStats(state, 'away', 'A2').rbis, 0);
  assert.equal(currentBatter(state), 'A2');
  assert.throws(() => apply(play(fresh(), 'single'), { kind: 'runner', action: 'advance', from: 1, to: 1 }));
});

test('runner out by rule works from every base without retiring the batter or resetting the count', () => {
  for (const [result, from] of [['single', 1], ['double', 2], ['triple', 3]]) {
    const state = pitch(pitch(play(fresh(), result), 'ball'), 'strike');
    const command = { kind: 'runner', action: 'ruleOut', from, to: 0 };
    const next = apply(state, command);
    assert.equal(next.outs, 1);
    assert.equal(next.balls, 1);
    assert.equal(next.strikes, 1);
    assert.equal(currentBatter(next), 'A2');
    assert.deepEqual(next.bases, [null, null, null]);
    assert.deepEqual(next.scores, state.scores);
    assert.equal(next.log.at(-1).runnerId, 'A1');
    assert.equal(next.log.at(-1).batterId, null);
    assert.equal(next.log.at(-1).text, 'Jugador A1: Out por regla');
    assert.deepEqual(privateStats(next, 'away', 'A1'), privateStats(state, 'away', 'A1'));
    assert.deepEqual(privateStats(next, 'away', 'A2'), privateStats(state, 'away', 'A2'));
    assert.throws(() => apply(state, { ...command, to: 4 }), /avance válido o un corredor eliminado/);
    assert.equal(state.bases[from - 1], 'A1');
  }
});

test('runner out by rule closes the half on the third out and survives replay and undo', () => {
  const commands = [
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'groundOut' },
    { kind: 'play', result: 'groundOut' },
    { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' },
    { kind: 'runner', action: 'ruleOut', from: 1, to: 0 }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  assert.equal(state.side, 'home');
  assert.equal(state.outs, 0);
  assert.equal(state.balls, 0);
  assert.equal(state.strikes, 0);
  assert.equal(currentBatter(state), 'H1');
  assert.equal(state.log.at(-1).runnerId, 'A1');
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.deepEqual(undone.state, replayPrivate(seed(), commands.slice(0, -1)));
  assert.equal(undone.state.outs, 2);
  assert.equal(undone.state.balls, 1);
  assert.equal(undone.state.strikes, 1);
  assert.equal(currentBatter(undone.state), 'A4');
  assert.deepEqual(undone.state.bases, ['A1', null, null]);
});

test('runner actions keep the affected player identity for the scorecard, including courtesy runners', () => {
  const state = play(fresh(), 'single');
  for (const action of ['steal', 'caught', 'pickoff', 'advance', 'ruleOut']) {
    const eliminated = ['caught', 'pickoff', 'ruleOut'].includes(action);
    const next = apply(state, { kind: 'runner', action, from: 1, to: eliminated ? 0 : 2 });
    assert.equal(next.log.at(-1).runnerId, 'A1');
  }
  assert.equal(apply(state, { kind: 'courtesy', from: 1, playerId: 'A10' }).log.at(-1).runnerId, 'A1');
});

test('out while advancing retires only the selected runner, preserving hits, other runners and the batter count', () => {
  let state = ['single', 'single', 'single'].reduce((current, result) => play(current, result), fresh());
  state = pitch(pitch(state, 'ball'), 'strike');
  for (const from of [1, 2, 3]) {
    for (let attemptedBase = from + 1; attemptedBase <= 4; attemptedBase += 1) {
      const next = apply(state, { kind: 'runner', action: 'advanceOut', from, to: 0, attemptedBase });
      assert.equal(next.outs, 1);
      assert.equal(next.balls, 1);
      assert.equal(next.strikes, 1);
      assert.equal(currentBatter(next), 'A4');
      assert.deepEqual(next.bases, state.bases.map((runner, index) => index === from - 1 ? null : runner));
      assert.deepEqual(next.scores, state.scores);
      assert.equal(next.log.at(-1).runnerId, state.bases[from - 1]);
      assert.equal(next.log.at(-1).batterId, null);
      assert.equal(next.log.at(-1).result, null);
      assert.ok(next.log.at(-1).text.includes(attemptedBase === 4 ? 'home' : `${attemptedBase}.ª base`));
      for (const id of ['A1', 'A2', 'A3', 'A4']) assert.deepEqual(privateStats(next, 'away', id), privateStats(state, 'away', id));
    }
  }
});

test('out while advancing closes the half on the third out and preserves its attempted base through save and undo', () => {
  const commands = [
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'groundOut' },
    { kind: 'play', result: 'groundOut' },
    { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' },
    { kind: 'runner', action: 'advanceOut', from: 3, to: 0, attemptedBase: 4 }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  assert.equal(saved.commands.at(-1).attemptedBase, 4);
  const state = replayPrivate(saved.seed, saved.commands);
  assert.equal(state.side, 'home');
  assert.equal(state.outs, 0);
  assert.equal(state.balls, 0);
  assert.equal(state.strikes, 0);
  assert.deepEqual(state.bases, [null, null, null]);
  assert.deepEqual(state.scores, { home: 0, away: 0 });
  assert.equal(state.log.at(-1).text, 'Jugador A1: Out al avanzar · intentando llegar a home');
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.deepEqual(undone.state, replayPrivate(seed(), commands.slice(0, -1)));
  assert.equal(undone.state.outs, 2);
  assert.equal(undone.state.balls, 1);
  assert.equal(undone.state.strikes, 1);
});

test('out while advancing rejects missing or invalid destinations and never silently changes an invalid play', () => {
  const state = play(fresh(), 'double');
  const before = structuredClone(state);
  for (const attemptedBase of [undefined, 0, 1, 2, 5, '3']) {
    assert.throws(() => apply(state, { kind: 'runner', action: 'advanceOut', from: 2, to: 0, attemptedBase }), /datos inválidos/);
  }
  assert.throws(() => apply(state, { kind: 'runner', action: 'advanceOut', from: 2, to: 4, attemptedBase: 4 }), /avance válido o un corredor eliminado/);
  assert.throws(() => apply(state, { kind: 'runner', action: 'advanceOut', from: 1, to: 0, attemptedBase: 2 }), /No hay corredor/);
  assert.deepEqual(state, before);
});

test('courtesy runner is roster-bound, restricted by organizer rule and does not change batting order', () => {
  const state = play(fresh(), 'single');
  const lineup = structuredClone(state.lineups);
  const changed = apply(state, { kind: 'courtesy', from: 1, playerId: 'A10' });
  assert.deepEqual(changed.bases, ['A10', null, null]);
  assert.deepEqual(changed.lineups, lineup);
  assert.equal(currentBatter(changed), 'A2');
  assert.throws(() => apply(state, { kind: 'courtesy', from: 1, playerId: 'A3' }), /regla del organizador/);
  assert.throws(() => apply(state, { kind: 'courtesy', from: 1, playerId: 'H10' }), /regla del organizador/);
  const rosterSeed = seed();
  rosterSeed.courtesyRunnerSource = 'ROSTER';
  const allowed = apply(play(createPrivateState(rosterSeed), 'single'), { kind: 'courtesy', from: 1, playerId: 'A3' });
  assert.equal(allowed.bases[0], 'A3');
  const otherPosition = play(play(play(fresh(), 'groundOut'), 'groundOut'), 'single');
  assert.throws(() => apply(otherPosition, { kind: 'courtesy', from: 1, playerId: 'A10' }), /lanzador o receptor/);
});

test('courtesy runner scores under their own identity and stale courtesy links are removed', () => {
  let state = apply(play(fresh(), 'triple'), { kind: 'courtesy', from: 3, playerId: 'A10' });
  state = apply(state, { kind: 'runner', action: 'run', from: 3, to: 4 });
  assert.equal(privateStats(state, 'away', 'A10').runs, 1);
  assert.deepEqual(state.courtesyFor, {});
  assert.equal(privateStats(state, 'away', 'A1').runs, 0);
});

test('a newly received organizer rule applies without rewriting historical courtesy events', () => {
  const initial = seed();
  const commands = [
    { kind: 'play', result: 'single' },
    { kind: 'courtesy', from: 1, playerId: 'A3', sourceRule: 'ROSTER' }
  ];
  const state = replayPrivate(initial, commands);
  assert.equal(state.bases[0], 'A3');
  assert.equal(state.seed.courtesyRunnerSource, 'ROSTER');
  assert.throws(() => apply(state, { kind: 'courtesy', from: 1, playerId: 'A4', sourceRule: 'BENCH' }), /regla del organizador/);
  const updated = apply(state, { kind: 'courtesy', from: 1, playerId: 'A10', sourceRule: 'BENCH' });
  assert.equal(updated.seed.courtesyRunnerSource, 'BENCH');
  assert.equal(initial.courtesyRunnerSource, 'BENCH');
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: initial, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
});

test('substitution preserves the batting slot, inherited count, on-base runner and historical statistics', () => {
  let state = pitch(play(fresh(), 'single'), 'ball');
  state = apply(state, { kind: 'substitution', side: 'away', outId: 'A1', inId: 'A10', position: 'P', jersey: '10' });
  assert.equal(state.lineups.away[0].id, 'A10');
  assert.equal(state.lineups.away[0].order, 1);
  assert.equal(state.bases[0], 'A10');
  assert.equal(state.balls, 1);
  assert.equal(privateStats(state, 'away', 'A1').hits, 1);
  assert.equal(privateStats(state, 'away', 'A10').hits, 0);
  assert.equal(state.seed.lineups.away[0].id, 'A1');
  assert.throws(() => apply(state, { kind: 'substitution', side: 'away', outId: 'A2', inId: 'H10', position: 'C', jersey: '11' }));
  assert.throws(() => apply(state, { kind: 'substitution', side: 'away', outId: 'A2', inId: 'A11', position: 'C', jersey: '3' }));
});

test('defensive changes swap occupied positions without reordering batters or changing bases', () => {
  const state = play(fresh(), 'single');
  const swapped = apply(state, { kind: 'position', side: 'away', playerId: 'A1', position: 'C' });
  assert.equal(swapped.lineups.away[0].position, 'C');
  assert.equal(swapped.lineups.away[1].position, 'P');
  assert.deepEqual(swapped.lineups.away.map((p) => p.order), state.lineups.away.map((p) => p.order));
  assert.deepEqual(swapped.bases, state.bases);
});

test('saved command history replays exactly and undo restores counts, lineup and bases', () => {
  const initial = seed();
  const commands = [
    { kind: 'pitch', value: 'ball' }, { kind: 'play', result: 'single' },
    { kind: 'courtesy', from: 1, playerId: 'A10' },
    { kind: 'position', side: 'home', playerId: 'H1', position: 'C' },
    { kind: 'note', note: 'Incidencia privada' }
  ];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: initial, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), replayPrivate(initial, commands));
  const before = replayPrivate(initial, commands.slice(0, 3));
  const undone = replayPrivate(initial, saved.commands.slice(0, -2));
  assert.deepEqual(undone, before);
});

test('rejects corrupt saves and malformed commands instead of silently resetting', () => {
  assert.throws(() => readPrivateSave('{'), /no se puede leer/);
  for (const commands of [
    [{ kind: 'play', result: 'not-a-result' }],
    [{ kind: 'runner', action: 'steal', from: 0, to: 2 }],
    [{ kind: 'play', result: 'single', destinations: { A1: 8 } }],
    [{ kind: 'position', side: 'home', playerId: 'H1', position: 'INVALID' }],
    [{ kind: 'runner', action: 'run', from: 1, to: 4 }]
  ]) assert.throws(() => readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands })));
});

test('initial lineups reject duplicates, nonconsecutive orders and players outside the roster', () => {
  const duplicate = seed();
  duplicate.lineups.away[1] = { ...duplicate.lineups.away[0], order: 2 };
  assert.throws(() => createPrivateState(duplicate));
  const order = seed();
  order.lineups.home[0].order = 3;
  assert.throws(() => createPrivateState(order));
  const outsider = seed();
  outsider.lineups.home[0].id = 'NOTREGISTERED';
  assert.throws(() => createPrivateState(outsider));
});

test('private seeds and received lineups reject repeated positions without changing the saved state', () => {
  const initial = seed();
  initial.lineups.home.forEach((player) => { player.position = 'P'; });
  assert.throws(() => createPrivateState(initial), /posiciones repetidas/);
  const state = fresh();
  const before = structuredClone(state);
  assert.throws(() => apply(state, {
    kind: 'received-lineup', side: 'home', players: initial.lineups.home
  }), /posiciones repetidas/);
  assert.deepEqual(state, before);
});

test('private changes cannot duplicate the designated hitter slot', () => {
  const initial = seed();
  initial.lineups.home[0].position = 'DH';
  const state = createPrivateState(initial);
  assert.throws(() => apply(state, {
    kind: 'position', side: 'home', playerId: 'H2', position: 'DH'
  }), /ya está ocupado/);
});

test('private close blocks changes and can be undone by replay without changing official state', () => {
  const commands = [{ kind: 'pitch', value: 'ball' }, { kind: 'finish' }];
  const state = replayPrivate(seed(), commands);
  assert.equal(state.finished, true);
  assert.throws(() => pitch(state, 'ball'), /cerrado/);
  assert.equal(replayPrivate(seed(), commands.slice(0, -1)).finished, false);
  assert.equal(replayPrivate(seed(), commands.slice(0, -1)).balls, 1);
});

test('missing opponent lineup records explicitly unidentified turns, never fabricated roster members', () => {
  const initial = seed();
  initial.lineups.away = [];
  let state = createPrivateState(initial);
  const id = currentBatter(state);
  assert.match(playerName(state, id), /sin identificar/);
  state = play(state, 'single');
  assert.equal(state.bases[0], 'unknown:away:1');
  assert.equal(currentBatter(state), 'unknown:away:2');
  assert.deepEqual(suggestedDestinations(state, 'double'), { 'unknown:away:1': 3, 'unknown:away:2': 2 });
});

test('received lineups and confirmed movements preserve private pitches and replay revision markers', () => {
  const initial = seed();
  initial.lineups.home = [];
  const commands = [
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' },
    { kind: 'received-lineup', side: 'home', players: seed().lineups.home, sharedRequestId: 'initial:home', teamSheetSide: 'home', teamSheetRevision: 1 },
    { kind: 'substitution', side: 'home', outId: 'H1', inId: 'H10', position: 'P', jersey: '10', sharedRequestId: 'game:1', teamSheetSide: 'home', teamSheetRevision: 2 }
  ];
  const state = replayPrivate(initial, commands);
  assert.equal(state.balls, 1);
  assert.equal(state.strikes, 1);
  assert.equal(state.scores.home, 0);
  assert.equal(state.lineups.home[0].id, 'H10');
  assert.equal(state.seed.teamSheetRevisions.home, 2);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: initial, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
});

test('confirmed personnel remains receivable after private close without reopening the scoring', () => {
  const closed = apply(fresh(), { kind: 'finish' });
  const state = apply(closed, {
    kind: 'position', side: 'home', playerId: 'H1', position: 'C',
    sharedRequestId: 'game:2', teamSheetSide: 'home', teamSheetRevision: 2
  });
  assert.equal(state.finished, true);
  assert.equal(state.lineups.home[0].position, 'C');
  assert.throws(() => pitch(state, 'ball'), /cerrado/);
});

test('undo removes only private actions and retains confirmed personnel and its revision', () => {
  const initial = seed();
  const commands = [
    { kind: 'pitch', value: 'ball' },
    { kind: 'position', side: 'home', playerId: 'H1', position: 'C', sharedRequestId: 'game:2', teamSheetSide: 'home', teamSheetRevision: 2 }
  ];
  const undone = undoPrivateCommand(initial, commands);
  assert.equal(undone.state.balls, 0);
  assert.equal(undone.state.lineups.home[0].position, 'C');
  assert.equal(undone.state.seed.teamSheetRevisions.home, 2);
  assert.equal(undone.commands.length, 1);
  assert.throws(() => undoPrivateCommand(initial, undone.commands), /No hay jugadas privadas/);
  const closed = [...commands, { kind: 'finish' }, {
    kind: 'note', note: 'Directivo confirmado', sharedRequestId: 'game:3', teamSheetSide: 'home', teamSheetRevision: 3
  }];
  assert.equal(undoPrivateCommand(initial, closed).state.finished, false);
});
