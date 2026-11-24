const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { SportsSheetController } = require('../src/modules/live-scoring/sports-sheet.controller');
const { SportingAccountGuard } = require('../src/modules/live-scoring/sporting-account.guard');
const { ForbiddenException, UnauthorizedException } = require('@nestjs/common');
const { managerPlanLevel, managerTeamLimit, managerTeamKey, readManagerTeamAccess, readManagerSelection,
  readStatisticsSnapshot, exampleStatisticsGames, trialPlans } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const features = id => trialPlans.find(plan => plan.id === id).features;
const teams = () => Array.from({ length: 6 }, (_, i) => ({ tournamentId: `tournament-${i}`, tournamentName: `Torneo ${i}`,
  teamId: i < 2 ? 'same-club' : `team-${i}`, teamName: i < 2 ? 'Mismo club' : `Equipo ${i}`, active: i < 4 }));
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-manager-')), path = join(directory, 'accounts.sqlite');
  const stamp = Date.now(), now = () => stamp;
  let accounts = new AccountsService({ path, now });
  const user = await accounts.register({ email: 'manager@example.test', displayName: 'Manager de prueba',
    password: 'Una contraseña ficticia de prueba 123' }, 'manager');
  const admin = await accounts.register({ email: 'admin@example.test', displayName: 'Administrador del Lago',
    password: 'Una contraseña ficticia de prueba 123' }, 'admin');
  const previous = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = admin.account.id;
  t.after(() => {
    accounts.onModuleDestroy(); rmSync(directory, { recursive: true, force: true });
    if (previous === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID; else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = previous;
  });
  const photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
  accounts.submitIdentity(user.token, { expectedAccountId: user.account.id, requestId: randomUUID(), expectedRevision: 0,
    identification: 'V-99201001', fullName: 'Manager del Lago', birthDate: '1990-01-02', documentPhoto: photo, personalPhoto: photo, consent: true });
  accounts.reviewIdentity(admin.token, { expectedAccountId: admin.account.id, accountId: user.account.id, expectedRevision: 1,
    decision: 'verified', reason: 'Prueba aislada', documentsMatch: true });
  accounts.activateRole(user.token, { expectedAccountId: user.account.id, role: 'manager' });
  return { user, get accounts() { return accounts; }, reopen() { accounts.onModuleDestroy(); accounts = new AccountsService({ path, now }); } };
}
test('manager levels have independent 1/3/unlimited quotas and never grant global player analysis', () => {
  for (const [id, level, limit] of [[null, 1, 1], ['manager-numbers', 2, 3], ['manager', 3, null], ['player', 1, 1]]) {
    const account = { features: id ? features(id) : [] };
    assert.equal(managerPlanLevel(account), level); assert.equal(managerTeamLimit(account), limit);
  }
  assert.ok(!features('manager').includes('player-statistics-analysis'));
  assert.ok(!features('manager-numbers').includes('manager-statistics-analysis'));
  assert.equal(managerTeamLimit({ localTestAccess: true }), null);
});
test('inscriptions, not club names, consume cups; downgrade requires choosing without deleting history; selection survives restart', async t => {
  const e = await fixture(t), rows = teams(), paid = { ...e.user.account, features: features('manager-numbers') };
  assert.equal(e.accounts.managerTeamAccess(paid, rows).selectionRequired, true);
  const selected = rows.slice(0, 3).map(managerTeamKey);
  const change = { expectedAccountId: paid.id, expectedRevision: 0, selected };
  const access = readManagerTeamAccess(e.accounts.changeManagerTeams(paid, rows, change), paid.id);
  assert.equal(access.teams.filter(team => team.managed).length, 3);
  assert.notEqual(selected[0], selected[1]);
  bad(() => e.accounts.changeManagerTeams(paid, rows, { ...change, expectedRevision: 1, selected: rows.slice(0, 4).map(managerTeamKey) }), 403);
  e.reopen();
  assert.deepEqual(e.accounts.managerTeamAccess(paid, rows), access);
  const basic = { ...paid, features: [] }, before = JSON.stringify(rows);
  const downgraded = e.accounts.managerTeamAccess(basic, rows);
  assert.equal(downgraded.limit, 1); assert.equal(downgraded.selectionRequired, true);
  assert.equal(downgraded.teams.filter(team => team.managed).length, 0);
  bad(() => e.accounts.assertManagerTeamAccess(basic, rows, rows[0].tournamentId, rows[0].teamId), 403);
  const single = e.accounts.changeManagerTeams(basic, rows, { ...change, expectedRevision: 1, selected: [selected[1]] });
  assert.equal(single.teams.filter(team => team.managed).length, 1);
  assert.equal(single.teams.length, 6); assert.equal(JSON.stringify(rows), before);
  bad(() => e.accounts.assertManagerTeamAccess(basic, rows, rows[0].tournamentId, rows[0].teamId), 403);
  e.accounts.assertManagerTeamAccess(basic, rows, rows[1].tournamentId, rows[1].teamId);
  rows[1].active = false;
  assert.equal(e.accounts.managerTeamAccess(basic, rows).selectionRequired, true);
  assert.equal(e.accounts.managerTeamAccess(basic, rows).teams.length, 6);
});
test('unlimited Manager accepts and persists large selections, while downgrades enforce finite quotas without deleting them', async t => {
  const e = await fixture(t), account = { ...e.user.account, features: features('manager') };
  const rows = Array.from({ length: 80 }, (_, i) => ({ tournamentId: `tournament-${i}`, tournamentName: `Torneo ${i}`,
    teamId: 'same-club', teamName: 'Mismo club', active: true }));
  const historical = { ...rows[0], tournamentId: 'closed', active: false };
  rows.push(historical);
  const access = readManagerTeamAccess(e.accounts.managerTeamAccess(account, rows), account.id);
  assert.equal(access.limit, null); assert.equal(access.selectionRequired, false);
  assert.equal(access.teams.filter(team => team.managed).length, 80);
  const body = { expectedAccountId: account.id, expectedRevision: 0, selected: rows.filter(team => team.active).map(managerTeamKey) };
  const saved = e.accounts.changeManagerTeams(account, rows, body);
  e.reopen();
  assert.deepEqual(readManagerTeamAccess(e.accounts.managerTeamAccess(account, rows), account.id), saved);
  e.accounts.assertManagerTeamAccess(account, rows, rows[79].tournamentId, rows[79].teamId);
  bad(() => e.accounts.assertManagerTeamAccess(account, rows, historical.tournamentId, historical.teamId), 403);
  for (const plan of ['manager-numbers', null]) {
    const downgraded = { ...account, features: plan ? features(plan) : [] };
    const result = readManagerTeamAccess(e.accounts.managerTeamAccess(downgraded, rows), account.id);
    assert.equal(result.limit, plan ? 3 : 1); assert.equal(result.selectionRequired, true);
    assert.equal(result.teams.filter(team => team.managed).length, 0); assert.equal(result.teams.length, 81);
  }
  assert.deepEqual(e.accounts.managerTeamAccess(account, rows), saved);
  for (const limit of [3, 0, 'unlimited', undefined])
    assert.throws(() => readManagerTeamAccess({ ...saved, limit }, account.id));
});
test('two sessions cannot overwrite selection; foreign, closed, duplicate and excess inscriptions are rejected atomically', async t => {
  const e = await fixture(t), rows = teams(), account = { ...e.user.account, features: features('manager-numbers') };
  const body = { expectedAccountId: account.id, expectedRevision: 0, selected: [managerTeamKey(rows[0])] };
  e.accounts.changeManagerTeams(account, rows, body);
  bad(() => e.accounts.changeManagerTeams(account, rows, { ...body, selected: [managerTeamKey(rows[1])] }), 409);
  for (const selected of [[managerTeamKey(rows[4])], ['foreign'], [managerTeamKey(rows[0]), managerTeamKey(rows[0])]]) {
    bad(() => e.accounts.changeManagerTeams(account, rows, { ...body, expectedRevision: 1, selected }), selected.length === 2 ? 400 : 403);
  }
  bad(() => e.accounts.changeManagerTeams(account, rows, { ...body, expectedRevision: 1, expectedAccountId: 'foreign' }), 403);
  bad(() => e.accounts.changeManagerTeams({ ...account, features: [] }, rows, { ...body, expectedRevision: 1,
    selected: rows.slice(0, 2).map(managerTeamKey) }), 403);
  assert.equal(e.accounts.managerTeamAccess(account, rows).revision, 1);
  assert.throws(() => readManagerSelection({ ...body, role: 'manager' }));
  assert.throws(() => readManagerTeamAccess({ ...e.accounts.managerTeamAccess(account, rows), level: '2' }, account.id));
});
test('manager APIs retain individual game lines but never provide individual totals at any level, including local test access', () => {
  const games = exampleStatisticsGames('team'), individual = exampleStatisticsGames('player');
  const id = `player-${'a'.repeat(64)}`;
  const players = individual.map(game => ({ id, name: 'Jugador de ejemplo', activeTournament: game.tournamentId === games[0].tournamentId, game }));
  let account = { id: 'owner', features: [], identity: { status: 'verified', actorId: 'person:owner', identification: 'V-12345678' } };
  const scorer = { managerStatistics(actor) { assert.equal(actor, account.identity.actorId); return { games, players }; },
    managerPlanTeams(actor, owner) { assert.equal(actor, 'person:owner'); assert.equal(owner, 'owner');
      return games.filter((game, i) => i === 0 || i === 2).map(game => ({ ...game, active: game.tournamentId === games[0].tournamentId })); } };
  const controller = new SportsSheetController({ authenticate(token) {
    if (token !== 'own') throw new UnauthorizedException(); return account;
  } }, scorer, {});
  const req = { headers: { cookie: 'playsport-account=own' } };
  const scope = { tournamentId: games[0].tournamentId, teamId: games[0].teamId };
  bad(() => controller.statistics(req, { mode: 'team' }), 403);
  account = { ...account, features: features('manager-numbers') };
  const snapshot = readStatisticsSnapshot(controller.statistics(req, { mode: 'team' }), account.id, 'team', 'official');
  assert.equal(snapshot.analysisAllowed, false); assert.deepEqual(snapshot.players, players);
  for (const query of [{ from: '' }, { game: games[0].gameId }, { tournament: games[0].tournamentId }])
    bad(() => controller.statistics(req, { mode: 'team', ...query }), 403);
  bad(() => controller.managerPlayerTotals(req, scope), 403);
  account = { ...account, features: features('manager') };
  const advanced = readStatisticsSnapshot(controller.statistics(req, { mode: 'team', tournament: scope.tournamentId }), account.id, 'team', 'official');
  assert.equal(advanced.analysisAllowed, true); assert.deepEqual(advanced.players, players);
  assert.ok(advanced.games.every(game => game.tournamentId === scope.tournamentId));
  assert.ok(advanced.players.every(player => player.game.line.batting.G === 1));
  bad(() => controller.managerPlayerTotals(req, scope), 403);
  bad(() => controller.managerPlayerTotals(req, { ...scope, tournamentId: games[2].tournamentId }), 403);
  bad(() => controller.managerPlayerTotals(req, { ...scope, teamId: 'foreign' }), 403);
  bad(() => controller.managerPlayerTotals(req, { ...scope, accountId: 'foreign' }), 403);
  bad(() => controller.managerPlayerTotals(req, { ...scope, tournamentId: [scope.tournamentId] }), 403);
  account = { ...account, localTestAccess: true };
  assert.throws(() => controller.managerPlayerTotals(req), error =>
    error.getStatus() === 403 && error.getResponse().code === 'MANAGER_PLAYER_TOTALS_UNAVAILABLE');
  bad(() => controller.managerPlayerTotals({ headers: {} }), 401);
  bad(() => controller.statistics({ headers: {} }, { mode: 'team' }), 401);
  account = { ...account, localTestAccess: undefined, features: features('player') };
  bad(() => controller.statistics(req, { mode: 'team' }), 403);
  bad(() => controller.managerPlayerTotals(req, scope), 403);
  assert.throws(() => readStatisticsSnapshot({ ...snapshot, mode: 'player' }, account.id, 'player', 'official'));
});
test('manager write guard checks the exact inscription for both manager identifiers and actor-role requests, retaining private reads', async t => {
  const e = await fixture(t), rows = teams(), account = { ...e.user.account, features: [],
    identity: { status: 'verified', actorId: 'person:owner', identification: 'V-12345678' } };
  e.accounts.changeManagerTeams(account, rows, { expectedAccountId: account.id, expectedRevision: 0, selected: [managerTeamKey(rows[0])] });
  const guard = new SportingAccountGuard({ authenticate: () => account,
    assertManagerTeamAccess: (...args) => e.accounts.assertManagerTeamAccess(...args) }, {
    managerPlanTeams: () => rows, hasManagedInscriptions: () => true, accountManagesTournament: () => true,
    accountOrganizesTournament: () => false, accountHasInscription: () => true, actorAssignedTournament: () => true,
  });
  const context = (index, body, method = 'POST') => ({ switchToHttp: () => ({ getRequest: () => ({
    method, url: '/api/official-scoring/games/game/teams/team/lineup', headers: { origin: 'http://localhost:3000' },
    params: { tournamentId: rows[index].tournamentId, teamId: rows[index].teamId }, query: {},
    body: { tournamentId: rows[index].tournamentId, ...body },
  }) }) });
  for (const body of [{ managerId: 'person:owner' }, { actorId: 'person:owner', actorRole: 'manager' }]) {
    assert.equal(guard.canActivate(context(0, body)), true);
    bad(() => guard.canActivate(context(1, body)), 403);
    bad(() => guard.canActivate(context(3, body)), 403);
  }
  assert.equal(guard.canActivate(context(1, { managerId: 'person:owner' }, 'GET')), true);
  rows[0].active = false;
  bad(() => guard.canActivate(context(0, { managerId: 'person:owner' })), 403);
});
