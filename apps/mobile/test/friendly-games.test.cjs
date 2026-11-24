const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const element = tag => ({ children, accessibilityLabel, onPress, value }) =>
  React.createElement(tag, { 'aria-label': accessibilityLabel, onClick: onPress, ...(value === undefined ? {} : { defaultValue: value }) }, children);
const nativePath = require.resolve('react-native');
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  Text: element('span'), View: element('div'), Pressable: element('button'), ScrollView: element('section'),
  TextInput: element('textarea'), StyleSheet: { create: styles => styles }, Alert: { alert() {} }
} };
const storagePath = require.resolve('@react-native-async-storage/async-storage');
require.cache[storagePath] = { id: storagePath, filename: storagePath, loaded: true,
  exports: { getItem: async () => null, setItem: async () => {} } };
const { createPrivateState } = require('@playsport/shared');
const FriendlyGames = require('../friendly-games').default;
function render(t, { creating = false, game = null } = {}) {
  const useState = React.useState;
  let index = 0;
  t.mock.method(React, 'useState', initial => {
    const position = index++;
    if (position === 0) return [game ? [game] : [], () => {}];
    if (position === 2) return [true, () => {}];
    if (position === 3) return [creating, () => {}];
    return useState(initial);
  });
  return renderToStaticMarkup(React.createElement(FriendlyGames,
    { accountId: 'fan-demo', gameId: game?.id ?? null, onSelect() {}, onBusy() {} }));
}
test('native friendly creation accepts names only and makes privacy explicit', t => {
  const html = render(t, { creating: true });
  assert.match(html, /Nombre del equipo local|Nombre del equipo visitante/);
  assert.match(html, /Nombre del local, turno 1|Nombre del visitante, turno 1/);
  assert.equal((html.match(/aria-label="Nombre del (local|visitante), turno \d+"/g) ?? []).length, 24);
  assert.equal((html.match(/Posición del (local|visitante), turno \d+:/g) ?? []).length, 24);
  assert.match(html, /turno 12/);
  assert.doesNotMatch(html, /turno 13/);
  assert.match(html, /Mínimo 9 participantes/);
  assert.match(html, /Comenzar amistoso/);
  assert.match(html, /Solo tú puedes consultarlos/);
  assert.doesNotMatch(html, /Camiseta|camiseta|Cédula|cédula|Inscribir|Registrar jugador/);
});
test('native finalized friendly retains names and statistics without scoring or reopening controls', t => {
  const player = (id, name) => ({ id, name, order: 1, position: 'NA', jersey: '' });
  const lineups = { home: [player('private-home', 'Ana')], away: [player('private-away', 'Luis')] };
  const seed = { friendly: true, names: { home: 'Vecinos', away: 'Amigos' }, lineups, rosters: lineups,
    courtesyRunnerSource: 'ROSTER', regulationInnings: 9 };
  const game = { id: 'friendly-a', seed, commands: [], state: { ...createPrivateState(seed), finished: true } };
  const html = render(t, { game });
  assert.match(html, /Finalizado · Solo lectura/);
  assert.match(html, /Ana|Luis|AVG/);
  assert.doesNotMatch(html, /Finalizar amistoso|Anotar jugadas|Deshacer última|Camiseta|cédula|private-home|private-away/);
});
