const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ParticipantIdentityLinks = require('../app/demo/[slug]/participant-identity-links').default;
const player = (id, name) => ({ id, name, position: 'NA', jersey: '', order: 1 });
const seed = { names: { home: 'Locales', away: 'Visitantes' },
  rosters: { home: [player('local', 'Nombre local')], away: [{ ...player('away', 'Nombre visitante'), identification: 'V-87654321' }] } };

test('identity linking is collapsed, optional, separated from scoring and clearly limited to personal statistics', () => {
  const html = renderToStaticMarkup(React.createElement(ParticipantIdentityLinks, { seed, busy: false, onSave: async () => {} }));
  assert.match(html, /Vincular participantes con su cuenta/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /Cédula del participante/);
  assert.match(html, /No obtiene acceso a la planilla completa/);
  assert.match(html, /Un suplente sin participación no genera estadísticas/);
  assert.doesNotMatch(html, /<input[^>]*required/);
  assert.doesNotMatch(html, /player-statistics-analysis|accountId|<table/);
});
test('link submission awaits server confirmation and displays failures rather than announcing a successful save', async t => {
  const state = [], pending = { current: false }, calls = [];
  let index = 0, tree, reject = false;
  t.mock.method(React, 'useRef', () => pending);
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!(key in state)) state[key] = initial;
    return [state[key], value => { state[key] = typeof value === 'function' ? value(state[key]) : value; }];
  });
  function Capture() {
    tree = ParticipantIdentityLinks({ seed, busy: false, onSave: async input => {
      calls.push(input);
      if (reject) throw new Error('La planilla cambió en otro dispositivo.');
    } });
    return tree;
  }
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) :
    [node, ...nodes(node.props?.children)];
  const render = () => { index = 0; return renderToStaticMarkup(React.createElement(Capture)); };
  render();
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: 'V-12345678' } });
  render();
  nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.match(render(), /Guardando vínculo/);
  assert.doesNotMatch(render(), /Vínculo guardado/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[0], { side: 'home', playerId: 'local', identification: 'V-12345678' });
  assert.match(render(), /Vínculo guardado/);
  reject = true;
  nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const failed = render();
  assert.match(failed, /role="alert"/); assert.match(failed, /La planilla cambió/);
  assert.doesNotMatch(failed, /Vínculo guardado/);
  reject = false;
  nodes(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'away' } });
  render();
  assert.equal(nodes(tree).find(node => node.type === 'input').props.value, 'V-87654321');
  nodes(tree).find(node => node.type === 'input').props.onChange({ target: { value: '' } });
  render();
  nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.at(-1), { side: 'away', playerId: 'away', identification: '' });
});
