const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { applyPrivateCommand, createPrivateState, currentBatter, isScorecardCommand, isScorecardState,
  privateInningSummary, readPrivateSave, replayPrivate, scorecardPracticeCommands, scorecardStatistics, scoringSacrificeRestriction, undoPrivateCommand } = require('@playsport/shared');
const initial = () => createPrivateState(createPrivateScorecardExample().seed);
const statistics = state => scorecardStatistics(state, 'away', state.seed.rosters.away.map(player => player.id), {
  team: true, startingPitcherIds: [], positions: [], caughtStealing: 0, errors: 0, pitchingComplete: true, offenseId: 'away'
});

test('a defensive sequence preserves order and repetitions without determining the number of outs', () => {
  for (const sequence of [[6, 3], [4, 6, 3], [3, 6, 3], [8]]) {
    const state = initial(), id = currentBatter(state);
    const next = applyPrivateCommand(state, { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: sequence });
    assert.equal(next.outs, 1);
    assert.deepEqual(next.log.at(-1).fieldingSequence, sequence);
    assert.match(next.log.at(-1).text, new RegExp(`vía ${sequence.join('-')}`));
    const cell = privateInningSummary(next.log, id)[0];
    assert.equal(cell.code, sequence.join('-'));
    assert.match(cell.label, /Rolling \/ rodado/);
    assert.ok(cell.label.includes(`vía ${sequence.join('-')}`));
    assert.equal(isScorecardState(JSON.parse(JSON.stringify(next))), true);
    assert.equal(state.outs, 0);
    assert.equal(statistics(next).fielding.A, null, 'A sequence alone cannot allocate assists or individual putouts');
  }
});

test('a caught line or fly records only the actual catching fielder and preserves identity through save, summary and undo', () => {
  const { defensivePlayerAt } = require('@playsport/shared'), seed = initial().seed;
  const opening = scorecardPracticeCommands(seed, 'caughtBall'), before = replayPrivate(seed, opening);
  for (const [result, type, position] of [['lineOut', 'line', 6], ['flyOut', 'fly', 8]]) {
    const fielder = defensivePlayerAt(before, position), batter = currentBatter(before);
    const caughtBy = { playerId: fielder.id, position };
    const command = { kind: 'play', result, battedBallType: type, fieldingSequence: [position], caughtBy };
    const next = applyPrivateCommand(before, command);
    assert.equal(next.outs, 1); assert.deepEqual(next.bases, before.bases);
    assert.deepEqual(next.log.at(-1).caughtBy, caughtBy);
    assert.equal(privateInningSummary(next.log, batter)[0].code, String(position));
    assert.ok(privateInningSummary(next.log, batter)[0].label.includes(fielder.name));
    assert.equal(statistics(next).batting.AB, 1); assert.equal(statistics(next).batting.K, 0);
    assert.equal(statistics(next).batting[type === 'line' ? 'LO' : 'FO'], 1);
    const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands: [...opening, command] }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), next);
    assert.deepEqual(undoPrivateCommand(seed, saved.commands).state, before);
    assert.equal(isScorecardState(JSON.parse(JSON.stringify(next))), true);
    const legacy = applyPrivateCommand(before, { kind: 'play', result, battedBallType: type, fieldingSequence: [4, position] });
    assert.equal(legacy.log.at(-1).caughtBy, undefined);
  }
});

test('catch identity rejects extra routes, unrelated results, inactive defenders and extra outs without mutating the state', () => {
  const { defensivePlayerAt } = require('@playsport/shared');
  const before = applyPrivateCommand(initial(), { kind: 'play', result: 'walk' });
  const command = { kind: 'play', result: 'lineOut', battedBallType: 'line', fieldingSequence: [6],
    caughtBy: { playerId: defensivePlayerAt(before, 6).id, position: 6 } };
  for (const patch of [{ caughtBy: null }, { caughtBy: { playerId: '', position: 6 } },
    { caughtBy: { playerId: 'x', position: '6' } }, { fieldingSequence: [4, 6] },
    { fieldingSequence: [3] }, { result: 'doublePlay' }, { result: 'ruleOut' }])
    assert.equal(isScorecardCommand({ ...command, ...patch }), false);
  assert.throws(() => applyPrivateCommand(before, { ...command, caughtBy: { playerId: 'not-active', position: 6 } }), /defensa activa/);
  assert.throws(() => applyPrivateCommand(before, { ...command, destinations: { [currentBatter(before)]: 0, [before.bases[0]]: 0 } }), /solo al bateador/);
  assert.equal(before.outs, 0);
});

test('batter rule-out causes preserve runners, official at-bats, explanations, save/replay and undo without adding strikeouts', () => {
  const { batterRuleOutLabels, privateStats } = require('@playsport/shared');
  const seed = initial().seed, opening = scorecardPracticeCommands(seed, 'batterRuleOut');
  const before = replayPrivate(seed, opening), batter = currentBatter(before);
  for (const reason of Object.keys(batterRuleOutLabels)) {
    const detail = { reason, umpireConfirmed: true, ...(reason === 'battingOutOfTurn' ? { appealConfirmed: true } : {}) };
    const command = { kind: 'play', result: 'ruleOut', batterRuleOut: detail,
      ...(reason === 'intentionalDrop' ? { battedBallType: 'line' } : {}),
      ...(reason === 'other' ? { note: 'Decisión arbitral de prueba: negativa a ocupar el turno.' } : {}) };
    const next = applyPrivateCommand(before, command);
    assert.equal(next.outs, 1); assert.deepEqual(next.bases, before.bases);
    assert.equal(next.log.at(-1).batterId, batter);
    assert.deepEqual(next.log.at(-1).batterRuleOut, detail);
    assert.ok(privateInningSummary(next.log, batter)[0].label.includes(batterRuleOutLabels[reason]));
    assert.equal(privateStats(next, 'away', batter).atBats, 1);
    assert.equal(privateStats(next, 'away', batter).strikeouts, 0);
    assert.equal(next.log.at(-1).rbis, 0); assert.deepEqual(next.log.at(-1).runs, []);
    assert.equal(statistics(next).batting.LO, reason === 'intentionalDrop' ? 1 : 0);
    assert.equal(statistics(next).batting.FO, 0);
    const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands: [...opening, command] }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), next);
    assert.deepEqual(undoPrivateCommand(seed, saved.commands).state, before);
    assert.equal(isScorecardState(JSON.parse(JSON.stringify(next))), true);
    assert.equal(applyPrivateCommand({ ...before, outs: 2 }, { ...command,
      ...(reason === 'intentionalDrop' ? { batterRuleOut: { reason: 'outsideBox', umpireConfirmed: true }, battedBallType: undefined } : {}) }).side, 'home');
  }
  assert.equal(applyPrivateCommand(before, { kind: 'play', result: 'ruleOut' }).log.at(-1).batterRuleOut, undefined);
  const fly = applyPrivateCommand(before, { kind: 'play', result: 'ruleOut',
    batterRuleOut: { reason: 'intentionalDrop', umpireConfirmed: true }, battedBallType: 'fly', fieldingSequence: [6] });
  assert.equal(statistics(fly).batting.FO, 1);
  assert.equal(privateInningSummary(fly.log, batter)[0].code, 'OR·6');
});

test('rule-out metadata rejects false decisions, mismatched kinds, unsupported contacts, runner changes and incomplete appeals', () => {
  const command = { kind: 'play', result: 'ruleOut', batterRuleOut: { reason: 'batterInterference', umpireConfirmed: true } };
  for (const detail of [null, {}, { reason: 'unknown', umpireConfirmed: true }, { reason: 'outsideBox', umpireConfirmed: false },
    { reason: 'outsideBox', umpireConfirmed: 'true' }, { reason: 'outsideBox', umpireConfirmed: true, appealConfirmed: true },
    { reason: 'battingOutOfTurn', umpireConfirmed: true }])
    assert.equal(isScorecardCommand({ ...command, batterRuleOut: detail }), false);
  for (const patch of [{ kind: 'note', note: 'test' }, { kind: 'runner', action: 'ruleOut', from: 1, to: 0 },
    { result: 'flyOut' }, { battedBallType: 'ground', fieldingSequence: [6] }, { infieldFly: true },
    { strikeoutType: 'looking' }, { validThirdOutRuns: true }])
    assert.equal(isScorecardCommand({ ...command, ...patch }), false);
  const before = applyPrivateCommand(initial(), { kind: 'play', result: 'walk' }), batter = currentBatter(before), runner = before.bases[0];
  for (const to of [0, 2, 3, 4])
    assert.throws(() => applyPrivateCommand(before, { ...command, destinations: { [batter]: 0, [runner]: to } }), /conserva los corredores/);
  assert.throws(() => applyPrivateCommand(before, { ...command, batterRuleOut: { reason: 'other', umpireConfirmed: true } }), /Describe la causa/);
  const drop = { ...command, batterRuleOut: { reason: 'intentionalDrop', umpireConfirmed: true }, battedBallType: 'fly' };
  assert.throws(() => applyPrivateCommand(initial(), drop), /primera ocupada/);
  assert.throws(() => applyPrivateCommand({ ...before, outs: 2 }, drop), /menos de dos outs/);
  for (const type of [undefined, 'ground', 'bunt']) assert.equal(isScorecardCommand({ ...drop, battedBallType: type }), false);
});

test('preparing a timely batting-order appeal undoes the improper turn but retains preceding independent PB advances', () => {
  const seed = initial().seed;
  const opening = [{ kind: 'play', result: 'walk' }, { kind: 'runner', action: 'passed', from: 1, to: 2 }];
  const before = replayPrivate(seed, opening), properBatter = currentBatter(before);
  const prepared = undoPrivateCommand(seed, [...opening, { kind: 'play', result: 'single' }]);
  assert.deepEqual(prepared.state, before);
  const appealed = applyPrivateCommand(prepared.state, { kind: 'play', result: 'ruleOut',
    batterRuleOut: { reason: 'battingOutOfTurn', umpireConfirmed: true, appealConfirmed: true } });
  assert.equal(appealed.log.at(-1).batterId, properBatter); assert.equal(appealed.outs, 1);
  assert.deepEqual(appealed.bases, before.bases); assert.equal(appealed.log.at(-2).text.includes('Bola pasada'), true);
  assert.equal(statistics(appealed).batting.H, 0);
});

test('declared infield fly records IFF, one batter out and an official at-bat without inventing a catch or runner advances', () => {
  const seed = initial().seed, opening = scorecardPracticeCommands(seed, 'infieldFly');
  const before = replayPrivate(seed, opening), batter = currentBatter(before);
  const command = { kind: 'play', result: 'flyOut', infieldFly: true };
  const next = applyPrivateCommand(before, command);
  assert.equal(next.outs, 1); assert.deepEqual(next.bases, before.bases);
  assert.equal(next.log.at(-1).infieldFly, true);
  assert.equal(next.log.at(-1).fieldingSequence, undefined);
  assert.equal(privateInningSummary(next.log, batter)[0].code, 'IFF');
  assert.equal(statistics(next).batting.AB, 1); assert.equal(statistics(next).batting.FO, 1);
  assert.equal(statistics(next).batting.H, 0); assert.equal(statistics(next).batting.SF, 0);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands: [...opening, command] }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), next);
  assert.equal(isScorecardState(JSON.parse(JSON.stringify(next))), true);
  assert.deepEqual(undoPrivateCommand(seed, saved.commands).state, before);
  const routed = applyPrivateCommand(before, { ...command, battedBallType: 'fly', fieldingSequence: [6] });
  assert.equal(privateInningSummary(routed.log, batter)[0].code, 'IFF·6');
  const legacy = applyPrivateCommand(before, { kind: 'play', result: 'flyOut' });
  assert.equal(legacy.log.at(-1).infieldFly, undefined);
});

test('infield fly rejects ineligible bases, two outs, other play types and automatic extra outs', () => {
  const command = { kind: 'play', result: 'flyOut', infieldFly: true };
  for (const bases of [[null, null, null], ['a', null, null], [null, 'b', 'c'], ['a', null, 'c']])
    assert.throws(() => applyPrivateCommand({ ...initial(), bases }, command), /primera y segunda/);
  const before = replayPrivate(initial().seed, scorecardPracticeCommands(initial().seed, 'infieldFly'));
  assert.throws(() => applyPrivateCommand({ ...before, outs: 2 }, command), /menos de dos outs/);
  const batter = currentBatter(before), [first, second] = before.bases;
  assert.throws(() => applyPrivateCommand(before, { ...command, destinations: { [batter]: 0, [first]: 0, [second]: 2 } }), /solo elimina al bateador/);
  for (const patch of [{ infieldFly: false }, { infieldFly: 'true' }, { result: 'ruleOut' }, { result: 'sacrificeFly' },
    { kind: 'note', note: 'test' }, { battedBallType: 'ground', fieldingSequence: [6] }])
    assert.equal(isScorecardCommand({ ...command, ...patch }), false);
  for (const loaded of [false, true]) for (const outs of [0, 1]) {
    const state = loaded ? applyPrivateCommand(before, { kind: 'play', result: 'walk' }) : before;
    assert.equal(applyPrivateCommand({ ...state, outs }, command).outs, outs + 1);
  }
});

test('UI and engine share sacrifice requirements; advancing to second does not remove the batter official at-bat', () => {
  const before = applyPrivateCommand(initial(), { kind: 'play', result: 'walk' });
  const runner = before.bases[0], batter = currentBatter(before);
  const moves = { [runner]: 2, [batter]: 0 };
  for (const result of ['sacrificeFly', 'sacrificeFlyError']) {
    assert.match(scoringSacrificeRestriction(before, result, moves), /carrera anotada/);
    assert.equal(scoringSacrificeRestriction(before, result, { ...moves, [runner]: 4 }), null);
    assert.match(scoringSacrificeRestriction({ ...before, outs: 2 }, result, { ...moves, [runner]: 4 }), /menos de dos outs/);
  }
  for (const result of ['sacrificeBunt', 'sacrificeBuntError']) {
    assert.equal(scoringSacrificeRestriction(before, result, moves), null);
    assert.match(scoringSacrificeRestriction(before, result, { ...moves, [runner]: 1 }), /avance/);
    assert.match(scoringSacrificeRestriction({ ...before, outs: 2 }, result, moves), /menos de dos outs/);
  }
  const command = { kind: 'play', result: 'flyOut', destinations: moves, battedBallType: 'fly', fieldingSequence: [6] };
  assert.throws(() => applyPrivateCommand(before, { ...command, result: 'sacrificeFly' }), /carrera anotada/);
  const next = applyPrivateCommand(before, command);
  assert.equal(statistics(next).batting.SF, 0); assert.equal(statistics(next).batting.AB, 1);
  assert.equal(next.outs, 1); assert.equal(next.bases[1], runner);
  assert.deepEqual(before.bases, [runner, null, null]);
});

test('typed double plays preserve eliminated players, restore through replay and undo, and count GIDP once', () => {
  const seed = initial().seed, first = { kind: 'play', result: 'walk' }, state = replayPrivate(seed, [first]);
  const batter = currentBatter(state), runner = state.bases[0];
  const command = { kind: 'play', result: 'doublePlay', battedBallType: 'ground', fieldingSequence: [3, 6, 1],
    destinations: { [batter]: 0, [runner]: 0 } };
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands: [first, command] }));
  const next = replayPrivate(saved.seed, saved.commands);
  assert.equal(next.outs, 2);
  assert.deepEqual(next.bases, [null, null, null]);
  assert.deepEqual(next.log.at(-1).fieldingSequence, [3, 6, 1]);
  assert.equal(statistics(next).batting.GO, 1);
  assert.equal(statistics(next).batting.GIDP, 1);
  assert.equal(privateInningSummary(next.log, batter)[0].code, 'DP·3-6-1');
  assert.deepEqual(undoPrivateCommand(seed, [first, command]).state, state);
});

test('types are classified without fabricating historical sequences or statistics for unknown outs', () => {
  for (const [result, type, metric] of [['groundOut', 'ground', 'GO'], ['lineOut', 'line', 'LO'], ['flyOut', 'fly', 'FO'], ['buntOut', 'bunt', 'BO']]) {
    const next = applyPrivateCommand(initial(), { kind: 'play', result, battedBallType: type, fieldingSequence: [6] });
    assert.equal(statistics(next).batting[metric], 1);
    assert.equal(statistics(next).batting.GIDP, 0);
  }
  const legacy = applyPrivateCommand(initial(), { kind: 'play', result: 'battedOut' });
  assert.equal(legacy.log[0].fieldingSequence, undefined);
  assert.equal(statistics(legacy).batting.GO, null);
  assert.equal(statistics(legacy).batting.LO, null);
  const knownLegacy = applyPrivateCommand(initial(), { kind: 'play', result: 'lineOut' });
  assert.equal(statistics(knownLegacy).batting.LO, 1);
  assert.equal(knownLegacy.log[0].fieldingSequence, undefined);
});

test('selection and runner outs retain routes without converting the safe batter into an out or inventing a batted ball', () => {
  const before = applyPrivateCommand(initial(), { kind: 'play', result: 'walk' });
  const batter = currentBatter(before), runner = before.bases[0];
  const selection = { kind: 'play', result: 'fieldersChoice', destinations: { [batter]: 1, [runner]: 0 },
    battedBallType: 'ground', fieldingSequence: [6, 4] };
  const next = applyPrivateCommand(before, selection);
  assert.equal(next.outs, 1); assert.equal(next.bases[0], batter);
  assert.equal(statistics(next).batting.GO, 0); assert.equal(statistics(next).batting.GIDP, 0);
  assert.equal(privateInningSummary(next.log, batter)[0].code, 'FC·6-4');
  assert.equal(isScorecardState(JSON.parse(JSON.stringify(next))), true);
  for (const [action, fieldingSequence] of [['caught', [2, 4]], ['pickoff', [1, 3]], ['advanceOut', [8, 6, 2]]]) {
    const command = { kind: 'runner', action, from: 1, to: 0, fieldingSequence,
      ...(action === 'advanceOut' ? { attemptedBase: 4 } : {}) };
    const state = applyPrivateCommand(before, command);
    assert.equal(state.outs, 1);
    assert.equal(state.log.at(-1).battedBallType, undefined);
    assert.deepEqual(state.log.at(-1).fieldingSequence, fieldingSequence);
    assert.equal(privateInningSummary(state.log, runner).at(-1).code, `OUT·${fieldingSequence.join('-')}`);
    assert.equal(isScorecardState(JSON.parse(JSON.stringify(state))), true);
  }
  assert.equal(isScorecardCommand({ kind: 'runner', action: 'steal', from: 1, to: 2, fieldingSequence: [2, 4] }), false);
  assert.equal(isScorecardCommand({ kind: 'runner', action: 'ruleOut', from: 1, to: 0, fieldingSequence: [2, 4] }), false);
});

test('the reusable selection-route exercise records one forced selection out and two separate runner outs', () => {
  const seed = initial().seed, commands = scorecardPracticeCommands(seed, 'selectionRoutes');
  const practice = scorecardPracticeCommands(seed, 'selectionRoutePractice');
  assert.deepEqual(practice, [{ kind: 'play', result: 'walk' }]);
  assert.equal(replayPrivate(seed, practice).outs, 0);
  assert.ok(replayPrivate(seed, practice).bases[0]);
  const before = replayPrivate(seed, commands.slice(0, 1)), batter = currentBatter(before);
  const selected = replayPrivate(seed, commands.slice(0, 2));
  assert.equal(selected.outs, 1); assert.equal(selected.bases[0], batter);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  assert.deepEqual(state.log.map(entry => entry.outs), [0, 1, 1, 0, 1]);
  assert.deepEqual(state.log.filter(entry => entry.fieldingSequence).map(entry => entry.fieldingSequence), [[6, 4], [2, 6], [1, 3]]);
  assert.equal(statistics(state).batting.GO, 0); assert.equal(statistics(state).batting.GIDP, 0);
  assert.equal(undoPrivateCommand(seed, commands).state.outs, 2);
});

test('malformed, incomplete and contradictory defensive metadata is rejected rather than ignored', () => {
  const command = { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] };
  for (const patch of [
    { fieldingSequence: [] }, { fieldingSequence: [0] }, { fieldingSequence: [11] }, { fieldingSequence: ['6', '3'] },
    { fieldingSequence: [1.5] }, { fieldingSequence: Array(2) }, { fieldingSequence: Array(21).fill(6) }, { fieldingSequence: undefined },
    { battedBallType: undefined }, { battedBallType: 'fly' }, { result: 'walk' }, { kind: 'note', note: 'test' },
    { kind: 'pitch', value: 'strike', result: undefined }
  ]) {
    const invalid = { ...command, ...patch };
    assert.equal(isScorecardCommand(invalid), false, JSON.stringify(patch));
    assert.throws(() => applyPrivateCommand(initial(), invalid));
  }
  const state = applyPrivateCommand(initial(), command);
  state.log[0].fieldingSequence = [99];
  assert.equal(isScorecardState(state), false);
});

test('position ten needs a softball extra fielder and a bunt cannot hide behind double-play classification in slowpitch', () => {
  const command = { kind: 'play', result: 'flyOut', battedBallType: 'fly', fieldingSequence: [10] };
  assert.throws(() => applyPrivateCommand(initial(), command), /posición 10/);
  const softball = initial();
  softball.seed.sport = 'softball'; softball.seed.scoringRules = 'softball-fastpitch';
  assert.throws(() => applyPrivateCommand(softball, command), /posición 10/);
  softball.lineups.home[8].position = 'OF4';
  assert.equal(applyPrivateCommand(softball, command).outs, 1);
  const slow = applyPrivateCommand(applyPrivateCommand(initial(), { kind: 'rules', rules: 'softball-slowpitch' }), { kind: 'play', result: 'walk' });
  assert.throws(() => applyPrivateCommand(slow, { kind: 'play', result: 'doublePlay', battedBallType: 'bunt', fieldingSequence: [5, 4, 3] }), /toque/i);
});
