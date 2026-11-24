const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const nativePath = require.resolve('react-native');
const element = tag => ({ children, accessibilityLabel, accessibilityRole, onPress, value }) =>
  React.createElement(tag, { 'aria-label': accessibilityLabel, role: accessibilityRole, onClick: onPress,
    ...(value === undefined ? {} : { defaultValue: value }) }, children);
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  Text: element('span'), View: element('div'), Pressable: element('button'), ScrollView: element('section'),
  TextInput: element('input'), StyleSheet: { create: value => value }
} };
const { default: ManagerGame, managerPersonnelAction } = require('../manager-game');
const { createPrivateState } = require('@playsport/shared');
const OfficialGames = require('../official-games').default;
const game = { gameId: 'another-game', tournamentId: 'another-tour', managerTeamId: 'away', homeTeamId: 'home', awayTeamId: 'away',
  status: 'scheduled', homeScore: 0, awayScore: 0, details: null, assignedScorekeeperIds: [], availableScorekeeperIds: [] };
const fields = { player: 'PLAYERIN', outgoing: 'PLAYEROUT', position: 'SS', jersey: '22', base: 2, name: 'Directivo ficticio', role: 'DELEGADO' };
const sheets = { ownTeamId: 'away', sheets: [{ teamId: 'away', lineup: [{ battingOrder: 1, displayName: 'Jugador asignado',
  identificationNumber: 'PLAYEROUT', jerseyNumber: '7', fieldPosition: 'P' }] }], requests: [] };
const renderGame = (t, status = 'scheduled') => {
  let index = 0; const useState = React.useState;
  t.mock.method(React, 'useState', initial => index++ === 0 ? [{ observation: { status, scorecard: createPrivateState({
    names: { home: 'Local de ejemplo', away: 'Visitante de ejemplo' }, lineups: { home: [], away: [] },
    rosters: { home: [], away: [] }, courtesyRunnerSource: 'ROSTER'
  }) }, sheets }, () => {}] : useState(initial));
  return renderToStaticMarkup(React.createElement(ManagerGame, { apiBase: 'http://localhost:4000', game, managerId: 'mgr-B',
    disabled: false, onBusy() {}, onBack() {}, onPrepare() {} }));
};
test('native manager personnel requests preserve correct action shapes and never include scoring commands', () => {
  assert.deepEqual(managerPersonnelAction('arrival', fields), { kind: 'arrival', identificationNumber: 'PLAYERIN' });
  assert.deepEqual(managerPersonnelAction('defense', fields), { kind: 'defense', identificationNumber: 'PLAYERIN', fieldPosition: 'SS' });
  assert.deepEqual(managerPersonnelAction('substitution', fields), { kind: 'substitution', outgoingIdentificationNumber: 'PLAYEROUT',
    incomingIdentificationNumber: 'PLAYERIN', fieldPosition: 'SS', jerseyNumber: '22' });
  assert.deepEqual(managerPersonnelAction('courtesy', fields), { kind: 'courtesy', outgoingIdentificationNumber: 'PLAYEROUT', incomingIdentificationNumber: 'PLAYERIN', fromBase: 2 });
  assert.deepEqual(managerPersonnelAction('staff-arrival', fields), { kind: 'staff-arrival', official: {
    identificationNumber: 'PLAYERIN', displayName: 'Directivo ficticio', role: 'DELEGADO' } });
  assert.deepEqual(managerPersonnelAction('staff-departure', fields), { kind: 'staff-departure', identificationNumber: 'PLAYERIN', role: 'DELEGADO' });
  assert.throws(() => managerPersonnelAction('arrival', { ...fields, player: '' }));
  assert.throws(() => managerPersonnelAction('substitution', { ...fields, outgoing: '' }));
  assert.throws(() => managerPersonnelAction('courtesy', { ...fields, base: 4 }));
});
test('native manager workspace shows its lineup and requests but never scorer lifecycle controls', t => {
  const html = renderGame(t);
  assert.match(html, /Jugador asignado/); assert.match(html, /Orden al bate fijo/);
  assert.match(html, /Enviar solicitud al organizador o anotador/);
  assert.doesNotMatch(html, /Registrar turno al bate|Suspender por clima|Reprogramar partido|Bola|Strike/);
});
test('closed and suspended native workspaces lock all manager mutations', t => {
  for (const status of ['suspended', 'protested', 'final']) {
    const html = renderGame(t, status);
    assert.match(html, /solo lectura/);
    assert.doesNotMatch(html, /<input|Enviar solicitud|Preparar y entregar lineup/);
  }
});
test('native manager assignment cards have their own actions without scorer examples', t => {
  let index = 0; const useState = React.useState;
  t.mock.method(React, 'useState', initial => index++ === 0 ? [{ userId: 'mgr-B', role: 'manager', games: [game] }, () => {}] : useState(initial));
  const html = renderToStaticMarkup(React.createElement(OfficialGames, { apiBase: 'http://localhost:4000', role: 'manager', managerId: 'mgr-B',
    managerTeam:{teamId:'away',tournamentId:'another-tour'},
    disabled: false, onBusy() {}, onSelect() {}, preferredId: '', onOpenAssignments() {} }));
  assert.match(html, /Mis partidos asignados/);
  assert.match(html, /Preparar lineup y gestionar equipo/);
  assert.doesNotMatch(html, /Explora con ejemplos|Iniciar anotación|Asignación guardada/);
});
test('native manager assignments remain scoped to the working team and tournament',async t=>{
  const useState=React.useState,effects=[];let index=0,loaded;
  t.mock.method(React,'useState',initial=>{
    const state=useState(initial);return index++===0?[state[0],value=>{loaded=value;}]:state;
  });
  t.mock.method(React,'useEffect',effect=>effects.push(effect));
  t.mock.method(global,'fetch',async()=>({ok:true,json:async()=>({userId:'mgr-B',role:'manager',games:[
    game,{...game,gameId:'other-tournament',tournamentId:'other-tour'},
    {...game,gameId:'other-team-game',managerTeamId:'other-team',homeTeamId:'other-team'}
  ]})}));
  renderToStaticMarkup(React.createElement(OfficialGames,{apiBase:'http://localhost:4000',role:'manager',managerId:'mgr-B',
    managerTeam:{teamId:'away',tournamentId:'another-tour'},disabled:false,onBusy(){},onSelect(){},preferredId:'',onOpenAssignments(){}}));
  const cleanups=effects.map(effect=>effect());
  try{await new Promise(setImmediate);assert.deepEqual(loaded.games.map(row=>row.gameId),[game.gameId]);}
  finally{for(const cleanup of cleanups)if(typeof cleanup==='function')cleanup();}
});
