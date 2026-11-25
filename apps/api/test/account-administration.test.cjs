const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { AccountsController } = require('../src/modules/accounts/accounts.controller');
const { SportsSheetController } = require('../src/modules/live-scoring/sports-sheet.controller');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { FriendlyGamesController } = require('../src/modules/live-scoring/friendly-games.controller');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { readAdministrationSnapshot, readOwnAccountAccess, readAccountProfile, playerPlanLevel,
  exampleStatisticsGames, exampleCareerGames, aggregateStatistics, statisticsGroupKey } = require('@playsport/shared');

const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-administration-'));
  const path = join(directory, 'accounts.sqlite');
  let now = Date.parse('2026-11-22T12:00:00.000Z');
  let accounts = new AccountsService({ path, now: () => now });
  let app;
  const prior = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID;
  const registration = (email, displayName) => ({ email, displayName, password: 'Prueba privada ficticia 123' });
  const owner = await accounts.register(registration('admin@example.test', 'Administrador de prueba'), 'admin');
  const user = await accounts.register(registration('player@example.test', 'Jugador de prueba'), 'player');
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = owner.account.id;
  t.after(async () => {
    if (app) await app.close(); else accounts.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
    if (prior === undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = prior;
  });
  const command = (patch = {}) => ({ requestId: randomUUID(), expectedAdminId: owner.account.id, accountId: user.account.id,
    planId: 'player', expectedRevision: 0, action: 'grant', reason: 'Prueba aislada del piloto',
    expiresAt: new Date(now + 10000).toISOString(), ...patch });
  return { owner, user, directory, friendly: new FriendlyGamesService(join(directory, 'friendly.json')), accounts: () => accounts, command, now: () => now, advance(ms) { now += ms; }, useApp(value) { app = value; },
    reopen() { accounts.onModuleDestroy(); accounts = new AccountsService({ path, now: () => now }); return accounts; } };
}
test('draft prices are private, distinguish zero from unset, persist and reject stale edits', async t => {
  const e = await fixture(t), accounts = e.accounts();
  bad(() => accounts.draftPrices(undefined), 401);
  bad(() => accounts.draftPrices(e.user.token), 403);
  const command = { expectedAdminId: e.owner.account.id, key: 'player-numbers:1', name: 'Jugador Mis números · mensual',
    currency: 'USD', amountCents: 0, expectedRevision: 0 };
  bad(() => accounts.saveDraftPrice(e.user.token, command), 403);
  bad(() => accounts.saveDraftPrice(e.owner.token, { ...command, amountCents: -1 }), 400);
  bad(() => accounts.saveDraftPrice(e.owner.token, { ...command, currency: 'INVALID' }), 400);
  bad(() => accounts.saveDraftPrice(e.owner.token, { ...command, published: true }), 400);
  bad(() => accounts.saveDraftPrice(e.owner.token, { ...command, expectedAdminId: e.user.account.id }), 409);
  assert.deepEqual(accounts.draftPrices(e.owner.token).prices, []);
  const saved = accounts.saveDraftPrice(e.owner.token, command);
  assert.equal(saved.price.amountCents, 0);
  assert.equal(saved.price.revision, 1);
  bad(() => accounts.saveDraftPrice(e.owner.token, command), 409);
  assert.equal(e.reopen().draftPrices(e.owner.token).prices[0].amountCents, 0);
  const unset = e.accounts().saveDraftPrice(e.owner.token, { ...command, amountCents: null, expectedRevision: 1 });
  assert.equal(unset.price.amountCents, null);
  assert.deepEqual(e.accounts().authenticate(e.user.token).features, []);
});
test('only an explicit administrator can list accounts or grant trials; no role, money, identity or master privileges are granted', async t => {
  const e = await fixture(t), accounts = e.accounts();
  bad(() => accounts.administration(undefined, {}), 401);
  bad(() => accounts.administration(e.user.token, {}), 403);
  bad(() => accounts.changeTrial(e.user.token, e.command()), 403);
  const snapshot = readAdministrationSnapshot(accounts.administration(e.owner.token, {}), e.owner.account.id);
  assert.equal(snapshot.total, 2); assert.equal(snapshot.users.length, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /password_hash|token_hash|identification|evidence/);
  const result = accounts.changeTrial(e.owner.token, e.command());
  assert.equal(result.trial.revision, 1);
  const account = readAccountProfile(accounts.authenticate(e.user.token));
  assert.deepEqual(account.features, ['player-statistics', 'career', 'final-report-details', 'player-statistics-analysis']);
  assert.equal(account.financialAccess, false); assert.equal(account.localTestAccess, undefined);
  assert.equal(account.administrationAccess, undefined); assert.equal(account.identityReviewer, undefined);
  assert.equal(account.identity, undefined);
  bad(() => accounts.identityQueue(e.user.token), 403);
  bad(() => accounts.administration(e.owner.token, { actorId: e.user.account.id }), 400);
  bad(() => accounts.changeTrial(e.owner.token, e.command({ features: ['administrator'] })), 400);
  assert.equal(accounts.administration(e.owner.token, {}).auditTotal, 1);
});
test('expiry is enforced at the exact server threshold and survives restart; revoked trials preserve account data', async t => {
  const e = await fixture(t), command = e.command();
  e.accounts().changeTrial(e.owner.token, command);
  e.advance(9999);
  assert.ok(e.accounts().authenticate(e.user.token).features.includes('player-statistics'));
  e.advance(1);
  assert.deepEqual(e.accounts().authenticate(e.user.token).features, []);
  const own = readOwnAccountAccess(e.reopen().ownAccess(e.user.token), e.user.account.id);
  assert.equal(own.trials[0].active, true); assert.equal(own.trials[0].revision, 1);
  assert.deepEqual(own.features, []);
  const renewed = e.command({ expectedRevision: 1 });
  e.accounts().changeTrial(e.owner.token, renewed);
  const revoke = e.command({ action: 'revoke', expectedRevision: 2 }); delete revoke.expiresAt;
  e.accounts().changeTrial(e.owner.token, revoke);
  assert.deepEqual(e.accounts().authenticate(e.user.token).features, []);
});
test('revocation is idempotent and never removes another plan or sporting records', async t => {
  const e = await fixture(t);
  e.accounts().changeTrial(e.owner.token, e.command());
  e.accounts().changeTrial(e.owner.token, e.command({ planId: 'manager' }));
  const revoke = e.command({ action: 'revoke', expectedRevision: 1 }); delete revoke.expiresAt;
  const result = e.accounts().changeTrial(e.owner.token, revoke);
  assert.equal(result.trial.active, false);
  assert.deepEqual(e.accounts().authenticate(e.user.token).features, ['team-statistics', 'career', 'final-report-details', 'manager-statistics-analysis']);
  assert.deepEqual(e.reopen().changeTrial(e.owner.token, revoke), result);
  assert.equal(e.accounts().administration(e.owner.token, {}).auditTotal, 3);
  const snapshot = e.accounts().ownAccess(e.user.token);
  assert.equal(snapshot.trials.length, 2);
  assert.equal(e.accounts().authenticate(e.user.token).displayName, 'Jugador de prueba');
});
test('stale revisions, altered replays, invalid expiry and cross-admin changes never produce partial grants or audit events', async t => {
  const e = await fixture(t), command = e.command();
  const granted = e.accounts().changeTrial(e.owner.token, command);
  assert.deepEqual(e.reopen().changeTrial(e.owner.token, command), granted);
  bad(() => e.accounts().changeTrial(e.owner.token, { ...command, reason: 'Cambio de motivo' }), 409);
  bad(() => e.accounts().changeTrial(e.owner.token, e.command()), 409);
  bad(() => e.accounts().changeTrial(e.owner.token, e.command({ expectedRevision: 1, expiresAt: new Date(e.now()).toISOString() })), 400);
  bad(() => e.accounts().changeTrial(e.owner.token, e.command({ expectedAdminId: e.user.account.id })), 409);
  bad(() => e.accounts().changeTrial(e.owner.token, e.command({ planId: 'unknown' })), 400);
  bad(() => e.accounts().changeTrial(e.owner.token, e.command({ accountId: randomUUID() })), 404);
  assert.equal(e.accounts().ownAccess(e.user.token).trials[0].revision, 1);
  assert.equal(e.accounts().administration(e.owner.token, {}).auditTotal, 1);
});
test('server capabilities govern statistics, career and official/friendly/private reports; examples stay separate', async t => {
  const e = await fixture(t), req = { headers: { cookie: `playsport-account=${e.user.token}` } };
  const calls = [];
  const sports = new SportsSheetController(e.accounts(), { personalStatistics() { calls.push('stats'); return []; }, personalCareer() { calls.push('career'); return []; } }, e.friendly);
  const official = new OfficialScoringController({ gameReport(id, tournament, detailed) { return { id, tournament, detailed }; } }, e.accounts());
  const friendly = new FriendlyGamesController({ report(owner, id, detailed) { return { owner, id, detailed }; } }, {}, e.accounts());
  bad(() => sports.statistics(req, {}), 403); bad(() => sports.career(req, {}), 403);
  assert.equal(official.gameReport('game', { tournamentId: 'tour' }, req).detailed, false);
  assert.equal(friendly.report(req, 'game', {}).detailed, false);
  e.accounts().changeTrial(e.owner.token, e.command());
  assert.deepEqual(sports.statistics(req, {}).games, []);
  assert.equal(sports.statistics(req, {}).identityVerified, false);
  bad(() => sports.statistics(req, { mode: 'team' }), 403);
  bad(() => sports.statistics(req, { source: 'example' }), 403);
  bad(() => sports.career(req, { source: 'example' }), 403);
  assert.deepEqual(sports.career(req, {}).games, []);
  assert.equal(official.gameReport('game', { tournamentId: 'tour' }, req).detailed, true);
  assert.equal(friendly.report(req, 'game', {}).detailed, true);
  assert.deepEqual(calls, []);
  const players = side => Array.from({ length: 9 }, (_, index) => ({ id: `${side}-${index}`, name: `Participante ${index}`,
    position: ['P','C','1B','2B','3B','SS','LF','CF','RF'][index], order: index + 1, jersey: String(index) }));
  const lineups = { home: players('h'), away: players('a') };
  e.accounts().savePrivateScorecard(e.user.token, { scope: 'own', expectedRevision: 0,
    save: { version: 1, seed: { names: { home: 'Local', away: 'Visitante' }, rosters: lineups, lineups, courtesyRunnerSource: 'ROSTER' }, commands: [] } });
  assert.equal(e.accounts().privateScorecardReport(e.user.token, 'own').detailed, true);
  bad(() => e.accounts().privateScorecardReport(e.owner.token, 'own'), 404);
  e.advance(10000);
  bad(() => sports.statistics(req, {}), 403);
  assert.equal(official.gameReport('game', { tournamentId: 'tour' }, req).detailed, false);
  assert.equal(friendly.report(req, 'game', {}).detailed, false);
  assert.equal(e.accounts().privateScorecardReport(e.user.token, 'own').detailed, false);
  assert.equal(e.accounts().privateScorecards(e.user.token).scorecards.length, 1);
});
test('administration HTTP requires session, origin and strict queries; own-access cannot select another identity', async t => {
  const e = await fixture(t), accounts = e.accounts();
  const app = await NestFactory.create({ module: class AdministrationModule {}, controllers: [AccountsController],
    providers: [{ provide: AccountsService, useValue: accounts }] }, { logger: false });
  e.useApp(app);
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/accounts`;
  const owner = { cookie: `playsport-account=${e.owner.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const user = { ...owner, cookie: `playsport-account=${e.user.token}` };
  const draft = { expectedAdminId: e.owner.account.id, key: 'http:test', name: 'Precio de prueba', currency: 'USD', amountCents: 0, expectedRevision: 0 };
  assert.equal((await fetch(`${url}/draft-prices`)).status, 401);
  assert.equal((await fetch(`${url}/draft-prices`, { headers: user })).status, 403);
  assert.equal((await fetch(`${url}/draft-prices?extra=1`, { headers: owner })).status, 400);
  const postPrice = headers => fetch(`${url}/draft-prices`, { method: 'POST', headers, body: JSON.stringify(draft) });
  assert.equal((await postPrice({ ...owner, Origin: 'https://foreign.invalid' })).status, 403);
  const price = await postPrice(owner); assert.equal(price.status, 200);
  assert.match(price.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await postPrice(owner)).status, 409);
  assert.equal((await fetch(`${url}/administration`)).status, 401);
  assert.equal((await fetch(`${url}/administration`, { headers: user })).status, 403);
  assert.equal((await fetch(`${url}/administration?page=0&page=1`, { headers: owner })).status, 400);
  assert.equal((await fetch(`${url}/access?accountId=${e.owner.account.id}`, { headers: user })).status, 400);
  const post = headers => fetch(`${url}/administration`, { method: 'POST', headers, body: JSON.stringify(e.command()) });
  assert.equal((await post({ ...owner, Origin: 'https://foreign.invalid' })).status, 403);
  const success = await post(owner); assert.equal(success.status, 200);
  assert.match(success.headers.get('cache-control'), /private.*no-store/);
  const own = await fetch(`${url}/access`, { headers: user });
  assert.equal(own.status, 200); assert.match(own.headers.get('cache-control'), /private.*no-store/);
  assert.ok(readOwnAccountAccess(await own.json(), e.user.account.id).features.includes('player-statistics'));
  const list = await fetch(`${url}/administration?q=Jugador`, { headers: owner });
  assert.equal(readAdministrationSnapshot(await list.json(), e.owner.account.id).users.length, 1);
});
test('development master can open the dashboard, but production never derives administration from a local fixture', async t => {
  const e = await fixture(t), previous = process.env.NODE_ENV;
  t.after(() => { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; });
  delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID;
  writeFileSync(join(e.directory, 'local-tester.json'), JSON.stringify({ version: 1, accountId: e.user.account.id }));
  process.env.NODE_ENV = 'development';
  assert.equal(e.accounts().authenticate(e.user.token).administrationAccess, true);
  process.env.NODE_ENV = 'production';
  assert.equal(e.accounts().authenticate(e.user.token).administrationAccess, undefined);
  bad(() => e.accounts().administration(e.user.token, {}), 403);
});
test('player levels enforce per-game/lifetime versus analysis in the server, preserve old trials and survive exact expiry/restart', async t => {
  const e = await fixture(t), priorReviewer = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = e.owner.account.id;
  t.after(() => {
    if (priorReviewer === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
    else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = priorReviewer;
  });
  const photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
  e.accounts().submitIdentity(e.user.token, { expectedAccountId: e.user.account.id, requestId: randomUUID(),
    expectedRevision: 0, identification: 'V-12345678', fullName: 'Jugador de prueba', birthDate: '1990-01-02',
    documentPhoto: photo, personalPhoto: photo, consent: true });
  e.accounts().reviewIdentity(e.owner.token, { expectedAccountId: e.owner.account.id, accountId: e.user.account.id,
    expectedRevision: 1, decision: 'verified', reason: 'Cotejo aislado de imágenes ficticias', documentsMatch: true });
  const history = exampleStatisticsGames('player'), before = JSON.stringify(history), actor = e.accounts().authenticate(e.user.token).identity.actorId;
  const historyByRole = exampleCareerGames();
  const scoring = {
    managerStatistics(actorId) { assert.equal(actorId, actor); return { games: history, players: [] }; },
    personalStatistics(identification, actorId) {
      assert.equal(identification, 'V-12345678'); assert.equal(actorId, actor); return history;
    },
    personalCareer(identification, actorId) {
      assert.equal(identification, 'V-12345678'); assert.equal(actorId, actor); return historyByRole;
    },
  };
  const sports = () => new SportsSheetController(e.accounts(), scoring, e.friendly);
  const request = { headers: { cookie: `playsport-account=${e.user.token}` } };
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 1);
  bad(() => sports().statistics(request, {}), 403);
  e.accounts().changeTrial(e.owner.token, e.command({ planId: 'player-numbers', expiresAt: new Date(e.now() + 20000).toISOString() }));
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 2);
  const lifetime = sports().statistics(request, {});
  assert.equal(lifetime.analysisAllowed, false); assert.deepEqual(lifetime.games, history);
  const baseball = lifetime.games.filter(game => statisticsGroupKey(game) === statisticsGroupKey(history[0]));
  assert.equal(aggregateStatistics(baseball).batting.G, 2);
  for (const query of [{ from: '2026-10-10' }, { tournament: history[0].tournamentId }, { game: history[0].gameId }, { group: '' }]) {
    assert.throws(() => sports().statistics(request, query), error => error.getStatus?.() === 403 &&
      error.getResponse().code === 'STATISTICS_ANALYSIS_REQUIRED');
  }
  bad(() => sports().career(request, {}), 403);
  bad(() => sports().statistics(request, { accountId: e.owner.account.id }), 400);
  bad(() => sports().statistics(request, { source: 'example' }), 403);
  e.accounts().changeTrial(e.owner.token, e.command());
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 3);
  const selected = sports().statistics(request, { tournament: history[0].tournamentId, from: history[0].date, to: history[0].date });
  assert.equal(selected.analysisAllowed, true); assert.deepEqual(selected.games, [history[0]]);
  assert.ok(sports().career(request, {}).games.some(game => game.role === 'player'));
  for (const query of [{ from: '2026-02-31' }, { from: '2026-11-22', to: '2026-01-01' }, { from: ['2026-10-10'] }, { team: '\u007f' }])
    bad(() => sports().statistics(request, query), 400);
  e.advance(9999);
  assert.equal(sports().statistics(request, {}).analysisAllowed, true);
  e.advance(1);
  assert.equal(playerPlanLevel(e.reopen().authenticate(e.user.token)), 2);
  assert.deepEqual(sports().statistics(request, {}).games, history);
  bad(() => sports().career(request, {}), 403);
  const replayed = e.accounts().ownAccess(e.user.token).trials.find(trial => trial.planId === 'player');
  assert.equal(replayed.revision, 1); assert.equal(replayed.active, true);
  const revoke = e.command({ action: 'revoke', expectedRevision: 1 }); delete revoke.expiresAt;
  e.accounts().changeTrial(e.owner.token, revoke);
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 2);
  e.accounts().changeTrial(e.owner.token, e.command({ planId: 'manager' }));
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 2);
  assert.ok(sports().career(request, {}).games.every(game => game.role !== 'player'));
  assert.equal(sports().statistics(request, { mode: 'team', from: history[0].date }).analysisAllowed, true);
  assert.equal(JSON.stringify(history), before, 'read/aggregate/trial changes never rewrite sporting history');
  e.advance(10000);
  assert.equal(playerPlanLevel(e.accounts().authenticate(e.user.token)), 1);
  bad(() => sports().statistics(request, {}), 403);
  assert.equal(e.accounts().authenticate(e.user.token).identity.status, 'verified');
});
test('statistics HTTP exposes server analysis capabilities, rejects duplicate filters and downgrade cannot filter', async t => {
  const e = await fixture(t), app = await NestFactory.create({ module: class PlayerLevelsModule {},
    controllers: [SportsSheetController], providers: [{ provide: AccountsService, useValue: e.accounts() },
      { provide: require('../src/modules/live-scoring/official-scoring.service').OfficialScoringService, useValue: {} },
      { provide: FriendlyGamesService, useValue: e.friendly }] }, { logger: false });
  e.useApp(app); await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/sports-sheet/statistics`, headers = { cookie: `playsport-account=${e.user.token}` };
  e.accounts().changeTrial(e.owner.token, e.command({ planId: 'player-numbers' }));
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal((await response.json()).analysisAllowed, false);
  assert.equal((await fetch(`${url}?from=2026-10-10`, { headers })).status, 403);
  e.accounts().changeTrial(e.owner.token, e.command());
  assert.equal((await fetch(`${url}?from=2026-10-10`, { headers })).status, 200);
  assert.equal((await fetch(`${url}?from=2026-10-10&from=2026-10-11`, { headers })).status, 400);
  assert.equal((await fetch(`${url}?analysisAllowed=true`, { headers })).status, 400);
});
