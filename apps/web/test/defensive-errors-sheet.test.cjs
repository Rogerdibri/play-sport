const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { default: DefensiveErrorsSheet } = require('../app/demo/[slug]/defensive-errors-sheet');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const {
  applyPrivateCommand, createPrivateState, isScorecardState, privateFieldingStats, privateInningSummary,
  readPrivateSave, replayPrivate, scorecardPracticeCommands, undoPrivateCommand
} = require('@playsport/shared');

test('the reusable example separates batting results from each defensive player and team error total', () => {
  const { seed } = createPrivateScorecardExample();
  const commands = scorecardPracticeCommands(seed, 'errors');
  const state = replayPrivate(seed, commands);
  const ss = seed.lineups.home.find(player => player.position === 'SS');
  const first = seed.lineups.home.find(player => player.position === '1B');
  const batter = seed.lineups.away.find(player => player.order === 1);
  assert.equal(privateFieldingStats(state, 'home').errors, 3);
  assert.equal(privateFieldingStats(state, 'away').errors, 1);
  assert.equal(privateFieldingStats(state, 'home', ss.id).errors, 2);
  assert.equal(privateFieldingStats(state, 'home', first.id).errors, 1);
  assert.equal(privateFieldingStats(state, 'away', batter.id).errors, 0);
  assert.equal(privateInningSummary(state.log.filter(entry => entry.side === 'away'), batter.id)[0].code, '1B+E');
  const html = renderToStaticMarkup(React.createElement(DefensiveErrorsSheet, { state, side: 'home' }));
  assert.match(html, /Defensa · Errores por entrada/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /Entrada 1/);
  assert.match(html, /SS · Error de tiro/);
  assert.match(html, /1B · Error de tiro/);
  assert.equal(isScorecardState(state), true);
});

test('saved examples and undo retain team attribution without double counting', () => {
  const { seed } = createPrivateScorecardExample();
  const commands = scorecardPracticeCommands(seed, 'errors');
  const saved = readPrivateSave(JSON.stringify({ version: 1, seed, commands }));
  const state = replayPrivate(saved.seed, saved.commands);
  assert.equal(privateFieldingStats(state, 'away').errors, 1);
  const undone = undoPrivateCommand(saved.seed, saved.commands);
  assert.equal(privateFieldingStats(undone.state, 'away').errors, 0);
  assert.equal(privateFieldingStats(undone.state, 'home').errors, 3);
});

test('the isolated obstruction example names the defender and shows its cause instead of a fielding or throwing misplay', () => {
  const { seed } = createPrivateScorecardExample();
  const commands = scorecardPracticeCommands(seed, 'obstruction'), state = replayPrivate(seed, commands);
  assert.deepEqual(state.bases, [null, seed.lineups.away[0].id, null]);
  assert.equal(state.balls, 1); assert.equal(state.strikes, 1); assert.equal(state.outs, 0);
  assert.equal(privateFieldingStats(state, 'home').errors, 1);
  const html = renderToStaticMarkup(React.createElement(DefensiveErrorsSheet, { state, side: 'home' }));
  assert.match(html, /SS · Error por obstrucción defensiva/);
  assert.match(html, /Avance por obstrucción defensiva/);
  assert.doesNotMatch(html, /Error de fildeo|Error de tiro/);
});

test('historical unattributed errors never become false zeroes or invented defenders', () => {
  const { seed } = createPrivateScorecardExample();
  const state = replayPrivate(seed, [{ kind: 'play', result: 'error' }]);
  assert.equal(privateFieldingStats(state, 'home').errors, 1);
  assert.equal(privateFieldingStats(state, 'home').unattributed, 1);
  assert.equal(privateFieldingStats(state, 'home', seed.lineups.home[0].id).errors, null);
  const html = renderToStaticMarkup(React.createElement(DefensiveErrorsSheet, { state, side: 'home' }));
  assert.match(html, /Sin atribuir/);
  assert.match(html, /Sin posición registrada/);
  assert.match(html, /Tipo no registrado/);
  const incomplete = { ...state, fieldingIncomplete: true };
  assert.equal(privateFieldingStats(incomplete, 'home').errors, null);
  assert.equal(isScorecardState(incomplete), true);
});

test('runner errors show offensive advancement without charging the runner; WP and PB do not count as errors', () => {
  const { seed } = createPrivateScorecardExample();
  let state = applyPrivateCommand(createPrivateState(seed), { kind: 'play', result: 'single' });
  state = applyPrivateCommand(state, { kind: 'runner', from: 1, to: 2, action: 'wild' });
  state = applyPrivateCommand(state, { kind: 'runner', from: 2, to: 3, action: 'passed' });
  assert.equal(privateFieldingStats(state, 'home').errors, 0);
  const id = state.bases[2];
  state = applyPrivateCommand(state, { kind: 'runner', from: 3, to: 4, action: 'error', errorOuts: 0,
    errors: [{ playerId: seed.lineups.home[5].id, position: 'SS', type: 'throwing' }] });
  assert.equal(privateFieldingStats(state, 'home').errors, 1);
  assert.equal(privateFieldingStats(state, 'away', id).errors, 0);
  assert.ok(privateInningSummary(state.log, id).some(entry => entry.code === 'AV·E'));
});
