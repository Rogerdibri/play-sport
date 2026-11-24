const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { AccountsController } = require('../src/modules/accounts/accounts.controller');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { SportingAccountGuard } = require('../src/modules/live-scoring/sporting-account.guard');
const { InstitutionalLogosService } = require('../src/modules/institutional-logos/institutional-logos.service');
const { addMembershipMonths, readOwnAccountAccess, roleValidityAllowsOperation } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function fixture(t) {
  let now = Date.parse('2026-01-31T12:34:56.000Z'), app, logos;
  t.mock.method(Date, 'now', () => now);
  const directory = mkdtempSync(join(tmpdir(), 'playsport-role-validity-')), accountPath = join(directory, 'accounts.sqlite');
  let accounts = new AccountsService({ path: accountPath, now: () => now });
  const scoring = new OfficialScoringService(undefined, { path: join(directory, 'official.sqlite') });
  t.mock.method(scoring, 'nowIso', () => new Date(now).toISOString());
  const password = 'Contraseña de prueba de membresías 123456';
  const admin = await accounts.register({ email: 'admin@example.test', displayName: 'Administrador del Lago', password }, 'admin');
  const previousAdmin = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID, previousReviewer = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = admin.account.id; process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = admin.account.id;
  t.after(async () => {
    logos?.onModuleDestroy();
    if (app) await app.close(); else { accounts.onModuleDestroy(); scoring.onModuleDestroy(); }
    rmSync(directory, { recursive: true, force: true });
    if (previousAdmin === undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = previousAdmin;
    if (previousReviewer === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID; else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = previousReviewer;
  });
  const people = {}, photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
  for (const [index, name] of ['organizer', 'scorekeeper', 'manager', 'substitute', 'unverified'].entries()) {
    const person = await accounts.register({ email: `${name}@example.test`, displayName: `${name} del Lago`, password }, name);
    if (name !== 'unverified') {
      accounts.submitIdentity(person.token, { expectedAccountId: person.account.id, expectedRevision: 0, requestId: randomUUID(),
        identification: `V-${99400001 + index}`, fullName: `${name} del Lago`, birthDate: '1990-01-02', documentPhoto: photo, personalPhoto: photo, consent: true });
      accounts.reviewIdentity(admin.token, { expectedAccountId: admin.account.id, accountId: person.account.id, expectedRevision: 1,
        decision: 'verified', reason: 'Prueba aislada de vigencias', documentsMatch: true });
    }
    people[name] = { ...person, account: accounts.authenticate(person.token) };
  }
  const actor = name => people[name].account.identity.actorId;
  for (const tournamentId of ['cup', 'other']) {
    scoring.configureTournamentAuthorization({ tournamentId, organizerId: actor('organizer'),
      organizerIdentificationNumber: people.organizer.account.identity.identification, scorekeeperIds: [actor('scorekeeper')],
      scorekeeperIdentities: [{ actorId: actor('scorekeeper'), identificationNumber: people.scorekeeper.account.identity.identification }] });
    for (const side of ['home', 'away']) {
      if (tournamentId === 'cup') scoring.registerGlobalPlayer({ actorId: actor('organizer'),
        player: { identificationNumber: `${side.toUpperCase()}0`, displayName: `${side} Jugador del Lago` } });
      scoring.configureTournamentTeamRoster({ tournamentId, organizerId: actor('organizer'), teamId: side,
        managerId: side === 'home' ? actor('manager') : 'away-manager',
        managerIdentificationNumber: side === 'home' ? people.manager.account.identity.identification : 'AWAYMANAGER',
        playerIdentificationNumbers: [`${side.toUpperCase()}0`] });
    }
    for (const gameId of tournamentId === 'cup' ? ['a','b'] : ['c']) {
      scoring.configureGameTeams({ gameId, tournamentId, organizerId: actor('organizer'), homeTeamId: 'home', awayTeamId: 'away' });
      scoring.configureGameAuthorization({ gameId, tournamentId, organizerId: actor('organizer'), scorekeeperIds: [actor('scorekeeper')] });
    }
  }
  const login = async () => {
    for (const name of Object.keys(people)) Object.assign(people[name], await accounts.login({ email: `${name}@example.test`, password }, name));
    Object.assign(admin, await accounts.login({ email: 'admin@example.test', password }, 'admin'));
  };
  return { people, admin, actor, scoring, get accounts() { return accounts; }, get now() { return now; },
    async advance(to) { now = Date.parse(to); await login(); },
    account(name) { return accounts.authenticate(people[name].token); },
    activate(name, role) { return accounts.activateRole(people[name].token, { expectedAccountId: people[name].account.id, role }); },
    own(name) { return readOwnAccountAccess(accounts.ownAccess(people[name].token), people[name].account.id); },
    grant(name, planId, months) { return accounts.changeTrial(admin.token, { requestId: randomUUID(), expectedAdminId: admin.account.id,
      accountId: people[name].account.id, planId, months, action: 'grant', reason: 'Prueba temporal, sin cobro',
      expectedRevision: accounts.ownAccess(people[name].token).trials.find(trial => trial.planId === planId)?.revision ?? 0 }); },
    reopen() { accounts.onModuleDestroy(); accounts = new AccountsService({ path: accountPath, now: () => now }); },
    async http() {
      app = await NestFactory.create({ module: class RoleValidityModule {}, controllers: [AccountsController, OfficialScoringController],
        providers: [{ provide: AccountsService, useValue: accounts }, { provide: OfficialScoringService, useValue: scoring }, SportingAccountGuard] }, { logger: false });
      app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      return async (name, route, status, body) => {
        const response = await fetch(base + '/api/' + route, { headers: { cookie: `playsport-account=${people[name].token}`,
          origin: 'http://localhost:3000', ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
        const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
      };
    },
    update(gameId, patch) { return { tournamentId: 'cup', actorId: actor('scorekeeper'), actorRole: 'scorekeeper',
      expectedOfficialVersion: scoring.getOfficialState(gameId, 'cup').state.officialVersion, patch }; },
    logos() { logos ??= new InstitutionalLogosService(accounts, scoring, { path: join(directory, 'logos.sqlite') }); return logos; }
  };
}
test('calendar durations preserve UTC time and clamp month ends including leap years', () => {
  for (const [start, months, end] of [['2026-01-31',1,'2026-02-28'], ['2024-01-31',1,'2024-02-29'],
    ['2024-02-29',12,'2025-02-28'], ['2026-08-31',6,'2027-02-28'], ['2026-11-30',3,'2027-02-28']])
    assert.equal(addMembershipMonths(`${start}T12:34:56.000Z`, months), `${end}T12:34:56.000Z`);
  for (const months of [0,2,24,'6']) assert.throws(() => addMembershipMonths('2026-01-31T12:34:56.000Z', months));
});
test('basic activation is verified, explicit, independent per role, never restarted and survives account-store restart', async t => {
  const e = await fixture(t);
  assert.deepEqual(e.own('scorekeeper').roles.map(role => role.status), ['permanent','not_activated','not_activated']);
  bad(() => e.accounts.activateRole(undefined, {}), 401);
  bad(() => e.activate('unverified', 'manager'), 403);
  bad(() => e.accounts.activateRole(e.people.scorekeeper.token, { expectedAccountId: e.people.manager.account.id, role: 'manager' }), 409);
  bad(() => e.accounts.activateRole(e.people.scorekeeper.token, { expectedAccountId: e.people.scorekeeper.account.id, role: 'manager', months: 12 }), 400);
  bad(() => e.activate('scorekeeper', 'player'), 400);
  const activated = e.activate('scorekeeper', 'scorekeeper').roles.find(row => row.role === 'scorekeeper');
  assert.equal(activated.freeExpiresAt, '2026-07-31T12:34:56.000Z');
  assert.deepEqual(e.own('scorekeeper').features, []);
  await e.advance('2026-03-01T12:34:56.000Z');
  assert.equal(e.activate('scorekeeper', 'scorekeeper').roles.find(row => row.role === 'scorekeeper').freeExpiresAt, activated.freeExpiresAt);
  assert.equal(e.activate('scorekeeper', 'manager').roles.find(row => row.role === 'manager').freeExpiresAt, '2026-09-01T12:34:56.000Z');
  const before = e.own('scorekeeper'); e.reopen(); assert.deepEqual(e.own('scorekeeper'), before);
  await e.advance(activated.freeExpiresAt);
  const own = e.activate('scorekeeper', 'scorekeeper');
  assert.equal(own.roles.find(row => row.role === 'scorekeeper').status, 'expired');
  assert.equal(own.roles.find(row => row.role === 'manager').status, 'active');
  assert.equal(own.roles.find(row => row.role === 'player').status, 'permanent');
});
test('basic renewals use fixed calendar periods without premium features, auto-charge, identity approval or another role access', async t => {
  const e = await fixture(t);
  const first = e.grant('scorekeeper', 'scorekeeper-basic', 1).trial;
  assert.equal(first.expiresAt, '2026-02-28T12:34:56.000Z');
  const renewed = e.grant('scorekeeper', 'scorekeeper-basic', 3).trial;
  assert.equal(renewed.expiresAt, '2026-05-28T12:34:56.000Z');
  assert.deepEqual(e.own('scorekeeper').features, []);
  assert.equal(e.own('scorekeeper').roles.find(row => row.role === 'manager').status, 'not_activated');
  assert.equal(e.own('scorekeeper').roles.find(row => row.role === 'scorekeeper').status, 'plan');
  for (const months of [2,0,24,'1']) bad(() => e.grant('scorekeeper', 'scorekeeper-basic', months), 400);
  bad(() => e.grant('scorekeeper', 'organizer', 1), 400);
  e.grant('manager', 'manager-basic', 6); e.grant('substitute', 'player-numbers', 12);
  assert.equal(e.own('manager').roles.find(row => row.role === 'manager').expiresAt, '2026-07-31T12:34:56.000Z');
  assert.equal(e.own('substitute').trials[0].expiresAt, '2027-01-31T12:34:56.000Z');
  await e.advance(renewed.expiresAt);
  assert.equal(roleValidityAllowsOperation(e.own('scorekeeper').roles.find(row => row.role === 'scorekeeper')), false);
  assert.equal(e.own('scorekeeper').roles.find(row => row.role === 'player').status, 'permanent');
});
test('expired basic denies new writes, keeps exact ongoing game and permits free substitute after expiry, with HTTP scope and origin enforcement', async t => {
  const e = await fixture(t); e.activate('scorekeeper', 'scorekeeper'); e.activate('manager', 'manager'); e.activate('substitute', 'scorekeeper');
  e.accounts.changeScorekeeperTournaments(e.account('scorekeeper'), e.scoring.scorekeeperTournaments(e.actor('scorekeeper')),
    { expectedAccountId: e.people.scorekeeper.account.id, expectedRevision: 0, selected: ['cup'] });
  const teams = e.scoring.managerPlanTeams(e.actor('manager'), e.people.manager.account.id);
  e.accounts.changeManagerTeams(e.account('manager'), teams, { expectedAccountId: e.people.manager.account.id, expectedRevision: 0,
    selected: [JSON.stringify(['cup','home'])] });
  const request = await e.http();
  await request('scorekeeper', 'official-scoring/games/a/official-updates', 201, e.update('a', { status: 'in_progress', balls: 1 }));
  const startedAt = e.scoring.gameOperationStartedAt('cup','a');
  await e.advance('2026-07-31T12:34:56.000Z');
  await request('scorekeeper', 'official-scoring/games/a/official-updates', 201, e.update('a', { balls: 2 }));
  assert.equal(e.scoring.gameOperationStartedAt('cup','a'), startedAt);
  await request('scorekeeper', 'official-scoring/games/b/official-updates', 403, e.update('b', { status: 'in_progress' }));
  await request('scorekeeper', `official-scoring/games/a/state?tournamentId=cup&role=scorekeeper&userId=${e.actor('scorekeeper')}`, 200);
  e.accounts.assertManagerTeamAccess(e.account('manager'), teams, 'cup','home', startedAt);
  bad(() => e.accounts.assertManagerTeamAccess(e.account('manager'), teams, 'other','home'), 403);
  await request('scorekeeper', 'official-scoring/games/a/official-updates', 201, e.update('a', { status: 'final' }));
  bad(() => e.accounts.assertManagerTeamAccess(e.account('manager'), teams, 'cup','home', e.scoring.gameOperationStartedAt('cup','a')), 403);
  e.scoring.changeScorekeeperSubstitution({ organizerId: e.actor('organizer'), tournamentId: 'cup', gameId: 'b', expectedRevision: 0, action: 'grant',
    substituteActorId: e.actor('substitute'), name: 'Suplente del Lago', identification: e.people.substitute.account.identity.identification, reason: 'Ausencia temporal' });
  const body = { ...e.update('b', { status: 'in_progress', balls: 1 }), actorId: e.actor('substitute') };
  await request('substitute', 'official-scoring/games/b/official-updates', 201, body);
  assert.equal(e.own('substitute').roles.find(row => row.role === 'scorekeeper').status, 'expired');
  assert.deepEqual(e.own('substitute').features, []);
  await request('scorekeeper', 'accounts/activate-role?months=12', 400, { expectedAccountId: e.people.scorekeeper.account.id, role: 'scorekeeper' });
  await request('scorekeeper', 'accounts/activate-role', 400, { expectedAccountId: e.people.scorekeeper.account.id, role: 'scorekeeper', expiresAt: '2099-01-01' });
});
test('premium expiration and quota downgrade cannot interrupt the existing game or open another tournament', async t => {
  const e = await fixture(t); e.grant('scorekeeper', 'scorekeeper', 1); e.grant('manager', 'manager', 1);
  const request = await e.http();
  await request('scorekeeper', 'official-scoring/games/a/official-updates', 201, e.update('a', { status: 'in_progress', balls: 1 }));
  const start = e.scoring.gameOperationStartedAt('cup','a');
  await e.advance('2026-02-28T12:34:56.000Z');
  const catalog = await request('scorekeeper', `official-scoring/games?userId=${e.actor('scorekeeper')}&role=scorekeeper`, 200);
  assert.equal(catalog.games.find(row => row.gameId === 'a').canOperate, true);
  assert.equal(catalog.games.find(row => row.gameId === 'b').canOperate, false);
  await request('scorekeeper', 'official-scoring/games/a/official-updates', 201, e.update('a', { balls: 2 }));
  await request('scorekeeper', `official-scoring/games/a/state?tournamentId=cup&role=scorekeeper&userId=${e.actor('scorekeeper')}`, 200);
  e.accounts.assertManagerTeamAccess(e.account('manager'), e.scoring.managerPlanTeams(e.actor('manager'), e.people.manager.account.id), 'cup','home', start);
  bad(() => e.accounts.assertManagerTeamAccess(e.account('manager'), e.scoring.managerPlanTeams(e.actor('manager'), e.people.manager.account.id), 'other','home'), 403);
  assert.deepEqual(e.own('scorekeeper').features, []);
  assert.equal(e.scoring.getOfficialState('a','cup').state.balls, 2);
});
test('institutional edits require active Manager operation; public names and logos remain readable after expiry', async t => {
  const e = await fixture(t), logos = e.logos();
  bad(() => logos.manageable(e.people.manager.token, 'manager', e.actor('manager')), 403);
  e.activate('manager', 'manager');
  assert.equal(logos.manageable(e.people.manager.token, 'manager', e.actor('manager')).accountId, e.people.manager.account.id);
  const before = logos.list();
  await e.advance('2026-07-31T12:34:56.000Z');
  bad(() => logos.manageable(e.people.manager.token, 'manager', e.actor('manager')), 403);
  assert.throws(() => logos.change(e.people.manager.token, {
    requestId: randomUUID(), expectedAccountId: e.people.manager.account.id, expectedRevision: 0,
    role: 'manager', actorId: e.actor('manager'), kind: 'team', id: 'home', logo: '',
  }), error => error.getStatus?.() === 403 && error.getResponse?.().code === 'ROLE_OPERATION_REQUIRED');
  assert.deepEqual(logos.list(), before);
});
