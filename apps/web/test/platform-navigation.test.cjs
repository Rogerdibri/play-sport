const assert = require('node:assert/strict');
const { test } = require('node:test');
const { platformRoles, platformModuleIds } = require('@playsport/shared');
const { demoModules, readDemoSession, demoIdentity, liveScoringHref, demoModuleHref, legacyDemoSession } = require('../app/platform-navigation');
const session = (role, team = 'team-A') => ({ version: 1, role, team });

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

test('both manager identities route to the correct team without creating a second scoring tool', () => {
  assert.equal(liveScoringHref(session('manager')), '/demo/live-scoring');
  assert.equal(liveScoringHref(session('manager', 'team-B')), '/demo/live-scoring?view=rival');
  assert.equal(demoIdentity(session('manager')).id, 'mgr-A');
  assert.equal(demoIdentity(session('manager', 'team-B')).id, 'mgr-B');
  const teamModule = demoModules.find(module => module.id === 'team-hq');
  assert.equal(demoModuleHref(teamModule, session('manager')), '/demo/live-scoring');
});

test('fan, player and scout only receive public live-scoring links', () => {
  for (const role of ['fan', 'player', 'scout']) {
    assert.equal(liveScoringHref(session(role)), '/demo/live-scoring?view=public');
    assert.equal(demoModuleHref(demoModules.find(module => module.id === 'team-hq'), session(role)), null);
    assert.equal(demoModuleHref(demoModules.find(module => module.id === 'organizer-center'), session(role)), null);
  }
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
  assert.deepEqual(demoModules.filter(module => module.status === 'working').map(module => module.id), ['live-scoring', 'team-hq']);
});
