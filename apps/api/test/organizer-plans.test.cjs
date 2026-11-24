const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { serialize, deserialize } = require('node:v8');
const { organizerPackages, organizerCapacityExamples, organizerPlanQuote, estimateTournamentCapacity,
  readOrganizerPlanRequest, readOrganizerPlanAuthorization, readOrganizerGameRestart } = require('@playsport/shared');
const { OrganizerCapacityState } = require('../src/modules/live-scoring/organizer-capacity-state');
const doc = () => structuredClone(organizerCapacityExamples[2]);
const select = (tournamentId, selection, expectedRevision = 0) => ({ expectedAccountId: 'owner', tournamentId, selection, expectedRevision, requestId: randomUUID() });
const custom = (teams, games) => ({ planId: 'custom', teams, games });
const authorize = (tournamentId, expectedRevision, action = 'authorize-test') => ({ expectedAdminId: 'admin', tournamentId, expectedRevision, requestId: randomUUID(), action, reason: 'Prueba de capacidad' });
const played = (document, fixture) => ({ gameId: `plan:${document.id}:${fixture.id}`, fixtureId: fixture.id,
  teamIds: [fixture.homeTeamId, fixture.awayTeamId], at: '2026-11-23T16:00:00.000Z' });
test('packages, personalized capacity and expansion use ordinary games only, never fake a price', () => {
  assert.deepEqual(organizerPackages.map(plan => [plan.teams,plan.games]), [[8,40],[16,150],[32,550]]);
  const document = doc(), state = new OrganizerCapacityState();
  const first = select(document.id, custom(2,27)); state.select(first); state.authorize(authorize(document.id,1),'2026-11-23T16:00:00.000Z');
  const quote = organizerPlanQuote(document, custom(2,35), state.plan(document.id));
  assert.equal(quote.activationUnits,0); assert.equal(quote.additionalGames,8); assert.equal(quote.amount,null);
  state.select(select(document.id,custom(2,35),2));
  const pending = organizerPlanQuote(document, custom(2,35), state.plan(document.id));
  assert.equal(pending.activationUnits,0); assert.equal(pending.additionalGames,8, 'pending expansion preserves the original credit');
  assert.equal(state.plan(document.id).status,'pending-pricing');
  state.authorize(authorize(document.id,3),'2026-11-23T16:01:00.000Z');
  assert.equal(state.plan(document.id).authorizedGames,35);
});
test('paid-first selection never consumes the free opportunity, is not itself permission, and cannot be transferred', () => {
  const document = doc(), state = new OrganizerCapacityState(), command = select(document.id,custom(2,13));
  state.select(command);
  assert.equal(state.access('owner').tournamentId,null);
  assert.equal(state.allows('owner',document,played(document,document.fixtures[0]).gameId),false);
  state.authorize(authorize(document.id,1),'2026-11-23T16:00:00.000Z');
  assert.equal(state.allows('owner',document,played(document,document.fixtures[0]).gameId),true);
  state.start('owner',document,played(document,document.fixtures[0]));
  assert.equal(state.access('owner').consumedAt,null);
  assert.equal(state.allows('foreign',document,played(document,document.fixtures[0]).gameId),false);
  assert.equal(state.allows('owner',{...document,id:'another'},'other'),false);
  assert.equal(state.select(command).replayed,true);
});
test('teams and phases can grow within authorized game capacity; revocation cannot be undone by selecting again', () => {
  const state = new OrganizerCapacityState(), document = doc();
  state.select(select(document.id,custom(2,40))); state.authorize(authorize(document.id,1),'2026-11-23T16:00:00.000Z');
  state.select(select(document.id,custom(8,40),2));
  assert.equal(state.plan(document.id).status,'authorized-test');
  assert.equal(organizerPlanQuote(document,custom(8,40),state.plan(document.id)).additionalGames,0);
  state.authorize(authorize(document.id,3,'revoke-test'),'2026-11-23T16:01:00.000Z');
  state.select(select(document.id,custom(8,40),4));
  assert.equal(state.plan(document.id).status,'revoked-test');
  assert.equal(state.allows('owner',document,played(document,document.fixtures[0]).gameId),false);
});
test('free capacity includes 13 ordinary games plus three justified tie breakers and rejects a fourth or undeclared cause', () => {
  const document = doc(), source = document.phases[0];
  document.fixtures = Array.from({length:13},(_,index)=>({...document.fixtures[0],id:`regular-${index}`}));
  document.phases.push({...source,id:'ties',purpose:'tie-breaker',tieBreakReason:'Empate por cupo de clasificación',sourcePhaseId:source.id,maxGames:3});
  document.fixtures.push(...Array.from({length:3},(_,index)=>({...document.fixtures[0],id:`tie-${index}`,phaseId:'ties'})));
  const estimate = estimateTournamentCapacity(document);
  assert.equal(estimate.normalGames,13); assert.equal(estimate.tieBreakGames,3); assert.equal(estimate.games,16); assert.equal(estimate.freeEligible,true);
  const state = new OrganizerCapacityState();
  state.reserve({expectedAccountId:'owner',expectedRevision:0,requestId:randomUUID(),tournamentId:document.id});
  for (const fixture of document.fixtures) state.start('owner',document,played(document,fixture));
  assert.equal(state.usage(document.id).filter(game=>game.kind==='tie-breaker').length,3);
  assert.equal(state.usage(document.id).filter(game=>game.kind==='regular').length,13);
  document.phases[1].maxGames=4;
  assert.equal(estimateTournamentCapacity(document).freeEligible,false);
  document.phases[1].maxGames=3; document.phases[1].tieBreakReason='';
  assert.equal(estimateTournamentCapacity(document).complete,false);
});
test('authorization, game slots, expansion credits and replays persist and closed tournaments cannot operate', () => {
  const state = new OrganizerCapacityState(), document = doc(), command = select(document.id,custom(2,40));
  state.select(command); state.authorize(authorize(document.id,1),'2026-11-23T16:00:00.000Z');
  state.start('owner',document,played(document,document.fixtures[0]));
  const restored = new OrganizerCapacityState(); restored.restore(deserialize(serialize(state.export())));
  assert.deepEqual(restored.plan(document.id),state.plan(document.id));
  assert.deepEqual(restored.usage(document.id),state.usage(document.id));
  assert.equal(restored.select(command).replayed,true);
  document.status='finished';
  assert.equal(restored.allows('owner',document,played(document,document.fixtures[0]).gameId),false);
  assert.throws(()=>restored.restore({...state.export(),plans:new Map([[document.id,{accountId:'owner',revision:2,access:{...state.plan(document.id),authorizedGames:0}}]])}));
});
test('clients cannot supply paid flags, prices, trial authorization, consumption dates or archived sports data', () => {
  const selection=select('cup',custom(2,13)), grant=authorize('cup',1);
  const restart={expectedAccountId:'owner',tournamentId:'cup',gameId:'game',expectedOfficialVersion:1,requestId:randomUUID(),reason:'Lluvia intensa'};
  for (const [reader,value] of [[readOrganizerPlanRequest,selection],[readOrganizerPlanAuthorization,grant],[readOrganizerGameRestart,restart]])
    for (const extra of [{paid:true},{amount:0},{expiresAt:'2027-01-01'},{statistics:{runs:1}}]) assert.throws(()=>reader({...value,...extra}));
  assert.throws(()=>readOrganizerGameRestart({...restart,reason:' '}));
});
