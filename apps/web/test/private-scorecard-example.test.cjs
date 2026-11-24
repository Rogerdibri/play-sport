const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { applyPrivateCommand, readPrivateSave, replayPrivate, undoPrivateCommand } = require('../app/demo/[slug]/private-scorecard');

test('recorded two-out selection preserves its ordered retirements across save and undo', () => {
  const { scorecardPracticeCommands, privateInningSummary, privateStats } = require('@playsport/shared');
  const { seed } = createPrivateScorecardExample(), commands = scorecardPracticeCommands(seed, 'selectionTwoOutsRecorded');
  const state = replayPrivate(seed, commands), batter = seed.lineups.away[3].id;
  assert.equal(state.outs, 2); assert.equal(state.bases[0], batter); assert.equal(privateStats(state, 'away', batter).hits, 0);
  assert.deepEqual(state.log.at(-1).selectionOuts.map(out => out.base), [4, 3]);
  assert.equal(privateInningSummary(state.log, batter)[0].code, 'FC·DP');
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands }));
  assert.deepEqual(replayPrivate(saved.seed, saved.commands), state);
  assert.deepEqual(undoPrivateCommand(seed, commands).state, replayPrivate(seed, commands.slice(0, -1)));
});

test('selection error exercises are isolated and the recorded example shows two attributed errors without an extra hit', () => {
  const { scorecardPracticeCommands, privateFieldingStats, privateInningSummary, privateStats } = require('@playsport/shared');
  const { seed } = createPrivateScorecardExample(), baseline = structuredClone(seed);
  const commands = scorecardPracticeCommands(seed, 'selectionErrorRecorded'), state = replayPrivate(seed, commands);
  const runner = seed.lineups.away[0].id, batter = seed.lineups.away[1].id;
  assert.deepEqual(state.bases, [null, batter, runner]); assert.equal(state.outs, 0);
  assert.equal(privateFieldingStats(state, 'home').errors, 2);
  assert.equal(privateStats(state, 'away', batter).hits, 0);
  assert.ok(privateInningSummary(state.log, batter).some(entry => entry.code === 'FC+E'));
  assert.equal(replayPrivate(seed, scorecardPracticeCommands(seed, 'selectionError')).log.length, 3);
  assert.deepEqual(seed, baseline);
});

test('the example opens with complete unique lineups, jerseys and recorded offense', () => {
  const { seed, commands } = createPrivateScorecardExample();
  const state = replayPrivate(seed, commands);
  for (const side of ['home', 'away']) {
    assert.equal(seed.lineups[side].length, 9);
    assert.equal(new Set(seed.lineups[side].map((player) => player.position)).size, 9);
    assert.ok(seed.rosters[side].every((player) => /^\d{1,2}$/.test(player.jersey)));
  }
  assert.deepEqual(state.scores, { home: 3, away: 1 });
  assert.equal(state.inning, 1);
  assert.equal(state.side, 'home');
  assert.equal(state.outs, 1);
  assert.equal(state.balls, 1);
  assert.equal(state.strikes, 1);
  assert.deepEqual(state.bases, ['PRUEBA005', null, null]);
  assert.ok(state.log.some((entry) => entry.stolenBy === 'PRUEBA010'));
  assert.ok(state.log.some((entry) => entry.result === 'homeRun'));
});

test('the example supports persistent pitches, undo and local substitutions', () => {
  const { seed, commands } = createPrivateScorecardExample();
  const added = [...commands, { kind: 'pitch', value: 'ball' }];
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands: added }));
  assert.equal(replayPrivate(saved.seed, saved.commands).balls, 2);
  assert.equal(undoPrivateCommand(saved.seed, saved.commands).state.balls, 1);
  const state = applyPrivateCommand(replayPrivate(seed, commands), {
    kind: 'substitution', side: 'home', outId: 'PRUEBA009', inId: 'PRUEBA19', position: 'RF', jersey: '19'
  });
  assert.equal(state.lineups.home.find((player) => player.order === 9).id, 'PRUEBA19');
  assert.equal(createPrivateScorecardExample().seed.lineups.home[8].id, 'PRUEBA009');
});
