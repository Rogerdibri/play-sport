const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');

const bad = (fn, status = 409) => assert.throws(fn, error => error.getStatus?.() === status);
function setup() {
  const service = new OfficialScoringService();
  const controller = new OfficialScoringController(service);
  const authorize = (patch = {}) => controller.configureTournamentAuthorization('tour', {
    organizerId: 'org', organizerIdentificationNumber: 'ORG1000',
    scorekeeperIds: ['score'], scorekeeperIdentities: [{ actorId: 'score', identificationNumber: 'SCORE1000' }], ...patch
  });
  authorize();
  const players = ['ORG1000', 'SCORE1000', 'PLAYER1000', 'PLAYER2000', ...Array.from({ length: 10 }, (_, i) => `HOME${i}`)];
  for (const identificationNumber of players) service.registerGlobalPlayer({
    actorId: 'org', player: { identificationNumber, displayName: `Persona ${identificationNumber}` }
  });
  const roster = (patch = {}) => controller.configureTournamentTeamRoster('tour', 'home', {
    organizerId: 'org', managerId: 'manager', managerIdentificationNumber: 'MANAGER1000',
    playerIdentificationNumbers: ['PLAYER1000'], ...patch
  });
  const state = () => ({
    authorization: structuredClone(service.getTournamentAuthorization('tour')),
    rosters: structuredClone(service.getTournamentTeamRosters('tour'))
  });
  return { service, controller, authorize, roster, state };
}

for (const identificationNumber of ['ORG1000', 'SCORE1000']) {
  test(`official ${identificationNumber} cannot be approved as a player in any roster`, () => {
    const e = setup(), before = e.state();
    bad(() => e.roster({ playerIdentificationNumbers: ['PLAYER1000', identificationNumber] }));
    assert.deepEqual(e.state(), before);
  });
  test(`official ${identificationNumber} cannot become a manager under a different account`, () => {
    const e = setup(), before = e.state();
    bad(() => e.roster({ managerId: 'another-account', managerIdentificationNumber: identificationNumber }));
    assert.deepEqual(e.state(), before);
  });
  test(`official ${identificationNumber} cannot register as a tournament player but can exist in the global registry`, () => {
    const e = setup();
    assert.ok(e.service.getGlobalPlayers().players.some(player => player.identificationNumber === identificationNumber));
    bad(() => e.service.registerTournamentPlayer({
      tournamentId: 'tour', organizerId: 'org', player: { identificationNumber, displayName: 'Otro nombre' }
    }));
  });
}

test('a player already approved in the tournament cannot be assigned as scorekeeper through the controller', () => {
  const e = setup();
  e.roster();
  const before = e.state();
  bad(() => e.authorize({ scorekeeperIds: ['candidate'], scorekeeperIdentities: [{ actorId: 'candidate', identificationNumber: 'PLAYER1000' }] }));
  assert.deepEqual(e.state(), before);
});

test('a manager cannot be assigned as scorekeeper using the same account or an alternate one', () => {
  const e = setup();
  e.roster();
  const before = e.state();
  for (const actorId of ['manager', 'manager-alias']) bad(() => e.authorize({
    scorekeeperIds: [actorId], scorekeeperIdentities: [{ actorId, identificationNumber: 'MANAGER1000' }]
  }));
  assert.deepEqual(e.state(), before);
});

test('removing a scorekeeper or changing its account never removes the historical prohibition', () => {
  const e = setup();
  e.authorize({ scorekeeperIds: [], scorekeeperIdentities: [] });
  bad(() => e.roster({ playerIdentificationNumbers: ['SCORE1000'] }));
  bad(() => e.roster({ managerId: 'score-alias', managerIdentificationNumber: 'SCORE1000' }));
});

test('removing a player or replacing a manager never permits later appointment as scorekeeper', () => {
  const e = setup();
  e.roster();
  e.roster({ managerId: 'replacement', managerIdentificationNumber: 'MANAGER2000', playerIdentificationNumbers: ['PLAYER2000'] });
  for (const identificationNumber of ['PLAYER1000', 'MANAGER1000']) bad(() => e.authorize({
    scorekeeperIds: ['candidate'], scorekeeperIdentities: [{ actorId: 'candidate', identificationNumber }]
  }));
});

test('conflicts are isolated to the tournament, not the global registry or another tournament', () => {
  const e = setup();
  e.controller.configureTournamentAuthorization('other', {
    organizerId: 'other-organizer', organizerIdentificationNumber: 'OTHER1000', scorekeeperIds: []
  });
  e.controller.configureTournamentTeamRoster('other', 'away', {
    organizerId: 'other-organizer', managerId: 'other-manager', managerIdentificationNumber: 'SCORE1000',
    playerIdentificationNumbers: ['ORG1000']
  });
  assert.equal(e.service.getTournamentTeamRoster('other', 'away').managerId, 'other-manager');
});

test('official creation and manager assignment require an explicit identity for an unbound account', () => {
  const service = new OfficialScoringService();
  bad(() => service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', scorekeeperIds: [] }), 400);
  bad(() => service.getTournamentAuthorization('tour'), 404);
  const e = setup(), before = e.state();
  bad(() => e.authorize({ scorekeeperIds: ['unknown'], scorekeeperIdentities: [] }), 400);
  bad(() => e.roster({ managerIdentificationNumber: undefined }), 400);
  assert.deepEqual(e.state(), before);
});

test('the first account binding cannot be changed in another role or tournament', () => {
  const e = setup();
  bad(() => e.authorize({ organizerIdentificationNumber: 'CHANGED1000' }));
  bad(() => e.roster({ managerId: 'score', managerIdentificationNumber: 'CHANGED2000' }));
  bad(() => e.controller.configureTournamentAuthorization('other', {
    organizerId: 'org', organizerIdentificationNumber: 'CHANGED3000', scorekeeperIds: []
  }));
  bad(() => e.service.getTournamentAuthorization('other'), 404);
});

test('normalized cedulas match independently of case, punctuation, names or account names', () => {
  const e = setup();
  bad(() => e.roster({ managerId: 'unrelated-name', managerIdentificationNumber: 's-c-o-r-e-1000' }));
  bad(() => e.roster({ playerIdentificationNumbers: ['o-r-g-1000'] }));
});

test('failed authorization batches do not bind accounts or leave partial official restrictions', () => {
  const e = setup();
  e.roster();
  const before = e.state();
  bad(() => e.authorize({
    scorekeeperIds: ['fresh', 'invalid'], scorekeeperIdentities: [
      { actorId: 'fresh', identificationNumber: 'FRESH1000' }, { actorId: 'invalid', identificationNumber: 'PLAYER1000' }
    ]
  }));
  assert.deepEqual(e.state(), before);
  e.authorize({ scorekeeperIds: ['fresh'], scorekeeperIdentities: [{ actorId: 'fresh', identificationNumber: 'FRESH2000' }] });
  e.service.registerGlobalPlayer({ actorId: 'org', player: { identificationNumber: 'FRESH1000', displayName: 'Persona no asignada' } });
  e.roster({ playerIdentificationNumbers: ['FRESH1000'] });
});

test('failed roster batches do not bind manager identities or record participant history', () => {
  const e = setup();
  bad(() => e.roster({ playerIdentificationNumbers: ['UNKNOWN1000'] }), 400);
  e.roster({ managerIdentificationNumber: 'MANAGER2000' });
  e.authorize({
    scorekeeperIds: ['candidate'], scorekeeperIdentities: [{ actorId: 'candidate', identificationNumber: 'MANAGER1000' }]
  });
});

test('identity lists reject unknown accounts, duplicates, malformed records and conflicting bindings atomically', () => {
  const e = setup(), before = e.state();
  for (const scorekeeperIdentities of [
    'invalid', [null], [{ actorId: 'unrequested', identificationNumber: 'TEST1000' }],
    [{ actorId: 'score', identificationNumber: 'SCORE1000' }, { actorId: 'score', identificationNumber: 'SCORE1000' }]
  ]) bad(() => e.authorize({ scorekeeperIdentities }), 400);
  bad(() => e.authorize({ scorekeeperIdentities: [{ actorId: 'score', identificationNumber: 'CHANGED1000' }] }));
  assert.deepEqual(e.state(), before);
});

test('existing bindings can be reused without resending cedulas, and official roles can be combined', () => {
  const e = setup();
  e.authorize({
    organizerIdentificationNumber: undefined, scorekeeperIds: ['org', 'score'],
    scorekeeperIdentities: undefined
  });
  e.roster();
  e.roster({ managerIdentificationNumber: undefined });
  assert.deepEqual(e.service.getTournamentAuthorization('tour').authorizedScorekeeperIds, ['org', 'score']);
});

test('manager aliases cannot bypass the existing one-team-per-tournament restriction', () => {
  const e = setup();
  e.roster();
  bad(() => e.controller.configureTournamentTeamRoster('tour', 'away', {
    organizerId: 'org', managerId: 'manager-alias', managerIdentificationNumber: 'MANAGER1000',
    playerIdentificationNumbers: ['PLAYER2000']
  }), 400);
});

function delivered() {
  const e = setup();
  e.roster({ playerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `HOME${i}`) });
  e.controller.configureTournamentTeamRoster('tour', 'away', {
    organizerId: 'org', managerId: 'away-manager', managerIdentificationNumber: 'AWAYMANAGER1000',
    playerIdentificationNumbers: ['PLAYER2000']
  });
  e.service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  e.service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['score'] });
  const lineup = (presentOfficials) => e.service.configureGameLineup({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'manager',
    lineupEntries: Array.from({ length: 9 }, (_, i) => ({
      identificationNumber: `HOME${i}`, battingOrder: i + 1,
      fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i]
    })), presentOfficials
  });
  return { ...e, lineup };
}

test('initial team-staff MANAGER and DIRIGENTE entries cannot hide an official identity', () => {
  const e = delivered();
  for (const role of ['MANAGER', 'DIRIGENTE']) bad(() => e.lineup([
    { role, identificationNumber: 'SCORE1000', displayName: 'Nombre alternativo' }
  ]));
  assert.equal(e.service.getTeamSheets('game', 'tour', 'org', 'organizer').sheets.length, 0);
});

test('team manager staff is remembered after departure and cannot later be appointed scorekeeper', () => {
  const e = delivered();
  e.lineup([{ role: 'MANAGER', identificationNumber: 'STAFF1000', displayName: 'Manager de campo' }]);
  const sheet = e.service.getTeamSheets('game', 'tour', 'org', 'organizer').sheets[0];
  e.service.recordPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', actorId: 'org', actorRole: 'organizer',
    expectedRevision: sheet.revision, expectedOfficialVersion: e.service.getOfficialState('game', 'tour').state.officialVersion,
    action: { kind: 'staff-departure', role: 'MANAGER', identificationNumber: 'STAFF1000' }
  });
  bad(() => e.authorize({
    scorekeeperIds: ['staff-account'], scorekeeperIdentities: [{ actorId: 'staff-account', identificationNumber: 'STAFF1000' }]
  }));
});

test('direct official changes and legacy manager requests both reject an official joining team manager staff', () => {
  const e = delivered();
  e.lineup([]);
  const action = { kind: 'staff-arrival', official: { role: 'MANAGER', identificationNumber: 'ORG1000', displayName: 'Otro nombre' } };
  const before = e.service.getTeamSheets('game', 'tour', 'org', 'organizer');
  bad(() => e.service.recordPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', actorId: 'org', actorRole: 'organizer',
    expectedRevision: 1, expectedOfficialVersion: e.service.getOfficialState('game', 'tour').state.officialVersion, action
  }));
  bad(() => e.service.requestPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'manager', expectedRevision: 1, action
  }));
  assert.deepEqual(e.service.getTeamSheets('game', 'tour', 'org', 'organizer'), before);
});

test('a player registered in tournament context retains the conflict before being added to a roster', () => {
  const e = setup();
  e.service.registerTournamentPlayer({
    tournamentId: 'tour', organizerId: 'org', player: { identificationNumber: 'NEWPLAYER1000', displayName: 'Jugador nuevo' }
  });
  bad(() => e.authorize({
    scorekeeperIds: ['new-account'], scorekeeperIdentities: [{ actorId: 'new-account', identificationNumber: 'NEWPLAYER1000' }]
  }));
});

test('a pending staff request is revalidated if its person becomes a scorekeeper before approval', () => {
  const e = delivered();
  e.lineup([]);
  const pending = e.service.requestPersonnelChange({
    gameId: 'game', tournamentId: 'tour', teamId: 'home', managerId: 'manager', expectedRevision: 1,
    action: { kind: 'staff-arrival', official: { role: 'MANAGER', identificationNumber: 'PENDING1000', displayName: 'Manager propuesto' } }
  }).requests.at(-1);
  e.authorize({
    scorekeeperIds: ['pending-account'], scorekeeperIdentities: [{ actorId: 'pending-account', identificationNumber: 'PENDING1000' }]
  });
  bad(() => e.service.decidePersonnelChange({
    gameId: 'game', tournamentId: 'tour', actorId: 'org', actorRole: 'organizer',
    requestId: pending.id, expectedRevision: 1, decision: 'approve'
  }));
  const after = e.service.getTeamSheets('game', 'tour', 'org', 'organizer');
  assert.equal(after.requests.at(-1).status, 'pending');
  assert.equal(after.sheets[0].presentOfficials.length, 0);
});

test('a global player who has never participated in this tournament can be assigned as scorekeeper', () => {
  const e = setup();
  e.authorize({
    scorekeeperIds: ['global-player-account'], scorekeeperIdentities: [{ actorId: 'global-player-account', identificationNumber: 'PLAYER2000' }]
  });
  bad(() => e.roster({ playerIdentificationNumbers: ['PLAYER2000'] }));
});
