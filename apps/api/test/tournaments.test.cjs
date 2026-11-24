const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const {
  newTournament,
  newTournamentFixture,
  readTournament,
} = require('@playsport/shared');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const {
  OfficialScoringService,
} = require('../src/modules/live-scoring/official-scoring.service');
const {
  RegistrationService,
} = require('../src/modules/live-scoring/registration.service');
const {
  TournamentsService,
} = require('../src/modules/tournaments/tournaments.service');
const bad = (fn, status) =>
  assert.throws(fn, (error) => error.getStatus?.() === status);
async function setup(t, { durable = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-tournaments-')),
    path = join(dir, 'tournaments.sqlite');
  const accounts = new AccountsService({ path: join(dir, 'accounts.sqlite') });
  const owner = await accounts.register(
    {
      email: 'owner@example.test',
      displayName: 'Organizador ficticio',
      password: 'Una frase de prueba ficticia 123456',
    },
    'owner',
  );
  const other = await accounts.register(
    {
      email: 'other@example.test',
      displayName: 'Otra cuenta ficticia',
      password: 'Otra frase de prueba ficticia 123456',
    },
    'other',
  );
  writeFileSync(
    join(dir, 'local-tester.json'),
    JSON.stringify({ version: 1, accountId: owner.account.id }),
    {
      mode: 0o600,
    },
  );
  const registry = new RegistrationService(join(dir, 'registry.json'));
  const scoringOptions = durable
    ? { path: join(dir, 'official.sqlite') }
    : undefined;
  let scoring = new OfficialScoringService(registry, scoringOptions);
  scoring.configureTournamentAuthorization({
    tournamentId: 'seed',
    organizerId: 'org-demo',
    organizerIdentificationNumber: 'ORG90001',
    scorekeeperIds: ['scorer-demo'],
    scorekeeperIdentities: [
      { actorId: 'scorer-demo', identificationNumber: 'SCORER90001' },
    ],
  });
  let service = new TournamentsService(accounts, scoring, { path });
  service.onModuleInit();
  const command = (document, patch = {}) => ({
    requestId: randomUUID(),
    expectedAccountId: owner.account.id,
    expectedRevision: 0,
    role: 'organizer',
    actorId: 'org-demo',
    action: 'save',
    teamId: '',
    document,
    ...patch,
  });
  const minimal = () => ({
    ...newTournament(randomUUID()),
    name: 'Copa ficticia de pruebas',
  });
  t.after(() => {
    service.onModuleDestroy();
    scoring.onModuleDestroy();
    accounts.onModuleDestroy();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    accounts,
    owner,
    other,
    registry,
    command,
    minimal,
    get service() {
      return service;
    },
    get scoring() {
      return scoring;
    },
    restart() {
      service.onModuleDestroy();
      scoring.onModuleDestroy();
      scoring = new OfficialScoringService(registry, scoringOptions);
      service = new TournamentsService(accounts, scoring, { path });
      service.onModuleInit();
      return service;
    },
  };
}
const identityPhoto =
  'data:image/jpeg;base64,' +
  Buffer.from([255, 216, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9, 255, 217]).toString(
    'base64',
  );
test('softball modality and unequal group capacities and qualifiers survive saving and restarting', async (t) => {
  const e = await setup(t);
  const doc = { ...e.minimal(), sport: 'softball', modality: 'Modificado' };
  doc.teams = Array.from({ length: 8 }, (_, index) => ({
    id: `group-team-${index}`,
    name: `Equipo ${index + 1}`,
    managerId: '',
    managerIdentification: '',
    status: 'accepted',
    rosterStatus: 'pending',
    rosterSignature: '',
    blocked: false,
    blockReason: '',
    blockScopes: [],
    withdrawalReason: '',
  }));
  doc.phases = [
    {
      id: 'group-phase',
      name: 'Clasificatoria',
      kind: 'round-robin',
      status: 'draft',
      sourcePhaseId: '',
      teamIds: doc.teams.map((team) => team.id),
      turns: 2,
      bestOf: 1,
      qualifiers: null,
      pairing: 'seeded',
      rules: '',
      teamLimit: null,
      groups: [
        {
          id: 'a',
          name: 'Grupo A',
          teamIds: doc.teams.slice(0, 3).map((team) => team.id),
          teamLimit: 3,
          qualifiers: 1,
        },
        {
          id: 'b',
          name: 'Grupo B',
          teamIds: doc.teams.slice(3).map((team) => team.id),
          teamLimit: 5,
          qualifiers: 2,
        },
      ],
    },
  ];
  const command = e.command(doc);
  const saved = e.service.change(e.owner.token, command).record;
  assert.deepEqual(saved.document.phases, doc.phases);
  e.restart();
  const restored = e.service.document(doc.id);
  assert.equal(restored.modality, 'Modificado');
  assert.deepEqual(restored.phases, doc.phases);
  const invalid = structuredClone(restored);
  invalid.phases[0].groups[0].teamLimit = 2;
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(invalid, { expectedRevision: saved.revision }),
      ),
    400,
  );
  invalid.phases[0].groups[0].teamLimit = 3;
  invalid.phases[0].groups[0].qualifiers = 4;
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(invalid, { expectedRevision: saved.revision }),
      ),
    400,
  );
  assert.deepEqual(e.service.document(doc.id).phases, doc.phases);
});
test('a league has its own persistent identity and logo, shared only by explicitly associated tournaments', async (t) => {
  const e = await setup(t);
  const {
    InstitutionalLogosService,
  } = require('../src/modules/institutional-logos/institutional-logos.service');
  const logos = new InstitutionalLogosService(e.accounts, e.scoring, {
    path: join(e.dir, 'league-logos.sqlite'),
  });
  try {
    const doc = { ...e.minimal(), leagueName: 'Liga ficticia independiente' };
    const command = e.command(doc);
    const first = e.service.change(e.owner.token, command).record;
    const leagueId = first.document.leagueId;
    assert.match(leagueId, /^[a-f0-9-]{36}$/);
    assert.notEqual(leagueId, doc.id);
    assert.equal(e.service.change(e.owner.token, command).replayed, true);
    assert.equal(
      e.service.list(e.owner.token, 'organizer', 'org-demo').leagues.length,
      1,
    );
    const second = e.service.change(
      e.owner.token,
      e.command({
        ...e.minimal(),
        leagueName: doc.leagueName,
        leagueId,
      }),
    ).record;
    assert.equal(second.document.leagueId, leagueId);
    const sameName = e.service.change(
      e.owner.token,
      e.command({ ...e.minimal(), leagueName: doc.leagueName }),
    ).record;
    assert.notEqual(
      sameName.document.leagueId,
      leagueId,
      'matching names alone do not merge leagues',
    );
    const logoCommand = (patch) => ({
      requestId: randomUUID(),
      expectedAccountId: e.owner.account.id,
      expectedRevision: 0,
      role: 'organizer',
      actorId: 'org-demo',
      kind: 'league',
      id: leagueId,
      logo: identityPhoto,
      ...patch,
    });
    const saved = logos.change(e.owner.token, logoCommand());
    assert.equal(saved.appliedRevision, 1);
    assert.equal(
      saved.entities.find(
        (row) => row.kind === 'tournament' && row.id === doc.id,
      ).hasLogo,
      false,
    );
    assert.equal(
      logos.list().some((row) => row.kind === 'league' && row.id === leagueId),
      false,
    );
    bad(() => logos.readImage('league', leagueId, 1), 404);
    assert.equal(
      logos.readImage('league', leagueId, 1, e.owner.token).type,
      'image/jpeg',
    );
    bad(() => logos.readImage('league', leagueId, 1, e.other.token), 404);
    bad(
      () =>
        logos.change(
          e.owner.token,
          logoCommand({ role: 'manager', actorId: 'mgr-A' }),
        ),
      403,
    );
    writeFileSync(
      join(e.dir, 'local-tester.json'),
      JSON.stringify({ version: 1, accountId: e.other.account.id }),
    );
    try {
      assert.equal(
        logos
          .manageable(e.other.token, 'organizer', 'org-demo')
          .entities.some((row) => row.id === leagueId),
        false,
      );
      bad(
        () =>
          e.service.change(
            e.other.token,
            e.command(
              {
                ...e.minimal(),
                leagueName: doc.leagueName,
                leagueId,
              },
              { expectedAccountId: e.other.account.id },
            ),
          ),
        403,
      );
    } finally {
      writeFileSync(
        join(e.dir, 'local-tester.json'),
        JSON.stringify({ version: 1, accountId: e.owner.account.id }),
      );
    }
    bad(
      () =>
        e.service.change(
          e.owner.token,
          e.command({
            ...e.minimal(),
            leagueName: 'Nombre adulterado',
            leagueId,
          }),
        ),
      409,
    );
    e.service.change(
      e.owner.token,
      e.command(first.document, {
        expectedRevision: first.revision,
        action: 'publish',
      }),
    );
    assert.equal(
      logos.list().find((row) => row.kind === 'league' && row.id === leagueId)
        .hasLogo,
      true,
    );
    assert.equal(logos.readImage('league', leagueId, 1).type, 'image/jpeg');
    e.restart();
    assert.equal(e.service.document(second.document.id).leagueId, leagueId);
    assert.equal(
      e.scoring
        .institutionalIdentities()
        .some((row) => row.kind === 'league' && row.id === leagueId),
      true,
    );
  } finally {
    logos.onModuleDestroy();
  }
});
function verifyManager(e, identification = 'V-12345678', operationalRole = 'manager') {
  e.accounts.submitIdentity(e.other.token, {
    expectedAccountId: e.other.account.id,
    requestId: randomUUID(),
    expectedRevision: 0,
    identification,
    fullName: 'Manager Ficticio',
    birthDate: '1990-01-02',
    documentPhoto: identityPhoto,
    personalPhoto: identityPhoto,
    consent: true,
  });
  e.accounts.reviewIdentity(e.owner.token, {
    expectedAccountId: e.owner.account.id,
    accountId: e.other.account.id,
    expectedRevision: 1,
    decision: 'verified',
    reason: 'Cotejo ficticio',
    documentsMatch: true,
  });
  if (operationalRole) e.accounts.activateRole(e.other.token, { expectedAccountId: e.other.account.id, role: operationalRole });
}
function independentInscription(e) {
  const doc = e.minimal();
  doc.teams = [
    {
      id: `inscription:${doc.id}:${randomUUID()}`,
      name: 'Inscripción pendiente',
      managerId: '',
      managerIdentification: 'V-12345678',
      status: 'pending',
      rosterStatus: 'pending',
      rosterSignature: '',
      blocked: false,
      blockReason: '',
      blockScopes: [],
      withdrawalReason: '',
      enrollment: {
        status: 'invited',
        contact: '',
        notes: '',
        submittedAt: '',
        reviewNotes: '',
      },
    },
  ];
  return doc;
}
function managerCommand(e, record, patch = {}) {
  return {
    requestId: randomUUID(),
    expectedAccountId: e.other.account.id,
    expectedRevision: record.revision,
    tournamentId: record.document.id,
    teamId: record.document.teams[0].id,
    action: 'save',
    name: 'Club del Manager',
    contact: 'Contacto ficticio',
    notes: 'Detalles ficticios',
    ...patch,
  };
}
test('independent inscriptions wait for the account identity, never for a client alias or team name', async (t) => {
  const e = await setup(t),
    doc = independentInscription(e);
  const first = e.service.change(e.owner.token, e.command(doc)).record;
  assert.equal(e.service.managerList(e.other.token).tournaments.length, 0);
  bad(
    () => e.service.managerChange(e.other.token, managerCommand(e, first)),
    403,
  );
  verifyManager(e);
  const assigned = e.service.managerList(e.other.token).tournaments;
  assert.equal(assigned.length, 1);
  assert.equal(
    assigned[0].managerId,
    e.accounts.authenticate(e.other.token).identity.actorId,
  );
  assert.equal(assigned[0].managerId.includes('12345678'), false);
  assert.equal(
    e.scoring.listManagerRosterTeams(assigned[0].managerId).length,
    1,
  );
  assert.deepEqual(
    e.scoring
      .listManagerSportsTeams(assigned[0].managerId, e.other.account.id)
      .map((team) => team.tournamentId),
    [doc.id],
  );
  assert.deepEqual(
    e.scoring.listManagerSportsTeams(assigned[0].managerId, e.owner.account.id),
    [],
  );
  assert.equal(
    e.scoring.institutionalIdentities().some((row) => row.id === doc.id),
    false,
  );
  const command = managerCommand(e, first);
  e.service.managerChange(e.other.token, command);
  assert.equal(e.service.managerChange(e.other.token, command).replayed, true);
  const current = e.service.list(e.owner.token, 'organizer', 'org-demo')
    .tournaments[0];
  assert.equal(current.document.teams[0].name, 'Club del Manager');
  assert.equal(
    e.scoring.listManagerSportsTeams(
      assigned[0].managerId,
      e.other.account.id,
    )[0].teamName,
    'Club del Manager',
  );
  bad(
    () =>
      e.service.managerChange(e.owner.token, {
        ...command,
        expectedAccountId: e.owner.account.id,
      }),
    403,
  );
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(
          {
            ...current.document,
            teams: current.document.teams.map((team) => ({
              ...team,
              name: 'Nombre impuesto',
            })),
          },
          { expectedRevision: current.revision },
        ),
      ),
    403,
  );
  e.restart();
  assert.equal(
    e.service.managerList(e.other.token).tournaments[0].teamName,
    'Club del Manager',
  );
  bad(
    () =>
      e.service.managerChange(
        e.other.token,
        managerCommand(e, first, { name: 'Versión atrasada' }),
      ),
    409,
  );
});
test('manager submits the real roster; organizer requests concrete corrections and accepts only a submitted version', async (t) => {
  const e = await setup(t);
  verifyManager(e);
  let record = e.service.change(
    e.owner.token,
    e.command(independentInscription(e)),
  ).record;
  bad(
    () =>
      e.service.managerChange(
        e.other.token,
        managerCommand(e, record, { action: 'submit' }),
      ),
    409,
  );
  const {
    RegistrationController,
  } = require('../src/modules/live-scoring/registration.controller');
  const registry = new RegistrationController(e.registry, e.scoring),
    team = e.service.managerList(e.other.token).tournaments[0];
  registry.preinscribe({
    managerId: team.managerId,
    tournamentId: team.tournamentId,
    teamId: team.teamId,
    role: 'PLAYER',
    person: {
      identification: 'V-87654321',
      fullName: 'Jugador Ficticio',
      birthDate: '1995-02-03',
      email: 'player@example.test',
      phone: '',
      representativeIdentification: '',
    },
  });
  e.service.managerChange(
    e.other.token,
    managerCommand(e, record, { action: 'submit' }),
  );
  record = e.service.list(e.owner.token, 'organizer', 'org-demo')
    .tournaments[0];
  assert.equal(record.document.teams[0].enrollment.status, 'submitted');
  bad(
    () =>
      e.scoring.assertPlannedRosterEditable(record.document.id, team.teamId),
    409,
  );
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(record.document, {
          expectedRevision: record.revision,
          action: 'reject-roster',
          teamId: team.teamId,
        }),
      ),
    400,
  );
  record = e.service.change(
    e.owner.token,
    e.command(record.document, {
      expectedRevision: record.revision,
      action: 'reject-roster',
      teamId: team.teamId,
      reviewNote: 'Corregir nombre del patrocinante',
    }),
  ).record;
  assert.match(record.document.teams[0].enrollment.reviewNotes, /patrocinante/);
  e.service.managerChange(
    e.other.token,
    managerCommand(e, record, { action: 'submit', name: 'Club Corregido' }),
  );
  record = e.service.list(e.owner.token, 'organizer', 'org-demo')
    .tournaments[0];
  record = e.service.change(
    e.owner.token,
    e.command(record.document, {
      expectedRevision: record.revision,
      action: 'approve-roster',
      teamId: team.teamId,
    }),
  ).record;
  assert.equal(record.document.teams[0].rosterStatus, 'approved');
  assert.equal(record.document.teams[0].status, 'accepted');
});
test('account-owned tournament connects two approved manager rosters, lineups, scoring and the public result', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') });
  const {
    venezuelaStates,
    officialGameResult,
    calendarOfficialGames,
  } = require('@playsport/shared');
  const {
    RegistrationController,
  } = require('../src/modules/live-scoring/registration.controller');
  const e = await setup(t);
  verifyManager(e);
  const rival = await e.accounts.register(
    {
      email: 'rival@example.test',
      displayName: 'Manager Rival Ficticio',
      password: 'Una frase ficticia para el rival 123456',
    },
    'rival',
  );
  verifyManager({ ...e, other: rival }, 'V-22345678');
  const scorer = await e.accounts.register({
    email: 'scorer-flow@example.test', displayName: 'Anotador del recorrido',
    password: 'Una frase ficticia para el anotador 123456',
  }, 'scorer-flow');
  verifyManager({ ...e, other: scorer }, 'V-32345678', 'scorekeeper');
  const scorerAccount = e.accounts.authenticate(scorer.token);
  const scorerId = scorerAccount.identity.actorId;
  e.scoring.configureTournamentAuthorization({
    tournamentId: 'seed', organizerId: 'org-demo', organizerIdentificationNumber: 'ORG90001',
    scorekeeperIds: ['scorer-demo', scorerId],
    scorekeeperIdentities: [
      { actorId: 'scorer-demo', identificationNumber: 'SCORER90001' },
      { actorId: scorerId, identificationNumber: scorerAccount.identity.identification },
    ],
  });
  const {
    SportingAccountGuard,
  } = require('../src/modules/live-scoring/sporting-account.guard');
  const { accountCookieName } = require('../src/modules/accounts/account-http');
  const guard = new SportingAccountGuard(e.accounts, e.scoring);
  const authorize = (account, body) =>
    guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/official-scoring/games/flow/official-updates',
          params: { gameId: body.gameId },
          query: {},
          body,
          headers: {
            origin: new URL(
              process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000',
            ).origin,
            ...(account
              ? { cookie: `${accountCookieName()}=${account.token}` }
              : {}),
          },
        }),
      }),
    });
  const doc = competition(e);
  doc.teams = doc.teams.map((team, index) => ({
    ...team,
    id: `inscription:${doc.id}:${index}`,
    name: 'Inscripción pendiente',
    managerId: '',
    managerIdentification: index === 0 ? 'V-12345678' : 'V-22345678',
    status: 'pending',
    enrollment: {
      status: 'invited',
      contact: '',
      notes: '',
      submittedAt: '',
      reviewNotes: '',
    },
  }));
  doc.phases[0].teamIds = doc.teams.map((team) => team.id);
  const state = venezuelaStates.find((row) => row.municipalities.length);
  const location = {
    stateId: state.id,
    municipalityId: state.municipalities[0].id,
  };
  doc.venues = [
    {
      id: 'fixture-stadium',
      name: 'Estadio ficticio del recorrido',
      ...location,
      address: '',
      mapUrl: '',
    },
  ];
  doc.fixtures[0] = {
    ...doc.fixtures[0],
    homeTeamId: doc.teams[0].id,
    awayTeamId: doc.teams[1].id,
    date: '2026-11-12',
    time: '10:00',
    venueId: 'fixture-stadium',
    scorekeeperIds: [scorerId],
  };
  e.service.change(e.owner.token, e.command(doc));
  assert.equal(e.service.publicList().tournaments.length, 0);
  const current = () =>
    e.service.list(e.owner.token, 'organizer', 'org-demo').tournaments[0];
  const registry = new RegistrationController(e.registry, e.scoring);
  const lineups = [];
  for (const [index, account] of [e.other, rival].entries()) {
    const assigned = e.service.managerList(account.token).tournaments;
    assert.equal(assigned.length, 1);
    const team = assigned[0];
    assert.equal(team.teamId, doc.teams[index].id);
    for (let player = 0; player < 9; player++)
      registry.preinscribe({
        managerId: team.managerId,
        tournamentId: doc.id,
        teamId: team.teamId,
        role: 'PLAYER',
        person: {
          identification: `V-${500001 + index * 100 + player}`,
          fullName: `Jugador Ficticio ${index} ${player}`,
          birthDate: '1995-02-03',
          email: `player-${index}-${player}@example.test`,
          phone: '',
          representativeIdentification: '',
        },
      });
    const roster = registry.getRoster(team.managerId, doc.id, team.teamId);
    assert.equal(roster.members.length, 9);
    bad(
      () =>
        e.service.assertParticipation(
          doc.id,
          '',
          team.teamId,
          roster.members.map((row) => row.person.id),
          'lineup',
        ),
      403,
    );
    e.service.managerChange(account.token, {
      requestId: randomUUID(),
      expectedAccountId: account.account.id,
      expectedRevision: current().revision,
      tournamentId: doc.id,
      teamId: team.teamId,
      action: 'submit',
      name: index === 0 ? 'Club Local Ficticio' : 'Club Visitante Ficticio',
      contact: '',
      notes: '',
    });
    const submitted = current();
    e.service.change(
      e.owner.token,
      e.command(submitted.document, {
        expectedRevision: submitted.revision,
        action: 'approve-roster',
        teamId: team.teamId,
      }),
    );
    lineups.push({
      tournamentId: doc.id,
      teamId: team.teamId,
      managerId: team.managerId,
      lineupEntries: roster.members.map((row, position) => ({
        identificationNumber: row.person.id,
        battingOrder: position + 1,
        fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][
          position
        ],
        jerseyNumber: String(position + 1),
      })),
    });
  }
  const approved = current();
  e.service.change(
    e.owner.token,
    e.command(approved.document, {
      expectedRevision: approved.revision,
      action: 'publish',
    }),
  );
  const gameId = e.scoring.plannedGameId(doc.id, 'opening');
  bad(
    () =>
      authorize(undefined, { tournamentId: doc.id, actorId: 'scorer-demo' }),
    401,
  );
  bad(
    () =>
      authorize(rival, {
        tournamentId: doc.id,
        managerId: lineups[0].managerId,
      }),
    403,
  );
  for (const [index, lineup] of lineups.entries()) {
    const games = e.scoring.listOfficialGames(
      lineup.managerId,
      'manager',
    ).games;
    assert.equal(games.length, 1);
    assert.equal(games[0].managerTeamId, lineup.teamId);
    const payload = { ...lineup, gameId };
    assert.equal(authorize([e.other, rival][index], payload), true);
    e.scoring.configureGameLineup(payload);
  }
  e.accounts.changeScorekeeperTournaments(scorerAccount, e.scoring.scorekeeperTournaments(scorerId), {
    expectedAccountId: scorerAccount.id, expectedRevision: 0, selected: [doc.id],
  });
  assert.equal(
    e.scoring.getTeamSheets(gameId, doc.id, scorerId, 'scorekeeper').sheets
      .length,
    2,
  );
  const get = () => e.scoring.getOfficialState(gameId, doc.id);
  const send = (scorecardCommand, operation = {}) => {
    const payload = {
      gameId,
      tournamentId: doc.id,
      actorId: scorerId,
      actorRole: 'scorekeeper',
      patch: {},
      expectedOfficialVersion: get().state.officialVersion,
      scorecardCommand,
      ...operation,
    };
    assert.equal(authorize(scorer, payload), true);
    return e.scoring.submitOfficialUpdate(payload);
  };
  bad(
    () =>
      e.scoring.submitOfficialUpdate({
        gameId,
        tournamentId: doc.id,
        actorId: lineups[0].managerId,
        actorRole: 'manager',
        patch: {},
        expectedOfficialVersion: get().state.officialVersion,
        scorecardCommand: { kind: 'play', result: 'homeRun' },
      }),
    403,
  );
  send({ kind: 'play', result: 'homeRun' });
  const scored = structuredClone(get());
  bad(
    () =>
      send({ kind: 'play', result: 'single' }, { expectedOfficialVersion: 0 }),
    409,
  );
  assert.deepEqual(
    get(),
    scored,
    'stale commands cannot change the recorded play',
  );
  send(undefined, { undoLast: true });
  assert.equal(get().state.awayScore, 0);
  send({ kind: 'play', result: 'homeRun' });
  send({ kind: 'finish' });
  const result = e.scoring
    .getOfficialStandings()
    .games.find((row) => row.gameId === gameId);
  assert.equal(result.status, 'final');
  assert.equal(result.awayScore, 1);
  assert.equal(result.homeScore, 0);
  assert.equal(officialGameResult(result).winnerTeamId, doc.teams[1].id);
  assert.equal(
    calendarOfficialGames([result], { date: '2026-11-12', ...location }).length,
    1,
  );
  const publicTournament = e.service.getPublic(doc.id);
  assert.deepEqual(publicTournament.officialFixtureIds, ['opening']);
  assert.doesNotMatch(
    JSON.stringify(publicTournament),
    /12345678|22345678|32345678/,
  );
  assert.doesNotMatch(JSON.stringify(publicTournament.document.teams), /person:/);
  const finished = structuredClone(get());
  bad(() => send({ kind: 'play', result: 'single' }), 409);
  assert.deepEqual(get(), finished);
  const saved = current();
  e.service.change(
    e.owner.token,
    e.command(saved.document, { expectedRevision: saved.revision }),
  );
  assert.deepEqual(
    get(),
    finished,
    'saving the tournament cannot rewrite the recorded result',
  );
});
test('verified production accounts own their tournaments and only assigned accounts can deliver lineups or score across restart', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-05T12:00:00Z') });
  const { demoProfileLocation } = require('@playsport/shared');
  const {
    RegistrationController,
  } = require('../src/modules/live-scoring/registration.controller');
  const {
    SportingAccountGuard,
  } = require('../src/modules/live-scoring/sporting-account.guard');
  const { accountCookieName } = require('../src/modules/accounts/account-http');
  const e = await setup(t, { durable: true });
  verifyManager(e);
  const organizer = {
    ...e.other,
    account: e.accounts.authenticate(e.other.token),
  };
  const roleAccounts = [];
  for (const [index, role] of [
    'scorekeeper',
    'home-manager',
    'away-manager',
  ].entries()) {
    const account = await e.accounts.register(
      {
        email: `${role}@example.test`,
        displayName: role,
        password: 'Una frase ficticia de prueba para cada rol 123456',
      },
      role,
    );
    verifyManager({ ...e, other: account }, `V-${22345678 + index * 10000000}`, role === 'scorekeeper' ? 'scorekeeper' : 'manager');
    roleAccounts.push({
      ...account,
      account: e.accounts.authenticate(account.token),
    });
  }
  const [scorer, home, away] = roleAccounts;
  const oldEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    PLAYSPORT_WEB_ORIGIN: process.env.PLAYSPORT_WEB_ORIGIN,
  };
  process.env.NODE_ENV = 'production';
  process.env.PLAYSPORT_WEB_ORIGIN = 'https://playsport.example';
  t.after(() => {
    for (const [key, value] of Object.entries(oldEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const actor = organizer.account.identity.actorId,
    scorerId = scorer.account.identity.actorId;
  const command = (record, patch = {}) => ({
    requestId: randomUUID(),
    expectedAccountId: organizer.account.id,
    expectedRevision: record?.revision ?? 0,
    role: 'organizer',
    actorId: actor,
    action: 'save',
    document: record?.document,
    teamId: '',
    ...patch,
  });
  const doc = {
    ...e.minimal(),
    leagueName: 'Liga de cuentas verificadas',
    teams: [home, away].map((account, index) => ({
      ...independentInscription(e).teams[0],
      id: `inscription:placeholder:${index}`,
      managerIdentification: account.account.identity.identification,
    })),
  };
  doc.teams = doc.teams.map((team, index) => ({
    ...team,
    id: `inscription:${doc.id}:${index}`,
  }));
  doc.phases = [
    {
      id: 'first',
      name: 'Inicial',
      kind: 'round-robin',
      status: 'draft',
      sourcePhaseId: '',
      teamIds: doc.teams.map((team) => team.id),
      groups: [],
      turns: 1,
      bestOf: 1,
      qualifiers: null,
      pairing: 'manual',
      rules: '',
    },
  ];
  doc.venues = [
    {
      id: 'stadium',
      name: 'Estadio ficticio',
      ...demoProfileLocation,
      address: '',
      mapUrl: '',
    },
  ];
  doc.fixtures = [
    {
      ...newTournamentFixture('opening', 'first'),
      homeTeamId: doc.teams[0].id,
      awayTeamId: doc.teams[1].id,
      date: '2026-11-15',
      time: '10:00',
      venueId: 'stadium',
      scorekeeperIds: [scorer.account.identity.identification],
    },
  ];
  e.service.change(organizer.token, command(null, { document: doc }));
  const current = () =>
    e.service.list(organizer.token, 'organizer', actor).tournaments[0];
  assert.equal(current().document.fixtures[0].scorekeeperIds[0], scorerId);
  bad(() => e.service.list(home.token, 'organizer', actor), 403);
  bad(() => e.service.list(e.owner.token, 'organizer', 'org-demo'), 403);
  const registry = new RegistrationController(e.registry, e.scoring);
  const lineups = [];
  for (const [index, account] of [home, away].entries()) {
    const entry = e.service.managerList(account.token).tournaments[0];
    for (let player = 0; player < 9; player++)
      registry.preinscribe({
        managerId: entry.managerId,
        tournamentId: doc.id,
        teamId: entry.teamId,
        role: 'PLAYER',
        person: {
          identification: `V-${600001 + index * 100 + player}`,
          fullName: `Jugador Ficticio ${index} ${player}`,
          birthDate: '1995-02-03',
          email: `real-flow-${index}-${player}@example.test`,
          phone: '',
          representativeIdentification: '',
        },
      });
    e.service.managerChange(account.token, {
      requestId: randomUUID(),
      expectedAccountId: account.account.id,
      expectedRevision: current().revision,
      tournamentId: doc.id,
      teamId: entry.teamId,
      action: 'submit',
      name: `Club Ficticio ${index}`,
      contact: '',
      notes: '',
    });
    e.service.change(
      organizer.token,
      command(current(), { action: 'approve-roster', teamId: entry.teamId }),
    );
    lineups.push({
      tournamentId: doc.id,
      teamId: entry.teamId,
      managerId: entry.managerId,
      lineupEntries: registry
        .getRoster(entry.managerId, doc.id, entry.teamId)
        .members.map((row, position) => ({
          identificationNumber: row.person.id,
          battingOrder: position + 1,
          fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][
            position
          ],
          jerseyNumber: String(position + 1),
        })),
    });
  }
  e.service.change(organizer.token, command(current(), { action: 'publish' }));
  const openingGameId = e.scoring.plannedGameId(doc.id, 'opening');
  assert.equal(e.scoring.organizerGameOperationAllowed(doc.id, openingGameId), false);
  const reservation = { expectedAccountId: organizer.account.id, expectedRevision: 0, requestId: randomUUID(), tournamentId: doc.id };
  const reserved = e.service.reserveFree(organizer.token, reservation).capacity;
  assert.equal(reserved.free.consumedAt, null, 'publication does not consume the single free opportunity');
  assert.equal(e.scoring.organizerGameOperationAllowed(doc.id, openingGameId), true);
  assert.equal(e.scoring.organizerGameOperationAllowed(doc.id, 'forged-game'), false);
  assert.equal(e.service.capacity(organizer.token).free.consumedAt, null, 'catalog checks cannot consume the opportunity');
  bad(() => e.service.reserveFree(home.token, reservation), 409);
  bad(() => e.service.reserveFree(organizer.token, { ...reservation, consumedAt: '2026-11-05T12:00:00.000Z' }), 400);
  const gameId = e.scoring.plannedGameId(doc.id, 'opening');
  const authorization = (scorekeeperIds) =>
    e.scoring.configureGameAuthorization({
      gameId,
      tournamentId: doc.id,
      organizerId: actor,
      scorekeeperIds,
    });
  authorization([]);
  e.restart();
  assert.equal(
    e.scoring.listOfficialGames(scorerId, 'scorekeeper').games.length,
    0,
    'startup reconciliation cannot reinstate a revoked game assignment',
  );
  authorization([scorerId]);
  const authorized = (account, payload) =>
    new SportingAccountGuard(e.accounts, e.scoring).canActivate({
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          url: '/api/official-scoring/games/game/official-updates',
          params: {},
          query: {},
          body: payload,
          headers: {
            origin: 'https://playsport.example',
            ...(account
              ? { cookie: `${accountCookieName()}=${account.token}` }
              : {}),
          },
        }),
      }),
    });
  for (const [index, lineup] of lineups.entries()) {
    bad(() => authorized([away, home][index], lineup), 403);
    assert.equal(authorized([home, away][index], lineup), true);
    e.scoring.configureGameLineup({ ...lineup, gameId });
  }
  const get = () => structuredClone(e.scoring.getOfficialState(gameId, doc.id));
  const send = (scorecardCommand) => {
    const payload = {
      gameId,
      tournamentId: doc.id,
      actorId: scorerId,
      actorRole: 'scorekeeper',
      patch: {},
      expectedOfficialVersion: get().state.officialVersion,
      scorecardCommand,
    };
    bad(() => authorized(home, payload), 403);
    bad(() => authorized(undefined, payload), 401);
    assert.equal(authorized(scorer, payload), true);
    return e.scoring.submitOfficialUpdate(payload);
  };
  const freeBeforePlay = e.service.capacity(organizer.token).free;
  const stateBeforePlay = get();
  assert.equal(freeBeforePlay.consumedAt, null, 'lineups do not consume the opportunity');
  const save = t.mock.method(e.scoring.persistentStore, 'save', () => { throw new Error('Fallo de persistencia simulado'); });
  assert.throws(() => send({ kind: 'play', result: 'homeRun' }), /Fallo de persistencia/);
  save.mock.restore();
  assert.deepEqual(e.service.capacity(organizer.token).free, freeBeforePlay, 'a failed sporting commit cannot consume the free opportunity');
  assert.deepEqual(get(), stateBeforePlay, 'a failed commit restores the exact sporting state');
  send({ kind: 'play', result: 'homeRun' });
  e.scoring.suspendGame({gameId,tournamentId:doc.id,actorId:actor,actorRole:'organizer',
    expectedOfficialVersion:get().state.officialVersion,cause:'force-majeure',scoreHandling:'keep',reason:'Lluvia intensa'});
  assert.equal(e.scoring.games.get(gameId).suspensionArchives.length,1);
  assert.equal(e.scoring.games.get(gameId).suspensionArchives[0].state.awayScore,1);
  const restartCommand = { expectedAccountId: organizer.account.id, tournamentId: doc.id, gameId,
    expectedOfficialVersion: get().state.officialVersion, requestId: randomUUID(), reason: 'Lluvia intensa: prueba aislada de fuerza mayor' };
  const oldVersion = get().state.officialVersion;
  const oldPersonnelVersion = e.scoring.games.get(gameId).personnelVersion;
  const usedBeforeRestart = e.service.capacity(organizer.token);
  bad(() => e.service.restartGame(home.token, restartCommand), 409);
  const failRestart = t.mock.method(e.scoring.persistentStore, 'save', () => { throw new Error('Fallo al anular simulado'); });
  assert.throws(() => e.service.restartGame(organizer.token,restartCommand), /Fallo al anular/);
  failRestart.mock.restore();
  assert.equal(get().state.awayScore,1);
  assert.deepEqual(e.service.capacity(organizer.token),usedBeforeRestart);
  const restarted = e.service.restartGame(organizer.token,restartCommand);
  assert.equal(get().state.status,'scheduled');
  assert.equal(get().state.awayScore,0); assert.equal(get().state.homeScore,0);
  assert.ok(get().state.officialVersion>oldVersion,'old clients cannot restore cancelled commands');
  assert.ok(e.scoring.games.get(gameId).personnelVersion>oldPersonnelVersion,'old lineup snapshots cannot repopulate the cancelled attempt');
  assert.equal(e.scoring.games.get(gameId).scoringHistory.length,0);
  assert.equal(e.scoring.games.get(gameId).suspensionArchives.length,0);
  assert.equal(e.scoring.games.get(gameId).playByPlay.scorecardLog.length,0);
  assert.equal(e.service.capacity(organizer.token).tournaments.find(row=>row.tournamentId===doc.id).restarts.length,1);
  assert.deepEqual(e.service.capacity(organizer.token).free,usedBeforeRestart.free);
  assert.equal(restarted.replayed,false);
  assert.equal(e.service.restartGame(organizer.token,restartCommand).replayed,true);
  e.restart();
  assert.equal(get().state.awayScore,0);
  const postponed = e.service.document(doc.id);
  postponed.fixtures[0].date = '2026-11-06'; postponed.fixtures[0].time = '18:00';
  const revision = e.service.list(organizer.token,'organizer',actor).tournaments.find(row=>row.document.id===doc.id).revision;
  e.service.change(organizer.token,command({document:postponed,revision}));
  assert.equal(e.scoring.games.get(gameId).details.time,'18:00','a clean replacement can be rescheduled while preserving monotonic revisions');
  const changedOpponents = structuredClone(postponed);
  [changedOpponents.fixtures[0].homeTeamId,changedOpponents.fixtures[0].awayTeamId] =
    [changedOpponents.fixtures[0].awayTeamId,changedOpponents.fixtures[0].homeTeamId];
  bad(()=>e.service.change(organizer.token,command({document:changedOpponents,revision:revision+1})),409);
  for (const lineup of lineups) e.scoring.configureGameLineup({...lineup,gameId});
  send({kind:'play',result:'homeRun'});
  assert.equal(e.service.capacity(organizer.token).tournaments.find(row=>row.tournamentId===doc.id).played.length,1,'replacement uses the same game slot');
  const consumed = e.service.capacity(organizer.token);
  assert.ok(consumed.free.consumedAt);
  assert.equal(consumed.tournaments.find(row => row.tournamentId === doc.id).played.length, 1);
  const before = get();
  e.restart();
  assert.deepEqual(get(), before);
  assert.deepEqual(e.service.capacity(organizer.token).free, consumed.free, 'restart cannot restore the free opportunity');
  assert.equal(
    e.scoring.listOfficialGames(scorerId, 'scorekeeper').games[0].gameId,
    gameId,
  );
  send({ kind: 'finish' });
  bad(() => e.service.restartGame(organizer.token,{...restartCommand,requestId:randomUUID(),expectedOfficialVersion:get().state.officialVersion}),409);
  bad(() => e.service.reserveFree(organizer.token, { ...reservation, requestId: randomUUID(),
    expectedRevision: consumed.free.revision, tournamentId: null }), 403);
  const final = get();
  e.restart();
  assert.deepEqual(get(), final);
  assert.equal(e.scoring.getOfficialStandings().games[0].awayScore, 1);
  assert.doesNotMatch(
    JSON.stringify(e.service.getPublic(doc.id)),
    /12345678|22345678|32345678|42345678/,
  );
});
test('paid selection and administrative trial authorization are private HTTP commands with durable credits and irreversible closure', async t => {
  const e = await setup(t,{durable:true}), previousAdmin = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID;
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = e.owner.account.id;
  t.after(()=>{ if(previousAdmin===undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID=previousAdmin; });
  verifyManager(e,'V-12345678',null);
  const account=e.accounts.authenticate(e.other.token), actor=account.identity.actorId;
  const sample=structuredClone(require('@playsport/shared').organizerCapacityExamples[2]), id=randomUUID();
  const teams=sample.teams.map((team,index)=>({...team,id:`inscription:${id}:${index}`,managerIdentification:index?'V-87654321':'V-76543210',status:'pending',rosterStatus:'pending',
    enrollment:{status:'invited',contact:'',notes:'',submittedAt:'',reviewNotes:''}}));
  const document={...sample,id,teams,phases:sample.phases.map(phase=>({...phase,teamIds:teams.map(team=>team.id)})),
    fixtures:sample.fixtures.map(game=>({...game,homeTeamId:teams[0].id,awayTeamId:teams[1].id}))};
  const edit = (doc,expectedRevision=0)=>({...e.command(doc),expectedAccountId:account.id,actorId:actor,expectedRevision});
  e.service.change(e.other.token,edit(document));
  const { Module }=require('@nestjs/common'),{ NestFactory }=require('@nestjs/core');
  const { TournamentsController }=require('../src/modules/tournaments/tournaments.controller');
  const { accountCookieName }=require('../src/modules/accounts/account-http');
  class Fixture {}
  Module({controllers:[TournamentsController],providers:[{provide:TournamentsService,useValue:{
    selectPlan:(...args)=>e.service.selectPlan(...args),authorizePlan:(...args)=>e.service.authorizePlan(...args),
    adminCapacity:(...args)=>e.service.adminCapacity(...args),restartGame:(...args)=>e.service.restartGame(...args),
  }}]})(Fixture);
  const app=await NestFactory.create(Fixture,{logger:false}); app.setGlobalPrefix('api');
  try {
    await app.listen(0,'127.0.0.1');
    const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/tournaments`;
    const request=(route,body,token=e.other.token,extra={})=>fetch(base+route,{method:body===undefined?'GET':'POST',
      headers:{origin:'http://localhost:3000','content-type':'application/json',...(token?{cookie:`${accountCookieName()}=${token}`} : {}),...extra},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const selection={expectedAccountId:account.id,tournamentId:id,expectedRevision:0,requestId:randomUUID(),selection:{planId:'small',teams:null,games:null}};
    for(const route of ['/plan-selection','/plan-authorization','/restart-game']) {
      assert.equal((await request(route,{},null)).status,401);
      assert.equal((await request(route+'?accountId=other',{})).status,400);
      assert.equal((await request(route,{},e.other.token,{origin:'https://unrelated.example'})).status,403);
    }
    assert.equal((await request('/plan-selection',selection,e.owner.token)).status,403);
    const chosen=await request('/plan-selection',selection);
    assert.equal(chosen.status,200); assert.equal(chosen.headers.get('cache-control'),'private, no-store');
    assert.equal((await chosen.json()).capacity.free.consumedAt,null);
    assert.equal(e.scoring.organizerCapacity.allows(account.id,document,`plan:${id}:${document.fixtures[0].id}`),false);
    assert.equal((await request('/admin-capacity?tournamentId='+id)).status,403);
    assert.equal((await request('/admin-capacity?tournamentId='+id+'&tournamentId='+id,undefined,e.owner.token)).status,400);
    const lookup=await request('/admin-capacity?tournamentId='+id,undefined,e.owner.token);
    assert.equal(lookup.status,200); assert.equal((await lookup.json()).plan.status,'pending-pricing');
    const grant={expectedAdminId:e.owner.account.id,tournamentId:id,expectedRevision:1,requestId:randomUUID(),action:'authorize-test',reason:'Prueba aislada'};
    assert.equal((await request('/plan-authorization',grant)).status,403);
    assert.equal((await request('/plan-authorization',{...grant,expectedRevision:0},e.owner.token)).status,409);
    assert.equal((await request('/plan-authorization',grant,e.owner.token)).status,200);
    assert.equal((await (await request('/plan-authorization',grant,e.owner.token)).json()).replayed,true);
    e.restart();
    assert.equal(e.scoring.organizerPlan(id).authorizedGames,40);
    assert.equal(e.scoring.organizerCapacity.allows(account.id,document,`plan:${id}:${document.fixtures[0].id}`),true);
    const expansion={...selection,requestId:randomUUID(),expectedRevision:2,selection:{planId:'custom',teams:8,games:48}};
    e.service.selectPlan(e.other.token,expansion);
    const quote=require('@playsport/shared').organizerPlanQuote(document,expansion.selection,e.scoring.organizerPlan(id));
    assert.equal(quote.activationUnits,0); assert.equal(quote.additionalGames,8); assert.equal(quote.amount,null);
    bad(()=>e.service.selectPlan(e.other.token,{...expansion,requestId:randomUUID(),expectedRevision:2}),409);
    e.service.authorizePlan(e.owner.token,{...grant,requestId:randomUUID(),expectedRevision:3,action:'revoke-test'});
    e.service.selectPlan(e.other.token,{...expansion,requestId:randomUUID(),expectedRevision:4});
    assert.equal(e.scoring.organizerPlan(id).status,'revoked-test');
    assert.equal(e.scoring.organizerCapacity.allows(account.id,document,`plan:${id}:${document.fixtures[0].id}`),false);
    const closed={...e.service.document(id),status:'finished'};
    e.service.change(e.other.token,edit(closed,1));
    bad(()=>e.service.change(e.other.token,edit({...closed,status:'draft'},2)),409);
    bad(()=>e.service.selectPlan(e.other.token,{...expansion,requestId:randomUUID(),expectedRevision:5}),409);
    assert.equal(e.service.capacity(e.other.token).free.consumedAt,null);
  } finally { await app.close(); }
});
test('same name and manager in different tournaments keep separate inscriptions, rosters and scoped logos', async (t) => {
  const e = await setup(t);
  verifyManager(e);
  const a = e.service.change(
    e.owner.token,
    e.command(independentInscription(e)),
  ).record;
  const b = e.service.change(
    e.owner.token,
    e.command(independentInscription(e)),
  ).record;
  e.accounts.changeTrial(e.owner.token, { requestId: randomUUID(), expectedAdminId: e.owner.account.id,
    accountId: e.other.account.id, planId: 'manager-numbers', expectedRevision: 0, action: 'grant',
    reason: 'Dos inscripciones de prueba', expiresAt: new Date(Date.now() + 60000).toISOString() });
  e.service.managerChange(e.other.token, managerCommand(e, a));
  e.service.managerChange(e.other.token, managerCommand(e, b));
  const assigned = e.service.managerList(e.other.token).tournaments;
  assert.equal(assigned.length, 2);
  assert.equal(assigned[0].teamName, assigned[1].teamName);
  assert.notEqual(assigned[0].teamId, assigned[1].teamId);
  const {
    InstitutionalLogosService,
  } = require('../src/modules/institutional-logos/institutional-logos.service');
  const logos = new InstitutionalLogosService(e.accounts, e.scoring, {
    path: join(e.dir, 'logos.sqlite'),
  });
  t.after(() => logos.onModuleDestroy());
  const actorId = assigned[0].managerId,
    logo = {
      requestId: randomUUID(),
      expectedAccountId: e.other.account.id,
      expectedRevision: 0,
      role: 'manager',
      actorId,
      kind: 'team',
      id: a.document.teams[0].id,
      logo: identityPhoto,
    };
  logos.change(e.other.token, logo);
  assert.equal(
    logos.list().some((row) => row.id === logo.id),
    false,
  );
  assert.equal(
    logos
      .manageable(e.other.token, 'manager', actorId)
      .entities.find((row) => row.id === logo.id).hasLogo,
    true,
  );
  assert.equal(
    logos
      .manageable(e.other.token, 'manager', actorId)
      .entities.find((row) => row.id === b.document.teams[0].id).hasLogo,
    false,
  );
  bad(
    () =>
      logos.change(e.owner.token, {
        ...logo,
        expectedAccountId: e.owner.account.id,
        role: 'organizer',
        actorId: 'org-demo',
      }),
    403,
  );
  bad(() => logos.readImage('team', logo.id, 1), 404);
  assert.equal(
    logos.readImage('team', logo.id, 1, e.other.token).type,
    'image/jpeg',
  );
});
test('transport checks bind the opaque manager identity to the authenticated account and reject hybrid impersonation', async (t) => {
  const e = await setup(t);
  verifyManager(e);
  const record = e.service.change(
    e.owner.token,
    e.command(independentInscription(e)),
  ).record;
  const team = e.service.managerList(e.other.token).tournaments[0];
  const {
    SportingAccountGuard,
  } = require('../src/modules/live-scoring/sporting-account.guard');
  const guard = new SportingAccountGuard(e.accounts, e.scoring);
  const request = {
    params: {},
    query: {
      managerId: team.managerId,
      tournamentId: record.document.id,
      teamId: team.teamId,
    },
    headers: { cookie: `playsport-account=${e.other.token}` },
    method: 'GET',
    url: '/api/registration/roster/members',
  };
  const call = (req) =>
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
  assert.equal(call(request), true);
  bad(() => call({ ...request, headers: {} }), 401);
  bad(
    () =>
      call({
        ...request,
        headers: { cookie: `playsport-account=${e.owner.token}` },
      }),
    403,
  );
  bad(
    () =>
      call({
        ...request,
        method: 'POST',
        headers: { ...request.headers, origin: 'http://localhost:3000' },
        body: {
          managerId: team.managerId,
          organizerId: 'org-demo',
          tournamentId: record.document.id,
        },
      }),
    403,
  );
});
function competition(e) {
  const doc = e.minimal();
  doc.teams = ['home', 'away'].map((side) => ({
    id: `club-${side}`,
    name: `Club ${side}`,
    managerId: `mgr-${side}`,
    managerIdentification: `MANAGER${side}`,
    status: 'accepted',
    rosterStatus: 'pending',
    rosterSignature: '',
    blocked: false,
    blockReason: '',
    blockScopes: [],
    withdrawalReason: '',
  }));
  doc.phases = [
    {
      id: 'first',
      name: 'Primera fase',
      kind: 'round-robin',
      status: 'draft',
      sourcePhaseId: '',
      teamIds: doc.teams.map((t) => t.id),
      groups: [],
      turns: 1,
      bestOf: 1,
      qualifiers: null,
      pairing: 'seeded',
      rules: '',
    },
  ];
  doc.fixtures = [
    {
      ...newTournamentFixture('opening', 'first'),
      homeTeamId: 'club-home',
      awayTeamId: 'club-away',
      scorekeeperIds: ['scorer-demo'],
    },
  ];
  return doc;
}
test('authenticated organizer owns persistent drafts; role aliases and another account cannot grant access', async (t) => {
  const e = await setup(t),
    doc = e.minimal();
  bad(() => e.service.change(undefined, e.command(doc)), 401);
  bad(
    () =>
      e.service.change(
        e.other.token,
        e.command(doc, { expectedAccountId: e.other.account.id }),
      ),
    403,
  );
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(doc, { role: 'manager', actorId: 'mgr-home' }),
      ),
    400,
  );
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(doc, { expectedAccountId: e.other.account.id }),
      ),
    409,
  );
  const saved = e.service.change(e.owner.token, e.command(doc));
  assert.equal(saved.record.revision, 1);
  assert.equal(saved.record.public, false);
  assert.equal(
    e.service.list(e.owner.token, 'organizer', 'org-demo').tournaments.length,
    1,
  );
  assert.equal(e.service.publicList().tournaments.length, 0);
  bad(() => e.service.getPublic(doc.id), 404);
  e.restart();
  assert.equal(
    e.service.list(e.owner.token, 'organizer', 'org-demo').tournaments[0]
      .document.name,
    doc.name,
  );
});
test('nonce replay after restart never duplicates; stale revisions and changed replay payloads never overwrite', async (t) => {
  const e = await setup(t),
    doc = e.minimal(),
    cmd = e.command(doc);
  e.service.change(e.owner.token, cmd);
  e.restart();
  assert.equal(e.service.change(e.owner.token, cmd).replayed, true);
  bad(
    () =>
      e.service.change(e.owner.token, {
        ...cmd,
        document: { ...doc, name: 'Different' },
      }),
    409,
  );
  bad(
    () => e.service.change(e.owner.token, e.command({ ...doc, name: 'Stale' })),
    409,
  );
  const next = e.service.change(
    e.owner.token,
    e.command({ ...doc, leagueName: 'Liga ficticia' }, { expectedRevision: 1 }),
  );
  assert.equal(next.record.revision, 2);
  assert.equal(
    e.service.history(e.owner.token, 'organizer', 'org-demo', doc.id).events
      .length,
    2,
  );
  assert.equal(e.service.change(e.owner.token, cmd).record.revision, 2);
});
test('publication connects canonical team identities, manager rosters and pending games without inventing schedules', async (t) => {
  const e = await setup(t),
    doc = competition(e);
  e.service.change(e.owner.token, e.command(doc, { action: 'publish' }));
  const gameId = e.scoring.plannedGameId(doc.id, 'opening');
  const games = e.scoring.listOfficialGames('org-demo', 'organizer');
  assert.ok(
    games.games.some((game) => game.gameId === gameId && game.details === null),
  );
  assert.deepEqual(e.service.getPublic(doc.id).officialFixtureIds, []);
  const team = e.scoring
    .listManagerRosterTeams('mgr-home')
    .find((team) => team.tournamentId === doc.id);
  assert.equal(team.teamName, 'Club home');
  assert.equal(team.tournamentName, doc.name);
  assert.ok(
    e.scoring
      .institutionalIdentities()
      .some(
        (row) =>
          row.kind === 'team' &&
          row.id === 'club-home' &&
          row.name === 'Club home',
      ),
  );
  const before = structuredClone(e.scoring.getOfficialState(gameId, doc.id));
  const next = {
    ...e.service.document(doc.id),
    phases: [
      ...doc.phases,
      {
        ...doc.phases[0],
        id: 'final',
        name: 'Final',
        sourcePhaseId: 'first',
        teamIds: [],
      },
    ],
  };
  e.service.change(e.owner.token, e.command(next, { expectedRevision: 1 }));
  assert.deepEqual(e.scoring.getOfficialState(gameId, doc.id), before);
  e.restart();
  assert.equal(
    e.scoring.listManagerRosterTeams('mgr-home')[0].tournamentId,
    doc.id,
  );
  assert.equal(
    e.scoring.getOfficialState(gameId, doc.id).state.status,
    'scheduled',
  );
});
test('projection failure after a committed replay preserves the original error and remains retryable', async (t) => {
  const e = await setup(t),
    cmd = e.command(e.minimal());
  e.service.change(e.owner.token, cmd);
  const original = e.scoring.projectPlannedTournament;
  const failure = new Error('Projection temporarily unavailable');
  e.scoring.projectPlannedTournament = () => {
    throw failure;
  };
  assert.throws(
    () => e.service.change(e.owner.token, cmd),
    (error) => error === failure,
  );
  e.scoring.projectPlannedTournament = original;
  assert.equal(e.service.change(e.owner.token, cmd).replayed, true);
  assert.equal(
    e.service.history(e.owner.token, 'organizer', 'org-demo', cmd.document.id)
      .events.length,
    1,
  );
});
test('published plans reserve actual durations across tournaments even while venues and official details are pending', async (t) => {
  const e = await setup(t),
    first = competition(e),
    second = competition(e);
  first.fixtures[0] = {
    ...first.fixtures[0],
    date: '2026-11-12',
    time: '10:00',
    durationMinutes: 180,
  };
  second.fixtures[0] = {
    ...second.fixtures[0],
    date: '2026-11-12',
    time: '12:00',
    durationMinutes: 60,
  };
  e.service.change(e.owner.token, e.command(first, { action: 'publish' }));
  bad(
    () =>
      e.service.change(e.owner.token, e.command(second, { action: 'publish' })),
    409,
  );
  second.fixtures[0].time = '13:00';
  assert.doesNotThrow(() =>
    e.service.change(e.owner.token, e.command(second, { action: 'publish' })),
  );
});
test('real player sanctions block lineup and game participation and unknown targets never persist', async (t) => {
  const e = await setup(t),
    doc = competition(e);
  e.service.change(e.owner.token, e.command(doc, { action: 'publish' }));
  const sanctioned = e.service.document(doc.id);
  sanctioned.sanctions = [
    {
      id: 'sanction',
      target: 'player',
      targetId: 'UNKNOWN',
      reason: 'Decisión privada',
      phaseId: 'first',
      from: '',
      until: '',
      gamesRemaining: 1,
      active: true,
    },
  ];
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(sanctioned, { expectedRevision: 1 }),
      ),
    409,
  );
  assert.equal(e.service.document(doc.id).sanctions.length, 0);
  e.scoring.registerGlobalPlayer({
    actorId: 'org-demo',
    player: {
      identificationNumber: 'PLAYER1',
      displayName: 'Jugador ficticio',
    },
  });
  e.scoring.configureTournamentTeamRoster({
    tournamentId: doc.id,
    organizerId: 'org-demo',
    teamId: 'club-home',
    managerId: 'mgr-home',
    playerIdentificationNumbers: ['PLAYER1'],
  });
  e.service.change(
    e.owner.token,
    e.command(e.service.document(doc.id), {
      action: 'approve-roster',
      teamId: 'club-home',
      expectedRevision: 1,
    }),
  );
  sanctioned.sanctions[0].targetId = 'PLAYER1';
  e.service.change(
    e.owner.token,
    e.command(sanctioned, { expectedRevision: 2 }),
  );
  const gameId = e.scoring.plannedGameId(doc.id, 'opening');
  for (const kind of ['lineup', 'play'])
    bad(
      () =>
        e.service.assertParticipation(
          doc.id,
          gameId,
          'club-home',
          ['PLAYER1'],
          kind,
        ),
      403,
    );
  const lifted = e.service.document(doc.id);
  lifted.sanctions[0].active = false;
  e.service.change(e.owner.token, e.command(lifted, { expectedRevision: 3 }));
  assert.doesNotThrow(() =>
    e.service.assertParticipation(
      doc.id,
      gameId,
      'club-home',
      ['PLAYER1'],
      'play',
    ),
  );
  lifted.sanctions[0] = {
    ...lifted.sanctions[0],
    active: true,
    target: 'team',
    targetId: 'club-home',
  };
  e.service.change(e.owner.token, e.command(lifted, { expectedRevision: 4 }));
  assert.match(
    e.scoring.getGamePermissions({
      gameId,
      tournamentId: doc.id,
      userId: 'org-demo',
      role: 'organizer',
    }).scoringBlockReason,
    /sanción/,
  );
  assert.deepEqual(e.service.getPublic(doc.id).document.sanctions, []);
});
test('tournament controller rejects duplicate/unknown queries and foreign mutation origins', async (t) => {
  const e = await setup(t);
  const {
    TournamentsController,
  } = require('../src/modules/tournaments/tournaments.controller');
  const controller = new TournamentsController(e.service),
    response = { setHeader() {} };
  bad(
    () =>
      controller.list(
        { role: ['organizer', 'fan'] },
        { headers: {} },
        response,
      ),
    400,
  );
  bad(() => controller.publicList({ owner: 'forged' }, response), 400);
  bad(
    () =>
      controller.change(
        e.command(e.minimal()),
        {},
        {
          headers: {
            origin: 'https://foreign.example',
            host: 'localhost:4000',
          },
        },
        response,
      ),
    403,
  );
  bad(
    () =>
      controller.list(
        { role: 'organizer', actorId: 'org-demo' },
        { headers: {} },
        response,
      ),
    401,
  );
});
test('HTTP JSON parser admits valid plans above 100 KiB and rejects requests beyond 1 MiB', async (t) => {
  const e = await setup(t);
  const { Module } = require('@nestjs/common'),
    { NestFactory } = require('@nestjs/core');
  const {
    TournamentsController,
  } = require('../src/modules/tournaments/tournaments.controller');
  const { accountCookieName } = require('../src/modules/accounts/account-http');
  class Fixture {}
  Module({
    controllers: [TournamentsController],
    providers: [
      {
        provide: TournamentsService,
        useValue: { change: (token, body) => e.service.change(token, body) },
      },
    ],
  })(Fixture);
  const app = await NestFactory.create(Fixture, { logger: false });
  app.useBodyParser('json', { limit: 1024 * 1024 });
  app.setGlobalPrefix('api');
  try {
    await app.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${app.getHttpServer().address().port}/api/tournaments`;
    const doc = e.minimal();
    doc.rules = 'R'.repeat(30000);
    doc.notices = Array.from({ length: 10 }, (_, i) => ({
      id: `notice-${i}`,
      title: `Aviso ${i}`,
      text: 'N'.repeat(10000),
      public: false,
    }));
    const body = JSON.stringify(e.command(doc));
    assert.ok(Buffer.byteLength(body) > 100 * 1024);
    const headers = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: `${accountCookieName()}=${e.owner.token}`,
    };
    assert.equal(
      (await fetch(url, { method: 'POST', headers, body })).status,
      200,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ padding: 'X'.repeat(1024 * 1024) }),
        })
      ).status,
      413,
    );
  } finally {
    await app.close();
  }
});
test('roster approval checks actual current people, blocks lineup until approved, and invalidates on later additions', async (t) => {
  const e = await setup(t),
    doc = competition(e);
  e.service.change(e.owner.token, e.command(doc, { action: 'publish' }));
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(e.service.document(doc.id), {
          action: 'approve-roster',
          teamId: 'club-home',
          expectedRevision: 1,
        }),
      ),
    409,
  );
  const players = Array.from({ length: 10 }, (_, i) => `HOME${i}`);
  for (const id of players)
    e.scoring.registerGlobalPlayer({
      actorId: 'org-demo',
      player: { identificationNumber: id, displayName: `Jugador ${id}` },
    });
  e.scoring.configureTournamentTeamRoster({
    tournamentId: doc.id,
    organizerId: 'org-demo',
    teamId: 'club-home',
    managerId: 'mgr-home',
    playerIdentificationNumbers: players.slice(0, 9),
  });
  const gameId = e.scoring.plannedGameId(doc.id, 'opening');
  const deliver = () =>
    e.scoring.configureGameLineup({
      gameId,
      tournamentId: doc.id,
      teamId: 'club-home',
      managerId: 'mgr-home',
      lineupEntries: players.slice(0, 9).map((identificationNumber, i) => ({
        identificationNumber,
        battingOrder: i + 1,
        fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i],
      })),
    });
  bad(deliver, 403);
  e.service.change(
    e.owner.token,
    e.command(e.service.document(doc.id), {
      action: 'approve-roster',
      teamId: 'club-home',
      expectedRevision: 1,
    }),
  );
  assert.doesNotThrow(deliver);
  const changed = e.service.document(doc.id);
  changed.fixtures[0].time = '12:00';
  changed.fixtures[0].date = '2026-11-12';
  bad(
    () =>
      e.service.change(
        e.owner.token,
        e.command(changed, { expectedRevision: 2 }),
      ),
    409,
  );
  e.scoring.configureTournamentTeamRoster({
    tournamentId: doc.id,
    organizerId: 'org-demo',
    teamId: 'club-home',
    managerId: 'mgr-home',
    playerIdentificationNumbers: players,
  });
  bad(deliver, 403);
});
test('withdrawals, unpaid blocks and player sanctions are enforced without awarding losses or leaking private reasons', async (t) => {
  const e = await setup(t),
    doc = competition(e);
  doc.teams[0].blocked = true;
  doc.teams[0].blockReason = 'PRIVATE PAYMENT NOTE';
  doc.teams[0].blockScopes = ['participation'];
  doc.notices = [
    {
      id: 'private',
      title: 'Private',
      text: 'PRIVATE ANNOUNCEMENT',
      public: false,
    },
    { id: 'public', title: 'Aviso', text: 'Público', public: true },
  ];
  e.service.change(e.owner.token, e.command(doc, { action: 'publish' }));
  bad(
    () => e.service.assertParticipation(doc.id, '', 'club-home', [], 'lineup'),
    403,
  );
  const publicDoc = e.service.getPublic(doc.id).document;
  assert.doesNotMatch(JSON.stringify(publicDoc), /PRIVATE|MANAGERhome/);
  assert.equal(publicDoc.notices.length, 1);
  assert.doesNotThrow(() => readTournament(publicDoc));
  const next = e.service.document(doc.id);
  next.teams[0].blocked = false;
  next.teams[0].status = 'withdrawn';
  next.teams[0].withdrawalReason = 'PRIVATE WITHDRAWAL NOTE';
  e.service.change(e.owner.token, e.command(next, { expectedRevision: 1 }));
  assert.doesNotThrow(() =>
    readTournament(e.service.getPublic(doc.id).document),
  );
  assert.doesNotMatch(JSON.stringify(e.service.getPublic(doc.id)), /PRIVATE/);
  const game = e.scoring.getOfficialState(
    e.scoring.plannedGameId(doc.id, 'opening'),
    doc.id,
  );
  assert.equal(game.state.status, 'scheduled');
  assert.equal(game.state.homeScore, 0);
  assert.equal(game.state.awayScore, 0);
});
