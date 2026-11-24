const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runTotals } = require('@playsport/shared');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const {
  applyPrivateCommand, createPrivateState, replayPrivate, readPrivateSave, undoPrivateCommand
} = require('../../web/app/demo/[slug]/private-scorecard');

const results = {
  homeRun: 'HOME_RUN', single: 'HIT_SINGLE', double: 'HIT_DOUBLE', walk: 'WALK',
  battedOut: 'OUT', error: 'ERROR', strikeout: 'STRIKEOUT'
};
const actions = { passed: 'PASSED_BALL', wild: 'WILD_PITCH', error: 'ERROR_ADVANCE', advance: 'RUNNER_ADVANCE', caught: 'CAUGHT_STEALING' };
function seed() {
  const players = (prefix) => Array.from({ length: 11 }, (_, i) => ({
    id: `${prefix}${i + 1}`, name: `Jugador ${prefix}${i + 1}`, jersey: String(i + 1), order: i < 9 ? i + 1 : null,
    position: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'NA', 'NA'][i]
  }));
  const home = players('HOME'), away = players('AWAY');
  return {
    names: { home: 'Local', away: 'Visitante' }, rosters: { home, away },
    lineups: { home: home.slice(0, 9), away: away.slice(0, 9) }, courtesyRunnerSource: 'BENCH'
  };
}
function privateEngine() {
  const initial = seed(), commands = [];
  let state = createPrivateState(initial);
  const apply = (command) => { state = applyPrivateCommand(state, command); commands.push(command); };
  return {
    get runs() { return state.runAccounting.runs; },
    get accounting() { return state.runAccounting; },
    get scores() { return state.scores; },
    get state() { return state; },
    commands, initial, apply,
    play: (result, extra = {}) => apply({ kind: 'play', result, ...extra }),
    pitch: (value) => apply({ kind: 'pitch', value }),
    runner: (action, from, to, extra = {}) => apply({ kind: 'runner', action, from, to, cleanAdvance: action === 'advance' ? true : undefined, ...extra }),
    misplay: () => apply({ kind: 'misplay', errorOuts: 1 }),
    courtesy: () => apply({ kind: 'courtesy', from: 1, playerId: 'AWAY10' }),
    replace: (side = 'home') => apply({ kind: 'substitution', side, outId: side === 'home' ? 'HOME1' : 'AWAY1', inId: side === 'home' ? 'HOME10' : 'AWAY10', position: 'P', jersey: '10' }),
    review: (review) => apply({ kind: 'run-review', review })
  };
}
function officialEngine() {
  const service = new OfficialScoringService();
  service.nowIso = () => '2026-11-17T02:00:00.000Z';
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['score'], scorekeeperIdentities: [{ actorId: 'score', identificationNumber: 'SCORE0001' }] });
  const initial = seed();
  for (const side of ['home', 'away']) {
    for (const p of initial.rosters[side]) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: p.id, displayName: p.name } });
    service.configureTournamentTeamRoster({
      tournamentId: 'tour', organizerId: 'org', teamId: side, managerId: `mgr-${side}`,
      managerIdentificationNumber: `MANAGER${side}`, playerIdentificationNumbers: initial.rosters[side].map((p) => p.id)
    });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
  for (const side of ['home', 'away']) {
    service.configureGameLineup({
      gameId: 'game', tournamentId: 'tour', teamId: side, managerId: `mgr-${side}`,
      lineupEntries: initial.lineups[side].map((p) => ({ identificationNumber: p.id, battingOrder: p.order, fieldPosition: p.position, jerseyNumber: p.jersey })),
      presentSubstituteIdentificationNumbers: [side === 'home' ? 'HOME10' : 'AWAY10']
    });
  }
  const get = () => service.getOfficialState('game', 'tour');
  const submit = (extra) => service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper', patch: {}, ...extra });
  const event = (playEvent) => submit({ playEvent: {
    ...(['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(playEvent.type) ?
      { fielderIdentificationNumber: get().state.offenseTeamId === 'home' ? 'AWAY6' : 'HOME6' } : {}),
    ...playEvent
  } });
  const replace = (side = 'home') => {
    const sheet = service.getTeamSheets('game', 'tour', `mgr-${side}`, 'manager').sheets.find((s) => s.teamId === side);
    const response = service.requestPersonnelChange({
      gameId: 'game', tournamentId: 'tour', teamId: side, managerId: `mgr-${side}`, expectedRevision: sheet.revision,
      action: { kind: 'substitution', outgoingIdentificationNumber: side === 'home' ? 'HOME1' : 'AWAY1', incomingIdentificationNumber: side === 'home' ? 'HOME10' : 'AWAY10', fieldPosition: 'P', jerseyNumber: '10' }
    });
    const request = response.requests.find((r) => r.status === 'pending');
    service.decidePersonnelChange({ gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper', requestId: request.id, expectedRevision: sheet.revision, decision: 'approve' });
  };
  return {
    service, get, submit, event, replace,
    get runs() { return get().playByPlay.runAccounting.runs; },
    get scores() { const s = get().state; return { home: s.homeScore, away: s.awayScore }; },
    play: (result, extra = {}) => event({ type: results[result], ...extra }),
    pitch: (value) => event({ type: { ball: 'BALL', strike: 'STRIKE', foul: 'FOUL' }[value] }),
    runner: (action, from, to, extra = {}) => {
      const bases = get().playByPlay.baseRunners;
      return event({ type: actions[action], runnerIdentificationNumber: [bases.first, bases.second, bases.third][from - 1], fromBase: from, ...(to ? { toBase: to } : {}), ...extra });
    },
    misplay: () => event({ type: 'DROPPED_FOUL', errorOuts: 1 }),
    courtesy: () => event({ type: 'COURTESY_RUNNER', fromBase: 1, runnerIdentificationNumber: 'AWAY10' }),
    review: (runReview) => submit({ runReview })
  };
}

for (const [label, create] of [['privado', privateEngine], ['oficial', officialEngine]]) {
  test(`${label}: clean runs use the defensive P automatically`, () => {
    const e = create(); e.play('homeRun');
    assert.deepEqual(e.scores, { home: 0, away: 1 });
    assert.deepEqual(e.runs.map((r) => [r.runnerId, r.pitcherId, r.team, r.pitcher]), [['AWAY1', 'HOME1', 'earned', 'earned']]);
  });
  test(`${label}: an error that should have been the third out makes both subsequent HR runs unearned`, () => {
    const e = create(); e.play('battedOut'); e.play('battedOut'); e.play('error', { errorOuts: 1 }); e.play('homeRun');
    assert.equal(e.runs.length, 2);
    assert.ok(e.runs.every((r) => r.team === 'unearned' && r.pitcher === 'unearned'));
  });
  test(`${label}: an error before the virtual third out does not make every later run unearned`, () => {
    const e = create(); e.play('battedOut'); e.play('error', { errorOuts: 1 }); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => r.team), ['unearned', 'earned']);
  });
  test(`${label}: a runner already virtually out must not count twice when later caught`, () => {
    const e = create(); e.play('error', { errorOuts: 1 }); e.runner('caught', 1, 0); e.play('battedOut'); e.play('homeRun');
    assert.equal(e.runs[0].team, 'earned');
  });
  test(`${label}: unknown legacy error details stay pending rather than guessing a third out`, () => {
    const e = create(); e.play('battedOut'); e.play('battedOut'); e.play('error'); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => r.team), ['unearned', 'pending']);
  });
  test(`${label}: passed-ball advancement can become irrelevant on a subsequent HR`, () => {
    const e = create(); e.play('single'); e.runner('passed', 1, 2); e.play('homeRun');
    assert.ok(e.runs.every((r) => r.team === 'earned'));
  });
  test(`${label}: a run on a passed ball requires reconstruction, but wild pitch alone is not unearned`, () => {
    for (const action of ['passed', 'wild']) {
      const e = create(); e.play('single'); e.runner(action, 1, 4);
      assert.equal(e.runs[0].team, action === 'passed' ? 'pending' : 'earned');
    }
  });
  test(`${label}: runner errors distinguish an extra base from an avoided out`, () => {
    for (const errorOuts of [0, 1]) {
      const e = create(); e.play('single'); e.runner('error', 1, 4, { errorOuts });
      assert.equal(e.runs[0].team, errorOuts === 1 ? 'unearned' : 'pending');
    }
  });
  test(`${label}: runner inheritance survives the pitching substitution`, () => {
    const e = create(); e.play('single'); e.replace(); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => [r.runnerId, r.pitcherId]), [['AWAY1', 'HOME1'], ['AWAY2', 'HOME10']]);
  });
  test(`${label}: team unearned can be earned for a reliever who did not receive earlier error chances`, () => {
    const e = create(); e.play('battedOut'); e.play('battedOut'); e.play('error', { errorOuts: 1 }); e.replace(); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => [r.pitcherId, r.team, r.pitcher]), [['HOME1', 'unearned', 'unearned'], ['HOME10', 'unearned', 'earned']]);
  });
  test(`${label}: a walk inherited with three balls belongs to the preceding pitcher`, () => {
    const e = create(); e.pitch('ball'); e.pitch('ball'); e.pitch('ball'); e.replace(); e.pitch('ball'); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => r.pitcherId), ['HOME1', 'HOME10']);
  });
  test(`${label}: a reliever does not receive a dropped-foul chance that happened before entering`, () => {
    const e = create(); e.play('battedOut'); e.play('battedOut'); e.misplay(); e.replace(); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => [r.pitcherId, r.team, r.pitcher]), [['HOME10', 'unearned', 'earned']]);
  });
  test(`${label}: a walk inherited with a 2-2 count belongs to the reliever`, () => {
    const e = create(); e.pitch('ball'); e.pitch('ball'); e.pitch('strike'); e.pitch('strike'); e.replace(); e.pitch('ball'); e.pitch('ball'); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => r.pitcherId), ['HOME10', 'HOME10']);
  });
  test(`${label}: courtesy runners and pinch runners retain the original pitching responsibility`, () => {
    for (const change of ['courtesy', 'replace']) {
      const e = create(); e.play('single');
      if (change === 'courtesy') e.courtesy(); else e.replace('away');
      e.play('homeRun');
      assert.deepEqual(e.runs.map((r) => [r.runnerId, r.pitcherId]), [['AWAY10', 'HOME1'], ['AWAY2', 'HOME1']]);
    }
  });
  test(`${label}: repeated dropped fouls do not fabricate additional virtual outs`, () => {
    const e = create(); e.misplay(); e.misplay(); e.play('homeRun');
    assert.equal(e.runs[0].team, 'unearned');
    e.play('homeRun');
    assert.equal(e.runs[1].team, 'earned');
  });
  test(`${label}: a dropped-foul out followed by a real strikeout is only one out`, () => {
    const e = create(); e.misplay(); e.play('strikeout'); e.play('battedOut'); e.play('homeRun');
    assert.equal(e.runs[0].team, 'earned');
  });
  test(`${label}: an error after a dropped foul must not count the same batter twice`, () => {
    const e = create(); e.misplay(); e.play('error', { errorOuts: 1 }); e.play('battedOut'); e.play('homeRun');
    assert.deepEqual(e.runs.map((r) => r.team), ['unearned', 'earned']);
  });
  test(`${label}: multiple missed outs without individual out identities require reconstruction`, () => {
    const e = create(); e.play('single'); e.play('error', { errorOuts: 2 }); e.play('homeRun');
    assert.equal(e.runs.at(-1).team, 'pending');
  });
  test(`${label}: error context resets at the next defensive half`, () => {
    const e = create(); e.play('error', { errorOuts: 1 }); e.play('battedOut'); e.play('battedOut'); e.play('battedOut'); e.play('homeRun');
    assert.equal(e.runs[0].team, 'earned');
    assert.equal(e.runs[0].pitcherId, 'AWAY1');
  });
  test(`${label}: pending runs can be reviewed with a recorded explanation without changing the score`, () => {
    const e = create(); e.play('single'); e.runner('passed', 1, 4);
    const score = structuredClone(e.scores), run = e.runs[0];
    e.review({ eventId: run.eventId, runnerId: run.runnerId, team: 'unearned', pitcher: 'unearned', note: 'Sin la bola pasada quedaba en tercera al terminar la entrada.' });
    assert.deepEqual(e.scores, score);
    assert.equal(e.runs[0].reviewed, true);
    assert.deepEqual(runTotals(e.runs, 'team'), { earned: 0, unearned: 1, pending: 0, total: 1 });
    assert.throws(() => e.review({ eventId: run.eventId, runnerId: run.runnerId, team: 'earned', pitcher: 'earned', note: '' }));
  });
}

test('private run reviews replay and undo; original save payload remains unchanged', () => {
  const e = privateEngine(); e.play('single'); e.runner('passed', 1, 4);
  const original = JSON.stringify({ version: 1, seed: e.initial, commands: e.commands });
  assert.equal(JSON.stringify(readPrivateSave(original)), original);
  const run = e.runs[0];
  e.review({ eventId: run.eventId, runnerId: run.runnerId, team: 'unearned', pitcher: 'unearned', note: 'Entrada reconstruida.' });
  assert.deepEqual(replayPrivate(e.initial, e.commands), e.state);
  const undone = undoPrivateCommand(e.initial, e.commands);
  assert.equal(undone.state.runAccounting.runs[0].team, 'pending');
  assert.equal(JSON.stringify({ version: 1, seed: e.initial, commands: undone.commands }), original);
});

test('official attribution charges inherited runs to the original pitcher in both old and new statistics', () => {
  const e = officialEngine(); e.play('single'); e.replace(); e.play('homeRun');
  const stats = e.get().playByPlay.pitcherStats;
  assert.equal(stats.find((p) => p.identificationNumber === 'HOME1').runsAllowed, 1);
  assert.equal(stats.find((p) => p.identificationNumber === 'HOME10').runsAllowed, 1);
  assert.equal(stats.find((p) => p.identificationNumber === 'HOME1').earnedRuns, 1);
});

test('official walks inherited at 3-0 are charged to the responsible pitcher, not just the pitcher on the mound', () => {
  const e = officialEngine(); e.pitch('ball'); e.pitch('ball'); e.pitch('ball'); e.replace(); e.pitch('ball');
  const stats = e.get().playByPlay.pitcherStats;
  assert.equal(stats.find((p) => p.identificationNumber === 'HOME1').walksAllowed, 1);
  assert.equal(stats.find((p) => p.identificationNumber === 'HOME10').walksAllowed, 0);
});

test('official run reviews retain authorization, audit, atomic rejection and version checks', () => {
  const e = officialEngine(); e.play('homeRun');
  const before = structuredClone(e.get());
  const review = { eventId: 1, runnerId: 'AWAY1', team: 'earned', pitcher: 'earned', note: 'Verificado.' };
  assert.throws(() => e.submit({ actorId: 'mgr-home', actorRole: 'manager', runReview: review }), /No autorizado/);
  assert.throws(() => e.submit({ runReview: { ...review, eventId: 999 } }), /No se encontró/);
  assert.throws(() => e.submit({ runReview: { ...review, team: ['earned'] } }), /clasificación|revisión/);
  assert.throws(() => e.submit({ expectedOfficialVersion: before.state.officialVersion - 1, runReview: review }), /cambió/);
  assert.deepEqual(e.get(), before);
  const result = e.review(review);
  assert.deepEqual(result.event.runReview, review);
});

test('official atomic updates preserve live authorization checks in existing personnel streams', () => {
  const e = officialEngine();
  e.service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
  const received = [];
  const errors = [];
  const stream = e.service.createTeamSheetStream('game', 'tour', 'score', 'scorekeeper').subscribe({
    next: (value) => received.push(value), error: (error) => errors.push(error)
  });
  e.play('homeRun');
  e.service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: [] });
  const count = received.length;
  const sheet = e.service.getTeamSheets('game', 'tour', 'mgr-home', 'manager').sheets.find((s) => s.teamId === 'home');
  e.service.requestPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'mgr-home', expectedRevision: sheet.revision,
    action: { kind: 'arrival', identificationNumber: 'HOME11' }
  });
  assert.equal(received.length, count);
  assert.equal(errors[0].getStatus(), 403);
  stream.unsubscribe();
});

test('official error evidence and pitcher mismatch reject atomically, including after a valid event was prepared', () => {
  const e = officialEngine(), before = structuredClone(e.get());
  for (const errorOuts of [-1, 4, 1.5, '1', null]) {
    assert.throws(() => e.play('error', { errorOuts }));
  }
  assert.throws(() => e.play('single', { errorOuts: 0 }));
  assert.throws(() => e.play('homeRun', { pitcherIdentificationNumber: 'HOME2' }), /posición P/);
  assert.throws(() => e.play('homeRun', { runsScored: 0 }), /corredores que anotaron/);
  assert.throws(() => e.submit({ playEvent: { type: 'HOME_RUN' }, patch: { outs: -1 } }));
  assert.deepEqual(e.get(), before);
});

test('unidentified official run adjustments remain pending and manual scoreboard edits signal an incomplete breakdown', () => {
  const e = officialEngine(); e.play('homeRun', { runsScored: 3 });
  assert.deepEqual(runTotals(e.runs, 'team'), { earned: 1, unearned: 0, pending: 2, total: 3 });
  assert.equal(e.runs[1].runnerId, null);
  assert.equal(e.runs[1].pitcherId, null);
  assert.equal(e.get().playByPlay.runAccounting.scoreMatches, true);
  e.submit({ patch: { awayScore: 4 } });
  assert.equal(e.get().playByPlay.runAccounting.scoreMatches, false);
});

test('controller forwards error evidence and run reviews to the same official engine', () => {
  const e = officialEngine(), controller = new OfficialScoringController(e.service);
  const body = { tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper', patch: {} };
  controller.submitOfficialUpdate('game', { ...body, playEvent: { type: 'ERROR', errorOuts: 1, fielderIdentificationNumber: 'HOME6' } });
  e.play('homeRun');
  const run = e.runs[0];
  controller.submitOfficialUpdate('game', { ...body, runReview: { eventId: run.eventId, runnerId: run.runnerId, team: 'unearned', pitcher: 'unearned', note: 'Revisión del anotador.' } });
  assert.equal(e.get().playByPlay.recentEvents[0].errorOuts, 1);
  assert.equal(e.runs[0].reviewed, true);
});
