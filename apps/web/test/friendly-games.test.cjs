const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createPrivateState, FriendlyClient, platformRoles } = require('@playsport/shared');
const { demoModules, demoModuleHref } = require('../app/platform-navigation');
const hooks = require('../app/navigation-hooks');
const platform = require('../app/platform-session');
const { FriendlyScorecard, FriendlyWorkspace } = require('../app/demo/[slug]/friendly-games');
test('every role can open its private friendly module, including the fan', () => {
  const module = demoModules.find(item => item.id === 'friendly-games');
  for (const role of platformRoles) assert.equal(demoModuleHref(module, { version: 1, role: role.id, team: 'team-A' }), '/demo/friendly-games');
});
test('web creation has twelve ordered name and position rows per team with nine required names', t => {
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(hooks, 'useScreenBack', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  const useState = React.useState;
  let index = 0;
  t.mock.method(React, 'useState', initial => {
    const current = index++;
    if (current === 0) return [[], () => {}];
    if (current === 2) return [true, () => {}];
    return useState(initial);
  });
  const html = renderToStaticMarkup(React.createElement(FriendlyWorkspace, { accountId: 'fan-demo' }));
  assert.equal((html.match(/class="friendlyCreationRow"/g) ?? []).length, 24);
  assert.equal((html.match(/aria-label="Nombre del (local|visitante), turno \d+"/g) ?? []).length, 24);
  assert.equal((html.match(/aria-label="Posición del (local|visitante), turno \d+"/g) ?? []).length, 24);
  const inputs = html.match(/<input[^>]*aria-label="Nombre del (local|visitante), turno \d+"[^>]*>/g);
  assert.equal(inputs.filter(input => input.includes('required=""')).length, 18);
  assert.match(html, /turno 12/);
  assert.match(html, /Suplentes del local \(0\)/);
  assert.match(html, /Suplentes del visitante \(0\)/);
  assert.match(html, /Agregar suplente al local/);
  assert.match(html, /Agregar suplente al visitante/);
  assert.doesNotMatch(html, /turno 13|<textarea|camiseta/i);
  assert.equal(/<input[^>]*aria-label="Cédula/.test(html), false, 'identity remains optional and outside creation');
});
test('creation adds, edits, removes and restores benches without changing starters or the other team', t => {
  let draft = { sport: 'baseball', home: 'Local', away: 'Visitante', homePlayers: 'Titular local', awayPlayers: 'Titular visitante' };
  const states = new Map([[0, []], [2, true]]);
  let stateIndex = 0;
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [draft ?? initial, next => {
    draft = typeof next === 'function' ? next(draft) : next;
  }, true]);
  t.mock.method(hooks, 'useScreenBack', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(React, 'useMemo', factory => factory());
  t.mock.method(React, 'useRef', initial => ({ current: initial }));
  t.mock.method(React, 'useState', initial => {
    const index = stateIndex++;
    if (!states.has(index)) states.set(index, initial);
    return [states.get(index), next => states.set(index, typeof next === 'function' ? next(states.get(index)) : next)];
  });
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => { stateIndex = 0; return nodes(FriendlyWorkspace({ accountId: 'account-bench' })); };
  const text = value => Array.isArray(value) ? value.map(text).join('') : String(value ?? '');
  const click = label => render().find(n => n.type === 'button' && (n.props['aria-label'] ?? text(n.props.children)) === label).props.onClick();
  const fill = (label, value) => render().find(n => n.type === 'input' && n.props['aria-label'] === label).props.onChange({ target: { value } });
  click('Agregar suplente al local');
  fill('Nombre del suplente 1 del local', 'Reserva local');
  click('Agregar suplente al visitante');
  fill('Nombre del suplente 1 del visitante', 'Reserva visitante');
  click('Agregar suplente al local');
  fill('Nombre del suplente 2 del local', 'Segunda reserva');
  click('Quitar suplente 1 del local');
  assert.deepEqual(draft.homeSubstitutes, ['Segunda reserva']);
  assert.deepEqual(draft.awaySubstitutes, ['Reserva visitante']);
  assert.equal(draft.homePlayers, 'Titular local');
  assert.equal(draft.awayPlayers, 'Titular visitante');
  draft = JSON.parse(JSON.stringify(draft));
  assert.equal(render().find(n => n.type === 'input' && n.props['aria-label'] === 'Nombre del suplente 1 del local').props.value, 'Segunda reserva');
  for (let index = 0; index < 25; index++) click('Agregar suplente al local');
  assert.equal(draft.homeSubstitutes.length, 26);
  const blank = render().find(n => n.type === 'input' && n.props['aria-label'] === 'Nombre del suplente 26 del local');
  assert.equal(blank.props.required, true);
  const opened = [];
  blank.props.onInvalid({ currentTarget: { closest: selector => {
    assert.equal(selector, 'details');
    return { setAttribute: (...args) => opened.push(args) };
  } } });
  assert.deepEqual(opened, [['open', '']]);
});
test('friendly scoreboard has real scoring controls and no jersey, identity, registry or official mutation controls', t => {
  t.mock.method(platform, 'usePlatformSession', () => ({ ready: true, account: null }));
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(hooks, 'useScreenBack', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  const player = (id, name) => ({ id, name, order: 1, position: 'NA', jersey: '' });
  const lineups = { home: [player('opaque-home', 'Ana')], away: [player('opaque-away', 'Luis')] };
  const seed = { friendly: true, names: { home: 'Vecinos', away: 'Amigos' }, lineups, rosters: lineups,
    courtesyRunnerSource: 'ROSTER', regulationInnings: 9 };
  const state = createPrivateState(seed);
  const game = { id: 'friendly-a', revision: 1, sport: 'baseball', createdAt: '', updatedAt: '', seed, commands: [], state };
  const render = value => renderToStaticMarkup(React.createElement(FriendlyScorecard, { game: value, side: 'home', busy: false, update: async () => {}, onBack() {} }));
  const html = render(game);
  assert.match(html, /Finalizar amistoso/);
  assert.match(html, /Jugadas predeterminadas|Jonrón/);
  assert.match(html, /Ana|Luis/);
  assert.doesNotMatch(html, /Camiseta|camiseta|Cédula|cédula|Finalizar partido oficial|PLANILLA OFICIAL/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /opaque-home|opaque-away/);
  const final = render({ ...game, state: { ...state, finished: true } });
  assert.match(final, /Resumen final del partido/);
  assert.match(final, /Volver a la hoja de anotación/);
  assert.doesNotMatch(final, /Finalizar amistoso|Anotar jugadas|Anotación oficial/);
});
test('only a successful explicit refresh resets the selected scoring view after a conflict', async t => {
  const game = { id: 'friendly-refresh', revision: 1, seed: { names: { home: 'Local', away: 'Visitante' } },
    state: { finished: false, scores: { home: 0, away: 0 } } };
  const state = new Map([[0, [game]], [1, game.id]]), refs = [];
  let stateIndex = 0, refIndex = 0, effect, client, resolveRead, rejectRead;
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  t.mock.method(hooks, 'useScreenBack', () => {});
  t.mock.method(React, 'useState', initial => {
    const index = stateIndex++;
    if (!state.has(index)) state.set(index, initial);
    return [state.get(index), next => state.set(index, typeof next === 'function' ? next(state.get(index)) : next)];
  });
  t.mock.method(React, 'useRef', initial => refs[refIndex++] ??= { current: initial });
  t.mock.method(React, 'useMemo', factory => client ??= factory());
  t.mock.method(React, 'useEffect', callback => { effect = callback; });
  t.mock.method(FriendlyClient.prototype, 'list', () => new Promise((resolve, reject) => {
    resolveRead = resolve; rejectRead = reject;
  }));
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
  const render = () => {
    stateIndex = 0; refIndex = 0;
    return nodes(FriendlyWorkspace({ accountId: 'account-refresh' }));
  };
  const selected = tree => tree.find(node => node.type === FriendlyScorecard);
  const refresh = tree => tree.find(node => node.type === 'button' && node.props.children === 'Actualizar mis amistosos').props.onClick();
  const original = selected(render()).key;
  refresh(render());
  assert.equal(selected(render()).key, original);
  effect();
  rejectRead(new Error('No se pudo actualizar.'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(selected(render()).key, original, 'A failed request must not clear the current conflict view');
  refresh(render());
  const pending = render();
  assert.equal(selected(pending).key, original);
  effect();
  const updated = { ...game, revision: 2 };
  resolveRead([updated]);
  await new Promise(resolve => setImmediate(resolve));
  const refreshed = selected(render());
  assert.notEqual(refreshed.key, original);
  assert.equal(refreshed.props.game, updated);
});
test('account friendlies stay on the account proxy even when the public scoring origin is configured separately', async t => {
  const previous = process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE;
  process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE = 'https://unrelated.example.test/api/official-scoring';
  t.after(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE;
    else process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE = previous;
  });
  t.mock.method(hooks, 'useNavigationDraft', (_key, initial) => [initial, () => {}, true]);
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  t.mock.method(hooks, 'useScreenBack', () => {});
  let effect;
  const requests = [];
  t.mock.method(React, 'useEffect', callback => { effect ??= callback; });
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ games: [] }) };
  });
  renderToStaticMarkup(React.createElement(FriendlyWorkspace, { accountId: 'account-proxy' }));
  effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['/api/friendly-games']);
});
