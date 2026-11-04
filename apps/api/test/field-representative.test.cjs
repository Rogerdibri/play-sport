const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');

function setup() {
  const service = new OfficialScoringService();
  service.configureTournamentAuthorization({
    tournamentId: 'tournament', organizerId: 'organizer', scorekeeperIds: []
  });
  for (const [teamId, managerId, prefix] of [
    ['home', 'manager', 'HOME'], ['away', 'rival', 'AWAY']
  ]) {
    const players = Array.from({ length: 9 }, (_, i) => `${prefix}${i}`);
    for (const identificationNumber of players) {
      service.registerGlobalPlayer({
        actorId: 'organizer', player: { identificationNumber, displayName: `Jugador ${identificationNumber}` }
      });
    }
    service.configureTournamentTeamRoster({
      tournamentId: 'tournament', organizerId: 'organizer', teamId, managerId, playerIdentificationNumbers: players
    });
  }
  for (const gameId of ['game', 'other-game']) {
    service.configureGameTeams({
      gameId, tournamentId: 'tournament', organizerId: 'organizer', homeTeamId: 'home', awayTeamId: 'away'
    });
  }
  const command = {
    gameId: 'game', tournamentId: 'tournament', teamId: 'home',
    managerId: 'manager', identificationNumber: 'HOME0'
  };
  return { service, command };
}

test('manager authorizes an existing roster member for this team and game only', () => {
  const { service, command } = setup();
  const result = service.authorizeFieldRepresentative(command);
  assert.equal(result.representative.displayName, 'Jugador HOME0');
  assert.equal(result.representative.authorizedByManagerId, 'manager');
  assert.ok(result.representative.authorizedAt);
  assert.equal(service.getFieldRepresentative('other-game', 'tournament', 'home').representative, null);
  assert.equal(service.getFieldRepresentative('game', 'tournament', 'away').representative, null);
  assert.deepEqual(service.getFieldRepresentative('game', 'tournament', 'home'), result);
  const roster = service.getTournamentTeamRoster('tournament', 'home');
  assert.equal(roster.managerId, 'manager');
  const permissions = service.getGamePermissions({
    gameId: 'game', tournamentId: 'tournament', userId: 'HOME0', role: 'player'
  });
  assert.equal(permissions.canOfficialWrite, false);
  assert.equal(permissions.canPrivateWrite, false);
  const lineup = service.getGameLineups('game', 'tournament').lineup;
  assert.equal(lineup.fieldRepresentatives[0].identificationNumber, 'HOME0');
});

test('rejects other managers, rival members and malformed identification without replacing authorization', () => {
  const { service, command } = setup();
  service.authorizeFieldRepresentative(command);
  for (const [patch, status] of [
    [{ managerId: 'HOME0' }, 403],
    [{ managerId: 'rival' }, 403],
    [{ identificationNumber: 'AWAY0' }, 400],
    [{ identificationNumber: '' }, 400]
  ]) {
    assert.throws(() => service.authorizeFieldRepresentative({ ...command, ...patch }), (error) => error.getStatus() === status);
  }
  assert.equal(service.getFieldRepresentative('game', 'tournament', 'home').representative.identificationNumber, 'HOME0');
});

test('authorization can be changed and is revoked when representative leaves the roster', () => {
  const { service, command } = setup();
  service.authorizeFieldRepresentative(command);
  service.authorizeFieldRepresentative({ ...command, identificationNumber: 'HOME1' });
  assert.equal(service.getFieldRepresentative('game', 'tournament', 'home').representative.identificationNumber, 'HOME1');
  service.configureTournamentTeamRoster({
    tournamentId: 'tournament', organizerId: 'organizer', teamId: 'home', managerId: 'manager',
    playerIdentificationNumbers: ['HOME0', 'HOME2']
  });
  assert.equal(service.getFieldRepresentative('game', 'tournament', 'home').representative, null);
});

test('rejects changing the representative after the game is final', () => {
  const { service, command } = setup();
  service.authorizeFieldRepresentative(command);
  service.submitOfficialUpdate({
    gameId: 'game', tournamentId: 'tournament', actorId: 'organizer', actorRole: 'organizer',
    patch: { status: 'final' }
  });
  assert.throws(
    () => service.authorizeFieldRepresentative({ ...command, identificationNumber: 'HOME1' }),
    (error) => error.getStatus() === 400
  );
});
