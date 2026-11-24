const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const hooks = require('../app/navigation-hooks');
const Panel = require('../app/demo/[slug]/game-suspension-panel').default;
const Calendar = require('../app/demo/[slug]/official-calendar').default;
const suspension = { id: 'game:suspension:1', cause: 'weather', scoreHandling: 'keep', reason: 'Lluvia intensa',
  recordedAt: '2026-11-05T22:00:00Z', recordedBy: 'score', role: 'scorekeeper', wasStarted: true,
  originalDate: '2026-11-05', originalTime: '18:00', rescheduled: null };
function render(t, props) {
  t.mock.method(hooks, 'useNavigationDraft', () => ['', () => {}, true]);
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  return renderToStaticMarkup(createElement(Panel, { apiBase: 'http://localhost:4000/api/official-scoring',
    gameId: 'game', tournamentId: 'tour', actorId: 'score', role: 'scorekeeper', status: 'in_progress',
    version: 12, disabled: false, onUpdated() {}, ...props }));
}
test('organizer and scorer explicitly choose keep or full restart only for previously started games', t => {
  for (const role of ['organizer', 'scorekeeper']) {
    const html = render(t, { role });
    assert.match(html, /¿Conservar o reiniciar el juego/);
    assert.match(html, /<option value="" selected="">Elige una decisión/);
    assert.match(html, /marcador, entradas, cuenta, bases y estadísticas/);
    assert.match(html, /Confirmo la decisión y su registro/);
    assert.doesNotMatch(render(t, { role, status: 'scheduled' }), /¿Conservar o reiniciar/);
    assert.match(render(t, { role, status: 'scheduled', suspension: { ...suspension,
      rescheduled: { date: '2026-11-12', time: '19:30', recordedAt: '2026-11-06T10:00:00Z', recordedBy: 'org' } } }), /¿Conservar o reiniciar/);
  }
});
test('only organizer can set the new schedule, all other roles see date pending and read-only archive access', t => {
  for (const role of ['organizer', 'scorekeeper', 'manager', 'public', 'fan', 'player', 'scout']) {
    const html = render(t, { role, status: 'suspended', suspension });
    assert.match(html, /Nueva fecha pendiente/); assert.match(html, /Lluvia intensa/);
    assert.match(html, /Consultar anotación anterior archivada/);
    if (role === 'organizer') assert.match(html, /Nueva fecha del partido|Guardar nueva fecha/);
    else assert.doesNotMatch(html, /<input|<textarea|<select|Confirmar suspensión|Guardar nueva fecha/);
  }
});
test('terminal games expose no suspension or reprogramming mutation controls', t => {
  for (const status of ['final', 'protested']) for (const role of ['organizer', 'scorekeeper']) {
    assert.equal(render(t, { status, role }), '');
  }
  for (const role of ['fan', 'player', 'manager', 'scout', 'public']) assert.equal(render(t, { role }), '');
});
test('the existing calendar card marks a suspended game pending without adding a second game list', () => {
  const game = { gameId: 'game', tournamentId: 'tour', homeTeamId: 'home', awayTeamId: 'away',
    status: 'suspended', suspension, homeScore: 3, awayScore: 1,
    details: { tournamentName: 'Torneo', homeTeamName: 'Locales', awayTeamName: 'Visitantes', date: '2026-11-05', time: '18:00', venue: 'Sede' } };
  const html = renderToStaticMarkup(createElement(Calendar, { game }));
  assert.equal((html.match(/<article/g) ?? []).length, 1);
  assert.match(html, /Fecha original: 2026-11-05/);
  assert.match(html, /Nueva fecha pendiente/); assert.match(html, /Marcador anotado: 1–3/);
});
