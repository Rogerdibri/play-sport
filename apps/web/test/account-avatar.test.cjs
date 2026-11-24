const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const AccountAvatar = require('../app/account-avatar').default;
const AccountPhotoEditor = require('../app/account-photo-editor').default;
const navigation = require('../app/navigation-hooks');
const account = { id: '12345678-1234-1234-1234-123456789abc', displayName: 'Persona Ficticia' };
const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
test('avatar renders only the supplied account photo, uses initials without a photo, and labels failed images explicitly', t => {
  const render = value => renderToStaticMarkup(React.createElement(AccountAvatar, { account: value, size: 64 }));
  assert.match(render(account), /Persona Ficticia · sin foto/); assert.match(render(account), />PF</);
  const html = render({ ...account, photo });
  assert.match(html, /Foto de Persona Ficticia/); assert.match(html, /data:image\/jpeg;base64/);
  t.mock.method(React, 'useState', () => [true, () => {}]);
  const failed = render({ ...account, photo });
  assert.match(failed, /Foto no disponible/); assert.doesNotMatch(failed, /<img/);
});
test('account photo editor keeps legacy role photos behind explicit import and never claims identity verification', t => {
  t.mock.method(navigation, 'useNavigationBusy', () => {});
  const html = renderToStaticMarkup(React.createElement(AccountPhotoEditor, { account, legacyPhoto: photo }));
  assert.match(html, /Cargar foto de mi cuenta/); assert.match(html, /Guardar foto de mi cuenta/);
  assert.match(html, /No se comparte automáticamente|No se comparte autom|no se comparte automáticamente/);
  assert.match(html, /Usar la foto guardada de este perfil para mi cuenta/);
  assert.match(html, /No verifica identidad ni concede permisos/);
  assert.doesNotMatch(html, /<img/);
});
test('role entry, toolbar and matching wallet owner share the account avatar, not sporting draft photos', () => {
  for (const path of ['../app/page.tsx', '../app/platform-session.tsx', '../app/wallet/page.tsx']) assert.match(readFileSync(join(__dirname, path), 'utf8'), /AccountAvatar/);
  const wallet = readFileSync(join(__dirname, '../app/wallet/page.tsx'), 'utf8');
  assert.match(wallet, /account\?\.id === snapshot.accountId/);
  const editor = readFileSync(join(__dirname, '../app/account-photo-editor.tsx'), 'utf8');
  assert.match(editor, /expectedAccountId: id/); assert.match(editor, /readAccountPhotoChange\(JSON.parse\(saved\)\)/);
  assert.match(editor, /notifyAccountChange\(true\)/);
  assert.doesNotMatch(editor, /financialAccess: true|demoIdentity\(/);
});
