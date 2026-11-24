const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Header = require('../app/demo/[slug]/live-scoring-header').default;

test('every profile retains one common scoreboard heading and layout', () => {
  for (const mode of ['Solo lectura', 'Anotación oficial']) {
    const markup = renderToStaticMarkup(createElement(Header, {
      tools: createElement('span', null, mode)
    }));
    assert.equal((markup.match(/<h1>/g) ?? []).length, 1);
    assert.match(markup, /<h1>PIZARRA EN VIVO<\/h1>/);
    assert.match(markup, /class="moduleHeader liveScoringHeader"/);
    assert.match(markup, /aria-label="Controles de la pizarra"/);
    assert.ok(markup.indexOf('</h1>') < markup.indexOf(mode));
  }
});

test('the common header preserves lineup controls without adding annotation controls to observers', () => {
  const markup = renderToStaticMarkup(createElement(Header, {
    tools: createElement('button', { type: 'button' }, 'Actualizar pizarra oficial')
  }, createElement('button', { type: 'button' }, 'Alineaciones del partido')));
  assert.match(markup, /aria-label="Alineaciones del partido"/);
  assert.match(markup, /Actualizar pizarra oficial/);
  assert.doesNotMatch(markup, /Registrar jugada|<form/);
});

test('existing headers without tools remain unchanged and render no empty tool group', () => {
  const markup = renderToStaticMarkup(createElement(Header));
  assert.match(markup, /PIZARRA EN VIVO/);
  assert.doesNotMatch(markup, /liveScoringTools|liveScoringHeaderActions/);
});
