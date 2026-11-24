const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime');
const { PathnameContext } = require('next/dist/shared/lib/hooks-client-context.shared-runtime');
const { default: PlatformSession, usePlatformSession } = require('../app/platform-session');
const { demoSessionKey, localTestProfileKey } = require('../app/platform-navigation');
const { platformRoles, accountChangedEvent, accountPhotoChangedEvent } = require('@playsport/shared');

const account = { id: '12345678-1234-1234-1234-123456789abc', email: 'tester@example.test',
  displayName: 'Tester', createdAt: '2026-11-07T00:00:00.000Z', emailVerified: false,
  identityVerification: 'unavailable', financialAccess: false, localTestAccess: true };
const remembered = { version: 1, role: 'manager', team: 'team-B' };

test('legacy scoring links cannot restore a role cleared by the bottom navigation when providers remount', t => {
  const { DemoProfileRoute } = require('../app/platform-session');
  const profile = { version: 1, role: 'manager', team: 'team-A' };
  let context, effects, entries, redirects;
  t.mock.method(React, 'useContext', value => value === AppRouterContext ? { replace: path => redirects.push(path) } : context);
  t.mock.method(React, 'useEffect', effect => { effects.push(effect); });
  for (const homeRevision of [0, 1, 2]) {
    entries = []; redirects = [];
    context = { ready: true, session: null, homeRevision, enter: value => entries.push(value) };
    for (let remount = 0; remount < 2; remount++) {
      effects = [];
      renderToStaticMarkup(React.createElement(DemoProfileRoute, { profile }, 'Scoring tools'));
      effects.forEach(effect => effect());
    }
    if (homeRevision === 0) {
      assert.deepEqual(entries, [profile, profile]);
      assert.deepEqual(redirects, []);
    } else {
      assert.deepEqual(entries, []);
      assert.deepEqual(redirects, ['/', '/']);
    }
  }
});

function setup(t, tabSession = null, pathname = '/demo/live-scoring', storedChoice = tabSession ? JSON.stringify(tabSession) : undefined) {
  const local = new Map([[localTestProfileKey, JSON.stringify({ version: 1, accountId: account.id, session: remembered })]]);
  const tab = new Map(storedChoice === undefined ? [] : [[demoSessionKey, storedChoice]]);
  const listeners = new Map();
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
  for (const [name, value] of Object.entries({ localStorage: storage(local), sessionStorage: storage(tab),
    location: { pathname, search: '' }, addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener() {} })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name));
  }
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0, effects = [], resolveRequest;
  t.mock.method(React, 'useState', initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  });
  t.mock.method(React, 'useRef', initial => {
    const index = refIndex++;
    return refs[index] ?? (refs[index] = { current: initial });
  });
  t.mock.method(React, 'useEffect', (effect, deps) => { effects.push({ effect, deps }); });
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => { resolveRequest = resolve; }));
  let observed, tree;
  const destinations = [];
  function Consumer() { observed = usePlatformSession(); return React.createElement('output', null, String(observed.ready)); }
  function Capture() { tree = PlatformSession({ children: React.createElement(Consumer) }); return tree; }
  const render = () => {
    stateIndex = 0; refIndex = 0; effects = [];
    return renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: { push: path => destinations.push(path) } },
      React.createElement(PathnameContext.Provider, { value: pathname },
        React.createElement(Capture))));
  };
  render();
  effects.find(item => item.deps.length === 0).effect();
  render();
  effects.find(item => item.deps[0] === pathname).effect();
  const button = label => {
    const find = node => {
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'button' && node.props.children === label) return node;
      return React.Children.toArray(node.props?.children).map(find).find(Boolean) ?? null;
    };
    return find(tree);
  };
  return {
    observed: () => observed, render, tab, local, destinations, event: name => listeners.get(name)(),
    homeButton: () => button('Inicio'),
    backButton: () => button('Volver atrás'),
    visit: path => {
      pathname = path;
      globalThis.location.pathname = path;
      render();
      effects.find(item => item.deps.length === 4 && item.deps[0] === path).effect();
      return render();
    },
    flushPreferenceEffects: () => effects.filter(item => item.deps?.[0] === account.id).forEach(item => item.effect()),
    respond: async (status, body) => {
      resolveRequest(new Response(JSON.stringify(body), { status }));
      await new Promise(resolve => setImmediate(resolve));
      return render();
    }
  };
}

test('every role, the welcome and account pages keep one back button before the brand and menu', async t => {
  const cases = [['/', null], ['/account', remembered],
    ...platformRoles.map(({ id }) => ['/demo/events-map', { ...remembered, role: id }])];
  for (const [pathname, session] of cases) await t.test(`${pathname} ${session?.role ?? 'welcome'}`, async child => {
    const e = setup(child, session, pathname);
    const html = await e.respond(401, { message: 'No active account' });
    assert.match(html, /<header class="platformNav"><div class="platformBack"><button[^>]*>Volver atrás<\/button><\/div><a/);
    assert.equal((html.match(/>Volver atrás<\/button>/g) ?? []).length, 1);
    assert.doesNotMatch(html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '', /Volver atrás/);
    assert.ok(html.indexOf('class="sponsorStrip"') > html.indexOf('</nav>'));
    assert.equal((html.match(/class="sponsorStrip"/g) ?? []).length, 1);
    assert.equal((html.match(/alt="(?:BERA|DIKU|BERACARS|RICCIEGROUP|INDUSTRIAS HEDA|XPRESS MOTORS)"/g) ?? []).length, 6);
    assert.doesNotMatch(html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '', /platformSessionIdentity/);
    if (pathname === '/') assert.match(html, /<button[^>]*disabled=""[^>]*>Volver atrás/);
  });
});

test('changing any role opens the home role picker for testers and normal accounts without logging out or losing drafts', async t => {
  const paths = ['/', '/demo/events-map', '/demo/live-scoring', '/profile', '/wallet', '/identity'];
  for (const [index, { id: role }] of platformRoles.entries()) {
    for (const access of ['tester', 'normal', 'anonymous']) await t.test(`${role} ${access}`, async child => {
      const e = setup(child, { version: 1, role, team: 'team-A' }, paths[index]);
      const profile = access === 'tester' ? account : { ...account, localTestAccess: undefined };
      const html = await e.respond(access === 'anonymous' ? 401 : 200, { account: profile });
      assert.match(html, /<button[^>]*>Cambiar rol<\/button>/);
      assert.doesNotMatch(html, /localTesterTools|<summary>Cambiar rol|aria-label="Rol activo"/);
      assert.doesNotMatch(html, /href="\/identity"|>Logos</);
      e.tab.set('saved-game-draft', 'keep');
      const before = e.observed().account;
      e.observed().clear();
      e.render();
      assert.deepEqual(e.destinations, paths[index] === '/' ? [] : ['/']);
      assert.equal(e.observed().session, null);
      assert.equal(e.observed().account, before);
      assert.equal(e.observed().ready, true);
      assert.equal(e.tab.get(demoSessionKey), 'null');
      assert.equal(e.tab.get('saved-game-draft'), 'keep');
      if (access === 'tester') assert.equal(e.local.has(localTestProfileKey), false);
    });
  }
});

test('Back returns from sports statistics through the sheet to the previous role screen without cycling or clearing the account', async t => {
  for (const { id: role } of platformRoles) await t.test(role, async child => {
    const selected = { version: 1, role, team: 'team-A' };
    const e = setup(child, selected, '/');
    await e.respond(200, { account });
    const authenticated = e.observed().account;
    e.tab.set('saved-game-draft', 'keep');
    for (const path of ['/', '/sports-sheet', '/sports-sheet/statistics']) e.visit(path);
    for (const destination of ['/sports-sheet', '/']) {
      assert.equal(e.backButton().props.disabled, false);
      e.backButton().props.onClick();
      assert.equal(e.destinations.at(-1), destination);
      e.visit(destination);
    }
    assert.deepEqual(e.destinations, ['/sports-sheet', '/']);
    assert.equal(e.observed().account, authenticated);
    assert.deepEqual(e.observed().session, selected);
    assert.equal(e.tab.get('saved-game-draft'), 'keep');
    assert.deepEqual(JSON.parse(e.tab.get(demoSessionKey)), selected);
  });
});

test('Back escapes the sports sheet after the legacy module redirect instead of reopening it', async t => {
  for (const { id: role } of platformRoles) await t.test(role, async child => {
    const selected = { version: 1, role, team: 'team-A' };
    const e = setup(child, selected, '/');
    await e.respond(200, { account });
    for (let iteration = 0; iteration < 3; iteration++) {
      e.visit('/');
      e.visit('/demo/player-career');
      e.visit('/sports-sheet');
      e.backButton().props.onClick();
      assert.equal(e.destinations.at(-1), '/');
      e.visit('/');
      assert.deepEqual(e.observed().session, selected);
      assert.equal(e.observed().account.id, account.id);
    }
  });
});

test('Back has a working home fallback when the sports sheet is opened directly or reloaded', async t => {
  const e = setup(t, remembered, '/sports-sheet');
  await e.respond(200, { account });
  e.visit('/sports-sheet');
  assert.equal(e.backButton().props.disabled, false);
  e.backButton().props.onClick();
  assert.deepEqual(e.destinations, ['/']);
  assert.equal(e.observed().account.id, account.id);
  assert.deepEqual(e.observed().session, remembered);
});

test('root Back handles repeated role entries without a page callback or a navigation to the same URL', async t => {
  for (const { id: role } of platformRoles) await t.test(role, async child => {
    const e = setup(child, null, '/', 'null');
    await e.respond(200, { account });
    const authenticated = e.observed().account;
    e.tab.set('saved-game-draft', 'keep');
    for (let cycle = 0; cycle < 10; cycle++) {
      e.observed().enter({ version: 1, role, team: 'team-A' }); e.render();
      assert.equal(e.backButton().props.disabled, false);
      e.backButton().props.onClick(); e.render();
      assert.equal(e.observed().session, null);
      assert.equal(e.observed().homeRevision, cycle + 1);
      assert.equal(e.observed().account, authenticated);
      assert.equal(e.tab.get('saved-game-draft'), 'keep');
      assert.equal(e.tab.get(demoSessionKey), 'null');
      assert.deepEqual(e.destinations, []);
    }
  });
});

test('Back respects local screen handlers and releases them before leaving the sports sheet, while preserving save guards', async t => {
  const e = setup(t, remembered, '/sports-sheet');
  await e.respond(200, { account });
  e.visit('/sports-sheet');
  const actions = [];
  const close = e.observed().registerScreenBack(() => actions.push('closed'), 1);
  e.render();
  e.backButton().props.onClick();
  assert.deepEqual(actions, ['closed']);
  assert.deepEqual(e.destinations, []);
  close(); e.render();
  const saved = e.observed().registerNavigationBusy(); e.render();
  assert.equal(e.backButton().props.disabled, true);
  e.backButton().props.onClick();
  assert.deepEqual(e.destinations, []);
  saved(); e.render();
  assert.equal(e.backButton().props.disabled, false);
  e.observed().reportNavigationError('Cannot persist draft'); e.render();
  assert.equal(e.backButton().props.disabled, true);
  e.backButton().props.onClick();
  assert.deepEqual(e.destinations, []);
  e.observed().reportNavigationError(''); e.render();
  e.backButton().props.onClick();
  assert.deepEqual(e.destinations, ['/']);
});

test('legacy routes stay unready until the authenticated tester role and team have been restored', async t => {
  const e = setup(t);
  assert.equal(e.observed().ready, false);
  assert.equal(e.observed().session, null);
  await e.respond(200, { account });
  assert.equal(e.observed().ready, true);
  assert.deepEqual(e.observed().session, remembered);
  assert.equal(e.observed().localTester, true);
  assert.deepEqual(JSON.parse(e.tab.get(demoSessionKey)), remembered);
});

test('Inicio buttons open the welcome from root, account and modules for every role without closing the account or removing drafts', async t => {
  for (const { id: role } of platformRoles) for (const path of ['/', '/account', '/sports-sheet/career'])
    await t.test(`${role} ${path}`, async child => {
      const e = setup(child, { version: 1, role, team: 'team-A' }, path);
      await e.respond(200, { account });
      e.tab.set('saved-game-draft', 'keep'); e.local.set('sports-sheet-preference', 'keep');
      const authenticated = e.observed().account;
      assert.equal(e.homeButton().props.disabled, false);
      e.homeButton().props.onClick(); e.render();
      assert.deepEqual(e.destinations, path === '/' ? [] : ['/']); assert.equal(e.observed().session, null);
      assert.equal(e.observed().homeRevision, 1); assert.equal(e.observed().account, authenticated);
      assert.equal(e.tab.get('saved-game-draft'), 'keep'); assert.equal(e.local.get('sports-sheet-preference'), 'keep');
      assert.equal(e.local.has(localTestProfileKey), false);
      e.homeButton().props.onClick(); e.render();
      assert.equal(e.observed().homeRevision, 2, 'an already-open welcome can reset its team-selection subview');
    });
});
test('Inicio stays disabled until account lookup completes and while saving or resolving a draft error', async t => {
  const e = setup(t, remembered);
  assert.equal(e.homeButton().props.disabled, true);
  await e.respond(200, { account });
  const done = e.observed().registerNavigationBusy(); e.render();
  assert.equal(e.homeButton().props.disabled, true);
  done(); e.render(); assert.equal(e.homeButton().props.disabled, false);
  e.observed().reportNavigationError('Cannot persist draft'); e.render();
  assert.equal(e.homeButton().props.disabled, true);
});

test('account lookup completion preserves an existing tab role instead of replacing it with another tab preference', async t => {
  const current = { version: 1, role: 'scorekeeper', team: 'team-A' };
  const e = setup(t, current);
  assert.equal(e.observed().ready, false);
  await e.respond(200, { account });
  e.flushPreferenceEffects();
  assert.equal(e.observed().ready, true);
  assert.deepEqual(e.observed().session, current);
  assert.deepEqual(JSON.parse(e.local.get(localTestProfileKey)).session, remembered);
});

test('explicit role changes update the remembered tester preference, not an older tab reload', async t => {
  const e = setup(t);
  await e.respond(200, { account });
  const selected = { version: 1, role: 'player', team: 'team-A' };
  e.observed().enter(selected);
  assert.deepEqual(JSON.parse(e.local.get(localTestProfileKey)), { version: 1, accountId: account.id, session: selected });
  assert.deepEqual(JSON.parse(e.tab.get(demoSessionKey)), selected);
});
test('returning to the welcome stays there after focus even if another tab changes the remembered role', async t => {
  const e = setup(t, remembered, '/');
  await e.respond(200, { account });
  e.observed().clear(); e.render();
  e.local.set(localTestProfileKey, JSON.stringify({ version: 1, accountId: account.id, session: remembered }));
  e.event('focus');
  await e.respond(200, { account });
  assert.equal(e.observed().session, null);
  assert.equal(e.observed().account.id, account.id);
});
test('an explicit welcome selection survives reloading without treating it as a malformed role', async t => {
  const e = setup(t, null, '/', 'null');
  const html = await e.respond(200, { account });
  assert.equal(e.observed().session, null);
  assert.doesNotMatch(html, /El rol guardado no es válido/);
  assert.equal(e.observed().account.id, account.id);
});
test('an older working tab cannot recreate a remembered role cleared by another tab on focus', async t => {
  const e = setup(t, remembered, '/');
  await e.respond(200, { account });
  e.local.delete(localTestProfileKey);
  e.event('focus');
  await e.respond(200, { account });
  assert.equal(e.local.has(localTestProfileKey), false);
  assert.deepEqual(e.observed().session, remembered);
});
test('one authenticated photo survives all sporting role changes and disappears on unavailable account lookup', async t => {
  const e = setup(t), photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==';
  const withPhoto = { ...account, photo, photoRevision: 1 };
  const html = await e.respond(200, { account: withPhoto });
  assert.equal(e.observed().account.id, account.id); assert.equal(e.observed().account.photo, photo);
  assert.match(html, /Foto de Tester/);
  for (const { id: role } of platformRoles) {
    const selected = { version: 1, role, team: 'team-A' };
    e.observed().enter(selected); e.render();
    assert.equal(e.observed().session.role, role);
    assert.equal(e.observed().account.photo, photo); assert.equal(e.observed().account.id, account.id);
  }
  const currentRole = e.observed().session.role;
  e.event(accountPhotoChangedEvent); e.render();
  assert.equal(e.observed().ready, true); assert.equal(e.observed().account.photo, photo);
  await e.respond(200, { account: { ...withPhoto, photo: '', photoRevision: 2 } });
  assert.equal(e.observed().session.role, currentRole); assert.equal(e.observed().account.photo, '');
  e.event(accountChangedEvent); e.render();
  assert.equal(e.observed().account, null); assert.equal(e.observed().ready, false);
  await e.respond(401, { message: 'Sesión finalizada' });
  assert.equal(e.observed().account, null); assert.equal(e.observed().localTester, false);
});

test('an anonymous or unavailable account service releases demo readiness without restoring a tester role', async t => {
  for (const status of [401, 503]) await t.test(String(status), async child => {
    const e = setup(child), html = await e.respond(status, { message: 'Service unavailable' });
    assert.equal(e.observed().ready, true);
    assert.equal(e.observed().session, null);
    assert.equal(e.observed().localTester, false);
    if (status === 503) assert.match(html, /No se pudo comprobar el acceso/);
  });
});
