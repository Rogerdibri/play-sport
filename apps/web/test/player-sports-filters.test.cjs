const assert = require('node:assert/strict');
const { test } = require('node:test');
const { playerTeamPreference, demoProfileLocation, isPlayerSportsPreference, playerScopeGames, playerDemoGames, venezuelaStates } = require('@playsport/shared');
const context = require('../app/player-sports-context');
const platform = require('../app/platform-session');
const favorites = require('../app/favorites');
const { PlayerSportsFilters } = require('../app/player-sports-controls');

function elements(node, type) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(item => elements(item, type));
  return [...(node.type === type ? [node] : []), ...elements(node.props?.children, type)];
}
test('player and manager can clear the geographic restriction without changing their team or profile', t => {
  const locations = [demoProfileLocation, ...venezuelaStates.filter(state => !state.municipalities.length)
    .map(state => ({ stateId: state.id, municipalityId: '' }))];
  for (const role of ['player', 'manager']) for (const location of locations) {
    const preference = playerTeamPreference(null, demoProfileLocation);
    preference.filter.scope = 'state';
    preference.filter.location = location;
    const before = structuredClone(preference);
    let updated;
    const sports = { role, ready: true, teams: [], tournaments: [], selectedTeam: null, preference,
      updateFilter(filter) { updated = filter; } };
    t.mock.method(context, 'usePlayerSports', () => sports);
    t.mock.method(platform, 'usePlatformSession', () => ({ reportNavigationError(message) { assert.fail(message); } }));
    t.mock.method(favorites, 'useFavorites', () => null);
    const select = elements(PlayerSportsFilters(), 'select')[0];
    const all = elements(select, 'option').find(option => option.props.children === 'Todos los estados');
    assert.ok(all);
    assert.ok(!all.props.disabled);
    select.props.onChange({ target: { value: all.props.value } });
    assert.deepEqual(updated, { ...before.filter, scope: 'all' });
    assert.deepEqual(preference, before);
    assert.ok(isPlayerSportsPreference({ ...preference, filter: updated }));
    assert.deepEqual(playerScopeGames(playerDemoGames, [], updated), playerDemoGames);
    sports.preference = { ...preference, filter: updated };
    const general = PlayerSportsFilters();
    assert.equal(elements(general, 'select')[0].props.value, all.props.value);
    assert.ok(!elements(general, 'span').some(span => span.props.children === 'Municipio de la consulta'));
    elements(general, 'select')[0].props.onChange({ target: { value: 'VE-D' } });
    assert.equal(updated.scope, 'state');
    assert.equal(updated.location.stateId, 'VE-D');
  }
});
