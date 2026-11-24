const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  venezuelaStates, demoProfileLocation, isProfileLocation, profileLocationLabel,
  isCalendarDate, venezuelaToday, shiftCalendarDate, calendarDateLabel, isCalendarFilters,
  calendarGames, calendarOfficialGames, calendarResultSummary, calendarScoreLabel, calendarDirectionsUrl
} = require('@playsport/shared');
const { calendarExampleGames: games, calendarExampleVenues: venues } = require('../app/demo/[slug]/event-examples');
const { calendarGameArchive, calendarGameAwards, calendarGameLive, calendarLiveProgress } = require('../app/demo/[slug]/event-archives');
const { privateStats, currentBatter, playerName } = require('@playsport/shared');
const { readDemoSession, demoSessionLocation, demoModules, demoModuleHref } = require('../app/platform-navigation');
const caracas = date => ({ ...demoProfileLocation, date });

test('permanent territorial catalog contains all 335 municipalities, unique IDs and real profile locations', () => {
  const states = venezuelaStates.filter(state => state.municipalities.length);
  assert.equal(states.length, 24);
  assert.equal(states.reduce((n, state) => n + state.municipalities.length, 0), 335);
  assert.equal(new Set(venezuelaStates.map(state => state.id)).size, venezuelaStates.length);
  const ids = states.flatMap(state => state.municipalities.map(m => m.id));
  assert.equal(new Set(ids).size, 335);
  assert.equal(venezuelaStates.find(state => state.id === 'VE-W').name, 'La Guaira');
  assert.equal(venezuelaStates.find(state => state.id === 'VE-W').municipalities[0].name, 'Vargas');
  assert.equal(venezuelaStates.find(state => state.id === 'VE-V').municipalities.find(m => m.id === 'VE-V:paez').name, 'Guajira');
  assert.ok(isProfileLocation(demoProfileLocation));
  assert.equal(profileLocationLabel(demoProfileLocation), 'Libertador · Distrito Capital');
  assert.equal(isProfileLocation({ stateId: 'VE-D', municipalityId: 'VE-A:libertador' }), false);
  assert.equal(isProfileLocation({ stateId: 'guayana-esequiba', municipalityId: 'invented' }), false);
});

test('Gregorian date validation supports unlimited historical browsing, leap centuries and invalid input', () => {
  for (const date of ['0001-01-01', '1952-02-29', '2000-02-29', '2026-11-04', '9999-12-31']) assert.ok(isCalendarDate(date), date);
  for (const date of ['0000-01-01', '1900-02-29', '2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '', null, '2026-1-1']) {
    assert.equal(isCalendarDate(date), false, String(date));
  }
  assert.equal(shiftCalendarDate('2000-03-01', -1), '2000-02-29');
  assert.equal(shiftCalendarDate('1900-03-01', -1), '1900-02-28');
  assert.equal(shiftCalendarDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftCalendarDate('0001-01-02', -1), '0001-01-01');
  assert.throws(() => shiftCalendarDate('0001-01-01', -1));
  assert.throws(() => shiftCalendarDate('9999-12-31', 1));
  assert.match(calendarDateLabel('1952-02-29'), /1952/);
});

test('today is the Venezuelan local day even when the UTC calendar has advanced', () => {
  assert.equal(venezuelaToday(new Date('2026-11-05T02:30:00Z')), '2026-11-04');
  assert.equal(venezuelaToday(new Date('2026-11-05T04:00:00Z')), '2026-11-05');
});

test('fixtures use valid fixed dates, actual catalog locations and separate IDs with explicit result statuses', () => {
  assert.equal(new Set(games.map(game => game.id)).size, games.length);
  for (const venue of venues) {
    assert.ok(isProfileLocation(venue));
    assert.ok(venue.latitude >= -90 && venue.latitude <= 90);
    assert.ok(venue.longitude >= -180 && venue.longitude <= 180);
    assert.match(venue.source, /^https:\/\//);
    assert.ok(venue.address.trim().length > 30);
    assert.match(venue.address, /Venezuela/);
  }
  for (const game of games) {
    assert.match(game.id, /^ejemplo-/);
    assert.ok(isCalendarDate(game.date));
    assert.match(game.time, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.ok(venues.some(venue => venue.id === game.venueId));
    if (game.status === 'finished' || game.status === 'live') {
      assert.ok(game.score);
      for (const value of Object.values(game.score)) assert.ok(Number.isInteger(value) && value >= 0);
    } else assert.equal(game.score, null);
  }
});

test('external Google Maps links point to exact venue coordinates without a key or user location', () => {
  for (const venue of venues) {
    const url = new URL(calendarDirectionsUrl(venue));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('destination'), `${venue.latitude},${venue.longitude}`);
    assert.deepEqual([...url.searchParams.keys()].sort(), ['api', 'destination']);
  }
  for (const venue of [
    { latitude: NaN, longitude: 0 }, { latitude: Infinity, longitude: 0 },
    { latitude: 91, longitude: 0 }, { latitude: -91, longitude: 0 },
    { latitude: 0, longitude: 181 }, { latitude: 0, longitude: -181 }
  ]) assert.throws(() => calendarDirectionsUrl(venue), /coordenadas válidas/);
});

test('one date and municipality include the newly finished example without hiding upcoming games', () => {
  const found = calendarGames(games, venues, caracas('2026-11-05'));
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(game => game.status), ['finished', 'finished', 'scheduled']);
  assert.equal(found[1].score.innings, 9);
  assert.equal(calendarScoreLabel(found[1]), 'Pioneros del Valle 1 – 3 Diamantes de Caracas');
  assert.equal(found[2].time, '16:00');
  assert.equal(found[2].score, null);
});

test('calendar filtering still includes live games alongside finished and scheduled games', () => {
  const mixed = games.map(game => game.id === 'ejemplo-caracas-en-juego-5' ? { ...game, status: 'live' } : game);
  assert.deepEqual(calendarGames(mixed, venues, caracas('2026-11-05')).map(game => game.status), ['finished', 'live', 'scheduled']);
});

test('finished game archives match every final result, inning total and both player score sheets', () => {
  const before = JSON.stringify(games);
  for (const game of games.filter(item => item.status === 'finished')) {
    assert.ok(game.tournament.trim());
    const archive = calendarGameArchive(game);
    assert.ok(archive, game.id);
    assert.equal(archive.state.finished, true);
    for (const side of ['away', 'home']) {
      assert.equal(archive.innings[side].length, game.score.innings);
      assert.equal(archive.innings[side].reduce((sum, runs) => sum + (runs ?? 0), 0), game.score[side]);
      assert.equal(archive.state.scores[side], game.score[side]);
      assert.equal(archive.state.seed.lineups[side].length, 9);
      assert.equal(archive.state.seed.lineups[side].reduce((sum, player) =>
        sum + privateStats(archive.state, side, player.id).runs, 0), game.score[side]);
      for (const [index, runs] of archive.innings[side].entries()) {
        const plays = archive.state.log.filter(entry => entry.side === side && entry.inning === index + 1 && entry.result);
        assert.equal(plays.reduce((sum, entry) => sum + entry.runs.length, 0), runs ?? 0);
        assert.equal(plays.reduce((sum, entry) => sum + entry.outs, 0), runs === null ? 0 : 3);
        if (runs === null) {
          assert.equal(side, 'home');
          assert.equal(index + 1, game.score.innings);
          assert.ok(game.score.home > game.score.away);
        }
      }
    }
  }
  assert.equal(JSON.stringify(games), before);
});

test('archive lookup never substitutes another game or reconstructs missing records from a final score', () => {
  const game = games.find(item => item.id === 'ejemplo-caracas-finalizado-5');
  assert.equal(calendarGameArchive({ ...game, id: 'sin-archivo' }), null);
  assert.throws(() => calendarGameArchive({ ...game, score: { ...game.score, home: 99 } }), /no coinciden/);
  for (const unfinished of games.filter(item => item.status !== 'finished')) {
    assert.throws(() => calendarGameArchive(unfinished), /finalizados/);
    assert.equal(calendarGameAwards(unfinished), null);
  }
  const first = calendarGameArchive(game);
  first.state.scores.home = 99;
  assert.equal(calendarGameArchive(game).state.scores.home, 7);
});

test('awards are explicitly recorded, not calculated from score, and absent decisions remain pending', () => {
  const game = games.find(item => item.id === 'ejemplo-caracas-finalizado-5');
  assert.deepEqual(calendarGameAwards(game), {
    winner: 'Carlos Medina', loser: 'José Rivas', saver: null, mvp: 'Luis Romero'
  });
  assert.equal(calendarGameAwards(games.find(item => item.id === 'ejemplo-caracas-1')), null);
  assert.equal(calendarGameAwards(games.find(item => item.id === 'ejemplo-historico-2000')), null);
});

test('live details share the card score and inning, and distinguish unplayed halves from zero-run halves', () => {
  const before = JSON.stringify(games);
  for (const game of games.filter(item => item.status === 'live')) {
    const snapshot = calendarGameLive(game);
    assert.ok(snapshot, game.id);
    const { state, innings } = snapshot;
    assert.equal(state.finished, false);
    assert.equal(state.inning, game.score.innings);
    assert.equal(calendarGameAwards(game), null);
    for (const side of ['away', 'home']) {
      assert.equal(state.scores[side], game.score[side]);
      assert.equal(innings[side].reduce((sum, runs) => sum + (runs ?? 0), 0), game.score[side]);
      assert.equal(state.seed.lineups[side].length, 9);
      assert.equal(state.seed.lineups[side].reduce((sum, player) =>
        sum + privateStats(state, side, player.id).runs, 0), game.score[side]);
      for (let index = 0; index < innings[side].length; index += 1) {
        const unplayed = index + 1 > state.inning || (index + 1 === state.inning && side === 'home' && state.side === 'away');
        assert.equal(innings[side][index] === null, unplayed);
      }
    }
    assert.ok(state.lineups[state.side === 'away' ? 'home' : 'away'].some(player => player.position === 'P'));
  }
  assert.equal(JSON.stringify(games), before);
});

test('the formerly live assignment example is final and preserves its already-shown hits', () => {
  const game = games.find(item => item.id === 'ejemplo-caracas-en-juego-5');
  assert.equal(game.status, 'finished');
  const { state, innings } = calendarGameArchive(game);
  assert.equal(state.finished, true);
  assert.deepEqual(state.scores, { home: 3, away: 1 });
  assert.equal(innings.away.length, 9);
  assert.equal(innings.home[8], null);
  const player = state.lineups.away.find(row => row.name === 'Mario Díaz');
  assert.equal(privateStats(state, 'away', player.id).hits, 1);
  assert.throws(() => calendarGameLive(game), /en curso/);
});

test('bottom-half live example has a different game-specific lineup and two outs', () => {
  const game = games.find(item => item.id === 'ejemplo-maracaibo-1');
  const { state, innings } = calendarGameLive(game);
  assert.equal(calendarLiveProgress(state), 'Baja de la 6.ª · 2 outs');
  assert.equal(playerName(state, currentBatter(state)), 'Andrés Gil');
  assert.equal(state.lineups.away.find(player => player.position === 'P').name, 'José Rivas');
  assert.deepEqual(state.bases.map(id => id ? playerName(state, id) : null), ['Pedro Salas', null, null]);
  assert.deepEqual([state.balls, state.strikes], [0, 1]);
  assert.equal(innings.home[5], 0);
  assert.equal(innings.home[6], null);
  assert.ok(state.lineups.home.every(player => player.id.startsWith(`${game.id}:home:`)));
  state.scores.home = 99;
  assert.equal(calendarGameLive(game).state.scores.home, 3);
});

test('live lookup rejects mismatched scores and innings, missing records and unsupported statuses explicitly', () => {
  const game = games.find(item => item.id === 'ejemplo-maracaibo-1');
  assert.equal(calendarGameLive({ ...game, id: 'sin-seguimiento' }), null);
  assert.throws(() => calendarGameLive({ ...game, score: { ...game.score, home: 99 } }), /no coincide/);
  assert.throws(() => calendarGameLive({ ...game, score: { ...game.score, innings: 5 } }), /no coincide/);
  for (const other of games.filter(item => item.status !== 'live')) {
    assert.throws(() => calendarGameLive(other), /en curso/);
  }
});

test('date/state/municipality filter returns every matching game in time order and excludes other locations', () => {
  const found = calendarGames(games, venues, caracas('2026-11-04'));
  assert.deepEqual(found.map(game => game.id), ['ejemplo-caracas-1', 'ejemplo-caracas-2']);
  const aragua = { date: '2026-11-04', stateId: 'VE-D', municipalityId: 'VE-D:girardot' };
  assert.deepEqual(calendarGames(games, venues, aragua).map(game => game.id), ['ejemplo-maracay-1']);
  assert.deepEqual(calendarGames(games, venues, { ...aragua, municipalityId: 'VE-D:tovar' }), []);
  assert.deepEqual(calendarGames(games, venues, caracas('0001-01-01')), []);
  assert.deepEqual(calendarGames(games, venues, caracas('9999-12-31')), []);
  assert.throws(() => calendarGames(games, venues, { ...aragua, municipalityId: 'VE-A:libertador' }));
  assert.throws(() => calendarGames(games, [], caracas('2026-11-04')));
});
test('official calendar filtering requires registered date and territory, preserves statuses and never infers a stadium location', () => {
  const details = { date: '2026-11-05', time: '18:00', venue: 'Estadio', ...demoProfileLocation };
  const official = ['scheduled', 'in_progress', 'protested', 'final'].map((status, index) =>
    ({ gameId: `g-${index}`, status, details: { ...details, time: `${10 + index}:00` } }));
  const before = structuredClone(official);
  const found = calendarOfficialGames([...official,
    { gameId: 'without-location', details: { ...details, stateId: undefined, municipalityId: undefined } },
    { gameId: 'different-date', details: { ...details, date: '2026-11-06' } },
    { gameId: 'different-state', details: { ...details, stateId: 'VE-D', municipalityId: 'VE-D:girardot' } },
    { gameId: 'different-municipality', details: { ...details, municipalityId: 'VE-D:girardot' } },
    { gameId: 'without-details', details: null }
  ], caracas('2026-11-05'));
  assert.deepEqual(found.map(game => game.gameId), ['g-0', 'g-1', 'g-2', 'g-3']);
  assert.deepEqual(found.map(game => game.status), ['scheduled', 'in_progress', 'protested', 'final']);
  assert.deepEqual(official, before);
  assert.throws(() => calendarOfficialGames(official, caracas('')));
});

test('historical results decades earlier remain available, including a tie, without regenerating scores', () => {
  const before = JSON.stringify(games);
  const ancient = calendarGames(games, venues, caracas('1952-02-29'));
  assert.equal(ancient.length, 1);
  assert.equal(calendarResultSummary(ancient[0]), 'Ganó Diamantes de Caracas 3–1 en 9 entradas.');
  const tie = calendarGames(games, venues, caracas('2000-02-29'));
  assert.equal(calendarResultSummary(tie[0]), 'Empate 4–4 en 9 entradas.');
  assert.equal(calendarResultSummary(games.find(game => game.id === 'ejemplo-cancelado')), 'No se disputó el partido.');
  assert.equal(calendarScoreLabel(games.find(game => game.id === 'ejemplo-manana')), 'Sin resultado registrado.');
  assert.equal(JSON.stringify(games), before);
});

test('filter drafts allow temporarily cleared dates, reject foreign municipalities and never invent special-area municipalities', () => {
  assert.ok(isCalendarFilters(caracas('')));
  assert.equal(isCalendarFilters(caracas('2026-02-30')), false);
  assert.throws(() => calendarGames(games, venues, caracas('')));
  for (const state of venezuelaStates.filter(state => !state.municipalities.length)) {
    assert.ok(state.note);
    assert.ok(isCalendarFilters({ date: '2026-11-04', stateId: state.id, municipalityId: '' }));
    assert.deepEqual(calendarGames(games, venues, { date: '2026-11-04', stateId: state.id, municipalityId: '' }), []);
  }
});

test('profile location is backward compatible, validated and independent of browsing filters', () => {
  const old = { version: 1, role: 'player', team: 'team-A' };
  assert.deepEqual(readDemoSession(old), old);
  assert.deepEqual(demoSessionLocation(old), demoProfileLocation);
  const profile = { ...old, location: { stateId: 'VE-D', municipalityId: 'VE-D:girardot' } };
  assert.deepEqual(readDemoSession(profile), profile);
  assert.equal(readDemoSession({ ...profile, location: { stateId: 'VE-A', municipalityId: 'VE-D:girardot' } }), null);
  const other = caracas('1952-02-29');
  calendarGames(games, venues, other);
  assert.deepEqual(demoSessionLocation(profile), { stateId: 'VE-D', municipalityId: 'VE-D:girardot' });
  const module = demoModules.find(item => item.id === 'events-map');
  for (const role of ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout']) {
    assert.equal(demoModuleHref(module, { ...old, role }), '/demo/events-map');
  }
});

test('all-state calendar queries preserve the date and never turn a general query into a profile location', () => {
  const filters = { date: '2026-11-05', stateId: '', municipalityId: '' };
  assert.ok(isCalendarFilters(filters));
  assert.equal(isProfileLocation(filters), false);
  assert.equal(isCalendarFilters({ ...filters, municipalityId: demoProfileLocation.municipalityId }), false);
  assert.equal(isCalendarFilters({ ...filters, stateId: 'unknown-state' }), false);
  const expected = games.filter(game => game.date === filters.date)
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  assert.deepEqual(calendarGames(games, venues, filters), expected);
  assert.ok(new Set(expected.map(game => venues.find(venue => venue.id === game.venueId).stateId)).size > 1);
  const official = [
    { gameId: 'capital', details: { date: filters.date, time: '10:00', ...demoProfileLocation } },
    { gameId: 'aragua', details: { date: filters.date, time: '11:00', stateId: 'VE-D', municipalityId: 'VE-D:girardot' } },
    { gameId: 'unlocated', details: { date: filters.date, time: '12:00' } },
    { gameId: 'other-date', details: { date: '2026-11-06', time: '13:00', ...demoProfileLocation } },
    { gameId: 'no-details', details: null }
  ];
  assert.deepEqual(calendarOfficialGames(official, filters).map(game => game.gameId), ['capital', 'aragua', 'unlocated']);
  assert.deepEqual(calendarOfficialGames(official, caracas(filters.date)).map(game => game.gameId), ['capital']);
});
