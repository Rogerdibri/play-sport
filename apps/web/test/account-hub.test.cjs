const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { platformRoles } = require('@playsport/shared');
const session = require('../app/platform-session');
const { default: AccountPage } = require('../app/account/page');
const { default: ProfilePage } = require('../app/profile/page');
const { default: AccountNavigation, accountSectionForPath, accountSections } = require('../app/account-navigation');
const account = { id: '12345678-1234-1234-1234-123456789abc', displayName: 'Cuenta de revisión', email: 'account@example.test',
  createdAt: '2026-11-07T00:00:00.000Z', emailVerified: false, identityVerification: 'unavailable', financialAccess: false };

test('one authenticated account exposes the same four sections with or without a selected role', t => {
  for (const role of [null, ...platformRoles.map(item => item.id)]) {
    t.mock.method(session, 'usePlatformSession', () => ({ account, ready: true, session: role ? { role } : null }));
    const html = renderToStaticMarkup(React.createElement(AccountPage));
    for (const section of accountSections) assert.match(html, new RegExp(`href="${section.href}"`));
    assert.equal((html.match(/class="accountHubCard"/g) ?? []).length, 4);
    assert.match(html, /class="managerButtonOutline accountHubMobileAccess" href="\/favorites">Mis favoritos/);
    assert.match(html, /Cuenta de revisión/);
    assert.doesNotMatch(html, /Iniciar sesión|type="password"|Saldo disponible|Cambiar contraseña/);
  }
});

test('account sections retain their routes, have a return to the hub, and do not capture public sports sheets', () => {
  for (const path of ['/profile', '/wallet', '/sports-sheet', '/sports-sheet/statistics', '/sports-sheet/career', '/account/security']) {
    assert.ok(accountSectionForPath(path), path);
    const html = renderToStaticMarkup(React.createElement(AccountNavigation, { pathname: path }));
    assert.match(html, /href="\/account"/);
    assert.match(html, /aria-current="page"/);
  }
  for (const path of ['/', '/sports-sheet/public-ref', '/demo/events-map', '/demo/marketplace']) {
    assert.equal(accountSectionForPath(path), undefined);
    assert.equal(AccountNavigation({ pathname: path }), null);
  }
});

test('choosing a role does not unlock a personal profile without an authenticated account', t => {
  for (const role of platformRoles) {
    t.mock.method(session, 'usePlatformSession', () => ({ ready: true, account: null, session: { role: role.id }, registerNavigationBusy: () => () => {} }));
    const html = renderToStaticMarkup(React.createElement(ProfilePage));
    assert.match(html, /Mi cuenta PlaySport/);
    assert.doesNotMatch(html, /Recuperando tu perfil y su borrador|Acceso familiar|value="(?:fan|player|scorer|org)-demo"/);
  }
});
