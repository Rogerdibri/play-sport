const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { exampleCareerGames, careerExampleObservation, careerCounts, careerPeriods, careerGameKey, careerTeamKey,
  careerLeagueKey, filterCareerGames, emptyCareerFilters, latestCareerGames, readCareerSnapshot } = require('@playsport/shared');
const Page = require('../app/sports-sheet/career/page').default;
const games = () => exampleCareerGames();
test('career examples reuse read-only scoring evidence across seasons, teams and sports, with no manufactured awards', () => {
  const rows = games();
  assert.equal(rows.length, 10);
  assert.deepEqual(careerCounts(rows), { completed: 4, ongoing: 1, review: 0 });
  assert.equal(careerPeriods(rows).length, 6);
  assert.deepEqual([...new Set(rows.map(row => row.season))].sort(), ['2025', '2026']);
  for (const row of rows) {
    const state = careerExampleObservation(row.gameId);
    assert.equal(state.seed.names.away, row.teamName); assert.equal(state.seed.names.home, row.homeTeamName);
    assert.equal(state.finished, row.status === 'final');
  }
  assert.throws(() => careerExampleObservation('real-game'));
  assert.doesNotMatch(JSON.stringify(rows), /statistics|awards|achievements|identification|actorId/);
});
test('new game versions replace every older role row; final, ongoing and reviewed records are counted distinctly', () => {
  const previous = games().filter(row => row.gameId === 'example-stats-baseball-1');
  const corrected = { ...previous[0], version: 100, status: 'in_progress' };
  const current = latestCareerGames([...previous, corrected, corrected]);
  assert.deepEqual(current, [corrected]); assert.equal(careerGameKey(current[0]), careerGameKey(corrected));
  assert.deepEqual(careerCounts(current), { completed: 0, ongoing: 1, review: 0 });
  assert.throws(() => latestCareerGames([corrected, { ...corrected, teamName: 'Different' }]));
  assert.deepEqual(careerCounts([{ ...corrected, status: 'final', technical: true }]), { completed: 0, ongoing: 0, review: 1 });
  assert.equal(careerPeriods([corrected])[0].completed, 0);
});
test('combined filters isolate exact team/tournament pairs, roles and inclusive dates without inferring missing seasons', () => {
  const rows = games(), row = rows[0];
  const filters = { ...emptyCareerFilters(), sport: JSON.stringify(row.sport), modality: JSON.stringify(row.modality),
    season: JSON.stringify(row.season), role: 'player', league: careerLeagueKey(row), tournament: row.tournamentId,
    team: careerTeamKey(row), from: row.date, to: row.date };
  assert.deepEqual(filterCareerGames(rows, filters), [row]);
  assert.equal(filterCareerGames(rows, { ...filters, team: JSON.stringify(['other-cup', row.teamId]) }).length, 0);
  const absent = { ...row, date: null, season: '' };
  assert.equal(careerPeriods([absent])[0].firstDate, null); assert.equal(careerPeriods([absent])[0].missingDates, 1);
  assert.equal(filterCareerGames([absent], { ...emptyCareerFilters(), season: '""' }).length, 1);
  assert.equal(filterCareerGames([absent], { ...emptyCareerFilters(), from: '2025-01-01' }).length, 0);
  assert.throws(() => filterCareerGames(rows, { ...emptyCareerFilters(), from: '2026-02-30' }));
  assert.throws(() => filterCareerGames(rows, { ...emptyCareerFilters(), from: '2026-10-11', to: '2025-10-10' }));
});
test('career contracts reject account/source mismatch, forged history, invalid status and identity leaks', () => {
  const snapshot = { accountId: 'owner', source: 'example', identityVerified: false, games: games() };
  assert.equal(readCareerSnapshot(snapshot, 'owner', 'example').games.length, 10);
  assert.throws(() => readCareerSnapshot(snapshot, 'other', 'example'));
  assert.throws(() => readCareerSnapshot(snapshot, 'owner', 'official'));
  assert.throws(() => readCareerSnapshot({ ...snapshot, source: 'official' }, 'owner', 'official'));
  for (const patch of [{ email: 'private' }, { awards: [] }])
    assert.throws(() => readCareerSnapshot({ ...snapshot, ...patch }, 'owner', 'example'));
  for (const patch of [{ actorId: 'private' }, { date: '2026-02-30' }, { version: NaN }, { version: 1.5 },
    { status: 'scheduled' }, { role: 'fan' }, { teamId: null }, { evidence: 'scoring' }, { positions: ['P', 'P'] }])
    assert.throws(() => readCareerSnapshot({ ...snapshot, games: [{ ...snapshot.games[0], ...patch }] }, 'owner', 'example'));
});
test('unauthenticated career view contains no fictional timeline and publication does not implicitly include career', t => {
  t.mock.method(require('../app/platform-session'), 'usePlatformSession', () => ({ ready: true, account: null }));
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /Inicia sesión/); assert.doesNotMatch(html, /Pioneros|2025|Finalizado|<select/);
  const { newSportsSheet, projectPublicSportsSheet } = require('@playsport/shared');
  const publicSheet = projectPublicSportsSheet(newSportsSheet(), { name: 'Account', verifiedIdentity: true }, []);
  assert.equal('career' in publicSheet, false); assert.equal('games' in publicSheet, false);
});
