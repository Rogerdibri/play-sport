const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { platformRoles, privateInningRuns, calendarExampleGames } = require('@playsport/shared');
const {
  homeExampleGames, homeExampleDate, homeGamesForFilter, homeGameState,
  homeHighlightHref, homeEditorialExamples,
} = require('../app/sports-home-examples');
const SportsHomeHighlights = require('../app/sports-home-highlights').default;
const HighlightPage = require('../app/highlights/[slug]/page').default;

test('all six roles have the same isolated sporting feed without replacing module routes', () => {
  for (const role of platformRoles) {
    const html = renderToStaticMarkup(createElement(SportsHomeHighlights, { role: role.id }));
    assert.ok(html.includes(`Inicio deportivo de ${role.label}`));
    assert.ok(html.includes('Tu jornada deportiva'));
    assert.ok(html.includes('Filtrar destacados'));
    assert.ok(html.includes('aria-pressed="true"'));
    assert.ok(html.includes('sin patrocinio confirmado'));
    assert.equal((html.match(/Sobre esta vista de prueba/g) ?? []).length, 1);
    assert.doesNotMatch(html, /href="\/demo\/|<form|Comprar|Guardar favorito/);
    assert.doesNotMatch(html, /sportsHomeAdvertising|sportsHomeBrands/);
    for (const item of [...homeExampleGames, ...homeEditorialExamples.slice(0, 2)]) {
      assert.ok(html.includes(`href="${homeHighlightHref(item.id)}"`));
    }
  }
});

test('filters actually select following teams, the reference day and final phases', () => {
  assert.deepEqual(homeGamesForFilter('all'), homeExampleGames);
  assert.deepEqual(homeGamesForFilter('following'), homeExampleGames.filter(game => game.following));
  assert.equal(homeGamesForFilter('following').length, 2);
  assert.equal(homeGamesForFilter('today').length, 2);
  assert.ok(homeGamesForFilter('today').every(game => game.date === homeExampleDate));
  assert.ok(homeGamesForFilter('finals').every(game => ['Semifinal', 'Final'].includes(game.phase)));
  assert.ok(homeGamesForFilter('finals').some(game => game.status === 'scheduled'));
});

test('new examples never overwrite calendar fixtures and scores come from shared recorded plays', () => {
  const original = JSON.stringify(calendarExampleGames);
  const ids = new Set(calendarExampleGames.map(game => game.id));
  for (const game of homeExampleGames) {
    assert.equal(ids.has(game.id), false);
    const state = homeGameState(game);
    assert.equal(state.seed.regulationInnings, 9);
    assert.ok(state.seed.lineups.home.every(player => player.id.startsWith(`${game.id}:`)));
    for (const side of ['away', 'home']) {
      assert.equal(state.scores[side], Array.from({ length: 9 }, (_, i) =>
        privateInningRuns(state, side, i + 1) ?? 0).reduce((sum, value) => sum + value, 0));
    }
    assert.deepEqual(homeGameState(game), state);
  }
  assert.equal(JSON.stringify(calendarExampleGames), original);
  assert.deepEqual(homeGameState(homeExampleGames[0]).scores, { away: 1, home: 1 });
  assert.deepEqual(homeGameState(homeExampleGames[1]).scores, { away: 0, home: 0 });
});

test('every game and editorial action opens a corresponding read-only detail', async () => {
  for (const item of [...homeExampleGames, ...homeEditorialExamples]) {
    const html = renderToStaticMarkup(await HighlightPage({ params: Promise.resolve({ slug: item.id }) }));
    assert.ok(html.includes('Volver al inicio de mi rol'));
    assert.ok(html.includes('href="/"'));
    assert.doesNotMatch(html, /<form|<button|average|AVG|OBP|SLG|Pagar|Reservar/);
    if ('away' in item) {
      assert.ok(html.includes(item.away));
      assert.ok(html.includes(item.home));
      assert.ok(html.includes(item.phase));
      if (item.status === 'live') {
        assert.ok(html.includes('Marcador general · 9 innings'));
        assert.ok(html.includes('Consulta de solo lectura'));
      } else {
        assert.ok(html.includes('No hay resultado ni carreras anotadas'));
        assert.doesNotMatch(html, /<table/);
      }
    } else assert.ok(html.includes(item.title));
  }
});

test('unknown highlights return a real 404 rather than a substitute card', async () => {
  await assert.rejects(() => HighlightPage({ params: Promise.resolve({ slug: 'unknown' }) }),
    error => error.digest === 'NEXT_HTTP_ERROR_FALLBACK;404');
});
