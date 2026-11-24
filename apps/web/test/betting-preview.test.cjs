const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Preview = require('../app/demo/betting-preview/preview').default;
const Page = require('../app/demo/betting-preview/page').default;
const SelectedOfficialGame = require('../app/demo/betting-preview/selected-game').default;
const catalog = require('../app/demo/[slug]/use-public-official-games');
const Calendar = require('../app/demo/[slug]/official-calendar').default;
const { calendarExampleGames } = require('@playsport/shared');
const { bettingPreviewOpen, bettingPreviewHref, examplePreviewGame, officialPreviewGame } = require('../app/demo/betting-preview/game-context');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('betting preview clearly separates fictional credits from real accounts and finances', () => {
  const html = renderToStaticMarkup(React.createElement(Preview));
  assert.doesNotMatch(html, /SOLO CRÉDITOS FICTICIOS|fictici/i);
  assert.match(html, /No mueve dinero real/);
  assert.match(html, /ni conecta con tu cuenta/);
  assert.match(html, /200 CR/);
  assert.match(html, /0 CR/);
  assert.match(html, /1\. Elige un partido/);
  assert.match(html, /2\. ELIGE UNA OFERTA/);
  assert.match(html, /3\. Mis acuerdos/);
  assert.match(html, /El otro aficionado elige/);
  assert.match(html, /Tú eliges/);
  assert.match(html, /<dt>Tu aporte<\/dt><dd>10 CR/);
  assert.match(html, /<dt>Aporte del rival<\/dt><dd>10 CR/);
  assert.match(html, /<dt>Total si ganas<\/dt><dd>20 CR/);
  assert.match(html, /No hay depósitos, retiros ni liquidación/);
  assert.doesNotMatch(html, /Cuenta verificada|Identidad verificada|Depositar dinero/);
  const source = readFileSync(require.resolve('../app/demo/betting-preview/preview'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|localStorage|sessionStorage|\/api\//);
});

test('scheduled and live games allow the preview while finished games are closed', () => {
  const html = renderToStaticMarkup(React.createElement(Preview));
  assert.match(html, /aria-label="Ver apuestas: Tigres del Valle contra Leones del Norte"/);
  assert.match(html, /aria-label="Ver apuestas: Halcones de Caracas contra Bravos del Este"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Apuestas cerradas: Caribes del Sur contra Águilas del Lago"/);
  assert.match(html, /40 CR disponibles/);
  assert.match(html, /Simular aceptación parcial/);
  assert.match(html, /no necesitas cubrir toda la oferta/);
});

test('preview overrides inherited module grids and gives each offer two readable sides', () => {
  const css = readFileSync(require.resolve('../app/globals.css'), 'utf8');
  assert.match(css, /\.bettingPreview\s*\{[^}]*display:\s*block/);
  assert.match(css, /\.bettingFlow\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.bettingPanel\s*\{[^}]*grid-column:\s*auto/);
  assert.match(css, /\.bettingOffer\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.bettingOffer\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('calendar eligibility is based on status, never score difference, and selected IDs are encoded', () => {
  for (const status of ['scheduled', 'live', 'in_progress']) assert.equal(bettingPreviewOpen(status), true);
  for (const status of ['finished', 'final', 'cancelled', 'suspended', 'protested', 'unknown', '']) {
    assert.equal(bettingPreviewOpen(status), false);
  }
  const id = 'game /?other=wrong&value=1';
  for (const source of ['example', 'official']) {
    const url = new URL(bettingPreviewHref(source, id), 'http://localhost:3000');
    assert.equal(url.pathname, '/demo/betting-preview');
    assert.equal(url.searchParams.get(source === 'example' ? 'game' : 'official'), id);
    assert.equal([...url.searchParams].length, 1);
  }
});

test('each eligible official calendar card links its own game and closes non-active states', () => {
  const game = { gameId: 'official-selected', tournamentId: 'tournament', homeTeamId: 'home', awayTeamId: 'away',
    homeScore: 15, awayScore: 1, details: { homeTeamName: 'Locales elegidos', awayTeamName: 'Visitantes elegidos' } };
  for (const status of ['scheduled', 'in_progress', 'final', 'suspended', 'protested']) {
    const candidate = { ...game, status, homeScore: status === 'final' ? 15 : 0, awayScore: status === 'final' ? 1 : 0,
      protest: status === 'protested' ? { teamId: 'home', reason: 'Protesta', resolution: null } : null };
    const html = render(Calendar, { game: candidate });
    if (bettingPreviewOpen(status)) assert.match(html, /href="\/demo\/betting-preview\?official=official-selected"/);
    else assert.doesNotMatch(html, /Apostar · demo/);
  }
});

test('example selection renders that exact game, never the unrelated default fixtures', async () => {
  const example = calendarExampleGames.find(game => game.status === 'scheduled');
  const before = JSON.stringify(example);
  const tree = await Page({ searchParams: Promise.resolve({ game: example.id }) });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes(example.homeTeam) && html.includes(example.awayTeam));
  assert.match(html, /1\. Partido elegido en la cartelera/);
  assert.match(html, /data-single="true"/);
  assert.equal((html.match(/class="bettingGame"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Halcones de Caracas|Bravos del Este/);
  assert.equal(examplePreviewGame(example).id, `example:${example.id}`);
  assert.equal(JSON.stringify(example), before);
  const completed = calendarExampleGames.find(game => game.status === 'finished');
  assert.throws(() => examplePreviewGame(completed), /no está por iniciar/);
});

test('missing, ambiguous and completed selections show an error rather than silently switching games', async () => {
  const finished = calendarExampleGames.find(game => game.status === 'finished');
  for (const selection of [{ game: 'missing' }, { game: finished.id }, { game: '' },
    { game: ['one', 'two'] }, { official: ['one'] }, { game: 'one', official: 'two' }]) {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(selection) }));
    assert.match(html, /Ejemplo de apuestas no disponible/);
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /Simular aceptación parcial|200 CR/);
  }
});

test('official selection preserves both teams and the current score and stops when status changes', t => {
  const game = { gameId: 'exact-official', tournamentId: 'tournament', homeTeamId: 'home', awayTeamId: 'away',
    status: 'in_progress', homeScore: 12, awayScore: 2,
    details: { homeTeamName: 'Locales del partido', awayTeamName: 'Visitantes del partido', venue: 'Sede del partido' } };
  const before = JSON.stringify(game);
  t.mock.method(catalog, 'default', () => ({ games: [game], error: '', refresh() {} }));
  const html = render(SelectedOfficialGame, { gameId: game.gameId });
  assert.match(html, /Locales del partido vs\. Visitantes del partido/);
  assert.match(html, /<strong>12<\/strong>/);
  assert.match(html, /<strong>2<\/strong>/);
  assert.match(html, /40 CR disponibles/);
  assert.equal(officialPreviewGame(game).id, 'official:exact-official');
  assert.equal(JSON.stringify(game), before);
  for (const status of ['final', 'suspended', 'protested']) {
    t.mock.method(catalog, 'default', () => ({ games: [{ ...game, status }], error: '', refresh() {} }));
    const closed = render(SelectedOfficialGame, { gameId: game.gameId });
    assert.match(closed, /ya no está por iniciar ni en curso/);
    assert.doesNotMatch(closed, /Simular aceptación parcial/);
  }
  t.mock.method(catalog, 'default', () => ({ games: [], error: '', refresh() {} }));
  assert.match(render(SelectedOfficialGame, { gameId: game.gameId }), /No se sustituirá por otro juego/);
  t.mock.method(catalog, 'default', () => ({ games: null, error: 'Fallo de consulta', refresh() {} }));
  assert.match(render(SelectedOfficialGame, { gameId: game.gameId }), /Fallo de consulta/);
  assert.match(render(SelectedOfficialGame, { gameId: game.gameId }), /Reintentar consulta/);
});
