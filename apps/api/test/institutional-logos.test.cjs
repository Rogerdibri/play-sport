const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { InstitutionalLogosService } = require('../src/modules/institutional-logos/institutional-logos.service');
const { InstitutionalLogosController } = require('../src/modules/institutional-logos/institutional-logos.controller');
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=';
const catalog = () => [
  { kind: 'tournament', id: 'cup', name: 'Copa ficticia', organizerId: 'org-demo', managerId: null },
  { kind: 'team', id: 'team-A', name: 'Equipo A ficticio', organizerId: 'org-demo', managerId: 'mgr-A' },
  { kind: 'team', id: 'team-B', name: 'Equipo B ficticio', organizerId: 'org-demo', managerId: 'mgr-B' }
];
const bad = (fn, status) => assert.throws(fn, (error) => error.getStatus?.() === status);
async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-logos-')),
    accountPath = join(directory, 'accounts.sqlite'),
    path = join(directory, 'logos.sqlite');
  const accounts = new AccountsService({ path: accountPath });
  const owner = await accounts.register(
    {
      email: 'logo-owner@example.test',
      displayName: 'Owner ficticio',
      password: 'Una contraseña ficticia de prueba 123'
    },
    'owner'
  );
  const other = await accounts.register(
    {
      email: 'logo-other@example.test',
      displayName: 'Other ficticio',
      password: 'Otra contraseña ficticia de prueba 123'
    },
    'other'
  );
  writeFileSync(join(directory, 'local-tester.json'), JSON.stringify({ version: 1, accountId: owner.account.id }), {
    mode: 0o600
  });
  let rows = catalog(),
    now = Date.now(),
    logos = new InstitutionalLogosService(accounts, { institutionalIdentities: () => rows }, { path, now: () => now });
  const command = (patch = {}) => ({
    requestId: randomUUID(),
    expectedAccountId: owner.account.id,
    expectedRevision: 0,
    role: 'manager',
    actorId: 'mgr-A',
    kind: 'team',
    id: 'team-A',
    logo: png,
    ...patch
  });
  t.after(() => {
    logos.onModuleDestroy();
    accounts.onModuleDestroy();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    accounts,
    owner,
    other,
    path,
    accountPath,
    command,
    get logos() {
      return logos;
    },
    rows: (value) => {
      rows = value;
    },
    clock: (value) => {
      now += value;
    },
    reopen() {
      logos.onModuleDestroy();
      logos = new InstitutionalLogosService(
        accounts,
        { institutionalIdentities: () => rows },
        { path, now: () => now }
      );
      return logos;
    }
  };
}
test('manager and organizer directly share one team logo; only its organizer edits tournament identity', async (t) => {
  const e = await setup(t);
  assert.equal(e.logos.list().length, 3);
  assert.deepEqual(
    e.logos.manageable(e.owner.token, 'manager', 'mgr-A').entities.map((row) => row.id),
    ['team-A']
  );
  bad(() => e.logos.manageable(e.other.token, 'organizer', 'org-demo'), 403);
  bad(() => e.logos.change(undefined, e.command()), 401);
  bad(() => e.logos.change(e.owner.token, e.command({ id: 'team-B' })), 403);
  bad(() => e.logos.change(e.owner.token, e.command({ kind: 'tournament', id: 'cup' })), 403);
  const first = e.logos.change(e.owner.token, e.command());
  assert.equal(first.appliedRevision, 1);
  const second = e.logos.change(
    e.owner.token,
    e.command({ role: 'organizer', actorId: 'org-demo', expectedRevision: 1 })
  );
  assert.equal(second.appliedRevision, 2);
  assert.equal(
    e.logos.change(e.owner.token, e.command({ kind: 'tournament', id: 'cup', role: 'organizer', actorId: 'org-demo' }))
      .appliedRevision,
    1
  );
  assert.equal(e.logos.list().find((row) => row.id === 'team-A').revision, 2);
});
test('logos persist independently from sporting memory and never alter accounts or sporting identities', async (t) => {
  const e = await setup(t),
    db = new DatabaseSync(e.accountPath),
    before = JSON.stringify(db.prepare('SELECT * FROM accounts ORDER BY id').all()),
    rows = catalog();
  e.rows(rows);
  e.logos.change(e.owner.token, e.command());
  assert.equal(JSON.stringify(rows), JSON.stringify(catalog()));
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM accounts ORDER BY id').all()), before);
  db.close();
  e.rows([]);
  e.reopen();
  assert.equal(e.logos.list().length, 1);
  assert.equal(e.logos.list()[0].name, 'Equipo A ficticio');
  assert.equal(e.logos.readImage('team', 'team-A', 1).type, 'image/png');
});
test('nonce replay, optimistic revisions and removal prevent lost responses restoring a superseded logo', async (t) => {
  const e = await setup(t),
    first = e.command();
  e.logos.change(e.owner.token, first);
  assert.equal(e.reopen().change(e.owner.token, first).appliedRevision, 1);
  bad(() => e.logos.change(e.owner.token, e.command()), 409);
  bad(() => e.logos.change(e.owner.token, { ...first, logo: '' }), 409);
  e.logos.change(e.owner.token, e.command({ expectedRevision: 1, logo: '' }));
  const replay = e.logos.change(e.owner.token, first);
  assert.equal(replay.appliedRevision, 1);
  assert.equal(replay.entities.find((row) => row.id === 'team-A').hasLogo, false);
  bad(() => e.logos.readImage('team', 'team-A', 1), 404);
});
test('invalid images, account changes, forged roles and unknown kinds are explicitly rejected', async (t) => {
  const e = await setup(t);
  for (const patch of [
    { logo: 'https://example.test/logo.png' },
    { logo: 'data:image/svg+xml;base64,AAAA' },
    { logo: png + 'A'.repeat(90000) },
    { logo: 'data:image/png;base64,AAAA' },
    { leagueId: 'league' },
    { kind: 'club' },
    { expectedRevision: -1 },
    { accountId: e.owner.account.id }
  ])
    bad(() => e.logos.change(e.owner.token, e.command(patch)), 400);
  bad(() => e.logos.change(e.owner.token, e.command({ expectedAccountId: e.other.account.id })), 409);
  bad(() => e.logos.change(e.owner.token, e.command({ actorId: 'mgr-B' })), 403);
  bad(() => e.logos.change(e.owner.token, e.command({ role: 'organizer', actorId: 'another' })), 403);
  assert.equal(
    e.logos.list().some((row) => row.hasLogo),
    false
  );
});
test('failed command inserts roll back images; rate limits preserve nonce confirmation and private audits contain no image history', async (t) => {
  const e = await setup(t),
    db = new DatabaseSync(e.path),
    first = e.command();
  db.exec(
    "CREATE TRIGGER logo_failure BEFORE INSERT ON logo_commands BEGIN SELECT RAISE(ABORT,'Logo test failure'); END;"
  );
  assert.throws(() => e.logos.change(e.owner.token, first), /Logo test failure/);
  assert.equal(
    e.logos.list().some((row) => row.hasLogo),
    false
  );
  db.exec('DROP TRIGGER logo_failure');
  e.logos.change(e.owner.token, first);
  for (let i = 1; i < 30; i++) e.logos.change(e.owner.token, e.command({ expectedRevision: i }));
  bad(() => e.logos.change(e.owner.token, e.command({ expectedRevision: 30 })), 429);
  assert.equal(e.logos.change(e.owner.token, first).appliedRevision, 1);
  e.clock(61000);
  assert.equal(e.logos.change(e.owner.token, e.command({ expectedRevision: 30 })).appliedRevision, 31);
  assert.equal(db.prepare('SELECT * FROM logo_commands LIMIT 1').get().account_id, e.owner.account.id);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM logo_commands').all()).includes(png), false);
  db.close();
});
test('one stable team ID shares a logo across tournaments; conflicting identities are never merged by name', async (t) => {
  const e = await setup(t);
  e.rows([...catalog(), { ...catalog()[1], organizerId: 'another-organizer' }]);
  assert.equal(e.logos.list().filter((row) => row.id === 'team-A').length, 1);
  e.rows([...catalog(), { ...catalog()[1], name: 'Un equipo diferente' }]);
  bad(() => e.logos.list(), 409);
});
test('HTTP logos are public bounded images; mutation requires origin and private authorized session', async (t) => {
  const e = await setup(t);
  class TestModule {}
  const adapter = Object.fromEntries(
    ['list', 'manageable', 'readImage', 'change'].map((method) => [method, e.logos[method].bind(e.logos)])
  );
  Module({
    controllers: [InstitutionalLogosController],
    providers: [{ provide: InstitutionalLogosService, useValue: adapter }]
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const base = `${await app.getUrl()}/api/institutional-logos`;
  assert.equal((await fetch(base)).status, 200);
  const send = (origin, token = e.owner.token) =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: `playsport-account=${token}` },
      body: JSON.stringify(e.command())
    });
  assert.equal((await send('http://attacker.example.test')).status, 403);
  assert.equal((await send('http://localhost:3000', e.other.token)).status, 403);
  assert.equal((await send('http://localhost:3000')).status, 200);
  const image = await fetch(`${base}/image?kind=team&id=team-A&revision=1`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), png.split(',')[1]);
  assert.equal((await fetch(`${base}/image?kind=team&id=team-A&revision=0`)).status, 400);
  assert.equal((await fetch(`${base}?accountId=forged`)).status, 400);
});
