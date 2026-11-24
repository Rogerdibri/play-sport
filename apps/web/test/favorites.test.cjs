const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  readFavoriteRef, readFavoriteChange, readFavoritesSnapshot, favoriteKey, favoritesFirst,
  favoriteMatchesGame, favoriteMatchesTournament, favoritesChangedEvent, favoritesChangedKey,
  playerDemoGames, playerDemoTournaments, calculateOfficialStandings,
} = require('@playsport/shared');
const favorites = require('../app/favorites');
const accountId = randomUUID();
const playerId = `player:${'a'.repeat(64)}`;
const catalog = [
  { kind: 'team', id: 'team-one', name: 'Equipo de prueba', memberships: [{ tournamentId: 'one', teamId: 'team-one' }] },
  { kind: 'league', id: 'league-one', name: 'Liga de prueba', memberships: [{ tournamentId: 'one', teamId: '' }] },
  { kind: 'player', id: playerId, name: 'Jugador de prueba', memberships: [{ tournamentId: 'one', teamId: 'team-two' }] },
];
const snapshot = (items = [], owner = accountId) => ({ accountId: owner, items, catalog });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('contracts reject foreign accounts, duplicate identities, invalid player IDs and extra write parameters', () => {
  assert.throws(() => readFavoriteRef({ kind: 'player', id: 'V99000001' }));
  assert.throws(() => readFavoriteChange({ kind: 'team', id: 'team-one', favorite: 'yes', expectedAccountId: accountId, requestId: randomUUID() }));
  assert.throws(() => readFavoriteChange({ kind: 'team', id: 'team-one', favorite: true, expectedAccountId: accountId, requestId: randomUUID(), role: 'organizer' }));
  assert.throws(() => readFavoritesSnapshot(snapshot([], randomUUID()), accountId));
  assert.throws(() => readFavoritesSnapshot(snapshot([catalog[0], catalog[0]]), accountId));
  assert.throws(() => readFavoritesSnapshot({ ...snapshot(), catalog: [catalog[0], catalog[0]] }, accountId));
  assert.notEqual(favoriteKey({ kind: 'team', id: 'same' }), favoriteKey({ kind: 'league', id: 'same' }));
  assert.deepEqual(readFavoritesSnapshot(snapshot(), accountId), snapshot());
});
test('favorites are a stable, non-mutating partition and match exact tournament/team identities, never names', () => {
  const rows = Object.freeze([{ id: 'a', time: 1 }, { id: 'b', time: 2 }, { id: 'c', time: 3 }, { id: 'd', time: 4 }]);
  assert.deepEqual(favoritesFirst(rows, row => ['b', 'd'].includes(row.id)).map(row => row.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd']);
  const game = { tournamentId: 'one', homeTeamId: 'team-two', awayTeamId: 'other' };
  assert.equal(favoriteMatchesGame([catalog[0]], catalog, game), false);
  assert.equal(favoriteMatchesGame([catalog[1]], catalog, game), true);
  assert.equal(favoriteMatchesGame([catalog[2]], catalog, game), true);
  assert.equal(favoriteMatchesGame([catalog[2]], catalog, { ...game, tournamentId: 'two' }), false);
  assert.equal(favoriteMatchesGame([catalog[0]], catalog, { ...game, homeTeamId: 'team-one' }), true);
  assert.equal(favoriteMatchesTournament([catalog[2]], catalog, 'one'), true);
  assert.equal(favoriteMatchesTournament([catalog[2]], catalog, 'other'), false);
});

function harness(t, { response, storageFails = false } = {}) {
  let account = { id: accountId }, observed, cleanup;
  const states = [], refs = [], requests = [], writes = [], buttons = [];
  let index = 0, refIndex = 0, effects = [], items = [];
  const bus = new EventTarget();
  t.after(() => cleanup?.());
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ account }));
  t.mock.method(require('../app/navigation-hooks'), 'useNavigationBusy', () => {});
  for (const [key, value] of Object.entries({
    addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus),
    dispatchEvent: bus.dispatchEvent.bind(bus),
    localStorage: { setItem: (key, value) => { if (storageFails) throw new Error('Storage unavailable'); writes.push({ key, value }); } },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  }
  t.mock.method(React, 'useState', initial => {
    const key = index++;
    if (!(key in states)) states[key] = initial;
    return [states[key], value => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
  });
  t.mock.method(React, 'useRef', initial => {
    const key = refIndex++;
    return refs[key] ?? (refs[key] = { current: initial });
  });
  t.mock.method(React, 'useEffect', (effect, deps) => effects.push({ effect, deps }));
  const jsx = require('react/jsx-runtime'), originalJsx = jsx.jsx;
  t.mock.method(jsx, 'jsx', (type, props, ...rest) => {
    if (type === 'button') buttons.push(props);
    return originalJsx(type, props, ...rest);
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const command = options.method === 'POST' ? JSON.parse(options.body) : null;
    requests.push({ url, options, command });
    const override = response?.(command, account.id);
    if (override) return override;
    if (command) {
      items = items.filter(row => favoriteKey(row) !== favoriteKey(command));
      if (command.favorite) items.push({ kind: command.kind, id: command.id });
    }
    return new Response(JSON.stringify(snapshot(items, account.id)));
  });
  function Consumer() {
    observed = favorites.useFavorites();
    return React.createElement(favorites.FavoriteButton, { kind: 'team', id: 'team-one' });
  }
  function render() {
    index = 0; refIndex = 0; effects = []; buttons.length = 0;
    return renderToStaticMarkup(React.createElement(favorites.default, null, React.createElement(Consumer)));
  }
  async function mount() {
    render(); cleanup = effects[0]?.effect();
    await tick(); return render();
  }
  return {
    mount, render, requests, writes, observed: () => observed,
    emit: async type => { bus.dispatchEvent(new Event(type)); await tick(); render(); },
    storage: async () => { const event = new Event('storage'); Object.defineProperty(event, 'key', { value: favoritesChangedKey }); bus.dispatchEvent(event); await tick(); render(); },
    button: label => buttons.find(row => row.children === label),
    change: async (ref = catalog[0], value = true) => { observed.change(ref, value); await tick(); return render(); },
    switchAccount: async owner => {
      cleanup?.(); cleanup = undefined;
      account = { id: owner }; items = []; states.length = 0; refs.length = 0;
      return mount();
    },
  };
}
test('baseball control uses its own accessible SVG and saved state, without emoji or role-specific copies', async t => {
  const e = harness(t);
  const initial = await e.mount();
  assert.match(initial, /aria-pressed="false"/);
  assert.match(initial, /aria-label="Añadir Equipo de prueba a favoritos"/);
  assert.match(initial, /<svg/);
  assert.doesNotMatch(initial, /⚾|★|⭐/);
  const marked = await e.change();
  assert.match(marked, /aria-pressed="true"/);
  assert.equal(e.observed().items.length, 1);
  assert.equal(e.writes[0].key, favoritesChangedKey);
  await e.emit('focus');
  await e.emit(favoritesChangedEvent);
  await e.storage();
  assert.equal(e.observed().isFavorite(catalog[0]), true);
  assert.equal(e.requests.filter(row => !row.command).length, 4);
  await e.change(catalog[0], false);
  assert.equal(e.observed().items.length, 0);
});
test('an uncertain command cannot be displaced, focus cannot hide recovery, and retry retains the same request ID', async t => {
  let failing = true;
  const e = harness(t, { response: command => command && failing ? Promise.reject(new Error('Conexión interrumpida')) : null });
  await e.mount();
  const failed = await e.change();
  assert.match(failed, /Reintentar cambio/);
  assert.equal(e.observed().busy, true);
  assert.equal(e.observed().items.length, 0);
  const requestId = e.requests.find(row => row.command).command.requestId;
  await e.emit('focus');
  await e.storage();
  assert.match(e.render(), /Conexión interrumpida/);
  await e.change(catalog[1]);
  assert.equal(e.requests.filter(row => row.command).length, 1);
  failing = false;
  e.button('Reintentar cambio').onClick();
  await tick(); e.render();
  assert.equal(e.requests.filter(row => row.command)[1].command.requestId, requestId);
  assert.equal(e.observed().items.length, 1);
  assert.equal(e.observed().busy, false);
});
test('explicit reconciliation unlocks an uncertain command and stale GET responses cannot overwrite a successful POST', async t => {
  let fail = true, oldGet, delayGet = false;
  const e = harness(t, { response: command => {
    if (command && fail) return Promise.reject(new Error('Sin confirmación'));
    if (!command && delayGet) return new Promise(resolve => { oldGet = resolve; });
  } });
  await e.mount(); await e.change();
  await e.button('Consultar estado guardado').onClick(); e.render();
  assert.equal(e.observed().busy, false);
  fail = false; delayGet = true;
  await e.emit('focus');
  await e.change();
  oldGet(new Response(JSON.stringify(snapshot())));
  await tick(); e.render();
  assert.equal(e.observed().isFavorite(catalog[0]), true);
});
test('late responses and foreign snapshots never cross an account boundary', async t => {
  let latePost;
  const other = randomUUID();
  const e = harness(t, { response: command => command ? new Promise(resolve => { latePost = resolve; }) : null });
  await e.mount();
  e.observed().change(catalog[0], true);
  await e.switchAccount(other);
  latePost(new Response(JSON.stringify(snapshot([{ kind: 'team', id: 'team-one' }]))));
  await tick(); e.render();
  assert.equal(e.observed().accountId, other);
  assert.equal(e.observed().items.length, 0);
  await t.test('foreign response', async child => {
    const foreign = harness(child, { response: () => new Response(JSON.stringify(snapshot([], other))) });
    assert.match(await foreign.mount(), /no corresponden a esta cuenta/);
    assert.equal(foreign.observed().ready, false);
  });
});
test('cross-tab storage errors explicitly distinguish a saved favorite from a failed save', async t => {
  const e = harness(t, { storageFails: true });
  await e.mount();
  assert.match(await e.change(), /quedó guardado, pero no se pudo avisar/);
  assert.equal(e.observed().isFavorite(catalog[0]), true);
  assert.equal(e.observed().busy, false);
});
test('official standings prioritize whole tournaments but preserve every rank, rival and result', t => {
  t.mock.method(require('../app/player-sports-context'), 'usePlayerSports', () => null);
  t.mock.method(require('../app/demo/[slug]/use-public-official-games'), 'default', () => ({ games: playerDemoGames, error: '', refresh() {} }));
  const classification = calculateOfficialStandings(playerDemoGames);
  const target = classification.at(-1);
  const ref = { kind: 'league', id: 'test-league' };
  const targets = [{ ...ref, name: 'Liga de prueba', memberships: [{ tournamentId: target.id, teamId: '' }] }];
  t.mock.method(favorites, 'useFavorites', () => ({
    ...snapshot([ref]), ready: true, busy: false, error: '', catalog: targets,
    isFavorite: () => false,
    matchesTournament: id => favoriteMatchesTournament([ref], targets, id),
  }));
  const html = renderToStaticMarkup(React.createElement(require('../app/demo/[slug]/official-standings').default));
  assert.ok(html.indexOf(target.name) < html.indexOf(classification[0].name));
  const table = html.slice(html.indexOf(target.name)).match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...table.matchAll(/<tr[^>]*><td>(.*?)<\/td><th[^>]*>([\s\S]*?)<\/th>((?:<td>.*?<\/td>)+)<\/tr>/g)];
  assert.equal(rows.length, target.rows.length);
  rows.forEach((match, index) => {
    const row = target.rows[index];
    assert.equal(match[1], String(row.rank ?? '—'));
    assert.match(match[2], new RegExp(target.teamNames[row.team]));
    assert.deepEqual([...match[3].matchAll(/<td>(.*?)<\/td>/g)].map(value => value[1]),
      [row.played, row.wins, row.losses, row.ties, row.runsFor, row.runsAgainst].map(String));
  });
  assert.equal(playerDemoTournaments.some(row => row.id === target.id), true);
});
test('same-origin proxy rejects identity queries and forwards cookie, origin and exact command without caching', async t => {
  const { NextRequest } = require('next/server');
  const { GET, POST } = require('../app/api/favorites/route');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(snapshot()), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal((await GET(new NextRequest('http://localhost:3000/api/favorites?accountId=other'))).status, 400);
  assert.equal(requests.length, 0);
  const command = { kind: 'team', id: 'team-one', favorite: true, requestId: randomUUID(), expectedAccountId: accountId };
  const result = await POST(new NextRequest('http://localhost:3000/api/favorites', { method: 'POST',
    headers: { Cookie: 'playsport-account=opaque', Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
    body: JSON.stringify(command) }));
  assert.equal(result.status, 200);
  assert.equal(requests[0].options.headers.get('cookie'), 'playsport-account=opaque');
  assert.equal(requests[0].options.headers.get('origin'), 'http://localhost:3000');
  assert.deepEqual(JSON.parse(requests[0].options.body), command);
  assert.equal(requests[0].options.cache, 'no-store');
});
