const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { marketplaceCategories, marketplaceSportFilters, marketplaceListingMatchesFilters, readMarketplaceQuery, readMarketplaceFavorite, minimumMarketplaceBid, parseMarketplacePrice, marketplacePrice, readMarketplaceSnapshot,
  DemoProfileStore, newDemoPersonalProfile, demoProfileLocation } = require('@playsport/shared');
const navigation = require('../app/navigation-hooks');
const Marketplace = require('../app/demo/[slug]/marketplace').default;
const { marketplaceRequestId } = require('../app/demo/[slug]/marketplace');
const { MarketplaceListingEditor, MarketplaceReviews, canEditMarketplaceListing } = require('../app/demo/[slug]/marketplace-administration');
const { MarketplaceQuestions } = require('../app/demo/[slug]/marketplace-questions');
const { GET, POST } = require('../app/api/marketplace/route');
const { GET: photoGET } = require('../app/api/marketplace/photos/[filename]/route');
const { demoModules, demoModuleHref, demoIdentity } = require('../app/platform-navigation');
const platform = require('../app/platform-session');
const locationModule = require('../app/demo/[slug]/marketplace-location');

const seller = { id: '12345678-1234-1234-1234-123456789abc', displayName: 'Vendedor ficticio' };
const buyer = { id: '87654321-1234-1234-1234-123456789abc', displayName: 'Comprador ficticio' };
const listing = { id: 1, seller, type: 'sale', title: 'Guante de pruebas', description: 'Mercancía ficticia',
  category: 'equipment', condition: 'used', location: 'Estadio ficticio', photo: null, priceCents: 1250,
  stateId: null, municipalityId: null, sport: null, sportsOnly: false,
  stock: 3, incrementCents: 0, endsAt: null, currentBidCents: null, bidCount: 0, status: 'active', createdAt: new Date().toISOString(), revision: 0, moderation: null, walletBacked: false };
const snapshot = { mode: 'test', currency: 'USD_DEMO', serverNow: new Date().toISOString(), viewer: buyer, sessionExpired: false,
  listings: [listing, { ...listing, id: 2, type: 'auction', stock: 1, incrementCents: 100, endsAt: new Date(Date.now() + 3600000).toISOString() }],
  hasMore: false, myListings: [], orders: [], bids: [], conversations: [], messages: [], hasOlderMessages: false,
  canModerate: false, reviews: [], reviewListings: [], audits: [], questions: [], hasOlderQuestions: false, favorites: [],
  walletBalance: { availableCents: 100000, heldCents: 0, totalCents: 100000 } };
const render = (t, data = snapshot) => {
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  t.mock.method(locationModule, 'useMarketplaceProfileLocation', () => ({ location: null, ready: true, error: '', retry() {} }));
  t.mock.method(navigation, 'useNavigationDraft', (_scope, initial) => [initial, () => {}, true]);
  return renderToStaticMarkup(React.createElement(Marketplace, { initialSnapshot: data }));
};

test('marketplace request IDs stay cryptographically random UUID v4 on HTTP LAN origins without crypto.randomUUID', t => {
  t.mock.method(global.crypto, 'randomUUID', () => { throw new Error('Unavailable on the HTTP phone origin'); });
  const real = marketplaceRequestId();
  assert.match(real, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(marketplaceRequestId(), real);
  t.mock.method(global.crypto, 'getRandomValues', array => { array.fill(0); return array; });
  assert.equal(marketplaceRequestId(), '00000000-0000-4000-8000-000000000000');
});

test('photo proxy uses same-origin references, validates filenames and forwards JPEG bytes without account credentials', async t => {
  const filename = `${'a'.repeat(64)}.jpg`;
  const url = `http://localhost:3000/api/marketplace/photos/${filename}`;
  const context = { params: Promise.resolve({ filename }) };
  const bytes = new Uint8Array([255, 216, 255, 217]);
  let forwarded;
  t.mock.method(global, 'fetch', async (url, options) => {
    forwarded = { url, options };
    return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg' } });
  });
  const response = await photoGET(new NextRequest(url, { headers: { Cookie: 'playsport-account=private' } }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.match(forwarded.url, new RegExp(`/marketplace/photos/${filename}$`));
  assert.equal(forwarded.options.headers, undefined);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control'), /immutable/);
  assert.equal((await photoGET(new NextRequest(url + '?path=other'), context)).status, 400);
  for (const filename of ['../accounts.sqlite', 'https://other.example/photo.jpg', 'photo.svg']) {
    assert.equal((await photoGET(new NextRequest(url), { params: Promise.resolve({ filename }) })).status, 400);
  }
  const html = render(t, { ...snapshot, listings: [{ ...listing, photo: `/api/marketplace/photos/${filename}` }] });
  assert.match(html, new RegExp(`src="/api/marketplace/photos/${filename}"`));
  assert.doesNotMatch(html, /data:image/);
  assert.throws(() => readMarketplaceSnapshot({ ...snapshot, listings: [{ ...listing, photo: 'data:image/jpeg;base64,/9j/2Q==' }] }));
});

test('missing and unavailable photos return explicit uncached errors rather than an image fallback', async t => {
  const filename = `${'b'.repeat(64)}.jpg`;
  const request = new NextRequest(`http://localhost:3000/api/marketplace/photos/${filename}`);
  const context = { params: Promise.resolve({ filename }) };
  t.mock.method(global, 'fetch', async () => new Response('missing', { status: 404 }));
  assert.equal((await photoGET(request, context)).status, 404);
  global.fetch.mock.restore();
  t.mock.method(global, 'fetch', async () => new Response('<html>upstream failure</html>', { headers: { 'content-type': 'text/html' } }));
  t.mock.method(console, 'error', () => {});
  const response = await photoGET(request, context);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json()).message, /No se pudo cargar/);
});

test('all six roles link the same account-based marketplace without claiming real payments are enabled', t => {
  const module = demoModules.find(item => item.id === 'marketplace');
  assert.equal(module.status, 'partial');
  for (const role of ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']) {
    assert.equal(demoModuleHref(module, { version: 1, role, team: 'team-A' }), '/demo/marketplace');
  }
  const html = render(t);
  assert.doesNotMatch(html, /USD FICTICIOS|PRUEBAS ·|Subasta · demo/);
  assert.match(html, /Compra, vende y subasta/); assert.match(html, /Subasta/);
  assert.match(html, /Mis compras/); assert.match(html, /Mis ventas/); assert.match(html, />Mensajes<\/button>/);
  assert.match(html, /Mis favoritos/); assert.match(html, /Guardar en favoritos/);
  assert.match(html, /Comprador ficticio/);
  assert.match(html, /Saldo disponible/); assert.match(html, /Mi billetera/);
  assert.doesNotMatch(html, /Cuenta verificada|type="password"|Número de tarjeta/);
});
test('anonymous browsing remains public and safe text is escaped rather than rendered as seller HTML', t => {
  const html = render(t, { ...snapshot, viewer: null, listings: [{ ...listing, title: '<script>alert(1)</script>' }] });
  assert.match(html, /Iniciar sesión/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
test('marketplace navigation uses short Messages and Reports labels for ordinary accounts and moderators', t => {
  const ordinary = render(t);
  assert.match(ordinary, />Reportes<\/button>/); assert.doesNotMatch(ordinary, />Mensajes privados<\/button>|>Reportes y apelaciones<\/button>|>Moderación y reportes<\/button>/);
  navigation.useNavigationBusy.mock.restore(); navigation.useNavigationDraft.mock.restore(); locationModule.useMarketplaceProfileLocation.mock.restore();
  const moderator = render(t, { ...snapshot, canModerate: true });
  assert.match(moderator, />Reportes<\/button>/); assert.match(moderator, />Mensajes<\/button>/);
  assert.doesNotMatch(moderator, />Moderación y reportes<\/button>/);
});
test('listing administration exposes available stock, sports metadata and immutable deadline rules without real payments', () => {
  const html = renderToStaticMarkup(React.createElement(MarketplaceListingEditor, { listing, busy: false, send: async () => {}, onError() {}, onClose() {}, onUploading() {} }));
  assert.match(html, /Stock disponible/); assert.match(html, /min="0"/); assert.match(html, /max="1000"/);
  assert.match(html, /Estado del artículo/); assert.match(html, /Deporte del artículo/); assert.match(html, /checkbox/);
  assert.match(html, /Los pedidos existentes conservan/); assert.doesNotMatch(html, /datetime-local|Modalidad<select/);
  assert.equal(canEditMarketplaceListing(listing), true);
  assert.equal(canEditMarketplaceListing({ ...listing, status: 'removed' }), false);
  assert.equal(canEditMarketplaceListing({ ...listing, type: 'auction', bidCount: 1 }), false);
  assert.equal(canEditMarketplaceListing({ ...listing, type: 'auction', status: 'closed' }), false);
});
test('report console distinguishes pending decisions from immutable history and owner appeals without rendering hostile seller HTML', () => {
  const review = { id: 1, listingId: 1, authorId: buyer.id, kind: 'report', reason: '<script>fake</script>',
    createdAt: snapshot.serverNow, status: 'pending', decision: null, decisionReason: null, reviewerId: null, resolvedAt: null };
  const renderReviews = data => renderToStaticMarkup(React.createElement(MarketplaceReviews, { snapshot: data, busy: false, send: async () => {}, openListing() {} }));
  const ordinary = renderReviews({ ...snapshot, reviews: [review] });
  assert.match(ordinary, /&lt;script&gt;/); assert.doesNotMatch(ordinary, /<script>|Desestimar reporte|Retirar por incumplimiento/);
  const moderator = renderReviews({ ...snapshot, canModerate: true, reviews: [review], reviewListings: [listing] });
  assert.match(moderator, /Desestimar reporte/); assert.match(moderator, /Retirar por incumplimiento/); assert.match(moderator, /disabled/);
  const owner = renderReviews({ ...snapshot, viewer: seller, myListings: [{ ...listing, status: 'removed', moderation: { reason: 'Contenido no deportivo', at: snapshot.serverNow, previousStatus: 'active' } }] });
  assert.match(owner, /Enviar apelación/); assert.match(owner, /Contenido no deportivo/);
  assert.throws(() => readMarketplaceSnapshot({ ...snapshot, canModerate: 'true' }));
  assert.throws(() => readMarketplaceSnapshot({ ...snapshot, reviews: [{ ...review, decision: 'remove' }] }));
});
test('prices use integer cents, accept exact limits and never silently round malformed input', () => {
  assert.equal(parseMarketplacePrice('0.01'), 1); assert.equal(parseMarketplacePrice('12.50'), 1250);
  assert.equal(parseMarketplacePrice('12,50'), 1250);
  assert.equal(parseMarketplacePrice('1000000.00'), 100000000);
  for (const value of ['0', '-1', '1.001', '1e3', '1,000.00', '1000000.01', '', 'abc']) assert.throws(() => parseMarketplacePrice(value));
  assert.equal(minimumMarketplaceBid({ ...listing, currentBidCents: null }), 1250);
  assert.equal(minimumMarketplaceBid({ ...listing, currentBidCents: 1500, incrementCents: 100 }), 1600);
  assert.equal(marketplacePrice(1250), new Intl.NumberFormat('es', { style: 'currency', currency: 'USD' }).format(12.5)); assert.equal(marketplaceCategories.length, 4);
});
test('strict replies reject financial mode claims, foreign image URLs and malformed auction data', () => {
  assert.deepEqual(readMarketplaceSnapshot(snapshot), snapshot);
  for (const patch of [{ mode: 'real' }, { currency: 'USD' }, { sessionExpired: 'no' }, { viewer: { ...buyer, id: 'demo-role' } }]) {
    assert.throws(() => readMarketplaceSnapshot({ ...snapshot, ...patch }));
  }
  for (const patch of [{ photo: 'https://example.test/tracker.jpg' }, { priceCents: 1.5 },
    { stateId: 'VE-A', municipalityId: 'VE-D:girardot' }, { sport: 'general-commerce' }, { sportsOnly: 'yes' },
    { type: 'auction', incrementCents: 0 }, { type: 'sale', endsAt: new Date().toISOString() }]) {
    assert.throws(() => readMarketplaceSnapshot({ ...snapshot, listings: [{ ...listing, ...patch }] }));
  }
});
test('sport grouping combines baseball and softball only in browsing, condition filters preserve declaration data and favorites reject unavailable content', () => {
  const group = marketplaceSportFilters.find(item => item.id === 'baseball-softball');
  assert.deepEqual(group.sports, ['baseball', 'softball']);
  assert.equal(marketplaceSportFilters.some(item => item.id === 'baseball' || item.id === 'softball'), false);
  for (const sport of ['baseball', 'softball']) assert.equal(marketplaceListingMatchesFilters({ ...listing, sport, condition: 'new' }, { sport: group.id, condition: 'new' }), true);
  assert.equal(marketplaceListingMatchesFilters({ ...listing, sport: 'basketball' }, { sport: group.id }), false);
  assert.equal(marketplaceListingMatchesFilters(listing, { sport: group.id }), false);
  assert.equal(marketplaceListingMatchesFilters(listing, { condition: 'new' }), false);
  assert.equal(marketplaceListingMatchesFilters(listing, {}), true);
  const entry = { listingId: 1, savedAt: snapshot.serverNow, listing };
  assert.deepEqual(readMarketplaceFavorite(entry), entry);
  assert.equal(readMarketplaceFavorite({ ...entry, listing: null }).listing, null);
  assert.equal(readMarketplaceFavorite({ ...entry, listing: { ...listing, status: 'closed' } }).listing.status, 'closed');
  assert.throws(() => readMarketplaceFavorite({ ...entry, listingId: 2 }));
  assert.throws(() => readMarketplaceFavorite({ ...entry, listing: { ...listing, status: 'withdrawn' } }));
  assert.deepEqual(readMarketplaceQuery([['sport', 'baseball-softball'], ['condition', 'used'], ['search', ' guante ']]),
    { sport: 'baseball-softball', condition: 'used', search: 'guante' });
  for (const entries of [[['sport', 'baseball']], [['condition', 'broken']], [['condition', 'used'], ['condition', 'new']], [['accountId', buyer.id]]]) assert.throws(() => readMarketplaceQuery(entries));
});
test('marketplace exposes combined sports, new/used filters and reset control without favoriting anonymously or mislabeling saved items', t => {
  const html = render(t, { ...snapshot, favorites: [{ listingId: 1, savedAt: snapshot.serverNow, listing }] });
  assert.match(html, /Béisbol y softbol/); assert.match(html, /Todos los deportes/); assert.match(html, /Condición del artículo/);
  assert.match(html, /Nuevo y usado/); assert.match(html, /Limpiar filtros/);
  assert.match(html, /aria-pressed="true"/); assert.match(html, /Quitar de favoritos/);
  navigation.useNavigationBusy.mock.restore(); navigation.useNavigationDraft.mock.restore(); locationModule.useMarketplaceProfileLocation.mock.restore();
  const anonymous = render(t, { ...snapshot, viewer: null });
  assert.doesNotMatch(anonymous, /Guardar en favoritos:|Quitar de favoritos:/);
});
test('same-origin marketplace proxy forwards cookies and origin while rejecting unsupported queries and oversized pictures', async t => {
  let forwarded;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    forwarded = { url, options }; return new Response(JSON.stringify(snapshot), { status: 200 });
  });
  const request = new NextRequest('http://localhost:3000/api/marketplace?listing=1', { headers: { Cookie: 'playsport-account=opaque' } });
  const response = await GET(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(forwarded.url, /marketplace\?listing=1$/);
  assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
  assert.equal((await GET(new NextRequest('http://localhost:3000/api/marketplace?state=VE-A&before=99'))).status, 200);
  assert.match(forwarded.url, /state=VE-A&before=99$/);
  assert.equal((await GET(new NextRequest('http://localhost:3000/api/marketplace?sport=baseball-softball&condition=new&category=equipment&type=sale&search=GUANTE'))).status, 200);
  assert.match(forwarded.url, /sport=baseball-softball&condition=new&category=equipment&type=sale&search=GUANTE$/);
  for (const query of ['?payment=real', '?sport=baseball', '?sport=baseball-softball&sport=basketball', '?condition=used&condition=new', '?condition=broken', '?search=' + 'x'.repeat(101), '?thread=1&thread=2', '?before=1&listing=2', '?beforeMessage=5', '?beforeQuestion=5', '?beforeQuestion=5&beforeQuestion=6&listing=1', '?listing=-1', '?state=invalid', '?state=VE-A&state=VE-D']) {
    assert.equal((await GET(new NextRequest('http://localhost:3000/api/marketplace' + query))).status, 400);
  }
  assert.equal((await POST(new NextRequest('http://localhost:3000/api/marketplace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(82000) }))).status, 413);
});

test('public questions expose seller-marked answers without creating reservations or exposing private order messages', () => {
  const question = { id: 1, listingId: 1, author: buyer, text: '<script>pregunta</script>', createdAt: snapshot.serverNow,
    answer: { text: 'Respuesta deportiva del vendedor', createdAt: snapshot.serverNow }, status: 'visible', moderation: null };
  const renderQuestions = data => renderToStaticMarkup(React.createElement(MarketplaceQuestions, {
    listing, snapshot: data, busy: false, before: null, onPage() {}, send: async () => true
  }));
  const publicHtml = renderQuestions({ ...snapshot, viewer: null, questions: [question] });
  assert.match(publicHtml, /Preguntas y respuestas públicas/); assert.match(publicHtml, /Respuesta del vendedor · Vendedor ficticio/);
  assert.match(publicHtml, /&lt;script&gt;/); assert.doesNotMatch(publicHtml, /<script>|Enviar mensaje privado|Tu pregunta pública/);
  const buyerHtml = renderQuestions({ ...snapshot, questions: [question] });
  assert.match(buyerHtml, /Publicar pregunta sin comprar/); assert.match(buyerHtml, /checkbox/);
  assert.match(buyerHtml, /no descuenta inventario|ni descuenta inventario/);
  assert.doesNotMatch(buyerHtml, /Respuesta pública a pregunta/);
  const sellerHtml = renderQuestions({ ...snapshot, viewer: seller, questions: [{ ...question, answer: null }] });
  assert.match(sellerHtml, /Publicar respuesta del vendedor/); assert.doesNotMatch(sellerHtml, /Tu pregunta pública/);
  const moderatorHtml = renderQuestions({ ...snapshot, canModerate: true, questions: [question] });
  assert.match(moderatorHtml, /Ocultar pregunta y respuesta/); assert.match(moderatorHtml, /Motivo para ocultar/);
  assert.throws(() => readMarketplaceSnapshot({ ...snapshot, questions: [{ ...question, status: 'hidden' }] }));
});
test('new purchase UI never offers reservation or pre-purchase private inquiries and private chats are linked to order IDs', () => {
  const source = readFileSync(join(__dirname, '../app/demo/[slug]/marketplace.tsx'), 'utf8');
  assert.match(source, /Confirmar compra/); assert.match(source, /No se mueve dinero real/); assert.doesNotMatch(source, /Reservar compra|Cancelar reserva|Consultar al vendedor en privado/);
  assert.match(source, /kind: 'start-thread', orderId: order.id/);
  assert.match(source, /currentThread.orderId \? <form/);
  assert.match(source, /Archivo privado anterior · solo lectura/);
  const review = { id: 1, listingId: 1, questionId: 3, authorId: buyer.id, kind: 'question', reason: 'Revisar respuesta pública',
    createdAt: snapshot.serverNow, status: 'pending', decision: null, decisionReason: null, reviewerId: null, resolvedAt: null };
  const html = renderToStaticMarkup(React.createElement(MarketplaceReviews, {
    snapshot: { ...snapshot, canModerate: true, reviews: [review], reviewListings: [listing] }, busy: false, send: async () => {}, openListing() {}
  }));
  assert.match(html, /Ocultar pregunta y respuesta/); assert.doesNotMatch(html, /Retirar por incumplimiento/);
});
test('marketplace reads only the saved profile location, never an unsaved draft or another profile, without writing the profile', async () => {
  let raw = null, writes = 0;
  const store = new DemoProfileStore({ getItem: async () => raw, setItem: async (_key, value) => { raw = value; writes++; } });
  await store.load();
  const profile = { ...newDemoPersonalProfile('fan-demo', demoProfileLocation), identification: 'V-99988771',
    fullName: 'Persona Ficticia', birthDate: '1990-01-01', email: 'perfil-ficticio@example.test' };
  await store.draft(profile);
  assert.equal(locationModule.savedMarketplaceLocation((await store.load()).saved, 'fan-demo'), null);
  await store.save('fan-demo');
  await store.draft({ ...profile, location: { stateId: 'VE-D', municipalityId: 'VE-D:girardot' } });
  const before = raw, count = writes, saved = (await store.load()).saved;
  const location = locationModule.savedMarketplaceLocation(saved, 'fan-demo');
  assert.deepEqual(location, demoProfileLocation);
  location.stateId = 'VE-X';
  assert.deepEqual(saved[0].location, demoProfileLocation);
  assert.equal(locationModule.savedMarketplaceLocation(saved, 'another-profile'), null);
  assert.equal(locationModule.savedMarketplaceLocation(saved, null), null);
  assert.equal(raw, before); assert.equal(writes, count);
});
test('national browsing is explicit without a saved location and the saved-state selector does not claim GPS access', t => {
  const html = render(t);
  assert.match(html, /Todo Venezuela/); assert.match(html, /alcance nacional/);
  locationModule.useMarketplaceProfileLocation.mock.restore();
  t.mock.method(locationModule, 'useMarketplaceProfileLocation', () => ({ location: demoProfileLocation, ready: true, error: '', retry() {} }));
  const local = renderToStaticMarkup(React.createElement(Marketplace, { initialSnapshot: { ...snapshot, listings: [
    { ...listing, stateId: 'VE-A', municipalityId: 'VE-A:libertador', sport: 'baseball', sportsOnly: true }
  ] } }));
  assert.match(local, /Mi estado · Distrito Capital/); assert.match(local, /no modifica tu perfil/);
  assert.match(local, /exclusivamente artículos deportivos/);
  assert.doesNotMatch(local, /navigator\.geolocation|Cuenta verificada/);
});
test('profile storage failures are surfaced and do not prevent explicit national browsing', async t => {
  const descriptors = new Map(), states = [];
  let index = 0, effects = [];
  for (const [key, value] of Object.entries({ localStorage: { getItem() { throw new Error('Almacenamiento bloqueado'); }, setItem() { throw new Error('No se debe escribir el perfil'); } },
    addEventListener() {}, removeEventListener() {} })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  t.after(() => { for (const [key, descriptor] of descriptors) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); });
  t.mock.method(platform, 'usePlatformSession', () => ({ session: { version: 1, role: 'fan', team: 'team-A' } }));
  t.mock.method(React, 'useState', initial => { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }]; });
  t.mock.method(React, 'useEffect', effect => effects.push(effect));
  const draw = () => { index = 0; effects = []; return locationModule.useMarketplaceProfileLocation(); };
  assert.equal(draw().ready, false); const cleanup = effects[0]();
  await new Promise(resolve => setImmediate(resolve));
  const result = draw(); assert.equal(result.ready, true); assert.equal(result.location, null);
  assert.match(result.error, /Almacenamiento bloqueado/); cleanup();
});
test('publishing and bidder identity stay independent of sporting roles and styles preserve full-width responsive panels', () => {
  const source = readFileSync(join(__dirname, '../app/demo/[slug]/marketplace.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
  assert.doesNotMatch(source, /demoIdentity|dangerouslySetInnerHTML|accountToken|password/);
  assert.match(source, /snapshot\.viewer\.id/); assert.match(source, /pending\.current\.requestId/);
  assert.match(css, /\.marketGrid[^}]*minmax\(min\(100%, 260px\), 1fr\)/);
  assert.match(css, /\.marketDetailGrid[^}]*minmax\(0, \.9fr\)/);
});
test('account-owned publication drafts survive all six role changes, isolate other accounts and preserve legacy sporting draft scopes', t => {
  const data = new Map(), errors = [], states = [], refs = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)
  } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'sessionStorage', descriptor) : Reflect.deleteProperty(globalThis, 'sessionStorage'));
  let session = { version: 1, role: 'manager', team: 'team-B' }, index = 0, refIndex = 0, effects = [];
  t.mock.method(platform, 'usePlatformSession', () => ({ session, reportNavigationError: error => errors.push(error) }));
  t.mock.method(React, 'useState', initial => {
    const position = index++;
    if (!(position in states)) states[position] = initial;
    return [states[position], next => { states[position] = typeof next === 'function' ? next(states[position]) : next; }];
  });
  t.mock.method(React, 'useRef', initial => { const position = refIndex++; return refs[position] ?? (refs[position] = { current: initial }); });
  t.mock.method(React, 'useEffect', effect => effects.push(effect));
  t.mock.method(React, 'useCallback', callback => callback);
  const render = (ownerId, key = 'marketplace:publication') => {
    const draw = () => { index = 0; refIndex = 0; effects = []; return navigation.useNavigationDraft(key, { title: '' }, value => typeof value?.title === 'string', ownerId); };
    draw(); for (const effect of effects) effect();
    return draw();
  };
  render(buyer.id)[1]({ title: 'Borrador ficticio de la cuenta' });
  for (const role of ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']) {
    session = { version: 1, role, team: 'team-A' };
    const [draft, , ready] = render(buyer.id);
    assert.equal(draft.title, 'Borrador ficticio de la cuenta'); assert.equal(ready, true);
  }
  assert.equal(data.size, 1);
  assert.equal(render(seller.id)[0].title, '');
  assert.equal(render(buyer.id)[0].title, 'Borrador ficticio de la cuenta');
  render(undefined, 'legacy-roster')[1]({ title: 'Borrador deportivo existente' });
  assert.ok(data.has(`playsport:draft:v1:${demoIdentity(session).id}:legacy-roster`));
  assert.deepEqual(errors, []);
});
