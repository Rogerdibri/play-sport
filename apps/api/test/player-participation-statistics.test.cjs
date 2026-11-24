const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { AccountsController } = require('../src/modules/accounts/accounts.controller');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { FriendlyGamesController } = require('../src/modules/live-scoring/friendly-games.controller');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { SportsSheetController } = require('../src/modules/live-scoring/sports-sheet.controller');
const { exampleStatisticsGames, readStatisticsSnapshot, aggregateStatistics, statisticsGroupKey,
  linkScorecardParticipant, readPrivateSave, replayPrivate, personalScorecardStatistics, minimumDestinations } = require('@playsport/shared');

const setup = { sport: 'baseball', names: { home: 'Locales ficticios', away: 'Visitantes ficticios' },
  lineups: Object.fromEntries(['home', 'away'].map(side => [side, Array.from({ length: 9 }, (_, index) => ({
    name: index < 2 ? 'Nombre repetido' : `Participante ${side} ${index}`, position: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][index],
  }))])) };
const photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-player-participations-'));
  const path = join(directory, 'accounts.sqlite');
  let now = Date.parse('2026-11-22T12:00:00.000Z'), accounts = new AccountsService({ path, now: () => now }), app;
  const friendlyPath = join(directory, 'friendly.json');
  let friendly = new FriendlyGamesService(friendlyPath);
  const priorAdmin = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID, priorReviewer = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  const input = email => ({ email, displayName: 'Cuenta ficticia', password: 'Frase de pruebas aisladas 123' });
  const owner = await accounts.register(input('owner@example.test'), 'owner');
  const player = await accounts.register(input('player@example.test'), 'player');
  const second = await accounts.login({ email: player.account.email, password: input('').password }, 'device-two');
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = owner.account.id;
  process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = owner.account.id;
  accounts.submitIdentity(player.token, { expectedAccountId: player.account.id, expectedRevision: 0, requestId: randomUUID(),
    identification: 'V-12345678', fullName: 'Jugador ficticio verificado', birthDate: '1990-01-02',
    documentPhoto: photo, personalPhoto: photo, consent: true });
  accounts.reviewIdentity(owner.token, { expectedAccountId: owner.account.id, accountId: player.account.id,
    expectedRevision: 1, decision: 'verified', reason: 'Verificación exclusivamente ficticia', documentsMatch: true });
  const official = exampleStatisticsGames('player'), before = JSON.stringify(official);
  const scoring = { personalStatistics: () => official };
  const controller = () => new SportsSheetController(accounts, scoring, friendly);
  const request = token => ({ headers: { cookie: `playsport-account=${token}` } });
  const trial = (planId, milliseconds) => accounts.changeTrial(owner.token, { requestId: randomUUID(), expectedAdminId: owner.account.id,
    accountId: player.account.id, planId, expectedRevision: 0, action: 'grant', reason: 'Prueba de participación aislada',
    expiresAt: new Date(now + milliseconds).toISOString() });
  t.after(async () => {
    if (app) await app.close(); else accounts.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
    if (priorAdmin === undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = priorAdmin;
    if (priorReviewer === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID; else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = priorReviewer;
  });
  return { owner, player, second, trial, before, official, request, controller, accounts: () => accounts, friendly: () => friendly,
    ownerId: `account:${owner.account.id}`, advance(ms) { now += ms; },
    reopen() { accounts.onModuleDestroy(); accounts = new AccountsService({ path, now: () => now }); friendly = new FriendlyGamesService(friendlyPath); },
    async server() {
      app = await NestFactory.create({ module: class ParticipationModule {}, controllers: [AccountsController, SportsSheetController, FriendlyGamesController],
        providers: [{ provide: AccountsService, useValue: accounts }, { provide: OfficialScoringService, useValue: scoring },
          { provide: FriendlyGamesService, useValue: friendly }, { provide: RegistrationService, useValue: {} }] }, { logger: false });
      await app.listen(0, '127.0.0.1'); return app.getUrl();
    } };
}
function recordedGames(e) {
  let game = e.friendly().create(e.ownerId, setup);
  const update = operation => { game = e.friendly().update(e.ownerId, game.id, { expectedRevision: game.revision, ...operation }); };
  update({ command: { kind: 'play', result: 'single', destinations: minimumDestinations(game.state, 'single') } });
  update({ command: { kind: 'finish' } });
  const commands = JSON.stringify(game.commands);
  update({ participantIdentity: { side: 'away', playerId: game.seed.rosters.away[0].id, identification: 'v  -  00012345678' } });
  assert.equal(game.state.finished, true); assert.equal(JSON.stringify(game.commands), commands);
  const seed = { ...game.seed, friendly: undefined, names: { home: 'Privados locales', away: 'Privados visitantes' } };
  const save = { version: 1, seed, commands: [{ kind: 'play', result: 'double',
    destinations: minimumDestinations(replayPrivate(seed, []), 'double') }, { kind: 'finish' }] };
  e.accounts().savePrivateScorecard(e.owner.token, { scope: 'separate-private-game', expectedRevision: 0, save });
  e.accounts().savePrivateScorecard(e.owner.token, { scope: JSON.stringify(['friendly', game.id, 'away']), expectedRevision: 0, save });
  return { game, save };
}
test('all own identified participations are available without sharing private scorecards; totals stay separate and changes never double-count', async t => {
  const e = await fixture(t);
  const { game, save } = recordedGames(e);
  assert.throws(() => e.controller().statistics(e.request(e.player.token), {}), error => error.getStatus() === 403);
  e.trial('player-numbers', 20000);
  const value = e.controller().statistics(e.request(e.player.token), {});
  assert.equal(value.analysisAllowed, false); assert.equal(value.games.length, 6);
  assert.equal(readStatisticsSnapshot(value, e.player.account.id, 'player', 'official').games.length, 6);
  const ownFriendly = value.games.find(row => row.kind === 'friendly'), ownPrivate = value.games.find(row => row.kind === 'private');
  assert.equal(ownFriendly.line.batting.H, 1); assert.equal(ownFriendly.line.batting.TB, 1);
  assert.equal(ownPrivate.line.batting.H, 1); assert.equal(ownPrivate.line.batting.TB, 2);
  assert.equal(ownFriendly.public, false); assert.equal(ownPrivate.public, false);
  assert.doesNotMatch(JSON.stringify(value), /V-12345678|playerId|ownerId|documentPhoto|Privados locales.*identification/);
  assert.deepEqual(e.accounts().privateScorecards(e.player.token).scorecards, []);
  assert.deepEqual(e.friendly().list(`account:${e.player.account.id}`).games, []);
  assert.throws(() => e.friendly().report(`account:${e.player.account.id}`, game.id, true), error => error.getStatus() === 404);
  assert.throws(() => e.accounts().privateScorecardReport(e.player.token, 'separate-private-game'), error => error.getStatus() === 404);
  assert.equal(new Set(value.games.map(statisticsGroupKey)).size, 4);
  assert.throws(() => aggregateStatistics([ownFriendly, ownPrivate]), /No se mezclan/);
  const revised = { ...save, commands: [{ kind: 'play', result: 'triple',
    destinations: minimumDestinations(replayPrivate(save.seed, []), 'triple') }, { kind: 'finish' }] };
  e.accounts().savePrivateScorecard(e.owner.token, { scope: 'separate-private-game', expectedRevision: 1, save: revised });
  const next = e.controller().statistics(e.request(e.second.token), {});
  assert.equal(next.games.length, 6);
  assert.equal(next.games.find(row => row.kind === 'private').line.batting.TB, 3);
  assert.equal(aggregateStatistics(next.games.filter(row => row.kind === 'private')).batting.G, 1);
  assert.equal(JSON.stringify(e.official), e.before);
  e.trial('player', 10000);
  assert.equal(e.controller().statistics(e.request(e.player.token), {}).analysisAllowed, true);
  e.advance(10000); e.reopen();
  const restored = e.controller().statistics(e.request(e.second.token), {});
  assert.equal(restored.analysisAllowed, false); assert.equal(restored.games.length, 6);
  assert.equal(restored.games.find(row => row.kind === 'private').version, 2);
  e.advance(10000);
  assert.throws(() => e.controller().statistics(e.request(e.player.token), {}), error => error.getStatus() === 403);
});
test('HTTP keeps identity server-owned, denies private documents and unauthorized linking, and rejects analysis for level two', async t => {
  const e = await fixture(t), { game } = recordedGames(e);
  e.trial('player-numbers', 20000);
  const base = await e.server();
  const headers = token => ({ cookie: `playsport-account=${token}`, origin: 'http://localhost:3000', 'Content-Type': 'application/json' });
  const url = `${base}/sports-sheet/statistics`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: headers(e.player.token) });
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal((await response.json()).games.length, 6);
  for (const query of ['accountId=other', 'identification=V-12345678', 'analysisAllowed=true'])
    assert.equal((await fetch(`${url}?${query}`, { headers: headers(e.player.token) })).status, 400);
  assert.equal((await fetch(`${url}?group=`, { headers: headers(e.player.token) })).status, 403);
  assert.equal((await fetch(`${base}/accounts/scorecards/report?scope=separate-private-game`, { headers: headers(e.player.token) })).status, 404);
  assert.equal((await fetch(`${base}/friendly-games/${game.id}/final-report`, { headers: headers(e.player.token) })).status, 404);
  const body = JSON.stringify({ expectedRevision: game.revision, participantIdentity: {
    side: 'away', playerId: game.seed.rosters.away[0].id, identification: '' } });
  assert.equal((await fetch(`${base}/friendly-games/${game.id}/updates`, { method: 'POST', headers: headers(e.player.token), body })).status, 403);
  assert.equal((await fetch(`${base}/friendly-games/${game.id}/updates`, { method: 'POST',
    headers: { ...headers(e.owner.token), origin: 'https://other.invalid' }, body })).status, 403);
  assert.equal((await fetch(`${base}/friendly-games/${game.id}/updates`, { method: 'POST', headers: headers(e.owner.token), body })).status, 201);
  assert.equal((await (await fetch(url, { headers: headers(e.player.token) })).json()).games.filter(row => row.kind === 'friendly').length, 0);
});
test('a name or unused substitute never establishes participation; identity validation and explicit unlinking preserve scoring', async t => {
  const e = await fixture(t);
  const game = e.friendly().create(e.ownerId, { ...setup, substitutes: { home: [], away: ['Nombre repetido'] } });
  assert.deepEqual(e.friendly().personalStatistics('V-12345678'), []);
  const bench = game.seed.rosters.away.at(-1);
  const linked = linkScorecardParticipant(game.seed, { side: 'away', playerId: bench.id, identification: 'V-12345678' });
  assert.deepEqual(personalScorecardStatistics(replayPrivate(linked, []), 'V-12345678', {
    kind: 'friendly', gameId: game.id, tournamentId: 'friendly', tournamentName: 'Prueba', version: 1 }), []);
  assert.throws(() => linkScorecardParticipant(linked, { side: 'home', playerId: game.seed.rosters.home[0].id, identification: 'V-12345678' }), /ya está vinculada/);
  assert.throws(() => linkScorecardParticipant(linked, { side: 'away', playerId: 'missing', identification: 'V-12345678' }), /no pertenece/);
  assert.throws(() => linkScorecardParticipant(linked, { side: 'away', playerId: bench.id, identification: 'invented' }), /cédula/);
  const invalid = structuredClone(linked); invalid.rosters.away[0].identification = 'V-12345678';
  assert.throws(() => readPrivateSave(JSON.stringify({ version: 1, seed: invalid, commands: [] })));
  const legacy = structuredClone(game.seed);
  legacy.rosters.away[0].id = legacy.lineups.away[0].id = 'V-12345678';
  const mixed = structuredClone(legacy);
  mixed.rosters.home[0].identification = mixed.lineups.home[0].identification = 'V-12345678';
  assert.throws(() => readPrivateSave(JSON.stringify({ version: 1, seed: mixed, commands: [] })));
  const divergent = structuredClone(linked);
  divergent.lineups.away[0].identification = 'V-87654321';
  assert.throws(() => readPrivateSave(JSON.stringify({ version: 1, seed: divergent, commands: [] })));
  const disabled = linkScorecardParticipant(legacy, { side: 'away', playerId: 'V-12345678', identification: '' });
  assert.doesNotThrow(() => readPrivateSave(JSON.stringify({ version: 1, seed: disabled, commands: [] })));
  assert.deepEqual(personalScorecardStatistics(replayPrivate(disabled, []), 'V-12345678', {
    kind: 'private', gameId: 'private', tournamentId: 'private', tournamentName: 'Prueba', version: 1 }), []);
  legacy.rosters.home[0].id = legacy.lineups.home[0].id = 'V00012345678';
  const ambiguous = personalScorecardStatistics(replayPrivate(legacy, []), 'V-12345678', {
    kind: 'private', gameId: 'private', tournamentId: 'private', tournamentName: 'Prueba', version: 1 });
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].teamId, 'unresolved');
  assert.ok(ambiguous.every(row => row.line === null && /varios participantes/.test(row.reason)));
});
test('canonical copies across creators count once and discrepant copies explicitly withhold numbers rather than selecting incomparable revisions', async t => {
  const e = await fixture(t);
  const { save } = recordedGames(e);
  const other = await e.accounts().register({ email: 'other@example.test', displayName: 'Otro creador ficticio',
    password: 'Otra frase de pruebas 123' }, 'other');
  const scope = JSON.stringify(['private-event', 'same-game', 'away']);
  e.accounts().savePrivateScorecard(e.owner.token, { scope, expectedRevision: 0, save });
  e.accounts().savePrivateScorecard(other.token, { scope, expectedRevision: 0, save });
  const rows = e.accounts().personalPrivateStatistics('V-12345678', []);
  assert.equal(rows.length, 3);
  assert.equal(aggregateStatistics(rows).batting.G, 3);
  const single = rows.find(row => row.gameId !== rows[0].gameId && row.line?.batting.TB === 2);
  assert.ok(single);
  const changed = { ...save, commands: [{ kind: 'play', result: 'triple',
    destinations: minimumDestinations(replayPrivate(save.seed, []), 'triple') }, { kind: 'finish' }] };
  e.accounts().savePrivateScorecard(other.token, { scope, expectedRevision: 1, save: changed });
  const corrected = e.accounts().personalPrivateStatistics('V-12345678', []);
  assert.equal(corrected.length, 3);
  const excluded = corrected.find(row => row.qualification === 'excluded');
  assert.equal(excluded.line, null); assert.match(excluded.reason, /copias privadas discrepantes/);
  assert.equal(aggregateStatistics(corrected).batting.G, 2);
});
