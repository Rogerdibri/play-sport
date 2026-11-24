const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Module, NotFoundException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { GameChatService } = require('../src/modules/game-chat/game-chat.service');
const { GameChatController } = require('../src/modules/game-chat/game-chat.controller');
const { gameChatFinalWindowMs, readGameChat } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-chat-'));
  let now = Date.UTC(2026, 10, 8, 19), context = { status: 'in_progress', finishedAt: null };
  const accounts = new AccountsService({ path: join(directory, 'accounts.sqlite'), now: () => now });
  const source = { getGameChatContext(id) {
    if (!['game', 'other'].includes(id)) throw new NotFoundException('Partido no disponible');
    return { ...context };
  } };
  const options = { path: join(directory, 'chat.sqlite'), now: () => now };
  let chat = new GameChatService(accounts, source, options);
  t.after(() => { chat.onModuleDestroy(); accounts.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); });
  const users = await Promise.all(['alice', 'bob'].map(name =>
    accounts.register({ email: `${name}@example.test`, displayName: `Cuenta ${name}`, password: 'Frase ficticia del chat para pruebas 123' }, name)));
  return { get chat() { return chat; }, accounts, source, path: options.path, users,
    clock(ms) { now += ms; }, now() { return now; }, context(value) { context = value; },
    reopen() { chat.onModuleDestroy(); chat = new GameChatService(accounts, source, options); } };
}

test('chat uses authenticated account identity, exposes no private account fields and cannot create or substitute a game', async t => {
  const e = await setup(t), [alice] = e.users;
  assert.equal(e.chat.read('game').viewer, null);
  bad(() => e.chat.perform('game', undefined, { kind: 'message', text: 'Hola' }), 401);
  bad(() => e.chat.read('unknown'), 404);
  for (const fields of [{ authorId: 'scorer-demo' }, { role: 'organizer' }, { credits: 100 }, { gameId: 'other' }]) {
    bad(() => e.chat.perform('game', alice.token, { kind: 'message', text: 'Hola', ...fields }), 400);
  }
  const result = e.chat.perform('game', alice.token, { kind: 'message', text: 'Hola desde una cuenta' });
  assert.equal(result.chat.messages[0].author.id, alice.account.id);
  assert.doesNotThrow(() => readGameChat(result.chat));
  assert.doesNotMatch(JSON.stringify(result), /email|password|identificationNumber|token|@example/);
  e.accounts.logout(alice.token);
  const expired = e.chat.read('game', alice.token);
  assert.equal(expired.sessionExpired, true); assert.equal(expired.viewer, null);
  assert.equal(expired.messages.length, 1);
  bad(() => e.chat.perform('game', alice.token, { kind: 'message', text: 'Sesión revocada' }), 401);
});

test('server accepts the final millisecond of the 30-minute window and rejects the exact cutoff without shifting it on later reads', async t => {
  const e = await setup(t), [alice] = e.users, finishedAt = new Date(e.now()).toISOString();
  e.context({ status: 'final', finishedAt });
  const initial = e.chat.read('game', alice.token);
  assert.equal(initial.window, 'postgame');
  e.clock(gameChatFinalWindowMs - 1);
  const last = e.chat.perform('game', alice.token, { kind: 'message', text: 'Último comentario válido' });
  assert.equal(last.chat.window, 'postgame');
  assert.equal(last.chat.closesAt, initial.closesAt);
  e.clock(1);
  bad(() => e.chat.perform('game', alice.token, { kind: 'message', text: 'Ya cerró' }), 409);
  assert.equal(e.chat.read('game').window, 'closed');
  e.reopen(); e.context({ status: 'final', finishedAt: null });
  assert.equal(e.chat.read('game').closesAt, initial.closesAt);
  assert.equal(e.chat.read('game').messages.length, 1);
  e.clock(60000);
  assert.equal(e.chat.read('game').window, 'closed');
});

test('scheduled games, suspensions, protests and historical final games do not admit comments; a retracted finish follows the actual game state', async t => {
  const e = await setup(t), [alice] = e.users;
  for (const status of ['scheduled', 'suspended', 'protested', 'final']) {
    e.context({ status, finishedAt: null });
    bad(() => e.chat.perform('game', alice.token, { kind: 'message', text: 'No debería guardarse' }), 409);
    assert.equal(e.chat.read('game').messages.length, 0);
  }
  e.context({ status: 'final', finishedAt: new Date(e.now()).toISOString() });
  assert.equal(e.chat.read('game').window, 'postgame');
  e.context({ status: 'in_progress', finishedAt: null });
  assert.equal(e.chat.read('game').window, 'live');
  e.clock(60000);
  e.context({ status: 'final', finishedAt: new Date(e.now()).toISOString() });
  assert.equal(Date.parse(e.chat.read('game').closesAt), e.now() + gameChatFinalWindowMs);
});

test('comments enforce Unicode character count, duplicate protection and durable account-wide rate limits across different games', async t => {
  const e = await setup(t), [alice] = e.users, send = text => e.chat.perform('game', alice.token, { kind: 'message', text });
  for (const text of ['', '   ', 'x'.repeat(301), 'Texto\u0000']) bad(() => send(text), 400);
  send('😀'.repeat(300));
  bad(() => send('Otro comentario'), 429);
  e.clock(3000); send('Buen partido');
  e.clock(3000);
  bad(() => e.chat.perform('other', alice.token, { kind: 'message', text: ' BUEN   PARTIDO ' }), 429);
  for (let i = 0; i < 3; i++) { send(`Comentario ${i}`); e.clock(3000); }
  e.reopen();
  bad(() => e.chat.perform('other', alice.token, { kind: 'message', text: 'Sexto mensaje' }), 429);
  e.clock(60000); send('Buen partido');
});

test('mute preferences and reports persist, affect only the requesting account and validate the selected game', async t => {
  const e = await setup(t), [alice, bob] = e.users;
  const message = e.chat.perform('game', bob.token, { kind: 'message', text: '<script>texto público, no HTML</script>' }).chat.messages[0];
  e.clock(3000); e.chat.perform('other', bob.token, { kind: 'message', text: 'Otro partido' });
  bad(() => e.chat.perform('other', alice.token, { kind: 'report', messageId: message.id, reason: 'spam' }), 404);
  bad(() => e.chat.perform('game', alice.token, { kind: 'report', messageId: message.id, reason: 'inventado' }), 400);
  for (let i = 0; i < 2; i++) e.chat.perform('game', alice.token, { kind: 'report', messageId: message.id, reason: 'abuse' });
  e.chat.perform('game', alice.token, { kind: 'mute', authorId: bob.account.id, muted: true });
  e.reopen();
  assert.equal(e.chat.read('game', alice.token).messages.length, 0);
  assert.equal(e.chat.read('other', alice.token).messages.length, 1);
  assert.equal(e.chat.read('game', bob.token).messages.length, 1);
  assert.equal(e.chat.read('game').messages.length, 1);
  const db = new DatabaseSync(e.path, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_reports').get().count, 1); }
  finally { db.close(); }
  e.chat.perform('game', alice.token, { kind: 'mute', authorId: bob.account.id, muted: false });
  assert.equal(e.chat.read('game', alice.token).messages.length, 1);
});

test('bounded chronological pagination and incremental updates preserve all messages and never mix games', async t => {
  const e = await setup(t), [alice] = e.users;
  for (let i = 0; i < 110; i++) {
    e.chat.perform('game', alice.token, { kind: 'message', text: `Comentario ${i}` });
    e.clock(7000);
  }
  const latest = e.chat.read('game');
  assert.equal(latest.messages.length, 50); assert.equal(latest.hasOlder, true);
  assert.equal(latest.messages[0].text, 'Comentario 60');
  const older = e.chat.read('game', undefined, latest.messages[0].id);
  assert.equal(older.messages[0].text, 'Comentario 10');
  assert.equal(older.hasOlder, true);
  const first = e.chat.read('game', undefined, older.messages[0].id);
  assert.equal(first.messages.length, 10); assert.equal(first.hasOlder, false);
  const incremental = e.chat.read('game', undefined, undefined, first.messages.at(-1).id);
  assert.equal(incremental.messages[0].text, 'Comentario 10');
  assert.equal(incremental.messages.length, 50);
  assert.equal(e.chat.read('other').messages.length, 0);
  for (const cursor of [0, -1, NaN, 1.5]) bad(() => e.chat.read('game', undefined, cursor), 400);
  bad(() => e.chat.read('game', undefined, 10, 20), 400);
});

test('official finish records its own timestamp, result corrections do not extend it and reading chat does not mutate scoring state', () => {
  const games = new OfficialScoringService();
  games.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['scorer'], scorekeeperIdentities: [{ actorId: 'scorer', identificationNumber: 'SCORER0001' }] });
  for (const teamId of ['home', 'away']) {
    const ids = Array.from({ length: 9 }, (_, index) => `${teamId.toUpperCase()}${index}`);
    for (const id of ids) games.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: id, displayName: `Jugador ${id}` } });
    games.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
  }
  games.configureGameTeams({ tournamentId: 'tour', gameId: 'game', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  games.configureGameAuthorization({ tournamentId: 'tour', gameId: 'game', organizerId: 'org', scorekeeperIds: ['scorer'] });
  const get = () => structuredClone(games.getOfficialState('game', 'tour'));
  const send = patch => games.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: get().state.officialVersion, patch });
  const before = get();
  assert.deepEqual(games.getGameChatContext('game'), { status: 'scheduled', finishedAt: null });
  assert.deepEqual(get(), before);
  const count = games.games.size;
  bad(() => games.getGameChatContext('unknown'), 404);
  assert.equal(games.games.size, count);
  send({ status: 'final', homeScore: 2, awayScore: 1 });
  const finished = games.getGameChatContext('game').finishedAt;
  assert.ok(finished);
  send({ homeScore: 3 });
  assert.equal(games.getGameChatContext('game').finishedAt, finished);
  games.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: get().state.officialVersion, patch: {}, undoLast: true });
  assert.equal(games.getGameChatContext('game').finishedAt, finished);
  games.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    expectedOfficialVersion: get().state.officialVersion, patch: {}, undoLast: true });
  assert.deepEqual(games.getGameChatContext('game'), { status: 'scheduled', finishedAt: null });
  send({ status: 'in_progress' });
  games.declareGameProtest({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer', actorRole: 'scorekeeper',
    expectedOfficialVersion: get().state.officialVersion, teamId: 'home', reason: 'Motivo ficticio de prueba' });
  games.resolveGameProtest({ gameId: 'game', tournamentId: 'tour', organizerId: 'org',
    expectedOfficialVersion: get().state.officialVersion, winnerTeamId: 'home', reason: 'Decisión ficticia de prueba', recordReference: 'ACTA-PRUEBA' });
  assert.equal(games.getGameChatContext('game').status, 'final');
  assert.ok(games.getGameChatContext('game').finishedAt);
});

test('HTTP writes reject cross-origin requests and forged identities while public reads remain available', async t => {
  const e = await setup(t), [alice] = e.users;
  class TestModule {}
  Module({ controllers: [GameChatController], providers: [{ provide: GameChatService, useValue: {
    read: (...args) => e.chat.read(...args), perform: (...args) => e.chat.perform(...args)
  } }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl(), url = `${base}/game-chat/game`;
  const post = (origin, cookie, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
    ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await post('https://otro.example', `playsport-account=${alice.token}`, { kind: 'message', text: 'Hola' })).status, 403);
  assert.equal((await post(undefined, `playsport-account=${alice.token}`, { kind: 'message', text: 'Hola' })).status, 403);
  assert.equal((await post('http://localhost:3000', 'playsport-account=forged', { kind: 'message', text: 'Hola' })).status, 401);
  assert.equal((await post('http://localhost:3000', `playsport-account=${alice.token}; playsport-account=another`, { kind: 'message', text: 'Hola' })).status, 403);
  const response = await post('http://localhost:3000', `playsport-account=${alice.token}`, { kind: 'message', text: 'Hola desde HTTP' });
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).chat.messages[0].author.id, alice.account.id);
});
