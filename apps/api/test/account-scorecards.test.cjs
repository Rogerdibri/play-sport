const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { AccountsController } = require('../src/modules/accounts/accounts.controller');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { accountWebOrigins, assertAccountOrigin } = require('../src/modules/accounts/account-http');
const { AccountScorecardClient, FriendlyClient, replayPrivate } = require('@playsport/shared');

const players = side => Array.from({ length: 9 }, (_, index) => ({
  id: `${side}-${index}`, name: `Participante ${side} ${index + 1}`, jersey: String(index + 1),
  position: ['P','C','1B','2B','3B','SS','LF','CF','RF'][index], order: index + 1
}));
const lineups = { home: players('home'), away: players('away') };
const save = { version: 1, seed: { names: { home: 'Locales', away: 'Visitantes' },
  rosters: lineups, lineups, courtesyRunnerSource: 'ROSTER', regulationInnings: 9 }, commands: [] };
const registration = email => ({ email, displayName: 'Cuenta de prueba', password: 'Frase ficticia segura 123' });

test('private scorecards persist by account across independent sessions, reject stale writes and never expose another owner', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-account-scorecards-'));
  const path = join(directory, 'accounts.sqlite');
  let accounts = new AccountsService({ path });
  t.after(() => { accounts.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); });
  const a = await accounts.register(registration('a@example.test'), 'a');
  const b = await accounts.register(registration('b@example.test'), 'b');
  const other = await accounts.login({ email: a.account.email, password: registration('').password }, 'device-2');
  const scope = JSON.stringify(['tournament', 'game', 'team']);
  const call = (token, revision, document = save) => accounts.savePrivateScorecard(token, { scope, expectedRevision: revision, save: document });
  assert.throws(() => accounts.privateScorecards(undefined), error => error.getStatus() === 401);
  const first = call(a.token, 0);
  assert.equal(first.revision, 1);
  assert.deepEqual(accounts.privateScorecards(other.token, scope).scorecards, [first]);
  assert.deepEqual(accounts.privateScorecards(b.token).scorecards, []);
  const next = call(other.token, 1, { ...save, commands: [{ kind: 'pitch', value: 'ball' }] });
  assert.equal(next.revision, 2);
  assert.throws(() => call(a.token, 1), error => error.getStatus() === 409);
  assert.throws(() => call(a.token, 2, { ...save, commands: [{ kind: 'invented' }] }), error => error.getStatus() === 400);
  assert.deepEqual(accounts.privateScorecards(a.token, scope).scorecards, [next]);
  accounts.onModuleDestroy();
  accounts = new AccountsService({ path });
  assert.deepEqual(accounts.privateScorecards(other.token).scorecards, [next]);
  assert.equal(replayPrivate(next.save.seed, next.save.commands).balls, 1);
  const separate = call(b.token, 0);
  assert.equal(separate.revision, 1);
  assert.equal(accounts.privateScorecards(a.token).scorecards[0].revision, 2);
});

test('private HTTP endpoints require the account cookie and a trusted origin, ignoring forged account identity', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-private-http-'));
  const accounts = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  const a = await accounts.register(registration('http@example.test'), 'a');
  const app = await NestFactory.create({ module: class PrivateModule {}, controllers: [AccountsController],
    providers: [{ provide: AccountsService, useValue: accounts }] }, { logger: false });
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const url = `${await app.getUrl()}/accounts/scorecards`;
  assert.equal((await fetch(url)).status, 401);
  const headers = { Cookie: `playsport-account=${a.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
  const body = JSON.stringify({ scope: 'private-test', expectedRevision: 0, save, accountId: 'other-account' });
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body })).status, 403);
  const response = await fetch(url, { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).revision, 1);
  assert.equal((await (await fetch(url, { headers })).json()).scorecards.length, 1);
  const report = await fetch(`${url}/report?scope=private-test`, { headers });
  assert.equal(report.status, 200); assert.match(report.headers.get('cache-control'), /no-store/);
  assert.equal((await report.json()).detailed, false);
  assert.equal((await fetch(`${url}/report?scope=private-test`)).status, 401);
  assert.equal((await fetch(`${url}/report?scope=missing`, { headers })).status, 404);
  assert.equal((await fetch(`${url}/report?scope=private-test&accountId=other`, { headers })).status, 400);
});

test('shared private and friendly clients send cookies and no role-specific bearer or local access creation', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(url.includes('friendly-games') ? { games: [] } : { scorecards: [] }));
  });
  assert.deepEqual(await new FriendlyClient('/api').list(), []);
  assert.deepEqual(await new AccountScorecardClient().list('scope'), []);
  for (const { options } of requests) {
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(new Headers(options.headers).has('authorization'), false);
  }
  assert.equal(requests.some(row => row.url.includes('registration/access')), false);
});

test('CORS and account mutations share an explicit allowlist; arbitrary origins and non-HTTPS production origins remain rejected', t => {
  const names = ['PLAYSPORT_WEB_ORIGIN', 'PLAYSPORT_ADDITIONAL_WEB_ORIGINS', 'NODE_ENV'];
  const previous = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => previous[index] === undefined ? delete process.env[name] : process.env[name] = previous[index]));
  process.env.PLAYSPORT_WEB_ORIGIN = 'http://localhost:3000';
  process.env.PLAYSPORT_ADDITIONAL_WEB_ORIGINS = 'http://192.0.2.10:3000';
  process.env.NODE_ENV = 'test';
  assert.deepEqual(accountWebOrigins(), ['http://localhost:3000', 'http://192.0.2.10:3000']);
  assert.doesNotThrow(() => assertAccountOrigin({ headers: { origin: 'http://192.0.2.10:3000' } }));
  assert.throws(() => assertAccountOrigin({ headers: { origin: 'http://localhost:8083' } }), error => error.getStatus() === 403);
  process.env.NODE_ENV = 'production';
  assert.throws(() => accountWebOrigins(), /HTTPS/);
});
