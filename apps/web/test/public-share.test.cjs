const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ts = require('typescript');
const React = require('react');
const jsx = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');
const Share = require('../app/public-share').default;

function sharing(t, clipboard) {
  const values = [];
  let index = 0,
    initialize,
    copy;
  for (const [name, value] of Object.entries({
    location: { origin: 'https://playsport.example' },
    navigator: { clipboard }
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => (original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]));
  }
  t.mock.method(React, 'useState', (initial) => {
    const position = index++;
    if (!(position in values)) values[position] = initial;
    return [
      values[position],
      (value) => {
        values[position] = value;
      }
    ];
  });
  t.mock.method(React, 'useEffect', (effect) => {
    initialize = effect;
  });
  const originalJsx = jsx.jsx;
  t.mock.method(jsx, 'jsx', (type, props, key) => {
    if (type === 'button') copy = props.onClick;
    return originalJsx(type, props, key);
  });
  const render = (path) => {
    index = 0;
    return renderToStaticMarkup(
      React.createElement(Share, {
        path: path ?? '/demo/events-map?official=plan%3Atour%3Aopening',
        title: 'Local vs. Visitante · PlaySport'
      })
    );
  };
  return { render, initialize: () => initialize(), copy: () => copy() };
}

test('public sharing hydrates an exact same-origin link and WhatsApp text without a fabricated result', async (t) => {
  let copied;
  const view = sharing(t, {
    writeText: async (value) => {
      copied = value;
    }
  });
  assert.match(view.render(), /disabled=""/);
  view.initialize();
  const html = view.render();
  const url = 'https://playsport.example/demo/events-map?official=plan%3Atour%3Aopening';
  assert.match(html, /value="https:\/\/playsport\.example\/demo\/events-map\?official=plan%3Atour%3Aopening"/);
  assert.ok(html.includes(`https://wa.me/?text=${encodeURIComponent(`Local vs. Visitante · PlaySport\n${url}`)}`));
  assert.doesNotMatch(html, /Ganador|Finalizado|Enlace público copiado/);
  await view.copy();
  assert.equal(copied, url);
  assert.match(view.render(), /role="status">Enlace público copiado/);
});

test('clipboard absence or denial is visible and never reports successful sharing', async (t) => {
  for (const clipboard of [
    undefined,
    {
      writeText: async () => {
        throw new Error('Permission denied');
      }
    }
  ]) {
    await t.test(clipboard ? 'denied' : 'unavailable', async (child) => {
      const view = sharing(child, clipboard);
      view.render();
      view.initialize();
      view.render();
      await view.copy();
      const html = view.render();
      assert.match(html, /role="alert">No se pudo copiar/);
      assert.match(html, /readonly=""/);
      assert.match(html, /value="https:\/\/playsport\.example/);
      assert.doesNotMatch(html, /Enlace público copiado/);
    });
  }
});

test('changing from a game to a tournament resets the copy notice and targets the actual public ficha', async (t) => {
  const view = sharing(t, { writeText: async () => {} });
  view.render();
  view.initialize();
  view.render();
  await view.copy();
  view.render('/demo/tournaments?tournament=selected-tournament');
  view.initialize();
  const html = view.render('/demo/tournaments?tournament=selected-tournament');
  assert.match(html, /value="https:\/\/playsport\.example\/demo\/tournaments\?tournament=selected-tournament"/);
  assert.doesNotMatch(html, /Enlace público copiado|official=/);
});

test('all official game mutation requests retain authenticated cookies across the web/API origins', () => {
  for (const file of [
    'official-run-scoring',
    'official-game-workspace',
    'team-sheet-inbox',
    'game-protest-panel',
    'game-suspension-panel'
  ]) {
    const path = join(__dirname, `../app/demo/[slug]/${file}.tsx`);
    const source = ts.createSourceFile(
      path,
      readFileSync(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let posts = 0;
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
        const options = node.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          const value = (name) =>
            options.properties.find(
              (property) => ts.isPropertyAssignment(property) && property.name.getText(source) === name
            )?.initializer;
          if (value('method')?.text === 'POST') {
            posts++;
            assert.equal(value('credentials')?.text, 'include', `${file}: authenticated POST must carry the session`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(posts, 1, `${file}: expected to inspect its real mutation request`);
  }
});
