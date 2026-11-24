const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { NestFactory } = require('@nestjs/core');
const { validateAdultRegistration, validatePreRegistration, demoProfileLocation, rosterRoleLabels, RosterClient, RegistrationClient } = require('@playsport/shared');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { RegistrationController } = require('../src/modules/live-scoring/registration.controller');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const person = (patch = {}) => ({ identification: 'V-94000001', fullName: 'Persona Ficticia', birthDate: '1990-04-15',
  email: '', phone: '+58 412 1234567', representativeIdentification: '', ...patch });
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-roster-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'registry.json'), registry = new RegistrationService(file);
  const scoring = new OfficialScoringService(registry), api = new RegistrationController(registry, scoring);
  scoring.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000', scorekeeperIds: [] });
  for (const teamId of ['home','away']) {
    scoring.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: `PLAYER${teamId}`, displayName: `Jugador ${teamId}` } });
    scoring.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: [`PLAYER${teamId}`] });
  }
  const context = { tournamentId: 'tour', teamId: 'home', managerId: 'mgr-home' };
  const preinscribe = (profile = person(), role = 'PLAYER') => api.preinscribe({ ...context, role, person: profile });
  return { file, registry, scoring, api, context, preinscribe };
}
test('email or phone is sufficient; both empty or any malformed provided contact is rejected', () => {
  for (const contact of [{ email: '', phone: '04121234567' }, { email: 'ficticio@example.test', phone: '' }, { email: 'ficticio@example.test', phone: '+58 412 1234567' }]) {
    assert.ok(validateAdultRegistration({ ...person(), ...contact, location: demoProfileLocation }));
    assert.ok(validatePreRegistration(person(contact)));
  }
  for (const contact of [{ email: '', phone: '' }, { email: 'incorrecto', phone: '04121234567' }, { email: 'ficticio@example.test', phone: 'abc1234567' }]) {
    assert.throws(() => validateAdultRegistration({ ...person(), ...contact, location: demoProfileLocation }));
    assert.throws(() => validatePreRegistration(person(contact)));
  }
});
test('manager teams exist independently of games and cannot cross team ownership', t => {
  const e = setup(t);
  assert.equal(e.api.rosterTeams('mgr-home').teams.length, 1);
  assert.equal(e.api.rosterTeams('mgr-home').teams[0].teamId, 'home');
  assert.deepEqual(e.api.rosterTeams('stranger').teams, []);
  bad(() => e.api.getRoster('mgr-away', 'tour', 'home'), 403);
  bad(() => e.api.lookupRoster('mgr-away', 'tour', 'home', 'PLAYERHOME'), 403);
  bad(() => e.api.preinscribe({ ...e.context, managerId: 'mgr-away', role: 'PLAYER', person: person() }), 403);
});
test('direct preinscriptions survive restart, are reusable and immediately join the tournament roster', t => {
  const e = setup(t), before = e.scoring.getTournamentTeamRoster('tour', 'home');
  const roster = e.preinscribe(), added = roster.members.find(row => row.addedBy === 'manager');
  assert.equal(added.person.registrationStatus, 'preinscribed');
  assert.match(added.person.id, /^PERSON[A-F0-9]{32}$/);
  const after = e.scoring.getTournamentTeamRoster('tour', 'home');
  assert.equal(after.rosterPlayers.length, before.rosterPlayers.length + 1);
  assert.deepEqual(after.rosterPlayers.filter(row => row.identificationNumber !== 'V94000001'), before.rosterPlayers);
  assert.equal(added.approvalStatus, 'approved');
  const restarted = new RegistrationService(e.file), api = new RegistrationController(restarted, e.scoring);
  assert.equal(api.lookupRoster('mgr-away', 'tour', 'away', 'v94000001').person.id, added.person.id);
  assert.equal(api.addRoster({ tournamentId: 'tour', teamId: 'away', managerId: 'mgr-away', role: 'DELEGADO', personId: added.person.id })
    .members.at(-1).person.id, added.person.id);
  const raw = JSON.parse(readFileSync(e.file, 'utf8'));
  assert.equal(raw.preinscriptions.length, 1);
  assert.equal(raw.preinscriptions[0].phone, '+58 412 1234567');
  assert.equal(raw.preinscriptions[0].birthDate, person().birthDate);
  bad(() => e.preinscribe(), 409);
  bad(() => e.api.addRoster({ ...e.context, role: 'COACH_FIRST', personId: added.person.id }), 409);
  assert.equal(JSON.parse(readFileSync(e.file, 'utf8')).preinscriptions.length, 1);
});
test('adult confirmation keeps the already incorporated ecosystem ID and roster link', t => {
  const e = setup(t), id = e.preinscribe().members.at(-1).person.id;
  const key = e.registry.createAccess().key;
  const family = e.registry.saveAdult(key, { ...person(), location: demoProfileLocation });
  assert.equal(family.id, id); assert.equal(family.adult.id, id);
  const row = e.api.getRoster('mgr-home', 'tour', 'home').members.at(-1);
  assert.equal(row.person.id, id); assert.equal(row.person.registrationStatus, 'registered'); assert.equal(row.approvalStatus, 'approved');
  assert.equal(JSON.parse(readFileSync(e.file, 'utf8')).preinscriptions.length, 0);
  assert.equal(e.registry.getFamily(key).adult.phone, person().phone);
  bad(() => e.registry.saveAdult(e.registry.createAccess().key, { ...person(), location: demoProfileLocation }), 409);
});
test('confirmation mismatch never silently replaces personal data or creates another identity', t => {
  const e = setup(t); e.preinscribe();
  const key = e.registry.createAccess().key, before = readFileSync(e.file, 'utf8');
  for (const patch of [{ fullName: 'Otra Persona' }, { birthDate: '1991-04-15' }]) {
    bad(() => e.registry.saveAdult(key, { ...person(), ...patch, location: demoProfileLocation }), 409);
    assert.equal(readFileSync(e.file, 'utf8'), before);
  }
});
test('minor without cedula uses one permanent ID and representative confirmation, with no private data in roster responses', t => {
  const e = setup(t), representative = 'E-94000002';
  const child = person({ identification: '', fullName: 'Menor Ficticio', birthDate: '2015-03-20', representativeIdentification: representative });
  const roster = e.preinscribe(child), id = roster.members.at(-1).person.id;
  assert.equal(roster.members.at(-1).person.identification, '');
  const publicData = JSON.stringify(roster);
  for (const secret of [child.birthDate, child.phone, representative]) assert.equal(publicData.includes(secret), false);
  bad(() => e.preinscribe(child), 409);
  const key = e.registry.createAccess().key;
  e.registry.saveAdult(key, { ...person({ identification: representative, fullName: 'Representante Ficticio' }), location: demoProfileLocation });
  const family = e.registry.addMinor(key, { identification: '', fullName: child.fullName, birthDate: child.birthDate,
    location: demoProfileLocation, relationship: 'guardian', consent: true });
  assert.equal(family.children[0].id, id);
  assert.equal(e.api.getRoster('mgr-home', 'tour', 'home').members.at(-1).person.registrationStatus, 'registered');
  assert.equal(e.registry.resolvePlayer(id).id, id);
});
test('minor with cedula cannot be claimed by an unrelated representative', t => {
  const e = setup(t);
  const child = person({ fullName: 'Menor Ficticio', birthDate: '2015-03-20', representativeIdentification: 'E-94000002' });
  e.preinscribe(child);
  const key = e.registry.createAccess().key;
  e.registry.saveAdult(key, { ...person({ identification: 'V-94000003', fullName: 'Otro Representante' }), location: demoProfileLocation });
  bad(() => e.registry.addMinor(key, { identification: child.identification, fullName: child.fullName, birthDate: child.birthDate,
    location: demoProfileLocation, relationship: 'father', consent: true }), 409);
});
test('roster supports every configured cargo without granting an official account or altering an approved player', t => {
  const e = setup(t);
  for (const [index, role] of Object.keys(rosterRoleLabels).entries()) {
    const roster = e.preinscribe(person({ identification: `V-${94000100 + index}`, fullName: `Persona Ficticia ${index}` }), role);
    assert.equal(roster.members.at(-1).role, role);
    assert.equal(roster.members.at(-1).approvalStatus, 'approved');
  }
  bad(() => e.api.addRoster({ ...e.context, role: 'MANAGER', personId: 'PLAYERHOME' }), 409);
  bad(() => e.preinscribe(person({ identification: 'V-94000999' }), 'organizer'), 400);
  assert.equal(e.scoring.listOfficialGames('mgr-home', 'organizer').games.length, 0);
});
test('invalid inputs and corrupt persistent additions are explicit failures, not lost data', t => {
  const e = setup(t); e.preinscribe(); const before = readFileSync(e.file, 'utf8');
  for (const patch of [{ fullName: 'Solo' }, { identification: '' }, { birthDate: '2099-01-01' }, { birthDate: '2025-02-29' }, { email: '', phone: '' }]) {
    bad(() => e.preinscribe(person({ identification: 'V-94000999', ...patch })), 400);
    assert.equal(readFileSync(e.file, 'utf8'), before);
  }
  const data = JSON.parse(before); data.preinscriptions.push({ ...data.preinscriptions[0] });
  writeFileSync(e.file, JSON.stringify(data)); assert.throws(() => new RegistrationService(e.file).rosterPerson('V-94000001'));
});
test('private invitations recover existing data without exposing it through lookup and become unusable after confirmation', t => {
  const e = setup(t), row = e.preinscribe().members.at(-1), key = e.registry.createAccess().key;
  assert.equal(row.canInvite, true);
  const invitation = e.api.invitePreRegistration({ ...e.context, personId: row.person.id }).invitation;
  const raw = readFileSync(e.file, 'utf8');
  assert.equal(raw.includes(invitation), false);
  bad(() => e.registry.recoverPreRegistration(key, 'a'.repeat(64)), 403);
  bad(() => e.api.invitePreRegistration({ tournamentId: 'tour', teamId: 'away', managerId: 'mgr-away', personId: row.person.id }), 403);
  assert.equal(e.registry.recoverPreRegistration(key, invitation).phone, person().phone);
  const summary = JSON.stringify(e.api.lookupRoster('mgr-home','tour','home',person().identification));
  assert.equal(summary.includes(person().birthDate), false); assert.equal(summary.includes(person().phone), false);
  e.registry.saveAdult(key, { ...person(), location: demoProfileLocation });
  bad(() => e.registry.recoverPreRegistration(key, invitation), 403);
});
test('minor invitations require the specified representative and expire explicitly', t => {
  const e = setup(t), child = person({ identification: '', fullName: 'Menor Ficticio', birthDate: '2015-03-20', representativeIdentification: 'E-94000002' });
  const id = e.preinscribe(child).members.at(-1).person.id;
  const invitation = e.api.invitePreRegistration({ ...e.context, personId: id }).invitation;
  const key = e.registry.createAccess().key;
  bad(() => e.registry.recoverPreRegistration(key, invitation), 403);
  e.registry.saveAdult(key, { ...person({ identification: 'E-94000002', fullName: 'Representante Ficticio' }), location: demoProfileLocation });
  assert.equal(e.registry.recoverPreRegistration(key, invitation).fullName, child.fullName);
  const data = JSON.parse(readFileSync(e.file,'utf8'));
  data.preinscriptions[0].invitationExpiresAt = '2000-01-01T00:00:00Z'; writeFileSync(e.file,JSON.stringify(data));
  bad(() => e.registry.recoverPreRegistration(key, invitation), 403);
});
test('a preinscribed minor reaching adulthood keeps the permanent identity when providing their document', t => {
  const e = setup(t), child = person({ identification: '', fullName: 'Mayor Ficticio', birthDate: '2010-01-01', representativeIdentification: 'E-94000002' });
  const id = e.preinscribe(child).members.at(-1).person.id;
  const data = JSON.parse(readFileSync(e.file,'utf8'));
  data.preinscriptions[0].birthDate = '2000-01-01'; data.preinscriptions[0].createdAt = '2016-01-01T00:00:00Z';
  writeFileSync(e.file,JSON.stringify(data));
  assert.equal(e.registry.rosterPerson(id).isMinor, false);
  const key = e.registry.createAccess().key;
  const family = e.registry.saveAdult(key, { ...person({ fullName: child.fullName, birthDate: '2000-01-01' }), location: demoProfileLocation });
  assert.equal(family.id, id);
  assert.deepEqual(e.scoring.getTournamentTeamRoster('tour','home').rosterPlayerIds,['PLAYERHOME',id]);
});
test('HTTP roster clients preserve scope, persistence, minimal projections and invitation-based profile recovery', async t => {
  const e = setup(t);
  const account = await require('./sporting-account-fixture.cjs')(t);
  class TestModule {}
  const app = await NestFactory.create({ module: TestModule, controllers: [RegistrationController],
    providers: [account.provider, { provide: RegistrationService, useValue: e.registry }, { provide: OfficialScoringService, useValue: e.scoring }] }, { logger: false });
  account.manage(app);
  app.setGlobalPrefix('api'); await app.listen(0,'127.0.0.1');
  const base = `${await app.getUrl()}/api`, client = new RosterClient(base,'mgr-home');
  const team = (await client.teams())[0];
  assert.equal((await client.load(team)).members[0].approvalStatus, 'approved');
  assert.equal(await client.lookup(team, person().identification), null);
  const pending = (await client.preinscribe(team,'COACH_FIRST',person())).members.at(-1);
  assert.equal((await client.lookup(team,person().identification)).id, pending.person.id);
  await assert.rejects(client.add({ ...team, teamId:'away' },'PLAYER',pending.person.id), /Solo el manager/);
  const invitation = await client.invite(team,pending.person.id), values = new Map();
  const profile = new RegistrationClient(base,'test-account',{ getItem: async key => values.get(key) ?? null, setItem: async (key,value) => { values.set(key,value); } });
  const recovered = await profile.recoverPreRegistration(invitation);
  assert.equal(recovered.fullName,person().fullName); assert.equal(recovered.phone,person().phone); assert.equal(recovered.isMinor,false);
  assert.equal((await profile.saveAdult({ ...recovered,location:demoProfileLocation })).adult.id,pending.person.id);
  assert.equal((await client.load(team)).members.at(-1).person.registrationStatus,'registered');
  await assert.rejects(profile.recoverPreRegistration(invitation),/ya se confirmó/);
});
