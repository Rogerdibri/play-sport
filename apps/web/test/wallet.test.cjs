const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { readWalletBalance, readWalletSnapshot, readWalletRecharge, readWalletQuery, readMarketplaceOrder,
  readWalletRequestRecharge, readWalletReviewRecharge, readWalletPendingRecharge, readWalletRechargeRequest } = require('@playsport/shared');
const { POST: submitRecharge } = require('../app/api/wallet/recharges/route');
const { GET: proofDownload } = require('../app/api/wallet/recharges/[id]/proof/route');
const navigation = require('../app/navigation-hooks');
const platform = require('../app/platform-session');
const WalletPage = require('../app/wallet/page').default;
const { GET, POST } = require('../app/api/wallet/route');
const accountId = '12345678-1234-1234-1234-123456789abc';
const snapshot = { mode: 'test', currency: 'USD_DEMO', accountId, serverNow: '2026-11-08T12:00:00.000Z',
  recharges: [], rechargesHasMore: false, canReviewRecharges: false, rechargeReviews: [], rechargeReviewsHasMore: false,
  balance: { availableCents: 7500, heldCents: 2500, totalCents: 10000 }, hasMore: false,
  movements: [{ id: 1, eventId: 1, action: 'hold', module: 'marketplace', reference: 'order:1',
    description: '<script>Compra ficticia</script>', amountCents: 2500, availableDelta: -2500, heldDelta: 2500, createdAt: '2026-11-08T12:00:00Z' }] };
function render(t, data, guest = false) {
  const useState = React.useState; let index = 0;
  t.mock.method(React, 'useState', initial => {
    const current = index++;
    if (current === 0) return [data, () => {}];
    if (current === 3 && guest) return [true, () => {}];
    return useState(initial);
  });
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  t.mock.method(platform, 'usePlatformSession', () => ({ account: guest ? null : { id: accountId, displayName: 'Cuenta ficticia' } }));
  return renderToStaticMarkup(React.createElement(WalletPage));
}
test('wallet shows one available/held balance and private history, without separate service purses, real deposits, cards or withdrawals', t => {
  const html = render(t, snapshot);
  assert.match(html, /Mi billetera/); assert.match(html, /Un saldo común/); assert.match(html, /Disponible/); assert.match(html, /Retenido/);
  assert.match(html, /Enviar recarga para revisión/); assert.match(html, /sin aumentar tu saldo/);
  for (const method of ['Transferencia bancaria', 'Pago Móvil', 'Zelle', 'Binance']) assert.match(html, new RegExp(method));
  assert.match(html, /Soporte de pago/); assert.doesNotMatch(html, /Soporte de pago ficticio|USD FICTICIOS/); assert.match(html, /Crear comprobante de ejemplo/);
  assert.match(html, /NO REALICES PAGOS/); assert.match(html, /No es una tasa oficial ni de mercado/);
  assert.match(html, /apuestas e inscripciones de torneos todavía no están conectadas/);
  assert.match(html, /&lt;script&gt;Compra ficticia&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|Número de tarjeta|Saldo de apuestas|Saldo del marketplace/);
});
test('anonymous wallet access shows login rather than any other account balance or recharge controls', t => {
  const html = render(t, null, true);
  assert.match(html, /Inicia sesión para ver tu billetera/); assert.match(html, /Iniciar sesión o crear cuenta/);
  assert.doesNotMatch(html, /Enviar recarga para revisión|Movimientos de tu billetera|Compra ficticia|Soporte de pago/);
});
test('wallet DTOs reject negative or inconsistent balances, real-money claims, forged identities, malformed movement values and duplicate queries', () => {
  assert.deepEqual(readWalletSnapshot(snapshot), snapshot);
  assert.throws(() => readWalletBalance({ availableCents: -1, heldCents: 1, totalCents: 0 }));
  assert.throws(() => readWalletBalance({ availableCents: 100, heldCents: 100, totalCents: 100 }));
  for (const patch of [{ mode: 'real' }, { currency: 'USD' }, { accountId: 'manager-demo' }, { movements: [{ ...snapshot.movements[0], availableDelta: 0.5 }] }]) assert.throws(() => readWalletSnapshot({ ...snapshot, ...patch }));
  const recharge = { kind: 'recharge', amountCents: 10000, requestId: accountId };
  assert.deepEqual(readWalletRecharge(recharge), recharge);
  for (const patch of [{ accountId }, { role: 'fan' }, { amountCents: 0 }, { amountCents: 100000001 }, { amountCents: 1.5 }]) assert.throws(() => readWalletRecharge({ ...recharge, ...patch }));
  assert.deepEqual(readWalletQuery([['before', '51']]), { before: 51 });
  for (const entries of [[['before', '0']], [['before', '1'], ['before', '2']], [['accountId', accountId]]]) assert.throws(() => readWalletQuery(entries));
});
test('same-origin wallet proxy forwards cookies and preserves no-store while rejecting extra queries and oversized recharge requests', async t => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (url, options) => { forwarded = { url, options }; return new Response(JSON.stringify(snapshot), { status: 200 }); });
  const response = await GET(new NextRequest('http://localhost:3000/api/wallet?before=51', { headers: { Cookie: 'playsport-account=opaque' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(forwarded.url, /wallet\?before=51$/); assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
  for (const query of ['?before=0', '?before=1&before=2', '?accountId=other', '?currency=USD']) assert.equal((await GET(new NextRequest('http://localhost:3000/api/wallet' + query))).status, 400);
  assert.equal((await POST(new NextRequest('http://localhost:3000/api/wallet?before=1', { method: 'POST' }))).status, 400);
  assert.equal((await POST(new NextRequest('http://localhost:3000/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) }))).status, 413);
});
test('profiles, account and navigation link the same wallet; recharge retry keys survive reload and remain scoped to the authenticated account', () => {
  const { accountSections } = require('../app/account-navigation');
  assert.equal(accountSections.filter(section => section.href === '/wallet').length, 1);
  assert.match(readFileSync(join(__dirname, '../app/account/page.tsx'), 'utf8'), /accountSections\.map/);
  assert.doesNotMatch(readFileSync(join(__dirname, '../app/platform-session.tsx'), 'utf8'), /href="\/wallet"/);
  const source = readFileSync(join(__dirname, '../app/wallet/page.tsx'), 'utf8');
  assert.match(source, /playsport:wallet-pending:v1:\$\{id\}/); assert.match(source, /readWalletPendingRecharge\(JSON.parse\(saved\)\)/);
  assert.match(source, /JSON.stringify\(request.input\)/); assert.match(source, /accountEpoch/); assert.match(source, /expectedAccountId/);
  assert.doesNotMatch(source, /financialAccess: true|localStorage\.setItem|accountToken|password/);
});
test('old orders without payment metadata stay explicitly unpaid by the wallet, rather than acquiring fictitious paid or refunded status', () => {
  const actor = { id: accountId, displayName: 'Cuenta ficticia' };
  const order = { id: 1, listingId: 1, title: 'Compra anterior', type: 'sale', buyer: actor,
    seller: { ...actor, id: '87654321-1234-1234-1234-123456789abc' }, quantity: 1, totalCents: 1000,
    status: 'delivered', createdAt: snapshot.serverNow, history: [] };
  assert.equal(readMarketplaceOrder(order).payment, 'legacy-unpaid');
  assert.throws(() => readMarketplaceOrder({ ...order, payment: 'paid' }));
});
const recharge = { kind: 'request-recharge', requestId: accountId, expectedAccountId: accountId, amountCents: 10000,
  method: 'zelle', payerName: 'Persona ficticia', paidAt: snapshot.serverNow, reference: 'DEMO-000001', details: { email: 'pagador@example.invalid' } };
const request = { id: 1, accountId, amountCents: 10000, method: 'zelle', payerName: '<script>Nombre ficticio</script>', paidAt: snapshot.serverNow,
  reference: 'DEMO-000001', details: recharge.details, status: 'pending', createdAt: snapshot.serverNow,
  proof: { name: 'soporte-demo.pdf', type: 'application/pdf', size: 100 }, reviewedAt: null, reviewerId: null, reason: null, eventId: null };
test('method DTOs, account assertions, approval reasons and reload-persistent receipts are strictly validated', () => {
  assert.deepEqual(readWalletRequestRecharge(recharge), recharge);
  for (const patch of [{ accountId }, { expectedAccountId: 'manager-demo' }, { details: {} }, { details: { ...recharge.details, bank: 'forged' } },
    { details: { email: 'not-an-email' } }, { method: 'bank-api' }, { reference: '1' }]) assert.throws(() => readWalletRequestRecharge({ ...recharge, ...patch }));
  const review = { kind: 'review-recharge', requestId: accountId, expectedAccountId: accountId, rechargeId: 1, decision: 'approve', reason: 'Solo prueba', demoSelfReview: true };
  assert.deepEqual(readWalletReviewRecharge(review), review);
  for (const patch of [{ role: 'moderator' }, { reason: '' }, { decision: 'verified-by-bank' }, { demoSelfReview: 'true' }]) assert.throws(() => readWalletReviewRecharge({ ...review, ...patch }));
  const pending = { kind: 'pending-recharge', input: recharge, proof: { name: 'soporte-demo.pdf', data: 'data:application/pdf;base64,JVBERi0xLjQK' } };
  assert.deepEqual(readWalletPendingRecharge(JSON.parse(JSON.stringify(pending))), pending);
  assert.throws(() => readWalletPendingRecharge({ ...pending, proof: { ...pending.proof, data: 'data:text/html;base64,AAA=' } }));
  assert.deepEqual(readWalletRechargeRequest(request), request);
  for (const patch of [{ status: 'approved' }, { eventId: 1 }, { status: 'rejected' }, { proof: { ...request.proof, type: 'text/html' } }]) assert.throws(() => readWalletRechargeRequest({ ...request, ...patch }));
});
test('private requests show pending status without credits; local review and explicit demo self-consent never claim bank verification', t => {
  const html = render(t, { ...snapshot, recharges: [request], canReviewRecharges: true, rechargeReviews: [request] });
  assert.match(html, /Pendiente de revisión/); assert.match(html, /Descargar comprobante/);
  assert.match(html, /Revisión de recargas/); assert.match(html, /autorizo una autorrevisión/);
  assert.match(html, /Aprobar y acreditar saldo/); assert.match(html, /Rechazar sin acreditar/);
  assert.match(html, /comprobación bancaria por API no está conectada/);
  assert.match(html, /&lt;script&gt;Nombre ficticio&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('multipart proxy forwards only bounded same-origin receipt requests and keeps safe downloads private and uncached', async t => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (url, options) => { forwarded = { url, options };
    return new Response('private-receipt', { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename=\"soporte-demo.pdf\"" } }); });
  const form = new FormData(); form.append('input', JSON.stringify(recharge)); form.append('proof', new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }), 'soporte-demo.pdf');
  const response = await submitRecharge(new NextRequest('http://localhost:3000/api/wallet/recharges', { method: 'POST', headers: { Cookie: 'playsport-account=opaque', Origin: 'http://localhost:3000' }, body: form }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(forwarded.url, /wallet\/recharges$/); assert.match(forwarded.options.headers.get('content-type'), /^multipart\/form-data;/);
  assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
  assert.equal(forwarded.options.headers.get('origin'), 'http://localhost:3000');
  assert.equal((await submitRecharge(new NextRequest('http://localhost:3000/api/wallet/recharges?accountId=other', { method: 'POST' }))).status, 400);
  assert.equal((await submitRecharge(new NextRequest('http://localhost:3000/api/wallet/recharges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status, 415);
  assert.equal((await submitRecharge(new NextRequest('http://localhost:3000/api/wallet/recharges', { method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=demo' }, body: 'x'.repeat(2 * 1024 * 1024 + 8193) }))).status, 413);
  const download = await proofDownload(new NextRequest('http://localhost:3000/api/wallet/recharges/1/proof', { headers: { Cookie: 'playsport-account=opaque' } }), { params: Promise.resolve({ id: '1' }) });
  assert.equal(await download.text(), 'private-receipt'); assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition'), /^attachment;/); assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await proofDownload(new NextRequest('http://localhost:3000/api/wallet/recharges/1/proof?viewer=other'), { params: Promise.resolve({ id: '1' }) })).status, 400);
});
