const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { MarketplaceService } = require('../src/modules/marketplace/marketplace.service');
const { WalletService } = require('../src/modules/wallet/wallet.service');
const { WalletController } = require('../src/modules/wallet/wallet.controller');
const { readWalletSnapshot } = require('@playsport/shared');
const command = (kind, fields = {}) => ({ kind, ...fields, requestId: randomUUID() });
const httpWallet = wallet => Object.fromEntries(['read', 'recharge', 'submit', 'review', 'proof'].map(method => [method, wallet[method].bind(wallet)]));
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-wallet-'));
  let now = Date.parse('2026-11-08T12:00:00Z');
  const accounts = new AccountsService({ path: join(dir, 'accounts.sqlite'), now: () => now });
  const [buyer, seller, other] = await Promise.all(['buyer', 'seller', 'other'].map(name => accounts.register({
    email: `${name}@wallet.example.test`, displayName: `${name} ficticio`, password: 'Frase de pruebas de billetera 123456'
  }, name)));
  const path = join(dir, 'commerce.sqlite'), services = [];
  const market = () => { const service = new MarketplaceService(accounts, { path, now: () => now }); services.push(service); return service; };
  const wallet = () => { const service = new WalletService(accounts, { path, now: () => now }); services.push(service); return service; };
  const m = market(), w = wallet();
  t.after(() => { for (const service of services) service.onModuleDestroy(); accounts.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); });
  const publish = patch => m.perform(seller.token, command('publish', {
    type: 'sale', title: 'Artículo deportivo ficticio', description: 'Solo pruebas de pago.',
    category: 'equipment', condition: 'new', location: 'Estadio ficticio', photo: null,
    stateId: 'VE-A', municipalityId: 'VE-A:libertador', sport: 'baseball', sportsOnly: true,
    priceCents: 1250, stock: 3, incrementCents: 0, endsAt: null, ...patch
  })).entityId;
  return { dir, accounts, buyer, seller, other, path, market, wallet, m, w, publish,
    fund: (person, amountCents) => w.recharge(person.token, command('recharge', { amountCents })),
    advance: value => { now += value; }, time: () => now,
    moderator: () => writeFileSync(join(dir, 'moderators.json'), JSON.stringify({ version: 1, accountIds: [other.account.id] }), { mode: 0o600 }) };
}
const balance = (w, person) => w.read(person.token).balance;
function conserved(e) {
  const db = new DatabaseSync(e.path);
  assert.equal(db.prepare('SELECT v.id FROM wallet_events v JOIN wallet_entries e ON e.event_id=v.id GROUP BY v.id HAVING sum(e.available_delta+e.held_delta)<>0').all().length, 0);
  for (const person of [e.buyer, e.seller, e.other]) {
    const held = db.prepare("SELECT COALESCE(sum(amount),0) AS total FROM wallet_holds WHERE account_id=? AND status='held'").get(person.account.id).total;
    assert.equal(balance(e.w, person).heldCents, held);
  }
  db.close();
}
test('a single real-account wallet starts at zero, rejects forged owners and financial activation, and persists idempotent recharges across connections and restart', async t => {
  const e = await setup(t);
  bad(() => e.w.read(undefined), 401);
  bad(() => e.w.recharge(undefined, command('recharge', { amountCents: 1000 })), 401);
  assert.deepEqual(balance(e.w, e.buyer), { availableCents: 0, heldCents: 0, totalCents: 0 });
  for (const patch of [{ amountCents: 1.5 }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 100000001 }, { accountId: e.other.account.id }, { role: 'organizer' }, { currency: 'USD' }, { financialAccess: true }]) {
    bad(() => e.w.recharge(e.buyer.token, command('recharge', { amountCents: 1000, ...patch })), 400);
  }
  const input = command('recharge', { amountCents: 10000 }), first = e.w.recharge(e.buyer.token, input);
  assert.deepEqual(e.wallet().recharge(e.buyer.token, input), first);
  bad(() => e.wallet().recharge(e.buyer.token, { ...input, amountCents: 20000 }), 409);
  assert.equal(balance(e.w, e.buyer).availableCents, 10000);
  assert.equal(balance(e.w, e.other).availableCents, 0);
  e.w.recharge(e.other.token, input);
  assert.equal(balance(e.w, e.other).availableCents, 10000);
  assert.equal(e.accounts.authenticate(e.buyer.token).financialAccess, false);
  const read = readWalletSnapshot(e.wallet().read(e.buyer.token));
  assert.equal(read.accountId, e.buyer.account.id); assert.equal(read.movements.length, 1);
  e.accounts.logout(e.buyer.token); bad(() => e.w.read(e.buyer.token), 401);
  const resumed = await e.accounts.login({ email: 'buyer@wallet.example.test', password: 'Frase de pruebas de billetera 123456' }, 'buyer');
  assert.equal(e.wallet().read(resumed.token).balance.availableCents, 10000);
  conserved({ ...e, buyer: resumed });
});
test('purchase, stock and wallet hold commit together; seller receives funds only on buyer receipt and duplicate delivery does not pay twice', async t => {
  const e = await setup(t); e.fund(e.buyer, 10000);
  const listingId = e.publish(), buy = command('buy', { listingId, quantity: 2 });
  const orderId = e.m.perform(e.buyer.token, buy).entityId;
  assert.deepEqual(balance(e.w, e.buyer), { availableCents: 7500, heldCents: 2500, totalCents: 10000 });
  assert.equal(balance(e.w, e.seller).availableCents, 0);
  assert.equal(e.m.read(e.buyer.token).orders[0].payment, 'held');
  e.market().perform(e.buyer.token, buy);
  assert.equal(e.m.read().listings[0].stock, 1);
  e.m.perform(e.seller.token, command('update-order', { orderId, status: 'sent' }));
  bad(() => e.m.perform(e.buyer.token, command('update-order', { orderId, status: 'cancelled' })), 409);
  bad(() => e.m.perform(e.other.token, command('update-order', { orderId, status: 'delivered' })), 403);
  const delivery = command('update-order', { orderId, status: 'delivered' });
  e.m.perform(e.buyer.token, delivery); e.market().perform(e.buyer.token, delivery);
  assert.deepEqual(balance(e.w, e.buyer), { availableCents: 7500, heldCents: 0, totalCents: 7500 });
  assert.equal(balance(e.w, e.seller).availableCents, 2500);
  assert.equal(e.m.read(e.buyer.token).orders[0].payment, 'released');
  bad(() => e.m.perform(e.buyer.token, command('update-order', { orderId, status: 'delivered' })), 409);
  e.m.perform(e.buyer.token, command('update-order', { orderId, status: 'disputed', note: 'Reclamación posterior de prueba' }));
  assert.equal(balance(e.w, e.seller).availableCents, 2500);
  conserved(e);
});
test('pre-shipping cancellations refund once and restore stock; pre-receipt disputes keep the common balance held without automatic refunds or payouts', async t => {
  const e = await setup(t); e.fund(e.buyer, 10000);
  const listingId = e.publish({ stock: 1 });
  const orderId = e.m.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  const cancel = command('update-order', { orderId, status: 'cancelled' });
  e.m.perform(e.seller.token, cancel); e.market().perform(e.seller.token, cancel);
  assert.equal(balance(e.w, e.buyer).availableCents, 10000);
  assert.equal(e.m.read().listings[0].stock, 1);
  assert.equal(e.m.read(e.buyer.token).orders[0].payment, 'refunded');
  const second = e.m.perform(e.buyer.token, command('buy', { listingId, quantity: 1 })).entityId;
  e.m.perform(e.seller.token, command('update-order', { orderId: second, status: 'sent' }));
  e.m.perform(e.buyer.token, command('update-order', { orderId: second, status: 'disputed', note: 'No llegó el artículo ficticio' }));
  bad(() => e.m.perform(e.buyer.token, command('update-order', { orderId: second, status: 'delivered' })), 409);
  assert.equal(balance(e.w, e.buyer).heldCents, 1250); assert.equal(balance(e.w, e.seller).totalCents, 0);
  conserved(e);
});
test('insufficient common funds cannot buy a second product through another connection, and a chat insertion failure rolls back stock, order and ledger together', async t => {
  const e = await setup(t); e.fund(e.buyer, 1250);
  const first = e.publish({ stock: 1 }), second = e.publish({ stock: 1 });
  e.m.perform(e.buyer.token, command('buy', { listingId: first, quantity: 1 }));
  const before = e.m.read().listings.find(item => item.id === second);
  bad(() => e.market().perform(e.buyer.token, command('buy', { listingId: second, quantity: 1 })), 402);
  assert.deepEqual(e.m.read().listings.find(item => item.id === second), before);
  assert.equal(e.m.read(e.buyer.token).orders.length, 1);
  e.fund(e.other, 1250);
  const db = new DatabaseSync(e.path);
  db.exec("CREATE TRIGGER fail_chat BEFORE INSERT ON market_threads BEGIN SELECT RAISE(ABORT,'Forced atomic rollback'); END;");
  assert.throws(() => e.m.perform(e.other.token, command('buy', { listingId: second, quantity: 1 })), /Forced atomic rollback/);
  assert.equal(balance(e.w, e.other).availableCents, 1250); assert.equal(balance(e.w, e.other).heldCents, 0);
  assert.deepEqual(e.m.read().listings.find(item => item.id === second), before);
  db.exec('DROP TRIGGER fail_chat;'); db.close(); conserved(e);
});
test('new auctions hold only the current leader, self-raises reuse retained funds, failed competing bids roll back refunds, and fixed award converts the hold exactly once', async t => {
  const e = await setup(t); e.fund(e.buyer, 1000); e.fund(e.other, 5000);
  const listingId = e.publish({ type: 'auction', stock: 1, priceCents: 300, incrementCents: 100, endsAt: new Date(e.time() + 60000).toISOString() });
  e.m.perform(e.buyer.token, command('bid', { listingId, amountCents: 300 }));
  e.m.perform(e.buyer.token, command('bid', { listingId, amountCents: 400 }));
  assert.deepEqual(balance(e.w, e.buyer), { availableCents: 600, heldCents: 400, totalCents: 1000 });
  e.m.perform(e.other.token, command('bid', { listingId, amountCents: 600 }));
  assert.equal(balance(e.w, e.buyer).availableCents, 1000); assert.equal(balance(e.w, e.buyer).heldCents, 0);
  bad(() => e.m.perform(e.buyer.token, command('bid', { listingId, amountCents: 1200 })), 402);
  assert.equal(e.m.read().listings[0].currentBidCents, 600); assert.equal(e.m.read().listings[0].bidCount, 3);
  assert.equal(balance(e.w, e.other).heldCents, 600);
  e.advance(60000);
  const order = e.market().read(e.other.token).orders[0]; e.m.read();
  assert.equal(order.totalCents, 600); assert.equal(order.payment, 'held');
  assert.deepEqual(balance(e.w, e.other), { availableCents: 4400, heldCents: 600, totalCents: 5000 });
  assert.equal(e.m.read(e.other.token).orders.length, 1);
  assert.equal(e.w.read(e.other.token).movements.filter(entry => entry.action === 'award').length, 1);
  e.m.perform(e.seller.token, command('update-order', { orderId: order.id, status: 'sent' }));
  e.m.perform(e.other.token, command('update-order', { orderId: order.id, status: 'delivered' }));
  assert.equal(balance(e.w, e.seller).availableCents, 600); conserved(e);
});
test('moderated auctions refund their leader, preserve bid history, and an accepted appeal never recreates a hold or awards stopped bids', async t => {
  const e = await setup(t); e.fund(e.buyer, 1000); e.moderator();
  const listingId = e.publish({ type: 'auction', stock: 1, priceCents: 300, incrementCents: 100, endsAt: new Date(e.time() + 60000).toISOString() });
  e.m.perform(e.buyer.token, command('bid', { listingId, amountCents: 300 }));
  e.m.perform(e.other.token, command('remove', { listingId, reason: 'Retiro deportivo ficticio' }));
  assert.equal(balance(e.w, e.buyer).availableCents, 1000); assert.equal(balance(e.w, e.buyer).heldCents, 0);
  const reviewId = e.m.perform(e.seller.token, command('appeal', { listingId, reason: 'Solicito revisión ficticia' })).entityId;
  e.m.perform(e.other.token, command('review-report', { reviewId, decision: 'restore', reason: 'Restaurar solo visibilidad' }));
  e.advance(60000); const result = e.m.read(e.buyer.token);
  assert.equal(result.orders.length, 0); assert.equal(result.bids.length, 1);
  assert.equal(balance(e.w, e.buyer).heldCents, 0); conserved(e);
});
test('legacy version-five listings and orders migrate byte-for-byte without creating funds, legacy auctions close without charges and legacy deliveries never pay twice', async t => {
  const e = await setup(t), listingId = e.publish({ type: 'auction', stock: 1, priceCents: 300, incrementCents: 100, endsAt: new Date(e.time() + 60000).toISOString() });
  const db = new DatabaseSync(e.path), listing = e.m.read().listings[0]; delete listing.walletBacked;
  const payload = JSON.stringify(listing);
  db.prepare('UPDATE market_listings SET payload=? WHERE id=?').run(payload, listingId);
  db.prepare('INSERT INTO market_bids VALUES(?,?,?,?,?,?,?)').run(1, listingId, e.buyer.account.id, e.buyer.account.displayName, 300, e.time(),
    JSON.stringify({ id: 1, listingId, title: listing.title, amountCents: 300, createdAt: new Date(e.time()).toISOString() }));
  db.exec('PRAGMA user_version=5;');
  const migrated = e.market();
  assert.equal(db.prepare('SELECT payload FROM market_listings WHERE id=?').get(listingId).payload, payload);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  bad(() => migrated.perform(e.other.token, command('bid', { listingId, amountCents: 400 })), 409);
  e.advance(60000); const order = migrated.read(e.buyer.token).orders[0];
  assert.equal(order.payment, 'legacy-unpaid'); assert.equal(balance(e.w, e.buyer).totalCents, 0);
  const raw = db.prepare('SELECT payload FROM market_orders WHERE id=?').get(order.id).payload;
  delete order.payment; db.prepare('UPDATE market_orders SET payload=? WHERE id=?').run(JSON.stringify(order), order.id);
  const legacyRaw = db.prepare('SELECT payload FROM market_orders WHERE id=?').get(order.id).payload;
  db.exec('PRAGMA user_version=5;'); e.market();
  assert.equal(db.prepare('SELECT payload FROM market_orders WHERE id=?').get(order.id).payload, legacyRaw);
  assert.notEqual(raw, legacyRaw);
  migrated.perform(e.seller.token, command('update-order', { orderId: order.id, status: 'sent' }));
  migrated.perform(e.buyer.token, command('update-order', { orderId: order.id, status: 'delivered' }));
  assert.equal(balance(e.w, e.seller).totalCents, 0); assert.equal(e.w.read(e.buyer.token).movements.length, 0);
  db.close(); conserved(e);
});
test('wallet history paginates only the authenticated account, ledger is balanced and immutable, and rate limiting does not silently credit new funds', async t => {
  const e = await setup(t);
  for (let i = 0; i < 55; i++) e.fund(e.buyer, 100);
  const first = readWalletSnapshot(e.w.read(e.buyer.token));
  assert.equal(first.movements.length, 50); assert.equal(first.hasMore, true);
  const second = e.w.read(e.buyer.token, first.movements.at(-1).id);
  assert.equal(second.movements.length, 5); assert.equal(second.hasMore, false);
  assert.equal(e.w.read(e.other.token).movements.length, 0); assert.equal(balance(e.w, e.buyer).availableCents, 5500);
  for (let i = 0; i < 5; i++) e.fund(e.buyer, 100);
  bad(() => e.fund(e.buyer, 100), 429);
  assert.equal(balance(e.w, e.buyer).availableCents, 6000);
  const db = new DatabaseSync(e.path);
  assert.throws(() => db.prepare('UPDATE wallet_entries SET available_delta=999 WHERE id=1').run(), /Immutable/);
  assert.throws(() => db.prepare('DELETE FROM wallet_events WHERE id=1').run(), /Immutable/);
  db.close(); conserved(e);
});
test('wallet HTTP access is private, no-store, cookie-authenticated and same-origin; unknown or duplicate queries and forged recharge payloads fail explicitly', async t => {
  const e = await setup(t);
  class TestModule {}
  Module({ controllers: [WalletController], providers: [{ provide: WalletService, useValue: httpWallet(e.w) }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false }); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/wallet`;
  assert.equal((await fetch(url)).status, 401);
  for (const query of ['?accountId=other', '?before=1&before=2', '?before=0', '?payment=real']) assert.equal((await fetch(url + query)).status, 400);
  const body = command('recharge', { amountCents: 1000 });
  const send = (origin, input = body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: `playsport-account=${e.buyer.token}` }, body: JSON.stringify(input) });
  assert.equal((await send('http://other.example.test')).status, 403);
  assert.equal((await send('http://localhost:3000', { ...body, accountId: e.other.account.id })).status, 400);
  assert.equal((await send('http://localhost:3000')).status, 409);
  assert.equal(balance(e.w, e.buyer).availableCents, 0);
  e.w.recharge(e.buyer.token, body);
  assert.equal((await send('http://localhost:3000')).status, 201);
  const response = await fetch(url, { headers: { Cookie: `playsport-account=${e.buyer.token}` } });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).balance.availableCents, 1000); conserved(e);
});
const receipt = (tag = randomUUID()) => {
  const buffer = Buffer.from(`%PDF-1.4\nComprobante ficticio ${tag}\n%%EOF\n`);
  return { buffer, originalname: 'comprobante-demo.pdf', mimetype: 'application/pdf', size: buffer.length };
};
function rechargeInput(e, method = 'transfer', patch = {}) {
  const details = { transfer: { bank: 'Banco de prueba', accountLastFour: '0000', identification: 'DEMO-00000000' },
    pagomovil: { bank: 'Banco de prueba', phone: '04000000000', identification: 'DEMO-00000000' },
    zelle: { email: 'pagador@example.invalid' }, binance: { payId: 'DEMO-PAGADOR-0000' } }[method];
  return command('request-recharge', { expectedAccountId: e.buyer.account.id, amountCents: 10000, method,
    payerName: 'Persona ficticia', paidAt: new Date(e.time()).toISOString(), reference: `DEMO-${randomUUID()}`, details, ...patch });
}
const reviewInput = (person, id, patch = {}) => command('review-recharge', {
  expectedAccountId: person.account.id, rechargeId: id, decision: 'approve', reason: 'Comprobante ficticio revisado', demoSelfReview: false, ...patch });
test('four recharge methods require matching details and real file signatures, remain private and never credit pending requests', async t => {
  const e = await setup(t);
  for (const method of ['transfer', 'pagomovil', 'zelle', 'binance']) {
    const input = rechargeInput(e, method), file = receipt();
    bad(() => e.w.submit(undefined, input, file), 401);
    bad(() => e.w.submit(e.buyer.token, { ...input, details: {} }, file), 400);
    bad(() => e.w.submit(e.other.token, input, file), 409);
    const result = e.w.submit(e.buyer.token, input, file);
    assert.equal(e.w.proof(e.buyer.token, result.rechargeId).buffer.length, file.size);
    bad(() => e.w.proof(e.other.token, result.rechargeId), 404);
    assert.equal(e.w.read(e.buyer.token).recharges.find(row => row.id === result.rechargeId).status, 'pending');
  }
  assert.equal(e.w.read(e.other.token).recharges.length, 0); assert.equal(e.w.read(e.other.token).rechargeReviews.length, 0);
  assert.equal(balance(e.w, e.buyer).totalCents, 0); assert.equal(e.w.read(e.buyer.token).movements.length, 0);
  const input = rechargeInput(e), file = receipt();
  for (const patch of [{ accountId: e.other.account.id }, { role: 'moderator' }, { paidAt: 'invalid' }, { paidAt: new Date(e.time() + 600000).toISOString() }]) bad(() => e.w.submit(e.buyer.token, { ...input, ...patch }, file), 400);
  for (const upload of [undefined, { ...file, size: 0 }, { ...file, originalname: '../payment.pdf' }, { ...file, originalname: 'payment.html' },
    { ...file, mimetype: 'image/png' }, { ...file, buffer: Buffer.from('<svg>not a receipt</svg>'), size: 23 }]) bad(() => e.w.submit(e.buyer.token, input, upload), 400);
  conserved(e);
});
test('only an authorized local reviewer credits the authenticated request owner, once, with restart-safe decisions and preserved ledger balance', async t => {
  const e = await setup(t); e.moderator();
  const { rechargeId } = e.w.submit(e.buyer.token, rechargeInput(e), receipt());
  const decision = reviewInput(e.other, rechargeId);
  bad(() => e.w.review(e.seller.token, { ...decision, expectedAccountId: e.seller.account.id }), 403);
  bad(() => e.w.review(e.other.token, { ...decision, expectedAccountId: e.buyer.account.id }), 409);
  assert.equal(e.w.read(e.other.token).canReviewRecharges, true);
  assert.equal(e.w.read(e.other.token).rechargeReviews.length, 1);
  assert.equal(e.w.proof(e.other.token, rechargeId).type, 'application/pdf');
  const first = e.w.review(e.other.token, decision);
  assert.deepEqual(e.wallet().review(e.other.token, decision), first);
  bad(() => e.w.review(e.other.token, { ...decision, reason: 'Otro motivo' }), 409);
  bad(() => e.w.review(e.other.token, reviewInput(e.other, rechargeId)), 409);
  assert.equal(balance(e.w, e.buyer).availableCents, 10000); assert.equal(balance(e.w, e.other).totalCents, 0);
  const row = e.w.read(e.buyer.token).recharges[0];
  assert.equal(row.status, 'approved'); assert.equal(row.reviewerId, e.other.account.id); assert.equal(row.eventId, e.w.read(e.buyer.token).movements[0].eventId);
  assert.match(e.w.read(e.buyer.token).movements[0].description, /Transferencia bancaria/);
  assert.equal(e.w.read(e.other.token).rechargeReviews.length, 0);
  const db = new DatabaseSync(e.path);
  assert.throws(() => db.prepare('DELETE FROM wallet_recharge_requests WHERE id=?').run(rechargeId), /Immutable/);
  assert.throws(() => db.prepare("UPDATE wallet_recharge_requests SET status='pending' WHERE id=?").run(rechargeId), /Final/);
  assert.throws(() => db.exec('DELETE FROM wallet_recharge_reviews'), /Immutable/);
  db.close(); conserved(e);
});
test('self-review requires an explicit demo exception and remains impossible without local moderation or in production', async t => {
  const e = await setup(t);
  writeFileSync(join(e.dir, 'moderators.json'), JSON.stringify({ version: 1, accountIds: [e.buyer.account.id] }));
  const { rechargeId } = e.w.submit(e.buyer.token, rechargeInput(e), receipt());
  bad(() => e.w.review(e.buyer.token, reviewInput(e.buyer, rechargeId)), 403);
  const env = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(e.w.read(e.buyer.token).canReviewRecharges, false);
    bad(() => e.w.review(e.buyer.token, reviewInput(e.buyer, rechargeId, { demoSelfReview: true })), 403);
  } finally { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; }
  e.w.review(e.buyer.token, reviewInput(e.buyer, rechargeId, { demoSelfReview: true }));
  assert.equal(balance(e.w, e.buyer).availableCents, 10000); conserved(e);
});
test('recharge submission retries preserve proof and nonce; duplicate payments and proofs cannot credit twice, and rejection allows a corrected request', async t => {
  const e = await setup(t); e.moderator();
  const input = rechargeInput(e), file = receipt(), first = e.w.submit(e.buyer.token, input, file);
  assert.equal(e.wallet().submit(e.buyer.token, input, file).rechargeId, first.rechargeId);
  bad(() => e.w.submit(e.buyer.token, { ...input, amountCents: 20000 }, file), 409);
  bad(() => e.w.submit(e.buyer.token, input, receipt()), 409);
  bad(() => e.w.submit(e.buyer.token, { ...input, requestId: randomUUID() }, receipt()), 409);
  bad(() => e.w.submit(e.buyer.token, rechargeInput(e), file), 409);
  e.w.review(e.other.token, reviewInput(e.other, first.rechargeId, { decision: 'reject', reason: 'Soporte de prueba incorrecto' }));
  assert.equal(balance(e.w, e.buyer).availableCents, 0); assert.equal(e.w.read(e.buyer.token).movements.length, 0);
  const corrected = e.w.submit(e.buyer.token, { ...input, requestId: randomUUID() }, file);
  e.w.review(e.other.token, reviewInput(e.other, corrected.rechargeId));
  bad(() => e.w.submit(e.buyer.token, { ...input, requestId: randomUUID() }, receipt()), 409);
  assert.equal(e.w.read(e.buyer.token).recharges.length, 2); assert.equal(balance(e.w, e.buyer).availableCents, 10000); conserved(e);
});
test('pending request limits and approval failures rollback without losing the proof, changing the decision or crediting any account', async t => {
  const e = await setup(t); e.moderator();
  const id = e.w.submit(e.buyer.token, rechargeInput(e), receipt()).rechargeId;
  const db = new DatabaseSync(e.path);
  db.exec("CREATE TRIGGER fail_review_test BEFORE INSERT ON wallet_events WHEN NEW.reference LIKE 'recharge:reviewed:%' BEGIN SELECT RAISE(ABORT,'Test review failure'); END;");
  assert.throws(() => e.w.review(e.other.token, reviewInput(e.other, id)), /Test review failure/);
  assert.equal(e.w.read(e.buyer.token).recharges[0].status, 'pending'); assert.equal(balance(e.w, e.buyer).availableCents, 0);
  assert.throws(() => db.prepare("UPDATE wallet_recharge_requests SET payload=json_set(payload,'$.amountCents',20000) WHERE id=?").run(id), /Immutable/);
  db.exec('DROP TRIGGER fail_review_test'); db.close();
  for (let i = 0; i < 9; i++) e.w.submit(e.buyer.token, rechargeInput(e), receipt());
  bad(() => e.w.submit(e.buyer.token, rechargeInput(e), receipt()), 409);
  assert.equal(e.w.read(e.buyer.token).recharges.length, 10); conserved(e);
});
test('private request history paginates and wallet schema upgrade preserves prior ledger, funds and marketplace rows', async t => {
  const e = await setup(t); e.moderator(); e.fund(e.buyer, 500);
  const listingId = e.publish(), db = new DatabaseSync(e.path);
  const original = db.prepare('SELECT * FROM wallet_events').all();
  const listing = db.prepare('SELECT * FROM market_listings WHERE id=?').get(listingId);
  db.exec('UPDATE wallet_schema SET version=1'); const restarted = e.wallet();
  assert.equal(db.prepare('SELECT version FROM wallet_schema').get().version, 2);
  assert.deepEqual(db.prepare('SELECT * FROM wallet_events').all(), original);
  assert.deepEqual(db.prepare('SELECT * FROM market_listings WHERE id=?').get(listingId), listing);
  for (let i = 0; i < 55; i++) {
    const id = restarted.submit(e.buyer.token, rechargeInput(e), receipt()).rechargeId;
    restarted.review(e.other.token, reviewInput(e.other, id));
  }
  const first = restarted.read(e.buyer.token);
  assert.equal(first.recharges.length, 50); assert.equal(first.rechargesHasMore, true);
  const next = restarted.read(e.buyer.token, undefined, first.recharges.at(-1).id);
  assert.equal(next.recharges.length, 5); assert.equal(next.rechargesHasMore, false);
  assert.equal(restarted.read(e.seller.token).recharges.length, 0); db.close(); conserved(e);
});
test('multipart recharge HTTP stores private receipts, rejects forged MIME and origin, and serves only safe authenticated downloads', async t => {
  const e = await setup(t); e.moderator();
  class TestModule {}
  Module({ controllers: [WalletController], providers: [{ provide: WalletService, useValue: httpWallet(e.w) }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false }); app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/wallet`;
  const input = rechargeInput(e), file = receipt();
  const send = (origin = 'http://localhost:3000', body = input, type = file.mimetype) => {
    const form = new FormData(); form.append('input', JSON.stringify(body)); form.append('proof', new Blob([file.buffer], { type }), file.originalname);
    return fetch(url + '/recharges', { method: 'POST', headers: { Origin: origin, Cookie: `playsport-account=${e.buyer.token}` }, body: form });
  };
  assert.equal((await send('http://untrusted.example.test')).status, 403);
  assert.equal((await send(undefined, input, 'image/png')).status, 400);
  const response = await send(); assert.equal(response.status, 201, await response.clone().text());
  const { rechargeId } = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const proofUrl = `${url}/recharges/${rechargeId}/proof`;
  assert.equal((await fetch(proofUrl)).status, 401);
  assert.equal((await fetch(proofUrl, { headers: { Cookie: `playsport-account=${e.seller.token}` } })).status, 404);
  const proof = await fetch(proofUrl, { headers: { Cookie: `playsport-account=${e.other.token}` } });
  assert.equal(proof.status, 200); assert.equal(proof.headers.get('content-type'), 'application/pdf');
  assert.equal(proof.headers.get('cache-control'), 'no-store'); assert.equal(proof.headers.get('x-content-type-options'), 'nosniff');
  assert.match(proof.headers.get('content-disposition'), /^attachment;/); assert.deepEqual(Buffer.from(await proof.arrayBuffer()), file.buffer);
  assert.equal(balance(e.w, e.buyer).availableCents, 0); conserved(e);
});
