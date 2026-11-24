const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, statSync, readFileSync, existsSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { AccountsController } = require('../src/modules/accounts/accounts.controller');
const { readAccountProfile } = require('@playsport/shared');

const registration = (email = 'cuenta@example.test') => ({
  email, displayName: 'Cuenta ficticia', password: 'Una frase ficticia para pruebas 123'
});
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const rejects = (fn, status) => assert.rejects(fn, error => error.getStatus?.() === status);
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-accounts-'));
  const path = join(directory, 'accounts.sqlite');
  let now = Date.now();
  let service = new AccountsService({ path, now: () => now });
  t.after(() => { service.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); });
  return { path, service, clock(value) { now += value; }, reopen() {
    service.onModuleDestroy(); service = new AccountsService({ path, now: () => now }); return service;
  } };
}

test('registration creates only a basic unverified account, persists hashes and never returns passwords or tokens in its profile', async t => {
  const e = setup(t), input = registration(' Cuenta@Example.Test ');
  const result = await e.service.register(input, 'local');
  assert.equal(result.account.email, 'cuenta@example.test');
  assert.equal(result.account.emailVerified, false);
  assert.equal(result.account.identityVerification, 'unavailable');
  assert.equal(result.account.financialAccess, false);
  assert.doesNotThrow(() => readAccountProfile(result.account));
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  const db = new DatabaseSync(e.path, { readOnly: true });
  try {
    const account = db.prepare('SELECT * FROM accounts').get();
    const session = db.prepare('SELECT * FROM account_sessions').get();
    assert.match(account.password_hash, /^scrypt-v1\$/);
    assert.notEqual(account.password_hash, input.password);
    assert.equal(session.token_hash, createHash('sha256').update(result.token).digest('hex'));
    assert.notEqual(session.token_hash, result.token);
  } finally { db.close(); }
  assert.equal(statSync(e.path).mode & 0o777, 0o600);
  for (const file of [e.path, `${e.path}-wal`]) if (existsSync(file)) {
    const bytes = readFileSync(file);
    assert.equal(bytes.includes(input.password), false);
    assert.equal(bytes.includes(result.token), false);
  }
  const restored = e.reopen();
  assert.deepEqual(restored.authenticate(result.token), result.account);
  const again = await restored.login({ email: 'CUENTA@example.test', password: input.password }, 'local');
  assert.equal(again.account.id, result.account.id);
});

test('only the privately configured local tester retains its session after idle, absolute expiry and service restart; logout still revokes it', async t => {
  const e = setup(t), tester = await e.service.register(registration('tester@example.test'), 'tester');
  const normal = await e.service.register(registration('normal@example.test'), 'normal');
  const config = join(dirname(e.path), 'local-tester.json');
  writeFileSync(config, JSON.stringify({ version: 1, accountId: tester.account.id }), { mode: 0o600 });
  e.clock(31 * 24 * 60 * 60 * 1000);
  bad(() => e.service.authenticate(normal.token), 401);
  assert.equal(e.service.authenticate(tester.token).localTestAccess, true);
  e.clock(365 * 24 * 60 * 60 * 1000);
  await e.service.login({ email: normal.account.email, password: registration().password }, 'normal');
  const reopened = e.reopen();
  assert.equal(reopened.authenticate(tester.token).localTestAccess, true);
  assert.equal(reopened.authenticate(tester.token).financialAccess, false);
  assert.equal(reopened.authenticate(tester.token).identityVerification, 'unavailable');
  reopened.logout(tester.token);
  bad(() => reopened.authenticate(tester.token), 401);
  const login = await reopened.login({ email: tester.account.email, password: registration().password }, 'tester');
  assert.equal(login.account.localTestAccess, true);
  unlinkSync(config);
  e.clock(31 * 24 * 60 * 60 * 1000);
  bad(() => reopened.authenticate(login.token), 401);
});

test('local tester configuration never grants persistent access in production or for a non-loopback origin, and cannot be requested by account input', async t => {
  const e = setup(t), tester = await e.service.register(registration('tester@example.test'), 'tester');
  writeFileSync(join(dirname(e.path), 'local-tester.json'), JSON.stringify({ version: 1, accountId: tester.account.id }), { mode: 0o600 });
  await rejects(() => e.service.register({ ...registration('forged@example.test'), localTestAccess: true }, 'forged'), 400);
  const environment = { NODE_ENV: process.env.NODE_ENV, PLAYSPORT_WEB_ORIGIN: process.env.PLAYSPORT_WEB_ORIGIN };
  try {
    process.env.NODE_ENV = 'production';
    process.env.PLAYSPORT_WEB_ORIGIN = 'https://playsport.example.test';
    assert.equal(e.service.authenticate(tester.token).localTestAccess, undefined);
    e.clock(31 * 24 * 60 * 60 * 1000); bad(() => e.service.authenticate(tester.token), 401);
    process.env.NODE_ENV = 'development';
    process.env.PLAYSPORT_WEB_ORIGIN = 'http://playsport.example.test';
    bad(() => e.service.authenticate(tester.token), 401);
  } finally {
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('tester cookies stay HttpOnly and SameSite Strict, renew on me, and password changes continue revoking every old session', async t => {
  const e = setup(t), input = registration('tester@example.test'), tester = await e.service.register(input, 'tester');
  writeFileSync(join(dirname(e.path), 'local-tester.json'), JSON.stringify({ version: 1, accountId: tester.account.id }), { mode: 0o600 });
  const controller = new AccountsController(e.service), headers = new Map();
  const request = { headers: { origin: 'http://localhost:3000', cookie: `playsport-account=${tester.token}` }, socket: { remoteAddress: '127.0.0.1' } };
  const response = { setHeader: (key, value) => headers.set(key, value) };
  const profile = controller.me(request, response);
  assert.equal(profile.account.localTestAccess, true);
  assert.match(headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict; Max-Age=34560000/);
  assert.doesNotMatch(JSON.stringify(profile), /token|password_hash/);
  const changed = await e.service.changePassword(tester.token, { currentPassword: input.password, newPassword: 'Otra frase ficticia para pruebas 456' });
  bad(() => e.service.authenticate(tester.token), 401);
  assert.equal(changed.account.localTestAccess, true);
  e.service.logout(changed.token);
  bad(() => e.service.authenticate(changed.token), 401);
});

test('invalid private tester configurations surface an error rather than granting access', async t => {
  const e = setup(t), tester = await e.service.register(registration(), 'tester');
  const config = join(dirname(e.path), 'local-tester.json');
  for (const value of [{ version: 2, accountId: tester.account.id }, { version: 1, accountId: 'not-an-account' }]) {
    writeFileSync(config, JSON.stringify(value));
    assert.throws(() => e.service.authenticate(tester.token), /configuración privada/);
  }
});

test('logout or expiry during password hashing prevents password updates and cannot recreate a revoked session', async t => {
  const e = setup(t);
  for (const reason of ['logout', 'expiry']) {
    const input = registration(`${reason}@example.test`);
    const registered = await e.service.register(input, reason);
    const pending = e.service.changePassword(registered.token, {
      currentPassword: input.password, newPassword: 'Una nueva frase ficticia de prueba 456'
    });
    if (reason === 'logout') e.service.logout(registered.token);
    else e.clock(30 * 24 * 60 * 60 * 1000);
    await rejects(() => pending, 401);
    bad(() => e.service.authenticate(registered.token), 401);
    const login = await e.service.login({ email: input.email, password: input.password }, reason);
    assert.equal(login.account.id, registered.account.id);
  }
});

test('emails are unique, simultaneous registrations cannot create duplicates, and salts differ across accounts', async t => {
  const e = setup(t);
  const results = await Promise.allSettled([e.service.register(registration(), 'one'), e.service.register(registration(), 'two')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.getStatus(), 409);
  await rejects(() => e.service.register(registration('CUENTA@example.test'), 'three'), 409);
  await e.service.register(registration('otra@example.test'), 'four');
  const db = new DatabaseSync(e.path, { readOnly: true });
  try {
    const hashes = db.prepare('SELECT password_hash FROM accounts').all();
    assert.equal(new Set(hashes.map(row => row.password_hash)).size, 2);
  } finally { db.close(); }
});

test('registration rejects short credentials, invalid data and attempts to grant roles, identity or financial access', async t => {
  const e = setup(t);
  for (const patch of [{ password: 'corta' }, { password: 'x'.repeat(129) }, { password: 'válida suficientemente larga\u0000' },
    { email: 'invalid' }, { email: 'correo\u0000@example.test' }, { displayName: '' }, { role: 'organizer' }, { emailVerified: true }, { financialAccess: true }, { id: 'mgr-A' },
    { documentImage: 'document' }, { selfie: 'face' }]) {
    await rejects(() => e.service.register({ ...registration(), ...patch }, JSON.stringify(Object.keys(patch))), 400);
  }
  bad(() => e.service.authenticate(undefined), 401);
  bad(() => e.service.authenticate('forged'), 401);
});

test('login uses the same error for unknown accounts and wrong passwords and no caller can select another identity', async t => {
  const e = setup(t), input = registration();
  const first = await e.service.register(input, 'one'), second = await e.service.register(registration('otra@example.test'), 'two');
  for (const email of [input.email, 'missing@example.test']) {
    await assert.rejects(() => e.service.login({ email, password: 'una contraseña incorrecta' }, 'local'),
      error => error.getStatus() === 401 && error.message === 'El correo o la contraseña son incorrectos.');
  }
  await rejects(() => e.service.login({ email: input.email, password: input.password, accountId: second.account.id }, 'local'), 400);
  assert.equal(e.service.authenticate(first.token).id, first.account.id);
  assert.equal(e.service.authenticate(second.token).id, second.account.id);
});

test('logout is idempotent, sessions expire by idle time and absolute time, and password changes revoke all previous sessions', async t => {
  const e = setup(t), input = registration();
  const one = await e.service.register(input, 'one'), two = await e.service.login({ email: input.email, password: input.password }, 'two');
  await rejects(() => e.service.changePassword(one.token, { currentPassword: 'equivocada', newPassword: 'Otra frase para la cuenta 456' }), 400);
  assert.equal(e.service.authenticate(one.token).id, one.account.id);
  const changed = await e.service.changePassword(one.token, { currentPassword: input.password, newPassword: 'Otra frase para la cuenta 456' });
  bad(() => e.service.authenticate(one.token), 401); bad(() => e.service.authenticate(two.token), 401);
  assert.equal(e.service.authenticate(changed.token).id, one.account.id);
  await rejects(() => e.service.login({ email: input.email, password: input.password }, 'three'), 401);
  const next = await e.service.login({ email: input.email, password: 'Otra frase para la cuenta 456' }, 'four');
  e.clock(30 * 24 * 60 * 60 * 1000); bad(() => e.service.authenticate(next.token), 401);
  const active = await e.service.login({ email: input.email, password: 'Otra frase para la cuenta 456' }, 'five');
  for (let index = 0; index < 13; index++) { e.clock(29 * 24 * 60 * 60 * 1000); e.service.authenticate(active.token); }
  e.clock(29 * 24 * 60 * 60 * 1000); bad(() => e.service.authenticate(active.token), 401);
  const last = await e.service.login({ email: input.email, password: 'Otra frase para la cuenta 456' }, 'six');
  e.service.logout(last.token); e.service.logout(last.token);
  bad(() => e.service.authenticate(last.token), 401);
});

test('new passwords need 8 to 128 characters with an uppercase letter, a number and a special character', async t => {
  const e = setup(t);
  for (const password of ['Ab1!xyz', 'abcdef1!', 'Abcdefg!', 'Abcdefg1', 'ABCDEFGH', `A1!${'x'.repeat(126)}`])
    await rejects(() => e.service.register({ ...registration(`r${password.length}${password[1]}@example.test`), password }, `policy-${password}`), 400);
  for (const [index, password] of ['Abcdef1!', 'Clave 2026', 'Ñandú-7x', `A1!${'x'.repeat(125)}`].entries())
    assert.equal((await e.service.register({ ...registration(`ok${index}@example.test`), password }, `ok-${index}`)).account.email, `ok${index}@example.test`);
  const login = await e.service.login({ email: 'ok0@example.test', password: 'Abcdef1!' }, 'login');
  await rejects(() => e.service.changePassword(login.token, { currentPassword: 'Abcdef1!', newPassword: 'sinmayuscula1!' }), 400);
  await e.service.changePassword(login.token, { currentPassword: 'Abcdef1!', newPassword: 'Nueva#2026' });
});

test('rate limits persist after restart and recover after the window instead of trusting browser state', async t => {
  const e = setup(t);
  for (let count = 0; count < 10; count++) await rejects(() =>
    e.service.login({ email: 'missing@example.test', password: 'contraseña inexistente' }, 'local'), 401);
  await rejects(() => e.reopen().login({ email: 'missing@example.test', password: 'contraseña inexistente' }, 'local'), 429);
  e.clock(15 * 60 * 1000);
  await rejects(() => e.reopen().login({ email: 'missing@example.test', password: 'contraseña inexistente' }, 'local'), 401);
});

test('password reset links are single-use, expire in 30 minutes, replace older links and revoke every session', async t => {
  const e = setup(t), input = registration();
  const registered = await e.service.register(input, 'one');
  assert.equal(e.service.requestPasswordReset({ email: 'missing@example.test' }, 'ip'), null);
  const first = e.service.requestPasswordReset({ email: ' CUENTA@example.test ' }, 'ip');
  assert.equal(first.email, input.email); assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  const second = e.service.requestPasswordReset({ email: input.email }, 'ip');
  const nextPassword = 'Una frase nueva para recuperar 456';
  await rejects(() => e.service.confirmPasswordReset({ token: first.token, newPassword: nextPassword }, 'ip'), 400);
  await rejects(() => e.service.confirmPasswordReset({ token: second.token, newPassword: 'corta' }, 'ip'), 400);
  const confirmed = await e.service.confirmPasswordReset({ token: second.token, newPassword: nextPassword }, 'ip');
  assert.equal(confirmed.account.id, registered.account.id);
  bad(() => e.service.authenticate(registered.token), 401);
  assert.equal(e.service.authenticate(confirmed.token).id, registered.account.id);
  await rejects(() => e.service.confirmPasswordReset({ token: second.token, newPassword: 'Otra frase nueva para recuperar 789' }, 'ip'), 400);
  await rejects(() => e.service.login({ email: input.email, password: input.password }, 'ip'), 401);
  await e.service.login({ email: input.email, password: nextPassword }, 'ip');
  const expired = e.service.requestPasswordReset({ email: input.email }, 'ip');
  e.clock(30 * 60 * 1000);
  await rejects(() => e.service.confirmPasswordReset({ token: expired.token, newPassword: 'Otra frase nueva para recuperar 789' }, 'ip'), 400);
  await rejects(() => e.service.confirmPasswordReset({ token: 'forged', newPassword: 'Otra frase nueva para recuperar 789' }, 'ip'), 400);
  const db = new DatabaseSync(e.path, { readOnly: true });
  try { assert.equal(db.prepare('SELECT token_hash FROM account_password_resets').all().some(row => row.token_hash === expired.token), false); }
  finally { db.close(); }
});

test('password reset requests are limited per email and per address and reject unexpected fields', async t => {
  const e = setup(t);
  await e.service.register(registration(), 'one');
  for (let count = 0; count < 3; count++) assert.ok(e.service.requestPasswordReset({ email: registration().email }, `ip-${count}`));
  bad(() => e.service.requestPasswordReset({ email: registration().email }, 'ip-other'), 429);
  for (let count = 0; count < 10; count++) e.service.requestPasswordReset({ email: `nadie${count}@example.test` }, 'same-ip');
  bad(() => e.service.requestPasswordReset({ email: 'otra@example.test' }, 'same-ip'), 429);
  bad(() => e.service.requestPasswordReset({ email: 'x@example.test', accountId: 'other' }, 'fields'), 400);
});

test('password reset HTTP routes answer the same for unknown emails and sign in after confirming', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-account-reset-'));
  const service = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  class TestModule {}
  Module({ controllers: [AccountsController], providers: [{ provide: AccountsService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `${await app.getUrl()}/api/accounts`;
  const send = (path, body, origin = 'http://localhost:3000') => fetch(`${base}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
  await service.register(registration(), 'one');
  assert.equal((await send('password-reset', { email: registration().email }, 'http://attacker.example')).status, 403);
  const known = await send('password-reset', { email: registration().email });
  const unknown = await send('password-reset', { email: 'missing@example.test' });
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  const { token } = service.requestPasswordReset({ email: registration().email }, 'direct');
  const confirmed = await send('password-reset-confirm', { token, newPassword: 'Una frase nueva para recuperar 456' });
  assert.equal(confirmed.status, 200);
  assert.match(confirmed.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await confirmed.json()).account.email, registration().email);
});

test('HTTP account routes enforce origin, cookie authentication, revocation and unavailable financial features', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-account-http-'));
  const service = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  class TestModule {}
  Module({ controllers: [AccountsController], providers: [{ provide: AccountsService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `${await app.getUrl()}/api/accounts`;
  const send = (path, body, cookie, origin = 'http://localhost:3000') => fetch(`${base}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  assert.equal((await send('me')).status, 401);
  assert.equal((await send('register', registration(), null, 'http://attacker.example')).status, 403);
  assert.equal((await send('register', registration(), null, '')).status, 403);
  const created = await send('register', registration());
  assert.equal(created.status, 201);
  const cookie = created.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const account = (await created.json()).account;
  assert.equal('password_hash' in account, false); assert.equal('token' in account, false);
  assert.equal((await send(`me?accountId=another`, null, cookie)).status, 200);
  assert.equal((await send('me', null, `${cookie}; playsport-account=forged`)).status, 403);
  assert.equal((await send('identity', {}, cookie)).status, 400);
  assert.equal((await send('wallet', {}, cookie)).status, 404);
  assert.equal((await send('password', { currentPassword: registration().password, newPassword: 'Nueva frase ficticia para entrar 789' }, cookie, 'http://attacker.example')).status, 403);
  const loggedOut = await send('logout', {}, cookie);
  assert.equal(loggedOut.status, 204); assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await send('me', null, cookie)).status, 401);
  assert.equal((await send('logout', {}, cookie)).status, 204);
});

test('production cookies require the HTTPS origin and use the secure host-only prefix', async () => {
  const environment = { NODE_ENV: process.env.NODE_ENV, PLAYSPORT_WEB_ORIGIN: process.env.PLAYSPORT_WEB_ORIGIN };
  try {
    process.env.NODE_ENV = 'production'; process.env.PLAYSPORT_WEB_ORIGIN = 'https://playsport.example.test';
    const controller = new AccountsController({});
    const headers = new Map(), response = { setHeader: (key, value) => headers.set(key, value) };
    controller.cookie(response, 'example-token');
    assert.match(headers.get('Set-Cookie'), /^__Host-playsport-account=/);
    assert.match(headers.get('Set-Cookie'), /; Secure$/); assert.doesNotMatch(headers.get('Set-Cookie'), /Domain=/);
    controller.origin({ headers: { origin: 'https://playsport.example.test' } });
    assert.throws(() => controller.origin({ headers: { origin: 'http://playsport.example.test' } }));
    process.env.PLAYSPORT_WEB_ORIGIN = 'http://localhost:3000';
    assert.throws(() => controller.origin({ headers: { origin: 'http://localhost:3000' } }), /HTTPS/);
  } finally {
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
const photoData = (size = 30) => {
  const bytes = Buffer.alloc(size, 42);
  bytes[0] = 255; bytes[1] = 216; bytes[2] = 255; bytes[size - 2] = 255; bytes[size - 1] = 217;
  return 'data:image/jpeg;base64,' + bytes.toString('base64');
};
const photoInput = (account, revision = 0, photo = photoData()) => ({
  requestId: randomUUID(), expectedAccountId: account.id, expectedRevision: revision, photo
});
test('account photo is private, account-owned and durable without changing credentials, identity or financial permissions', async t => {
  const e = setup(t), owner = await e.service.register(registration(), 'owner');
  const other = await e.service.register(registration('other@example.test'), 'other');
  const db = new DatabaseSync(e.path);
  const original = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  const input = photoInput(owner.account);
  bad(() => e.service.changePhoto(undefined, input), 401);
  bad(() => e.service.changePhoto(other.token, input), 409);
  for (const patch of [{ accountId: other.account.id }, { role: 'manager' }, { financialAccess: true }, { photo: 'https://example.test/photo.jpg' },
    { photo: 'data:image/svg+xml;base64,AAAA' }, { photo: photoData(70000) }, { photo: 'data:image/jpeg;base64,PHN2Zz5zY3JpcHQ8L3N2Zz4=' }]) bad(() => e.service.changePhoto(owner.token, { ...input, ...patch }), 400);
  const saved = e.service.changePhoto(owner.token, input);
  assert.equal(saved.appliedRevision, 1); assert.equal(saved.account.photo, input.photo); assert.equal(saved.account.photoRevision, 1);
  assert.equal(saved.account.financialAccess, false); assert.equal(saved.account.identityVerification, 'unavailable');
  assert.equal(e.service.authenticate(other.token).photo, undefined);
  assert.deepEqual(db.prepare('SELECT * FROM accounts ORDER BY id').all(), original);
  const reopened = e.reopen();
  assert.deepEqual(reopened.changePhoto(owner.token, input), saved);
  assert.equal(reopened.authenticate(owner.token).photo, input.photo);
  db.close();
});
test('optimistic photo revisions prevent stale screens overwriting another update; nonce retries and removal never restore an old portrait', async t => {
  const e = setup(t), owner = await e.service.register(registration(), 'owner');
  const first = photoInput(owner.account), saved = e.service.changePhoto(owner.token, first);
  bad(() => e.service.changePhoto(owner.token, photoInput(owner.account, 0, photoData(33))), 409);
  bad(() => e.service.changePhoto(owner.token, { ...first, photo: photoData(33) }), 409);
  const second = e.service.changePhoto(owner.token, photoInput(owner.account, saved.appliedRevision, photoData(33)));
  const replay = e.service.changePhoto(owner.token, first);
  assert.equal(replay.appliedRevision, 1); assert.equal(replay.account.photoRevision, 2); assert.equal(replay.account.photo, second.account.photo);
  const removed = e.service.changePhoto(owner.token, photoInput(owner.account, 2, ''));
  assert.equal(removed.account.photo, ''); assert.equal(removed.account.photoRevision, 3);
  assert.equal(e.service.changePhoto(owner.token, first).account.photo, '');
});
test('photo command failure rolls back image and revision, and request limits preserve the most recent confirmed photo', async t => {
  const e = setup(t), owner = await e.service.register(registration(), 'owner'), input = photoInput(owner.account);
  const db = new DatabaseSync(e.path);
  db.exec("CREATE TRIGGER photo_test_failure BEFORE INSERT ON account_photo_commands BEGIN SELECT RAISE(ABORT,'Photo test failure'); END;");
  assert.throws(() => e.service.changePhoto(owner.token, input), /Photo test failure/);
  assert.equal(e.service.authenticate(owner.token).photo, undefined);
  db.exec('DROP TRIGGER photo_test_failure');
  for (let i = 0; i < 30; i++) e.service.changePhoto(owner.token, photoInput(owner.account, i));
  bad(() => e.service.changePhoto(owner.token, photoInput(owner.account, 30)), 429);
  assert.equal(e.service.authenticate(owner.token).photoRevision, 30);
  e.clock(61000); assert.equal(e.service.changePhoto(owner.token, photoInput(owner.account, 30)).account.photoRevision, 31);
  db.close();
});
test('photo HTTP endpoint uses private same-origin sessions and accepts the maximum prepared JPEG within the existing JSON body limit', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-photo-http-'));
  const service = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  class TestModule {}
  Module({ controllers: [AccountsController], providers: [{ provide: AccountsService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false }); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const owner = await service.register(registration(), 'owner'), input = photoInput(owner.account, 0, photoData(67482));
  const url = `${await app.getUrl()}/api/accounts/photo`;
  const send = (cookie, origin) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(input) });
  assert.equal((await send(undefined, 'http://localhost:3000')).status, 401);
  assert.equal((await send(`playsport-account=${owner.token}`, 'http://untrusted.example.test')).status, 403);
  const response = await send(`playsport-account=${owner.token}`, 'http://localhost:3000');
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json(); assert.equal(body.account.photo, input.photo); assert.equal(body.account.id, owner.account.id);
  assert.equal(body.account.financialAccess, false); assert.equal('token' in body, false);
});
