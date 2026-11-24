const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { availablePersonnelPositions, lineupDefenderCount, lineupSizeError } = require('@playsport/shared');

function setup() {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['score', 'blocked'], scorekeeperIdentities: [
      { actorId: 'score', identificationNumber: 'SCORE0001' }, { actorId: 'blocked', identificationNumber: 'BLOCKED0001' }
    ] });
  for (const [teamId, managerId, prefix] of [['home', 'mgr', 'HOME'], ['away', 'rival', 'AWAY']]) {
    const ids = Array.from({ length: 11 }, (_, i) => `${prefix}${i}`);
    for (const identificationNumber of ids) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber, displayName: `Jugador ${identificationNumber}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
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
test('late arrival and substitution is one atomic action, including pending manager approval and stale rechecks', () => {
  const e = setup(); e.service.configureGameLineup(e.initial);
  const action = { ...substitute, incomingIdentificationNumber: 'HOME10', jerseyNumber: '11', arrival: true };
  const before = e.get(), official = e.service.getOfficialState('game', 'tour');
  for (const patch of [{ jerseyNumber: '2' }, { incomingIdentificationNumber: 'AWAY10' },
    { outgoingIdentificationNumber: 'missing' }, { fieldPosition: 'NA' }, { arrival: false }])
    bad(() => e.send({ ...action, ...patch }), 400);
  assert.deepEqual(e.get(), before);
  const requested = e.send(action);
  assert.equal(requested.requests.at(-1).status, 'pending');
  assert.deepEqual(requested.sheets[0], before.sheets[0]);
  const pendingOfficial = e.service.getOfficialState('game', 'tour');
  assert.equal(pendingOfficial.state.officialVersion, official.state.officialVersion + 1);
  const confirmed = e.decide(requested.requests.at(-1));
  assert.equal(confirmed.sheets[0].lineup[0].identificationNumber, 'HOME10');
  assert.equal(confirmed.sheets[0].lineup[0].battingOrder, 1);
  assert.equal(confirmed.sheets[0].lineup[0].jerseyNumber, '11');
  assert.equal(confirmed.sheets[0].revision, before.sheets[0].revision + 1);
  assert.equal(confirmed.sheets[0].presentSubstitutes.some(p => p.identificationNumber === 'HOME10'), false);
  assert.equal(confirmed.requests.at(-1).action.arrival, true);
  assert.equal(e.service.getOfficialState('game', 'tour').state.officialVersion, pendingOfficial.state.officialVersion + 1);
  bad(() => e.send({ ...action, outgoingIdentificationNumber: 'HOME1' }), 400);
});
test('direct late arrival substitution rejects unauthorized and stale writes without registering arrival', () => {
  const e = setup(); e.service.configureGameLineup(e.initial);
  const before = e.get(), state = e.service.getOfficialState('game', 'tour');
  const command = { gameId: 'game', tournamentId: 'tour', teamId: 'home', actorId: 'score', actorRole: 'scorekeeper',
    expectedRevision: before.sheets[0].revision, expectedOfficialVersion: state.state.officialVersion,
    action: { ...substitute, incomingIdentificationNumber: 'HOME10', jerseyNumber: '11', arrival: true } };
  bad(() => e.service.recordPersonnelChange({ ...command, actorId: 'mgr', actorRole: 'manager' }), 403);
  bad(() => e.service.recordPersonnelChange({ ...command, expectedOfficialVersion: -1 }), 409);
  bad(() => e.service.recordPersonnelChange({ ...command, action: { ...command.action, jerseyNumber: '3' } }), 400);
  assert.deepEqual(e.get(), before);
  assert.deepEqual(e.service.getOfficialState('game', 'tour'), state);
  const after = e.service.recordPersonnelChange(command);
  assert.equal(after.sheets[0].lineup[0].identificationNumber, 'HOME10');
  assert.equal(after.sheets[0].lineup.length, 9);
  assert.equal(after.requests.at(-1).status, 'approved');
  bad(() => e.service.recordPersonnelChange(command), 409);
});
test('explicit internal exchange targets the selected player and preserves NA slots, jerseys and batting orders', () => {
  const e = setup();
  e.service.configureGameLineup({ ...e.initial,
    lineupEntries: [...e.initial.lineupEntries, { identificationNumber: 'HOME9', battingOrder: 10, fieldPosition: 'NA', jerseyNumber: '10' }],
    presentSubstituteIdentificationNumbers: [] });
  const before = e.get();
  const action = { kind: 'defense', identificationNumber: 'HOME3', fieldPosition: 'NA', swapWith: 'HOME9' };
  for (const patch of [{ swapWith: 'HOME10' }, { swapWith: 'HOME3' }, { fieldPosition: 'P' }])
    bad(() => e.send({ ...action, ...patch }), 400);
  assert.deepEqual(e.get(), before);
  const after = e.decide(e.send(action).requests.at(-1)).sheets[0];
  assert.equal(after.lineup[3].fieldPosition, 'NA');
  assert.equal(after.lineup[9].fieldPosition, '2B');
  assert.deepEqual(after.lineup.map(p => [p.identificationNumber, p.battingOrder, p.jerseyNumber]),
    before.sheets[0].lineup.map(p => [p.identificationNumber, p.battingOrder, p.jerseyNumber]));
});
const withdraw = (e, patch = {}) => e.service.withdrawTeamSheet({
  gameId:'game',tournamentId:'tour',teamId:'home',managerId:'mgr',
  expectedRevision:e.get().sheets.find(sheet=>sheet.teamId==='home')?.revision,
  expectedVersion:e.get().version,...patch
});

for(const count of [9,10,11,12,13])test(`delivery accepts ${count} actual batters, without requiring unused optional rows`,()=>{
  const e=setup();
  const ids=Array.from({length:15},(_,index)=>`HOME${index}`);
  for(const identificationNumber of ids.slice(11))e.service.registerGlobalPlayer({actorId:'org',player:{identificationNumber,displayName:identificationNumber}});
  e.service.configureTournamentTeamRoster({tournamentId:'tour',organizerId:'org',teamId:'home',managerId:'mgr',
    managerIdentificationNumber:'MANAGERhome',playerIdentificationNumbers:ids});
  const lineupEntries=[...e.initial.lineupEntries,...Array.from({length:count-9},(_,index)=>({
    identificationNumber:ids[index+9],battingOrder:index+10,fieldPosition:'NA',lineupRole:'EH',jerseyNumber:String(index+10)
  }))];
  e.service.configureGameLineup({...e.initial,lineupEntries,presentSubstituteIdentificationNumbers:[ids[count]]});
  const sheet=e.get().sheets[0];
  assert.equal(sheet.initialLineup.length,count);
  assert.equal(sheet.lineup.length,count);
  assert.equal(lineupDefenderCount(sheet.initialLineup),9);
  assert.match(lineupSizeError(sheet.initialLineup,[...sheet.lineup,{...sheet.lineup[0],battingOrder:count+1}]),/turnos titulares/);
});

for(const defenders of [9,10,11])test(`personnel changes preserve the initial ${defenders} defenders, independently of batting count`,()=>{
  const e=setup();
  const lineupEntries=[...e.initial.lineupEntries,...Array.from({length:2},(_,index)=>({
    identificationNumber:`HOME${index+9}`,battingOrder:index+10,
    fieldPosition:index+9<defenders?['OF4','SF'][index]:'NA',lineupRole:'EH',jerseyNumber:String(index+10)
  }))];
  e.service.configureGameLineup({...e.initial,lineupEntries,presentSubstituteIdentificationNumbers:[]});
  const before=e.get();
  assert.equal(lineupDefenderCount(before.sheets[0].lineup),defenders);
  assert.throws(()=>e.send({kind:'defense',identificationNumber:'HOME0',fieldPosition:'NA'}),/fija \d+ defensores/);
  assert.deepEqual(e.get(),before);
  const options=availablePersonnelPositions(before.sheets[0],'HOME0');
  assert.ok(options.includes('P'));
  assert.ok(!options.includes('DH')&&!options.includes('NA'));
  if(defenders<11){
    const extra=`HOME${defenders}`;
    assert.throws(()=>e.send({kind:'defense',identificationNumber:extra,fieldPosition:defenders===9?'OF4':'SF'}),/fija \d+ defensores/);
    assert.deepEqual(e.get(),before);
    assert.ok(!availablePersonnelPositions(before.sheets[0],extra).includes('P'));
    assert.ok(availablePersonnelPositions(before.sheets[0],extra,true).includes('P'));
    const swapped=e.decide(e.send({kind:'defense',identificationNumber:extra,fieldPosition:'P'}).requests.at(-1));
    assert.equal(lineupDefenderCount(swapped.sheets[0].lineup),defenders);
    assert.equal(swapped.sheets[0].lineup[0].fieldPosition,'NA');
    assert.equal(swapped.sheets[0].lineup.length,11);
  }
});

test('substitution and direct official changes cannot remove a defender, and invalid commands are atomic',()=>{
  const e=setup();e.service.configureGameLineup(e.initial);
  const before=e.get(),state=e.service.getOfficialState('game','tour');
  assert.throws(()=>e.send({...substitute,fieldPosition:'DH'}),/fija 9 defensores/);
  assert.throws(()=>e.service.recordPersonnelChange({
    gameId:'game',tournamentId:'tour',teamId:'home',actorId:'score',actorRole:'scorekeeper',
    expectedRevision:1,expectedOfficialVersion:state.state.officialVersion,action:{...substitute,fieldPosition:'NA'}
  }),/fija 9 defensores/);
  assert.deepEqual(e.get(),before);
  assert.deepEqual(e.service.getOfficialState('game','tour'),state);
  const updated=e.decide(e.send(substitute).requests.at(-1));
  assert.equal(lineupDefenderCount(updated.sheets[0].lineup),9);
  assert.equal(updated.sheets[0].lineup[0].battingOrder,1);
});

test('confirmation rechecks the defensive count when a previously valid pending move would now add a defender',()=>{
  const e=setup();
  e.service.configureGameLineup({...e.initial,presentSubstituteIdentificationNumbers:['HOME10'],
    lineupEntries:[...e.initial.lineupEntries,{identificationNumber:'HOME9',battingOrder:10,fieldPosition:'NA',lineupRole:'EH',jerseyNumber:'10'}]});
  const pending=e.send({kind:'defense',identificationNumber:'HOME0',fieldPosition:'SF'}).requests.at(-1);
  e.decide(e.send({kind:'defense',identificationNumber:'HOME9',fieldPosition:'P'}).requests.at(-1));
  const before=e.get();
  assert.throws(()=>e.decide(pending),/fija 9 defensores/);
  assert.deepEqual(e.get(),before);
  assert.equal(e.get().requests.find(request=>request.id===pending.id).status,'pending');
});

test('DP and FLEX count defense separately from batting and cannot gain or lose defensive slots',()=>{
  const e=setup();
  const lineupEntries=e.initial.lineupEntries.map((entry,index)=>index===0?{...entry,lineupRole:'DP',fieldPosition:'NA'}:entry);
  lineupEntries.push({identificationNumber:'HOME9',battingOrder:null,fieldPosition:'P',lineupRole:'FLEX',jerseyNumber:'10'});
  e.service.configureGameLineup({...e.initial,lineupEntries,presentSubstituteIdentificationNumbers:['HOME10']});
  const sheet=e.get().sheets[0];
  assert.equal(lineupDefenderCount(sheet.initialLineup),9);
  assert.equal(sheet.lineup.filter(row=>row.battingOrder!==null).length,9);
  assert.deepEqual(availablePersonnelPositions(sheet,'HOME0'),['DH','NA']);
  assert.ok(!availablePersonnelPositions(sheet,'HOME9').includes('NA'));
  assert.throws(()=>e.send({kind:'defense',identificationNumber:'HOME0',fieldPosition:'OF4'}),/fija 9 defensores/);
  const updated=e.decide(e.send({kind:'substitution',outgoingIdentificationNumber:'HOME9',incomingIdentificationNumber:'HOME10',fieldPosition:'P',jerseyNumber:'11'}).requests.at(-1));
  assert.equal(updated.sheets[0].lineup.at(-1).battingOrder,null);
  assert.equal(lineupDefenderCount(updated.sheets[0].lineup),9);
});

test('before first pitch the manager can withdraw only their delivery, notify recipients and deliver a new lineup',()=>{
  const e=setup();e.service.configureGameLineup(e.initial);
  e.service.submitOfficialUpdate({gameId:'game',tournamentId:'tour',actorId:'score',actorRole:'scorekeeper',patch:{offenseTeamId:'home'}});
  e.service.configureGameLineup({...e.initial,teamId:'away',managerId:'rival',presentSubstituteIdentificationNumbers:[],
    presentOfficials:[],lineupEntries:e.initial.lineupEntries.map((row,index)=>({...row,identificationNumber:`AWAY${index}`}))});
  const rival=e.get().sheets.find(sheet=>sheet.teamId==='away');
  const notifications=[];
  const subscription=e.service.createTeamSheetStream('game','tour','score','scorekeeper').subscribe(value=>notifications.push(value));
  try{
    assert.equal(e.get().sheets.find(sheet=>sheet.teamId==='home').canWithdraw,true);
    assert.equal(e.get('rival').sheets.find(sheet=>sheet.teamId==='home').canWithdraw,false);
    const roster=e.service.getTournamentTeamRoster('tour','home','free');
    const removed=withdraw(e);
    assert.equal(e.service.getOfficialState('game','tour').state.nextBatterId,null);
    assert.deepEqual(removed.sheets,[rival]);
    assert.deepEqual(notifications.at(-1).sheets,[{...rival,canWithdraw:false}]);
    assert.equal(e.service.getGameLineups('game','tour').lineup.lineups.length,1);
    assert.deepEqual(e.service.getTournamentTeamRoster('tour','home','free'),roster);
    const updated=e.initial.lineupEntries.map((row,index)=>({...row,identificationNumber:index===0?'HOME9':row.identificationNumber}));
    e.service.configureGameLineup({...e.initial,lineupEntries:updated,presentSubstituteIdentificationNumbers:['HOME0']});
    assert.equal(e.get().sheets.find(sheet=>sheet.teamId==='home').lineup[0].identificationNumber,'HOME9');
  }finally{subscription.unsubscribe();}
});

test('the reader validates the optional withdrawal capability without breaking older deliveries',()=>{
  const {readTeamSheets}=require('@playsport/shared');
  const e=setup();e.service.configureGameLineup(e.initial);
  const snapshot=e.get();assert.equal(readTeamSheets(snapshot).sheets[0].canWithdraw,true);
  delete snapshot.sheets[0].canWithdraw;assert.doesNotThrow(()=>readTeamSheets(snapshot));
  snapshot.sheets[0].canWithdraw='yes';assert.throws(()=>readTeamSheets(snapshot),/datos inválidos/);
});

test('withdrawal rejects foreign managers, teams, missing sheets and stale commands atomically, including after redelivery',()=>{
  const e=setup();e.service.configureGameLineup(e.initial);
  const version=e.get().version, before=e.get();
  for(const patch of [{managerId:'rival'},{teamId:'away'}])bad(()=>withdraw(e,patch),403);
  for(const patch of [{gameId:'other'},{expectedVersion:version-1},{expectedRevision:2},{expectedVersion:undefined}])bad(()=>withdraw(e,patch),409);
  assert.deepEqual(e.get(),before);
  withdraw(e);bad(()=>withdraw(e),409);
  e.service.configureGameLineup(e.initial);
  const resent=e.get();
  bad(()=>withdraw(e,{expectedRevision:1,expectedVersion:version}),409);
  assert.deepEqual(e.get(),resent);
});

test('withdrawing closes pending own requests without removing their history or letting them affect the new delivery',()=>{
  const e=setup();e.service.configureGameLineup(e.initial);
  const pending=e.send(substitute).requests.at(-1);
  const result=withdraw(e);
  assert.equal(result.requests[0].id,pending.id);
  assert.equal(result.requests[0].status,'rejected');
  assert.match(result.requests[0].decisionNote,/canceló la alineación/);
  e.service.configureGameLineup(e.initial);
  const before=e.get();
  bad(()=>e.decide(pending),409);
  assert.deepEqual(e.get(),before);
});

test('withdrawal is blocked after start even if the scoreboard is subsequently set back to scheduled',()=>{
  const e=setup();e.service.configureGameLineup(e.initial);
  e.service.submitOfficialUpdate({gameId:'game',tournamentId:'tour',actorId:'score',actorRole:'scorekeeper',patch:{status:'in_progress'}});
  assert.equal(e.get().sheets[0].canWithdraw,false);
  bad(()=>withdraw(e),409);
  e.service.submitOfficialUpdate({gameId:'game',tournamentId:'tour',actorId:'score',actorRole:'scorekeeper',patch:{status:'scheduled'}});
  const before=e.get();
  bad(()=>withdraw(e),409);
  assert.equal(before.sheets[0].canWithdraw,false);
  assert.deepEqual(e.get(),before);
});

test('manual lineup rows preserve two-digit jerseys including 00 and 99 through delivery and recovery', () => {
  const { service, initial, get } = setup();
  const numbers = ['00','01','02','03','04','05','06','07','99'];
  service.configureGameLineup({ ...initial, lineupEntries: initial.lineupEntries.map((entry,index) => ({
    ...entry, jerseyNumber:numbers[index]
  })) });
  for (const [user,role] of [['mgr','manager'],['score','scorekeeper']]) {
    const sheet=get(user,role).sheets[0];
    assert.deepEqual(sheet.initialLineup.map(entry=>entry.jerseyNumber),numbers);
    assert.deepEqual(sheet.lineup.map(entry=>entry.jerseyNumber),numbers);
    assert.deepEqual(sheet.initialLineup.map(entry=>entry.battingOrder),[1,2,3,4,5,6,7,8,9]);
    assert.equal(sheet.revision,1);
  }
  assert.deepEqual(get().sheets[0].lineup.map(entry=>entry.jerseyNumber),numbers);
});

test('manager requests preserve the inherited batting slot when a confirmed substitute later swaps defense', () => {
  const e = setup();
  e.service.configureGameLineup(e.initial);
  e.decide(e.send({ ...substitute, outgoingIdentificationNumber: 'HOME3', fieldPosition: '2B' }).requests.at(-1));
  const updated = e.decide(e.send({ kind: 'defense', identificationNumber: 'HOME9', fieldPosition: 'LF' }).requests.at(-1));
  const sheet = updated.sheets[0];
  assert.deepEqual(sheet.lineup.map(player => [player.identificationNumber, player.battingOrder]), [
    ['HOME0', 1], ['HOME1', 2], ['HOME2', 3], ['HOME9', 4], ['HOME4', 5], ['HOME5', 6], ['HOME6', 7], ['HOME7', 8], ['HOME8', 9]
  ]);
  assert.equal(sheet.lineup[3].fieldPosition, 'LF');
  assert.equal(sheet.lineup[6].fieldPosition, '2B');
  assert.deepEqual(sheet.initialLineup.map(player => player.identificationNumber), e.initial.lineupEntries.map(player => player.identificationNumber));
});

test('a manager cannot request a batting-order change disguised as a substitution or defensive swap', () => {
  const e = setup();
  e.service.configureGameLineup(e.initial);
  const before = e.get();
  for (const action of [substitute, { kind: 'defense', identificationNumber: 'HOME3', fieldPosition: 'LF' }]) {
    for (const key of ['order', 'battingOrder']) bad(() => e.send({ ...action, [key]: 7 }), 400);
  }
  assert.deepEqual(e.get(), before);
});

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
    const firstVersion = events[0].version;
    assert.deepEqual(events.map((event) => event.version), [firstVersion, firstVersion + 1, firstVersion + 2, firstVersion + 3]);
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
  const initialVersion = get().version;
  for (const patch of [
    { presentSubstituteIdentificationNumbers: ['AWAY9'] },
    { presentSubstituteIdentificationNumbers: ['HOME0'] },
    { presentSubstituteIdentificationNumbers: ['HOME9', 'HOME9'] },
    { presentOfficials: [{ role: 'COACH_3B', identificationNumber: 'COACH3', displayName: 'No permitido' }] }
  ]) {
    bad(() => service.configureGameLineup({ ...initial, ...patch }), 400);
    assert.equal(get().sheets.length, 0);
    assert.equal(get().version, initialVersion);
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
