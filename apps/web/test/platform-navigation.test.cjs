const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { platformRoles, platformModuleIds } = require('@playsport/shared');
const { demoModules, readDemoSession, demoIdentity, liveScoringHref, demoModuleHref, legacyDemoSession, demoProfileRedirect, readLocalTestProfile } = require('../app/platform-navigation');
const { normalizeAppRoutes, previousAppRoute, readNavigationDraft, isTextDraft, isStringListDraft, isTextMapDraft, isChoiceDraft } = require('../app/navigation-drafts');
const session = (role, team = 'team-A') => ({ version: 1, role, team });
test('sports sheet history collapses the legacy redirect without removing nested screens or query navigation', () => {
  assert.deepEqual(normalizeAppRoutes(['/', '/demo/player-career', '/sports-sheet']), ['/', '/sports-sheet']);
  assert.deepEqual(normalizeAppRoutes(['/demo/player-career?old=1', '/sports-sheet']), ['/sports-sheet']);
  assert.deepEqual(normalizeAppRoutes(['/', '/sports-sheet', '/sports-sheet/statistics', '/sports-sheet']),
    ['/', '/sports-sheet', '/sports-sheet/statistics', '/sports-sheet']);
  assert.deepEqual(normalizeAppRoutes(['/demo/live-scoring?view=public', '/demo/live-scoring?view=organizer']),
    ['/demo/live-scoring?view=public', '/demo/live-scoring?view=organizer']);
});
test('shared action hover feedback keeps the mouse hit target stationary and excludes disabled controls', () => {
  const css = readFileSync(require.resolve('../app/globals.css'), 'utf8');
  for (const rule of [
    /\.cta:hover:not\(:disabled\),\s*\.moduleLink:hover:not\(:disabled\),\s*\.actionButton:hover:not\(:disabled\)\s*\{([^}]*)\}/,
    /\.managerButtonSolid:hover:not\(:disabled\),\s*\.managerButtonOutline:hover:not\(:disabled\)\s*\{([^}]*)\}/,
  ]) {
    const body = css.match(rule)?.[1];
    assert.ok(body, 'Common actions must retain their non-disabled hover feedback');
    assert.match(body, /filter:\s*brightness\(0\.96\)/);
    assert.doesNotMatch(body, /transform|translate|scale|rotate|margin|padding|border-width|font-size|width|height/);
  }
});
test('real official roles use the verified account actor, never the role picker aliases', () => {
  const { officialAccountActor } = require('../app/platform-navigation');
  for (const role of ['organizer', 'scorekeeper']) {
    assert.equal(officialAccountActor({ identity: { status: 'verified', actorId: 'person:verified-owner' } }, role), 'person:verified-owner');
    assert.equal(officialAccountActor({ identity: { status: 'pending', actorId: 'person:pending' } }, role), null);
    assert.equal(officialAccountActor({ id: 'without-identity' }, role), null);
    assert.equal(officialAccountActor({ localTestAccess: true }, role), role === 'organizer' ? 'org-demo' : 'scorer-demo');
  }
});
test('persistent local tester preferences remember valid roles and teams only for the authenticated owner', () => {
  for (const role of platformRoles) {
    const stored = { version: 1, accountId: 'tester', session: session(role.id, 'team-B') };
    assert.deepEqual(readLocalTestProfile(stored, 'tester'), stored.session);
    assert.throws(() => readLocalTestProfile(stored, 'other-account'), /corresponde/);
  }
  assert.throws(() => readLocalTestProfile({ version: 1, accountId: 'tester', session: session('admin') }, 'tester'), /no es válido/);
  assert.throws(() => readLocalTestProfile({}, 'tester'), /corresponde/);
});

test('all six existing roles have an identity and their modules are retained in the web inventory', () => {
  assert.deepEqual(platformRoles.map(role => role.id), ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']);
  const expected = new Set();
  for (const role of platformRoles) {
    assert.ok(demoIdentity(session(role.id)).id);
    for (const id of platformModuleIds(role.id)) expected.add(id);
  }
  assert.deepEqual(new Set(demoModules.map(module => module.id)), expected);
  assert.equal(new Set(demoModules.map(module => module.slug)).size, demoModules.length);
});

test('stored selections reject malformed roles, teams and versions', () => {
  for (const value of [null, {}, session('admin'), session('manager', 'foreign-team'), { ...session('fan'), version: 2 }]) {
    assert.equal(readDemoSession(value), null);
  }
  assert.deepEqual(readDemoSession(session('manager', 'team-B')), session('manager', 'team-B'));
});

test('official profiles enter their real existing scoring tools', () => {
  assert.equal(liveScoringHref(session('organizer')), '/demo/live-scoring?view=organizer');
  assert.equal(liveScoringHref(session('scorekeeper')), '/demo/live-scoring?view=scorekeeper');
});

test('scorekeeper keeps separate assigned-game and direct live-scoreboard entry points', () => {
  const module = demoModules.find(item => item.id === 'live-scoring');
  assert.equal(module.title, 'Pizarra en vivo');
  assert.equal(demoModuleHref(module, session('scorekeeper')), '/demo/live-scoring?view=scorekeeper&entry=live');
  assert.equal(liveScoringHref(session('scorekeeper')), '/demo/live-scoring?view=scorekeeper');
});

test('both manager identities route to the correct team without creating a second scoring tool', () => {
  assert.equal(liveScoringHref(session('manager')), '/demo/live-scoring');
  assert.equal(liveScoringHref(session('manager', 'team-B')), '/demo/live-scoring?view=rival');
  assert.equal(demoIdentity(session('manager')).id, 'mgr-A');
  assert.equal(demoIdentity(session('manager', 'team-B')).id, 'mgr-B');
  const teamModule = demoModules.find(module => module.id === 'team-hq');
  assert.equal(demoModuleHref(teamModule, session('manager')), '/demo/roster');
});

test('player and scout keep their public live-scoring shortcuts', () => {
  for (const role of ['player', 'scout']) {
    assert.equal(liveScoringHref(session(role)), '/demo/live-scoring?view=public');
    assert.equal(demoModuleHref(demoModules.find(module => module.id === 'live-scoring'), session(role)), '/demo/live-scoring?view=public');
    assert.equal(demoModuleHref(demoModules.find(module => module.id === 'team-hq'), session(role)), null);
    assert.equal(demoModuleHref(demoModules.find(module => module.id === 'organizer-center'), session(role)), null);
  }
});

test('fan home omits the direct scoreboard and directs live navigation to the calendar without revoking observation', () => {
  const fan = session('fan');
  const visible = demoModules.filter(module => demoModuleHref(module, fan) !== null);
  assert.deepEqual(visible.map(module => module.id), ['friendly-games', 'events-map', 'standings', 'marketplace', 'player-career']);
  assert.equal(demoModuleHref(demoModules.find(module => module.id === 'live-scoring'), fan), null);
  assert.equal(liveScoringHref(fan), '/demo/events-map');
  assert.equal(demoModuleHref(demoModules.find(module => module.id === 'events-map'), fan), '/demo/events-map');
  assert.ok(platformModuleIds('fan').includes('live-scoring'));
  assert.equal(demoProfileRedirect(fan, legacyDemoSession('organizer')), '/demo/events-map');
  assert.equal(demoProfileRedirect(fan, legacyDemoSession('public')), null);
  assert.equal(demoModuleHref(demoModules.find(module => module.id === 'team-hq'), fan), null);
  assert.equal(demoModuleHref(demoModules.find(module => module.id === 'organizer-center'), fan), null);
});

test('existing direct links keep their profiles while public views never impersonate a manager', () => {
  assert.deepEqual(legacyDemoSession(), session('manager'));
  assert.deepEqual(legacyDemoSession('rival'), session('manager', 'team-B'));
  assert.deepEqual(legacyDemoSession('organizer'), session('organizer'));
  assert.deepEqual(legacyDemoSession('scorekeeper'), session('scorekeeper'));
  assert.equal(legacyDemoSession('public'), null);
});

test('unfinished modules explicitly retain their planned actions rather than claiming completion', () => {
  for (const module of demoModules.filter(module => module.status !== 'working')) assert.ok(module.actions.length > 0);
  assert.deepEqual(demoModules.filter(module => module.status === 'working').map(module => module.id), ['tournaments', 'friendly-games', 'live-scoring', 'events-map', 'standings', 'player-career', 'team-hq', 'manager-games']);
});

test('every role opens the sports sheet directly without entering its legacy redirect', () => {
  const career = demoModules.find(module => module.id === 'player-career');
  assert.equal(career.title, 'Hoja deportiva');
  for (const role of platformRoles) assert.equal(demoModuleHref(career, session(role.id)), '/sports-sheet');
});

test('manager assigned games remains independent of the roster and live scoreboard', () => {
  const module = demoModules.find(item => item.id === 'manager-games');
  assert.equal(module.title, 'Mis partidos asignados');
  for (const team of ['team-A', 'team-B']) assert.equal(demoModuleHref(module, session('manager', team)), '/demo/manager-games');
  for (const role of ['fan','player','organizer','scorekeeper','scout']) assert.equal(demoModuleHref(module, session(role)), null);
  assert.equal(demoModuleHref(demoModules.find(item => item.id === 'team-hq'), session('manager')), '/demo/roster');
});

test('a player keeps their observer profile even when opening manager or official legacy links', () => {
  for (const view of [undefined, 'rival', 'organizer', 'scorekeeper', 'private-example', 'player']) {
    assert.equal(demoProfileRedirect(session('player'), legacyDemoSession(view)), '/demo/live-scoring?view=public');
  }
  assert.equal(demoProfileRedirect(session('player'), legacyDemoSession('public')), null);
});

test('links cannot silently replace an active profile or assigned manager team', () => {
  for (const active of platformRoles) {
    for (const requested of ['manager', 'organizer', 'scorekeeper']) {
      assert.equal(demoProfileRedirect(session(active.id), session(requested)),
        active.id === requested ? null : liveScoringHref(session(active.id)));
    }
  }
  assert.equal(demoProfileRedirect(session('manager'), session('manager', 'team-B')), '/demo/live-scoring');
  assert.equal(demoProfileRedirect(session('manager', 'team-B'), session('manager')), '/demo/live-scoring?view=rival');
  assert.equal(demoProfileRedirect(null, session('scorekeeper')), null);
});

test('back navigation stays inside the app and has a safe home fallback', () => {
  assert.equal(previousAppRoute([]), '/');
  assert.equal(previousAppRoute(['/demo/live-scoring?view=public']), '/');
  const routes = ['/', '/demo/player-career', '/demo/live-scoring?view=public'];
  assert.equal(previousAppRoute(routes), '/demo/player-career');
  assert.deepEqual(routes, ['/', '/demo/player-career', '/demo/live-scoring?view=public']);
});

test('unconfirmed drafts restore values without running an official scoring operation', () => {
  assert.equal(readNavigationDraft(null, '', isTextDraft), '');
  assert.equal(readNavigationDraft(JSON.stringify({ version: 1, value: 'Pendiente, no publicar' }), '', isTextDraft), 'Pendiente, no publicar');
  assert.deepEqual(readNavigationDraft(JSON.stringify({ version: 1, value: ['HOME0'] }), [], isStringListDraft), ['HOME0']);
  assert.deepEqual(readNavigationDraft(JSON.stringify({ version: 1, value: { request: 'Nota pendiente' } }), {}, isTextMapDraft), { request: 'Nota pendiente' });
  const side = isChoiceDraft(['home', 'away']);
  assert.equal(readNavigationDraft(JSON.stringify({ version: 1, value: 'away' }), 'home', side), 'away');
  for (const raw of ['invalid-json', '{"version":2,"value":"home"}', '{"version":1,"value":"foreign"}']) {
    assert.throws(() => readNavigationDraft(raw, 'home', side));
  }
});
