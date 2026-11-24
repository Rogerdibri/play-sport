const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = resolve(__dirname, '../../..');
const hermes = join(root, 'node_modules/react-native/sdks/hermesc/osx-bin/hermes');

test('installed Hermes executes native preparation, attributed errors, PB, persistence and undo', {
  skip: process.platform !== 'darwin' || !existsSync(hermes)
}, () => {
  const modules = {};
  const add = (name, filename) => {
    modules[name] = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES5, downlevelIteration: true, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText;
  };
  for (const name of ['scorecard', 'earned-runs', 'game-clock', 'visual-theme', 'game-final-review', 'registration', 'venezuela']) {
    add(`shared/${name}`, join(root, `packages/shared/src/${name}.ts`));
  }
  for (const name of ['polyfills', 'scoring-controls', 'scoring-practice', 'defensive-errors-sheet', 'game-clock']) {
    add(`native/${name}`, join(root, `apps/mobile/${name}.${name === 'polyfills' ? 'ts' : 'tsx'}`));
  }
  const ungap = require.resolve('@ungap/structured-clone');
  for (const filename of readdirSync(resolve(ungap, '..')).filter(name => name.endsWith('.js'))) {
    modules[`ungap/${filename.slice(0, -3)}`] = readFileSync(resolve(ungap, '..', filename), 'utf8');
  }
  const source = `
var factories = {${Object.entries(modules).map(([id, code]) => `${JSON.stringify(id)}: function(module, exports, require) {${code}\n}`).join(',\n')}};
var cache = {};
function load(id) {
  if (id === 'react' || id === 'react/jsx-runtime' || id === '@react-native-async-storage/async-storage') return {};
  if (id === 'react-native') return { StyleSheet: { create: function(styles) { return styles; } } };
  if (id === '@playsport/shared') return Object.assign({}, load('shared/scorecard'), load('shared/visual-theme'));
  if (id === '@ungap/structured-clone') return load('ungap/index');
  if (cache[id]) return cache[id].exports;
  if (!factories[id]) throw new Error('Missing fixture module: ' + id);
  var module = { exports: {} }; cache[id] = module;
  factories[id](module, module.exports, function(name) {
    if (name[0] !== '.') return load(name);
    return load(id.slice(0, id.lastIndexOf('/') + 1) + name.replace(/^\\.\\//, '').replace(/\\.js$/, ''));
  });
  return module.exports;
}
function check(condition, message) { if (!condition) throw new Error(message); }
load('native/polyfills');
check(typeof structuredClone === 'function', 'Hermes cloning is unavailable');
var engine = load('shared/scorecard'), prepare = load('native/scoring-controls').prepareNativeScoringCommand;
var seed = load('native/scoring-practice').nativeScoringPracticeSeed();
var original = engine.createPrivateState(seed);
var command = prepare(original, { kind: 'play', result: 'error', rbis: 0,
  errors: [{ playerId: 'native-practice-home-6', position: 'SS', type: 'fielding' }] });
var state = engine.applyPrivateCommand(original, command);
check(original.bases[0] === null, 'Cloning mutated the original state');
check(state.bases[0] === 'native-practice-away-1' && state.outs === 0, 'Error destinations differ on Hermes');
check(state.log[state.log.length - 1].errors[0].position === 'SS', 'Error attribution was lost');
var saved = engine.readPrivateSave(JSON.stringify({ version: 1, seed: seed, commands: [command] }));
check(JSON.stringify(engine.replayPrivate(saved.seed, saved.commands)) === JSON.stringify(state), 'Persistence replay differs');
var linked = engine.linkScorecardParticipant(seed, { side: 'away', playerId: 'native-practice-away-1', identification: 'v 0012345678' });
check(linked.rosters.away[0].identification === 'V-12345678', 'Participant identity normalization differs on Hermes');
check(engine.readPrivateSave(JSON.stringify({ version: 1, seed: linked, commands: [command] })).seed.lineups.away[0].identification === 'V-12345678', 'Linked participant persistence differs');
check(seed.rosters.away[0].identification === undefined, 'Linking mutated the original seed');
check(engine.undoPrivateCommand(saved.seed, saved.commands).state.bases[0] === null, 'Undo differs');
state = engine.replayPrivate(seed, [{ kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }]);
command = prepare(state, { kind: 'play', result: 'droppedThirdStrike', thirdStrikeCause: 'passed' });
state = engine.applyPrivateCommand(state, command);
check(state.bases[0] === 'native-practice-away-1' && state.outs === 0, 'PB third strike invented an out');
check(engine.privateStats(state, 'away', 'native-practice-away-1').strikeouts === 1, 'Strikeout missing');
state = engine.replayPrivate(seed, engine.scorecardPracticeCommands(seed, 'errors'));
check(engine.privateFieldingStats(state, 'home').errors === 3, 'Home defensive total differs on Hermes');
check(engine.privateFieldingStats(state, 'away').errors === 1, 'Away defensive total differs on Hermes');
check(engine.privateFieldingStats(state, 'home', 'native-practice-home-6').errors === 2, 'Repeated defender errors differ');
check(engine.privateFieldingStats(state, 'away', 'native-practice-away-1').errors === 0, 'Error charged to batter');
state = engine.replayPrivate(seed, engine.scorecardPracticeCommands(seed, 'obstruction'));
check(state.bases[1] === 'native-practice-away-1' && state.outs === 0 && state.balls === 1 && state.strikes === 1, 'Obstruction changed the count or awarded the wrong base');
check(engine.privateFieldingStats(state, 'home', 'native-practice-home-6').errors === 1, 'Obstruction must charge one error');
check(engine.privateInningSummary(state.log, 'native-practice-away-1')[1].code === 'AV·OBS', 'Obstruction cause was lost');
state = engine.replayPrivate(seed, engine.scorecardPracticeCommands(seed, 'strikeouts'));
check(state.outs === 2 && state.strikes === 2, 'Strikeout practice counts differ on Hermes');
check(engine.privateInningSummary(state.log, 'native-practice-away-1')[0].code === 'K', 'Swinging K differs');
check(engine.privateInningSummary(state.log, 'native-practice-away-2')[0].code === 'ꓘ', 'Looking K differs');
check(state.bases[0] === 'native-practice-away-3', 'Uncaught third strike invented an out');
command = prepare(state, { kind: 'pitch', value: 'strike', strikeoutType: 'looking' });
state = engine.applyPrivateCommand(state, command);
check(state.side === 'home' && state.outs === 0, 'Looking third out did not change sides');
var twoOutCommands = engine.scorecardPracticeCommands(seed, 'selectionTwoOutsRecorded');
state = engine.replayPrivate(seed, twoOutCommands);
check(state.outs === 2 && state.bases[0] === 'native-practice-away-4', 'Two-out selection retired the batter on Hermes');
check(state.log[state.log.length - 1].selectionOuts[0].base === 4, 'Ordered retirements were lost on Hermes');
check(engine.privateInningSummary(state.log, 'native-practice-away-4')[0].code === 'FC·DP', 'Selection double-play marker missing on Hermes');
saved = engine.readPrivateSave(JSON.stringify({ version: 1, seed: seed, commands: twoOutCommands }));
check(JSON.stringify(engine.replayPrivate(saved.seed, saved.commands)) === JSON.stringify(state), 'Selection replay differs on Hermes');
check(engine.undoPrivateCommand(seed, twoOutCommands).state.outs === 0, 'Selection undo differs on Hermes');
var clockEngine = load('shared/game-clock');
var clock = clockEngine.startOrResumeGameClock(undefined, '2026-11-17T00:00:00.000Z');
clock = clockEngine.changeGameClock(clock, 'pause', '2026-11-17T00:00:10.000Z');
clock = clockEngine.startOrResumeGameClock(clock, '2026-11-17T00:01:40.000Z');
check(clockEngine.gameClockElapsed(clock, Date.parse('2026-11-17T00:01:45.000Z')) === 15000, 'Automatic clock counted the pause');
check(clockEngine.isTimedScoringCommand({ kind: 'pitch', value: 'strike' }), 'Pitch did not trigger time');
check(!clockEngine.isTimedScoringCommand({ kind: 'finish' }), 'Closing triggered time');
print('HERMES_SCORING_OK');
`;
  const directory = mkdtempSync(join(tmpdir(), 'playsport-hermes-scoring-')), filename = join(directory, 'fixture.js');
  try {
    writeFileSync(filename, source);
    const result = spawnSync(hermes, [filename], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /HERMES_SCORING_OK/);
  } finally { if (existsSync(filename)) unlinkSync(filename); rmdirSync(directory); }
});
