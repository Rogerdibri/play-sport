const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { NextRequest } = require('next/server');
const { default: GameChat, gameChatCanWrite } = require('../app/demo/[slug]/game-chat');
const { GET, POST } = require('../app/api/game-chat/[gameId]/route');
const { readGameChat, gameChatWindow, gameChatFinalWindowMs, platformRoles, platformModuleIds } = require('@playsport/shared');
const { demoModules } = require('../app/platform-navigation');
const { default: Scorecard } = require('../app/demo/[slug]/private-scorecard-view');
const { createPrivateState } = require('@playsport/shared');
const author = { id: '12345678-1234-1234-1234-123456789abc', displayName: 'Cuenta ficticia' };
const fixture = overrides => ({ gameId: 'game', window: 'live', closesAt: null, serverNow: '2026-11-08T19:00:00.000Z',
  viewer: author, sessionExpired: false, mutedAuthors: [], hasOlder: false,
  messages: [{ id: 1, author, text: 'Buen partido', createdAt: '2026-11-08T19:00:00.000Z' }], ...overrides });
test('no role retains a standalone news module and chat is folded, silent and free of forms until explicitly opened', () => {
  for (const role of platformRoles) assert.equal(platformModuleIds(role.id).includes('news'), false);
  assert.equal(demoModules.some(module => module.id === 'news'), false);
  const html = renderToStaticMarkup(React.createElement(GameChat, { gameId: 'game' }));
  assert.match(html, /Chat del partido/); assert.match(html, /Público/);
  assert.doesNotMatch(html, /<details[^>]* open|<textarea|<form|autofocus|<audio/);
});
test('strict chat reader and exact closing boundary do not accept malformed payloads or allow late comments', () => {
  assert.deepEqual(readGameChat(fixture()), fixture());
  for (const patch of [{ messages: [{ id: 1, author: {}, text: 'x', createdAt: fixture().serverNow }] },
    { window: 'postgame', closesAt: null }, { messages: [fixture().messages[0], fixture().messages[0]] },
    { serverNow: 'invalid' }, { viewer: { ...author, id: 'scorer-demo' } }]) assert.throws(() => readGameChat(fixture(patch)), /inválidos/);
  const finishedAt = fixture().serverNow, cutoff = Date.parse(finishedAt) + gameChatFinalWindowMs;
  const chat = fixture({ ...gameChatWindow('final', finishedAt, cutoff - 1) });
  assert.equal(gameChatCanWrite(chat, cutoff - 1), true);
  assert.equal(gameChatCanWrite(chat, cutoff), false);
  assert.equal(gameChatWindow('final', finishedAt, cutoff).window, 'closed');
  for (const window of ['waiting', 'paused', 'closed']) assert.equal(gameChatCanWrite(fixture({ window }), cutoff - 1), false);
  assert.equal(gameChatCanWrite(fixture({ viewer: null }), cutoff - 1), false);
});
test('opened chat renders escaped comments, account access and genuine read-only final states without privileged scoring actions', t => {
  const useState = React.useState;
  let index = 0, snapshot = fixture({ viewer: null, messages: [{ ...fixture().messages[0], text: '<script>no HTML</script>' }] });
  t.mock.method(React, 'useState', initial => {
    const next = index++;
    return next === 0 ? [true, () => {}] : next === 1 ? [snapshot, () => {}] : useState(initial);
  });
  const render = () => renderToStaticMarkup(React.createElement(GameChat, { gameId: 'game' }));
  const html = render();
  assert.match(html, /&lt;script&gt;no HTML&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|<textarea/);
  assert.match(html, /Crear cuenta o iniciar sesión para comentar/);
  index = 0; snapshot = fixture({ window: 'closed' });
  const closed = render();
  assert.match(closed, /Chat cerrado/); assert.match(closed, /<textarea[^>]*disabled/);
  assert.doesNotMatch(closed, /Bola|Strike|Apostar|Anotar carrera/);
  index = 0;
  const example = renderToStaticMarkup(React.createElement(GameChat, { gameId: 'example', example: true }));
  assert.match(example, /jugadas fijas/); assert.doesNotMatch(example, /Enviar comentario/);
});
test('proxy forwards only the selected match, cookies and origin, and rejects malformed cursors and oversized requests', async t => {
  let forwarded;
  t.mock.method(global, 'fetch', async (url, options) => {
    forwarded = { url, options }; return new Response(JSON.stringify(fixture()), { status: 200 });
  });
  const context = { params: Promise.resolve({ gameId: 'game:selected' }) };
  const read = await GET(new NextRequest('http://localhost:3000/api/game-chat/game%3Aselected?after=12'), context);
  assert.equal(read.status, 200); assert.match(forwarded.url, /game%3Aselected\?after=12$/);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const request = new NextRequest('http://localhost:3000/api/game-chat/game', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'playsport-account=opaque', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ kind: 'message', text: 'Hola' }) });
  await POST(request, context);
  assert.equal(forwarded.options.headers.get('cookie'), 'playsport-account=opaque');
  assert.equal(forwarded.options.headers.get('origin'), 'http://localhost:3000');
  assert.equal(forwarded.options.redirect, 'error');
  for (const query of ['before=-1', 'before=0', 'before=1&after=2', 'before=1&before=2', 'role=organizer']) {
    assert.equal((await GET(new NextRequest(`http://localhost:3000/api/game-chat/game?${query}`), context)).status, 400);
  }
  assert.equal((await POST(new NextRequest('http://localhost:3000/api/game-chat/game', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(4097) }), context)).status, 413);
});
test('chat styling is scoped and the integration neither writes scoring commands nor touches private games', () => {
  const source = readFileSync(require.resolve('../app/demo/[slug]/game-chat'), 'utf8');
  assert.doesNotMatch(source, /official-updates|scorecardCommand|useTeamSheets|useNavigationBusy|localStorage|sessionStorage|autoFocus|scrollIntoView/);
  const scoring = readFileSync(require.resolve('../app/demo/[slug]/official-run-scoring'), 'utf8');
  assert.match(scoring, /matchChat=\{<GameChat key=\{gameId\} gameId=\{gameId\}/);
  const css = readFileSync(require.resolve('../app/globals.css'), 'utf8');
  assert.match(css, /\.gameChat\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
  const friendly = readFileSync(require.resolve('../app/demo/[slug]/friendly-games'), 'utf8');
  assert.doesNotMatch(friendly, /GameChat/);
});
test('a populated scorecard retains its chat panel, not only the initial loading branch', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({
    session: null, ready: true, reportNavigationError() {}, registerScreenBack() { return () => {}; },
    registerNavigationBusy() { return () => {}; }
  }));
  const players = prefix => Array.from({ length: 9 }, (_, index) => ({ id: `${prefix}${index}`, name: `Jugador ${index}`,
    jersey: String(index + 1), order: index + 1, position: ['P','C','1B','2B','3B','SS','LF','CF','RF'][index] }));
  const lineups = { home: players('home'), away: players('away') };
  const state = createPrivateState({ names: { home: 'Locales', away: 'Visitantes' }, lineups, rosters: lineups,
    courtesyRunnerSource: 'ROSTER', regulationInnings: 7 });
  const html = renderToStaticMarkup(React.createElement(Scorecard, {
    observation: state, apiBase: 'http://localhost:4000/api/official-scoring', tournamentId: 'tour', gameId: 'game',
    managerId: '', homeId: 'home', awayId: 'away', ownSide: 'home', homeName: 'Locales', awayName: 'Visitantes',
    initialLineup: lineups.home, positionLabels: {}, onBack() {},
    matchChat: React.createElement('aside', {}, 'CHAT-DEL-PARTIDO-REGRESSION')
  }));
  assert.match(html, /PIZARRA RESUMEN/);
  assert.equal(html.split('CHAT-DEL-PARTIDO-REGRESSION').length - 1, 1);
});
