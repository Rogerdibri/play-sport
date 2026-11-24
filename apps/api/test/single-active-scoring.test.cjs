const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { readOfficialGames } = require('@playsport/shared');
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') }));

function setup() {
  const service = new OfficialScoringService();
  for (const teamId of ['home', 'away']) for (let i = 0; i < 10; i++) {
    service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: `${teamId}${i}`, displayName: `Ficticio ${teamId}${i}` } });
  }
  for (const tournamentId of ['tour', 'other-tour']) {
    service.configureTournamentAuthorization({ tournamentId, organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
      scorekeeperIds: ['score', 'alias', 'other'], scorekeeperIdentities: [
        { actorId: 'score', identificationNumber: 'SCORE0001' }, { actorId: 'alias', identificationNumber: 'SCORE0001' },
        { actorId: 'other', identificationNumber: 'OTHER0001' }
      ] });
    for (const teamId of ['home', 'away']) service.configureTournamentTeamRoster({
      tournamentId, organizerId: 'org', teamId, managerId: `mgr-${teamId}`, managerIdentificationNumber: `MGR${teamId}`,
      playerIdentificationNumbers: Array.from({ length: 10 }, (_, i) => `${teamId}${i}`)
    });
  }
  const tour = gameId => gameId === 'game-3' ? 'other-tour' : 'tour';
  const assign = (gameId, scorekeeperIds) => service.configureGameAuthorization({ gameId, tournamentId: tour(gameId), organizerId: 'org', scorekeeperIds });
  for (const gameId of ['game-1', 'game-2', 'game-3']) {
    const tournamentId = tour(gameId);
    service.configureGameTeams({ gameId, tournamentId, organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
    assign(gameId, ['score', 'alias', 'other']);
    for (const teamId of ['home', 'away']) service.configureGameLineup({
      gameId, tournamentId, teamId, managerId: `mgr-${teamId}`,
      lineupEntries: Array.from({ length: 9 }, (_, i) => ({ identificationNumber: `${teamId}${i}`, battingOrder: i + 1,
        fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i] }))
    });
  }
  const get = gameId => structuredClone(service.getOfficialState(gameId, tour(gameId)));
  const sheets = (gameId, userId = 'score', role = 'scorekeeper') => service.getTeamSheets(gameId, tour(gameId), userId, role);
  const send = (gameId, operation, actorId = 'score', actorRole = 'scorekeeper') => service.submitOfficialUpdate({
    gameId, tournamentId: tour(gameId), actorId, actorRole, patch: {}, expectedOfficialVersion: get(gameId).state.officialVersion, ...operation
  });
  const pitch = (gameId, actorId, actorRole) => send(gameId, { scorecardCommand: { kind: 'pitch', value: 'ball' } }, actorId, actorRole);
  const finish = gameId => send(gameId, { scorecardCommand: { kind: 'finish' } });
  const personnel = (gameId, actorId = 'score') => service.recordPersonnelChange({
    gameId, tournamentId: tour(gameId), teamId: 'home', actorId, actorRole: 'scorekeeper',
    expectedRevision: sheets(gameId, actorId).sheets.find(sheet => sheet.teamId === 'home').revision,
    expectedOfficialVersion: get(gameId).state.officialVersion, action: { kind: 'arrival', identificationNumber: 'home9' }
  });
  return { service, tour, assign, get, sheets, send, pitch, finish, personnel };
}
const conflict = fn => assert.throws(fn, error => error.getStatus?.() === 409 && /Ya estás anotando/.test(error.message));

test('multiple future assignments and failed plays do not occupy a scorekeeper', () => {
  const e = setup();
  assert.equal(e.service.listOfficialGames('score', 'scorekeeper').games.length, 3);
  assert.throws(() => e.send('game-1', { scorecardCommand: { kind: 'runner', action: 'steal', from: 1, to: 2 } }));
  e.pitch('game-2');
  assert.equal(e.get('game-1').state.status, 'scheduled');
});

test('only one live game is writable across operations, tabs, devices and tournaments without hiding assigned games', () => {
  const e = setup();
  e.pitch('game-1');
  const before = ['game-1', 'game-2', 'game-3'].map(e.get);
  for (const operation of [
    { scorecardCommand: { kind: 'pitch', value: 'ball' } },
    { playEvent: { type: 'BALL' } }, { plateAppearance: { result: 'OUT' } },
    { patch: { status: 'in_progress' } }, { patch: { homeScore: 2 } },
    { undoLast: true }, { regulationInnings: 7 }, { lastErrorOuts: 1 }
  ]) conflict(() => e.send('game-2', operation));
  conflict(() => e.pitch('game-3', 'alias'));
  assert.deepEqual(['game-1', 'game-2', 'game-3'].map(e.get), before);
  const catalog = readOfficialGames(e.service.listOfficialGames('score', 'scorekeeper'), 'score', 'scorekeeper');
  assert.equal(catalog.games.length, 3);
  assert.equal(catalog.games.find(game => game.gameId === 'game-1').scoringBlockReason, null);
  assert.match(catalog.games.find(game => game.gameId === 'game-2').scoringBlockReason, /Ya estás anotando/);
  assert.equal(e.sheets('game-2').canDecide, true);
  assert.match(e.sheets('game-2').scoringBlockReason, /Ya estás anotando/);
  e.pitch('game-1');
  assert.equal(e.get('game-1').state.balls, 2);
});

test('different scorekeepers can score concurrently, while organizers follow the same per-person rule', () => {
  const e = setup();
  e.pitch('game-1');
  e.pitch('game-2', 'other');
  e.pitch('game-3', 'org', 'organizer');
  conflict(() => e.pitch('game-1', 'org', 'organizer'));
  conflict(() => e.pitch('game-3', 'other'));
});

test('finishing releases the scorekeeper and undo cannot reopen another game while one is active', () => {
  const e = setup();
  e.pitch('game-1');
  e.finish('game-1');
  assert.equal(e.sheets('game-2').scoringBlockReason, null);
  e.pitch('game-2');
  const before = e.get('game-1');
  conflict(() => e.send('game-1', { undoLast: true }));
  assert.deepEqual(e.get('game-1'), before);
  e.finish('game-2');
  e.send('game-1', { undoLast: true });
  assert.equal(e.get('game-1').state.status, 'in_progress');
  conflict(() => e.pitch('game-2'));
});

test('undoing the first pitch releases the active slot without losing the delivered lineups', () => {
  const e = setup();
  const lineups = e.get('game-1').lineup;
  e.pitch('game-1');
  e.send('game-1', { undoLast: true });
  assert.equal(e.get('game-1').state.status, 'scheduled');
  assert.deepEqual(e.get('game-1').lineup, lineups);
  e.pitch('game-2');
});

test('an organizer can relieve a scorekeeper without deleting plays; reassignment does not revive an old claim', () => {
  const e = setup();
  e.pitch('game-1');
  const before = e.get('game-1');
  e.assign('game-1', ['other']);
  e.pitch('game-2');
  e.assign('game-1', ['score', 'alias', 'other']);
  e.pitch('game-2');
  conflict(() => e.pitch('game-1'));
  assert.deepEqual(e.get('game-1'), before);
  e.pitch('game-1', 'other');
});

test('tournament revocation also frees a scorekeeper for another tournament', () => {
  const e = setup();
  e.pitch('game-1');
  e.service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['other'] });
  e.pitch('game-3');
  assert.equal(e.get('game-1').state.balls, 1);
});

test('direct personnel changes and approving requests cannot bypass another active game', () => {
  const e = setup();
  const sheet = e.sheets('game-2').sheets.find(row => row.teamId === 'home');
  const pending = e.service.requestPersonnelChange({ gameId: 'game-2', tournamentId: 'tour', teamId: 'home',
    managerId: 'mgr-home', expectedRevision: sheet.revision, action: { kind: 'arrival', identificationNumber: 'home9' } });
  e.pitch('game-1');
  const before = e.sheets('game-2');
  conflict(() => e.personnel('game-2'));
  conflict(() => e.service.decidePersonnelChange({ gameId: 'game-2', tournamentId: 'tour', actorId: 'score', actorRole: 'scorekeeper',
    requestId: pending.requests.at(-1).id, decision: 'approve', expectedRevision: sheet.revision }));
  assert.deepEqual(e.sheets('game-2'), before);
});

test('personnel work in a live game also occupies that official, but preparing a scheduled game does not', () => {
  const e = setup();
  e.personnel('game-2');
  e.pitch('game-1', 'other');
  e.personnel('game-1');
  conflict(() => e.pitch('game-3'));
  assert.equal(e.get('game-2').state.status, 'scheduled');
});

test('other open scoreboards receive block and release notifications without a reload', () => {
  const e = setup();
  const updates = [];
  const subscription = e.service.createTeamSheetStream('game-2', 'tour', 'score', 'scorekeeper').subscribe(value => updates.push(value));
  try {
    e.pitch('game-1');
    assert.match(updates.at(-1).scoringBlockReason, /Ya estás anotando/);
    const blockedVersion = updates.at(-1).version;
    e.finish('game-1');
    assert.equal(updates.at(-1).scoringBlockReason, null);
    assert.ok(updates.at(-1).version > blockedVersion);
    assert.equal(e.sheets('game-2', 'mgr-home', 'manager').scoringBlockReason, null);
  } finally { subscription.unsubscribe(); }
});
