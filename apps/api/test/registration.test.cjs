const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { NestFactory } = require('@nestjs/core');
const {
  demoProfileLocation, registrationAge, validateAdultRegistration, validateMinorRegistration,
  newMinorRegistration, matchingFamilyChildren, RegistrationClient
} = require('@playsport/shared');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { RegistrationController } = require('../src/modules/live-scoring/registration.controller');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');

const adult = (identification = 'V-99910001') => ({
  identification, fullName: 'Responsable Ficticio', birthDate: '1990-01-01',
  email: 'responsable@example.test', location: demoProfileLocation
});
const minor = (fullName = 'Menor Ficticio') => ({
  ...newMinorRegistration(demoProfileLocation), fullName, birthDate: '2015-03-20', consent: true
});
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-registration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'registry.json');
  const registry = new RegistrationService(file);
  const key = registry.createAccess().key;
  registry.saveAdult(key, adult());
  return { registry, key, file };
}
test('required registration data, real dates, adult/minor age boundaries and consent are enforced', () => {
  const today = new Date('2026-11-05T12:00:00Z');
  assert.equal(registrationAge('2008-11-05', today), 18);
  assert.equal(registrationAge('2008-11-06', today), 17);
  for (const birthDate of ['2025-02-29', '2026-11-06', '', '2010-13-01', '2010-04-31', '1899-12-31']) {
    assert.throws(() => registrationAge(birthDate, today));
  }
  assert.equal(validateAdultRegistration({ ...adult(), email: ' Demo@Example.Test ' }, today).email, 'demo@example.test');
  for (const patch of [{ fullName: 'Solo' }, { identification: '' }, { birthDate: '2008-11-06' }, { email: '' }, { location: {} }]) {
    assert.throws(() => validateAdultRegistration({ ...adult(), ...patch }, today));
  }
  for (const patch of [{ consent: false }, { consent: 'true' }, { relationship: 'unknown' }, { identification: 'V-99910001-1' }, { birthDate: '2008-11-05' }, { location: {} }]) {
    assert.throws(() => validateMinorRegistration({ ...minor(), ...patch }, today));
  }
});
test('server assigns unique sequential registration codes, never parent legal documents or caller-supplied IDs', t => {
  const { registry, key } = setup(t);
  const first = registry.addMinor(key, { ...minor(), id: 'attacker-chosen', registrationNumber: 'V-99910001-99' }).children[0];
  const family = registry.addMinor(key, minor('Segundo Ficticio'));
  assert.equal(first.identification, '');
  assert.equal(first.registrationNumber, 'V-99910001-1');
  assert.match(first.id, /^PERSON[A-F0-9]{32}$/);
  assert.equal(family.children[1].registrationNumber, 'V-99910001-2');
  assert.notEqual(family.children[1].id, first.id);
  assert.notEqual(first.id, family.adult.id);
});
test('registration survives new service instances and stores only an access hash with restrictive permissions', t => {
  const { registry, key, file } = setup(t);
  const first = registry.addMinor(key, minor());
  const restarted = new RegistrationService(file);
  assert.deepEqual(restarted.getFamily(key), first);
  assert.equal(restarted.addMinor(key, minor('Otro Ficticio')).children[1].registrationNumber, 'V-99910001-2');
  assert.equal(readFileSync(file, 'utf8').includes(key), false);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal('accessHash' in restarted.getFamily(key), false);
});
test('private access, global document uniqueness and duplicate review fail without writes or number consumption', t => {
  const { registry, key, file } = setup(t);
  const other = registry.createAccess().key;
  registry.saveAdult(other, adult('E-99910002'));
  registry.addMinor(key, minor());
  let before = readFileSync(file, 'utf8');
  bad(() => registry.getFamily('org-demo'), 403);
  bad(() => registry.addMinor('a'.repeat(64), minor('Intruso Ficticio')), 403);
  bad(() => registry.addMinor(other, { ...minor('  MÉNOR   ficticio '), identification: 'V-99910003' }), 409);
  bad(() => registry.addMinor(key, { ...minor('Otro Ficticio'), identification: adult().identification }), 409);
  bad(() => registry.saveAdult(other, adult()), 409);
  bad(() => registry.addMinor(key, { ...minor('Otro Ficticio'), identification: 'V-99910003' }, () => true), 409);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(registry.addMinor(key, minor('Otro Ficticio')).children[1].registrationNumber, 'V-99910001-2');
});
test('adding a legal document preserves permanent ID, old searchable alias and never reuses a suffix', t => {
  const { registry, key } = setup(t);
  const first = registry.addMinor(key, minor()).children[0];
  const updated = registry.addDocument(key, first.id, 'v99910003');
  assert.equal(updated.children[0].id, first.id);
  assert.equal(updated.children[0].registrationNumber, 'V-99910003');
  assert.deepEqual(updated.children[0].registrationAliases, ['V-99910001-1']);
  for (const query of ['V-99910001-1', 'V-99910003', 'v99910003', first.id]) {
    assert.equal(registry.resolvePlayer(query).id, first.id);
    assert.equal(matchingFamilyChildren(updated, query)[0].id, first.id);
  }
  assert.deepEqual(matchingFamilyChildren(updated, 'V-99910001'), updated.children);
  assert.equal(matchingFamilyChildren(updated, 'Menor')[0].id, first.id);
  assert.equal(registry.addDocument(key, first.id, 'V-99910003').children[0].registrationAliases.length, 1);
  bad(() => registry.addDocument(key, first.id, 'V-99910004'), 409);
  assert.equal(registry.addMinor(key, minor('Segundo Ficticio')).children[1].registrationNumber, 'V-99910001-2');
});
test('representation transfer requires source and intended destination, is single-use and keeps ID/code', t => {
  const { registry, key } = setup(t);
  const first = registry.addMinor(key, minor()).children[0];
  const target = registry.createAccess().key, stranger = registry.createAccess().key;
  registry.saveAdult(target, adult('E-99910002')); registry.saveAdult(stranger, adult('V-99910004'));
  const invitation = registry.inviteTransfer(key, first.id, 'E-99910002').invitation;
  bad(() => registry.acceptTransfer(stranger, invitation, 'guardian', true), 403);
  bad(() => registry.acceptTransfer(target, invitation, 'guardian', false), 400);
  bad(() => registry.inviteTransfer(stranger, first.id, 'E-99910002'), 404);
  const moved = registry.acceptTransfer(target, invitation, 'mother', true).children[0];
  assert.equal(moved.id, first.id);
  assert.equal(moved.registrationNumber, first.registrationNumber);
  assert.notEqual(moved.representativeId, first.representativeId);
  assert.equal(registry.getFamily(key).children.length, 0);
  bad(() => registry.addDocument(key, first.id, 'V-99910003'), 404);
  bad(() => registry.acceptTransfer(target, invitation, 'mother', true), 403);
  assert.equal(registry.addMinor(key, minor('Segundo Ficticio')).children[0].registrationNumber, 'V-99910001-2');
});
test('busy locks and corrupt registry files are explicit errors that preserve existing data', t => {
  const { registry, key, file } = setup(t);
  const before = readFileSync(file, 'utf8');
  writeFileSync(`${file}.lock`, '');
  bad(() => registry.addMinor(key, minor()), 409);
  assert.equal(readFileSync(file, 'utf8'), before);
  rmSync(`${file}.lock`);
  writeFileSync(file, 'broken JSON');
  assert.throws(() => registry.addMinor(key, minor()));
  assert.equal(readFileSync(file, 'utf8'), 'broken JSON');
  assert.equal(existsSync(`${file}.lock`), false);
});
test('server instances share the same suffix allocator without duplicate siblings', t => {
  const { registry, key, file } = setup(t);
  const other = new RegistrationService(file);
  for (let i = 0; i < 12; i++) (i % 2 ? other : registry).addMinor(key, minor(`Menor Ficticio ${i}`));
  assert.deepEqual(registry.getFamily(key).children.map(child => child.registrationNumber),
    Array.from({ length: 12 }, (_, i) => `V-99910001-${i + 1}`));
});
test('a regressed suffix counter is rejected before any data is overwritten', t => {
  const { registry, key, file } = setup(t);
  registry.addMinor(key, minor());
  const corrupt = JSON.parse(readFileSync(file, 'utf8'));
  corrupt.suffixes[adult().identification] = 1;
  const before = JSON.stringify(corrupt);
  writeFileSync(file, before);
  assert.throws(() => registry.addMinor(key, minor('Segundo Ficticio')), /reutilizar/);
  assert.equal(readFileSync(file, 'utf8'), before);
});
test('document linking rejects previously bound sports identities instead of bypassing historical role restrictions', t => {
  const { registry, key, file } = setup(t);
  const child = registry.addMinor(key, minor()).children[0];
  const scoring = new OfficialScoringService(registry);
  const controller = new RegistrationController(registry, scoring);
  scoring.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'V-99910003', scorekeeperIds: [] });
  const before = readFileSync(file, 'utf8');
  bad(() => controller.addDocument(`Bearer ${key}`, child.id, { identification: 'V-99910003' }), 409);
  assert.equal(readFileSync(file, 'utf8'), before);
  bad(() => scoring.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'V-99910001-99', displayName: 'Registro Inventado' } }), 400);
  bad(() => scoring.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'V-99910004', displayName: 'Menor Externo', isMinor: true } }), 400);
});
test('the registration separator never aliases a different adult legal document', t => {
  const { registry, key } = setup(t);
  const child = registry.addMinor(key, minor()).children[0];
  const scoring = new OfficialScoringService(registry);
  const existing = scoring.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'V-999100011', displayName: 'Adulto Diferente' } });
  assert.equal(existing.player.identificationNumber, 'V999100011');
  assert.equal(registry.resolvePlayer(child.registrationNumber).id, child.id);
  assert.equal(registry.resolvePlayer('V-999100011'), undefined);
  assert.equal(scoring.getGlobalPlayers().totalPlayers, 2);
});
test('official scoring resolves code/document aliases to the same player and preserves lineup, bases, log, stats and role rules', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') });
  const { registry, key, file } = setup(t);
  const child = registry.addMinor(key, minor()).children[0];
  const service = new OfficialScoringService(registry);
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG1000', scorekeeperIds: [], subscriptionTier: 'paid' });
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  for (const teamId of ['home', 'away']) {
    const ids = Array.from({ length: 9 }, (_, i) => teamId === 'away' && i === 0 ? child.registrationNumber : `${teamId}${i}`);
    for (const identificationNumber of ids.filter(id => id !== child.registrationNumber)) service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber, displayName: `Jugador ${identificationNumber}` } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`, managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  for (const teamId of ['home', 'away']) {
    service.configureGameLineup({ gameId: 'game', tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`,
      lineupEntries: positions.map((fieldPosition, i) => ({
        identificationNumber: teamId === 'away' && i === 0 ? child.registrationNumber : `${teamId}${i}`, battingOrder: i + 1, fieldPosition
      })) });
  }
  service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: service.getOfficialState('game', 'tour').state.officialVersion, scorecardCommand: { kind: 'play', result: 'single' } });
  const before = structuredClone(service.getOfficialState('game', 'tour'));
  assert.equal(before.playByPlay.baseRunners.first, child.id);
  assert.equal(before.playByPlay.batterStats.find(row => row.identificationNumber === child.id).hits, 1);
  registry.addDocument(key, child.id, 'V-99910003');
  assert.deepEqual(service.getOfficialState('game', 'tour'), before);
  assert.equal(service.getTournamentTeamRoster('tour', 'away').rosterPlayerIdentificationNumbers[0], child.id);
  bad(() => service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['alias'],
    scorekeeperIdentities: [{ actorId: 'alias', identificationNumber: 'V-99910003' }] }), 409);
  const projection = service.getGlobalPlayers('paid', 'tour').players.find(row => row.identificationNumber === child.id);
  assert.deepEqual(projection, { displayName: child.fullName, identificationNumber: child.id });
  const publicData = JSON.stringify(service.getOfficialState('game', 'tour'));
  for (const privateValue of [child.registrationNumber, 'V-99910003', child.birthDate, adult().email, adult().identification]) assert.equal(publicData.includes(privateValue), false);
  const restarted = new OfficialScoringService(new RegistrationService(file));
  assert.ok(restarted.getGlobalPlayers().players.some(row => row.identificationNumber === child.id));
});
test('HTTP family endpoints enforce private access and support minors without phone/email, document linking and privacy', async t => {
  const { registry, key } = setup(t);
  const scoring = new OfficialScoringService(registry);
  class TestModule {}
  const app = await NestFactory.create({
    module: TestModule, controllers: [RegistrationController],
    providers: [{ provide: RegistrationService, useValue: registry }, { provide: OfficialScoringService, useValue: scoring }]
  }, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = `${await app.getUrl()}/api/registration/`;
  const request = (path, body, access = key) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  assert.equal((await request('family', undefined, 'org-demo')).status, 403);
  const created = await request('children', minor()); assert.equal(created.status, 201);
  const family = await created.json();
  const child = family.children[0];
  assert.equal(child.registrationNumber, 'V-99910001-1');
  assert.equal('phone' in child, false); assert.equal('email' in child, false); assert.equal('accessHash' in family, false);
  assert.equal((await request('children', minor())).status, 409);
  assert.equal((await request(`children/${child.id}/document`, { identification: 'V-99910003' })).status, 201);
  const updated = await (await request('family')).json();
  assert.equal(updated.children[0].id, child.id);
  assert.equal(updated.children[0].registrationAliases[0], child.registrationNumber);
  assert.deepEqual(scoring.getGlobalPlayers().players[0], { displayName: child.fullName, identificationNumber: child.id });
  const values = new Map();
  const storage = {
    getItem: async item => values.get(item) ?? null,
    setItem: async (item, value) => { values.set(item, value); }
  };
  const client = new RegistrationClient(`${await app.getUrl()}/api`, 'fan-demo', storage);
  const [first, second] = await Promise.all([client.load(), client.load()]);
  assert.equal(first.id, second.id, 'concurrent loads use one access');
  await client.saveAdult(adult('E-99910009'));
  const draft = { ...minor('Borrador Ficticio'), fullName: 'Sin completar', birthDate: '', consent: false };
  await Promise.all(['B', 'Borrador', 'Borrador Ficticio'].map(fullName => client.draft({ ...draft, fullName })));
  const restartedClient = new RegistrationClient(`${await app.getUrl()}/api`, 'fan-demo', storage);
  assert.equal((await restartedClient.readDraft()).fullName, 'Borrador Ficticio');
  assert.equal((await restartedClient.load()).id, first.id);
  assert.equal((await restartedClient.addMinor(minor('Cliente Ficticio'))).children[0].registrationNumber, 'E-99910009-1');
  assert.equal((await client.load()).children.length, 1, 'API is shared, not a local count');
  await assert.rejects(client.addMinor(minor('Cliente Ficticio')), /posible registro/);
  values.set('playsport:demo-registration:access:invalid-demo', 'broken-key');
  const invalid = new RegistrationClient(`${await app.getUrl()}/api`, 'invalid-demo', storage);
  await assert.rejects(invalid.load(), /no se reemplazó/i);
  assert.equal(values.get('playsport:demo-registration:access:invalid-demo'), 'broken-key');
  values.set('playsport:demo-registration:draft:fan-demo', 'broken JSON');
  await assert.rejects(restartedClient.readDraft());
  assert.equal(values.get('playsport:demo-registration:draft:fan-demo'), 'broken JSON');
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => request('children', minor(`Concurrente Ficticio ${i}`))));
  for (const response of concurrent) assert.equal(response.status, 201);
  const siblings = (await (await request('family')).json()).children;
  assert.equal(new Set(siblings.map(item => item.id)).size, 9);
  assert.equal(new Set(siblings.map(item => item.registrationNumber)).size, 9);
  for (let suffix = 2; suffix <= 9; suffix++) assert.ok(siblings.some(item => item.registrationNumber === `V-99910001-${suffix}`));
});
