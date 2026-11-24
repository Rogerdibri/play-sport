const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const {
  isTeamSportsRole,
  playerDemoMemberships,
  playerDemoTournaments,
  playerTeamPreference,
  demoProfileLocation,
  playerScopeStandings,
  playerDemoGames,
  readDemoProfiles,
} = require('@playsport/shared');
const {
  demoModules,
  demoModuleHref,
  liveScoringHref,
  demoIdentity,
  managerWorkContext,
} = require('../app/platform-navigation');

const session = {
  version: 1,
  role: 'manager',
  team: 'team-A',
  location: demoProfileLocation,
};
function mockContext(t, demo = true) {
  const team = demo ? playerDemoMemberships[0] : null;
  const enter = t.mock.fn();
  const chooseTeam = t.mock.fn();
  t.mock.method(
    require('../app/platform-session'),
    'usePlatformSession',
    () => ({
      ready: true,
      session,
      account: demo
        ? null
        : { id: 'real-manager', displayName: 'Cuenta real de prueba' },
      enter,
      reportNavigationError: assert.fail,
    }),
  );
  t.mock.method(
    require('../app/player-sports-context'),
    'usePlayerSports',
    () => ({
      role: 'manager',
      ready: true,
      demo,
      error: '',
      notice: '',
      teams: demo ? playerDemoMemberships : [],
      tournaments: demo ? playerDemoTournaments : [],
      profile: demoProfileLocation,
      preference: playerTeamPreference(team, demoProfileLocation),
      selectedTeam: team,
      chooseTeam,
      updateFilter() {},
      refresh() {},
    }),
  );
  t.mock.method(
    require('../app/navigation-hooks'),
    'useNavigationDraft',
    () => [null, assert.fail, true],
  );
  t.mock.method(require('../app/navigation-hooks'), 'useScreenBack', () => {});
  t.mock.method(
    require('../app/demo/[slug]/use-public-official-games'),
    'default',
    () => ({ games: [], error: '', refresh() {} }),
  );
  return { enter, chooseTeam };
}
test('team consultation is limited to player/manager and manager module navigation preserves the existing operational routes', () => {
  for (const role of ['player', 'manager'])
    assert.equal(isTeamSportsRole(role), true);
  for (const role of ['fan', 'organizer', 'scorekeeper', 'scout', null])
    assert.equal(isTeamSportsRole(role), false);
  const live = demoModules.find((module) => module.id === 'live-scoring');
  assert.equal(demoModuleHref(live, session), '/demo/live-scoring?view=public');
  assert.equal(liveScoringHref(session), '/demo/live-scoring');
  assert.equal(
    liveScoringHref({ ...session, team: 'team-B' }),
    '/demo/live-scoring?view=rival',
  );
  assert.equal(
    demoModuleHref(
      demoModules.find((module) => module.id === 'team-hq'),
      session,
    ),
    '/demo/roster',
  );
  assert.equal(
    demoModuleHref(
      demoModules.find((module) => module.id === 'manager-games'),
      session,
    ),
    '/demo/manager-games',
  );
});
test('real manager identity labels use the account or explicitly chosen work team, never inherited demo aliases', () => {
  const account = { id: 'real-manager', displayName: 'Manager de prueba' };
  assert.deepEqual(demoIdentity(session, account), {
    id: 'real-manager',
    name: 'Manager de prueba',
  });
  assert.equal(
    demoIdentity({ ...session, workTeamName: 'Equipo asignado' }, account).name,
    'Dirigente de Equipo asignado',
  );
  assert.equal(
    demoIdentity(session, { ...account, localTestAccess: true }).name,
    'Dirigente de Tigres del Valle',
  );
});
test('manager home shares the selected-team hero while retaining separate work, roster and lineup tools', (t) => {
  const { enter } = mockContext(t);
  const Home = require('../app/page').default;
  const before = managerWorkContext(session);
  const markup = renderToStaticMarkup(React.createElement(Home));
  assert.match(markup, /· Manager/);
  assert.match(markup, /Cóndores del Ávila/);
  assert.match(markup, /Equipo activo para consultas/);
  assert.doesNotMatch(markup, /Probar manager con varios equipos|EQUIPOS DE DEMOSTRACIÓN/);
  assert.match(markup, /Equipo de trabajo y herramientas del manager/);
  assert.match(markup, /href="\/demo\/roster"/);
  assert.match(markup, /href="\/demo\/manager-games"/);
  assert.match(markup, /href="\/demo\/live-scoring"/);
  assert.deepEqual(managerWorkContext(session), before);
  assert.equal(enter.mock.callCount(), 0);
});
test('manager calendar and standings use the same selected tournament without mutating work context', (t) => {
  const { enter } = mockContext(t);
  const Cartelera = require('../app/demo/[slug]/events-map').default;
  const Standings = require('../app/demo/[slug]/standings').default;
  for (const [component, props] of [
    [Cartelera, {}],
    [Standings, {}],
  ]) {
    const markup = renderToStaticMarkup(React.createElement(component, props));
    assert.match(markup, /Copa Metropolitana 2026/);
    assert.match(markup, /Cambiar equipo, liga o zona/);
    assert.doesNotMatch(markup, /Copa del Lago 2026 · En curso/);
  }
  assert.equal(enter.mock.callCount(), 0);
  const team = playerDemoMemberships[0];
  const games = playerScopeStandings(
    playerDemoGames,
    playerDemoTournaments,
    playerTeamPreference(team, demoProfileLocation).filter,
  );
  assert.ok(
    games.some(
      (game) =>
        game.homeTeamId !== team.teamId && game.awayTeamId !== team.teamId,
    ),
  );
});
test('a real manager without assignments is not shown fictional teams or inherited demo work tools', (t) => {
  mockContext(t, false);
  t.mock.method(require('../app/sports-home-highlights'), 'default', () => null);
  const Home = require('../app/page').default;
  const markup = renderToStaticMarkup(React.createElement(Home));
  assert.match(markup, /Aún no tienes equipos asignados como manager/);
  assert.doesNotMatch(
    markup,
    /Cóndores|Guardianes|Toros|Tigres|Probar manager/,
  );
});

test('manager consultation proxy forwards the own-account cookie and rejects writes and identity parameters', async (t) => {
  const { NextRequest } = require('next/server');
  const { GET, POST } = require('../app/api/sporting/[...path]/route');
  const params = Promise.resolve({
    path: ['registration', 'roster', 'manager-teams'],
  });
  let forwarded;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ accountId: 'owner', teams: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const url =
    'http://localhost:3000/api/sporting/registration/roster/manager-teams';
  const response = await GET(
    new NextRequest(url, { headers: { Cookie: 'playsport-account=opaque' } }),
    { params },
  );
  assert.equal(response.status, 200);
  assert.ok(
    String(forwarded.url).endsWith('/registration/roster/manager-teams'),
  );
  assert.equal(
    forwarded.options.headers.get('cookie'),
    'playsport-account=opaque',
  );
  assert.equal(
    (await GET(new NextRequest(`${url}?managerId=other`), { params })).status,
    404,
  );
  assert.equal(
    (await POST(new NextRequest(url, { method: 'POST' }), { params })).status,
    404,
  );
  assert.equal(fetch.mock.callCount(), 1);
});

function providerHarness(t, { role = 'manager', account, response } = {}) {
  const platform = require('../app/platform-session');
  const navigation = require('../app/navigation-hooks');
  const sports = require('../app/player-sports-context');
  let currentAccount = account ?? null;
  let cleanup;
  t.after(() => cleanup?.());
  t.mock.method(platform, 'usePlatformSession', () => ({
    ready: true, session: { ...session, role }, account: currentAccount,
  }));
  t.mock.method(navigation, 'useNavigationDraft', () => [null, () => {}, true]);
  for (const [key, value] of Object.entries({
    localStorage: { getItem: () => null }, document: { hidden: false },
    addEventListener() {}, removeEventListener() {},
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  }
  t.mock.method(globalThis, 'setInterval', () => 1);
  t.mock.method(globalThis, 'clearInterval', () => {});
  const states = [], refs = [], requests = [];
  let index = 0, refIndex = 0, effects = [], observed, dependencies;
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
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    const override = response?.(url);
    if (override) return override;
    return new Response(JSON.stringify(
      url.endsWith('/discovery') ? { tournaments: [] } :
      url === '/api/accounts/profile' ? { accountId: currentAccount.id, document: readDemoProfiles(null) } :
      { accountId: currentAccount.id, teams: [] }
    ));
  });
  function Consumer() {
    observed = sports.usePlayerSports();
    return React.createElement('output', null, String(observed.ready));
  }
  const render = () => {
    index = 0; refIndex = 0; effects = [];
    return renderToStaticMarkup(React.createElement(sports.default, null, React.createElement(Consumer)));
  };
  return {
    requests, observed: () => observed,
    dependencies: () => dependencies,
    changeAccount: value => { currentAccount = value; },
    load: async () => {
      cleanup?.();
      render();
      const owner = currentAccount?.id ?? demoIdentity({ ...session, role }).id;
      const effect = effects.find(({ deps }) => deps?.[1] === owner);
      dependencies = effect.deps;
      cleanup = effect.effect();
      await new Promise(resolve => setImmediate(resolve));
      render();
      return observed;
    },
  };
}
test('unverified tester and normal accounts load sports without requesting the forbidden personal profile', async t => {
  for (const role of ['manager', 'player']) {
    for (const localTestAccess of [false, true]) await t.test(`${role} tester=${localTestAccess}`, async child => {
      const e = providerHarness(child, {
        role, account: { id: 'sports-owner', localTestAccess },
        response: url => url === '/api/accounts/profile' ? new Response('{}', { status: 403 }) : null,
      });
      const sports = await e.load();
      assert.equal(sports.error, '');
      assert.equal(sports.ready, true);
      assert.equal(e.requests.some(({ url }) => url === '/api/accounts/profile'), false);
      assert.deepEqual(sports.profile, demoProfileLocation);
      assert.equal(sports.demo, localTestAccess);
      assert.deepEqual(sports.teams, localTestAccess ? playerDemoMemberships : []);
      if (role === 'manager') assert.ok(e.requests.some(({ url }) => url.endsWith('/manager-teams')));
    });
  }
});
test('anonymous consultation stays public and verification enables private profile loading on the same account', async t => {
  await t.test('anonymous', async child => {
    const e = providerHarness(child, { role: 'player' });
    assert.equal((await e.load()).ready, true);
    assert.equal(e.requests.length, 1);
    assert.ok(e.requests[0].url.endsWith('/discovery'));
  });
  await t.test('verification changes', async child => {
    const e = providerHarness(child, { account: { id: 'sports-owner' } });
    await e.load();
    const before = e.dependencies();
    e.changeAccount({ id: 'sports-owner', identity: { status: 'verified', actorId: 'person:owner' } });
    assert.equal((await e.load()).ready, true);
    assert.notDeepEqual(e.dependencies(), before);
    assert.equal(e.requests.filter(({ url }) => url === '/api/accounts/profile').length, 1);
  });
});
test('real session and ownership failures remain errors rather than becoming successful demo contexts', async t => {
  for (const [name, response, expected] of [
    ['expired session', url => url.endsWith('/manager-teams') ? new Response('{}', { status: 401 }) : null, /sesión/],
    ['foreign profile', url => url === '/api/accounts/profile'
      ? new Response(JSON.stringify({ accountId: 'someone-else', document: readDemoProfiles(null) })) : null, /no corresponde/],
    ['profile forbidden', url => url === '/api/accounts/profile' ? new Response('{}', { status: 403 }) : null, /perfil deportivo/],
  ]) await t.test(name, async child => {
    const e = providerHarness(child, { account: { id: 'sports-owner', identity: { status: 'verified' } }, response });
    const sports = await e.load();
    assert.equal(sports.ready, false);
    assert.match(sports.error, expected);
    assert.deepEqual(sports.teams, []);
  });
});
test('retry recovers an actual catalog failure without changing the account', async t => {
  let failing = true;
  const e = providerHarness(t, {
    account: { id: 'sports-owner', localTestAccess: true },
    response: url => failing && url.endsWith('/discovery') ? new Response('{}', { status: 503 }) : null,
  });
  assert.match((await e.load()).error, /catálogo de torneos/);
  failing = false;
  e.observed().refresh();
  const sports = await e.load();
  assert.equal(sports.error, '');
  assert.equal(sports.ready, true);
  assert.deepEqual(sports.teams, playerDemoMemberships);
});
