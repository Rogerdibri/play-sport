const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { NestFactory } = require('@nestjs/core');
const { rosterClosure, readRosterRules, rosterRulesDraft, rulesFromDraft, rosterGroup, RosterRulesClient, presentOfficialRoleLabels, readTeamSheets } = require('@playsport/shared');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { RegistrationController } = require('../src/modules/live-scoring/registration.controller');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const caps = { players: 12, direction: 2, coaches: 2, support: 2 };
const rules = (cutoff = { kind: 'date', date: '2099-12-31' }, limits = caps) => ({ caps: { ...limits }, cutoff });
const game = (gameId, homeTeamId, awayTeamId, status = 'scheduled', started = status !== 'scheduled' && status !== 'suspended') =>
  ({ gameId, homeTeamId, awayTeamId, status, started, label: gameId });
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-roster-rules-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'registry.json'), registry = new RegistrationService(file);
  const scoring = new OfficialScoringService(registry), api = new RegistrationController(registry, scoring);
  scoring.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000',
    scorekeeperIds: ['score'], scorekeeperIdentities: [{ actorId: 'score', identificationNumber: 'SCORE1000' }] });
  for (const teamId of ['home', 'away']) {
    for (let i = 0; i < 9; i++) scoring.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: `${teamId}${i}`, displayName: `Jugador ${teamId}${i}` } });
    scoring.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `${teamId}${i}`) });
  }
  for (const gameId of ['one', 'two']) {
    scoring.configureGameTeams({ gameId, tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
    scoring.configureGameAuthorization({ gameId, tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
    scoring.configureGameDetails({ gameId, tournamentId: 'tour', organizerId: 'org', details: { tournamentName: 'Prueba', homeTeamName: 'Locales',
      awayTeamName: 'Visitantes', date: '2026-11-05', time: '18:00', venue: 'Estadio', stateId: 'VE-A', municipalityId: 'VE-A:libertador' } });
  }
  const context = { tournamentId: 'tour', teamId: 'home', managerId: 'mgr-home' };
  let serial = 0;
  const add = (role = 'PLAYER', patch = {}) => api.preinscribe({ ...context, role, person: {
    identification: `V-${95000000 + ++serial}`, fullName: `Persona Ficticia ${serial}`, birthDate: '1990-04-15', email: '',
    phone: '04121234567', representativeIdentification: '', ...patch } });
  const save = (value = rules(), revision = 0, reopen = false) => api.saveRosterRules('tour', { organizerId: 'org', rules: value, revision, reopen });
  const deliver = (extra) => {
    for (const teamId of ['home', 'away']) scoring.configureGameLineup({ gameId: 'one', tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
      lineupEntries: Array.from({ length: 9 }, (_, i) => ({ identificationNumber: teamId === 'home' && i === 0 && extra ? extra : `${teamId}${i}`,
        battingOrder: i + 1, jerseyNumber: String(i + 1), fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i] })) });
  };
  const state = () => structuredClone(scoring.getOfficialState('one', 'tour'));
  const send = patch => scoring.submitOfficialUpdate({ gameId: 'one', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: state().state.officialVersion, patch });
  return { file, registry, scoring, api, context, add, save, deliver, state, send };
}
test('rules require four integer caps and exactly one valid cutoff; drafts cannot turn blank limits into zero', () => {
  assert.deepEqual(rulesFromDraft(rosterRulesDraft(rules())), rules());
  assert.throws(() => rulesFromDraft(rosterRulesDraft(null)));
  for (const patch of [{ players: -1 }, { direction: 1.5 }, { coaches: '2' }, { support: undefined }]) assert.throws(() => readRosterRules(rules(undefined, { ...caps, ...patch })));
  for (const cutoff of [{ kind: 'date', date: '2026-02-29' }, { kind: 'date', date: '2099-01-01', games: 2 },
    { kind: 'games', games: 0, count: 'tournament' }, { kind: 'games', games: 2, count: 'unknown' },
    { kind: 'round', round: 2, moment: 'finish', rounds: { one: 0 } }]) assert.throws(() => readRosterRules(rules(cutoff)));
  assert.equal(rosterGroup('PLAYER'), 'players'); assert.equal(rosterGroup('COACH_FIRST'), 'coaches');
});
test('date cutoff admits the complete Venezuelan day and closes at the exact next millisecond', () => {
  const value = rules({ kind: 'date', date: '2026-11-05' });
  assert.equal(rosterClosure(value, [], [], new Date('2026-11-06T03:59:59.999Z')).closed, false);
  assert.equal(rosterClosure(value, [], [], new Date('2026-11-06T04:00:00.000Z')).closed, true);
});
for (const moment of ['start', 'finish']) test(`round ${moment} uses actual start, complete doubleheaders and explicit incomplete assignments`, () => {
  const value = rules({ kind: 'round', round: 2, moment, rounds: { one: 2, two: 2, later: 3 } });
  const games = [game('one', 'A', 'B', 'suspended', false), game('two', 'A', 'B'), game('later', 'A', 'B')];
  assert.equal(rosterClosure(value, games, ['A', 'B']).closed, false);
  games[0] = game('one', 'A', 'B', 'final');
  assert.equal(rosterClosure(value, games, ['A', 'B']).closed, moment === 'start');
  games[1] = game('two', 'A', 'B', 'final');
  assert.equal(rosterClosure(value, games, ['A', 'B']).closed, true);
  const suspendedBeforeStart = [game('later', 'A', 'B', 'suspended', false)];
  assert.equal(rosterClosure(value, suspendedBeforeStart, ['A', 'B']).closed, false);
  suspendedBeforeStart[0].started = true;
  assert.equal(rosterClosure(value, suspendedBeforeStart, ['A', 'B']).closed, true);
  const incomplete = rosterClosure(value, [...games, game('new', 'A', 'B')], ['A', 'B']);
  assert.equal(incomplete.closed, true); assert.equal(incomplete.latch, false);
});
for (const count of ['tournament', 'first-team', 'all-teams']) test(`games cutoff ${count} reaches the exact global threshold, ignoring suspended and protested games`, () => {
  const value = rules({ kind: 'games', games: 2, count });
  const games = [game('one', 'A', 'B', 'final'), game('two', 'A', 'C', 'suspended'), game('three', 'B', 'C', 'protested')];
  assert.equal(rosterClosure(value, games, ['A', 'B', 'C']).closed, false);
  games[1] = game('two', 'A', 'C', 'final');
  assert.equal(rosterClosure(value, games, ['A', 'B', 'C']).closed, count !== 'all-teams');
  games[2] = game('three', 'B', 'C', 'final');
  assert.equal(rosterClosure(value, games, ['A', 'B', 'C']).closed, true);
});
test('manager directly adds a player without changing lineup, position, score or personal confirmation', t => {
  const e = setup(t); e.save(); e.deliver();
  const before = e.state(), recorded = structuredClone(e.scoring.games.get('one').playByPlay), member = e.add().members.at(-1);
  assert.equal(member.approvalStatus, 'approved'); assert.equal(member.addedBy, 'manager');
  assert.equal(member.person.registrationStatus, 'preinscribed');
  assert.equal(e.scoring.getTournamentTeamRoster('tour', 'home').rosterPlayers.length, 10);
  assert.deepEqual(e.state().state, before.state);
  assert.deepEqual(e.state().lineup, before.lineup);
  assert.deepEqual(e.scoring.games.get('one').playByPlay, recorded);
  assert.equal(member.fieldPosition, undefined); assert.equal(member.starter, undefined);
  const another = setup(t); another.save(); const candidate = another.add().members.at(-1);
  another.deliver(candidate.person.identification);
  assert.equal(another.state().lineup.lineups.find(row => row.teamId === 'home').lineupEntries[0].identificationNumber, 'V95000001');
});
for (const role of ['PLAYER', ...Object.keys(presentOfficialRoleLabels)]) test(`match leader can be a roster ${role}, without transferring the account or changing the permanent roster`, t => {
  const e = setup(t); e.save();
  const person = e.add(role).members.at(-1).person, before = readFileSync(e.file, 'utf8');
  const roster = e.scoring.getTournamentTeamRoster('tour', 'home'), state = e.state().state;
  const input = { gameId:'one',tournamentId:'tour',teamId:'home',managerId:'mgr-home',identificationNumber:person.id };
  const result = e.scoring.authorizeFieldRepresentative(input);
  assert.equal(result.representative.displayName, person.fullName);
  assert.equal(result.representative.authorizedByManagerId, 'mgr-home');
  assert.equal(e.scoring.getFieldRepresentative('two','tour','home').representative, null);
  assert.deepEqual(e.scoring.getTournamentTeamRoster('tour','home'),roster);
  assert.deepEqual(e.state().state,state);
  assert.equal(readFileSync(e.file,'utf8'),before);
  bad(() => e.scoring.authorizeFieldRepresentative({...input,managerId:person.id}),403);
  bad(() => e.scoring.authorizeFieldRepresentative({...input,teamId:'away',managerId:'mgr-away'}),400);
});
test('lineup delivery supports coaches and support selected from the roster while they remain ineligible as players', t => {
  const e = setup(t); e.save();
  const coach = e.add('COACH_FIRST').members.at(-1).person, support = e.add('MEDICAL').members.at(-1).person;
  const lineupEntries = Array.from({length:9},(_,i)=>({identificationNumber:`home${i}`,battingOrder:i+1,jerseyNumber:String(i+1),
    fieldPosition:['P','C','1B','2B','3B','SS','LF','CF','RF'][i]}));
  const input = {gameId:'one',tournamentId:'tour',teamId:'home',managerId:'mgr-home',lineupEntries};
  bad(() => e.scoring.configureGameLineup({...input,lineupEntries:lineupEntries.map((row,i)=>i?row:{...row,identificationNumber:coach.id})}),400);
  e.scoring.authorizeFieldRepresentative({...input,identificationNumber:coach.id});
  e.scoring.configureGameLineup({...input,presentOfficials:[
    {role:'COACH_FIRST',identificationNumber:coach.id,displayName:coach.fullName},
    {role:'MEDICAL',identificationNumber:support.id,displayName:support.fullName}
  ]});
  const snapshot = readTeamSheets(e.scoring.getTeamSheets('one','tour','mgr-home','manager'));
  assert.deepEqual(snapshot.sheets[0].presentOfficials.map(row=>row.role),['COACH_FIRST','MEDICAL']);
  assert.equal(snapshot.sheets[0].representative.displayName,coach.fullName);
});
for (const [role, group] of [['PLAYER', 'players'], ['MANAGER', 'direction'], ['COACH_FIRST', 'coaches'], ['MEDICAL', 'support']]) {
  test(`${group} capacity is atomic at its exact boundary and other groups remain usable`, t => {
    const e = setup(t); e.save(rules(undefined, { ...caps, [group]: group === 'players' ? 10 : 1 }));
    const first = e.add(role), before = readFileSync(e.file, 'utf8');
    assert.equal(first.admission.groups[group].used, first.admission.groups[group].limit);
    bad(() => e.add(role), 409); assert.equal(readFileSync(e.file, 'utf8'), before);
    bad(() => e.save(rules(undefined, { ...caps, [group]: first.admission.groups[group].used - 1 }), 1), 409);
    assert.equal(readFileSync(e.file, 'utf8'), before);
    e.add(group === 'support' ? 'DELEGADO' : 'TRAINER');
    assert.equal(e.api.getRoster('mgr-home', 'tour', 'home').members.length, 11);
  });
}
test('foreign organizers, stale revisions and limits below occupied counts reject without writing', t => {
  const e = setup(t); e.save(); const before = readFileSync(e.file, 'utf8');
  bad(() => e.api.getRosterRules('tour', 'stranger'), 403);
  bad(() => e.api.saveRosterRules('tour', { organizerId: 'stranger', rules: rules(), revision: 1, reopen: false }), 403);
  bad(() => e.save(rules(), 0), 409);
  bad(() => e.save(rules(undefined, { ...caps, players: 8 }), 1), 409);
  assert.equal(readFileSync(e.file, 'utf8'), before);
});
test('a configured tournament rejects context-free registry additions without orphan identities', t => {
  const e = setup(t); e.save(); const before = readFileSync(e.file, 'utf8');
  bad(() => e.registry.preinscribeRosterMember(e.api.rosterTeams('mgr-home').teams[0], 'PLAYER', {
    identification:'V-95009999',fullName:'Persona Ficticia',birthDate:'1990-04-15',phone:'04121234567',email:'',representativeIdentification:''
  }),409);
  assert.equal(readFileSync(e.file, 'utf8'), before);
});
test('player cannot join a second team; persisted staff incompatibility prevents later official authorization', t => {
  const e = setup(t); e.save(); const player = e.add().members.at(-1), before = readFileSync(e.file, 'utf8');
  bad(() => e.api.addRoster({ tournamentId: 'tour', teamId: 'away', managerId: 'mgr-away', role: 'PLAYER', personId: player.person.id }), 400);
  assert.equal(readFileSync(e.file, 'utf8'), before);
  const staff = e.add('MEDICAL').members.at(-1);
  bad(() => e.scoring.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['new-score'],
    scorekeeperIdentities: [{ actorId: 'new-score', identificationNumber: staff.person.identification }] }), 409);
});
test('an existing sporting player may belong to three tournaments simultaneously, but only one team in each', t => {
  const e = setup(t);
  for (const tournamentId of ['tour', 'tour-two', 'tour-three']) {
    if (tournamentId !== 'tour') {
      e.scoring.configureTournamentAuthorization({ tournamentId, organizerId: 'org', scorekeeperIds: [] });
      for (const [teamId, player] of [['home', 'HOME0'], ['away', 'AWAY0']]) {
        e.scoring.configureTournamentTeamRoster({ tournamentId, teamId, organizerId: 'org', managerId: `mgr-${teamId}`,
          playerIdentificationNumbers: [player] });
      }
    }
    assert.ok(e.scoring.getTournamentTeamRoster(tournamentId, 'home').rosterPlayerIds.includes('HOME0'));
    bad(() => e.scoring.configureTournamentTeamRoster({ tournamentId, teamId: 'away', organizerId: 'org', managerId: 'mgr-away',
      playerIdentificationNumbers: ['AWAY0', 'home0'] }), 400);
    assert.equal(e.scoring.getTournamentTeamRoster(tournamentId, 'away').rosterPlayerIds.includes('HOME0'), false);
  }
});
for (const [label, profile] of [
  ['adult with cedula', {}],
  ['minor without cedula', { identification: '', birthDate: '2015-03-20', representativeIdentification: 'E-95009999' }]
]) test(`direct ${label} reuses one identity across tournaments and rejects duplicate rosters within each`, t => {
  const e = setup(t); e.save();
  const member = e.add('PLAYER', profile).members.at(-1);
  for (const tournamentId of ['tour', 'tour-two', 'tour-three']) {
    if (tournamentId !== 'tour') {
      e.scoring.configureTournamentAuthorization({ tournamentId, organizerId: 'org', scorekeeperIds: [] });
      for (const [teamId, player] of [['home', 'HOME0'], ['away', 'AWAY0']]) {
        e.scoring.configureTournamentTeamRoster({ tournamentId, teamId, organizerId: 'org', managerId: `mgr-${teamId}`,
          playerIdentificationNumbers: [player] });
      }
      e.api.saveRosterRules(tournamentId, { organizerId: 'org', rules: rules(), revision: 0, reopen: false });
      const added = e.api.addRoster({ tournamentId, teamId: 'home', managerId: 'mgr-home', role: 'PLAYER', personId: member.person.id });
      assert.equal(added.members.at(-1).person.id, member.person.id);
    }
    const before = readFileSync(e.file, 'utf8');
    const found = e.api.lookupRoster('mgr-away', tournamentId, 'away',
      member.person.identification ? member.person.identification.toLowerCase().replace(/-/g, '') : member.person.id.toLowerCase()).person;
    assert.equal(found.id, member.person.id);
    bad(() => e.api.addRoster({ tournamentId, teamId: 'away', managerId: 'mgr-away', role: 'PLAYER', personId: found.id }), 400);
    bad(() => e.api.addRoster({ tournamentId, teamId: 'home', managerId: 'mgr-home', role: 'PLAYER', personId: found.id }), 409);
    bad(() => e.scoring.configureTournamentTeamRoster({ tournamentId, teamId: 'away', organizerId: 'org', managerId: 'mgr-away',
      playerIdentificationNumbers: ['AWAY0', member.person.identification || member.person.id] }), 400);
    assert.equal(readFileSync(e.file, 'utf8'), before);
  }
  const stored = JSON.parse(readFileSync(e.file, 'utf8'));
  assert.equal(stored.preinscriptions.filter(row => row.id === member.person.id).length, 1);
  assert.equal(stored.rosterMembers.filter(row => row.person.id === member.person.id && row.role === 'PLAYER').length, 3);
});
test('start closure is latched before scoring commits, closes both teams and remains after undo', t => {
  const e = setup(t); e.save(rules({ kind: 'round', round: 1, moment: 'start', rounds: { one: 1, two: 1 } })); e.deliver();
  e.send({ status: 'in_progress' });
  const stored = JSON.parse(readFileSync(e.file, 'utf8')).rosterRules[0];
  assert.ok(stored.closedAt);
  assert.equal(e.api.getRoster('mgr-home', 'tour', 'home').admission.closed, true);
  assert.equal(e.api.getRoster('mgr-away', 'tour', 'away').admission.closed, true);
  e.scoring.submitOfficialUpdate({ gameId: 'one', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: e.state().state.officialVersion, undoLast: true });
  assert.equal(e.state().state.status, 'scheduled');
  bad(() => e.add(), 409);
  assert.equal(new RegistrationService(e.file).rosterRules(e.scoring.rosterRulesContext('tour')).closed, true);
});
test('final game count latches before undo, while suspension before first pitch does not start a round', t => {
  const e = setup(t); e.save(rules({ kind: 'games', games: 1, count: 'tournament' })); e.deliver();
  e.send({ status: 'in_progress' }); e.send({ status: 'final' });
  assert.ok(JSON.parse(readFileSync(e.file, 'utf8')).rosterRules[0].closedAt);
  e.scoring.submitOfficialUpdate({ gameId: 'one', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: e.state().state.officialVersion, undoLast: true });
  assert.equal(e.api.getRoster('mgr-away', 'tour', 'away').admission.closed, true);
  const pending = setup(t); pending.save(rules({ kind: 'round', round: 1, moment: 'start', rounds: { one: 1, two: 1 } }));
  pending.scoring.suspendGame({ gameId: 'one', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer', expectedOfficialVersion: pending.state().state.officialVersion,
    cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia intensa' });
  assert.equal(pending.api.getRosterRules('tour', 'org').closed, false);
});
test('persistent closure failure rejects scoring before any state, lineup or event mutation', t => {
  const e = setup(t); e.save(rules({ kind: 'round', round: 1, moment: 'start', rounds: { one: 1, two: 1 } })); e.deliver();
  const before = e.state();
  t.mock.method(e.registry, 'write', () => { throw new Error('Fallo explícito de disco'); });
  assert.throws(() => e.send({ status: 'in_progress' }), /Fallo explícito de disco/);
  assert.deepEqual(e.state(), before);
});
test('a resolved protest counts as finalized and persists global closure before the decision commits', t => {
  const e = setup(t); e.save(rules({ kind: 'games', games: 1, count: 'tournament' })); e.deliver();
  e.send({ status: 'in_progress' });
  e.scoring.declareGameProtest({ gameId: 'one', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    expectedOfficialVersion: e.state().state.officialVersion, teamId: 'home', reason: 'Revisión ficticia' });
  assert.equal(e.api.getRosterRules('tour', 'org').closed, false);
  e.scoring.resolveGameProtest({ gameId: 'one', tournamentId: 'tour', organizerId: 'org', expectedOfficialVersion: e.state().state.officialVersion,
    winnerTeamId: 'home', reason: 'Resolución ficticia', recordReference: 'ACTA-PRUEBA' });
  assert.ok(JSON.parse(readFileSync(e.file, 'utf8')).rosterRules[0].closedAt);
});
test('changing an expired unread policy never reopens implicitly; explicit reopening requires a new unreached threshold', t => {
  const e = setup(t); t.mock.method(e.registry, 'now', () => '2026-11-05T12:00:00Z');
  e.save(rules({ kind: 'date', date: '2026-11-05' }));
  t.mock.method(e.registry, 'now', () => '2026-11-06T04:00:00Z');
  assert.equal(e.save(rules(), 1, false).closed, true);
  assert.equal(e.save(rules(), 2, true).closed, false);
  assert.equal(e.save(rules({ kind: 'date', date: '2000-01-01' }), 3, true).closed, true);
});
test('administrative replacement cannot bypass closure or caps and explicitly removed direct players do not resurrect', t => {
  const e = setup(t); e.save(); const member = e.add().members.at(-1);
  const command = { tournamentId: 'tour', organizerId: 'org', teamId: 'home', managerId: 'mgr-home',
    playerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `home${i}`) };
  e.scoring.configureTournamentTeamRoster(command);
  assert.equal(e.api.getRoster('mgr-home', 'tour', 'home').members.some(row => row.person.id === member.person.id), false);
  e.save(rules({ kind: 'date', date: '2000-01-01' }), 1);
  bad(() => e.scoring.configureTournamentTeamRoster({ ...command, playerIdentificationNumbers: [...command.playerIdentificationNumbers, member.person.identification] }), 409);
  assert.equal(e.scoring.getTournamentTeamRoster('tour', 'home').rosterPlayers.length, 9);
});
test('optional creation rules are persisted before authorization and malformed rules never create a tournament', t => {
  const e = setup(t);
  bad(() => e.scoring.configureTournamentAuthorization({ tournamentId: 'bad', organizerId: 'org', scorekeeperIds: [], rosterRules: {} }), 400);
  bad(() => e.scoring.getTournamentAuthorization('bad'), 404);
  e.scoring.configureTournamentAuthorization({ tournamentId: 'new', organizerId: 'org', scorekeeperIds: [], rosterRules: rules() });
  assert.deepEqual(e.api.getRosterRules('new', 'org').rules, rules());
  assert.equal(e.api.rosterRuleTournaments('org').tournaments.length, 2);
});
test('HTTP rules client owns its tournaments and handles real revision conflicts', async t => {
  const e = setup(t); class TestModule {}
  const account = await require('./sporting-account-fixture.cjs')(t);
  const app = await NestFactory.create({ module: TestModule, controllers: [RegistrationController], providers: [
    account.provider, { provide: RegistrationService, useValue: e.registry }, { provide: OfficialScoringService, useValue: e.scoring }] }, { logger: false });
  account.manage(app);
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  const client = new RosterRulesClient(`${await app.getUrl()}/api`, 'org');
  assert.equal((await client.tournaments())[0].tournamentId, 'tour');
  assert.equal((await client.load('tour')).rules, null);
  assert.equal((await client.save('tour', rules(), 0, false)).revision, 1);
  await assert.rejects(client.save('tour', rules(), 0, false), /reglamento cambió/);
  await assert.rejects(new RosterRulesClient(`${await app.getUrl()}/api`, 'stranger').load('tour'), /propietario/);
});
