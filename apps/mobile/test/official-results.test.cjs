const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let buttons = [];
const element = tag => ({ children, accessibilityRole, onPress }) => {
  if (onPress) buttons.push({ children, onPress });
  return React.createElement(tag, { role: accessibilityRole === 'alert' ? 'alert' : undefined, onClick: onPress }, children);
};
const nativePath = require.resolve('react-native');
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  Text: element('span'), View: element('div'), Pressable: element('button'), ScrollView: element('section'), StyleSheet: { create: styles => styles }
} };
const catalog = require('../use-public-official-games');
const PublicGames = require('../public-official-games').default;
const OfficialResult = require('../official-result').default;
const Standings = require('../official-standings').default;
const game = {
  gameId: 'selected-official', tournamentId: 'tour-selected', homeTeamId: 'home', awayTeamId: 'away',
  status: 'final', homeScore: 5, awayScore: 1,
  details: { tournamentName: 'Torneo seleccionado', homeTeamName: 'Locales seleccionados', awayTeamName: 'Visitantes seleccionados',
    date: '2026-11-05', time: '18:00', venue: 'Sede seleccionada' },
  protest: { teamId: 'home', reason: 'Regla cuestionada', declaredAt: '2026-11-05T21:00:00Z', declaredBy: 'score',
    moment: { inning: 3, outs: 2, balls: 1, strikes: 2, homeScore: 5, awayScore: 1, officialVersion: 12, lastPlay: 'Bola' },
    resolution: { winnerTeamId: 'away', loserTeamId: 'home', reason: 'Decisión documentada', recordReference: 'Acta MT-NATIVE',
      recordedBy: 'org', recordedAt: '2026-11-05T22:00:00Z' } }
};
const render = (Component, props) => { buttons = []; return renderToStaticMarkup(React.createElement(Component, props)); };
test('native result and public detail display the acta winner, preserved score, basis and reference without write controls', t => {
  t.mock.method(catalog, 'default', () => ({ games: [game], error: '', refresh() {} }));
  const result = render(OfficialResult, { game });
  assert.match(result, /Ganador: Visitantes seleccionados · Perdedor: Locales seleccionados/);
  assert.match(result, /no por estas carreras/);
  const detail = render(PublicGames, { apiBase: 'http://localhost:4000', gameId: game.gameId, onSelect() {}, onBack() {} });
  assert.match(detail, /Acta MT-NATIVE/);
  assert.match(detail, /Decisión documentada/);
  assert.doesNotMatch(detail, /Registrar resolución|Registrar llegada|Juego bajo protesta|<input|<form/);
});
test('native public list and official standings show the same technical winner and link to selected detail', t => {
  t.mock.method(catalog, 'default', () => ({ games: [game], error: '', refresh() {} }));
  let selected;
  const list = render(PublicGames, { apiBase: 'http://localhost:4000', gameId: null, onSelect(id) { selected = id; }, onBack() {} });
  assert.match(list, /Ganador: Visitantes seleccionados/);
  assert.match(list, /Ver partido y resolución/);
  buttons.find(button => button.children.props.children === 'Ver partido y resolución').onPress();
  assert.equal(selected, game.gameId);
  selected = null;
  const table = render(Standings, { apiBase: 'http://localhost:4000', onOpenGame(id) { selected = id; } });
  assert.match(table, /Visitantes seleccionados ganador/);
  assert.match(table, /Ver partido y acta/);
  buttons.find(button => button.children.props.children === 'Ver partido y acta').onPress();
  assert.equal(selected, game.gameId);
});
test('native catalog errors remain explicit rather than showing an unrelated scoreboard', t => {
  t.mock.method(catalog, 'default', () => ({ games: null, error: 'API no disponible', refresh() {} }));
  const html = render(PublicGames, { apiBase: 'http://localhost:4000', gameId: game.gameId, onSelect() {}, onBack() {} });
  assert.match(html, /API no disponible/);
  assert.doesNotMatch(html, /Ganador:|Tigres|Leones|Acta MT-NATIVE/);
});
