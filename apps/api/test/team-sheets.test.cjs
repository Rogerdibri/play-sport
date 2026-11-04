const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');

function setup() {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score', 'blocked'] });
  for (const [teamId, managerId, prefix] of [['home', 'mgr', 'HOME'], ['away', 'rival', 'AWAY']]) {
    const ids = Array.from({ length: 11 }, (_, i) => `${prefix}${i}`);
    for (const identificationNumber of ids) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber, displayName: `Jugador ${identificationNumber}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId, playerIdentificationNumbers: ids });
  }
  for (const gameId of ['game', 'other']) service.configureGameTeams({ gameId, tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
  const initial = {
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'mgr',
    lineupEntries: Array.from({ length: 9 }, (_, i) => ({
      identificationNumber: `HOME${i}`, battingOrder: i + 1,
      fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i], jerseyNumber: String(i + 1)
    })),
    presentSubstituteIdentificationNumbers: ['HOME9'],
    presentOfficials: [
      { role: 'DIRIGENTE', identificationNumber: 'DIR0001', displayName: 'Dirigente ficticio' },
      { role: 'MANAGER', identificationNumber: 'MAN0001', displayName: 'Manager ficticio' },
      { role: 'DELEGADO', identificationNumber: 'DEL0001', displayName: 'Delegado ficticio' }
    ]
  };
  const get = (user = 'mgr', role = 'manager', game = 'game') => service.getTeamSheets(game, 'tour', user, role);
  const send = (action, patch = {}) => service.requestPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'mgr', expectedRevision: get().sheets[0]?.revision ?? 1, action, ...patch
  });
  const decide = (request, decision = 'approve', patch = {}) => service.decidePersonnelChange({
    gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    expectedRevision: get().sheets[0].revision, requestId: request.id, decision, ...patch
  });
  return { service, initial, get, send, decide };
}
const substitute = { kind: 'substitution', outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME9', fieldPosition: 'P', jerseyNumber: '10' };
const bad = (fn, status) => assert.throws(fn, (error) => error.getStatus() === status);

test('rejects nine pitchers atomically even if a client bypasses the position selector', () => {
  const { service, initial, get } = setup();
  assert.throws(() => service.configureGameLineup({
    ...initial, lineupEntries: initial.lineupEntries.map((entry) => ({ ...entry, fieldPosition: 'P' }))
  }), /posiciones repetidas/);
  assert.equal(get().sheets.length, 0);
  assert.equal(service.getGameLineups('game', 'tour').lineup.lineups.length, 0);
});

test('substitution cannot duplicate a position occupied by another active player', () => {
  const { service, initial, get, send } = setup();
  service.configureGameLineup(initial);
  const before = get();
  assert.throws(() => send({ ...substitute, fieldPosition: 'C' }), /posiciones repetidas/);
  assert.deepEqual(get(), before);
});

test('initial delivery includes only declared present reserves and distinct staff roles for all recipients', () => {
  const { service, initial, get } = setup();
  service.configureGameLineup(initial);
  for (const [user, role] of [['mgr', 'manager'], ['rival', 'manager'], ['org', 'organizer'], ['score', 'scorekeeper']]) {
    const snapshot = get(user, role);
    assert.equal(snapshot.sheets[0].lineup.length, 9);
    assert.deepEqual(snapshot.sheets[0].presentSubstitutes.map((p) => p.identificationNumber), ['HOME9']);
    assert.deepEqual(snapshot.sheets[0].presentOfficials.map((p) => p.role), ['DIRIGENTE', 'MANAGER', 'DELEGADO']);
    assert.deepEqual(snapshot.sheets[0].recipients, [
      { userId: 'org', role: 'organizer' }, { userId: 'score', role: 'scorekeeper' }, { userId: 'rival', role: 'manager' }
    ]);
  }
  assert.equal(get().canDecide, false);
  assert.equal(get('score', 'scorekeeper').canDecide, true);
  assert.equal(get('mgr', 'manager', 'other').sheets.length, 0);
});

test('unauthorized viewers, managers and game-excluded scorekeepers cannot access or decide', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  for (const [user, role] of [['outsider', 'manager'], ['rival', 'fan'], ['blocked', 'scorekeeper'], ['other-org', 'organizer']]) bad(() => get(user, role), 403);
  bad(() => service.createTeamSheetStream('game', 'tour', 'blocked', 'scorekeeper'), 403);
  bad(() => send(substitute, { managerId: 'rival' }), 403);
  const pending = send(substitute).requests[0];
  bad(() => decide(pending, 'approve', { actorId: 'mgr', actorRole: 'manager' }), 403);
  bad(() => decide(pending, 'approve', { actorId: 'blocked' }), 403);
});

test('delivery is idempotent and a resend cannot bypass approvals or reset the batter index', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  service.submitOfficialUpdate({
    gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    patch: { offenseTeamId: 'home' }, plateAppearance: { teamId: 'home', result: 'OUT' }
  });
  const version = get().version;
  service.configureGameLineup(initial);
  assert.equal(get().version, version);
  assert.equal(service.getGameLineups('game', 'tour').lineup.lineups[0].currentBatterIndex, 1);
  bad(() => service.configureGameLineup({ ...initial, presentSubstituteIdentificationNumbers: ['HOME10'] }), 409);
  decide(send(substitute).requests[0]);
  service.configureGameLineup(initial);
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME9');
});

test('substitution remains pending until confirmation and preserves order, original delivery and official scoring', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  const before = structuredClone(service.getOfficialState('game', 'tour'));
  const roster = service.getTournamentTeamRoster('tour', 'home');
  const pending = send(substitute).requests[0];
  assert.equal(pending.status, 'pending');
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME0');
  const applied = decide(pending).requests[0];
  assert.equal(applied.status, 'approved');
  assert.equal(applied.appliedRevision, 2);
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME9');
  assert.equal(get().sheets[0].lineup[0].battingOrder, 1);
  assert.equal(get().sheets[0].initialLineup[0].identificationNumber, 'HOME0');
  const after = service.getOfficialState('game', 'tour');
  assert.deepEqual(after.playByPlay.batterStats, before.playByPlay.batterStats);
  assert.deepEqual(after.playByPlay.scorecard.log, before.playByPlay.scorecard.log);
  assert.equal(after.playByPlay.scorecard.lineups.home[0].id, 'HOME9');
  assert.equal(after.state.homeScore, before.state.homeScore);
  assert.equal(after.state.awayScore, before.state.awayScore);
  assert.ok(after.state.officialVersion > before.state.officialVersion);
  assert.deepEqual(service.getTournamentTeamRoster('tour', 'home'), roster);
  const revision = get().sheets[0].revision;
  decide(pending);
  assert.equal(get().sheets[0].revision, revision);
});

test('late arrival requires roster membership, confirmation and a separate substitution to enter play', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  bad(() => send({ ...substitute, incomingIdentificationNumber: 'HOME10' }), 400);
  bad(() => send({ kind: 'arrival', identificationNumber: 'AWAY10' }), 400);
  bad(() => send({ kind: 'arrival', identificationNumber: 'UNKNOWN' }), 400);
  const arrival = send({ kind: 'arrival', identificationNumber: 'HOME10' }).requests[0];
  assert.equal(get().sheets[0].presentSubstitutes.length, 1);
  decide(arrival, 'approve', { actorId: 'org', actorRole: 'organizer' });
  assert.equal(get().sheets[0].lineup.length, 9);
  assert.equal(get().sheets[0].presentSubstitutes.length, 2);
  const sub = send({ ...substitute, incomingIdentificationNumber: 'HOME10', jerseyNumber: '11' }).requests.at(-1);
  decide(sub);
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME10');
  assert.equal(get().sheets[0].lineup.length, 9);
  bad(() => send({ kind: 'append', identificationNumber: 'HOME9' }), 400);
});

test('rejections require an explanation and never alter confirmed personnel', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  const pending = send(substitute).requests[0];
  bad(() => decide(pending, 'reject'), 400);
  decide(pending, 'reject', { note: 'Movimiento no permitido por el reglamento.' });
  assert.equal(get().requests[0].status, 'rejected');
  assert.equal(get().sheets[0].revision, 1);
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME0');
  bad(() => decide(pending, 'approve'), 409);
});

test('pending requests are deduplicated and revalidated against latest revision and roster on decision', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  const first = send(substitute).requests[0];
  send(substitute);
  assert.equal(get().requests.length, 1);
  const competing = send({ ...substitute, outgoingIdentificationNumber: 'HOME1', fieldPosition: 'C' }).requests.at(-1);
  decide(first);
  bad(() => decide(competing, 'approve', { expectedRevision: 1 }), 409);
  bad(() => decide(competing), 400);
  assert.equal(get().requests.at(-1).status, 'pending');
});

test('defensive swaps preserve order, staff changes remain distinct and coaches are excluded', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  decide(send({ kind: 'defense', identificationNumber: 'HOME0', fieldPosition: 'C' }).requests[0]);
  assert.equal(get().sheets[0].lineup[0].fieldPosition, 'C');
  assert.equal(get().sheets[0].lineup[1].fieldPosition, 'P');
  assert.equal(get().sheets[0].lineup[0].battingOrder, 1);
  bad(() => send({ kind: 'staff-arrival', official: { role: 'COACH_1B', identificationNumber: 'COACH1', displayName: 'No permitido' } }), 400);
  const staff = { role: 'DELEGADO', identificationNumber: 'DEL0002', displayName: 'Segundo delegado ficticio' };
  decide(send({ kind: 'staff-arrival', official: staff }).requests.at(-1));
  assert.equal(get().sheets[0].presentOfficials.length, 4);
  decide(send({ kind: 'staff-departure', role: staff.role, identificationNumber: staff.identificationNumber }).requests.at(-1));
  assert.equal(get().sheets[0].presentOfficials.length, 3);
});

test('courtesy requests respect confirmed presence and the organizer rule at approval time', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  const courtesy = { kind: 'courtesy', fromBase: 1, outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME1' };
  bad(() => send(courtesy), 400);
  bad(() => send({ ...courtesy, incomingIdentificationNumber: 'HOME10' }), 400);
  service.configureTournamentRules({ tournamentId: 'tour', organizerId: 'org', courtesyRunnerSource: 'ROSTER' });
  const pending = send(courtesy).requests[0];
  service.configureTournamentRules({ tournamentId: 'tour', organizerId: 'org', courtesyRunnerSource: 'BENCH' });
  bad(() => decide(pending), 400);
  const bench = send({ ...courtesy, incomingIdentificationNumber: 'HOME9' }).requests.at(-1);
  service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    patch: { offenseTeamId: 'home' } });
  service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    patch: {}, playEvent: { type: 'HIT_SINGLE' } });
  decide(bench);
  assert.equal(get().requests.at(-1).courtesyRunnerSource, 'BENCH');
  assert.equal(get().sheets[0].lineup[0].identificationNumber, 'HOME0');
  assert.equal(service.getOfficialState('game', 'tour').playByPlay.baseRunners.first, 'HOME9');
});

test('streams deliver initial lineups, pending requests and decisions to all recipients without private plays', () => {
  const { service, initial, send, decide } = setup();
  const deliveries = [];
  const subscriptions = [['mgr', 'manager'], ['rival', 'manager'], ['org', 'organizer'], ['score', 'scorekeeper']].map(([user, role]) => {
    const events = [];
    deliveries.push(events);
    return service.createTeamSheetStream('game', 'tour', user, role).subscribe((snapshot) => events.push(snapshot));
  });
  service.configureGameLineup(initial);
  const pending = send(substitute).requests[0];
  decide(pending);
  for (const events of deliveries) {
    assert.deepEqual(events.map((event) => event.version), [0, 1, 2, 3]);
    assert.equal(events.at(-1).requests[0].status, 'approved');
    assert.equal('playByPlay' in events.at(-1), false);
    assert.equal('state' in events.at(-1), false);
  }
  subscriptions.forEach((subscription) => subscription.unsubscribe());
});

test('final games reject new deliveries, requests and decisions', () => {
  const { service, initial, send, decide } = setup();
  service.configureGameLineup(initial);
  const pending = send(substitute).requests[0];
  service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper', patch: { status: 'final' } });
  bad(() => send({ kind: 'arrival', identificationNumber: 'HOME10' }), 400);
  bad(() => decide(pending), 400);
  bad(() => service.configureGameLineup(initial), 400);
});

test('invalid initial attendees are rejected atomically and participants cannot change after delivery', () => {
  const { service, initial, get } = setup();
  for (const patch of [
    { presentSubstituteIdentificationNumbers: ['AWAY9'] },
    { presentSubstituteIdentificationNumbers: ['HOME0'] },
    { presentSubstituteIdentificationNumbers: ['HOME9', 'HOME9'] },
    { presentOfficials: [{ role: 'COACH_3B', identificationNumber: 'COACH3', displayName: 'No permitido' }] }
  ]) {
    bad(() => service.configureGameLineup({ ...initial, ...patch }), 400);
    assert.equal(get().sheets.length, 0);
    assert.equal(get().version, 0);
  }
  service.configureGameLineup(initial);
  bad(() => service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'away', awayTeamId: 'home' }), 409);
});

test('a player removed from the roster while a movement is pending cannot be confirmed', () => {
  const { service, initial, get, send, decide } = setup();
  service.configureGameLineup(initial);
  const pending = send(substitute).requests[0];
  const roster = service.getTournamentTeamRoster('tour', 'home');
  service.configureTournamentTeamRoster({
    organizerId: 'org',
    tournamentId: 'tour', teamId: 'home', managerId: 'mgr',
    playerIdentificationNumbers: roster.rosterPlayerIdentificationNumbers.filter((id) => id !== 'HOME9')
  });
  bad(() => decide(pending), 400);
  assert.equal(get().requests[0].status, 'pending');
  assert.equal(get().sheets[0].revision, 1);
});

test('a stream stops delivering after the scorekeeper loses game authorization', () => {
  const { service, initial, send } = setup();
  service.configureGameLineup(initial);
  const events = [];
  let failure;
  const subscription = service.createTeamSheetStream('game', 'tour', 'score', 'scorekeeper').subscribe({
    next: (snapshot) => events.push(snapshot), error: (error) => { failure = error; }
  });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: [] });
  send(substitute);
  assert.equal(failure.getStatus(), 403);
  assert.equal(events.length, 1);
  subscription.unsubscribe();
});
