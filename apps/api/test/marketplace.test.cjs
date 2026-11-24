const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { MarketplaceService } = require('../src/modules/marketplace/marketplace.service');
const { MarketplaceController } = require('../src/modules/marketplace/marketplace.controller');
const { WalletService } = require('../src/modules/wallet/wallet.service');
const { readMarketplaceSnapshot } = require('@playsport/shared');
const { isMarketplacePhotoPath } = require('@playsport/shared');
const jpeg = Buffer.from([255, 216, 255, 217]);
const photo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
const registration = email => ({ email, displayName: email.split('@')[0], password: 'Frase ficticia para marketplace 123456' });
const command = (kind, fields = {}) => ({ kind, ...fields, requestId: randomUUID() });

async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-market-'));
  let now = Date.parse('2026-11-08T12:00:00Z');
  const accounts = new AccountsService({ path: join(dir, 'accounts.sqlite'), now: () => now });
  const people = await Promise.all(['seller', 'buyer', 'other'].map(name => accounts.register(registration(`${name}@example.test`), name)));
  const path = join(dir, 'marketplace.sqlite'), services = [];
  const open = () => { const service = new MarketplaceService(accounts, { path, now: () => now }); services.push(service); return service; };
  const market = open();
  const wallet = new WalletService(accounts, { path, now: () => now });
  for (const person of people) wallet.recharge(person.token, command('recharge', { amountCents: 100000000 }));
  t.after(() => { for (const service of services) service.onModuleDestroy(); wallet.onModuleDestroy(); accounts.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); });
  const [seller, buyer, other] = people;
  const publish = (patch = {}) => market.perform(seller.token, command('publish', {
    type: 'sale', title: 'Guante ficticio', description: 'Solo pruebas, sin mercancía ni dinero real.',
    category: 'equipment', condition: 'used', location: 'Estadio ficticio', photo: null,
    stateId: 'VE-A', municipalityId: 'VE-A:libertador', sport: 'baseball', sportsOnly: true,
    priceCents: 1250, stock: 1, incrementCents: 0, endsAt: null, ...patch
  })).entityId;
  return { accounts, market, wallet, seller, buyer, other, open, publish, path,
    moderator: (ids = [other.account.id]) => writeFileSync(join(dir, 'moderators.json'), JSON.stringify({ version: 1, accountIds: ids }), { mode: 0o600 }),
    time: () => now, advance: value => { now += value; } };
}

test('photos are stored once as local files, survive restart and remain referenced in edit history without Base64 in SQLite', async t => {
  const e = await setup(t), first = e.publish({ photo }), second = e.publish({ photo });
  let listing = e.market.read(e.seller.token).myListings.find(item => item.id === first);
  const path = listing.photo;
  assert.ok(isMarketplacePhotoPath(path));
  assert.deepEqual(e.market.readPhoto(path.split('/').at(-1)), jpeg);
  assert.equal(e.market.read().listings.find(item => item.id === second).photo, path);
  assert.equal(readdirSync(join(e.path, '..', 'photos')).length, 1);
  e.market.perform(e.seller.token, command('edit', {
    listingId: first, revision: listing.revision, title: listing.title, description: listing.description,
    category: listing.category, condition: listing.condition, location: listing.location, photo: path,
    stateId: listing.stateId, municipalityId: listing.municipalityId, sport: listing.sport, sportsOnly: true,
    priceCents: listing.priceCents, stock: listing.stock, incrementCents: listing.incrementCents,
  }));
  const restarted = e.open();
  assert.equal(restarted.read(e.seller.token).myListings.find(item => item.id === first).photo, path);
  assert.deepEqual(restarted.readPhoto(path.split('/').at(-1)), jpeg);
  const db = new DatabaseSync(e.path);
  try {
    for (const [table, column] of [['market_listings', 'payload'], ['market_audits', 'before_payload'], ['market_audits', 'after_payload']]) {
      for (const row of db.prepare(`SELECT ${column} AS payload FROM ${table}`).all()) assert.doesNotMatch(row.payload, /data:image/);
    }
  } finally { db.close(); }
  bad(() => e.publish({ photo: `/api/marketplace/photos/${'0'.repeat(64)}.jpg` }), 400);
  bad(() => e.market.readPhoto('../accounts.sqlite'), 404);
  bad(() => e.market.readPhoto(`${'0'.repeat(64)}.jpg`), 404);
});

test('a missing photo is an explicit media error but does not couple wallet or stock operations to file availability', async t => {
  const e = await setup(t), listingId = e.publish({ photo });
  const filename = e.market.read().listings.find(item => item.id === listingId).photo.split('/').at(-1);
  unlinkSync(join(e.path, '..', 'photos', filename));
  bad(() => e.market.readPhoto(filename), 404);
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  assert.equal(e.market.read().listings.find(item => item.id === listingId).stock, 0);
  e.market.perform(e.buyer.token, command('update-order', { orderId, status: 'cancelled' }));
  assert.equal(e.market.read().listings.find(item => item.id === listingId).stock, 1);
});

test('legacy listing and historical photos migrate with a consistent backup, smaller database and unchanged commercial fields', async t => {
  const e = await setup(t), id = e.publish({ photo });
  e.market.perform(e.seller.token, editing(e, id, { title: 'Título conservado' }));
  const db = new DatabaseSync(e.path);
  const large = Buffer.concat([jpeg.subarray(0, 2), Buffer.alloc(30000, 32), jpeg.subarray(2)]);
  const legacy = `data:image/jpeg;base64,${large.toString('base64')}`;
  const originals = [];
  try {
    for (const [table, column] of [['market_listings', 'payload'], ['market_audits', 'before_payload'], ['market_audits', 'after_payload']]) {
      for (const row of db.prepare(`SELECT id,${column} AS payload FROM ${table}`).all()) {
        const value = { ...JSON.parse(row.payload), photo: legacy };
        db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(JSON.stringify(value), row.id);
        originals.push({ table, column, id: row.id, value });
      }
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const beforeSize = statSync(e.path).size;
    const beforeWallet = e.wallet.read(e.seller.token);
    const restarted = e.open();
    assert.ok(statSync(e.path).size < beforeSize, 'The live SQLite file must shrink, not merely replace values in free pages');
    const listing = restarted.read(e.seller.token).myListings.find(item => item.id === id);
    assert.ok(isMarketplacePhotoPath(listing.photo));
    assert.deepEqual(restarted.readPhoto(listing.photo.split('/').at(-1)), large);
    for (const original of originals) {
      const current = JSON.parse(db.prepare(`SELECT ${original.column} AS payload FROM ${original.table} WHERE id=?`).get(original.id).payload);
      assert.deepEqual(current, { ...original.value, photo: listing.photo });
    }
    assert.deepEqual(e.wallet.read(e.seller.token), beforeWallet);
    const backups = readdirSync(join(e.path, '..', 'backups'));
    assert.equal(backups.length, 1);
    const backupPath = join(e.path, '..', 'backups', backups[0]);
    assert.equal(statSync(backupPath).mode & 0o777, 0o600);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try { assert.equal(JSON.parse(backup.prepare('SELECT payload FROM market_listings WHERE id=?').get(id).payload).photo, legacy); }
    finally { backup.close(); }
    e.open();
    assert.equal(readdirSync(join(e.path, '..', 'backups')).length, 1);
    assert.ok(!readFileSync(e.path).includes(Buffer.from(legacy)), 'The compacted live database must not retain the old Base64');
  } finally { db.close(); }
});

test('public photo endpoint serves only content-addressed JPEG files with safe caching', async t => {
  const e = await setup(t), id = e.publish({ photo });
  const path = e.market.read().listings.find(item => item.id === id).photo;
  class PhotoModule {}
  Module({ controllers: [MarketplaceController], providers: [{ provide: MarketplaceService, useValue: {
    readPhoto: filename => e.market.readPhoto(filename),
  } }] })(PhotoModule);
  const app = await NestFactory.create(PhotoModule, { logger: false });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const origin = await app.getUrl();
  const response = await fetch(origin + path);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control'), /public.*immutable/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.equal((await fetch(`${origin}/api/marketplace/photos/${'0'.repeat(64)}.jpg`)).status, 404);
  assert.equal((await fetch(`${origin}/api/marketplace/photos/accounts.sqlite`)).status, 404);
});

test('marketplace uses real authenticated account ownership, rejects forged identities and never enables financial access', async t => {
  const e = await setup(t), id = e.publish();
  const feed = readMarketplaceSnapshot(e.market.read(e.buyer.token));
  assert.equal(feed.mode, 'test'); assert.equal(feed.currency, 'USD_DEMO');
  assert.equal(feed.listings[0].seller.id, e.seller.account.id);
  assert.equal(feed.viewer.id, e.buyer.account.id);
  assert.equal(e.accounts.authenticate(e.buyer.token).financialAccess, false);
  bad(() => e.market.perform(undefined, command('buy', { listingId: id, quantity: 1 })), 401);
  bad(() => e.market.perform(e.buyer.token, command('buy', { listingId: id, quantity: 1, buyerId: e.other.account.id })), 400);
  bad(() => e.market.perform(e.buyer.token, command('buy', { listingId: id, quantity: 1, financialAccess: true })), 400);
  bad(() => e.market.perform(e.seller.token, command('buy', { listingId: id, quantity: 1 })), 403);
  bad(() => e.market.perform(e.other.token, command('withdraw', { listingId: id })), 403);
  assert.deepEqual(e.market.read().orders, []);
  assert.doesNotMatch(JSON.stringify(feed), /password|token_hash|@example/);
});

test('two service instances cannot sell the last unit twice, and durable request keys prevent duplicate orders after retry or restart', async t => {
  const e = await setup(t), id = e.publish(), second = e.open();
  const buy = command('buy', { listingId: id, quantity: 1 });
  const results = await Promise.allSettled([
    Promise.resolve().then(() => e.market.perform(e.buyer.token, buy)),
    Promise.resolve().then(() => second.perform(e.other.token, command('buy', { listingId: id, quantity: 1 })))
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.getStatus(), 409);
  const result = results[0].value;
  assert.deepEqual(second.perform(e.buyer.token, buy), result);
  assert.equal(second.read(e.buyer.token).orders.length, 1);
  assert.equal(second.read().listings[0].stock, 0);
  bad(() => second.perform(e.buyer.token, { ...buy, quantity: 2 }), 409);
});

test('cancellation restores stock only once and only seller and buyer can make valid delivery transitions', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 2 });
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  bad(() => e.market.perform(e.other.token, command('update-order', { orderId, status: 'cancelled' })), 403);
  bad(() => e.market.perform(e.buyer.token, command('update-order', { orderId, status: 'sent' })), 409);
  const cancel = command('update-order', { orderId, status: 'cancelled' });
  e.market.perform(e.buyer.token, cancel); e.open().perform(e.buyer.token, cancel);
  assert.equal(e.market.read().listings[0].stock, 2);
  bad(() => e.market.perform(e.seller.token, command('update-order', { orderId, status: 'cancelled' })), 409);
  const next = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  e.market.perform(e.seller.token, command('update-order', { orderId: next, status: 'sent' }));
  bad(() => e.market.perform(e.seller.token, command('update-order', { orderId: next, status: 'delivered' })), 409);
  e.market.perform(e.buyer.token, command('update-order', { orderId: next, status: 'delivered' }));
  e.market.perform(e.buyer.token, command('update-order', { orderId: next, status: 'disputed', note: 'Reclamación ficticia' }));
  const order = e.market.read(e.buyer.token).orders.find(order => order.id === next);
  assert.equal(order.status, 'disputed'); assert.equal(order.history.length, 4);
  assert.equal(e.market.read(e.other.token).orders.length, 0);
});

test('auction increments and competing bids are atomic; exact deadline closes without extension and creates precisely one winner order', async t => {
  const e = await setup(t), endsAt = new Date(e.time() + 120000).toISOString();
  const listingId = e.publish({ type: 'auction', stock: 1, priceCents: 1000, incrementCents: 100, endsAt });
  bad(() => e.market.perform(e.seller.token, command('bid', { listingId, amountCents: 1000 })), 403);
  bad(() => e.market.perform(e.buyer.token, command('bid', { listingId, amountCents: 999 })), 409);
  const second = e.open();
  const bids = await Promise.allSettled([e.buyer, e.other].map((actor, index) => Promise.resolve().then(() =>
    (index ? second : e.market).perform(actor.token, command('bid', { listingId, amountCents: 1000 })))));
  assert.equal(bids.filter(result => result.status === 'fulfilled').length, 1);
  bad(() => e.market.perform(e.seller.token, command('withdraw', { listingId })), 409);
  e.advance(119999);
  e.market.perform(e.other.token, command('bid', { listingId, amountCents: 1200 }));
  assert.equal(e.market.read().listings[0].endsAt, endsAt);
  e.advance(1);
  bad(() => e.market.perform(e.buyer.token, command('bid', { listingId, amountCents: 1300 })), 409);
  const feed = readMarketplaceSnapshot(second.read(e.other.token));
  assert.equal(feed.listings[0].status, 'closed');
  assert.equal(feed.orders.length, 1); assert.equal(feed.orders[0].totalCents, 1200);
  assert.equal(feed.orders[0].createdAt, endsAt); assert.equal(feed.orders[0].type, 'auction');
  assert.equal(e.open().read(e.other.token).orders.length, 1);
  assert.equal(e.market.read(e.buyer.token).orders.length, 0);
});

test('auctions without bids close with no invented winner or order, including after a service restart', async t => {
  const e = await setup(t);
  e.publish({ type: 'auction', stock: 1, incrementCents: 100, endsAt: new Date(e.time() + 60000).toISOString() });
  e.advance(60000);
  const feed = e.open().read(e.seller.token);
  assert.equal(feed.listings[0].status, 'closed'); assert.equal(feed.orders.length, 0);
  assert.equal(feed.listings[0].currentBidCents, null);
});

test('purchase chats and message pagination persist, never leak to a third account and require fresh authentication', async t => {
  const e = await setup(t), listingId = e.publish();
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  const threadId = e.market.perform(e.buyer.token, command('start-thread', { orderId })).entityId;
  const again = e.market.perform(e.buyer.token, command('start-thread', { orderId }));
  assert.equal(again.entityId, threadId);
  for (let index = 0; index < 55; index++) {
    e.market.perform(e.buyer.token, command('message', { threadId, text: `Consulta ficticia ${index}` }));
    e.advance(2001);
  }
  const feed = readMarketplaceSnapshot(e.open().read(e.seller.token, { thread: threadId }));
  assert.equal(feed.messages.length, 50); assert.equal(feed.hasOlderMessages, true);
  assert.equal(feed.messages[0].text, 'Consulta ficticia 5');
  const older = e.market.read(e.buyer.token, { thread: threadId, beforeMessage: feed.messages[0].id });
  assert.equal(older.messages.length, 5); assert.equal(older.hasOlderMessages, false);
  bad(() => e.market.read(e.other.token, { thread: threadId }), 403);
  bad(() => e.market.perform(e.other.token, command('message', { threadId, text: 'No autorizado' })), 403);
  assert.deepEqual(e.market.read(e.other.token).conversations, []);
  assert.deepEqual(e.market.read().messages, []);
  e.accounts.logout(e.buyer.token);
  bad(() => e.market.perform(e.buyer.token, command('message', { threadId, text: 'Revocado' })), 401);
});

test('invalid prices, photos, auction rules, payload fields and duplicate message floods fail explicitly without changing listings', async t => {
  const e = await setup(t);
  for (const patch of [{ priceCents: 1.5 }, { priceCents: 0 }, { stock: 0 }, { photo: 'https://example.test/p.jpg' },
    { photo: 'data:image/jpeg;base64,YWJjZA==' }, { type: {} }, { condition: [] },
    { type: 'auction', stock: 2, incrementCents: 100, endsAt: new Date(e.time() + 120000).toISOString() },
    { type: 'auction', incrementCents: 0, endsAt: new Date(e.time() + 120000).toISOString() }]) bad(() => e.publish(patch), 400);
  assert.equal(e.market.read().listings.length, 0);
  const listingId = e.publish();
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  const threadId = e.market.perform(e.buyer.token, command('start-thread', { orderId })).entityId;
  e.market.perform(e.buyer.token, command('message', { threadId, text: 'Consulta' }));
  bad(() => e.market.perform(e.buyer.token, command('message', { threadId, text: 'Otra consulta' })), 429);
  const report = e.market.perform(e.other.token, command('report', { listingId, reason: 'Prueba de reporte' }));
  assert.match(report.notice, /revisión pendiente/);
  assert.equal(e.market.read().listings[0].status, 'closed');
  e.advance(31 * 60000);
  const expired = e.market.read(e.buyer.token);
  assert.equal(expired.viewer, null); assert.equal(expired.sessionExpired, true); assert.deepEqual(expired.orders, []);
});

test('marketplace HTTP routes use same-origin account cookies, not demo roles, and reject cross-origin commands', async t => {
  const e = await setup(t), listingId = e.publish();
  class TestModule {}
  Module({ controllers: [MarketplaceController], providers: [{ provide: MarketplaceService, useValue: {
    read: (...args) => e.market.read(...args), perform: (...args) => e.market.perform(...args)
  } }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/marketplace`;
  const input = command('buy', { listingId, quantity: 1 });
  const post = origin => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: `playsport-account=${e.buyer.token}` }, body: JSON.stringify(input) });
  assert.equal((await post('http://other.example.test')).status, 403);
  assert.equal((await post('http://localhost:3000')).status, 201);
  const publicFeed = await (await fetch(url)).json();
  assert.equal(publicFeed.orders.length, 0); assert.equal(publicFeed.viewer, null);
  const own = await fetch(url, { headers: { Cookie: `playsport-account=${e.buyer.token}` } });
  assert.equal(own.headers.get('cache-control'), 'no-store');
  assert.equal((await own.json()).orders.length, 1);
  assert.equal((await fetch(url + '?thread=1&thread=2')).status, 400);
  assert.equal((await fetch(url + '?payment=real')).status, 400);
  assert.equal((await fetch(url + '?state=VE-A')).status, 200);
  assert.equal((await fetch(url + '?state=VE-A&state=VE-D')).status, 400);
  assert.equal((await fetch(url + '?state=not-a-state')).status, 400);
  assert.equal((await fetch(url + '?sport=baseball-softball&condition=used&category=equipment&type=sale&search=GUANTE')).status, 200);
  for (const query of ['?sport=baseball', '?sport=baseball-softball&sport=basketball', '?condition=used&condition=new', '?condition=broken', '?search=' + 'x'.repeat(101)]) {
    assert.equal((await fetch(url + query)).status, 400);
  }
  const favorite = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: `playsport-account=${e.buyer.token}` },
    body: JSON.stringify(command('favorite', { listingId, saved: true })) });
  assert.equal(favorite.status, 201);
  assert.equal((await (await fetch(url, { headers: { Cookie: `playsport-account=${e.buyer.token}` } })).json()).favorites.length, 1);
  assert.deepEqual((await (await fetch(url)).json()).favorites, []);
});

test('state filtering happens before pagination and does not filter private purchases or direct listing access', async t => {
  const e = await setup(t);
  for (let i = 0; i < 51; i++) e.publish({ title: `Artículo deportivo ${i}` });
  const different = e.publish({ stateId: 'VE-D', municipalityId: 'VE-D:girardot' });
  const bought = e.market.perform(e.buyer.token, command('buy', { listingId: different, quantity: 1 })).entityId;
  const first = e.market.read(e.buyer.token, { state: 'VE-A' });
  assert.equal(first.listings.length, 50); assert.equal(first.hasMore, true);
  assert.ok(first.listings.every(item => item.stateId === 'VE-A'));
  assert.equal(first.orders[0].id, bought);
  const second = e.market.read(e.buyer.token, { state: 'VE-A', before: first.listings.at(-1).id });
  assert.equal(second.listings.length, 1); assert.equal(second.hasMore, false);
  assert.equal(e.market.read(undefined, { state: 'VE-D' }).listings.length, 1);
  assert.equal(e.market.read(undefined, { listing: different, state: 'VE-A' }).listings[0].id, different);
  bad(() => e.market.read(undefined, { state: 'not-a-state' }), 400);
});

test('new listings require a real state/municipality pair, a sports discipline and explicit sports-only agreement', async t => {
  const e = await setup(t);
  for (const patch of [
    { stateId: null }, { stateId: 'VE-INVALID' }, { municipalityId: 'VE-D:girardot' },
    { sport: undefined }, { sport: 'general-commerce' }, { sportsOnly: false }, { sportsOnly: 'true' },
    { sportsOnly: undefined }, { category: 'electronics' }
  ]) bad(() => e.publish(patch), 400);
  assert.equal(e.market.read().listings.length, 0);
  const id = e.publish({ sport: 'softball' });
  const listing = e.market.read().listings[0];
  assert.equal(listing.id, id); assert.equal(listing.sportsOnly, true); assert.equal(listing.sport, 'softball');
  assert.equal(listing.stateId, 'VE-A'); assert.equal(listing.municipalityId, 'VE-A:libertador');
});

test('version-one listings migrate without invented geography, sports declarations, changed prices or lost records', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-market-migration-'));
  const accounts = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  const account = await accounts.register(registration('migration@example.test'), 'migration');
  const path = join(directory, 'marketplace.sqlite'), old = new DatabaseSync(path);
  const payload = { id: 1, seller: { id: account.account.id, displayName: account.account.displayName }, type: 'sale',
    title: 'Anuncio deportivo anterior', description: 'Ejemplo anterior ficticio', category: 'equipment', condition: 'used',
    location: 'Referencia antigua', photo: null, priceCents: 4321, stock: 3, incrementCents: 0, endsAt: null,
    currentBidCents: null, bidCount: 0, status: 'active', createdAt: new Date().toISOString() };
  old.exec('CREATE TABLE market_listings(id INTEGER PRIMARY KEY,seller_id TEXT NOT NULL,status TEXT NOT NULL,ends_at INTEGER,payload TEXT NOT NULL) STRICT; PRAGMA user_version=1;');
  old.prepare('INSERT INTO market_listings VALUES(?,?,?,?,?)').run(1, account.account.id, 'active', null, JSON.stringify(payload)); old.close();
  const market = new MarketplaceService(accounts, { path });
  t.after(() => { market.onModuleDestroy(); accounts.onModuleDestroy(); rmSync(directory, { recursive: true, force: true }); });
  const listing = market.read(account.token).listings[0];
  assert.deepEqual(listing, { ...payload, stateId: null, municipalityId: null, sport: null, sportsOnly: false, revision: 0, moderation: null, walletBacked: false });
  assert.equal(market.read(undefined, { state: 'VE-A' }).listings.length, 0);
  const inspection = new DatabaseSync(path);
  assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(inspection.prepare('SELECT payload FROM market_listings').get().payload, JSON.stringify(payload)); inspection.close();
});

function editing(e, id, patch = {}) {
  const item = e.market.read(e.seller.token).myListings.find(item => item.id === id);
  return command('edit', Object.fromEntries([...['title', 'description', 'category', 'condition', 'location', 'stateId', 'municipalityId',
    'sport', 'sportsOnly', 'photo', 'priceCents', 'stock', 'incrementCents', 'revision'].map(key => [key, item[key]]), ['listingId', id], ...Object.entries(patch)]));
}
test('owner edits use optimistic inventory revisions, preserve purchases and durable audit, and cannot exceed restorable stock limits', async t => {
  const e = await setup(t), id = e.publish({ stock: 3 });
  const stale = editing(e, id), orderId = e.market.perform(e.buyer.token, command('buy', { listingId: id, quantity: 1 })).entityId;
  bad(() => e.market.perform(e.seller.token, stale), 409);
  bad(() => e.market.perform(e.buyer.token, editing(e, id)), 403);
  bad(() => e.market.perform(e.seller.token, editing(e, id, { stock: 1000 })), 409);
  const edit = editing(e, id, { title: 'Guante deportivo actualizado', priceCents: 2500, stock: 5 });
  e.market.perform(e.seller.token, edit); e.open().perform(e.seller.token, edit);
  let feed = readMarketplaceSnapshot(e.market.read(e.seller.token));
  assert.equal(feed.myListings[0].stock, 5); assert.equal(feed.audits.length, 1);
  assert.equal(feed.orders[0].title, 'Guante ficticio'); assert.equal(feed.orders[0].totalCents, 1250);
  e.market.perform(e.buyer.token, command('update-order', { orderId, status: 'cancelled' }));
  assert.equal(e.market.read().listings[0].stock, 6);
  e.market.perform(e.seller.token, editing(e, id, { stock: 0 }));
  assert.equal(e.market.read().listings[0].status, 'closed');
  e.market.perform(e.seller.token, editing(e, id, { stock: 4 }));
  assert.equal(e.market.read().listings[0].status, 'active');
  e.market.perform(e.seller.token, command('withdraw', { listingId: id }));
  e.market.perform(e.seller.token, editing(e, id, { stock: 2 }));
  assert.equal(e.market.read(e.seller.token).myListings[0].status, 'withdrawn');
  assert.equal(e.market.read(e.buyer.token).audits.length, 0);
});
test('auction content is editable only without bids, published deadline and modality are immutable, and bids lock all owner edits', async t => {
  const e = await setup(t), endsAt = new Date(e.time() + 120000).toISOString();
  const id = e.publish({ type: 'auction', incrementCents: 100, endsAt });
  bad(() => e.market.perform(e.seller.token, editing(e, id, { endsAt: new Date(e.time() + 240000).toISOString() })), 400);
  bad(() => e.market.perform(e.seller.token, editing(e, id, { type: 'sale' })), 400);
  e.market.perform(e.seller.token, editing(e, id, { priceCents: 1500 }));
  assert.equal(e.market.read().listings[0].endsAt, endsAt);
  e.market.perform(e.buyer.token, command('bid', { listingId: id, amountCents: 1500 }));
  const before = e.market.read(e.seller.token).myListings[0];
  bad(() => e.market.perform(e.seller.token, editing(e, id, { title: 'Otro artículo' })), 409);
  assert.deepEqual(e.market.read(e.seller.token).myListings[0], before);
  e.advance(120000);
  bad(() => e.market.perform(e.seller.token, editing(e, id)), 409);
  assert.equal(e.market.read(e.buyer.token).orders.length, 1);
});
test('moderation is an explicit local account capability, not a sporting role, and permission revocation also rejects idempotent privileged retries', async t => {
  const e = await setup(t), id = e.publish();
  const remove = command('remove', { listingId: id, reason: 'Retiro ficticio por incumplimiento' });
  bad(() => e.market.perform(e.other.token, remove), 403);
  bad(() => e.market.perform(e.other.token, { ...remove, canModerate: true }), 400);
  e.moderator();
  assert.equal(e.market.read(e.other.token).canModerate, true);
  assert.equal(e.market.read(e.buyer.token).canModerate, false);
  const previous = { node: process.env.NODE_ENV, origin: process.env.PLAYSPORT_WEB_ORIGIN };
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(e.market.read(e.other.token).canModerate, false); bad(() => e.market.perform(e.other.token, remove), 403);
    process.env.NODE_ENV = 'development'; process.env.PLAYSPORT_WEB_ORIGIN = 'http://public.example.test';
    assert.equal(e.market.read(e.other.token).canModerate, false); bad(() => e.market.perform(e.other.token, remove), 403);
  } finally {
    if (previous.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.node;
    if (previous.origin === undefined) delete process.env.PLAYSPORT_WEB_ORIGIN; else process.env.PLAYSPORT_WEB_ORIGIN = previous.origin;
  }
  e.market.perform(e.other.token, remove); e.moderator([]);
  bad(() => e.market.perform(e.other.token, remove), 403);
  e.moderator(['invalid']);
  assert.throws(() => e.market.read(e.other.token), /configuración privada/);
});
test('report review requires reasons, keeps private immutable decisions, supports owner appeals and does not grant access to private commerce', async t => {
  const e = await setup(t), id = e.publish({ stock: 2 }); e.moderator();
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId: id, quantity: 1 })).entityId;
  const threadId = e.market.perform(e.buyer.token, command('start-thread', { orderId })).entityId;
  const report = command('report', { listingId: id, reason: 'Contenido ajeno al deporte: ejemplo ficticio' });
  e.market.perform(e.buyer.token, report); e.open().perform(e.buyer.token, report);
  bad(() => e.market.perform(e.buyer.token, command('report', { listingId: id, reason: 'Otra razón' })), 409);
  assert.equal(e.market.read().reviews.length, 0); assert.equal(e.market.read(e.seller.token).reviews.length, 0);
  const reviewId = e.market.read(e.other.token).reviews[0].id;
  assert.equal(e.market.read(e.other.token).orders.length, 0); bad(() => e.market.read(e.other.token, { thread: threadId }), 403);
  bad(() => e.market.perform(e.buyer.token, command('review-report', { reviewId, decision: 'remove', reason: 'Motivo' })), 403);
  bad(() => e.market.perform(e.other.token, command('review-report', { reviewId, decision: 'remove', reason: '' })), 400);
  bad(() => e.market.perform(e.other.token, command('review-report', { reviewId, decision: 'restore', reason: 'Motivo' })), 400);
  const decision = command('review-report', { reviewId, decision: 'remove', reason: 'Incumplimiento confirmado en pruebas' });
  e.market.perform(e.other.token, decision); e.open().perform(e.other.token, decision);
  assert.equal(e.market.read().listings.length, 0); bad(() => e.market.read(undefined, { listing: id }), 404);
  assert.equal(e.market.read(e.buyer.token).reviews[0].status, 'resolved');
  bad(() => e.market.perform(e.other.token, command('review-report', { reviewId, decision: 'dismiss', reason: 'Reescribir' })), 409);
  bad(() => e.market.perform(e.seller.token, editing(e, id)), 409);
  bad(() => e.market.perform(e.buyer.token, command('buy', { listingId: id, quantity: 1 })), 409);
  bad(() => e.market.perform(e.buyer.token, command('appeal', { listingId: id, reason: 'No propietario' })), 403);
  e.market.perform(e.buyer.token, command('update-order', { orderId, status: 'cancelled' }));
  assert.equal(e.market.read(e.seller.token).myListings[0].status, 'removed');
  assert.equal(e.market.perform(e.buyer.token, command('start-thread', { orderId })).entityId, threadId);
  const appealId = e.market.perform(e.seller.token, command('appeal', { listingId: id, reason: 'Apelación ficticia del vendedor' })).entityId;
  bad(() => e.market.perform(e.seller.token, command('appeal', { listingId: id, reason: 'Duplicado' })), 409);
  e.market.perform(e.other.token, command('review-report', { reviewId: appealId, decision: 'restore', reason: 'Aceptada tras revisión' }));
  const feed = readMarketplaceSnapshot(e.open().read(e.other.token));
  assert.equal(feed.listings[0].status, 'active'); assert.equal(feed.listings[0].stock, 2);
  assert.equal(feed.reviews.length, 2); assert.deepEqual(feed.audits.map(item => item.action), ['restore', 'remove']);
  assert.deepEqual(e.market.read(e.seller.token).reviews.map(item => item.kind), ['appeal']);
});

test('public questions and seller answers are durable, require no purchase, never modify inventory, and do not permit forged sellers or private pre-purchase chats', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 4 });
  const before = e.market.read().listings[0];
  bad(() => e.market.perform(e.buyer.token, command('start-thread', { listingId })), 400);
  bad(() => e.market.perform(e.buyer.token, command('start-thread', { orderId: 999 })), 404);
  bad(() => e.market.perform(undefined, command('question', { listingId, text: '¿Es para zurdos?' })), 401);
  bad(() => e.market.perform(e.seller.token, command('question', { listingId, text: 'Pregunta propia' })), 403);
  const input = command('question', { listingId, text: '¿Es para zurdos?' });
  const questionId = e.market.perform(e.buyer.token, input).entityId;
  e.open().perform(e.buyer.token, input);
  assert.deepEqual(e.market.read().listings[0], before);
  assert.equal(e.market.read(e.buyer.token).orders.length, 0);
  assert.equal(e.market.read(e.buyer.token).conversations.length, 0);
  assert.equal(e.market.read(undefined, { listing: listingId }).questions.length, 1);
  bad(() => e.market.perform(e.other.token, command('answer', { questionId, text: 'Yo soy el vendedor' })), 403);
  bad(() => e.market.perform(e.seller.token, command('answer', { questionId, text: 'Sí', sellerId: e.other.account.id })), 400);
  e.market.perform(e.seller.token, command('answer', { questionId, text: 'Sí, es un guante para zurdos, de pruebas.' }));
  bad(() => e.market.perform(e.seller.token, command('answer', { questionId, text: 'Reescribir respuesta' })), 409);
  const feed = readMarketplaceSnapshot(e.open().read(undefined, { listing: listingId }));
  assert.equal(feed.viewer, null); assert.match(feed.questions[0].answer.text, /zurdos/);
  assert.deepEqual(feed.listings[0], before);
  assert.equal(feed.messages.length, 0);
});
test('public questions validate contact data and limits, paginate before returning records, and rate limits do not create duplicate questions', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 2 });
  for (const text of ['Correo persona@example.test', 'Llámame al 0412-123-4567', 'Tarjeta 1234 5678 1234 5678', 'x'.repeat(501), '']) {
    bad(() => e.market.perform(e.buyer.token, command('question', { listingId, text })), 400);
  }
  const questionId = e.market.perform(e.buyer.token, command('question', { listingId, text: '¿El modelo es de 2026?' })).entityId;
  bad(() => e.market.perform(e.buyer.token, command('question', { listingId, text: 'Otra pregunta inmediata' })), 429);
  bad(() => e.market.perform(e.seller.token, command('answer', { questionId, text: 'Escríbeme al seller@example.test' })), 400);
  for (let i = 0; i < 54; i++) { e.advance(2001); e.market.perform(e.buyer.token, command('question', { listingId, text: `Consulta deportiva ${i}` })); }
  const first = e.market.read(undefined, { listing: listingId });
  assert.equal(first.questions.length, 50); assert.equal(first.hasOlderQuestions, true);
  const older = e.market.read(undefined, { listing: listingId, beforeQuestion: first.questions[0].id });
  assert.equal(older.questions.length, 5); assert.equal(older.hasOlderQuestions, false);
  assert.ok(older.questions.at(-1).id < first.questions[0].id);
  bad(() => e.market.read(undefined, { beforeQuestion: 1 }), 400);
  assert.equal(e.market.read(e.buyer.token).orders.length, 0); assert.equal(e.market.read().listings[0].stock, 2);
});
test('question reports are privately reviewed and hiding a question also hides its answer without withdrawing the listing or affecting purchases', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 3 }); e.moderator();
  const questionId = e.market.perform(e.buyer.token, command('question', { listingId, text: 'Duda deportiva ficticia' })).entityId;
  e.market.perform(e.seller.token, command('answer', { questionId, text: 'Respuesta del vendedor a revisar' }));
  const report = command('report-question', { questionId, reason: 'Información engañosa en respuesta' });
  e.market.perform(e.buyer.token, report); e.open().perform(e.buyer.token, report);
  const reviewId = e.market.read(e.other.token).reviews[0].id;
  assert.equal(e.market.read(e.seller.token).reviews.length, 0); assert.equal(e.market.read().reviews.length, 0);
  assert.equal(e.market.read(e.other.token).reviews[0].questionId, questionId);
  bad(() => e.market.perform(e.seller.token, command('hide-question', { questionId, reason: 'Ocultar' })), 403);
  e.market.perform(e.other.token, command('review-report', { reviewId, decision: 'remove', reason: 'Respuesta oculta por incumplimiento' }));
  assert.equal(e.market.read(undefined, { listing: listingId }).questions.length, 0);
  assert.equal(e.market.read(e.seller.token, { listing: listingId }).questions.length, 0);
  const own = e.market.read(e.buyer.token, { listing: listingId }).questions[0];
  assert.equal(own.status, 'hidden'); assert.match(own.answer.text, /Respuesta/);
  assert.equal(e.market.read(e.other.token, { listing: listingId }).questions[0].status, 'hidden');
  assert.equal(e.market.read().listings[0].status, 'active'); assert.equal(e.market.read().listings[0].stock, 3);
  assert.equal(e.market.read(e.buyer.token).orders.length, 0);
  bad(() => e.market.perform(e.seller.token, command('answer', { questionId, text: 'Otra respuesta' })), 409);
});
test('confirmed purchases create exactly one private chat per order, including repeated purchases of the same listing, with no paid status or cross-account access', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 3 });
  const buy = command('buy', { listingId, quantity: 1 });
  const first = e.market.perform(e.buyer.token, buy).entityId; e.open().perform(e.buyer.token, buy);
  const second = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  const feed = readMarketplaceSnapshot(e.market.read(e.buyer.token));
  assert.deepEqual(feed.orders.map(order => order.status), ['confirmed', 'confirmed']);
  assert.equal(feed.conversations.length, 2); assert.deepEqual(feed.conversations.map(thread => thread.orderId), [second, first]);
  assert.equal(e.market.read(e.seller.token).conversations.length, 2); assert.equal(e.market.read(e.other.token).conversations.length, 0);
  const thread = e.market.perform(e.seller.token, command('start-thread', { orderId: first })).entityId;
  bad(() => e.market.perform(e.other.token, command('start-thread', { orderId: first })), 403);
  bad(() => e.market.read(e.other.token, { thread }), 403);
  e.market.perform(e.buyer.token, command('message', { threadId: thread, text: 'Coordinemos retiro y pago ficticios, sin dinero real.' }));
  assert.equal(e.market.read(e.seller.token, { thread }).messages.length, 1);
  assert.equal(e.market.read(undefined, { listing: listingId }).messages.length, 0);
  assert.equal(e.market.read(e.buyer.token).orders.find(order => order.id === first).status, 'confirmed');
  e.market.perform(e.buyer.token, command('update-order', { orderId: first, status: 'cancelled' }));
  assert.equal(e.market.read().listings[0].stock, 2);
});
test('auction questions do not place bids and only the actual winning order receives a private chat at fixed settlement', async t => {
  const e = await setup(t), listingId = e.publish({ type: 'auction', stock: 1, incrementCents: 100, endsAt: new Date(e.time() + 60000).toISOString() });
  e.market.perform(e.buyer.token, command('question', { listingId, text: '¿Qué talla es?' }));
  assert.equal(e.market.read().listings[0].bidCount, 0); assert.equal(e.market.read(e.buyer.token).conversations.length, 0);
  e.market.perform(e.buyer.token, command('bid', { listingId, amountCents: 1250 }));
  e.market.perform(e.other.token, command('bid', { listingId, amountCents: 1350 }));
  assert.equal(e.market.read(e.other.token).conversations.length, 0); e.advance(60000);
  const winner = e.open().read(e.other.token);
  assert.equal(winner.orders.length, 1); assert.equal(winner.orders[0].status, 'confirmed');
  assert.equal(winner.conversations.length, 1); assert.equal(winner.conversations[0].orderId, winner.orders[0].id);
  assert.equal(e.market.read(e.buyer.token).conversations.length, 0);
  bad(() => e.market.perform(e.buyer.token, command('question', { listingId, text: 'Después del cierre' })), 409);
});
test('version-three private inquiries and messages migrate byte-for-byte to read-only archives while legacy orders retain their original state and get separate private order chats', async t => {
  const e = await setup(t), listingId = e.publish();
  const orderId = e.market.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  const order = e.market.read(e.buyer.token).orders[0];
  order.status = 'reserved'; order.history[0].status = 'reserved'; order.history[0].note = 'Reserva anterior, no compra nueva.';
  const legacy = { id: 7, listingId, title: 'Consulta privada anterior', buyer: order.buyer, seller: order.seller, createdAt: order.createdAt };
  const message = { id: 9, threadId: 7, author: order.buyer, text: 'Mensaje anterior privado: no debe hacerse público', createdAt: order.createdAt };
  const raw = JSON.stringify(legacy), inspection = new DatabaseSync(e.path);
  inspection.exec(`PRAGMA foreign_keys=OFF; DROP TABLE market_threads;
    CREATE TABLE market_threads(id INTEGER PRIMARY KEY,listing_id INTEGER NOT NULL REFERENCES market_listings(id),
      buyer_id TEXT NOT NULL,seller_id TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(listing_id,buyer_id)) STRICT; PRAGMA user_version=3;`);
  inspection.prepare('INSERT INTO market_threads VALUES(?,?,?,?,?)').run(7, listingId, order.buyer.id, order.seller.id, raw);
  inspection.prepare('INSERT INTO market_messages VALUES(?,?,?,?,?)').run(9, 7, order.buyer.id, e.time(), JSON.stringify(message));
  inspection.prepare('UPDATE market_orders SET payload=? WHERE id=?').run(JSON.stringify(order), orderId);
  const second = e.open();
  assert.equal(second.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(inspection.prepare('SELECT payload FROM market_threads WHERE id=7').get().payload, raw);
  assert.equal(inspection.prepare('SELECT payload FROM market_messages WHERE id=9').get().payload, JSON.stringify(message));
  assert.equal(inspection.prepare('SELECT payload FROM market_orders WHERE id=?').get(orderId).payload, JSON.stringify(order));
  assert.equal(inspection.prepare('PRAGMA foreign_key_check').all().length, 0);
  const feed = second.read(e.buyer.token, { thread: 7 });
  assert.equal(feed.messages[0].text, message.text); assert.equal(feed.conversations.length, 2);
  assert.equal(feed.conversations.find(thread => thread.id === 7).orderId, null);
  assert.equal(feed.conversations.find(thread => thread.id !== 7).orderId, orderId);
  bad(() => second.perform(e.buyer.token, command('message', { threadId: 7, text: 'Nueva consulta privada antes de comprar' })), 409);
  assert.equal(second.read(undefined, { listing: listingId }).questions.length, 0);
  assert.equal(second.read().messages.length, 0); e.open(); assert.equal(second.read(e.buyer.token).conversations.length, 2);
  inspection.close();
});

test('favorites persist per actual account across service restarts, are idempotent and never purchase, bid or block stock', async t => {
  const e = await setup(t), listingId = e.publish({ stock: 3 });
  const before = e.market.read().listings[0];
  bad(() => e.market.perform(undefined, command('favorite', { listingId, saved: true })), 401);
  bad(() => e.market.perform(e.buyer.token, command('favorite', { listingId, saved: 'yes' })), 400);
  bad(() => e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true, accountId: e.other.account.id })), 400);
  bad(() => e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true, role: 'organizer' })), 400);
  bad(() => e.market.perform(e.buyer.token, command('favorite', { listingId: 999, saved: true })), 404);
  const save = command('favorite', { listingId, saved: true });
  const result = e.market.perform(e.buyer.token, save);
  assert.deepEqual(e.open().perform(e.buyer.token, save), result);
  const first = readMarketplaceSnapshot(e.market.read(e.buyer.token));
  e.advance(2001); e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true }));
  assert.equal(first.favorites.length, 1); assert.equal(e.market.read(e.buyer.token).favorites[0].savedAt, first.favorites[0].savedAt);
  assert.deepEqual(e.market.read().favorites, []); assert.deepEqual(e.market.read(e.other.token).favorites, []);
  assert.deepEqual(e.market.read().listings[0], before);
  assert.equal(first.orders.length, 0); assert.equal(first.bids.length, 0); assert.equal(first.conversations.length, 0);
  const auctionId = e.publish({ type: 'auction', stock: 1, incrementCents: 100, endsAt: new Date(e.time() + 120000).toISOString() });
  const auctionBefore = e.market.read().listings.find(item => item.id === auctionId);
  e.market.perform(e.buyer.token, command('favorite', { listingId: auctionId, saved: true }));
  const auctionSaved = e.market.read(e.buyer.token);
  assert.deepEqual(auctionSaved.favorites.find(item => item.listingId === auctionId).listing, auctionBefore);
  assert.equal(auctionSaved.bids.length, 0); assert.equal(auctionSaved.orders.length, 0); assert.equal(auctionSaved.conversations.length, 0);
  e.market.perform(e.buyer.token, command('favorite', { listingId: auctionId, saved: false }));
  e.market.perform(e.other.token, command('favorite', { listingId, saved: true }));
  const remove = command('favorite', { listingId, saved: false });
  e.market.perform(e.buyer.token, remove); e.open().perform(e.buyer.token, remove);
  assert.equal(e.market.read(e.buyer.token).favorites.length, 0); assert.equal(e.market.read(e.other.token).favorites.length, 1);
  e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true }));
  e.accounts.logout(e.buyer.token);
  assert.equal(e.market.read(e.buyer.token).favorites.length, 0);
  bad(() => e.market.perform(e.buyer.token, command('favorite', { listingId, saved: false })), 401);
  const inspection = new DatabaseSync(e.path);
  assert.equal(inspection.prepare('SELECT count(*) AS count FROM market_favorites WHERE account_id=?').get(e.buyer.account.id).count, 1); inspection.close();
});
test('closed favorites remain labeled by their current status while withdrawn or moderated favorites expose only removable references, even to moderators', async t => {
  const e = await setup(t), withdrawn = e.publish({ title: 'Artículo a retirar' }), removed = e.publish({ title: 'Título que no debe filtrarse' }); e.moderator();
  for (const listingId of [withdrawn, removed]) e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true }));
  e.market.perform(e.buyer.token, command('buy', { listingId: removed, quantity: 1 }));
  assert.equal(e.market.read(e.buyer.token).favorites.find(item => item.listingId === removed).listing.status, 'closed');
  e.market.perform(e.other.token, command('favorite', { listingId: removed, saved: true }));
  e.market.perform(e.seller.token, command('withdraw', { listingId: withdrawn }));
  e.market.perform(e.other.token, command('remove', { listingId: removed, reason: 'Incumplimiento deportivo confirmado' }));
  const favorites = readMarketplaceSnapshot(e.market.read(e.buyer.token)).favorites;
  assert.equal(favorites.length, 2); assert.ok(favorites.every(item => item.listing === null));
  assert.doesNotMatch(JSON.stringify(favorites), /Título que no debe filtrarse|Incumplimiento|Artículo a retirar/);
  assert.equal(e.market.read(e.other.token).favorites[0].listing, null);
  for (const listingId of [withdrawn, removed]) bad(() => e.market.perform(e.other.token, command('favorite', { listingId, saved: true })), 409);
  e.market.perform(e.buyer.token, command('favorite', { listingId: removed, saved: false }));
  assert.equal(e.market.read(e.buyer.token).favorites.length, 1);
  assert.equal(e.market.read(e.buyer.token).orders.length, 1);
});
test('grouped sport, condition, category, sale type, geography and Spanish search filter before pagination without narrowing private favorites or changing sport declarations', async t => {
  const e = await setup(t);
  for (let i = 0; i < 51; i++) e.publish({ title: `Artículo de BÉISBOL ${i}`, sport: i % 2 ? 'baseball' : 'softball', condition: 'new' });
  const elsewhere = e.publish({ title: 'BÉISBOL de otro estado', sport: 'softball', condition: 'new', stateId: 'VE-D', municipalityId: 'VE-D:girardot' });
  e.publish({ title: 'BÉISBOL categoría distinta', sport: 'softball', condition: 'new', category: 'clothing' });
  e.publish({ title: 'BÉISBOL de segunda mano', sport: 'baseball', condition: 'used' });
  e.publish({ title: 'BÉISBOL deporte distinto', sport: 'basketball', condition: 'new' });
  e.publish({ title: 'BÉISBOL subasta', sport: 'baseball', condition: 'new', type: 'auction', incrementCents: 100, endsAt: new Date(e.time() + 120000).toISOString() });
  for (const listingId of [1, elsewhere]) e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true }));
  const query = { state: 'VE-A', sport: 'baseball-softball', condition: 'new', category: 'equipment', type: 'sale', search: 'béisbol' };
  const first = e.market.read(e.buyer.token, query);
  assert.equal(first.listings.length, 50); assert.equal(first.hasMore, true);
  assert.ok(first.listings.every(item => ['baseball', 'softball'].includes(item.sport) && item.condition === 'new' && item.category === 'equipment' && item.type === 'sale' && item.stateId === 'VE-A'));
  assert.equal(first.favorites.length, 2);
  const second = e.market.read(undefined, { ...query, before: first.listings.at(-1).id });
  assert.equal(second.listings.length, 1); assert.equal(second.listings[0].id, 1); assert.equal(second.hasMore, false);
  assert.equal(e.market.read(undefined, { listing: elsewhere, ...query }).listings[0].id, elsewhere);
  assert.equal(e.market.read(undefined, { search: "' OR 1=1 --" }).listings.length, 0);
  for (const invalid of [{ sport: 'baseball' }, { sport: 'softball' }, { sport: 'general-commerce' }, { condition: 'broken' }, { category: 'electronics' }, { type: 'bid' }, { search: 'x'.repeat(101) }]) {
    bad(() => e.market.read(undefined, invalid), 400);
  }
});
test('version-four migration adds favorites without rewriting legacy listings and unspecified sports remain only in all-sport browsing', async t => {
  const e = await setup(t), listingId = e.publish(), inspection = new DatabaseSync(e.path);
  const listing = e.market.read().listings[0];
  for (const key of ['stateId', 'municipalityId', 'sport', 'sportsOnly']) delete listing[key];
  const raw = JSON.stringify(listing);
  inspection.prepare('UPDATE market_listings SET state_id=NULL,payload=? WHERE id=?').run(raw, listingId); inspection.exec('PRAGMA user_version=4;');
  e.open(); e.open();
  assert.equal(inspection.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(inspection.prepare('SELECT payload FROM market_listings WHERE id=?').get(listingId).payload, raw);
  assert.equal(e.market.read(undefined, { sport: 'baseball-softball' }).listings.length, 0);
  assert.equal(e.market.read(undefined, { condition: 'used' }).listings.length, 1);
  e.market.perform(e.buyer.token, command('favorite', { listingId, saved: true }));
  const saved = e.open().read(e.buyer.token).favorites[0].listing;
  assert.equal(saved.sport, null); assert.equal(saved.stateId, null); assert.equal(saved.sportsOnly, false);
  assert.equal(saved.priceCents, listing.priceCents); assert.equal(inspection.prepare('PRAGMA foreign_key_check').all().length, 0);
  inspection.close();
});
test('removed auctions retain bids without adjudication at deadline, and accepted appeals restore visibility but never reopen or award them', async t => {
  const e = await setup(t), id = e.publish({ type: 'auction', incrementCents: 100, endsAt: new Date(e.time() + 120000).toISOString() }); e.moderator();
  e.market.perform(e.buyer.token, command('bid', { listingId: id, amountCents: 1250 }));
  e.market.perform(e.other.token, command('remove', { listingId: id, reason: 'Artículo incumple las reglas deportivas' }));
  bad(() => e.market.perform(e.buyer.token, command('bid', { listingId: id, amountCents: 1350 })), 409);
  const appealId = e.market.perform(e.seller.token, command('appeal', { listingId: id, reason: 'Solicitud de revisión' })).entityId;
  e.market.perform(e.other.token, command('review-report', { reviewId: appealId, decision: 'restore', reason: 'Visibilidad restaurada, subasta detenida' }));
  assert.equal(e.market.read().listings[0].status, 'closed');
  e.advance(120000); const feed = e.open().read(e.buyer.token);
  assert.equal(feed.orders.length, 0); assert.equal(feed.bids.length, 1); assert.equal(feed.listings[0].bidCount, 1);
  bad(() => e.market.perform(e.seller.token, editing(e, id)), 409);
});
test('version-two reports migrate once without rewriting listing payloads, and owners can explicitly complete legacy listing metadata', async t => {
  const e = await setup(t), id = e.publish(), inspection = new DatabaseSync(e.path);
  const listing = e.market.read().listings[0];
  for (const key of ['revision', 'moderation', 'stateId', 'municipalityId', 'sport', 'sportsOnly']) delete listing[key];
  const raw = JSON.stringify(listing);
  inspection.prepare('UPDATE market_listings SET state_id=NULL,payload=? WHERE id=?').run(raw, id);
  inspection.prepare('INSERT INTO market_reports VALUES(?,?,?,?)').run(id, e.buyer.account.id, 'Reporte anterior', e.time());
  inspection.exec('PRAGMA user_version=2;'); e.open();
  assert.equal(inspection.prepare('SELECT payload FROM market_listings WHERE id=?').get(id).payload, raw);
  assert.equal(e.market.read(e.buyer.token).reviews.length, 1); e.open();
  assert.equal(e.market.read(e.buyer.token).reviews.length, 1);
  assert.equal(e.market.read(e.seller.token).myListings[0].sport, null);
  e.market.perform(e.seller.token, editing(e, id, { stateId: 'VE-A', municipalityId: 'VE-A:libertador', sport: 'baseball', sportsOnly: true }));
  assert.equal(e.market.read().listings[0].sportsOnly, true); assert.equal(e.market.read().listings[0].priceCents, 1250);
  inspection.close();
});
