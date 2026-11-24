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
test('explicit internal exchange preserves batting and shirts even when the target has no defensive position', () => {
  const original = seed();
  original.lineups.home.push({ ...original.rosters.home[9], order: 10 });
  const before = createPrivateState(original);
  const command = { kind: 'position', side: 'home', playerId: 'H4', position: 'NA', swapWith: 'H10' };
  const after = apply(before, command);
  assert.equal(after.lineups.home[3].position, 'NA');
  assert.equal(after.lineups.home[9].position, '2B');
  assert.deepEqual(after.lineups.home.map(p => [p.id, p.order, p.jersey]), before.lineups.home.map(p => [p.id, p.order, p.jersey]));
  assert.deepEqual(replayPrivate(original, [command]), after);
  assert.deepEqual(undoPrivateCommand(original, [command]).state, before);
  assert.throws(() => apply(before, { ...command, swapWith: 'H11' }), /otro jugador/);
  assert.throws(() => apply(before, { ...command, position: 'P' }), /otro jugador/);
});

test('empty substitution jerseys are exclusive to friendlies; official duplicate and numeric checks remain', () => {
  const command = { kind: 'substitution', side: 'home', outId: 'H1', inId: 'H10', position: 'P', jersey: '' };
  assert.throws(() => apply(fresh(), command), /camiseta válida/);
  assert.throws(() => apply(fresh(), { ...command, jersey: '2' }), /camiseta ya pertenece/);
  assert.doesNotThrow(() => apply(fresh(), { ...command, jersey: '10' }));
  const friendly = seed();
  friendly.friendly = true;
  for (const side of ['home', 'away']) {
    friendly.rosters[side].forEach(p => p.jersey = '');
    friendly.lineups[side].forEach(p => p.jersey = '');
  }
  assert.doesNotThrow(() => apply(createPrivateState(friendly), command));
  assert.throws(() => apply(createPrivateState(friendly), { ...command, jersey: '10' }), /amistosos no usan/);
});

test('softball defaults to a runner on second in both halves of every extra inning, never an added turn or hit', () => {
  const { isScorecardState, privateFieldingStats, privateInningSummary, privateInningEntries } = require('@playsport/shared');
  for (const scoringRules of ['softball-fastpitch', 'softball-modified', 'softball-slowpitch']) {
    const original = { ...seed(), sport: 'softball', scoringRules };
    const commands = Array.from({ length: 42 }, () => ({ kind: 'play', result: 'groundOut' }));
    let state = replayPrivate(original, commands);
    assert.equal(state.seed.softballTieBreakerFromInning, 8);
    assert.equal(state.inning, 8); assert.equal(state.side, 'away');
    assert.deepEqual(state.bases, [null, 'A3', null]); assert.equal(currentBatter(state), 'A4');
    assert.deepEqual([state.outs, state.balls, state.strikes], [0, 0, 0]);
    assert.equal(state.log.length, 42); assert.equal(isScorecardState(state), true);
    assert.equal(privateStats(state, 'away', 'A3').pa, 3);
    assert.equal(privateStats(state, 'away', 'A3').hits, 0);
    assert.equal(privateStats(state, 'away', 'A3').steals, 0);
    assert.equal(privateFieldingStats(state, 'home', 'H1').errors, 0);
    assert.deepEqual(privateInningSummary([state.log.at(-1)], 'A3').map(e => e.code), ['TB']);
    const cell = privateInningEntries(state.log, 'away', 8, 'A3');
    assert.equal(cell.length, 1); assert.equal(cell[0].pitch, null); assert.equal(cell[0].batterId, null);
    assert.equal(cell[0].outs, 0); assert.match(cell[0].text, /^Desempate de softbol/);
    assert.equal(privateInningEntries(state.log, 'home', 8, 'A3').length, 0);
    for (let half = 0; half < 3; half++) {
      for (let out = 0; out < 3; out++) state = play(state, 'groundOut');
      assert.equal(state.side, half % 2 === 0 ? 'home' : 'away');
      assert.equal(state.inning, half === 0 ? 8 : 9);
      assert.equal(state.bases[1], half === 0 ? 'H3' : half === 1 ? 'A6' : 'H6');
      assert.deepEqual(state.bases.filter(Boolean), [state.tieBreakerRunner.runnerId]);
    }
  }
});

test('the automatic runner follows the batting order and current substitutes, not the last out', () => {
  const original = { ...seed(), scoringRules: 'softball-fastpitch' };
  let state = replayPrivate(original, Array.from({ length: 38 }, () => ({ kind: 'play', result: 'groundOut' })));
  state = play(state, 'walk'); state = play(state, 'walk');
  state = apply(state, { kind: 'runner', from: 2, to: 0, action: 'caught' });
  assert.equal(state.log.at(-1).runnerId, 'A3');
  for (let out = 0; out < 2; out++) state = play(state, 'groundOut');
  state = apply(state, { kind: 'substitution', side: 'away', outId: 'A4', inId: 'A10', position: '2B', jersey: '10' });
  state = play(state, 'groundOut');
  assert.equal(currentBatter(state), 'A5');
  assert.equal(state.bases[1], 'A10');
});

test('automatic runs are unearned without a defensive error, even after a homer, relief or runner replacement', () => {
  const original = { ...seed(), sport: 'softball' };
  const commands = Array.from({ length: 42 }, () => ({ kind: 'play', result: 'groundOut' }));
  for (const replacement of [false, true]) {
    let state = replayPrivate(original, commands);
    if (replacement) {
      state = apply(state, { kind: 'substitution', side: 'away', outId: 'A3', inId: 'A10', position: '1B', jersey: '10' });
      state = apply(state, { kind: 'substitution', side: 'home', outId: 'H1', inId: 'H10', position: 'P', jersey: '10' });
    }
    state = play(state, 'homeRun');
    const runs = state.runAccounting.runs.slice(-2);
    assert.equal(runs[0].runnerId, replacement ? 'A10' : 'A3');
    assert.equal(runs[0].team, 'unearned'); assert.equal(runs[0].pitcher, 'unearned');
    assert.equal(runs[1].team, 'earned'); assert.equal(runs[1].pitcher, 'earned');
    assert.equal(state.scores.away, 2);
    assert.equal(state.runAccounting.lostOuts, 0);
    assert.ok(state.log.every(e => !e.errors?.length));
  }
});

test('extra-inning saves reload and undo deterministically while legacy histories are not rewritten', () => {
  const original = { ...seed(), sport: 'softball' };
  const commands = Array.from({ length: 42 }, () => ({ kind: 'play', result: 'groundOut' }));
  const state = replayPrivate(original, commands);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: state.seed, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.equal(undone.state.inning, 7); assert.equal(undone.state.outs, 2);
  assert.equal(undone.state.tieBreakerRunner, undefined);
  assert.deepEqual(apply(undone.state, commands.at(-1)), state);
  const legacy = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands }));
  assert.equal(legacy.seed.softballTieBreakerFromInning, 9);
  let legacyState = replayPrivate(legacy.seed, legacy.commands);
  assert.deepEqual(legacyState.bases, [null, null, null]);
  const same = readPrivateSave(JSON.stringify(legacy));
  assert.deepEqual(same.seed, legacy.seed);
  for (let out = 0; out < 6; out++) legacyState = play(legacyState, 'groundOut');
  assert.equal(legacyState.inning, 9); assert.equal(legacyState.bases[1], 'A6');
  const beforeExtras = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands: commands.slice(0, 41) }));
  assert.equal(beforeExtras.seed.softballTieBreakerFromInning, 8);
  assert.equal(apply(replayPrivate(beforeExtras.seed, beforeExtras.commands), commands.at(-1)).bases[1], 'A3');
});

test('baseball, configured nine-inning softball and decided games do not gain premature automatic runners', () => {
  const commands = Array.from({ length: 42 }, () => ({ kind: 'play', result: 'groundOut' }));
  assert.deepEqual(replayPrivate({ ...seed(), scoringRules: 'baseball' }, commands).bases, [null, null, null]);
  let nine = replayPrivate({ ...seed(), sport: 'softball', regulationInnings: 9 }, commands);
  assert.equal(nine.tieBreakerRunner, undefined);
  for (let out = 0; out < 12; out++) nine = play(nine, 'groundOut');
  assert.equal(nine.inning, 10); assert.equal(nine.bases[1], 'A9'); assert.equal(currentBatter(nine), 'A1');
  const bottomSeven = replayPrivate({ ...seed(), sport: 'softball' }, commands.slice(0, 41));
  const decided = play({ ...bottomSeven, scores: { home: 1, away: 0 } }, 'groundOut');
  assert.equal(decided.tieBreakerRunner, undefined); assert.equal(privateFinishSuggestion(decided).reason, 'completedInning');
  const topEight = replayPrivate({ ...seed(), sport: 'softball' }, commands);
  const homeNeedsToBat = [1, 2, 3].reduce(s => play(s, 'groundOut'), play(topEight, 'homeRun'));
  assert.equal(homeNeedsToBat.side, 'home'); assert.equal(homeNeedsToBat.bases[1], 'H3');
  const walkoff = play({ ...homeNeedsToBat, scores: { home: 1, away: 1 } }, 'homeRun');
  assert.equal(privateFinishSuggestion(walkoff).reason, 'walkOff');
  assert.equal(walkoff.inning, 8); assert.equal(walkoff.side, 'home');
});

test('runner rule outs keep each cause, appeal base, count, batting order and statistics through save and undo', () => {
  const { runnerRuleOutOptions, runnerRuleOutLabels, isScorecardCommand, isScorecardState, privateFieldingStats } = require('@playsport/shared');
  const original = { ...seed(), sport: 'softball', scoringRules: 'softball-fastpitch' };
  const opening = [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' },
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ];
  const before = replayPrivate(original, opening), runner = before.bases[1];
  for (const reason of runnerRuleOutOptions(before)) for (const from of [1, 2, 3]) {
    const ruleOut = { reason, ...(['missedBase', 'missedRetouch'].includes(reason) ? { appealBase: 1 } : {}) };
    const command = { kind: 'runner', action: 'ruleOut', from, to: 0, ruleOut,
      ...(reason === 'other' ? { note: 'Abandonó su recorrido, según decisión arbitral.' } : {}) };
    assert.equal(isScorecardCommand(command), true);
    const state = apply(before, command);
    assert.equal(isScorecardState(state), true);
    assert.equal(state.outs, 1); assert.equal(state.balls, 2); assert.equal(state.strikes, 2);
    assert.deepEqual(state.bases, before.bases.map((id, index) => index === from - 1 ? null : id));
    assert.deepEqual(state.indexes, before.indexes); assert.deepEqual(state.scores, before.scores);
    assert.deepEqual(state.log.at(-1).ruleOut, ruleOut); assert.match(state.log.at(-1).text, new RegExp(runnerRuleOutLabels[reason].split(' (')[0]));
    assert.equal(privateStats(state, 'away', currentBatter(before)).pa, 0);
    assert.equal(privateFieldingStats(state, 'home').errors, 0);
    const commands = [...opening, command], saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
    assert.deepEqual(undoPrivateCommand(saved.seed, saved.commands).state, before);
    assert.equal(privateInningSummary([state.log.at(-1)], before.bases[from - 1])[0].code, 'OR');
  }
  const legacy = apply(before, { kind: 'runner', action: 'ruleOut', from: 2, to: 0 });
  assert.equal(legacy.log.at(-1).ruleOut, undefined);
  assert.deepEqual(privateInningSummary([legacy.log.at(-1)], runner), [{ code: 'OUT', label: 'Out del corredor' }]);
});

test('runner rule out validation rejects incompatible causes, incomplete appeals and metadata on other plays', () => {
  const { isScorecardCommand, runnerRuleOutOptions } = require('@playsport/shared');
  const base = { kind: 'runner', action: 'ruleOut', from: 1, to: 0 };
  for (const ruleOut of [{ reason: 'invented' }, { reason: 'missedBase' }, { reason: 'missedBase', appealBase: 0 },
    { reason: 'missedBase', appealBase: 5 }, { reason: 'missedRetouch', appealBase: 4 },
    { reason: 'runnerInterference', appealBase: 1 }]) assert.equal(isScorecardCommand({ ...base, ruleOut }), false);
  for (const command of [{ ...base, action: 'caught' }, { ...base, to: 2 }, { kind: 'play', result: 'ruleOut' },
    { kind: 'pitch', value: 'ball' }]) assert.equal(isScorecardCommand({ ...command, ruleOut: { reason: 'runnerInterference' } }), false);
  const state = play(fresh(), 'walk');
  assert.equal(runnerRuleOutOptions(state).includes('leftEarly'), false);
  assert.throws(() => apply(state, { ...base, ruleOut: { reason: 'leftEarly' } }), /modalidad/);
  assert.throws(() => apply(state, { ...base, ruleOut: { reason: 'other' }, note: ' ' }), /Describe/);
  for (const scoringRules of ['softball-fastpitch', 'softball-modified', 'softball-slowpitch'])
    assert.equal(runnerRuleOutOptions({ ...state, seed: { ...state.seed, scoringRules } }).includes('leftEarly'), true);
  const third = apply({ ...state, outs: 2 }, { ...base, ruleOut: { reason: 'runnerInterference' } });
  assert.equal(third.side, 'home'); assert.equal(third.outs, 0);
  assert.deepEqual(third.indexes, state.indexes); assert.equal(third.log.at(-1).batterId, null);
});

test('two-out selection enumerates only existing ordered retirements for every base and out pattern', () => {
  const { fieldersChoiceTwoOutOptions, fieldersChoiceDestinationOptions, assertScoringSubmission, isScorecardCommand } = require('@playsport/shared');
  const counts = [0, 0, 0, 3, 0, 4, 8, 9];
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...fresh(), bases: [0, 1, 2].map(index => mask & (1 << index) ? `A${index + 1}` : null),
      indexes: { home: 0, away: 4 }, outs };
    const before = structuredClone(state), batter = currentBatter(state), options = fieldersChoiceTwoOutOptions(state);
    assert.equal(options.length, outs === 2 ? 0 : counts[mask], `${mask}/${outs}`);
    assert.equal(new Set(options.map(option => option.id)).size, options.length);
    for (const option of options) {
      const { selectionOuts, destinations } = option;
      assert.equal(selectionOuts.length, 2); assert.notEqual(selectionOuts[0].runnerId, selectionOuts[1].runnerId);
      let bases = [...state.bases];
      for (const out of selectionOuts) {
        const index = bases.indexOf(out.runnerId);
        assert.ok(index >= 0);
        const forced = bases.slice(0, index + 1).every(Boolean);
        assert.ok(out.base === index + 2 || !forced && out.base === index + 1);
        bases = bases.map(id => id === out.runnerId ? null : id);
      }
      const command = { kind: 'play', result: 'fieldersChoice', destinations, selectionOuts, note: option.label };
      assert.equal(isScorecardCommand(command), true);
      assert.doesNotThrow(() => assertScoringSubmission(state, command));
      const next = apply(state, command);
      assert.equal(next.log.at(-1).outs, 2); assert.equal(next.log.at(-1).result, 'fieldersChoice');
      assert.equal(next.side, outs === 1 ? 'home' : 'away'); assert.equal(next.outs, outs === 1 ? 0 : 2);
      assert.equal(privateStats(next, 'away', batter).hits, 0); assert.equal(privateStats(next, 'away', batter).atBats, 1);
      assert.ok(destinations[batter] > 0);
      assert.equal(privateInningSummary(next.log, batter)[0].code, 'FC·DP');
      for (const [id, value] of Object.entries(destinations)) {
        const allowed = fieldersChoiceDestinationOptions(state, option, destinations, id);
        const retired = selectionOuts.some(out => out.runnerId === id);
        assert.ok(allowed.includes(value));
        if (retired) {
          assert.deepEqual(allowed, [0]);
          assert.ok(privateInningSummary(next.log, id).some(entry => entry.code === 'OUT'));
        } else assert.ok(!allowed.includes(0));
      }
      for (const invalid of [{ ...command, selectionOuts: [...selectionOuts, selectionOuts[0]] },
        { ...command, selectionOuts: [selectionOuts[0], selectionOuts[0]] }, { ...command, result: 'doublePlay' }])
        assert.equal(isScorecardCommand(invalid), false);
      assert.throws(() => apply(state, { ...command, destinations: { ...destinations, [batter]: 0 } }), /dos outs/);
      assert.throws(() => apply({ ...state, outs: 2 }, command), /dos outs/);
    }
    assert.deepEqual(state, before);
  }
  assert.deepEqual(fieldersChoiceTwoOutOptions({ ...fresh(), finished: true, bases: ['A1', 'A2', 'A3'] }), []);
});

test('guided two-out steps project exactly the valid ordered outs and describe the current force', () => {
  const { fieldersChoiceTwoOutOptions, fieldersChoiceTwoOutStepOptions } = require('@playsport/shared');
  const key = out => `${out.runnerId}/${out.base}`;
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...fresh(), bases: [0, 1, 2].map(index => mask & (1 << index) ? `A${index + 1}` : null),
      indexes: { home: 0, away: 4 }, outs };
    const before = structuredClone(state), pairs = fieldersChoiceTwoOutOptions(state);
    const firstOptions = fieldersChoiceTwoOutStepOptions(state);
    assert.deepEqual(firstOptions.map(key), [...new Set(pairs.map(pair => key(pair.selectionOuts[0])))]);
    for (const first of firstOptions) {
      const seconds = fieldersChoiceTwoOutStepOptions(state, first);
      assert.deepEqual(seconds.map(key), [...new Set(pairs.filter(pair => key(pair.selectionOuts[0]) === key(first))
        .map(pair => key(pair.selectionOuts[1])))]);
      for (const [option, bases] of [[first, state.bases], ...seconds.map(second =>
        [second, state.bases.map(id => id === first.runnerId ? null : id)])]) {
        const origin = state.bases.indexOf(option.runnerId) + 1;
        const forced = option.base === origin + 1 && bases.slice(0, origin).every(Boolean);
        assert.equal(option.label, `${forced ? 'Forzado' : option.base === origin ? 'Toque al regresar' : 'Toque al avanzar'} · corredor de ${origin}.ª`);
      }
    }
    assert.deepEqual(fieldersChoiceTwoOutStepOptions(state, { runnerId: 'absent', base: 4 }), []);
    assert.deepEqual(state, before);
  }
  assert.deepEqual(fieldersChoiceTwoOutStepOptions({ ...fresh(), finished: true, bases: ['A1', 'A2', 'A3'] }), []);
});

test('two-out selection uses the last actual out after force removal and never credits RBI on a force double play', () => {
  const { fieldersChoiceTwoOutOptions, fieldersChoiceThirdOut, assertScoringSubmission } = require('@playsport/shared');
  const loaded = play(play(play(fresh(), 'walk'), 'walk'), 'walk');
  const state = play(loaded, 'battedOut'), runner = state.bases[2];
  const options = fieldersChoiceTwoOutOptions(state);
  const homeThird = options.find(option => option.selectionOuts[0].base === 4 && option.selectionOuts[1].base === 3);
  assert.equal(fieldersChoiceThirdOut(state, homeThird.destinations, homeThird.selectionOuts), 'noRuns');
  assert.throws(() => assertScoringSubmission(state, { kind: 'play', result: 'fieldersChoice', ...homeThird, validThirdOutRuns: true }), /no forzado/);
  const reverseForce = options.find(option => option.selectionOuts[0].runnerId === state.bases[0] &&
    option.selectionOuts[1].runnerId === state.bases[1] && option.selectionOuts[1].base === 3);
  assert.match(reverseForce.label, /1.º Out forzado.*2.º Out por toque/);
  const command = { kind: 'play', result: 'fieldersChoice', destinations: { ...reverseForce.destinations, [runner]: 4 },
    selectionOuts: reverseForce.selectionOuts };
  assert.equal(fieldersChoiceThirdOut(state, command.destinations, command.selectionOuts), 'timing');
  assert.doesNotThrow(() => assertScoringSubmission(state, { ...command, validThirdOutRuns: true }));
  assert.equal(apply(state, command).log.at(-1).runs.length, 0);
  const scored = apply(state, { ...command, validThirdOutRuns: true });
  assert.deepEqual(scored.log.at(-1).runs, [runner]); assert.equal(scored.log.at(-1).rbis, 0);
  assert.throws(() => apply(state, { ...command, validThirdOutRuns: true, rbis: 1 }), /impulsadas/);
  const twoForce = fieldersChoiceTwoOutOptions(loaded).find(option => option.selectionOuts[0].base === 3 && option.selectionOuts[1].base === 2);
  const withRun = apply(loaded, { kind: 'play', result: 'fieldersChoice', selectionOuts: twoForce.selectionOuts,
    destinations: { ...twoForce.destinations, [runner]: 4 } });
  assert.equal(withRun.log.at(-1).runs.length, 1); assert.equal(withRun.log.at(-1).rbis, 0);
});

test('selection plus error offers only occupied targets, protects the saved runner and permits actual outs', () => {
  const { fieldersChoiceOptions, fieldersChoiceDestinationOptions, fieldersChoiceThirdOut, privateFieldingStats } = require('@playsport/shared');
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...fresh(), bases: [0, 1, 2].map(index => mask & (1 << index) ? `A${index + 1}` : null),
      indexes: { home: 0, away: 4 }, outs };
    const baseline = structuredClone(state), batter = currentBatter(state);
    const options = fieldersChoiceOptions(state, true);
    assert.deepEqual(options.map(option => option.id),
      fieldersChoiceOptions(state).filter(option => option.outRunnerId).map(option => `error-${option.id}`));
    for (const option of options) {
      assert.match(option.label, /^Error: se evita el out /);
      assert.ok(state.bases.includes(option.errorSavedRunnerId)); assert.equal(option.outRunnerId, null);
      const command = { kind: 'play', result: 'fieldersChoice', errorSavedRunnerId: option.errorSavedRunnerId,
        destinations: option.destinations, errorOuts: 1, rbis: 0,
        errors: [{ playerId: 'H6', position: 'SS', type: 'throwing' }, { playerId: 'H4', position: '2B', type: 'fielding' }] };
      const next = apply(state, command);
      assert.equal(next.outs, outs); assert.equal(next.side, state.side);
      assert.equal(next.log.at(-1).outs, 0); assert.equal(privateStats(next, 'away', batter).hits, 0);
      assert.equal(privateFieldingStats(next, 'home').errors, 2);
      assert.ok(privateInningSummary(next.log, batter).some(entry => entry.code === 'FC+E'));
      assert.ok(privateInningSummary(next.log, option.errorSavedRunnerId).some(entry => entry.code === 'E'));
      if (option.destinations[option.errorSavedRunnerId] === 4)
        assert.equal(next.runAccounting.runs.find(run => run.runnerId === option.errorSavedRunnerId).team, 'unearned');
      else assert.equal(next.runAccounting.runners[option.errorSavedRunnerId]?.extraLife, true);
      assert.equal(fieldersChoiceThirdOut(state, option.destinations), null);
      for (const [id, destination] of Object.entries(option.destinations)) {
        const allowed = fieldersChoiceDestinationOptions(state, option, option.destinations, id);
        assert.ok(allowed.includes(destination), `${mask}/${outs}/${option.id}/${id}`);
        assert.equal(allowed.includes(0), id !== option.errorSavedRunnerId);
      }
      const withOut = { ...option.destinations, [batter]: 0 };
      assert.equal(fieldersChoiceThirdOut(state, withOut), outs === 2 ? 'noRuns' : null);
      const retired = apply(state, { ...command, destinations: withOut });
      assert.equal(retired.log.at(-1).outs, 1);
      if (outs === 2) assert.equal(retired.scores.away, state.scores.away);
      else assert.equal(retired.outs, outs + 1);
      assert.throws(() => apply(state, { ...command, destinations: { ...option.destinations, [option.errorSavedRunnerId]: 0 } }), /a salvo/);
      assert.throws(() => apply(state, { ...command, errorOuts: 0 }), /al menos un out/);
      assert.throws(() => apply(state, { ...command, errorSavedRunnerId: 'A9' }), /corredor/);
      const actualOuts = { ...option.destinations };
      for (const id of Object.keys(actualOuts).filter(id => id !== option.errorSavedRunnerId)) {
        const allowed = fieldersChoiceDestinationOptions(state, option, actualOuts, id);
        const remaining = 3 - outs - Object.values(actualOuts).filter(value => value === 0).length;
        assert.equal(allowed.includes(0), remaining > 0);
        if (allowed.includes(0)) actualOuts[id] = 0;
      }
      assert.doesNotThrow(() => apply(state, { ...command, destinations: actualOuts }));
    }
    assert.deepEqual(state, baseline);
  }
});

test('a saved runner remains unearned after a later home run and repeated errors do not invent extra lost outs', () => {
  const { fieldersChoiceOptions } = require('@playsport/shared');
  const before = play(fresh(), 'single'), option = fieldersChoiceOptions(before, true)[0], runner = before.bases[0];
  const command = { kind: 'play', result: 'fieldersChoice', destinations: option.destinations,
    errorSavedRunnerId: runner, errors: [{ playerId: 'H6', position: 'SS', type: 'fielding' }], errorOuts: 1, rbis: 0 };
  const saved = apply(before, command);
  const repeated = apply(saved, { ...command, destinations: { [runner]: 3, A2: 2, A3: 1 } });
  assert.equal(repeated.runAccounting.lostOuts, 1);
  const scored = play(saved, 'homeRun');
  const run = scored.runAccounting.runs.find(entry => entry.runnerId === runner);
  assert.equal(run.team, 'unearned'); assert.equal(run.pitcher, 'unearned');
  const restored = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands: [{ kind: 'play', result: 'single' }, command] }));
  assert.deepEqual(replayPrivate(restored.seed, restored.commands), saved);
  assert.deepEqual(undoPrivateCommand(restored.seed, restored.commands).state, before);
});

test('contextual selection enumerates exactly the possible force/tag targets in all base and out patterns', () => {
  const { fieldersChoiceOptions, fieldersChoiceDestinationOptions, assertScoringSubmission } = require('@playsport/shared');
  for (let mask = 0; mask < 8; mask++) for (const outs of [0, 1, 2]) {
    const state = { ...fresh(), bases: [0, 1, 2].map(index => mask & (1 << index) ? `A${index + 1}` : null),
      indexes: { home: 0, away: 4 }, outs };
    const before = structuredClone(state), batter = currentBatter(state), options = fieldersChoiceOptions(state);
    const expected = [];
    for (let index = 0; index < 3; index++) if (mask & (1 << index)) {
      expected.push(`out-${index + 1}-${index + 2}`);
      if ((mask & ((1 << (index + 1)) - 1)) !== (1 << (index + 1)) - 1) expected.push(`return-${index + 1}`);
    }
    if (mask) expected.push('safe');
    assert.deepEqual(options.map(option => option.id), expected, `bases=${mask}, outs=${outs}`);
    for (const option of options) {
      const command = { kind: 'play', result: 'fieldersChoice', destinations: option.destinations, note: option.label };
      assert.doesNotThrow(() => assertScoringSubmission(state, command));
      const next = apply(state, command);
      assert.equal(next.log.at(-1).outs, option.outRunnerId ? 1 : 0);
      assert.equal(privateStats(next, 'away', batter).hits, 0);
      if (outs === 2 && option.outRunnerId) {
        assert.equal(next.side, 'home'); assert.deepEqual(next.bases, [null, null, null]);
        assert.deepEqual(next.scores, state.scores);
      }
      for (const [id, value] of Object.entries(option.destinations)) {
        const allowed = fieldersChoiceDestinationOptions(state, option, option.destinations, id);
        assert.ok(allowed.includes(value), `${mask}/${outs}/${option.id}/${id}: default must be valid`);
        if (id === option.outRunnerId) assert.deepEqual(allowed, [0]);
        else {
          assert.ok(!allowed.includes(0));
          assert.ok(allowed.every(destination => destination >= (id === batter ? 1 : state.bases.indexOf(id) + 1)));
        }
        for (const destination of allowed) {
          const moves = { ...option.destinations, [id]: destination };
          const occupied = Object.values(moves).filter(target => target > 0 && target < 4);
          assert.equal(new Set(occupied).size, occupied.length);
          const origins = [batter, ...state.bases.filter(Boolean)].filter(player => moves[player] !== 0);
          assert.deepEqual(origins.map(player => moves[player]), origins.map(player => moves[player]).sort((a, b) => a - b));
          assert.doesNotThrow(() => apply(state, { ...command, destinations: moves }));
          if (outs === 2 && option.forced) assert.ok(!Object.values(moves).includes(4));
        }
      }
    }
    assert.deepEqual(state, before);
  }
});

test('selection examples cover all occupied base patterns and preserve independent saves and historical replay', () => {
  const { scorecardPracticeCommands, scorecardPracticeScenarios, fieldersChoiceOptions, assertScoringSubmission } = require('@playsport/shared');
  const patterns = [];
  for (const scenario of Object.keys(scorecardPracticeScenarios).filter(key => key.startsWith('fieldersChoice'))) {
    const original = seed(), commands = scorecardPracticeCommands(original, scenario);
    const before = replayPrivate(original, commands), option = fieldersChoiceOptions(before)[0];
    patterns.push(before.bases.reduce((mask, id, index) => mask | (id ? 1 << index : 0), 0));
    const history = [...commands, { kind: 'play', result: 'fieldersChoice', destinations: option.destinations, note: option.label }];
    const saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands: history }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), replayPrivate(original, history));
    assert.deepEqual(undoPrivateCommand(original, history).state, before);
  }
  assert.deepEqual(patterns.sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => assertScoringSubmission(fresh(), { kind: 'play', result: 'fieldersChoice' }), /corredores/);
  const occupied = play(fresh(), 'single');
  assert.throws(() => assertScoringSubmission(occupied, { kind: 'play', result: 'fieldersChoice' }), /resultado/);
  assert.doesNotThrow(() => replayPrivate(seed(), [{ kind: 'play', result: 'fieldersChoice' }]));
});

for (const scoringRules of ['baseball', 'softball-fastpitch', 'softball-modified', 'softball-slowpitch']) {
  test(`obstruction preserves count, batter and other runners in ${scoringRules}, with one error for multiple bases`, () => {
    const shared = require('@playsport/shared'), original = { ...seed(), scoringRules };
    const commands = [{ kind: 'play', result: 'single' }, { kind: 'play', result: 'single' },
      { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }];
    const before = replayPrivate(original, commands), runner = before.bases[0];
    const command = { kind: 'runner', action: 'obstruction', from: 1, to: 4, errorOuts: 0,
      errors: [{ playerId: 'H6', position: 'SS', type: 'obstruction' }] };
    const state = apply(before, command);
    assert.deepEqual(state.bases, [null, before.bases[1], null]);
    assert.equal(state.balls, before.balls); assert.equal(state.strikes, before.strikes);
    assert.equal(state.outs, before.outs); assert.equal(currentBatter(state), currentBatter(before));
    assert.equal(state.scores.away, before.scores.away + 1);
    assert.equal(state.log.at(-1).stolenBy, null); assert.equal(state.log.at(-1).rbis, 0);
    assert.equal(shared.privateFieldingStats(state, 'home', 'H6').errors, 1);
    assert.equal(shared.privateFieldingStats(state, 'home').errors, 1);
    assert.deepEqual(privateStats(state, 'away', currentBatter(before)), privateStats(before, 'away', currentBatter(before)));
    assert.ok(privateInningSummary(state.log, runner).some(entry => entry.code === 'AV·OBS'));
    assert.equal(shared.isScorecardState(state), true);
    const history = [...commands, command], saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands: history }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
    assert.deepEqual(undoPrivateCommand(original, history).state, before);
  });
}

test('obstruction rejects missing or multiple defenders, bad destinations and unrelated error attribution without changing state', () => {
  const shared = require('@playsport/shared');
  const state = play(play(fresh(), 'single'), 'single'), before = structuredClone(state);
  const command = { kind: 'runner', action: 'obstruction', from: 1, to: 3, errorOuts: 0,
    errors: [{ playerId: 'H6', position: 'SS', type: 'obstruction' }] };
  for (const invalid of [
    { ...command, errors: undefined }, { ...command, errors: [] },
    { ...command, errors: [...command.errors, ...command.errors] },
    { ...command, errors: [{ playerId: 'H6', position: 'SS', type: 'fielding' }] },
    { ...command, errors: [{ playerId: 'A6', position: 'SS', type: 'obstruction' }] },
    { ...command, errors: [{ playerId: 'H6', position: 'C', type: 'obstruction' }] },
    { ...command, from: 3 }, { ...command, to: 0 }, { ...command, to: 1 }, { ...command, to: 2 },
    { ...command, errorOuts: 2 }, { ...command, action: 'error' }, { ...command, cleanAdvance: true }
  ]) {
    assert.throws(() => apply(state, invalid));
    assert.deepEqual(state, before);
  }
  assert.throws(() => shared.assertScoringSubmission(state, { ...command, errors: undefined }), /defensor/);
  assert.doesNotThrow(() => apply(state, { ...command, errorOuts: undefined }));
});

for (const [strikeoutType, code] of [['swinging', 'K'], ['looking', 'ꓘ']]) {
  test(`${strikeoutType} strikeouts preserve pitches, stats, saves, undo and third-out behavior`, () => {
    const shared = require('@playsport/shared'), original = seed();
    const commands = [{ kind: 'play', result: 'triple' }, { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }];
    const before = replayPrivate(original, commands), batter = currentBatter(before);
    const command = { kind: 'pitch', value: 'strike', strikeoutType };
    const state = apply(before, command);
    assert.equal(state.outs, 1);
    assert.deepEqual(state.bases, before.bases);
    assert.deepEqual(state.scores, before.scores);
    assert.equal(state.balls, 0); assert.equal(state.strikes, 0);
    assert.equal(state.indexes.away, before.indexes.away + 1);
    assert.equal(privateStats(state, 'away', batter).strikeouts, 1);
    assert.equal(privateStats(state, 'away', batter).atBats, 1);
    assert.equal(privateInningSummary(state.log, batter)[0].code, code);
    assert.equal(state.log.at(-1).strikeoutType, strikeoutType);
    assert.match(state.log.at(-1).text, new RegExp(shared.strikeoutLabels[strikeoutType].split(' ')[0]));
    assert.equal(shared.isScorecardState(state), true);
    const history = [...commands, command];
    const saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands: history }));
    assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
    assert.deepEqual(undoPrivateCommand(original, history).state, before);
    const third = apply({ ...before, outs: 2 }, command);
    assert.equal(third.side, 'home');
    assert.equal(third.outs, 0);
    assert.deepEqual(third.bases, [null, null, null]);
    assert.deepEqual(third.scores, before.scores);
    const dropped = play(before, 'droppedThirdStrike', { strikeoutType, thirdStrikeCause: 'passed' });
    assert.equal(dropped.outs, before.outs);
    assert.equal(dropped.bases[0], batter);
    assert.equal(privateInningSummary(dropped.log, batter)[0].code, `${code}·NC`);
    assert.equal(privateStats(dropped, 'away', batter).strikeouts, 1);
  });
}

test('historical and slowpitch-foul strikeouts stay generic; invalid types never mutate state', () => {
  const { isScorecardCommand, isScorecardState } = require('@playsport/shared');
  const before = pitch(pitch(fresh(), 'strike'), 'strike');
  const historical = pitch(before, 'strike'), batter = currentBatter(before);
  assert.equal(historical.log.at(-1).strikeoutType, undefined);
  assert.equal(privateInningSummary(historical.log, batter)[0].code, 'K');
  assert.equal(isScorecardState(historical), true);
  const slow = apply(fresh(), { kind: 'rules', rules: 'softball-slowpitch' });
  const foul = pitch(pitch(pitch(slow, 'strike'), 'strike'), 'foul');
  assert.equal(foul.log.at(-1).result, 'strikeout');
  assert.equal(foul.log.at(-1).strikeoutType, undefined);
  for (const command of [
    { kind: 'pitch', value: 'ball', strikeoutType: 'looking' },
    { kind: 'pitch', value: 'foul', strikeoutType: 'swinging' },
    { kind: 'play', result: 'single', strikeoutType: 'looking' },
    { kind: 'note', note: 'Texto', strikeoutType: 'looking' },
    { kind: 'pitch', value: 'strike', strikeoutType: 'invalid' }
  ]) {
    assert.equal(isScorecardCommand(command), false);
    assert.throws(() => apply(before, command), /inválidos/);
  }
  assert.throws(() => apply(fresh(), { kind: 'pitch', value: 'strike', strikeoutType: 'looking' }), /tercer strike/);
  assert.equal(before.strikes, 2);
  assert.equal(before.outs, 0);
  assert.equal(isScorecardState({ ...historical, log: [{ ...historical.log.at(-1), strikeoutType: 'invalid' }] }), false);
});

function reachHalf(state, inning, side) {
  for (let outs = 0; outs <= inning * 6; outs += 1) {
    if (state.inning === inning && state.side === side) return state;
    state = play(state, 'battedOut');
  }
  assert.fail('The requested half was not reached.');
}

test('new awards preserve batting categories, forced bases and exact ground-rule awards', () => {
  let state = fresh();
  for (let index = 0; index < 3; index++) state = play(state, 'walk');
  const batter = currentBatter(state);
  const walk = play(state, 'intentionalWalk');
  assert.equal(walk.scores.away, 1);
  assert.equal(privateStats(walk, 'away', batter).walks, 1);
  assert.equal(privateStats(walk, 'away', batter).atBats, 0);
  const hr = play(state, 'insideParkHomeRun');
  assert.equal(hr.scores.away, 4);
  assert.equal(privateStats(hr, 'away', batter).homeRuns, 1);
  assert.deepEqual(hr.bases, [null, null, null]);
  const double = play(state, 'groundRuleDouble');
  assert.equal(double.scores.away, 2);
  assert.deepEqual(double.bases, [null, batter, state.bases[0]]);
  assert.throws(() => play(state, 'groundRuleDouble', { destinations: { ...suggestedDestinations(state, 'groundRuleDouble'), [batter]: 3 } }), /reglamentarios/);
});

test('sacrifices with errors require real advances but never create a batter out', () => {
  const errors = [{ playerId: 'H6', position: 'SS', type: 'throwing' }];
  const initial = play(fresh(), 'single');
  const next = play(initial, 'sacrificeBuntError', { errors, errorOuts: 1 });
  assert.equal(next.outs, 0);
  assert.deepEqual(next.bases, ['A2', 'A1', null]);
  assert.equal(privateStats(next, 'away', 'A2').atBats, 0);
  assert.equal(privateStats(next, 'away', 'A2').hits, 0);
  assert.deepEqual(next.log.at(-1).errors, errors);
  assert.match(next.log.at(-1).text, /SS.*Jugador H6.*tiro/);
  const third = play(fresh(), 'triple');
  const fly = play(third, 'sacrificeFlyError', { errors, errorOuts: 1 });
  assert.equal(fly.scores.away, 1);
  assert.equal(fly.outs, 0);
  assert.equal(privateStats(fly, 'away', 'A2').rbis, 1);
  assert.equal(privateStats(fly, 'away', 'A2').atBats, 0);
  assert.throws(() => play(fresh(), 'sacrificeBuntError', { errors }), /sacrificio/);
  assert.throws(() => play({ ...third, outs: 2 }, 'sacrificeFlyError', { errors }), /sacrificio/);
  assert.throws(() => play(third, 'sacrificeFlyError', { errors: [{ ...errors[0], position: 'C' }] }), /defensa activa/);
});

test('uncaught third strikes count a K, not an automatic out, and PB differs from WP', () => {
  for (const thirdStrikeCause of ['wild', 'passed']) {
    let state = play(play(fresh(), 'battedOut'), 'battedOut');
    state = pitch(pitch(state, 'strike'), 'strike');
    const batter = currentBatter(state);
    state = play(state, 'droppedThirdStrike', { thirdStrikeCause });
    assert.equal(state.outs, 2);
    assert.equal(state.bases[0], batter);
    assert.equal(state.strikes, 0);
    assert.equal(privateStats(state, 'away', batter).strikeouts, 1);
    assert.equal(privateStats(state, 'away', batter).atBats, 1);
    assert.equal(state.log.at(-1).errors, undefined);
    state = play(state, 'homeRun');
    assert.ok(state.runAccounting.runs.every(run => run.team === (thirdStrikeCause === 'passed' ? 'unearned' : 'earned')));
  }
  const occupied = pitch(pitch(play(fresh(), 'single'), 'strike'), 'strike');
  assert.throws(() => play(occupied, 'droppedThirdStrike', { thirdStrikeCause: 'wild' }), /primera libre/);
  assert.throws(() => play(fresh(), 'droppedThirdStrike', { thirdStrikeCause: 'wild' }), /dos strikes/);
});

test('interference forces only necessary runners and is neither hit, walk nor sacrifice', () => {
  const state = play(fresh(), 'double');
  const next = play(state, 'catcherInterference', { errors: [{ playerId: 'H2', position: 'C', type: 'fielding' }] });
  assert.deepEqual(next.bases, ['A2', 'A1', null]);
  const stats = privateStats(next, 'away', 'A2');
  assert.equal(stats.pa, 1); assert.equal(stats.atBats, 0); assert.equal(stats.walks, 0); assert.equal(stats.hits, 0);
  assert.equal(next.outs, 0);
});

test('hit plus multiple errors preserves the hit, validates RBIs and survives replay and undo', () => {
  const errors = [
    { playerId: 'H6', position: 'SS', type: 'fielding' },
    { playerId: 'H3', position: '1B', type: 'throwing' },
  ];
  const commands = [{ kind: 'play', result: 'single', errors, destinations: { A1: 3 }, rbis: 0, errorOuts: 0 }];
  const state = replayPrivate(seed(), commands);
  assert.deepEqual(state.bases, [null, null, 'A1']);
  assert.equal(privateStats(state, 'away', 'A1').hits, 1);
  assert.equal(state.log[0].errors.length, 2);
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: seed(), commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
  assert.deepEqual(undoPrivateCommand(seed(), commands).state, fresh());
  assert.throws(() => play(fresh(), 'single', { errors }), /impulsadas/);
});

test('game rules persist and undo without retroactively changing legacy games', () => {
  const rules = { kind: 'rules', rules: 'softball-slowpitch' };
  let state = apply(fresh(), rules);
  for (const result of ['hitByPitch', 'buntHit', 'sacrificeBunt', 'droppedThirdStrike'])
    assert.throws(() => play(state, result), /sóftbol lento/);
  state = pitch(pitch(state, 'strike'), 'strike');
  state = pitch(state, 'foul');
  assert.equal(state.outs, 1);
  assert.throws(() => apply(state, { kind: 'rules', rules: 'baseball' }), /primera anotación/);
  const runner = play(apply(fresh(), rules), 'single');
  assert.throws(() => apply(runner, { kind: 'runner', action: 'steal', from: 1, to: 2 }), /sóftbol lento/);
  assert.deepEqual(undoPrivateCommand(seed(), [rules]).state, fresh());
  assert.equal(play(fresh(), 'error').bases[0], 'A1');
});

test('new sacrifice and interference statistics do not misclassify appearances or total bases', () => {
  const { scorecardStatistics } = require('@playsport/shared');
  for (const [result, position, playerId, SH, SF] of [
    ['sacrificeBuntError', 'SS', 'H6', 1, 0],
    ['sacrificeFlyError', 'SS', 'H6', 0, 1],
    ['catcherInterference', 'C', 'H2', 0, 0],
  ]) {
    const state = play(play(fresh(), 'triple'), result, { errors: [{ playerId, position, type: 'fielding' }] });
    const row = scorecardStatistics(state, 'away', ['A2'], { team: false, startingPitcherIds: [], positions: [],
      caughtStealing: 0, errors: 0, pitchingComplete: true, offenseId: 'away' });
    assert.equal(row.batting.PA, 1); assert.equal(row.batting.AB, 0);
    assert.equal(row.batting.SH, SH, result); assert.equal(row.batting.SF, SF, result);
  }
});

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
    intentionalWalk: 'BBI', insideParkHomeRun: 'HR·DC', groundRuleDouble: '2B·R',
    buntHit: '1B·T', buntOut: 'OUT·T', droppedThirdStrike: 'K·NC',
    sacrificeBuntError: 'SH+E', sacrificeFlyError: 'SF+E', catcherInterference: 'INT·C',
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

test('the button catalog excludes ordinary walks without invalidating historical direct walk commands', () => {
  const { scorecardPlayGroups } = require('@playsport/shared');
  assert.equal(scorecardPlayGroups.some(group => group.results.includes('walk')), false);
  assert.equal(scorecardPlayGroups.some(group => group.results.includes('intentionalWalk')), true);
  const original = seed(), commands = [{ kind: 'play', result: 'walk' }];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed: original, commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  assert.equal(state.bases[0], 'A1'); assert.equal(state.log[0].result, 'walk');
  assert.equal(privateStats(state, 'away', 'A1').walks, 1);
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

test('a bench replacement inherits the fourth slot and an internal swap with the seventh never changes the batting sequence', () => {
  let state = fresh();
  for (let i = 0; i < 3; i++) state = play(state, 'single');
  state = pitch(pitch(state, 'ball'), 'strike');
  const before = structuredClone(state);
  const commands = [
    { kind: 'substitution', side: 'away', outId: 'A4', inId: 'A10', position: '2B', jersey: '10' },
    { kind: 'position', side: 'away', playerId: 'A10', position: 'LF' }
  ];
  for (const command of commands) state = apply(state, command);
  assert.deepEqual(state.lineups.away.map(player => [player.id, player.order]), [
    ['A1', 1], ['A2', 2], ['A3', 3], ['A10', 4], ['A5', 5], ['A6', 6], ['A7', 7], ['A8', 8], ['A9', 9]
  ]);
  assert.equal(state.lineups.away[3].position, 'LF');
  assert.equal(state.lineups.away[6].position, '2B');
  assert.equal(state.lineups.away[3].jersey, '10');
  assert.equal(state.lineups.away[6].jersey, '7');
  assert.equal(currentBatter(state), 'A10');
  for (const key of ['indexes', 'balls', 'strikes', 'outs', 'bases', 'scores']) assert.deepEqual(state[key], before[key], key);
  assert.deepEqual(state.seed.lineups, before.seed.lineups);
  assert.deepEqual(privateStats(state, 'away', 'A1'), privateStats(before, 'away', 'A1'));
  state = play(state, 'single');
  assert.equal(currentBatter(state), 'A5');
  const replayed = replayPrivate(seed(), [
    ...Array.from({ length: 3 }, () => ({ kind: 'play', result: 'single' })),
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }, ...commands, { kind: 'play', result: 'single' }
  ]);
  assert.deepEqual(replayed, state);
});

test('all batting slots survive substitution followed by every possible internal field-position swap', () => {
  for (let slot = 0; slot < 9; slot++) for (let target = 0; target < 9; target++) {
    if (slot === target) continue;
    const initial = fresh();
    const player = initial.lineups.home[slot];
    const other = initial.lineups.home[target];
    const replaced = apply(initial, { kind: 'substitution', side: 'home', outId: player.id, inId: 'H10', position: player.position, jersey: '10' });
    const swapped = apply(replaced, { kind: 'position', side: 'home', playerId: 'H10', position: other.position });
    assert.deepEqual(swapped.lineups.home.map(player => [player.id, player.order]),
      initial.lineups.home.map((player, index) => [index === slot ? 'H10' : player.id, player.order]));
    assert.deepEqual(swapped.indexes, initial.indexes);
    assert.equal(swapped.lineups.home[slot].position, other.position);
    assert.equal(swapped.lineups.home[target].position, player.position);
  }
});

test('substitution and defensive commands reject attempts to supply a new batting order', () => {
  const state = fresh();
  const before = structuredClone(state);
  for (const command of [
    { kind: 'substitution', side: 'home', outId: 'H4', inId: 'H10', position: '2B', jersey: '10' },
    { kind: 'position', side: 'home', playerId: 'H4', position: 'LF' }
  ]) for (const key of ['order', 'battingOrder']) {
    assert.throws(() => apply(state, { ...command, [key]: 7 }), /datos inválidos/);
  }
  assert.deepEqual(state, before);
});

test('received updates can change defense and replace players but cannot reorder active batters or add a batting slot', () => {
  const state = pitch(fresh(), 'ball');
  const before = structuredClone(state);
  const reordered = state.lineups.home.map((player, index) => ({ ...player, order: index === 3 ? 7 : index === 6 ? 4 : player.order }));
  assert.throws(() => apply(state, { kind: 'received-lineup', side: 'home', players: reordered }), /turnos de bateo/);
  assert.throws(() => apply(state, { kind: 'received-lineup', side: 'home', players: [
    ...state.lineups.home, { ...state.seed.rosters.home[9], order: 10 }
  ] }), /turnos de bateo/);
  const valid = state.lineups.home.map((player, index) => index === 3 ? { ...state.seed.rosters.home[9], order: 4, position: 'LF' } :
    index === 6 ? { ...player, position: '2B' } : player);
  const updated = apply(state, { kind: 'received-lineup', side: 'home', players: valid });
  assert.equal(updated.lineups.home[3].id, 'H10');
  assert.equal(updated.lineups.home[3].order, 4);
  assert.equal(updated.lineups.home[6].order, 7);
  assert.deepEqual(updated.indexes, before.indexes);
  assert.equal(updated.balls, before.balls);
  assert.deepEqual(state, before);
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
