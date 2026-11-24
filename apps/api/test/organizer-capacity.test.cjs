const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');
const { estimateTournamentCapacity, organizerCapacityExamples, readOrganizerFreeReservation, newTournamentFixture } = require('@playsport/shared');
const { OrganizerCapacityState } = require('../src/modules/live-scoring/organizer-capacity-state');
const command = (tournamentId, expectedRevision = 0) => ({ expectedAccountId: 'organizer', tournamentId, expectedRevision, requestId: randomUUID() });
const game = (doc, index = 0) => ({ gameId: `plan:${doc.id}:${doc.fixtures[index].id}`, fixtureId: doc.fixtures[index].id,
  teamIds: [doc.fixtures[index].homeTeamId, doc.fixtures[index].awayTeamId], at: '2026-11-23T16:00:00.000Z' });
const denied = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
test('free capacity is 2–5 teams and 13 games; groups, rounds and phases count once', () => {
  const five = structuredClone(organizerCapacityExamples[0]), eight = structuredClone(organizerCapacityExamples[1]);
  assert.deepEqual(estimateTournamentCapacity(five).phases.map(phase => phase.games), [10, 2, 1]);
  assert.equal(estimateTournamentCapacity(five).games, 13);
  assert.equal(estimateTournamentCapacity(five).freeEligible, true);
  assert.equal(estimateTournamentCapacity(eight).games, 27);
  assert.equal(estimateTournamentCapacity(eight).freeEligible, false);
  five.phases[0].turns = 2;
  assert.equal(estimateTournamentCapacity(five).games, 23);
  assert.equal(estimateTournamentCapacity(five).freeEligible, false);
  const two = structuredClone(organizerCapacityExamples[2]);
  for (const count of [1, 2, 5, 6]) {
    two.teamLimit = count;
    two.teams = Array.from({ length: count }, (_, index) => ({ ...two.teams[0], id: `team-${index}` }));
    two.phases[0].teamIds = two.teams.map(team => team.id); two.phases[0].teamLimit = count;
    assert.equal(estimateTournamentCapacity(two).freeEligible, count >= 2 && count <= 5);
  }
});
test('a knockout phase is one round; series reserve their maximum, not only guaranteed games', () => {
  const doc = structuredClone(organizerCapacityExamples[0]);
  doc.phases[1].bestOf = 3;
  doc.phases[2].bestOf = 5;
  assert.deepEqual(estimateTournamentCapacity(doc).phases.map(phase => phase.games), [10, 6, 5]);
  assert.equal(estimateTournamentCapacity(doc).games, 21);
  const manual = structuredClone(organizerCapacityExamples[2]);
  delete manual.phases[0].maxGames;
  assert.equal(estimateTournamentCapacity(manual).complete, false);
  assert.match(estimateTournamentCapacity(manual).pending[0], /máximo/);
  manual.phases[0].maxGames = 1;
  manual.fixtures.push({ ...manual.fixtures[0], id: 'second' });
  assert.equal(estimateTournamentCapacity(manual).freeEligible, false);
  assert.match(estimateTournamentCapacity(manual).pending[0], /presupuesto/);
});
test('Swiss rounds and double elimination reserve their full possible volume including final reset', () => {
  const doc = structuredClone(organizerCapacityExamples[0]);
  doc.phases = [{ ...doc.phases[0], kind: 'swiss', turns: 3 }];
  assert.equal(estimateTournamentCapacity(doc).games, 6);
  doc.phases[0].kind = 'double-elimination'; doc.phases[0].turns = 1;
  assert.equal(estimateTournamentCapacity(doc).games, 9);
  assert.equal(estimateTournamentCapacity(doc).complete, true);
  doc.phases[0].bestOf = 3;
  assert.equal(estimateTournamentCapacity(doc).games, 27);
  assert.equal(estimateTournamentCapacity(doc).freeEligible, false);
});
test('one reservation can move before play; retries never restore an older reservation or reset consumption', () => {
  const state = new OrganizerCapacityState(), first = structuredClone(organizerCapacityExamples[0]), second = structuredClone(organizerCapacityExamples[2]);
  const a = command(first.id), b = command(second.id, 1);
  state.reserve(a); state.reserve(b);
  assert.equal(state.reserve(a).free.tournamentId, second.id);
  assert.equal(state.reserve(a).replayed, true);
  denied(() => state.reserve({ ...a, tournamentId: second.id }), 409);
  state.start('organizer', second, game(second));
  const used = state.access('organizer');
  assert.ok(used.consumedAt); assert.equal(used.revision, 3);
  denied(() => state.reserve(command(null, used.revision)), 403);
  denied(() => state.reserve(command(first.id, used.revision)), 403);
  second.status = 'cancelled';
  assert.deepEqual(state.access('organizer'), used);
  assert.equal(state.reserve(a).free.tournamentId, second.id, 'an old replay never refunds the opportunity');
});
test('the first played game consumes once; undo, cancellation and missing fixtures never refund game capacity', () => {
  const state = new OrganizerCapacityState(), doc = structuredClone(organizerCapacityExamples[2]);
  doc.fixtures = Array.from({ length: 13 }, (_, index) => ({ ...newTournamentFixture(`g${index}`, 'manual'),
    homeTeamId: doc.teams[0].id, awayTeamId: doc.teams[1].id }));
  state.reserve(command(doc.id));
  for (let index = 0; index < 13; index++) state.start('organizer', doc, game(doc, index));
  const access = state.access('organizer');
  state.start('organizer', doc, game(doc));
  assert.equal(state.usage(doc.id).length, 13);
  assert.deepEqual(state.access('organizer'), access);
  doc.fixtures = [];
  assert.equal(estimateTournamentCapacity(doc, state.usage(doc.id)).games, 26);
  denied(() => state.start('organizer', doc, { ...game(organizerCapacityExamples[2]), gameId: 'game-14' }), 403);
  assert.equal(state.usage(doc.id).length, 13);
});
test('no paid flags, expiry, dates, foreign account or invoice fields are accepted in a free reservation', () => {
  const valid = command('tournament');
  assert.deepEqual(readOrganizerFreeReservation(valid), valid);
  for (const extra of [{ consumedAt: '2026-11-23T16:00:00.000Z' }, { paid: true }, { months: 1 }, { maxGames: 100 }, { price: 0 }])
    assert.throws(() => readOrganizerFreeReservation({ ...valid, ...extra }));
  const state = new OrganizerCapacityState(), doc = organizerCapacityExamples[2];
  state.reserve(valid);
  denied(() => state.start('another', doc, game(doc)), 403);
  assert.equal(state.access('another').consumedAt, null);
});
test('serialized state preserves free ownership, game slots and nonce audit, and corrupt state cannot reset the benefit', () => {
  const original = new OrganizerCapacityState(), doc = organizerCapacityExamples[2], reservation = command(doc.id);
  original.reserve(reservation); original.start('organizer', doc, game(doc));
  const restored = new OrganizerCapacityState();
  restored.restore(deserialize(serialize(original.export())));
  assert.deepEqual(restored.access('organizer'), original.access('organizer'));
  assert.deepEqual(restored.usage(doc.id), original.usage(doc.id));
  assert.equal(restored.reserve(reservation).replayed, true);
  for (const broken of [{}, { ...original.export(), free: new Map([['organizer', { ...original.access('organizer'), consumedAt: 'invalid' }]]) }])
    assert.throws(() => restored.restore(broken));
  assert.deepEqual(restored.access('organizer'), original.access('organizer'));
});
test('readonly operation policy requires the exact reservation, never consumes, and allows counted games at the limit', () => {
  const state = new OrganizerCapacityState(), doc = structuredClone(organizerCapacityExamples[2]);
  doc.fixtures = Array.from({ length: 13 }, (_, index) => ({ ...doc.fixtures[0], id: `game-${index}` }));
  const first = game(doc);
  assert.equal(state.allows('organizer', doc, first.gameId), false);
  state.reserve(command(doc.id));
  const reserved = state.access('organizer');
  assert.equal(state.allows('organizer', doc, first.gameId), true);
  assert.equal(state.allows('other', doc, first.gameId), false);
  assert.deepEqual(state.access('organizer'), reserved);
  assert.deepEqual(state.usage(doc.id), []);
  for (let index = 0; index < 13; index++) state.start('organizer', doc, game(doc, index));
  assert.equal(state.allows('organizer', doc, first.gameId), true);
  assert.equal(state.allows('organizer', doc, 'another-game'), false);
  doc.phases[0].maxGames = 14;
  assert.equal(state.allows('organizer', doc, first.gameId), true, 'counted games retain continuity');
});
test('catalog capacity blocks organizers and even authorized substitutes, but not manager lineup preparation', () => {
  const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
  const games = ['new', 'counted'].map(gameId => ({ gameId, tournamentId: 'cup', managerTeamId: 'team' }));
  const scoring = {
    listOfficialGames: (userId, role) => ({ userId, role, games }),
    organizerGameOperationAllowed: (_cup, gameId) => gameId === 'counted',
    gameOperationStartedAt: () => null,
    scorekeeperTournaments: () => [],
    managerPlanTeams: () => [],
    isScorekeeperSubstitute: () => true,
  };
  const accounts = {
    authenticate: () => ({ id: 'account' }),
    scorekeeperAccess: () => ({ tournaments: [{ tournamentId: 'cup', enabled: true }], extras: [] }),
    managerTeamAccess: () => ({ teams: [{ tournamentId: 'cup', teamId: 'team', managed: true }] }),
    roleContinuationAllowed: () => false,
    roleOperationAllowed: () => true,
  };
  const controller = new OfficialScoringController(scoring, accounts);
  for (const role of ['organizer','scorekeeper','manager']) {
    const snapshot = controller.listOfficialGames('person:account', role, { headers: { cookie: 'playsport-account=account' } });
    assert.equal(snapshot.games[0].canOperate, role === 'manager');
    assert.equal(snapshot.games[0].organizerCapacityBlocked, role === 'manager' ? undefined : true);
    assert.equal(snapshot.games[1].canOperate, true);
    assert.equal(snapshot.games[1].organizerCapacityBlocked, undefined);
  }
});
