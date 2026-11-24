const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { platformRoles, platformModuleIds } = require('@playsport/shared');
test('every mobile role keeps marketplace access through the real web account, not fictitious native commerce controls', () => {
  for (const role of platformRoles) assert.ok(platformModuleIds(role.id).includes('marketplace'));
  const app = readFileSync(join(__dirname, '../App.tsx'), 'utf8');
  const source = readFileSync(join(__dirname, '../marketplace-link.tsx'), 'utf8');
  assert.match(app, /<WebView/);
  assert.match(app, /source=\{\{ uri: origin \}\}/);
  assert.match(source, /\/demo\/marketplace/); assert.match(source, /No hay cobros/);
  assert.match(source, /\/wallet/); assert.match(source, /billetera única/);
  assert.match(readFileSync(join(__dirname, '../personal-profile.tsx'), 'utf8'), /\/wallet/);
  assert.doesNotMatch(source, /accountToken|password|financialAccess: true|Registrar pago/);
});
