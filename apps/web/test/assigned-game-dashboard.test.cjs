const assert = require('node:assert/strict');
const { test } = require('node:test');
const { activeAssignedGame, currentAssignedGame, assignedGameExamples, assignedGameSections, calendarExampleGames } = require('@playsport/shared');

const game = (gameId, status = 'scheduled') => ({
  gameId, tournamentId: 'official-tournament', status,
  homeTeamId: 'home', awayTeamId: 'away', homeScore: 0, awayScore: 0,
  details: null, assignedScorekeeperIds: ['scorer-demo'], availableScorekeeperIds: ['scorer-demo']
});

test('the preview contains two upcoming and two final games after closing the live example', () => {
  assert.deepEqual(assignedGameSections.map(section => section.status), ['in_progress', 'scheduled', 'protested', 'suspended', 'final']);
  assert.deepEqual(assignedGameSections.map(section => assignedGameExamples.filter(example => example.status === section.status).length), [0, 2, 0, 0, 2]);
  assert.equal(new Set(assignedGameExamples.map(example => example.exampleId)).size, 4);
});

test('the live shortcut never opens a game blocked by another active annotation', () => {
  const active = game('active', 'in_progress');
  const blocked = { ...game('next'), scoringBlockReason: 'Ya estás anotando otro partido.' };
  assert.equal(activeAssignedGame([blocked, active], 'next'), active);
  assert.equal(activeAssignedGame([blocked], 'next'), null);
});

test('examples preserve existing fictional calendar scores and cannot be passed as official game identities', () => {
  for (const example of assignedGameExamples) {
    const source = calendarExampleGames.find(item => item.id === example.exampleId);
    assert.ok(source);
    assert.equal(example.details.awayTeamName, source.awayTeam);
    assert.equal(example.details.homeTeamName, source.homeTeam);
    assert.equal(example.awayScore, source.score?.away ?? 0);
    assert.equal(example.homeScore, source.score?.home ?? 0);
    assert.equal(example.innings, source.score?.innings ?? null);
    assert.ok(example.details.venue);
    for (const key of ['gameId', 'tournamentId', 'assignedScorekeeperIds']) assert.equal(key in example, false);
  }
});

test('live shortcut reopens the last assigned unfinished game without mutating the catalog', () => {
  const games = [game('next'), game('opened'), game('completed', 'final')];
  const before = structuredClone(games);
  assert.equal(activeAssignedGame(games, 'opened'), games[1]);
  assert.deepEqual(games, before);
});

test('the actual game in progress takes priority over an old pending selection', () => {
  const games = [game('old'), game('live', 'in_progress')];
  assert.equal(activeAssignedGame(games, 'old'), games[1]);
  assert.equal(activeAssignedGame(games, null), games[1]);
});

test('a preferred active game resolves multiple live games, otherwise explicit selection is required', () => {
  const games = [game('first', 'in_progress'), game('second', 'in_progress'), game('next')];
  assert.equal(activeAssignedGame(games, 'second'), games[1]);
  assert.equal(activeAssignedGame(games, 'next'), null);
  assert.equal(activeAssignedGame(games, null), null);
});

test('revoked, completed and nonexistent selections never reopen a writable workspace', () => {
  const games = [game('next'), game('completed', 'final')];
  for (const preferred of ['revoked', 'completed', '', null]) assert.equal(activeAssignedGame(games, preferred), null);
  assert.equal(activeAssignedGame([], 'revoked'), null);
  assert.equal(activeAssignedGame([], assignedGameExamples[0].exampleId), null);
});

const scheduled = (id, date = '2026-11-05', time = '18:00') => ({
  ...game(id), details: { tournamentName: 'Torneo de prueba', homeTeamName: 'Local', awayTeamName: 'Visitante', date, time, venue: 'Estadio' }
});
const at = value => new Date(value);

test('current entry opens exactly one hour before the scheduled time through the end of that day in Venezuela', () => {
  const next = scheduled('next');
  assert.equal(currentAssignedGame([next], at('2026-11-05T16:59:59.999-04:00')).game, null);
  for (const time of ['17:00:00', '18:00:00', '23:59:59.999']) {
    assert.equal(currentAssignedGame([next], at(`2026-11-05T${time}-04:00`)).game, next);
  }
  assert.equal(currentAssignedGame([next], at('2026-11-06T00:00:00-04:00')).game, null);
});

test('the eligibility window uses Venezuela time rather than UTC or the device timezone', () => {
  const next = scheduled('next');
  assert.equal(currentAssignedGame([next], at('2026-11-05T20:59:59.999Z')).game, null);
  assert.equal(currentAssignedGame([next], at('2026-11-05T21:00:00Z')).game, next);
  assert.equal(currentAssignedGame([next], at('2026-11-06T03:59:59.999Z')).game, next);
  assert.equal(currentAssignedGame([next], at('2026-11-06T04:00:00Z')).game, null);
});

test('an early morning game becomes eligible in the preceding evening and expires on its own date', () => {
  const next = scheduled('next', '2027-01-01', '00:30');
  assert.equal(currentAssignedGame([next], at('2026-12-31T23:29:59.999-04:00')).game, null);
  assert.equal(currentAssignedGame([next], at('2026-12-31T23:30:00-04:00')).game, next);
  assert.equal(currentAssignedGame([next], at('2027-01-01T23:59:59.999-04:00')).game, next);
  assert.equal(currentAssignedGame([next], at('2027-01-02T00:00:00-04:00')).game, null);
});

test('an ongoing annotation wins over all scheduled games and continues after midnight without schedule metadata', () => {
  const live = game('live', 'in_progress');
  assert.equal(currentAssignedGame([scheduled('next'), live], at('2026-11-05T18:00:00-04:00')).game, live);
  assert.equal(currentAssignedGame([live], at('2026-11-06T03:00:00-04:00')).game, live);
});

test('overlapping pending or ongoing games require explicit selection without choosing arbitrarily', () => {
  for (const games of [
    [scheduled('first'), scheduled('second', '2026-11-05', '19:00')],
    [game('first', 'in_progress'), game('second', 'in_progress')]
  ]) {
    const result = currentAssignedGame(games, at('2026-11-05T18:00:00-04:00'));
    assert.equal(result.game, null);
    assert.match(result.message, /más de un partido.*Mis partidos asignados/);
  }
});

test('blocked, final, unscheduled and out-of-window games cannot be selected by the current entry', () => {
  const blocked = { ...scheduled('blocked'), scoringBlockReason: 'Ya estás anotando otro partido.' };
  const games = [blocked, game('no-date'), game('final', 'final'), scheduled('old', '2026-11-04'), scheduled('future', '2026-11-06')];
  const before = structuredClone(games);
  assert.equal(currentAssignedGame(games, at('2026-11-05T18:00:00-04:00')).game, null);
  assert.deepEqual(games, before);
  assert.match(currentAssignedGame([]).message, /No tienes un partido/);
});

test('a blocked ongoing annotation cannot fall back to a different pending game', () => {
  const blocked = { ...game('live', 'in_progress'), scoringBlockReason: 'No tienes autorización para anotar.' };
  const result = currentAssignedGame([blocked, scheduled('next')], at('2026-11-05T18:00:00-04:00'));
  assert.equal(result.game, null);
  assert.equal(result.message, blocked.scoringBlockReason);
  assert.throws(() => currentAssignedGame([], new Date('invalid')), /determinar la hora/);
});
