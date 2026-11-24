const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { SportsSheetController } = require('../src/modules/live-scoring/sports-sheet.controller');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { newSportsSheet, newSportsRoleCard, readPublicSportsSheet, readSportsSheetSnapshot } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-sports-sheet-'));
  const path = join(dir, 'accounts.sqlite');
  let service = new AccountsService({ path });
  let application;
  t.after(async () => { if (application) await application.close(); else service.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); });
  const owner = await service.register({ email: 'sheet-owner@example.test', displayName: 'Cuenta de prueba',
    password: 'Una frase ficticia para pruebas 123' }, 'owner');
  const other = await service.register({ email: 'sheet-other@example.test', displayName: 'Otra cuenta',
    password: 'Otra frase ficticia para pruebas 123' }, 'other');
  const command = (document, expectedRevision = 0) => ({ expectedAccountId: owner.account.id, expectedRevision, document });
  return { owner, other, command, service: () => service, reopen() {
    service.onModuleDestroy(); service = new AccountsService({ path }); return service;
  }, application(app) { application = app; } };
}
const sheet = () => ({ ...newSportsSheet(), sportingName: 'Nombre deportivo', city: 'Ciudad deportiva',
  sports: ['Béisbol'], cards: [{ ...newSportsRoleCard('player'), positions: 'Campocorto', number: '12', available: true },
    { ...newSportsRoleCard('manager'), specialty: 'Dirección de equipos' }] });
test('one private sports sheet per account persists across restart and roles without altering personal identity', async t => {
  const e = await setup(t), service = e.service();
  assert.deepEqual(service.sportsSheet(e.owner.token).document, newSportsSheet());
  bad(() => service.sportsSheet(), 401);
  const saved = service.changeSportsSheet(e.owner.token, e.command(sheet()));
  assert.equal(saved.revision, 1);
  assert.match(saved.publicRef, /^[a-zA-Z0-9_-]{24}$/);
  assert.deepEqual(readSportsSheetSnapshot({ ...saved, teams: [] }, e.owner.account.id).document, sheet());
  assert.deepEqual(service.sportsSheet(e.other.token).document, newSportsSheet());
  assert.equal(service.authenticate(e.owner.token).identity, undefined);
  bad(() => service.publishedSportsSheet(saved.publicRef, () => []), 404);
  assert.deepEqual(e.reopen().sportsSheet(e.owner.token), saved);
});
test('writes reject account switching, stale revisions, forged permissions, manual awards and memberships', async t => {
  const e = await setup(t), s = e.service();
  bad(() => s.changeSportsSheet(e.other.token, e.command(sheet())), 409);
  bad(() => s.changeSportsSheet(e.owner.token, { ...e.command(sheet()), role: 'organizer' }), 400);
  for (const patch of [{ achievements: ['MVP'] }, { teams: [] }, { accountId: e.other.account.id }, { statistics: { hits: 50 } }])
    bad(() => s.changeSportsSheet(e.owner.token, e.command({ ...sheet(), ...patch })), 400);
  for (const revision of [-1, 0.1, '0', Number.MAX_SAFE_INTEGER])
    bad(() => s.changeSportsSheet(e.owner.token, e.command(sheet(), revision)), 400);
  const saved = s.changeSportsSheet(e.owner.token, e.command(sheet()));
  assert.deepEqual(s.changeSportsSheet(e.owner.token, e.command(sheet())), saved, 'uncertain identical retry is idempotent');
  bad(() => s.changeSportsSheet(e.owner.token, e.command({ ...sheet(), sportingName: 'Old tab' })), 409);
  assert.equal(s.sportsSheet(e.owner.token).document.sportingName, 'Nombre deportivo');
});
test('publication is explicit, projects only opted-in fields, filters private assignments and can be revoked immediately', async t => {
  const e = await setup(t), s = e.service(), doc = sheet();
  doc.privacy.published = true;
  const saved = s.changeSportsSheet(e.owner.token, e.command(doc));
  const publicView = s.publishedSportsSheet(saved.publicRef, () => { throw new Error('Hidden teams must not be resolved'); });
  assert.equal(publicView.name, 'Nombre deportivo');
  assert.equal(publicView.city, '');
  assert.equal(publicView.photo, '');
  assert.equal('available' in publicView.cards[0], false);
  assert.equal(JSON.stringify(publicView).includes(e.owner.account.id), false);
  assert.equal(JSON.stringify(publicView).includes(e.owner.account.email), false);
  assert.equal(JSON.stringify(publicView).includes('identification'), false);
  assert.deepEqual(readPublicSportsSheet(publicView), publicView);
  const sharing = { ...doc, privacy: { published: true, city: true, photo: true, teams: true, availability: true } };
  assert.equal(s.changeSportsSheet(e.owner.token, e.command(sharing, 1)).publicRef, saved.publicRef);
  const team = { role: 'player', tournamentId: 'published', tournamentName: 'Copa',
    teamId: 'a', teamName: 'Equipo', leagueName: 'Liga', published: true };
  const full = s.publishedSportsSheet(saved.publicRef, () => [team, { ...team, published: false, teamName: 'Equipo privado' }]);
  assert.equal(full.city, doc.city);
  assert.equal(full.cards[0].available, true);
  assert.equal(full.teams.length, 1);
  assert.deepEqual(Object.keys(full.teams[0]).sort(), ['leagueName', 'role', 'teamName', 'tournamentName']);
  s.changeSportsSheet(e.owner.token, e.command({ ...sharing, privacy: { ...sharing.privacy, published: false } }, 2));
  bad(() => s.publishedSportsSheet(saved.publicRef, () => []), 404);
  bad(() => s.publishedSportsSheet(e.owner.account.id, () => []), 404);
});
test('controller derives both team roles from verified identity and never the selected role or team', () => {
  const account = { id: 'owner', identity: { status: 'verified', identification: 'V99000001', actorId: 'person:owner' } };
  const team = { tournamentId: 'cup', tournamentName: 'Copa', teamId: 'a', teamName: 'Equipo', leagueName: 'Liga' };
  const controller = new SportsSheetController({
    authenticate: () => account, sportsSheet: () => ({ accountId: account.id, revision: 0, publicRef: null, document: newSportsSheet() }),
  }, {
    publicSportsTournaments: () => ({ tournaments: [{ id: 'cup', teams: [{ id: 'a' }] }] }),
    listPlayerTeams: id => { assert.equal(id, 'V99000001'); return [team]; },
    listManagerSportsTeams: (actor, id) => { assert.equal(actor, 'person:owner'); assert.equal(id, 'owner'); return [{ ...team, teamId: 'private' }]; },
  });
  const snapshot = controller.own({ headers: {} }, {});
  assert.deepEqual(snapshot.teams.map(team => [team.role, team.published]), [['player', true], ['manager', false]]);
  bad(() => controller.own({ headers: {} }, { teamId: 'other' }), 400);
  delete account.identity.actorId;
  bad(() => controller.own({ headers: {} }, {}), 409);
});
test('HTTP protects private sheets, origin and query scope while published projection works anonymously', async t => {
  const e = await setup(t);
  class TestModule {}
  Module({ controllers: [SportsSheetController], providers: [
    { provide: AccountsService, useValue: e.service() },
    { provide: FriendlyGamesService, useValue: {} },
    { provide: OfficialScoringService, useValue: {} },
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  e.application(app); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/sports-sheet`;
  const headers = { Cookie: `playsport-account=${e.owner.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const doc = sheet(); doc.privacy.published = true;
  assert.equal((await fetch(`${base}/me`)).status, 401);
  assert.equal((await fetch(`${base}/me?accountId=other`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/me`, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: JSON.stringify(e.command(doc)) })).status, 403);
  const response = await fetch(`${base}/me`, { method: 'POST', headers, body: JSON.stringify(e.command(doc)) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const saved = await response.json();
  const publicResponse = await fetch(`${base}/public/${saved.publicRef}`);
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await publicResponse.json()).name, doc.sportingName);
  assert.equal((await fetch(`${base}/public/${saved.publicRef}?identity=x`)).status, 400);
  assert.equal((await fetch(`${base}/public/${'a'.repeat(24)}`)).status, 404);
  const other = await fetch(`${base}/me`, { headers: { Cookie: `playsport-account=${e.other.token}` } }).then(row => row.json());
  assert.equal(other.revision, 0);
});
