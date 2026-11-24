const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { OfficialScoringService } = require('../src/modules/live-scoring/official-scoring.service');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { SportsSheetController } = require('../src/modules/live-scoring/sports-sheet.controller');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { aggregateStatistics, readStatisticsSnapshot, readCareerSnapshot, careerCounts, privateFieldingStats, readOfficialGames } = require('@playsport/shared');
const { OfficialScoringController } = require('../src/modules/live-scoring/official-scoring.controller');
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
function scoring(t, persistent = false) {
  const directory = persistent ? mkdtempSync(join(tmpdir(), 'playsport-statistics-')) : null;
  const path = directory ? join(directory, 'official.sqlite') : undefined;
  let service = new OfficialScoringService(undefined, path ? { path } : undefined);
  service.nowIso = () => '2026-11-17T02:00:00.000Z';
  t.after(() => { service.onModuleDestroy(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  const doc = { id: 'tour', name: 'Copa', leagueId: 'liga', leagueName: 'Liga', season: '2026',
    sport: 'baseball', modality: 'Béisbol', category: 'Adultos', customRules: [], location: {},
    teams: [{ id: 'home', name: 'Local', status: 'accepted', rosterStatus: 'approved' },
      { id: 'away', name: 'Visitante', status: 'accepted', rosterStatus: 'approved' }] };
  const planning = { document: () => doc, published: () => true, assertParticipation() {} };
  service.configureTournamentAuthorization({ tournamentId: 'tour', organizerId: 'org', organizerIdentificationNumber: 'ORG0001',
    scorekeeperIds: ['scorer'], scorekeeperIdentities: [{ actorId: 'scorer', identificationNumber: 'SCORER0001' }] });
  const entries = prefix => Array.from({ length: 9 }, (_, index) => ({
    identificationNumber: `${prefix}${index}`, battingOrder: index + 1,
    fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][index], jerseyNumber: String(index + 1),
  }));
  for (const [teamId, prefix] of [['home', 'HOME'], ['away', 'AWAY']]) {
    const ids = Array.from({ length: 10 }, (_, index) => `${prefix}${index}`);
    for (const identificationNumber of ids) service.registerGlobalPlayer({ actorId: 'org',
      player: { identificationNumber, displayName: 'Jugador homónimo' } });
    service.configureTournamentTeamRoster({ tournamentId: 'tour', organizerId: 'org', teamId, managerId: `mgr-${teamId}`,
      managerIdentificationNumber: `MANAGER${teamId}`, playerIdentificationNumbers: ids });
  }
  service.configureGameTeams({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', homeTeamId: 'home', awayTeamId: 'away' });
  service.configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: ['scorer'] });
  for (const [teamId, prefix] of [['home', 'HOME'], ['away', 'AWAY']]) service.configureGameLineup({
    gameId: 'game', tournamentId: 'tour', teamId, managerId: `mgr-${teamId}`, lineupEntries: entries(prefix),
    presentSubstituteIdentificationNumbers: [`${prefix}9`],
  });
  service.configureGameDetails({ gameId: 'game', tournamentId: 'tour', organizerId: 'org',
    details: { tournamentName: 'Copa', homeTeamName: 'Local', awayTeamName: 'Visitante', date: '2026-10-10', time: '10:00', venue: 'Campo' } });
  service.setTournamentPlanning(planning);
  const get = () => service.getOfficialState('game', 'tour');
  const send = payload => service.submitOfficialUpdate({ gameId: 'game', tournamentId: 'tour', actorId: 'scorer',
    actorRole: 'scorekeeper', expectedOfficialVersion: get().state.officialVersion, patch: {}, ...payload });
  const play = result => send({ scorecardCommand: { kind: 'play', result } });
  const inning = () => {
    for (let side = 0; side < 2; side++) { play('double'); play('homeRun'); play('walk'); play('sacrificeBunt'); play('strikeout'); play('groundOut'); }
  };
  return { service: () => service, doc, get, send, play, inning, rows: (person = 'AWAY0', mode = 'player') =>
    service.personalStatistics(person, 'mgr-away', mode), reopen() {
      service.onModuleDestroy(); service = new OfficialScoringService(undefined, { path });
      service.nowIso = () => '2026-11-17T02:00:00.000Z';
      service.setTournamentPlanning(planning); return service;
    } };
}
test('scorer projection isolates its tournament and includes both teams, historical participants and corrected versions without global profiles', t => {
  const e = scoring(t, true); e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const snapshot = e.service().scorekeeperStatistics('scorer', 'tour', 'game');
  assert.equal(snapshot.games.length, 2); assert.equal(snapshot.players.length, 18);
  assert.ok(snapshot.players.every(player => player.game.tournamentId === 'tour' && player.game.line.batting.G === 1));
  assert.doesNotMatch(JSON.stringify(snapshot), /AWAY0|HOME0|identificationNumber|representative/);
  bad(() => e.service().scorekeeperStatistics('foreign', 'tour'), 403);
  bad(() => e.service().scorekeeperStatistics('scorer', 'foreign'), 403);
  bad(() => e.service().scorekeeperStatistics('scorer', 'tour', 'foreign-game'), 403);
  assert.deepEqual(e.reopen().scorekeeperStatistics('scorer', 'tour', 'game'), snapshot);
  e.send({ undoLast: true });
  const corrected = e.service().scorekeeperStatistics('scorer', 'tour', 'game');
  assert.ok(corrected.players.every(player => player.game.qualification === 'provisional'));
  assert.notDeepEqual(corrected, snapshot);
  e.service().configureGameAuthorization({ gameId: 'game', tournamentId: 'tour', organizerId: 'org', scorekeeperIds: [] });
  assert.equal(e.service().listOfficialGames('scorer', 'scorekeeper').games.length, 0);
  const consultation = e.service().listOfficialGames('scorer', 'scorekeeper', true);
  assert.equal(consultation.games.length, 1); assert.equal(consultation.games[0].assignedScorekeeperIds.includes('scorer'), false);
  assert.throws(() => readOfficialGames(consultation, 'scorer', 'scorekeeper'));
  assert.equal(readOfficialGames(consultation, 'scorer', 'scorekeeper', false).games.length, 1);
  assert.equal(e.service().scorekeeperGameAssigned('scorer', 'tour', 'game'), false);
  assert.equal(e.service().scorekeeperStatistics('scorer', 'tour', 'game').players.length, 18);
  bad(() => e.play('single'), 403);
});
test('final report uses canonical AB, official PCL and persisted adjudications without mutating games', t => {
  const e = scoring(t, true); e.inning();
  const review = { confirmed: true, rulesReference: 'Liga de prueba', note: '', winner: null, loser: null, saver: null,
    bestBatter: 'away:1', mvp: 'away:1', pitching: {}, fielding: {} };
  e.send({ scorecardCommand: { kind: 'finish', review } });
  const before = structuredClone(e.get());
  const report = e.service().gameReport('game', 'tour', true);
  assert.equal(report.reviewed, true); assert.equal(report.teams.away.totals.batting.AB, 4);
  assert.equal(report.teams.away.totals.pitching.ERA, 18);
  assert.equal(report.teams.away.players.length, 9);
  assert.doesNotMatch(JSON.stringify(report), /AWAY0|HOME0|identificationNumber/);
  assert.deepEqual(e.get(), before);
  assert.deepEqual(e.reopen().gameReport('game', 'tour', true), report);
  e.doc.customRules = [{ name: 'Base del PCL', value: '7' }];
  assert.equal(e.service().gameReport('game', 'tour', true).teams.away.totals.pitching.ERA, 14);
  e.doc.customRules[0].value = '8'; bad(() => e.service().gameReport('game', 'tour', true), 409);
  e.doc.customRules = [];
  e.send({ undoLast: true });
  assert.equal(e.service().gameReport('game', 'tour', true).reviewed, false);
  bad(() => e.service().gameReport('missing', 'tour', false), 404);
});
test('final-report controller withholds individual tables unless the server authenticates the master', t => {
  const e = scoring(t); e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const accounts = { authenticate(token) {
    if (!['normal', 'master'].includes(token)) {
      const { UnauthorizedException } = require('@nestjs/common'); throw new UnauthorizedException();
    }
    return { localTestAccess: token === 'master' };
  } };
  const controller = new OfficialScoringController(e.service(), accounts);
  const request = token => ({ headers: token ? { cookie: `playsport-account=${token}` } : {} });
  assert.equal(controller.gameReport('game', { tournamentId: 'tour' }, request()).detailed, false);
  assert.equal(controller.gameReport('game', { tournamentId: 'tour' }, request('normal')).detailed, false);
  assert.equal(controller.gameReport('game', { tournamentId: 'tour' }, request('master')).teams.away.players.length, 9);
  bad(() => controller.gameReport('game', { tournamentId: 'tour', detailed: 'true' }, request()), 400);
  bad(() => controller.gameReport('game', { tournamentId: 'tour' }, request('invalid')), 401);
});
test('official source isolates identity, historical lineups and managers; raw personal IDs never reach its projection', t => {
  const e = scoring(t); e.inning();
  assert.equal(aggregateStatistics(e.rows()), null);
  e.send({ scorecardCommand: { kind: 'finish' } });
  const stateBeforeReading = structuredClone(e.get());
  const row = e.rows()[0];
  assert.equal(row.qualification, 'official'); assert.equal(row.line.batting.AB, 1); assert.equal(row.line.batting.H, 1);
  assert.equal(row.line.batting.doubles, 1); assert.equal(row.line.pitching.outs, 3); assert.equal(row.line.pitching.R, 2);
  assert.equal(row.line.pitching.ERA, 18);
  assert.deepEqual(e.rows('UNREGISTERED'), []);
  assert.deepEqual(e.service().personalStatistics(null, 'other-manager', 'team'), []);
  assert.equal(e.rows('AWAY9').length, 0, 'bench attendance does not count as playing');
  assert.equal(e.rows('AWAY1')[0].line.batting.HR, 1, 'homonyms never merge');
  const team = e.rows(null, 'team')[0];
  assert.equal(team.line.batting.PA, 6); assert.equal(team.line.batting.AB, 4);
  assert.equal(team.line.batting.SH, 1); assert.equal(team.line.batting.R, 2);
  assert.equal(team.line.pitching.BB, 1);
  assert.doesNotMatch(JSON.stringify(row), /AWAY0|AWAY1|HOME0|identificationNumber/);
  assert.deepEqual(e.get(), stateBeforeReading, 'statistics reads never mutate official games');
});
test('substituted pitchers retain inherited-run responsibility and canonical inherited walks', t => {
  const e = scoring(t);
  for (let pitch = 0; pitch < 3; pitch++) e.send({ scorecardCommand: { kind: 'pitch', value: 'ball' } });
  e.service().recordPersonnelChange({ gameId: 'game', tournamentId: 'tour', teamId: 'home',
    actorId: 'scorer', actorRole: 'scorekeeper', expectedOfficialVersion: e.get().state.officialVersion,
    expectedRevision: e.service().getTeamSheets('game', 'tour', 'scorer', 'scorekeeper').sheets.find(sheet => sheet.teamId === 'home').revision,
    action: { kind: 'substitution', outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME9',
      fieldPosition: 'P', jerseyNumber: '10' } });
  e.play('walk'); e.play('homeRun'); e.play('groundOut'); e.play('groundOut'); e.play('groundOut');
  e.send({ scorecardCommand: { kind: 'finish' } });
  const starter = e.rows('HOME0')[0], reliever = e.rows('HOME9')[0];
  assert.equal(starter.qualification, 'official'); assert.equal(starter.line.pitching.BB, 1);
  assert.equal(starter.line.pitching.R, 1); assert.equal(reliever.line.pitching.R, 1);
  assert.equal(reliever.line.pitching.BB, 0); assert.equal(reliever.line.pitching.GS, 0);
  const report = e.service().gameReport('game', 'tour', true);
  const reportStarter = report.teams.home.players.find(player => player.key === 'home:0');
  const reportReliever = report.teams.home.players.find(player => player.key === 'home:9');
  assert.equal(reportStarter.line.pitching.BB, 1); assert.equal(reportReliever.line.pitching.BB, 0);
  assert.equal(reportReliever.order, 1); assert.equal(reportReliever.jersey, '10');
  assert.equal(e.service().personalStatistics(null, 'mgr-home', 'team')[0].line.pitching.BB, 1);
});
test('close, undo, correction and restart recompute statistics from the newest durable official state', t => {
  const e = scoring(t, true); e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const before = e.rows();
  assert.deepEqual(e.reopen().personalStatistics('AWAY0', 'mgr-away', 'player'), before);
  e.send({ undoLast: true });
  assert.equal(e.rows()[0].qualification, 'provisional'); assert.equal(aggregateStatistics(e.rows()), null);
  e.play('single'); e.send({ scorecardCommand: { kind: 'finish' } });
  const after = e.rows();
  assert.ok(after[0].version > before[0].version);
  assert.equal(aggregateStatistics([...before, ...after]).batting.G, 1);
});
test('PCL scale follows the declared sport or custom rule, never innings duration; missing metadata stays excluded', t => {
  const e = scoring(t); e.send({ regulationInnings: 7 }); e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  assert.equal(e.rows()[0].eraBase, 9);
  e.doc.sport = 'softball'; e.doc.modality = 'Lanzamiento rápido';
  assert.equal(e.rows()[0].eraBase, 7); assert.equal(e.rows()[0].line.pitching.ERA, 14);
  e.doc.customRules = [{ name: 'Base del PCL', value: '9' }]; assert.equal(e.rows()[0].eraBase, 9);
  e.doc.customRules[0].value = 'garbage'; bad(() => e.rows(), 409); assert.deepEqual(e.rows('OTHER'), []);
  e.doc.customRules = []; e.doc.modality = '';
  assert.equal(e.rows()[0].qualification, 'excluded'); assert.equal(aggregateStatistics(e.rows()), null);
  e.service().setTournamentPlanning({ document: () => null, assertParticipation() {} });
  assert.equal(e.rows()[0].sport, null); assert.equal(aggregateStatistics(e.rows()), null);
});
test('manual scores without full scoring evidence and missing defensive attribution do not become official zeroes', t => {
  const e = scoring(t, true); e.play('single'); e.send({ playEvent: { type: 'ERROR', fielderIdentificationNumber: 'HOME5' } });
  const game = e.service().games.get('game');
  game.playByPlay.events.at(-1).fielderIdentificationNumber = null;
  delete game.playByPlay.events.at(-1).fielderPosition;
  delete game.playByPlay.scorecardLog.at(-1).legacyError;
  game.playByPlay.fieldingStatsByIdentification.clear();
  e.play('groundOut'); e.play('groundOut'); e.play('groundOut');
  e.send({ scorecardCommand: { kind: 'finish' } });
  assert.equal(e.rows('HOME0')[0].line.fielding.E, null);
  assert.equal(e.rows('HOME0')[0].line.fielding.PO, null);
  const historical = structuredClone(e.get());
  e.reopen();
  assert.deepEqual(e.get(), historical);
  assert.equal(e.rows('HOME0')[0].line.fielding.E, null);
  e.send({ patch: { awayScore: 20 } });
  assert.equal(e.rows()[0].qualification, 'excluded'); assert.equal(e.rows()[0].line, null);
});

test('all attributed errors agree across saved details, individual and team totals, restart and undo', t => {
  const e = scoring(t, true);
  e.send({ scorecardCommand: { kind: 'rules', rules: 'baseball' } });
  const errors = [
    { playerId: 'HOME5', position: 'SS', type: 'fielding' },
    { playerId: 'HOME2', position: '1B', type: 'throwing' },
    { playerId: 'HOME5', position: 'SS', type: 'throwing' }
  ];
  e.send({ scorecardCommand: { kind: 'play', result: 'single', destinations: { AWAY0: 3 }, rbis: 0, errorOuts: 0, errors } });
  const details = e.get().playByPlay.fieldingErrors;
  assert.equal(details.length, 3);
  assert.deepEqual(details.map(row => [row.sequence, row.errorIndex, row.position, row.type]),
    [[1, 1, 'SS', 'fielding'], [1, 2, '1B', 'throwing'], [1, 3, 'SS', 'throwing']]);
  assert.deepEqual(e.get().playByPlay.scorecard.log.at(-1).errors, errors);
  e.send({ scorecardCommand: { kind: 'finish' } });
  assert.equal(aggregateStatistics(e.rows('HOME5')).fielding.E, 2);
  assert.equal(aggregateStatistics(e.rows('HOME2')).fielding.E, 1);
  assert.equal(aggregateStatistics(e.service().personalStatistics(null, 'mgr-home', 'team')).fielding.E, 3);
  const before = structuredClone(e.get());
  e.reopen();
  assert.deepEqual(e.get(), before);
  assert.equal(aggregateStatistics(e.rows('HOME5')).fielding.E, 2);
  e.send({ undoLast: true });
  e.send({ undoLast: true });
  assert.deepEqual(e.get().playByPlay.fieldingErrors, []);
  assert.deepEqual(e.get().playByPlay.fieldingStats, []);
  e.reopen();
  assert.deepEqual(e.get().playByPlay.fieldingErrors, []);
});
test('caught stealing excludes pickoffs, and a truncated event archive reports unavailable attribution', t => {
  const e = scoring(t); e.play('single');
  e.send({ playEvent: { type: 'PICKOFF', runnerIdentificationNumber: 'AWAY0', fromBase: 1 } });
  e.play('single'); e.send({ playEvent: { type: 'CAUGHT_STEALING', runnerIdentificationNumber: 'AWAY1', fromBase: 1 } });
  e.play('groundOut'); e.send({ scorecardCommand: { kind: 'finish' } });
  assert.equal(e.rows('AWAY0')[0].line.batting.CS, 0); assert.equal(e.rows('AWAY1')[0].line.batting.CS, 1);
  const game = e.service().games.get('game'); game.playByPlay.events = game.playByPlay.events.slice(1);
  assert.equal(e.rows('AWAY0')[0].line.batting.CS, null);
  assert.equal(e.get().playByPlay.scorecard.fieldingIncomplete, true);
  assert.equal(privateFieldingStats(e.get().playByPlay.scorecard, 'home').errors, null);
});
test('controller resolves the verified account identity for both modes and reports an unresolved actor explicitly', () => {
  const account = { id: 'account', localTestAccess: true,
    identity: { status: 'verified', identification: 'OWN0001', actorId: 'person:own' } };
  const controller = new SportsSheetController({ authenticate: () => account, personalPrivateStatistics: () => [] }, {
    managerStatistics(manager) { assert.equal(manager, 'person:own'); return { games: [], players: [] }; },
    personalStatistics(person, manager, mode) {
      assert.equal(person, 'OWN0001'); assert.equal(manager, 'person:own');
      assert.ok(['player', 'team'].includes(mode)); return [];
    },
  }, { personalStatistics: () => [] });
  for (const mode of ['player', 'team'])
    assert.deepEqual(controller.statistics({ headers: {} }, { mode }).games, []);
  account.identity.actorId = ''; bad(() => controller.statistics({ headers: {} }, {}), 409);
});
test('manager player projection uses historical participants and corrections, excluding unused bench and closed-tournament totals', t => {
  const e = scoring(t, true);
  e.doc.status = 'running'; e.doc.teams.forEach(team => { team.managerId = `mgr-${team.id}`; });
  e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const before = structuredClone(e.get()), snapshot = e.service().managerStatistics('mgr-away');
  assert.equal(snapshot.games.length, 1); assert.equal(snapshot.players.length, 9);
  assert.ok(snapshot.players.every(player => player.activeTournament));
  assert.equal(new Set(snapshot.players.map(player => player.id)).size, 9);
  assert.ok(snapshot.players.every(player => /^player-[a-f0-9]{64}$/.test(player.id)));
  assert.doesNotMatch(JSON.stringify(snapshot), /AWAY0|HOME0|identificationNumber/);
  assert.equal(snapshot.players.filter(player => player.game.line.batting.H === 1).length, 2);
  assert.equal(snapshot.players.reduce((sum, player) => sum + player.game.line.batting.AB, 0), snapshot.games[0].line.batting.AB);
  assert.equal(snapshot.players.reduce((sum, player) => sum + player.game.line.batting.H, 0), snapshot.games[0].line.batting.H);
  assert.deepEqual(e.get(), before);
  assert.deepEqual(e.reopen().managerStatistics('mgr-away'), snapshot);
  e.doc.status = 'finished';
  const closed = e.service().managerStatistics('mgr-away');
  assert.ok(closed.players.every(player => !player.activeTournament));
  assert.deepEqual(closed.players.map(player => player.game.line), snapshot.players.map(player => player.game.line));
  e.doc.status = 'running'; e.send({ undoLast: true });
  assert.ok(e.service().managerStatistics('mgr-away').players.every(player => aggregateStatistics([player.game]) === null));
});
test('career uses historical participation and identity aliases, not bench attendance, selected roles or current rosters', t => {
  const e = scoring(t);
  const career = person => e.service().personalCareer(person, 'person:canonical-account');
  assert.deepEqual(career('AWAY0'), []);
  assert.deepEqual(career('SCORER0001'), [], 'authorization is not participation');
  e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const before = structuredClone(e.get());
  const player = career('AWAY0');
  assert.equal(player.length, 1); assert.equal(player[0].role, 'player'); assert.equal(player[0].teamId, 'away');
  assert.deepEqual(career('AWAY9'), []); assert.deepEqual(career('UNREGISTERED'), []);
  assert.equal(career('MANAGERAWAY')[0].role, 'manager', 'legacy actor alias resolves to its verified personal identity');
  assert.equal(career('SCORER0001')[0].role, 'scorekeeper');
  assert.deepEqual(career('ORG0001'), [], 'current organizer ownership does not fabricate a signed historical intervention');
  assert.deepEqual(e.get(), before, 'reading career does not mutate official games');
  e.service().tournamentAuthorizations.get('tour').teamRosters.get('away').playerIdentificationNumbers.clear();
  assert.deepEqual(career('AWAY0'), player, 'current roster cannot erase the historical lineup');
  assert.doesNotMatch(JSON.stringify(player), /AWAY0|MANAGERAWAY|actorId|identification|batting|pitching/);
  assert.equal(readCareerSnapshot({ accountId: 'owner', source: 'official', identityVerified: true, games: player }, 'owner', 'official').games.length, 1);
});
test('career restart preserves evidence; undo, absent metadata and unresolved results never create completed histories', t => {
  const e = scoring(t, true); e.inning(); e.send({ scorecardCommand: { kind: 'finish' } });
  const read = () => e.service().personalCareer('AWAY0', 'person:owner');
  const original = read(); e.reopen(); assert.deepEqual(read(), original);
  e.send({ undoLast: true });
  assert.deepEqual(careerCounts([...original, ...read()]), { completed: 0, ongoing: 1, review: 0 });
  e.service().setTournamentPlanning({ document: () => null, assertParticipation() {} });
  const game = e.service().games.get('game'); game.details = null;
  const missing = read()[0]; assert.equal(missing.season, ''); assert.equal(missing.sport, ''); assert.equal(missing.date, null);
  game.officialState.status = 'suspended';
  assert.deepEqual(careerCounts(read()), { completed: 0, ongoing: 0, review: 1 });
  game.officialState.status = 'final'; game.officialState.protest = {};
  assert.deepEqual(careerCounts(read()), { completed: 0, ongoing: 0, review: 1 });
});
test('career retains a substituted participant and accepts only signed organizer interventions', t => {
  const e = scoring(t); e.play('single');
  e.service().recordPersonnelChange({ gameId: 'game', tournamentId: 'tour', teamId: 'home',
    actorId: 'scorer', actorRole: 'scorekeeper', expectedOfficialVersion: e.get().state.officialVersion,
    expectedRevision: e.service().getTeamSheets('game', 'tour', 'scorer', 'scorekeeper').sheets.find(sheet => sheet.teamId === 'home').revision,
    action: { kind: 'substitution', outgoingIdentificationNumber: 'HOME0', incomingIdentificationNumber: 'HOME9', fieldPosition: 'P', jerseyNumber: '10' } });
  e.play('groundOut');
  for (const person of ['HOME0', 'HOME9']) assert.equal(e.service().personalCareer(person, 'person:owner')[0].role, 'player');
  e.send({ actorId: 'org', actorRole: 'organizer', patch: { lastPlay: 'Intervención oficial de prueba' } });
  assert.equal(e.service().personalCareer('ORG0001', 'person:organizer')[0].role, 'organizer');
});
test('HTTP requires account authentication and master access; a paid tournament cannot grant a personal plan', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-statistics-access-'));
  const accounts = new AccountsService({ path: join(dir, 'accounts.sqlite') });
  let app;
  t.after(async () => { if (app) await app.close(); else accounts.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); });
  const input = email => ({ email, displayName: 'Cuenta de prueba', password: 'Una frase ficticia para pruebas 123' });
  const master = await accounts.register(input('stats-master@example.test'), 'master');
  const normal = await accounts.register(input('stats-normal@example.test'), 'normal');
  const config = join(dir, 'local-tester.json');
  writeFileSync(config, JSON.stringify({ version: 1, accountId: master.account.id }), { mode: 0o600 });
  class TestModule {}
  Module({ controllers: [SportsSheetController], providers: [
    { provide: AccountsService, useValue: accounts },
    { provide: FriendlyGamesService, useValue: { personalStatistics: () => [] } },
    { provide: OfficialScoringService, useValue: { subscriptionTier: 'paid',
      personalStatistics() { assert.fail('No unverified identity lookup'); }, personalCareer() { assert.fail('No unverified career lookup'); } } },
  ] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/sports-sheet/statistics`;
  const headers = token => ({ Cookie: `playsport-account=${token}` });
  assert.equal((await fetch(url)).status, 401);
  for (const mode of ['player', 'team']) {
    const denied = await fetch(`${url}?mode=${mode}&source=example`, { headers: headers(normal.token) });
    assert.equal(denied.status, 403);
    const body = await denied.json(); assert.equal(body.code, 'STATISTICS_PLAN_REQUIRED'); assert.equal('games' in body, false);
    const response = await fetch(`${url}?mode=${mode}&source=example`, { headers: headers(master.token) });
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(readStatisticsSnapshot(await response.json(), master.account.id, mode, 'example').games.length, 4);
  }
  const own = await fetch(url, { headers: headers(master.token) }).then(response => response.json());
  assert.deepEqual(own.games, []);
  for (const query of ['accountId=other', 'identification=OTHER', 'mode=admin', 'source=unknown', 'source=example&source=official', 'subscriptionTier=paid'])
    assert.equal((await fetch(`${url}?${query}`, { headers: headers(master.token) })).status, 400);
  const careerUrl = `${await app.getUrl()}/sports-sheet/career`;
  assert.equal((await fetch(careerUrl)).status, 401);
  for (const source of ['official', 'example']) {
    const denied = await fetch(`${careerUrl}?source=${source}`, { headers: headers(normal.token) });
    assert.equal(denied.status, 403); const body = await denied.json();
    assert.equal(body.code, 'CAREER_PLAN_REQUIRED'); assert.equal('games' in body, false);
    const allowed = await fetch(`${careerUrl}?source=${source}`, { headers: headers(master.token) });
    assert.equal(allowed.status, 200); assert.match(allowed.headers.get('cache-control'), /private, no-store/);
    const career = readCareerSnapshot(await allowed.json(), master.account.id, source);
    assert.equal(career.games.length, source === 'example' ? 10 : 0);
  }
  for (const query of ['actorId=other', 'identification=OTHER', 'mode=player', 'source=bad', 'source=example&source=official', 'tier=paid'])
    assert.equal((await fetch(`${careerUrl}?${query}`, { headers: headers(master.token) })).status, 400);
  unlinkSync(config);
  assert.equal((await fetch(url, { headers: headers(master.token) })).status, 403);
  assert.equal((await fetch(careerUrl, { headers: headers(master.token) })).status, 403);
});
