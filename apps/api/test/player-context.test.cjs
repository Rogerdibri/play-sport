const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { NestFactory } = require('@nestjs/core');
const {
  OfficialScoringService,
} = require('../src/modules/live-scoring/official-scoring.service');
const {
  RegistrationService,
} = require('../src/modules/live-scoring/registration.service');
const {
  RegistrationController,
} = require('../src/modules/live-scoring/registration.controller');
const { newTournament, demoProfileLocation } = require('@playsport/shared');
const { accountCookieName } = require('../src/modules/accounts/account-http');
const fixture = require('./sporting-account-fixture.cjs');
const identityPhoto = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString('base64')}`;

function scoringFixture(registry) {
  const scoring = new OfficialScoringService(registry);
  for (const tournamentId of ['first', 'second']) {
    scoring.configureTournamentAuthorization({
      tournamentId,
      organizerId: 'org',
      organizerIdentificationNumber: 'ORG1000',
      scorekeeperIds: [],
    });
    if (tournamentId === 'first')
      scoring.registerGlobalPlayer({
        actorId: 'org',
        player: {
          identificationNumber: 'V99000001',
          displayName: 'Jugador Ficticio',
        },
      });
    scoring.configureTournamentTeamRoster({
      tournamentId,
      organizerId: 'org',
      teamId: 'A',
      managerId: 'manager',
      managerIdentificationNumber: 'MANAGER1000',
      playerIdentificationNumbers: ['V99000001'],
    });
  }
  return scoring;
}
test('one player can discover memberships in multiple tournaments, but not another player or a manager', () => {
  const scoring = scoringFixture();
  assert.deepEqual(
    scoring
      .listPlayerTeams('V-99000001')
      .map((team) => [team.tournamentId, team.teamId]),
    [
      ['first', 'A'],
      ['second', 'A'],
    ],
  );
  assert.deepEqual(scoring.listPlayerTeams('V-99000002'), []);
  assert.deepEqual(scoring.listPlayerTeams('MANAGER1000'), []);
});
test('manager context reuses assigned rosters across tournaments, includes pending own inscriptions, and excludes withdrawn or foreign assignments', () => {
  const scoring = scoringFixture();
  assert.deepEqual(
    scoring
      .listManagerSportsTeams('manager', 'owner')
      .map((team) => team.tournamentId),
    ['first', 'second'],
  );
  assert.deepEqual(
    scoring.listManagerSportsTeams('another-manager', 'owner'),
    [],
  );
  const planned = {
    ...newTournament('first'),
    name: 'Copa privada propia',
    leagueId: 'private-league',
    leagueName: 'Liga de pruebas',
    location: { ...demoProfileLocation, address: '', mapUrl: '' },
    teams: [
      {
        id: 'A',
        name: 'Equipo propio',
        status: 'pending',
        rosterStatus: 'pending',
        enrollment: { status: 'draft' },
      },
    ],
  };
  scoring.setTournamentPlanning({
    document: (id) => (id === 'first' ? planned : null),
    published: () => false,
    managerAccount: (id, actor, accountId) =>
      id === 'first' && actor === 'manager' && accountId === 'owner',
  });
  const own = scoring.listManagerSportsTeams('manager', 'owner');
  assert.equal(own.length, 2);
  assert.equal(own[0].leagueId, 'private-league');
  assert.deepEqual(own[0].location, demoProfileLocation);
  assert.doesNotMatch(
    JSON.stringify(own),
    /managerId|identification|birthDate|email|enrollment/,
  );
  assert.deepEqual(
    scoring
      .listManagerSportsTeams('manager', 'foreign')
      .map((team) => team.tournamentId),
    ['second'],
  );
  planned.teams[0].status = 'withdrawn';
  assert.deepEqual(
    scoring
      .listManagerSportsTeams('manager', 'owner')
      .map((team) => team.tournamentId),
    ['second'],
  );
  assert.equal(scoring.listPlayerTeams('MANAGER1000').length, 0);
});
test('manager-owned roster membership comes from the current player rows, not staff or a stale official projection', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-player-context-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const registry = new RegistrationService(join(directory, 'registry.json'));
  const scoring = scoringFixture(registry);
  const api = new RegistrationController(registry, scoring);
  for (const [identification, role] of [
    ['V-99000002', 'PLAYER'],
    ['V-99000003', 'COACH_FIRST'],
  ]) {
    api.preinscribe({
      tournamentId: 'first',
      teamId: 'A',
      managerId: 'manager',
      role,
      person: {
        identification,
        fullName: 'Persona Ficticia',
        birthDate: '1990-01-02',
        phone: '04121234567',
        email: '',
        representativeIdentification: '',
      },
    });
  }
  const planned = {
    ...newTournament('first'),
    name: 'Inscripción real',
    teams: [
      {
        id: 'A',
        name: 'Equipo inscrito',
        status: 'accepted',
        rosterStatus: 'approved',
        enrollment: { status: 'submitted' },
      },
    ],
  };
  scoring.setTournamentPlanning({
    document: (id) => (id === 'first' ? planned : null),
    published: () => true,
  });
  assert.deepEqual(
    scoring.listPlayerTeams('V99000002').map((row) => row.teamId),
    ['A'],
  );
  assert.deepEqual(scoring.listPlayerTeams('V99000003'), []);
  assert.deepEqual(
    scoring.listPlayerTeams('V99000001').map((row) => row.tournamentId),
    ['second'],
  );
  planned.teams[0].rosterStatus = 'pending';
  assert.deepEqual(scoring.listPlayerTeams('V99000002'), []);
});
test('public discovery hides private plans and player memberships exclude pending or withdrawn teams', () => {
  const scoring = scoringFixture();
  const first = {
    ...newTournament('first'),
    name: 'Copa de pruebas',
    leagueId: 'league',
    leagueName: 'Liga de pruebas',
    location: { ...demoProfileLocation, address: '', mapUrl: '' },
    teams: [
      {
        id: 'A',
        name: 'Equipo A',
        status: 'accepted',
        rosterStatus: 'approved',
      },
    ],
  };
  scoring.setTournamentPlanning({
    document: (id) => (id === 'first' ? first : null),
    published: () => false,
  });
  assert.deepEqual(
    scoring.publicSportsTournaments().tournaments.map((row) => row.id),
    ['second'],
  );
  assert.equal(scoring.listPlayerTeams('V99000001')[0].leagueId, 'league');
  assert.deepEqual(
    scoring.listPlayerTeams('V99000001')[0].location,
    demoProfileLocation,
  );
  first.teams[0].rosterStatus = 'pending';
  assert.deepEqual(
    scoring.listPlayerTeams('V99000001').map((row) => row.tournamentId),
    ['second'],
  );
  first.teams[0].rosterStatus = 'approved';
  first.teams[0].status = 'withdrawn';
  assert.deepEqual(
    scoring.listPlayerTeams('V99000001').map((row) => row.tournamentId),
    ['second'],
  );
});
test('own-team HTTP lookup requires an authenticated cookie, rejects identity parameters, and does not expose roster identities', async (t) => {
  const account = await fixture(t);
  const accounts = account.provider.useValue;
  const owner = await accounts.register(
    {
      email: 'player-context@example.test',
      displayName: 'Jugador de prueba',
      password: 'Frase ficticia para contexto deportivo 123456',
    },
    'player-context',
  );
  const reviewer = await accounts.login(
    {
      email: 'official-fixture@example.test',
      password: 'Frase ficticia para pruebas deportivas 123456',
    },
    'reviewer',
  );
  accounts.submitIdentity(owner.token, {
    expectedAccountId: owner.account.id,
    requestId: randomUUID(),
    expectedRevision: 0,
    identification: 'V-99000001',
    fullName: 'Jugador Ficticio',
    birthDate: '1990-01-02',
    documentPhoto: identityPhoto,
    personalPhoto: identityPhoto,
    consent: true,
  });
  accounts.reviewIdentity(reviewer.token, {
    expectedAccountId: reviewer.account.id,
    accountId: owner.account.id,
    expectedRevision: 1,
    decision: 'verified',
    reason: 'Prueba de identidad',
    documentsMatch: true,
  });
  const scoring = scoringFixture();
  const app = await NestFactory.create(
    {
      module: class PlayerContextTestModule {},
      controllers: [RegistrationController],
      providers: [
        account.provider,
        { provide: RegistrationService, useValue: {} },
        { provide: OfficialScoringService, useValue: scoring },
      ],
    },
    { logger: false },
  );
  account.manage(app);
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/registration/roster/player-teams`;
  assert.equal((await account.nativeFetch(url)).status, 401);
  const headers = { Cookie: `${accountCookieName()}=${owner.token}` };
  const response = await account.nativeFetch(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /private.*no-store/);
  const result = await response.json();
  assert.equal(result.accountId, owner.account.id);
  assert.equal(result.teams.length, 2);
  assert.doesNotMatch(
    JSON.stringify(result),
    /99000001|identification|birthDate|email|managerId/,
  );
  assert.equal(
    (await account.nativeFetch(`${url}?identification=V99000002`, { headers }))
      .status,
    400,
  );
  const identity = accounts.authenticate(owner.token).identity;
  scoring.registerGlobalPlayer({
    actorId: 'org',
    player: {
      identificationNumber: 'V99000003',
      displayName: 'Jugador ficticio del manager',
    },
  });
  for (const tournamentId of ['manager-first', 'manager-second']) {
    scoring.configureTournamentAuthorization({
      tournamentId,
      organizerId: 'org',
      organizerIdentificationNumber: 'ORG1000',
      scorekeeperIds: [],
    });
    scoring.configureTournamentTeamRoster({
      tournamentId,
      organizerId: 'org',
      teamId: 'A',
      managerId: identity.actorId,
      managerIdentificationNumber: identity.identification,
      playerIdentificationNumbers: ['V99000003'],
    });
  }
  const managerUrl = url.replace('player-teams', 'manager-teams');
  assert.equal((await account.nativeFetch(managerUrl)).status, 401);
  const managed = await account.nativeFetch(managerUrl, { headers });
  assert.equal(managed.status, 200);
  assert.match(managed.headers.get('cache-control'), /private.*no-store/);
  const managedValue = await managed.json();
  assert.equal(managedValue.accountId, owner.account.id);
  assert.deepEqual(
    managedValue.teams.map((team) => team.tournamentId),
    ['manager-first', 'manager-second'],
  );
  assert.doesNotMatch(
    JSON.stringify(managedValue),
    /identification|birthDate|email|managerId|playerIdentificationNumbers/,
  );
  for (const query of [
    'accountId=foreign',
    `managerId=${encodeURIComponent(identity.actorId)}`,
    'identification=V99000002',
  ]) {
    assert.equal(
      (await account.nativeFetch(`${managerUrl}?${query}`, { headers })).status,
      400,
    );
  }
  const unverified = await account.nativeFetch(managerUrl, {
    headers: { Cookie: `${accountCookieName()}=${reviewer.token}` },
  });
  assert.deepEqual((await unverified.json()).teams, []);
  const stranger = await accounts.register(
    {
      email: 'different-manager@example.test',
      displayName: 'Otro manager ficticio',
      password: 'Frase ficticia para otro manager 123456',
    },
    'different-manager',
  );
  accounts.submitIdentity(stranger.token, {
    expectedAccountId: stranger.account.id,
    requestId: randomUUID(),
    expectedRevision: 0,
    identification: 'V99000002',
    fullName: 'Otro Manager Ficticio',
    birthDate: '1990-01-02',
    documentPhoto: identityPhoto,
    personalPhoto: identityPhoto,
    consent: true,
  });
  accounts.reviewIdentity(reviewer.token, {
    expectedAccountId: reviewer.account.id,
    accountId: stranger.account.id,
    expectedRevision: 1,
    decision: 'verified',
    reason: 'Prueba de identidad',
    documentsMatch: true,
  });
  const foreign = await account.nativeFetch(managerUrl, {
    headers: { Cookie: `${accountCookieName()}=${stranger.token}` },
  });
  assert.equal(foreign.status, 200);
  assert.deepEqual((await foreign.json()).teams, []);
});
