const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const element = tag => ({ children, accessibilityRole }) => React.createElement(tag, { role: accessibilityRole }, children);
const nativePath = require.resolve('react-native');
require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  Text: element('span'), View: element('div'), Pressable: element('button'), ScrollView: element('section'), TextInput: element('input'),
  StyleSheet: { create: styles => styles }, Linking: { openURL: async () => {} }
} };
const { SuspensionNotice } = require('../game-suspension');
const PublicGames = require('../public-official-games').default;
const catalog = require('../use-public-official-games');
const suspension = { id: 'game:suspension:1', cause: 'weather', scoreHandling: 'reset', reason: 'Lluvia intensa',
  recordedAt: '2026-11-05T22:00:00Z', recordedBy: 'score', role: 'scorekeeper', wasStarted: true,
  originalDate: '2026-11-05', originalTime: '18:00', rescheduled: null };
const game = { gameId: 'game', tournamentId: 'tour', homeTeamId: 'home', awayTeamId: 'away',
  status: 'suspended', homeScore: 0, awayScore: 0, suspension,
  details: { tournamentName: 'Prueba', homeTeamName: 'Locales', awayTeamName: 'Visitantes', date: '2026-11-05', time: '18:00', venue: 'Sede' } };
test('native suspension notice records reset, pending date, author and read-only archive access', () => {
  const html = renderToStaticMarkup(React.createElement(SuspensionNotice, { apiBase: 'http://localhost:4000', game, suspension, suspended: true }));
  assert.match(html, /Nueva fecha pendiente/); assert.match(html, /Se reinicia el juego completo/);
  assert.match(html, /anotación anterior está archivada/); assert.match(html, /Registrado por score/);
  assert.match(html, /Consultar anotación anterior archivada/);
  assert.doesNotMatch(html, /<input|Registrar suspensión|Guardar nueva fecha/);
});
test('native public catalog labels the old date as historical, not the new schedule', t => {
  t.mock.method(catalog, 'default', () => ({ games: [game], error: '', refresh() {} }));
  const html = renderToStaticMarkup(React.createElement(PublicGames, { apiBase: 'http://localhost:4000', gameId: null, onSelect() {}, onBack() {} }));
  assert.match(html, /Nueva fecha pendiente · Fecha original/);
  assert.match(html, /Resultado pendiente|Suspendido/);
});
