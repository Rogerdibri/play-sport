const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const hooks = require('../app/navigation-hooks');
const api = require('../app/account/access/access-request');
const { default: Dashboard } = require('../app/admin/administration-dashboard');
const { default: DraftPrices } = require('../app/admin/draft-prices');
const { default: Example } = require('../app/admin/example/page');
const { readAdministrationSnapshot, readOwnAccountAccess, readAccountProfile, readTrialChange } = require('@playsport/shared');

function fixture(t, readOnly = false) {
  const props = Example().props;
  const snapshot = readAdministrationSnapshot(props.example, props.account.id);
  let stateIndex = 0, refIndex = 0;
  const states = new Map(), refs = new Map();
  t.mock.method(React, 'useState', initial => {
    const key = stateIndex++;
    if (!states.has(key)) states.set(key, key === 1 ? snapshot : key === 7 ? false : initial);
    return [states.get(key), next => states.set(key, typeof next === 'function' ? next(states.get(key)) : next)];
  });
  t.mock.method(React, 'useRef', initial => {
    const key = refIndex++;
    if (!refs.has(key)) refs.set(key, { current: initial });
    return refs.get(key);
  });
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  const render = () => { stateIndex = 0; refIndex = 0; return nodes(Dashboard({ account: props.account, ...(readOnly ? { example: snapshot } : {}) })); };
  const button = name => render().find(node => node.type === 'button' && text(node.props.children) === name);
  const input = name => {
    const label = render().find(node => node.type === 'label' && text(node.props.children).startsWith(name));
    return nodes(label).find(node => ['input', 'select', 'textarea'].includes(node.type));
  };
  const open = () => {
    button('Gestionar accesos de Jugador de ejemplo').props.onClick();
    input('Vencimiento en tu hora local').props.onChange({ target: { value: '2026-12-02T18:00' } });
    input('Motivo del cambio').props.onChange({ target: { value: 'Ampliación autorizada para el piloto' } });
  };
  const submit = () => render().filter(node => node.type === 'form').at(-1).props.onSubmit({ preventDefault() {} });
  return { render, text, button, input, open, submit, snapshot, account: props.account,
    loading(value) { states.set(7, value); }, data(value) { states.set(1, value); } };
}
test('background refresh keeps existing cards stable instead of inserting a loading row during a click', t => {
  const e = fixture(t);
  e.render(); e.loading(true);
  assert.doesNotMatch(e.text(e.render()[0]), /Consultando usuarios/);
  assert.ok(e.button('Gestionar accesos de Jugador de ejemplo'));
  e.data(null);
  assert.match(e.text(e.render()[0]), /Consultando usuarios/);
});
test('draft price selectors preserve plan and duration keys, special charges and saved custom concepts', t => {
  let index = 0;
  const states = new Map([[0, [
    { key: 'manager-numbers:12', name: 'Manager · Nivel 2 · Mis equipos por juego · Anual', currency: 'USD', amountCents: 2475, revision: 1, updatedAt: '2026-11-24T00:00:00.000Z' },
    { key: 'custom:example', name: 'Concepto adicional', currency: 'USD', amountCents: 0, revision: 1, updatedAt: '2026-11-24T00:00:00.000Z' },
  ]]]);
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!states.has(key)) states.set(key, initial);
    return [states.get(key), next => states.set(key, typeof next === 'function' ? next(states.get(key)) : next)];
  });
  t.mock.method(React, 'useEffect', () => {});
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : String(node ?? '');
  const render = () => { index = 0; return nodes(DraftPrices({ accountId: 'admin' })); };
  const field = name => nodes(render().find(node => node.type === 'label' && text(node.props.children).startsWith(name)))
    .find(node => node.type === 'select' || node.type === 'input');
  const change = (name, value) => field(name).props.onChange({ target: { value } });
  change('Rol', 'manager'); change('Nivel', 'manager-numbers'); change('Duración', '12');
  assert.equal(field('Importe').props.value, '24.75');
  change('Rol', 'scorekeeper'); change('Nivel', 'extra-game');
  assert.equal(field('Duración'), undefined);
  change('Rol', 'organizer');
  assert.equal(field('Paquete o concepto').props.value, 'organizer:small');
  change('Rol', 'other');
  assert.equal(field('Concepto').props.value, 'custom:example');
  assert.equal(field('Importe').props.value, '0.00');
});
test('example shows distinct active, expired, revoked and missing trials without touching an account', t => {
  const e = fixture(t, true), markup = renderToStaticMarkup(e.render()[0]);
  assert.match(markup, /ejemplo de solo lectura/);
  assert.match(markup, /Vigente/); assert.match(markup, /Vencido/); assert.match(markup, /Revocado/);
  assert.match(markup, /Sin pruebas asignadas/);
  e.open();
  assert.equal(e.button('Activar o ampliar prueba').props.disabled, true);
  assert.equal(e.button('Revocar prueba').props.disabled, true);
});
test('trial catalog declares only sporting read capabilities, never administrative or financial rights', t => {
  const e = fixture(t, true);
  e.button('Planes y funciones').props.onClick();
  const text = e.text(e.render()[0]);
  for (const label of ['Jugador', 'Manager', 'Anotador', 'Organizador', 'Estadísticas personales', 'Cifras detalladas del resumen final']) assert.ok(text.includes(label));
  assert.match(text, /catálogo es fijo/);
  assert.match(text, /No amplían cupos de torneo/);
  e.button('Identidades').props.onClick();
  assert.match(e.text(e.render()[0]), /autorización separada/);
});
test('grant sends the selected account, fresh UUID and exact existing revision; double submit never duplicates', async t => {
  const e = fixture(t), commands = [];
  t.mock.method(api, 'accessRequest', async (_url, command) => {
    commands.push(command);
    return { trial: { planId: command.planId, active: true, expiresAt: command.expiresAt,
      updatedAt: e.snapshot.now, revision: command.expectedRevision + 1 } };
  });
  e.open(); e.submit(); e.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.length, 1);
  const command = readTrialChange(commands[0]);
  assert.equal(command.accountId, e.snapshot.users[0].id);
  assert.equal(command.expectedAdminId, e.account.id);
  assert.equal(command.expectedRevision, 1);
  assert.equal(command.expiresAt, new Date('2026-12-02T18:00').toISOString());
  assert.match(e.text(e.render()[0]), /Acceso activado con vencimiento/);
});
test('uncertain response locks edits and retries the same command, preserving its nonce', async t => {
  const e = fixture(t), commands = [];
  t.mock.method(api, 'accessRequest', async (_url, command) => {
    commands.push(command);
    if (commands.length === 1) throw new api.AccessRequestError('Conexión interrumpida', 503);
    return { trial: { planId: command.planId, active: true, expiresAt: command.expiresAt,
      updatedAt: e.snapshot.now, revision: command.expectedRevision + 1 } };
  });
  e.open(); e.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(e.text(e.render()[0]), /Confirmación pendiente/);
  assert.equal(e.button('Usuarios y pruebas').props.disabled, true);
  e.button('Reintentar misma solicitud').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands[1], commands[0]);
  assert.equal(e.button('Reintentar misma solicitud'), undefined);
});
test('conflict errors remain visible, do not claim success and do not retry an invalid command', async t => {
  const e = fixture(t);
  t.mock.method(api, 'accessRequest', async () => { throw new api.AccessRequestError('El acceso cambió en otro dispositivo', 409); });
  e.open(); e.submit();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(e.text(e.render()[0]), /El acceso cambió en otro dispositivo/);
  assert.equal(e.button('Reintentar misma solicitud'), undefined);
  assert.doesNotMatch(e.text(e.render()[0]), /Acceso activado con vencimiento/);
});
test('readers reject forged features, unknown plans and a snapshot belonging to another account', t => {
  const e = fixture(t);
  assert.throws(() => readAdministrationSnapshot({ ...e.snapshot, accountId: 'other' }, e.account.id));
  assert.throws(() => readOwnAccountAccess({ accountId: e.account.id, now: e.snapshot.now, features: ['administrator'], trials: [] }, e.account.id));
  assert.throws(() => readAccountProfile({ ...e.account, administrationAccess: 'true' }));
  assert.throws(() => readTrialChange({ requestId: e.account.id, expectedAdminId: e.account.id, accountId: e.snapshot.users[0].id,
    expectedRevision: 0, planId: 'owner', action: 'grant', reason: 'Prueba', expiresAt: e.snapshot.now }));
});
