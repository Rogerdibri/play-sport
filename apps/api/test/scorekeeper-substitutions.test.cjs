const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { ScorekeeperAccessController } = require('../src/modules/live-scoring/scorekeeper-access.controller');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const { SportingAccountGuard } = require('../src/modules/live-scoring/sporting-account.guard');
const { readOfficialGames, readScorekeeperAccess, readScorekeeperSubstitutions } = require('@playsport/shared');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'playsport-substitution-'));
  const accounts = new AccountsService({ path: join(directory, 'accounts.sqlite') });
  let scoring = new OfficialScoringService(undefined, { path: join(directory, 'official.sqlite') });
  const beforeAdmin = process.env.PLAYSPORT_ADMIN_ACCOUNT_ID, beforeReviewer = process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  t.after(() => {
    accounts.onModuleDestroy(); scoring.onModuleDestroy(); rmSync(directory, { recursive: true, force: true });
    if (beforeAdmin === undefined) delete process.env.PLAYSPORT_ADMIN_ACCOUNT_ID; else process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = beforeAdmin;
    if (beforeReviewer === undefined) delete process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID; else process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = beforeReviewer;
  });
  const admin = await accounts.register({ email: 'admin@example.test', displayName: 'Administrador', password: 'Frase de prueba 123456789' }, 'admin');
  process.env.PLAYSPORT_ADMIN_ACCOUNT_ID = admin.account.id;
  process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID = admin.account.id;
  const people = {};
  const photo = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,1,2,3,4,5,6,7,8,9,255,217]).toString('base64');
  for (const [index, name] of ['organizer', 'primary', 'substitute', 'unverified'].entries()) {
    const person = await accounts.register({ email: `${name}@example.test`, displayName: `${name} del Lago`, password: 'Frase de prueba 123456789' }, name);
    if (name !== 'unverified') {
      accounts.submitIdentity(person.token, { expectedAccountId: person.account.id, expectedRevision: 0, requestId: randomUUID(),
        identification: `V-${99300101 + index}`, fullName: `${name} del Lago`, birthDate: '1990-01-02', documentPhoto: photo, personalPhoto: photo, consent: true });
      accounts.reviewIdentity(admin.token, { expectedAccountId: admin.account.id, accountId: person.account.id, expectedRevision: 1,
        decision: 'verified', reason: 'Prueba aislada', documentsMatch: true });
    }
    people[name] = { ...person, account: accounts.authenticate(person.token) };
  }
  const actor = name => people[name].account.identity.actorId, docs = new Map();
  for (const tournamentId of ['cup', 'other']) {
    docs.set(tournamentId, { id: tournamentId, name: `Copa ${tournamentId}`, sport: 'baseball', modality: 'Béisbol', category: 'Adultos', customRules: [],
      status: 'running', teams: [{ id: 'home', name: 'Local', status: 'accepted', rosterStatus: 'approved' }, { id: 'away', name: 'Visitante', status: 'accepted', rosterStatus: 'approved' }] });
    const primary = actor(tournamentId === 'cup' ? 'primary' : 'substitute');
    scoring.configureTournamentAuthorization({ tournamentId, organizerId: actor('organizer'), organizerIdentificationNumber: people.organizer.account.identity.identification,
      scorekeeperIds: [primary], scorekeeperIdentities: [{ actorId: primary, identificationNumber: people[tournamentId === 'cup' ? 'primary' : 'substitute'].account.identity.identification }] });
    for (const side of ['home', 'away']) {
      const ids = Array.from({ length: 9 }, (_, i) => `${side.toUpperCase()}${i}`);
      if (tournamentId === 'cup') ids.forEach((identificationNumber, i) => scoring.registerGlobalPlayer({ actorId: actor('organizer'),
        player: { identificationNumber, displayName: `${side} Jugador ${i + 1}` } }));
      scoring.configureTournamentTeamRoster({ tournamentId, organizerId: actor('organizer'), teamId: side, managerId: `manager-${side}`,
        managerIdentificationNumber: `MANAGER${side.toUpperCase()}`, playerIdentificationNumbers: ids });
    }
    for (const gameId of tournamentId === 'cup' ? ['a', 'b'] : ['c']) {
      scoring.configureGameTeams({ gameId, tournamentId, organizerId: actor('organizer'), homeTeamId: 'home', awayTeamId: 'away' });
      scoring.configureGameAuthorization({ gameId, tournamentId, organizerId: actor('organizer'), scorekeeperIds: [primary] });
      scoring.configureGameDetails({ gameId, tournamentId, organizerId: actor('organizer'), details: { tournamentName: `Copa ${tournamentId}`,
        homeTeamName: 'Local', awayTeamName: 'Visitante', date: '2026-11-24', time: gameId === 'a' ? '10:00' : '14:00', venue: 'Campo del Lago' } });
      for (const side of ['home', 'away']) scoring.configureGameLineup({ gameId, tournamentId, teamId: side, managerId: `manager-${side}`,
        lineupEntries: ['P','C','1B','2B','3B','SS','LF','CF','RF'].map((fieldPosition, i) => ({
          identificationNumber: `${side.toUpperCase()}${i}`, battingOrder: i + 1, fieldPosition, jerseyNumber: String(i + 1),
        })) });
    }
  }
  const planning = { document: id => docs.get(id), published: () => false, assertParticipation() {} };
  scoring.setTournamentPlanning(planning);
  const request = name => ({ headers: { cookie: `playsport-account=${people[name].token}`, origin: 'http://localhost:3000' } });
  const controller = () => new ScorekeeperAccessController(accounts, scoring);
  const change = (overrides = {}, name = 'organizer') => {
    const body = { expectedAccountId: people[name].account.id, tournamentId: 'cup', gameId: 'a', expectedRevision: 0,
      action: 'grant', identification: people.substitute.account.identity.identification, reason: 'Ausencia temporal del titular', ...overrides };
    if (body.action === 'revoke') delete body.identification;
    return controller().changeSubstitution(request(name), {}, body);
  };
  const grantPlan = (name, planId) => accounts.changeTrial(admin.token, { requestId: randomUUID(), expectedAdminId: admin.account.id,
    accountId: people[name].account.id, planId, expectedRevision: accounts.ownAccess(people[name].token).trials.find(row => row.planId === planId)?.revision ?? 0,
    action: 'grant', reason: 'Prueba aislada', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const send = (name, gameId, command) => scoring.submitOfficialUpdate({ tournamentId: gameId === 'c' ? 'other' : 'cup', gameId,
    actorId: actor(name), actorRole: 'scorekeeper', expectedOfficialVersion: scoring.getOfficialState(gameId, gameId === 'c' ? 'other' : 'cup').state.officialVersion,
    patch: {}, ...command });
  const finish = (name, gameId) => {
    for (const side of ['away', 'home']) for (const result of ['double', 'homeRun', 'walk', 'groundOut', 'strikeout', 'groundOut'])
      send(name, gameId, { scorecardCommand: { kind: 'play', result } });
    send(name, gameId, { scorecardCommand: { kind: 'finish' } });
  };
  return { accounts, people, actor, controller, request, change, grantPlan, send, finish, docs, get scoring() { return scoring; },
    reopen() { scoring.onModuleDestroy(); scoring = new OfficialScoringService(undefined, { path: join(directory, 'official.sqlite') }); scoring.setTournamentPlanning(planning); } };
}
test('only the organizer can grant free substitutions to an existing verified account by cedula, never by client-supplied permissions', async t => {
  const e = await fixture(t);
  bad(() => e.change({}, 'substitute'), 403);
  bad(() => e.change({ identification: 'V-99999999' }), 403);
  bad(() => e.change({ identification: 'person:forged' }), 400);
  bad(() => e.change({ identification: undefined, substituteActorId: e.actor('substitute') }), 400);
  bad(() => e.change({ price: 0 }), 400);
  bad(() => e.change({ gameId: 'c' }), 403);
  bad(() => e.controller().substitutions(e.request('unverified'), { tournamentId: 'cup', gameId: 'a' }), 403);
  const result = e.change();
  assert.equal(result.members[0].name, 'substitute del Lago');
  assert.doesNotMatch(JSON.stringify(result), /9930010|birthDate|email|identification/);
  assert.throws(() => readScorekeeperSubstitutions(result, 'foreign', 'cup', 'a'));
  bad(() => e.change(), 409);
});
test('a free substitute keeps its existing tournament cup and receives only the explicitly authorized matches across restart', async t => {
  const e = await fixture(t), account = e.accounts.authenticate(e.people.substitute.token);
  const before = e.accounts.scorekeeperAccess(account, e.scoring.scorekeeperTournaments(e.actor('substitute')));
  assert.equal(before.tournaments.length, 1); assert.equal(before.tournaments[0].tournamentId, 'other');
  bad(() => e.send('substitute', 'a', { scorecardCommand: { kind: 'pitch', value: 'ball' } }), 403);
  e.change();
  const access = readScorekeeperAccess(e.controller().access(e.request('substitute'), {}), account.id);
  assert.equal(access.level, 1); assert.equal(access.limit, 1); assert.deepEqual(access.tournaments, before.tournaments);
  assert.deepEqual(access.extras, []);
  assert.deepEqual(access.substitutions.map(row => row.gameId), ['a']);
  const catalog = readOfficialGames(e.controller().games(e.request('substitute'), {}), e.actor('substitute'), 'scorekeeper', false);
  assert.deepEqual(catalog.games.map(row => row.gameId).sort(), ['a', 'c']);
  bad(() => e.send('substitute', 'b', { scorecardCommand: { kind: 'pitch', value: 'ball' } }), 403);
  bad(() => e.scoring.scorekeeperStatistics(e.actor('substitute'), 'cup'), 403);
  e.change({ gameId: 'b' }); e.reopen();
  assert.deepEqual(e.scoring.scorekeeperSubstituteGames(e.actor('substitute')).map(row => row.gameId).sort(), ['a', 'b']);
  const event = e.send('substitute', 'a', { scorecardCommand: { kind: 'pitch', value: 'ball' } });
  assert.equal(event.state.updatedBy.id, e.actor('substitute'));
  bad(() => e.send('substitute', 'b', { scorecardCommand: { kind: 'pitch', value: 'ball' } }), 409);
});
test('primary levels two and three retain all tournament games; substitute levels never inherit the primary plan or tournament totals', async t => {
  const e = await fixture(t);
  e.grantPlan('primary', 'scorekeeper');
  e.change(); e.finish('substitute', 'a'); e.finish('primary', 'b');
  bad(() => e.controller().statistics(e.request('substitute'), { tournamentId: 'cup', gameId: 'a' }), 403);
  const full = e.controller().statistics(e.request('primary'), { tournamentId: 'cup' });
  assert.equal(full.totals.length, 18); assert.ok(full.totals.every(row => row.line.batting.G === 2));
  e.grantPlan('substitute', 'scorekeeper-numbers');
  const one = e.controller().statistics(e.request('substitute'), { tournamentId: 'cup', gameId: 'a' });
  assert.equal(one.players.length, 18); assert.ok(one.players.every(row => row.game.line.batting.G === 1)); assert.equal(one.totals.length, 0);
  bad(() => e.controller().statistics(e.request('substitute'), { tournamentId: 'cup', gameId: 'b' }), 403);
  e.grantPlan('substitute', 'scorekeeper');
  bad(() => e.controller().statistics(e.request('substitute'), { tournamentId: 'cup' }), 403);
  const report = new OfficialScoringController(e.scoring, e.accounts);
  assert.equal(report.gameReport('a', { tournamentId: 'cup', role: 'scorekeeper' }, e.request('substitute')).detailed, true);
  const unchanged = e.scoring.scorekeeperSubstitutions(e.actor('organizer'), 'cup', 'a');
  e.reopen();
  assert.deepEqual(e.scoring.scorekeeperSubstitutions(e.actor('organizer'), 'cup', 'a'), unchanged);
  const withoutInheritedPlan = new ScorekeeperAccessController({
    authenticate: () => ({ ...e.accounts.authenticate(e.people.primary.token), features: ['scorekeeper-box-score'] }),
    assertScorekeeperAccess: (...args) => e.accounts.assertScorekeeperAccess(...args), scorekeeperAccess: (...args) => e.accounts.scorekeeperAccess(...args),
  }, e.scoring);
  assert.equal(withoutInheritedPlan.statistics(e.request('primary'), { tournamentId: 'cup', gameId: 'a' }).players.length, 18);
  bad(() => withoutInheritedPlan.statistics(e.request('primary'), { tournamentId: 'cup' }), 403);
});
test('revocation closes contextual streams and rejects reads/writes; permissions and undo retain an append-only author audit', { timeout: 10000 }, async t => {
  const e = await fixture(t); e.change();
  e.send('substitute', 'a', { scorecardCommand: { kind: 'pitch', value: 'ball' } });
  e.send('primary', 'a', { undoLast: true });
  const req = { ...e.request('substitute'), method: 'GET', url: '/api/official-scoring/games/a/stream',
    params: { gameId: 'a' }, query: { tournamentId: 'cup', role: 'scorekeeper', userId: e.actor('substitute') } };
  const guard = new SportingAccountGuard(e.accounts, e.scoring);
  assert.equal(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
  const official = new OfficialScoringController(e.scoring, e.accounts);
  let updates = 0;
  const closed = new Promise((resolve, reject) => {
    const subscription = official.streamGame('a', 'cup', req).subscribe({ next: () => updates++, error: error => resolve(error.getStatus?.()) });
    t.after(() => subscription.unsubscribe());
    if (!updates) reject(new Error('El stream no emitió su snapshot.'));
  });
  const sheetClosed = new Promise(resolve => {
    const subscription = official.streamTeamSheets('a', 'cup', e.actor('substitute'), 'scorekeeper', req).subscribe({ error: error => resolve(error.getStatus?.()) });
    t.after(() => subscription.unsubscribe());
  });
  const initial = updates;
  const revoked = e.change({ expectedRevision: 1, action: 'revoke', identification: undefined, substituteActorId: e.actor('substitute') });
  assert.equal(await sheetClosed, 403);
  e.send('primary', 'a', { scorecardCommand: { kind: 'pitch', value: 'strike' } });
  assert.equal(await closed, 403); assert.equal(updates, initial);
  bad(() => e.send('substitute', 'a', { scorecardCommand: { kind: 'pitch', value: 'ball' } }), 403);
  assert.deepEqual(e.controller().access(e.request('substitute'), {}).substitutions, []);
  bad(() => guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), 403);
  const audit = e.scoring.scorekeeperSubstitutions(e.actor('organizer'), 'cup', 'a');
  assert.deepEqual(audit.movements.map(row => row.actorId), [e.actor('substitute'), e.actor('primary'), e.actor('primary')]);
  assert.equal(audit.movements[1].action, 'undo'); assert.equal(audit.audit.length, 2);
  assert.equal(revoked.members[0].status, 'revoked'); e.reopen();
  assert.deepEqual(e.scoring.scorekeeperSubstitutions(e.actor('organizer'), 'cup', 'a'), audit);
});
test('authorization rejects participant conflicts, closed tournaments and new permissions on completed games without deleting prior evidence', async t => {
  const e = await fixture(t);
  e.scoring.registerGlobalPlayer({ actorId: e.actor('organizer'), player: { identificationNumber: e.people.substitute.account.identity.identification, displayName: 'Participante' } });
  e.scoring.configureTournamentTeamRoster({ tournamentId: 'cup', organizerId: e.actor('organizer'), teamId: 'home', managerId: 'manager-home',
    managerIdentificationNumber: 'MANAGERHOME', playerIdentificationNumbers: [...Array.from({ length: 9 }, (_, i) => `HOME${i}`), e.people.substitute.account.identity.identification] });
  bad(() => e.change(), 409);
  e.docs.get('other').status = 'finished';
  bad(() => e.change({ tournamentId: 'other', gameId: 'c', identification: e.people.primary.account.identity.identification }), 409);
  e.finish('primary', 'a'); bad(() => e.change(), 409);
});
test('HTTP requires a verified organizer session, exact scope and same origin and never accepts automatic payment or target account impersonation', async t => {
  const e = await fixture(t);
  const facade = { authenticate: token => e.accounts.authenticate(token), verifiedPerson: id => e.accounts.verifiedPerson(id) };
  const scoringFacade = { scorekeeperSubstitutions: (...args) => e.scoring.scorekeeperSubstitutions(...args),
    changeScorekeeperSubstitution: (...args) => e.scoring.changeScorekeeperSubstitution(...args) };
  const app = await NestFactory.create({ module: class SubstitutionTestModule {}, controllers: [ScorekeeperAccessController],
    providers: [{ provide: AccountsService, useValue: facade }, { provide: OfficialScoringService, useValue: scoringFacade }] }, { logger: false });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/sports-sheet/scorekeeper-substitutions`;
  try {
    assert.equal((await fetch(`${base}?tournamentId=cup&gameId=a`)).status, 401);
    const headers = { Cookie: `playsport-account=${e.people.organizer.token}` };
    const get = await fetch(`${base}?tournamentId=cup&gameId=a`, { headers });
    assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'private, no-store');
    assert.equal((await fetch(`${base}?tournamentId=cup&tournamentId=other&gameId=a`, { headers })).status, 400);
    const body = { expectedAccountId: e.people.organizer.account.id, tournamentId: 'cup', gameId: 'a', expectedRevision: 0,
      action: 'grant', identification: e.people.substitute.account.identity.identification, reason: 'Suplencia gratuita' };
    assert.equal((await fetch(base, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
    const post = await fetch(base, { method: 'POST', headers: { ...headers, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(post.status, 201);
    const result = readScorekeeperSubstitutions(await post.json(), e.people.organizer.account.id, 'cup', 'a');
    assert.equal(result.members.length, 1);
  } finally { await app.close(); }
});
