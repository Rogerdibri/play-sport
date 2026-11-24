const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { FavoritesController } = require('../src/modules/live-scoring/favorites.controller');
const { readFavoritesSnapshot } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-favorites-'));
  const path = join(directory, 'accounts.sqlite');
  let accounts = new AccountsService({ path });
  let application;
  const owner = await accounts.register({ email: 'favorites@example.test', displayName: 'Favoritos de prueba',
    password: 'Una frase ficticia de favoritos 123' }, 'owner');
  const other = await accounts.register({ email: 'other@example.test', displayName: 'Otra cuenta ficticia',
    password: 'Otra frase ficticia de favoritos 123' }, 'other');
  const scoring = new OfficialScoringService();
  for (const id of ['one', 'two']) {
    scoring.configureTournamentAuthorization({ tournamentId: id, organizerId: 'org',
      organizerIdentificationNumber: 'ORG1000', scorekeeperIds: [] });
    if (id === 'one') scoring.registerGlobalPlayer({ actorId: 'org',
      player: { identificationNumber: 'V99000001', displayName: 'Jugador de prueba' } });
    scoring.configureTournamentTeamRoster({ tournamentId: id, organizerId: 'org', teamId: 'team-one',
      managerId: 'manager', managerIdentificationNumber: 'MANAGER1000', playerIdentificationNumbers: ['V99000001'] });
  }
  const plan = { name: 'Copa de prueba', leagueId: 'league-one', leagueName: 'Liga de prueba',
    teams: [{ id: 'team-one', name: 'Equipo de prueba', status: 'accepted', rosterStatus: 'approved' }] };
  let published = true;
  scoring.setTournamentPlanning({ document: () => plan, published: () => published });
  const controller = () => new FavoritesController(accounts, scoring);
  const request = token => ({ headers: { cookie: `playsport-account=${token}`, origin: 'http://localhost:3000' } });
  const change = (patch = {}) => ({ kind: 'team', id: 'team-one', favorite: true, requestId: randomUUID(),
    expectedAccountId: owner.account.id, ...patch });
  t.after(async () => {
    if (application) await application.close();
    else { accounts.onModuleDestroy(); scoring.onModuleDestroy(); }
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    owner, other, scoring, request, controller, change, plan,
    accounts: () => accounts,
    application: value => { application = value; },
    published: value => { published = value; },
    tester: () => writeFileSync(join(directory, 'local-tester.json'), JSON.stringify({ version: 1, accountId: owner.account.id })),
    reopen: () => { accounts.onModuleDestroy(); accounts = new AccountsService({ path }); },
  };
}
test('favorites persist per account without identity verification and never replay a removed favorite', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  const first = e.change();
  e.controller().change(req, {}, first);
  const result = e.controller().change(req, {}, first);
  assert.deepEqual(result.items, [{ kind: 'team', id: 'team-one' }]);
  assert.deepEqual(e.controller().list(e.request(e.other.token), {}).items, []);
  bad(() => e.controller().change(req, {}, { ...first, favorite: false }), 409);
  e.controller().change(req, {}, e.change({ favorite: false }));
  assert.deepEqual(e.controller().change(req, {}, first).items, []);
  e.controller().change(req, {}, e.change({ kind: 'league', id: 'league-one' }));
  e.reopen();
  const restored = e.controller().list(req, {});
  assert.deepEqual(restored.items, [{ kind: 'league', id: 'league-one' }]);
  assert.doesNotThrow(() => readFavoritesSnapshot(restored, e.owner.account.id));
});
test('player favorites use stable opaque references, merge memberships, and reveal no private or paid fields', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  const catalog = e.controller().list(req, {}).catalog;
  const players = catalog.filter(row => row.kind === 'player');
  assert.equal(players.length, 1);
  assert.match(players[0].id, /^player:[a-f0-9]{64}$/);
  assert.equal(players[0].memberships.length, 2);
  assert.doesNotMatch(JSON.stringify(catalog), /V99000001|identification|birthDate|email|extraProfile|average/);
  const id = players[0].id;
  e.controller().change(req, {}, e.change({ kind: 'player', id }));
  e.reopen();
  assert.equal(e.controller().list(req, {}).catalog.find(row => row.kind === 'player').id, id);
});
test('unpublished and unapproved players cannot be newly followed; unavailable favorites can still be removed', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  const player = e.controller().list(req, {}).catalog.find(row => row.kind === 'player');
  e.controller().change(req, {}, e.change({ kind: 'player', id: player.id }));
  e.plan.teams[0].rosterStatus = 'pending';
  assert.equal(e.controller().list(req, {}).catalog.some(row => row.kind === 'player'), false);
  bad(() => e.controller().change(req, {}, e.change({ kind: 'player', id: player.id })), 400);
  e.published(false);
  assert.deepEqual(e.controller().list(req, {}).catalog, []);
  e.controller().change(req, {}, e.change({ kind: 'player', id: player.id, favorite: false }));
  assert.deepEqual(e.controller().list(req, {}).items, []);
});
test('account ownership, origin, catalog and exact request shape remain mandatory', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  bad(() => e.controller().list({ headers: {} }, {}), 401);
  bad(() => e.controller().list(req, { accountId: e.other.account.id }), 400);
  bad(() => e.controller().change({ headers: { ...req.headers, origin: 'https://other.invalid' } }, {}, e.change()), 403);
  bad(() => e.controller().change(req, {}, e.change({ expectedAccountId: e.other.account.id })), 409);
  bad(() => e.controller().change(req, {}, e.change({ id: 'unknown-team' })), 400);
  bad(() => e.controller().change(req, {}, e.change({ kind: 'player', id: 'V99000001' })), 400);
  bad(() => e.controller().change(req, {}, e.change({ role: 'organizer' })), 400);
  assert.deepEqual(e.controller().list(req, {}).items, []);
});
test('reusable sports examples are restricted to the configured local tester', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  assert.equal(e.controller().list(req, {}).catalog.some(row => row.id.startsWith('example-')), false);
  e.tester();
  const examples = e.controller().list(req, {}).catalog.filter(row => row.example);
  assert.ok(examples.some(row => row.kind === 'team'));
  assert.ok(examples.some(row => row.kind === 'league'));
  const homonyms = examples.filter(row => row.kind === 'player' && row.name === 'Álex Pelotero');
  assert.equal(homonyms.length, 2);
  assert.notEqual(homonyms[0].id, homonyms[1].id);
  assert.notDeepEqual(homonyms[0].memberships, homonyms[1].memberships);
  assert.equal(e.controller().list(e.request(e.other.token), {}).catalog.some(row => row.example), false);
  assert.equal(e.controller().list(e.request(e.other.token), {}).catalog.some(row => row.id.startsWith('example-')), false);
});
test('rate limiting does not prevent idempotent retries or change another account', async t => {
  const e = await setup(t), req = e.request(e.owner.token);
  const first = e.change();
  e.controller().change(req, {}, first);
  for (let index = 1; index < 60; index++) e.controller().change(req, {}, e.change({ favorite: index % 2 === 0 }));
  bad(() => e.controller().change(req, {}, e.change()), 429);
  assert.deepEqual(e.controller().change(req, {}, first).items, []);
  assert.deepEqual(e.controller().list(e.request(e.other.token), {}).items, []);
});
test('HTTP favorites keep cookies private, no-store responses and origin checks', async t => {
  const e = await setup(t);
  class TestModule {}
  Module({ controllers: [FavoritesController], providers: [
    { provide: AccountsService, useValue: e.accounts() }, { provide: OfficialScoringService, useValue: e.scoring },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  e.application(app);
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/favorites`;
  const headers = { Cookie: `playsport-account=${e.owner.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(e.change()) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal((await response.json()).items.length, 1);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(`${url}?accountId=other`, { headers })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: JSON.stringify(e.change()) })).status, 403);
  assert.equal((await fetch(url, { headers: { Cookie: `playsport-account=${e.other.token}` } }).then(row => row.json())).items.length, 0);
});
