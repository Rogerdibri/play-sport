const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createPrivateState, applyPrivateCommand: apply, createGameReport, readGameReport, finalReviewIssue,
  gameReportPlayerKey, privateDefensiveCredits, replayPrivate } = require('@playsport/shared');
const { default: Report, GameFinalReviewForm } = require('../app/demo/[slug]/game-final-report');

function fixture() {
  const players = side => Array.from({ length: 10 }, (_, index) => ({
    id: `${side}-${index}`, name: `${side === 'home' ? 'Local' : 'Visitante'} ${index + 1}`,
    jersey: String(index + 1), position: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'NA'][index],
    order: index < 9 ? index + 1 : null
  }));
  const rosters = { home: players('home'), away: players('away') };
  const seed = { names: { home: 'Locales', away: 'Visitantes' }, rosters,
    lineups: { home: rosters.home.slice(0, 9), away: rosters.away.slice(0, 9) },
    sport: 'baseball', scoringRules: 'baseball', courtesyRunnerSource: 'BENCH' };
  const commands = [];
  let state = createPrivateState(seed);
  const send = command => { state = apply(state, command); commands.push(command); };
  const play = (result, extra = {}) => send({ kind: 'play', result, ...extra });
  const review = () => ({ confirmed: true, rulesReference: 'Reglamento de la liga, revisión del anotador', note: '',
    winner: 'away:0', loser: 'home:0', saver: null, bestBatter: 'away:2', mvp: 'away:2', pitching: {}, fielding: {} });
  return { seed, commands, send, play, review, state: () => state };
}
function complete() {
  const e = fixture();
  e.play('single'); e.play('double'); e.play('homeRun'); e.play('walk');
  e.play('sacrificeBunt', { fieldingSequence: [1, 3], battedBallType: 'bunt' });
  e.play('strikeout'); e.play('groundOut', { fieldingSequence: [6, 3], battedBallType: 'ground' });
  e.play('walk'); e.play('homeRun'); e.play('strikeout');
  e.play('lineOut', { fieldingSequence: [6], battedBallType: 'line', caughtBy: { playerId: 'away-5', position: 6 } });
  e.play('groundOut', { fieldingSequence: [6, 3], battedBallType: 'ground' });
  const review = e.review();
  review.pitching['away:0'] = { pitches: 24, strikes: 16, wildPitches: 0, balks: 0 };
  review.fielding['away:1'] = { putouts: null, assists: null, doublePlays: null, triplePlays: null, passedBalls: 0 };
  review.fielding['home:1'] = { ...review.fielding['away:1'] };
  e.send({ kind: 'finish', review });
  return e;
}
test('final report calculates real denominators, IP, team totals, decisions and LOB from the closed ledger', () => {
  const e = complete(), report = createGameReport(e.state(), { source: 'practice', detailed: true });
  assert.deepEqual(e.state(), replayPrivate(e.seed, e.commands));
  assert.deepEqual(readGameReport(JSON.parse(JSON.stringify(report))), report);
  const away = report.teams.away, home = report.teams.home;
  assert.deepEqual([away.runs, home.runs, away.hits, home.hits], [3, 2, 3, 1]);
  assert.deepEqual([away.totals.batting.PA, away.totals.batting.AB, away.totals.batting.SH], [7, 5, 1]);
  assert.equal(away.totals.batting.AVG, 3 / 5);
  assert.equal(away.totals.batting.OBP, 4 / 6);
  assert.equal(away.totals.batting.SLG, 7 / 5);
  assert.equal(away.totals.batting.OPS, 4 / 6 + 7 / 5);
  assert.equal(away.totals.pitching.ERA, 18); assert.equal(away.totals.pitching.WHIP, 2);
  assert.equal(home.totals.pitching.ERA, 27);
  assert.deepEqual([away.totals.pitching.W, home.totals.pitching.L, away.totals.pitching.SV], [1, 1, 0]);
  assert.deepEqual([away.totals.fielding.PO, away.totals.fielding.A, away.totals.fielding.PB], [3, 1, 0]);
  assert.equal(away.totals.fielding.FLD, 1);
  assert.deepEqual([away.leftOnBase, home.leftOnBase], [1, 0]);
  assert.equal(away.players.length, 9); assert.ok(!away.players.some(player => player.key === 'away:9'));
  assert.equal(away.players[0].pitching.pitches, 24);
  assert.equal(away.players[8].line.batting.AVG, null, 'a zero denominator is not .000');
  assert.equal(report.homeRuns.length, 2); assert.equal(report.homeRuns[0].rbis, 3);
});
test('basic projection withholds individual tables, rates and home-run details; malformed reports are rejected', () => {
  const e = complete(), report = createGameReport(e.state(), { source: 'official', detailed: false });
  assert.equal(report.teams.away.players, undefined); assert.equal(report.teams.away.totals, undefined);
  assert.equal(report.homeRuns, undefined);
  assert.doesNotMatch(JSON.stringify(report), /away-0|home-0|AVG|WHIP|pitching|fielding/);
  assert.equal(readGameReport(report), report);
  assert.throws(() => readGameReport({ ...report, homeRuns: [] }), /inválidos/);
  assert.throws(() => readGameReport({ ...report, teams: { ...report.teams, away: { ...report.teams.away, runs: -1 } } }), /inválidos/);
  const unidentified = structuredClone(e.state());
  unidentified.seed.rosters.away[2].name = unidentified.seed.rosters.away[2].id;
  const protectedReport = createGameReport(unidentified, { source: 'official', detailed: true });
  assert.doesNotMatch(JSON.stringify(protectedReport), /away-2/);
  assert.equal(protectedReport.honors.mvp, 'Nombre no disponible');
});
test('missing source evidence remains unavailable; PCL respects seven/nine innings and pending runs', () => {
  const e = complete();
  const report = createGameReport(e.state(), { source: 'private', detailed: true, eraBase: 7 });
  assert.equal(report.teams.away.totals.pitching.ERA, 14);
  const missing = createGameReport(e.state(), { source: 'private', detailed: true, sourceComplete: false });
  assert.equal(missing.teams.away.totals.batting.H, null);
  assert.equal(missing.teams.away.players[0].line.fielding.PO, null);
  assert.equal(missing.teams.away.hits, null); assert.ok(missing.warnings.length);
  const pending = structuredClone(e.state()); pending.runAccounting.runs[0].pitcher = 'pending'; pending.runAccounting.runs[0].team = 'pending';
  assert.equal(createGameReport(pending, { source: 'private', detailed: true }).teams.home.totals.pitching.ERA, null);
  const unbacked = structuredClone(e.state()); unbacked.runAccounting.runs = [];
  assert.equal(createGameReport(unbacked, { source: 'private', detailed: true }).teams.home.totals.pitching.ER, null);
  const unknown = structuredClone(e.state()); unknown.runAccounting.runs[0].pitcherId = null;
  const uncertain = createGameReport(unknown, { source: 'private', detailed: true });
  assert.equal(uncertain.teams.home.players[0].line.pitching.R, null);
  const form = renderToStaticMarkup(React.createElement(GameFinalReviewForm, {
    state: unknown, detailed: true, disabled: false, onConfirm: async () => true, onCancel() {}
  }));
  assert.match(form.match(/<select aria-label="Pitcher perdedor"[\s\S]*?<\/select>/)[0], /value="home:0"/);
});
test('multiple outs require marked boundaries for credits; simple airborne catches never have assists', () => {
  const e = fixture(); e.play('walk');
  const before = e.state();
  e.play('doublePlay', { battedBallType: 'ground', fieldingSequence: [6, 4, 3], outAt: [1, 2] });
  const log = e.state().log.at(-1);
  assert.deepEqual(log.fieldingCredit, { putouts: ['home-3', 'home-2'], assists: ['home-5', 'home-3'] });
  assert.equal(privateDefensiveCredits(e.state(), 'home', 'home-3').doublePlays, 1);
  assert.match(finalReviewIssue(e.state(), { ...e.review(), winner: null, loser: null, bestBatter: 'away:1', mvp: 'away:1',
    fielding: { 'home:3': { putouts: null, assists: null, doublePlays: 0, triplePlays: null, passedBalls: null } } }), /dobles/);
  assert.throws(() => apply(before, { kind: 'play', result: 'doublePlay', battedBallType: 'ground', fieldingSequence: [6, 4, 3], outAt: [0] }), /out/);
  const legacy = apply(before, { kind: 'play', result: 'doublePlay', battedBallType: 'ground', fieldingSequence: [6, 4, 3] });
  assert.equal(privateDefensiveCredits(legacy, 'home').putouts, null);
  const caught = fixture(); caught.play('lineOut', { battedBallType: 'line', fieldingSequence: [6], caughtBy: { playerId: 'home-5', position: 6 } });
  assert.deepEqual(caught.state().log.at(-1).fieldingCredit, { putouts: ['home-5'], assists: [] });
  const triple = fixture(); triple.play('walk'); triple.play('walk');
  triple.play('triplePlay', { battedBallType: 'ground', fieldingSequence: [5, 4, 3], outAt: [0, 1, 2] });
  assert.equal(privateDefensiveCredits(triple.state(), 'home').putouts, 3);
  assert.equal(privateDefensiveCredits(triple.state(), 'home').triplePlays, 1);
});
test('walks inherited at a three-ball count belong to the outgoing pitcher in private scoring too', () => {
  const e = fixture();
  for (let index = 0; index < 3; index++) e.send({ kind: 'pitch', value: 'ball' });
  e.send({ kind: 'substitution', side: 'home', outId: 'home-0', inId: 'home-9', position: 'P', jersey: '10' });
  e.play('walk'); e.play('homeRun');
  const report = createGameReport(e.state(), { source: 'private', detailed: true });
  assert.equal(report.teams.home.players.find(player => player.key === 'home:0').line.pitching.BB, 1);
  assert.equal(report.teams.home.players.find(player => player.key === 'home:9').line.pitching.BB, 0);
});
test('confirmed WP and PB cannot erase a recorded uncaught third strike', () => {
  for (const cause of ['wild', 'passed']) {
    const e = fixture();
    e.send({ kind: 'pitch', value: 'strike' }); e.send({ kind: 'pitch', value: 'strike' });
    e.play('droppedThirdStrike', { strikeoutType: 'swinging', thirdStrikeCause: cause, destinations: { 'away-0': 1 } });
    const review = { ...e.review(), winner: null, loser: null, bestBatter: 'away:0', mvp: 'away:0' };
    if (cause === 'wild') review.pitching['home:0'] = { pitches: 3, strikes: 3, wildPitches: 0, balks: 0 };
    else review.fielding['home:1'] = { putouts: null, assists: null, doublePlays: null, triplePlays: null, passedBalls: 0 };
    assert.match(finalReviewIssue(e.state(), review), cause === 'wild' ? /wild pitches/ : /pelotas pasadas/);
  }
});
test('closing review rejects outsiders, invalid honors, inconsistent pitches and mismatched defensive outs', () => {
  const e = complete(), state = e.state(), review = e.review();
  assert.match(finalReviewIssue(state, { ...review, mvp: 'away:9' }), /participación/);
  assert.match(finalReviewIssue(state, { ...review, winner: 'home:0' }), /resultado/);
  assert.match(finalReviewIssue(state, { ...review, saver: 'away:0' }), /otro pitcher/);
  assert.match(finalReviewIssue(state, { ...review, pitching: { 'away:0': { pitches: 1, strikes: 2, wildPitches: 0, balks: 0 } } }), /reglamento/);
  assert.match(finalReviewIssue(state, { ...review, fielding: { 'away:1': { putouts: 99, assists: null, doublePlays: null, triplePlays: null, passedBalls: 0 } } }), /outs|créditos/i);
  assert.match(finalReviewIssue(state, { ...review, fielding: { 'home:0': { putouts: null, assists: null, doublePlays: null, triplePlays: null, passedBalls: 1 } } }), /receptor/);
  const unknown = structuredClone(state); unknown.seed.lineups.home.forEach(player => player.position = 'NA');
  unknown.lineups.home.forEach(player => player.position = 'NA');
  unknown.log.forEach(entry => { if (entry.side === 'away') entry.pitcherId = null; });
  assert.equal(finalReviewIssue(unknown, { ...review, loser: null, note: 'No se registró quién lanzó por el local.' }), null);
  assert.equal(gameReportPlayerKey(state.seed, 'away', 'away-0'), 'away:0');
});
test('detailed and free renderings show the correct summary and explicit unavailable values', () => {
  const e = complete();
  const detailed = renderToStaticMarkup(React.createElement(Report, {
    report: createGameReport(e.state(), { source: 'practice', detailed: true }), onBack() {}, onExit() {}
  }));
  assert.match(detailed, /Imprimir \/ guardar PDF/); assert.match(detailed, /Promedios ofensivos/);
  assert.match(detailed, /Conteos confirmados/); assert.match(detailed, />ND</);
  const basic = renderToStaticMarkup(React.createElement(Report, {
    report: createGameReport(e.state(), { source: 'official', detailed: false }), onBack() {}, onExit() {}
  }));
  assert.match(basic, /Resumen básico/); assert.doesNotMatch(basic, /Promedios ofensivos|Conteos confirmados/);
});
