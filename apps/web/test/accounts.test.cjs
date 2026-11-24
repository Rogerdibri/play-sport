const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { default: AccountPage } = require('../app/account/page');
const { default: AccountAccess } = require('../app/account/account-access');
const { GET, POST } = require('../app/api/accounts/[action]/route');
const { readAccountProfile, readAccountPhotoChange } = require('@playsport/shared');
const navigation = require('../app/navigation-hooks');
beforeEach(t => t.mock.method(require('../app/platform-session'), 'usePlatformSession', () =>
  ({ ready: true, clear() {}, registerNavigationBusy: () => () => {} })));
const account = { id: '12345678-1234-1234-1234-123456789abc', email: 'cuenta@example.test', displayName: 'Cuenta ficticia',
  createdAt: '2026-11-07T00:00:00.000Z', emailVerified: false, identityVerification: 'unavailable', financialAccess: false };
const render = () => renderToStaticMarkup(React.createElement(AccountPage));
const renderAccess = () => renderToStaticMarkup(React.createElement(AccountAccess));

test('account landing is independent from demo role selection and does not claim verification or enable betting', () => {
  const html = renderAccess();
  assert.match(html, /Mi cuenta PlaySport/); assert.match(html, /Consultando tu sesión/);
  assert.match(html, /La verificación no se simula/); assert.match(html, /dinero y las apuestas reales no están habilitados/);
  assert.doesNotMatch(html, /Subir cédula|Subir selfie|Cuenta verificada|Entrar como Organizador/);
  assert.match(html, /<button[^>]*>Volver al inicio<\/button>/);
  assert.doesNotMatch(html, /<a[^>]*>Volver al inicio<\/a>/);
});
test('anonymous and authenticated forms expose correct password fields without storing or displaying credentials', t => {
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  const useState = React.useState; let index = 0;
  t.mock.method(React, 'useState', initial => index++ === 1 ? [false, () => {}] : useState(initial));
  const html = render();
  assert.match(html, /Iniciar sesión/); assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="current-password"/); assert.match(html, /Quiero crear una cuenta/);
  assert.match(html, /Recuperación de contraseña por correo: pendiente/);
  index = 0;
  t.mock.method(React, 'useState', initial => index++ === 0 ? [account, () => {}] : index === 2 ? [false, () => {}] : useState(initial));
  const authenticated = renderAccess();
  assert.match(authenticated, /Cerrar sesión de mi cuenta/); assert.match(authenticated, /Cambiar contraseña/);
  assert.match(authenticated, /No verificado/); assert.match(authenticated, /Desactivados/);
  assert.match(authenticated, /passkeys, huella o reconocimiento facial todavía no está habilitado/);
  assert.doesNotMatch(authenticated, /href="\/wallet"|Enviar identidad a revisión/);
  assert.match(authenticated, /no hereda permisos de manager/);
});
test('authenticated local testers are not incorrectly told that their session expires after 30 minutes', t => {
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  const useState = React.useState; let index = 0;
  t.mock.method(React, 'useState', initial => index++ === 0
    ? [{ ...account, localTestAccess: true }, () => {}] : index === 2 ? [false, () => {}] : useState(initial));
  const html = renderAccess();
  assert.match(html, /sesión persistente/i);
  assert.match(html, /no vence por inactividad/);
  assert.doesNotMatch(html, /La sesión vence tras 30 minutos/);
  assert.match(html, /Cerrar sesión de mi cuenta/);
});
test('reader refuses verification or financial access claims that are not implemented', () => {
  assert.deepEqual(readAccountProfile(account), account);
  for (const patch of [{ emailVerified: true }, { identityVerification: 'verified' }, { financialAccess: true }, { id: '-'.repeat(36) }]) {
    assert.throws(() => readAccountProfile({ ...account, ...patch }), /inválidos/);
  }
  assert.equal(readAccountProfile({ ...account, localTestAccess: true }).localTestAccess, true);
  assert.throws(() => readAccountProfile({ ...account, localTestAccess: 'admin' }), /inválidos/);
});
test('one manually verified private identity is readable without granting financial or email verification', () => {
  const identity={identification:'V-12345678',fullName:'Persona Ficticia',birthDate:'1990-01-02',status:'verified',revision:2,
    reason:'Cotejo documental ficticio',actorId:'person:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const value=readAccountProfile({...account,identityVerification:'manual',identity});
  assert.equal(value.identity.identification,'V-12345678');
  assert.equal(value.financialAccess,false);
  assert.equal(value.emailVerified,false);
  assert.throws(()=>readAccountProfile({...account,identity:{...identity,status:'self-approved'}}),/identidad/);
});
test('private identity form requires separate document and personal images and explicit review rather than automatic approval', t => {
  t.mock.method(navigation,'useNavigationBusy',()=>{});
  const {default:Form}=require('../app/account/person-identity');
  const html=renderToStaticMarkup(React.createElement(Form,{account,onSaved:()=>{}}));
  assert.match(html,/Mi identidad en todo PlaySport/);
  assert.match(html,/Foto o escaneo de la cédula/);
  assert.match(html,/Foto personal para verificar tu identidad/);
  assert.match(html,/Confirmo que los datos y documentos son míos/);
  assert.match(html,/Enviar identidad a revisión/);
  assert.match(html,/no verifica automáticamente/);
  assert.doesNotMatch(html,/Aprobar identidad|data:image\/jpeg;base64/);
});
test('same-origin proxy forwards cookies and origin, preserves private cookies, and rejects unrelated endpoints and large bodies', async t => {
  let forwarded;
  t.mock.method(global, 'fetch', async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ account }), { status: 200, headers: { 'Set-Cookie': 'playsport-account=opaque; HttpOnly; SameSite=Strict' } });
  });
  const request = new NextRequest('http://localhost:3000/api/accounts/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', Cookie: 'playsport-account=old' },
    body: JSON.stringify({ email: account.email, password: 'Frase ficticia para prueba' }) });
  const response = await POST(request, { params: Promise.resolve({ action: 'login' }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.equal(forwarded.options.headers.get('origin'), 'http://localhost:3000');
  assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=old');
  assert.equal((await GET(new NextRequest('http://localhost:3000/api/accounts/wallet'), { params: Promise.resolve({ action: 'wallet' }) })).status, 404);
  const large = new NextRequest('http://localhost:3000/api/accounts/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(8193) });
  assert.equal((await POST(large, { params: Promise.resolve({ action: 'register' }) })).status, 413);
  const wrongType = new NextRequest('http://localhost:3000/api/accounts/login', { method: 'POST', body: 'email=a' });
  assert.equal((await POST(wrongType, { params: Promise.resolve({ action: 'login' }) })).status, 415);
});
test('photo contracts reject foreign URLs, incomplete revisions, unsafe sizes and forged owners; prepared avatars use the bounded photo proxy', async t => {
    const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
    const profile = { ...account, photo, photoRevision: 1 };
    assert.deepEqual(readAccountProfile(profile), profile);
    for (const patch of [{ photo: 'https://example.test/face.png' }, { photo: 'data:image/svg+xml;base64,AAAA' }, { photoRevision: 0 }, { photo: undefined }]) assert.throws(() => readAccountProfile({ ...profile, ...patch }));
    assert.throws(() => readAccountProfile({ ...account, photo }));
    const input = { requestId: account.id, expectedAccountId: account.id, expectedRevision: 0, photo };
    assert.deepEqual(readAccountPhotoChange(input), input);
    for (const patch of [{ accountId: account.id }, { expectedAccountId: 'mgr-A' }, { expectedRevision: -1 }, { role: 'player' }, { expectedRevision: Number.MAX_SAFE_INTEGER }]) assert.throws(() => readAccountPhotoChange({ ...input, ...patch }));
    let forwarded;
    t.mock.method(globalThis, 'fetch', async (url, options) => { forwarded = { url, options }; return new Response(JSON.stringify({ account: profile, appliedRevision: 1 })); });
    const response = await POST(new NextRequest('http://localhost:3000/api/accounts/photo', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'playsport-account=opaque', Origin: 'http://localhost:3000' }, body: JSON.stringify(input) }), { params: Promise.resolve({ action: 'photo' }) });
    assert.equal(response.status, 200); assert.match(forwarded.url, /accounts\/photo$/);
    assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await POST(new NextRequest('http://localhost:3000/api/accounts/photo?accountId=other', { method: 'POST' }), { params: Promise.resolve({ action: 'photo' }) })).status, 400);
    assert.equal((await GET(new NextRequest('http://localhost:3000/api/accounts/photo'), { params: Promise.resolve({ action: 'photo' }) })).status, 404);
});
