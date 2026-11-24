const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const hooks = require('../app/navigation-hooks');
const Panel = require('../app/demo/[slug]/game-protest-panel').default;
const { calculateStandings, calculateOfficialStandings, readOfficialStandingGames } = require('@playsport/shared');
const protest = {
  teamId: 'home', reason: 'Regla cuestionada', declaredAt: '2026-11-05T21:00:00Z', declaredBy: 'score',
  moment: { inning: 3, outs: 2, balls: 1, strikes: 2, homeScore: 5, awayScore: 1, officialVersion: 12, lastPlay: 'Bola' }, resolution: null
};
function render(t, props) {
  t.mock.method(hooks, 'useNavigationDraft', () => ['', () => {}, true]);
  t.mock.method(hooks, 'useNavigationBusy', () => {});
  return renderToStaticMarkup(createElement(Panel, {
    apiBase: 'http://localhost:4000/api/official-scoring', gameId: 'game', tournamentId: 'tour', actorId: 'score',
    role: 'scorekeeper', status: 'in_progress', version: 12, names: { home: 'Locales', away: 'Visitantes' },
    disabled: false, onUpdated() {}, ...props
  }));
}
test('only the assigned scoring role sees the declaration control in an ongoing game', t => {
  assert.match(render(t, {}), /Juego bajo protesta/);
  for (const role of ['organizer', 'manager', 'public']) assert.equal(render(t, { role }), '');
  for (const status of ['scheduled', 'final']) assert.equal(render(t, { status }), '');
});
test('the organizer sees a technical committee form with winner, justification, act and attestation', t => {
  const html = render(t, { role: 'organizer', status: 'protested', protest });
  assert.match(html, /Mesa técnica · Registrar resolución/);
  assert.match(html, /Ganador según el acta|Fundamento de la decisión/);
  assert.match(html, /Referencia del acta de mesa técnica/);
  assert.match(html, /type="checkbox" required=""/);
  assert.match(html, /No es una decisión unilateral/);
});
test('scorekeepers and observers can read the pending protest but cannot decide it', t => {
  for (const role of ['scorekeeper', 'manager', 'public']) {
    const html = render(t, { role, status: 'protested', protest });
    assert.match(html, /Bajo protesta · Pendiente de mesa técnica/);
    assert.match(html, /Entrada 3 · 2 outs/);
    assert.doesNotMatch(html, /<form|<button|<textarea/);
  }
});
test('resolved protest shows the recorded decision without edit or reopen controls', t => {
  const resolution = { winnerTeamId: 'away', loserTeamId: 'home', reason: 'Decisión de mesa', recordReference: 'Acta MT-1',
    recordedBy: 'org', recordedAt: '2026-11-05T22:00:00Z' };
  const html = render(t, { role: 'organizer', status: 'final', protest: { ...protest, resolution } });
  assert.match(html, /Ganador: Visitantes/);
  assert.match(html, /Perdedor: Locales/);
  assert.match(html, /Acta MT-1/);
  assert.doesNotMatch(html, /<form|<button|<input/);
});
test('technical winner overrides the score for wins and direct encounters, but never changes recorded runs', () => {
  const game = { id: 'one', date: '2026-11-05', time: '18:00', venueId: 'stadium', sport: 'baseball',
    homeTeam: 'home', awayTeam: 'away', score: { home: 5, away: 1, innings: 3 }, status: 'finished', decidedWinner: 'away' };
  const before = structuredClone(game);
  const rows = calculateStandings(['home', 'away'], [game]);
  assert.deepEqual(rows.map(row => [row.team, row.wins, row.losses, row.runsFor, row.runsAgainst]), [
    ['away', 1, 0, 1, 5], ['home', 0, 1, 5, 1]
  ]);
  assert.equal(rows[0].results[0].technicalDecision, true);
  assert.deepEqual(game, before);
  assert.throws(() => calculateStandings(['home', 'away'], [{ ...game, decidedWinner: 'stranger' }]));
});
test('public official standings reject malformed or inconsistent protest metadata', () => {
  const game = { gameId: 'one', tournamentId: 'tour', homeTeamId: 'home', awayTeamId: 'away',
    homeScore: 5, awayScore: 1, details: null, status: 'protested', protest };
  assert.equal(calculateOfficialStandings(readOfficialStandingGames({ games: [game] }))[0].pendingProtests, 1);
  for (const patch of [{ protest: null }, { status: 'final' }, { protest: { ...protest, teamId: 'stranger' } }]) {
    assert.throws(() => readOfficialStandingGames({ games: [{ ...game, ...patch }] }));
  }
});
