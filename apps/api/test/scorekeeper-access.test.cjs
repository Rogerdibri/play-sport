const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { ScorekeeperAccessController } = require('../src/modules/live-scoring/scorekeeper-access.controller');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { SportingAccountGuard } = require('../src/modules/live-scoring/sporting-account.guard');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { scorekeeperPlanLevel, scorekeeperTournamentLimit, trialPlans, readScorekeeperAccess,
  readScorekeeperStatistics, exampleStatisticsGames, readScorekeeperExtraQueue } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const features = id => id ? [...trialPlans.find(plan => plan.id === id).features] : [];
const rows = () => Array.from({ length: 5 }, (_, i) => ({ tournamentId: `tour-${i}`, tournamentName: `Copa ${i}`, active: true }));
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-scorekeeper-')), path = join(directory, 'accounts.sqlite');
  const stamp = Date.now(), now = () => stamp;
  let accounts = new AccountsService({ path, now });
  const admin = await accounts.register({ email: 'admin@example.test', displayName: 'Administrador', password: 'Frase de prueba 123456789' }, 'admin');
  const scorer = await accounts.register({ email: 'scorer@example.test', displayName: 'Anotador', password: 'Frase de prueba 123456789' }, 'scorer');
  const beforeAdmin = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID, beforeReviewer = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = admin.account.id;
  process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = admin.account.id;
  t.after(() => {
    accounts.onModuleDestroy(); rmSync(directory, { recursive: true, force: true });
    if (beforeAdmin === undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = beforeAdmin;
    if (beforeReviewer === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID; else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = beforeReviewer;
  });
  const photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
  accounts.submitIdentity(scorer.token, { expectedAccountId: scorer.account.id, requestId: randomUUID(), expectedRevision: 0,
    identification: 'V-99200001', fullName: 'Anotador del Lago', birthDate: '1990-01-02', documentPhoto: photo, personalPhoto: photo, consent: true });
  accounts.reviewIdentity(admin.token, { expectedAccountId: admin.account.id, accountId: scorer.account.id, expectedRevision: 1,
    decision: 'verified', reason: 'Prueba aislada', documentsMatch: true });
  accounts.activateRole(scorer.token, { expectedAccountId: scorer.account.id, role: 'scorekeeper' });
  return { admin, scorer, get accounts() { return accounts; }, account: plan => ({ ...accounts.authenticate(scorer.token), features: features(plan) }),
    reopen() { accounts.onModuleDestroy(); accounts = new AccountsService({ path, now }); } };
}
test('scorekeeper levels are 1/3/unlimited tournaments and do not grant career or another role statistics', () => {
  for (const [plan, level, limit] of [[null, 1, 1], ['scorekeeper-numbers', 2, 3], ['scorekeeper', 3, null], ['player', 1, 1], ['manager', 1, 1]]) {
    assert.equal(scorekeeperPlanLevel({ features: features(plan) }), level);
    assert.equal(scorekeeperTournamentLimit({ features: features(plan) }), limit);
  }
  for (const plan of ['scorekeeper', 'scorekeeper-numbers'])
    assert.ok(features(plan).every(feature => !['career', 'player-statistics', 'team-statistics', 'final-report-details'].includes(feature)));
});
test('tournament cups persist across restart, enforce downgrade and revision conflicts without deleting history', async t => {
  const e = await fixture(t), tournaments = rows(), account = e.account('scorekeeper-numbers');
  let access = readScorekeeperAccess(e.accounts.scorekeeperAccess(account, tournaments), account.id);
  assert.equal(access.selectionRequired, true);
  const command = { expectedAccountId: account.id, expectedRevision: 0, selected: tournaments.slice(0, 3).map(team => team.tournamentId) };
  access = e.accounts.changeScorekeeperTournaments(account, tournaments, command);
  assert.equal(access.tournaments.filter(team => team.enabled).length, 3);
  bad(() => e.accounts.changeScorekeeperTournaments(account, tournaments, { ...command, selected: ['tour-4'] }), 409);
  bad(() => e.accounts.changeScorekeeperTournaments(account, tournaments, { ...command, expectedRevision: 1, selected: ['foreign'] }), 403);
  bad(() => e.accounts.changeScorekeeperTournaments(account, tournaments, { ...command, expectedRevision: 1, selected: ['tour-0', 'tour-0'] }), 400);
  bad(() => e.accounts.changeScorekeeperTournaments(account, tournaments, { ...command, expectedRevision: 1, selected: tournaments.map(team => team.tournamentId) }), 403);
  e.reopen(); assert.deepEqual(e.accounts.scorekeeperAccess(account, tournaments), access);
  const basic = { ...account, features: [] };
  assert.equal(e.accounts.scorekeeperAccess(basic, tournaments).tournaments.filter(team => team.enabled).length, 0);
  bad(() => e.accounts.assertScorekeeperAccess(basic, tournaments, 'tour-0', 'game'), 403);
  assert.equal(e.accounts.scorekeeperAccess(basic, tournaments).tournaments.length, 5);
  tournaments[0].active = false;
  const saved = e.accounts.changeScorekeeperTournaments(basic, tournaments, { ...command, expectedRevision: 1, selected: ['tour-1'] });
  assert.equal(saved.tournaments.find(team => team.tournamentId === 'tour-0').enabled, true);
  assert.equal(saved.tournaments.filter(team => team.active && team.enabled).length, 1);
});
test('unlimited subscriptions accept many tournaments but never foreign ones or forged limits', async t => {
  const e = await fixture(t), account = e.account('scorekeeper');
  const tournaments = Array.from({ length: 80 }, (_, i) => ({ tournamentId: `tour-${i}`, tournamentName: `Copa ${i}`, active: true }));
  const access = e.accounts.scorekeeperAccess(account, tournaments);
  assert.equal(access.limit, null); assert.equal(access.tournaments.filter(team => team.enabled).length, 80);
  const command = { expectedAccountId: account.id, expectedRevision: 0, selected: tournaments.map(team => team.tournamentId) };
  const saved = e.accounts.changeScorekeeperTournaments(account, tournaments, command);
  e.reopen(); assert.deepEqual(e.accounts.scorekeeperAccess(account, tournaments), saved);
  bad(() => e.accounts.assertScorekeeperAccess(account, tournaments, 'foreign'), 403);
  assert.throws(() => readScorekeeperAccess({ ...saved, limit: 3 }, account.id));
  assert.throws(() => readScorekeeperAccess(saved, 'foreign'));
});
test('requesting an extra never grants access or changes cup selection; only an administrator can grant and revoke the exact match', async t => {
  const e = await fixture(t), tournaments = rows(), account = e.account(null);
  const selected = { expectedAccountId: account.id, expectedRevision: 0, selected: ['tour-0'] };
  e.accounts.changeScorekeeperTournaments(account, tournaments, selected);
  const request = { expectedAccountId: account.id, expectedRevision: 0, tournamentId: 'tour-3', gameId: 'extra-game' };
  e.accounts.requestScorekeeperExtra(account, request);
  bad(() => e.accounts.assertScorekeeperAccess(account, tournaments, 'tour-3', 'extra-game'), 403);
  bad(() => e.accounts.requestScorekeeperExtra(account, { ...request, status: 'granted' }), 400);
  bad(() => e.accounts.requestScorekeeperExtra(account, { ...request, expectedAccountId: 'foreign' }), 403);
  const review = { expectedAdminId: e.admin.account.id, accountId: account.id, tournamentId: request.tournamentId,
    gameId: request.gameId, expectedRevision: 1, action: 'grant', reason: 'Prueba sin cobro' };
  bad(() => e.accounts.reviewScorekeeperExtra(e.scorer.token, review), 403);
  const queue = readScorekeeperExtraQueue(e.accounts.scorekeeperExtraQueue(e.admin.token), e.admin.account.id);
  assert.equal(queue.length, 1); assert.equal(queue[0].status, 'requested');
  e.accounts.reviewScorekeeperExtra(e.admin.token, review); e.reopen();
  e.accounts.assertScorekeeperAccess(account, tournaments, 'tour-3', 'extra-game');
  for (const [tournamentId, gameId] of [['tour-3', undefined], ['tour-3', 'other'], ['tour-4', 'extra-game'], ['foreign', 'extra-game']])
    bad(() => e.accounts.assertScorekeeperAccess(account, tournaments, tournamentId, gameId), 403);
  assert.deepEqual(e.accounts.scorekeeperAccess(account, tournaments).tournaments.filter(team => team.enabled).map(team => team.tournamentId), ['tour-0']);
  e.accounts.reviewScorekeeperExtra(e.admin.token, { ...review, expectedRevision: 2, action: 'revoke' });
  bad(() => e.accounts.assertScorekeeperAccess(account, tournaments, 'tour-3', 'extra-game'), 403);
  bad(() => e.accounts.reviewScorekeeperExtra(e.admin.token, review), 409);
});
test('statistics API requires an explicit own tournament, level two only opens one game, and level three never combines tournaments', async t => {
  const e = await fixture(t), samples = exampleStatisticsGames('player'), first = samples[0];
  const tournaments = [...new Map(samples.map(game => [game.tournamentId, { tournamentId: game.tournamentId, tournamentName: game.tournamentName, active: true }])).values()];
  let account = e.account(null);
  const scorer = {
    isScorekeeperSubstitute: () => false,
    scorekeeperTournaments: () => tournaments,
    scorekeeperGameAssigned: (_actor, tournamentId, gameId) => samples.some(game => game.tournamentId === tournamentId && game.gameId === gameId),
    scorekeeperStatistics(_actor, tournamentId, gameId) {
      const games = samples.filter(game => game.tournamentId === tournamentId && (!gameId || game.gameId === gameId));
      return { games, players: games.map(game => ({ id: `player-${'a'.repeat(64)}`, name: 'Jugador propio', activeTournament: true, game })) };
    },
  };
  const controller = new ScorekeeperAccessController({ authenticate: () => account,
    assertScorekeeperAccess: (...args) => e.accounts.assertScorekeeperAccess(...args),
    scorekeeperAccess: (...args) => e.accounts.scorekeeperAccess(...args) }, scorer);
  const req = { headers: { cookie: `playsport-account=${e.scorer.token}` } }, query = { tournamentId: first.tournamentId, gameId: first.gameId };
  e.accounts.changeScorekeeperTournaments(account, tournaments, { expectedAccountId: account.id, expectedRevision: 0, selected: [first.tournamentId] });
  bad(() => controller.statistics(req, query), 403);
  account = e.account('scorekeeper-numbers');
  const game = readScorekeeperStatistics(controller.statistics(req, query), account.id, first.tournamentId, first.gameId);
  assert.equal(game.totals.length, 0); assert.ok(game.players.every(player => player.game.gameId === first.gameId));
  bad(() => controller.statistics(req, { tournamentId: first.tournamentId }), 403);
  for (const extra of [{ accountId: 'foreign' }, { playerId: 'foreign' }, { from: '2026-01-01' }, { tournamentId: [first.tournamentId, 'foreign'] }])
    bad(() => controller.statistics(req, { ...query, ...extra }), 400);
  account = e.account('scorekeeper');
  const totals = readScorekeeperStatistics(controller.statistics(req, { tournamentId: first.tournamentId }), account.id, first.tournamentId, null);
  assert.equal(totals.totals[0].line.batting.G, 2);
  assert.ok(totals.players.every(player => player.game.tournamentId === first.tournamentId));
  bad(() => controller.statistics(req, {}), 400);
  bad(() => controller.statistics(req, { tournamentId: 'foreign' }), 403);
  account = { ...account, localTestAccess: true };
  bad(() => controller.statistics(req, { tournamentId: 'foreign' }), 403);
  assert.throws(() => readScorekeeperStatistics({ ...game, games: samples }, account.id, first.tournamentId, first.gameId));
});
test('official write guard rejects out-of-cup writes and extra access cannot spill into a different game', async t => {
  const e = await fixture(t), account = e.account('scorekeeper-numbers'), tournaments = rows(), actorId = account.identity.actorId;
  e.accounts.changeScorekeeperTournaments(account, tournaments, { expectedAccountId: account.id, expectedRevision: 0, selected: ['tour-0'] });
  const scoring = { hasManagedInscriptions: () => false, scorekeeperTournaments: () => tournaments,
    gameOperationStartedAt: () => null,
    isScorekeeperSubstitute: () => false,
    scorekeeperGameAssigned: () => true, accountManagesTournament: () => false, accountOrganizesTournament: () => false, actorAssignedTournament: () => true };
  const guard = new SportingAccountGuard({ authenticate: () => account, assertScorekeeperAccess: (...args) => e.accounts.assertScorekeeperAccess(...args),
    roleContinuationAllowed: (...args) => e.accounts.roleContinuationAllowed(...args), assertRoleOperation: (...args) => e.accounts.assertRoleOperation(...args) }, scoring);
  const context = (tournamentId, gameId = 'game') => ({ switchToHttp: () => ({ getRequest: () => ({
    method: 'POST', url: `/api/official-scoring/games/${gameId}/official-updates`, headers: { origin: 'http://localhost:3000' },
    params: { gameId }, query: {}, body: { tournamentId, actorId, actorRole: 'scorekeeper' },
  }) }) });
  assert.equal(guard.canActivate(context('tour-0')), true);
  bad(() => guard.canActivate(context('tour-1')), 403);
  e.accounts.requestScorekeeperExtra(account, { expectedAccountId: account.id, expectedRevision: 0, tournamentId: 'tour-1', gameId: 'extra' });
  e.accounts.reviewScorekeeperExtra(e.admin.token, { expectedAdminId: e.admin.account.id, accountId: account.id, expectedRevision: 1,
    tournamentId: 'tour-1', gameId: 'extra', action: 'grant', reason: 'Prueba' });
  assert.equal(guard.canActivate(context('tour-1', 'extra')), true);
  bad(() => guard.canActivate(context('tour-1', 'other')), 403);
  bad(() => guard.canActivate(context('foreign', 'extra')), 403);
});
test('open scorer streams recheck the account and tournament cups before every emitted state or team sheet', async t => {
  const { of, lastValueFrom } = require('rxjs');
  const e = await fixture(t), catalog = rows().slice(0, 2), account = e.account(null), actor = account.identity.actorId;
  e.accounts.changeScorekeeperTournaments(account, catalog, { expectedAccountId: account.id, expectedRevision: 0, selected: ['tour-0'] });
  const req = { method: 'GET', url: '/api/official-scoring/games/game-0/stream', headers: { cookie: `playsport-account=${e.scorer.token}` },
    params: { gameId: 'game-0' }, query: { tournamentId: 'tour-0', role: 'scorekeeper', userId: actor } };
  const scoring = { scorekeeperTournaments: () => catalog, scorekeeperGameAssigned: () => true, hasManagedInscriptions: () => false,
    gameOperationStartedAt: () => null,
    isScorekeeperSubstitute: () => false,
    actorAssignedTournament: () => true, accountManagesTournament: () => false, accountOrganizesTournament: () => false,
    createGameStream: () => of({ kind: 'state', gameId: 'game-0' }), createTeamSheetStream: () => of({ gameId: 'game-0' }) };
  const guard = new SportingAccountGuard(e.accounts, scoring);
  assert.equal(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
  const controller = new OfficialScoringController(scoring, e.accounts);
  assert.equal((await lastValueFrom(controller.streamGame('game-0', 'tour-0', req))).type, 'state');
  assert.equal((await lastValueFrom(controller.streamTeamSheets('game-0', 'tour-0', actor, 'scorekeeper', req))).data.gameId, 'game-0');
  e.accounts.changeScorekeeperTournaments(account, catalog, { expectedAccountId: account.id, expectedRevision: 1, selected: ['tour-1'] });
  await assert.rejects(lastValueFrom(controller.streamGame('game-0', 'tour-0', req)), error => error.getStatus?.() === 403);
  await assert.rejects(lastValueFrom(controller.streamTeamSheets('game-0', 'tour-0', actor, 'scorekeeper', req)), error => error.getStatus?.() === 403);
});

test('Anotador report detail is role-scoped: a player membership cannot unlock basic scorer numbers', async t => {
  const e = await fixture(t), tournaments = rows();
  let account = e.account('player');
  e.accounts.changeScorekeeperTournaments(account, tournaments, { expectedAccountId: account.id, expectedRevision: 0, selected: ['tour-0'] });
  const controller = new OfficialScoringController({ scorekeeperTournaments: () => tournaments, scorekeeperGameAssigned: () => true,
    isScorekeeperSubstitute: () => false,
    gameReport(_gameId, _tournamentId, detailed) { return { detailed }; } }, {
    authenticate: () => account, assertScorekeeperAccess: (...args) => e.accounts.assertScorekeeperAccess(...args),
  });
  const req = { headers: { cookie: 'playsport-account=own' } };
  assert.equal(controller.gameReport('game', { tournamentId: 'tour-0', role: 'scorekeeper' }, req).detailed, false);
  account = e.account('scorekeeper-numbers');
  assert.equal(controller.gameReport('game', { tournamentId: 'tour-0', role: 'scorekeeper' }, req).detailed, true);
  assert.equal(controller.gameReport('game', { tournamentId: 'tour-0' }, req).detailed, false);
  bad(() => controller.gameReport('game', { tournamentId: 'tour-1', role: 'scorekeeper' }, req), 403);
});
test('HTTP rejects missing sessions, duplicate scopes and foreign origins, and cannot self-activate extras', async t => {
  const e = await fixture(t), account = e.account('scorekeeper');
  const scoring = { scorekeeperTournaments: () => rows(), scorekeeperGameAssigned: () => true,
    scorekeeperStatistics: () => ({ games: [], players: [] }) };
  const app = await NestFactory.create({ module: class TestModule {}, controllers: [ScorekeeperAccessController],
    providers: [{ provide: AccountsService, useValue: { authenticate: token => e.accounts.authenticate(token),
      scorekeeperAccess: (...args) => e.accounts.scorekeeperAccess(...args),
      requestScorekeeperExtra: (...args) => e.accounts.requestScorekeeperExtra(...args) } },
      { provide: OfficialScoringService, useValue: scoring }] }, { logger: false });
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); });
  const base = await app.getUrl(), headers = { cookie: `playsport-account=${e.scorer.token}` };
  assert.equal((await fetch(`${base}/sports-sheet/scorekeeper-tournaments`)).status, 401);
  assert.equal((await fetch(`${base}/sports-sheet/scorekeeper-statistics?tournamentId=tour-0&tournamentId=tour-1`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/sports-sheet/scorekeeper-extra`, { method: 'POST',
    headers: { ...headers, origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const response = await fetch(`${base}/sports-sheet/scorekeeper-extra`, { method: 'POST',
    headers: { ...headers, origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedAccountId: account.id, expectedRevision: 0, tournamentId: 'tour-4', gameId: 'one' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, 'requested');
  bad(() => e.accounts.assertScorekeeperAccess(account, rows(), 'foreign'), 403);
});
