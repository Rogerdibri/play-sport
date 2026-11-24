const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const hooks = require('../app/navigation-hooks');
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { createPrivateState, defensivePlayContext, readTeamSheets, isScorecardCommand } = require('@playsport/shared');
const PlayerActions = require('../app/demo/[slug]/scorecard-player-actions').default;
function fixture(t, patch = {}) {
  const { seed } = createPrivateScorecardExample(), state = createPrivateState(seed);
  const selected = { side: 'home', id: seed.lineups.home[3].id, context: defensivePlayContext(state), mode: 'menu' };
  const commands = [], modes = [], values = new Map();
  let index = 0, closed = 0;
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!values.has(key)) values.set(key, initial);
    return [values.get(key), next => values.set(key, typeof next === 'function' ? next(values.get(key)) : next)];
  });
  t.mock.method(React, 'useRef', initial => ({ current: initial }));
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(hooks, 'useScreenBack', () => {});
  const props = { state, selected, canManage: true, disabled: false, pendingApproval: false,
    positionLabels: require('@playsport/shared').fieldPositionLabels,
    onClose: () => closed++, onMode: mode => { modes.push(mode); selected.mode = mode; },
    onCommand: async command => { commands.push(command); return true; }, ...patch };
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' && value ? text(value.props?.children) : String(value ?? '');
  const render = () => { index = 0; return nodes(PlayerActions(props)); };
  const button = label => render().find(n => n.type === 'button' && text(n.props.children) === label);
  return { props, state, selected, commands, modes, render, button, text, closed: () => closed };
}
test('player menu offers profile, reserve replacement and internal exchange without selectors', t => {
  const e = fixture(t);
  assert.ok(e.button('Ver perfil'));
  assert.ok(e.button('Sustituir por un suplente'));
  assert.ok(e.button('Cambio interno'));
  assert.equal(e.render().some(n => n.type === 'select'), false);
  e.button('Cambio interno').props.onClick();
  assert.equal(e.selected.mode, 'internal');
  assert.match(e.text(e.render()[0]), /Toca al otro jugador/);
  assert.equal(e.render().some(n => n.props?.role === 'dialog'), false);
});
test('read-only profiles expose only match data and no mutation or private identity', t => {
  const e = fixture(t, { canManage: false });
  assert.equal(e.button('Sustituir por un suplente'), undefined);
  assert.equal(e.button('Cambio interno'), undefined);
  e.button('Ver perfil').props.onClick();
  const text = e.text(e.render()[0]);
  assert.match(text, /Perfil en este partido/);
  assert.equal(text.includes(e.selected.id), false);
  assert.doesNotMatch(text, /Promedio|Cédula|Correo|Estadísticas personales/);
});
test('bank shows present reserves only and a known jersey permits one-touch substitution', async t => {
  const e = fixture(t), reserves = e.state.seed.rosters.home.slice(9);
  e.props.presentIds = [...e.state.lineups.home.map(p => p.id), reserves[0].id];
  e.button('Sustituir por un suplente').props.onClick();
  assert.ok(e.button(`${reserves[0].name} · #${reserves[0].jersey}`));
  assert.equal(e.button(`${reserves[1].name} · #${reserves[1].jersey}`), undefined);
  e.button(`${reserves[0].name} · #${reserves[0].jersey}`).props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(e.commands[0], { kind: 'substitution', side: 'home', outId: e.selected.id,
    inId: reserves[0].id, position: e.state.lineups.home[3].position, jersey: reserves[0].jersey });
  assert.equal(e.closed(), 1);
});
test('late arrival excludes starters and present reserves, asks for shirt and sends one combined action', async t => {
  const e = fixture(t), reserves = e.state.seed.rosters.home.slice(9);
  e.props.presentIds = [...e.state.lineups.home.map(p => p.id), reserves[0].id];
  e.selected.mode = 'roster';
  assert.equal(e.button(`${reserves[0].name} · #${reserves[0].jersey}`), undefined);
  e.button(`${reserves[1].name} · #${reserves[1].jersey}`).props.onClick();
  assert.equal(e.commands.length, 0);
  const input = e.render().find(n => n.type === 'input');
  input.props.onChange({ target: { value: '77' } });
  e.render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(e.commands[0].arrival, true);
  assert.equal(e.commands[0].jersey, '77');
  assert.equal(e.commands[0].inId, reserves[1].id);
});
test('invalid shirts and stale context never submit; backend errors are visible inside the dialog', async t => {
  const e = fixture(t), reserves = e.state.seed.rosters.home.slice(9);
  e.selected.mode = 'roster'; e.props.presentIds = [];
  e.button(`${reserves[0].name} · #${reserves[0].jersey}`).props.onClick();
  e.render().find(n => n.type === 'input').props.onChange({ target: { value: '2' } });
  e.render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(e.commands.length, 0);
  assert.match(e.text(e.render()[0]), /sin repetir/);
  e.render().find(n => n.type === 'input').props.onChange({ target: { value: '77' } });
  e.props.onCommand = async () => { throw new Error('Conflicto de revisión de prueba'); };
  e.render().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(e.text(e.render()[0]), /Conflicto de revisión de prueba/);
  e.selected.context = 'old';
  assert.equal(e.button('Guardar camiseta y cambio').props.disabled, true);
});
test('command schemas reject misplaced or malformed arrival and explicit swap metadata', () => {
  assert.equal(isScorecardCommand({ kind: 'pitch', value: 'ball', arrival: true }), false);
  assert.equal(isScorecardCommand({ kind: 'position', side: 'home', playerId: 'H1', position: 'P', swapWith: 'H1' }), false);
  assert.equal(isScorecardCommand({ kind: 'substitution', side: 'home', outId: 'H1', inId: 'H2', position: 'P', jersey: '22', arrival: false }), false);
});
