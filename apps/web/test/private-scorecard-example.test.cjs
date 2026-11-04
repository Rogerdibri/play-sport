const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { applyPrivateCommand, readPrivateSave, replayPrivate, undoPrivateCommand } = require('../app/demo/[slug]/private-scorecard');

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
