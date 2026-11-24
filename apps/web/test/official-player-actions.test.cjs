const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const hooks = require('../app/navigation-hooks');
const sheets = require('../app/demo/[slug]/team-sheets');
const OfficialRunScoring = require('../app/demo/[slug]/official-run-scoring').default;
const PrivateScorecardView = require('../app/demo/[slug]/private-scorecard-view').default;
const { createPrivateScorecardExample } = require('../app/demo/[slug]/private-scorecard-example-data');
const { createPrivateState } = require('@playsport/shared');

function fixture(t) {
  const { seed } = createPrivateScorecardExample();
  const snapshot = {
    state: { officialVersion: 7, status: 'in_progress', homeScore: 0, awayScore: 0 },
    playByPlay: { scorecard: createPrivateState(seed), canUndo: false, lastScorecardCommand: null, scoreMatches: true },
    lineup: { teams: { homeTeamId: 'home', awayTeamId: 'away' } }
  };
  const requests = [], records = [];
  const connection = {
    data: { ownTeamId: 'home', canDecide: false, sheets: [] },
    busy: false, error: '', streamError: '',
    request: async (teamId, action) => { requests.push({ teamId, action }); },
    record: async (...args) => { records.push(args); }
  };
  let stateIndex, refIndex;
  t.mock.method(React, 'useContext', () => ({ push() {} }));
  t.mock.method(React, 'useState', initial => [stateIndex++ === 0 ? snapshot : initial, () => {}]);
  t.mock.method(React, 'useRef', initial => ({ current: refIndex++ === 0 ? snapshot : initial }));
  t.mock.method(React, 'useEffect', () => {});
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  t.mock.method(hooks, 'useNavigationDraft', (_scope, initial) => [initial, () => {}, true]);
  t.mock.method(sheets, 'useTeamSheets', () => connection);
  const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) :
    [node, ...nodes(node.props?.children)];
  const render = (patch = {}) => {
    stateIndex = 0; refIndex = 0;
    return nodes(OfficialRunScoring({
      apiBase: '/api/official-scoring', actorId: 'manager', actorRole: 'manager',
      allowManagerRequests: true, ownTeamId: 'home', connection, ...patch
    })).find(node => node.type === PrivateScorecardView).props.official;
  };
  return { snapshot, requests, records, render };
}

test('manager player actions request changes only for their team and cannot write official scoring', async t => {
  const e = fixture(t), before = structuredClone(e.snapshot.playByPlay.scorecard);
  const controls = e.render();
  assert.equal(controls.readOnly, true);
  assert.equal(controls.busy, false);
  const action = { kind: 'substitution', outgoingIdentificationNumber: 'H1', incomingIdentificationNumber: 'H10',
    fieldPosition: 'P', jerseyNumber: '77', arrival: true };
  await controls.onPersonnelRequest('home', action);
  assert.deepEqual(e.requests, [{ teamId: 'home', action }]);
  await assert.rejects(controls.onPersonnelRequest('away', action), /Solo puedes solicitar cambios para tu equipo/);
  await assert.rejects(controls.onCommand({ kind: 'pitch', value: 'ball' }), /solo puede consultar/);
  assert.equal(e.requests.length, 1);
  assert.deepEqual(e.records, []);
  assert.deepEqual(e.snapshot.playByPlay.scorecard, before);
});

test('internal manager exchanges retain their explicit partner in the approval request', async t => {
  const e = fixture(t);
  const action = { kind: 'defense', identificationNumber: 'H1', fieldPosition: 'C', swapWith: 'H2' };
  await e.render().onPersonnelRequest('home', action);
  assert.deepEqual(e.requests, [{ teamId: 'home', action }]);
});

test('public, disabled, completed and blocked views expose no manager mutation callback', t => {
  const e = fixture(t);
  for (const patch of [
    { publicView: true }, { actorRole: 'scorekeeper' }, { actorRole: 'organizer' }, { allowManagerRequests: false }
  ]) assert.equal(e.render(patch).onPersonnelRequest, undefined);
  for (const status of ['final', 'suspended', 'protested']) {
    e.snapshot.state.status = status;
    assert.equal(e.render().onPersonnelRequest, undefined);
  }
  e.snapshot.state.status = 'in_progress';
  e.snapshot.state.protest = { reason: 'Prueba de bloqueo' };
  assert.equal(e.render().onPersonnelRequest, undefined);
});
