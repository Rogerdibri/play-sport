const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const SponsorStrip = require('../app/sponsor-strip').default;
const { sponsorExamples } = require('../app/sponsor-examples');

test('the strip shows only the six authorized original logos, without advertising cards', () => {
  const html = renderToStaticMarkup(createElement(SponsorStrip));
  assert.deepEqual(sponsorExamples.map(brand => brand.name), ['BERA', 'DIKU', 'BERACARS', 'RICCIEGROUP', 'INDUSTRIAS HEDA', 'XPRESS MOTORS']);
  assert.equal((html.match(/<img /g) ?? []).length, 6);
  assert.ok(html.includes('Marcas de referencia para esta vista de prueba'));
  assert.doesNotMatch(html, /<aside|<h[1-6]|<p|sportsHomeAdvertising|Patrocinantes oficiales/);
  for (const brand of sponsorExamples) {
    assert.ok(html.includes(`alt="${brand.name}"`));
    assert.ok(html.includes(`aria-label="Información de ${brand.name}"`));
    assert.ok(html.includes(encodeURIComponent(brand.src)));
    assert.ok(html.includes('href="/highlights/publicidad"'));
  }
});

test('all optimized local PNGs persist with their real dimensions and transparent backgrounds', () => {
  for (const brand of sponsorExamples) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'public', brand.src));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), brand.width);
    assert.equal(bytes.readUInt32BE(20), brand.height);
    assert.equal(bytes[25], 6, `${brand.name}: RGBA transparency is preserved`);
    assert.ok(bytes.length < 50000, `${brand.name}: unnecessary large source download`);
    assert.equal(new URL(brand.source).protocol, 'https:');
  }
});

test('logos stay in one row with local horizontal scrolling on mobile, without shrinking', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const blocks = [...css.matchAll(/\.sponsorStrip\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /flex-wrap:\s*nowrap/);
  for (const block of blocks) assert.doesNotMatch(block, /flex-wrap:\s*wrap\b/);
  assert.match(blocks[1], /justify-content:\s*flex-start/);
  assert.match(blocks[1], /overflow-x:\s*auto/);
  assert.match(css, /\.sponsorStrip a\s*\{[^}]*flex:\s*0 0 90px/);
});
