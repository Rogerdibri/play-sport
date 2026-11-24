const assert = require('node:assert/strict');
const { test } = require('node:test');
const { calculateStandings, demoStandings, standingsLeagues, calendarExampleGames } = require('@playsport/shared');
const { demoModules, demoModuleHref } = require('../app/platform-navigation');

const game = (id, homeTeam, awayTeam, home, away, patch = {}) => ({
  id, homeTeam, awayTeam, date: '2026-11-05', time: '10:00', venueId: 'universitario',
  sport: 'baseball', status: 'finished', score: { home, away, innings: 9 }, ...patch
});
const row = (rows, team) => rows.find(item => item.team === team);

test('orders by wins then losses, not run differential or percentage', () => {
  const rows = calculateStandings(['A', 'B', 'C', 'D'], [
    game('1', 'A', 'C', 1, 0), game('2', 'B', 'D', 20, 0), game('3', 'C', 'B', 1, 0)
  ]);
  assert.equal(rows[0].team, 'A');
  assert.equal(row(rows, 'A').rank, 1);
  assert.equal(row(rows, 'B').rank, 3);
  assert.equal(row(rows, 'C').rank, 2);
  assert.match(row(rows, 'C').explanation, /Desempate directo/);
  const unequal = calculateStandings(['A', 'B', 'C', 'D'], [
    game('1', 'A', 'C', 1, 0), game('2', 'A', 'C', 1, 0),
    game('3', 'C', 'A', 1, 0), game('4', 'C', 'A', 1, 0), game('5', 'C', 'A', 1, 0),
    game('6', 'B', 'D', 1, 0)
  ]);
  assert.equal(row(unequal, 'A').rank, 2);
  assert.equal(row(unequal, 'B').rank, 3);
  assert.ok(row(unequal, 'B').percentage > row(unequal, 'A').percentage);
});

test('direct encounter resolves equal wins/losses even against alphabetical and run order', () => {
  const rows = calculateStandings(['Zorros', 'Águilas', 'C', 'D'], [
    game('1', 'Zorros', 'Águilas', 2, 1), game('2', 'C', 'Zorros', 12, 0), game('3', 'Águilas', 'D', 15, 0)
  ]);
  assert.equal(row(rows, 'Zorros').rank, 2);
  assert.equal(row(rows, 'Águilas').rank, 3);
  assert.ok(row(rows, 'Águilas').differential > row(rows, 'Zorros').differential);
  assert.match(row(rows, 'Zorros').explanation, /ganó la serie 1–0 ante Águilas/);
  assert.deepEqual(row(rows, 'Zorros').direct, { opponent: 'Águilas', wins: 1, losses: 0 });
  assert.deepEqual(row(rows, 'Águilas').direct, { opponent: 'Zorros', wins: 0, losses: 1 });
});

test('equal 5-2 records get distinct positions decided by the direct winner in either sport', () => {
  for (const sport of ['baseball', 'softball']) {
    const games = [
      game('direct', 'Zorros', 'Águilas', 2, 1),
      ...Array.from({ length: 4 }, (_, index) => game(`a-win-${index}`, 'Zorros', 'C', 1, 0)),
      ...Array.from({ length: 2 }, (_, index) => game(`a-loss-${index}`, 'C', 'Zorros', 10, 0)),
      ...Array.from({ length: 5 }, (_, index) => game(`b-win-${index}`, 'Águilas', 'D', 20, 0)),
      game('b-loss', 'D', 'Águilas', 1, 0)
    ].map(item => ({ ...item, sport }));
    const rows = calculateStandings(['Águilas', 'Zorros', 'C', 'D'], games);
    const winner = row(rows, 'Zorros');
    const loser = row(rows, 'Águilas');
    assert.deepEqual([winner.wins, winner.losses, loser.wins, loser.losses], [5, 2, 5, 2]);
    assert.deepEqual([winner.rank, loser.rank], [1, 2]);
    assert.equal(winner.ties + loser.ties, 0);
    assert.ok(loser.differential > winner.differential);
    assert.deepEqual(winner.direct, { opponent: 'Águilas', wins: 1, losses: 0 });
    assert.equal(winner.results.filter(result => result.opponent === winner.direct.opponent).length, 1);
    const reversed = calculateStandings(['D', 'C', 'Zorros', 'Águilas'], [...games].reverse());
    assert.deepEqual(reversed.map(item => [item.team, item.rank]), rows.map(item => [item.team, item.rank]));
  }
});

test('uses the entire direct series, not only the most recent encounter', () => {
  const rows = calculateStandings(['A', 'B', 'C', 'D'], [
    game('1', 'A', 'B', 1, 0), game('2', 'B', 'A', 0, 1), game('3', 'A', 'B', 0, 1),
    game('4', 'C', 'A', 1, 0), game('5', 'B', 'D', 1, 0)
  ]);
  assert.equal(row(rows, 'A').rank, 1);
  assert.equal(row(rows, 'B').rank, 2);
  assert.match(row(rows, 'A').explanation, /ganó la serie 2–1/);
  assert.deepEqual(row(rows, 'A').direct, { opponent: 'B', wins: 2, losses: 1 });
});

test('unresolved direct encounters share rank with gaps; no alphabetical tiebreaker', () => {
  const rows = calculateStandings(['B', 'A', 'C', 'D'], [
    game('1', 'A', 'C', 1, 0), game('2', 'B', 'D', 1, 0)
  ]);
  assert.equal(row(rows, 'A').rank, 1);
  assert.equal(row(rows, 'B').rank, 1);
  assert.equal(row(rows, 'C').rank, 3);
  assert.equal(row(rows, 'D').rank, 3);
  assert.match(row(rows, 'A').explanation, /no hay enfrentamientos directos/);
  assert.deepEqual(row(rows, 'A').direct, { opponent: 'B', wins: 0, losses: 0 });
  const split = calculateStandings(['A', 'B'], [game('1', 'A', 'B', 1, 0), game('2', 'B', 'A', 1, 0)]);
  assert.deepEqual(split.map(item => item.rank), [1, 1]);
  assert.match(split[0].explanation, /igualada 1–1/);
  assert.deepEqual(split[0].direct, { opponent: 'B', wins: 1, losses: 1 });
});

test('multiple tied teams retain shared position pending a tournament rule', () => {
  const rows = calculateStandings(['A', 'B', 'C'], [
    game('1', 'A', 'B', 1, 0), game('2', 'B', 'C', 1, 0), game('3', 'C', 'A', 1, 0)
  ]);
  assert.deepEqual(rows.map(item => item.rank), [1, 1, 1]);
  assert.ok(rows.every(item => /desempate múltiple/.test(item.explanation)));
});

test('totals, draws, percentage, chronological streak and evidence use only finished games', () => {
  const games = [
    game('2', 'B', 'A', 1, 5, { date: '2026-11-04' }),
    game('1', 'A', 'B', 4, 4, { date: '2026-11-03' }),
    game('3', 'A', 'B', 3, 0),
    ...['live', 'scheduled', 'cancelled'].map(status => game(status, 'A', 'B', 99, 0, { status }))
  ];
  const original = JSON.stringify(games);
  const a = row(calculateStandings(['A', 'B', 'C'], games), 'A');
  assert.equal(a.played, 3);
  assert.equal(a.wins, 2);
  assert.equal(a.losses, 0);
  assert.equal(a.ties, 1);
  assert.equal(a.percentage, 1);
  assert.equal(a.runsFor, 12);
  assert.equal(a.runsAgainst, 5);
  assert.equal(a.differential, 7);
  assert.equal(a.streak, 'G2');
  assert.deepEqual(a.results.map(result => result.gameId), ['1', '2', '3']);
  assert.equal(a.results[1].runsFor, 5);
  assert.equal(a.results[1].opponent, 'B');
  assert.equal(JSON.stringify(games), original);
  const draw = calculateStandings(['A', 'B'], [game('tie', 'A', 'B', 0, 0)]);
  assert.ok(draw.every(item => item.percentage === null && item.ties === 1 && item.rank === 1));
});

test('registered teams with no finished games remain unranked, not tied champions', () => {
  const rows = calculateStandings(['A', 'B', 'C'], [game('1', 'A', 'B', 2, 0, { status: 'live' })]);
  assert.ok(rows.every(item => item.rank === null && item.played === 0 && item.percentage === null));
  assert.match(rows[0].explanation, /Sin juegos finalizados/);
  assert.deepEqual(calculateStandings([], []), []);
});

test('rejects duplicate games, missing results, invalid runs and foreign or duplicate teams', () => {
  const valid = game('1', 'A', 'B', 1, 0);
  assert.throws(() => calculateStandings(['A', 'A'], []), /duplicados/);
  assert.throws(() => calculateStandings([' '], []), /vacíos/);
  assert.throws(() => calculateStandings(['A', 'B'], [valid, valid]), /duplicado/);
  assert.throws(() => calculateStandings(['A', 'C'], [valid]), /no pertenece/);
  assert.throws(() => calculateStandings(['A'], [game('1', 'A', 'A', 1, 0)]), /no pertenece/);
  for (const score of [null, { home: -1, away: 0 }, { home: 1.5, away: 0 }, { home: NaN, away: 0 }]) {
    assert.throws(() => calculateStandings(['A', 'B'], [{ ...valid, score }]), /resultado válido/);
  }
});

test('league and tournament selectors isolate seasons and match the calendar evidence exactly', () => {
  const current = demoStandings('metropolitana-beisbol', 'Copa Metropolitana 2026');
  assert.equal(current.completed, 4);
  assert.equal(row(current.rows, 'Cóndores del Ávila').wins, 3);
  assert.equal(row(current.rows, 'Cóndores del Ávila').runsFor, 18);
  assert.equal(row(current.rows, 'Cóndores del Ávila').runsAgainst, 8);
  assert.equal(row(current.rows, 'Pioneros del Valle').rank, 3);
  assert.equal(row(current.rows, 'Pioneros del Valle').losses, 1);
  assert.equal(row(current.rows, 'Diamantes de Caracas').wins, 1);
  assert.equal(demoStandings('metropolitana-beisbol', 'Copa de Caracas 2000').completed, 1);
  assert.equal(demoStandings('centro', 'Copa del Centro 2026').completed, 0);
  assert.throws(() => demoStandings('centro', 'Copa Metropolitana 2026'), /no está disponible/);
  assert.throws(() => demoStandings('missing', 'Copa Metropolitana 2026'), /no está disponible/);
  let total = 0;
  for (const league of standingsLeagues) for (const tournament of league.tournaments) {
    const data = demoStandings(league.id, tournament);
    const completed = calendarExampleGames.filter(item => item.tournament === tournament && item.status === 'finished');
    assert.equal(data.completed, completed.length);
    assert.equal(data.rows.reduce((sum, item) => sum + item.played, 0), completed.length * 2);
    assert.equal(data.rows.reduce((sum, item) => sum + item.wins - item.losses, 0), 0);
    assert.equal(data.rows.reduce((sum, item) => sum + item.runsFor - item.runsAgainst, 0), 0);
    assert.ok(data.rows.every(item => item.results.every(result => completed.some(game => game.id === result.gameId))));
    total += data.completed;
  }
  assert.equal(total, calendarExampleGames.filter(item => item.status === 'finished').length);
});

test('renamed active standings route remains available to every profile', () => {
  const module = demoModules.find(item => item.id === 'standings');
  assert.equal(module.title, 'Tabla de posiciones');
  assert.equal(module.slug, 'standings');
  assert.equal(module.status, 'working');
  for (const role of ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']) {
    assert.equal(demoModuleHref(module, { version: 1, role, team: 'team-A' }), '/demo/standings');
  }
});
