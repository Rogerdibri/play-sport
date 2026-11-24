const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { webApplicationOrigin } = require('../application-origin');
test('the installed app and Expo web use the approved web interface, never the old dashboard or direct scoring API', () => {
  const native = readFileSync(join(__dirname, '../App.tsx'), 'utf8');
  const web = readFileSync(join(__dirname, '../App.web.tsx'), 'utf8');
  assert.match(native, /<WebView/);
  assert.match(native, /source=\{\{ uri: origin \}\}/);
  assert.match(native, /sharedCookiesEnabled/);
  assert.match(web, /<iframe[^>]*title="PlaySport" src=\{origin\}/);
  assert.match(web, /event\.origin !== origin/);
  assert.match(web, /event\.source !== frame\.current\?\.contentWindow/);
  assert.match(web, /name=\{`playsport:legacy-parent:/);
  assert.doesNotMatch(native + web, /Jornada Activa|18 juegos|profileStats|AVG temporada|new FriendlyClient|officialScoringApiBase/);
  assert.match(native, /getAllKeys/);
  assert.match(native, /playsport:legacy-accesses/);
  assert.doesNotMatch(native, /AsyncStorage\.(removeItem|clear)|localStorage\.setItem/);
});
test('physical devices infer the development computer, while published apps require an explicit HTTPS origin', () => {
  assert.equal(webApplicationOrigin(undefined, '192.0.2.10:8081', true), 'http://192.0.2.10:3000');
  assert.equal(webApplicationOrigin(undefined, 'localhost:8083', true), 'http://localhost:3000');
  assert.equal(webApplicationOrigin('https://sport.example.test/', undefined, false), 'https://sport.example.test');
  assert.throws(() => webApplicationOrigin(undefined, '192.0.2.10:8081', false), /Configura/);
  for (const value of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?x=1', 'file:///tmp/test'])
    assert.throws(() => webApplicationOrigin(value, undefined, false));
});
