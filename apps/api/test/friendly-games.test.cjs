const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { FriendlyGamesService } = require('../src/modules/live-scoring/friendly-games.service');
const { FriendlyGamesController } = require('../src/modules/live-scoring/friendly-games.controller');
const { RegistrationService } = require('../src/modules/live-scoring/registration.service');
const { AccountsService } = require('../src/modules/accounts/accounts.service');
const { privateStats, createPrivateState, readFriendlyGame, isFriendlyCommand, friendlyDraftLineup,
  friendlySetupFromDraft, initialFriendlyDraft, isFriendlyDraft } = require('@playsport/shared');
const named = (prefix, count = 9) => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const setup = { sport: 'baseball', names: { home: 'Vecinos', away: 'Amigos' }, lineups: { home: named('Local'), away: ['Alex', 'Alex', ...named('Visitante', 7)] } };
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-friendly-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'games.json');
  const games = new FriendlyGamesService(path);
  const registry = new RegistrationService(join(dir, 'families.json'));
  return { games, registry, path, dir };
}
const bad = (fn, status) => assert.throws(fn, error => error.getStatus?.() === status);
test('a new friendly participant enters reserve and replaces the selected player atomically with no jersey or account', t => {
  const e = fixture(t);
  const game = e.games.create('owner', setup), before = readFileSync(e.path, 'utf8');
  const operation = { expectedRevision: game.revision, arrivalSubstitution: {
    side: 'home', outId: game.state.lineups.home[3].id, name: 'Nueva reserva de ejemplo'
  } };
  bad(() => e.games.update('other', game.id, operation), 403);
  bad(() => e.games.update('owner', game.id, { ...operation, expectedRevision: 99 }), 409);
  for (const patch of [{ outId: 'missing' }, { name: '' }, { name: 'X'.repeat(101) }, { side: 'other' }])
    bad(() => e.games.update('owner', game.id, { ...operation, arrivalSubstitution: { ...operation.arrivalSubstitution, ...patch } }), 400);
  assert.equal(readFileSync(e.path, 'utf8'), before);
  const after = e.games.update('owner', game.id, operation);
  const entered = after.state.lineups.home[3];
  assert.equal(entered.name, 'Nueva reserva de ejemplo');
  assert.equal(entered.order, 4);
  assert.equal(entered.jersey, '');
  assert.equal(after.seed.rosters.home.at(-1).order, null);
  assert.equal(after.state.lineups.home.length, 9);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], after);
  const undone = e.games.update('owner', game.id, { expectedRevision: after.revision, undo: true });
  assert.deepEqual(undone.state.lineups.home, game.state.lineups.home);
  assert.equal(undone.seed.rosters.home.at(-1).id, entered.id);
});
test('softball friendly extra innings persist the automatic runner across restart, scoring and undo', t => {
  const e = fixture(t);
  let game = e.games.create('owner', { ...setup, sport: 'softball' });
  const update = operation => game = e.games.update('owner', game.id, { expectedRevision: game.revision, ...operation });
  for (let out = 0; out < 42; out++) update({ command: { kind: 'play', result: 'groundOut' } });
  const runner = game.seed.lineups.away[2].id;
  assert.equal(game.seed.softballTieBreakerFromInning, 8);
  assert.deepEqual(game.state.bases, [null, runner, null]);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
  update({ undo: true }); assert.equal(game.state.inning, 7); assert.equal(game.state.outs, 2);
  update({ command: { kind: 'play', result: 'groundOut' } });
  update({ command: { kind: 'play', result: 'homeRun' } });
  assert.equal(game.state.scores.away, 2);
  assert.equal(game.state.runAccounting.runs[0].team, 'unearned');
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
});
test('friendly runner rule outs retain their cause through restart and undo', t => {
  const e = fixture(t);
  let game = e.games.create('owner', { ...setup, sport: 'softball' });
  const send = operation => game = e.games.update('owner', game.id, { expectedRevision: game.revision, ...operation });
  send({ command: { kind: 'play', result: 'walk' } });
  const before = game.state;
  send({ command: { kind: 'runner', action: 'ruleOut', from: 1, to: 0, ruleOut: { reason: 'hitByBattedBall' } } });
  assert.equal(game.state.log.at(-1).ruleOut.reason, 'hitByBattedBall');
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
  send({ undo: true }); assert.deepEqual(game.state, before);
});

test('friendly participants need only names, duplicate names remain distinct, and games survive a service restart', t => {
  const e = fixture(t);
  let game = e.games.create('owner', setup);
  assert.equal(game.seed.friendly, true);
  assert.ok(game.seed.rosters.away.every(player => player.jersey === '' && player.position === 'NA'));
  assert.notEqual(game.seed.lineups.away[0].id, game.seed.lineups.away[1].id);
  for (let i = 0; i < 2; i++) game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'play', result: 'homeRun' } });
  assert.equal(game.state.scores.away, 2);
  for (const player of game.seed.lineups.away.slice(0, 2)) assert.equal(privateStats(game.state, 'away', player.id).hits, 1);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
  assert.equal(statSync(e.path).mode & 0o777, 0o600);
  assert.deepEqual(e.games.list('another').games, []);
  assert.doesNotThrow(() => readFriendlyGame(game));
  assert.equal(e.games.report('owner', game.id, false).detailed, false);
  assert.equal(e.games.report('owner', game.id, true).teams.away.players[0].line.batting.H, 1);
  bad(() => e.games.report('another', game.id, true), 404);
  const small = { ...game.seed, lineups: { home: game.seed.lineups.home.slice(0, 1), away: game.seed.lineups.away.slice(0, 2) } };
  assert.throws(() => createPrivateState({ ...small, friendly: undefined }), /alineación privada/);
  assert.doesNotThrow(() => readFriendlyGame({ ...game, seed: small, commands: [] }));
});
test('only the creator can mutate, stale revisions and finalized games cannot overwrite stored scoring', t => {
  const e = fixture(t);
  let game = e.games.create('owner', setup);
  const before = readFileSync(e.path, 'utf8');
  bad(() => e.games.update('another', game.id, { expectedRevision: 1, command: { kind: 'pitch', value: 'ball' } }), 403);
  bad(() => e.games.update('owner', game.id, { expectedRevision: 2, command: { kind: 'pitch', value: 'ball' } }), 409);
  bad(() => e.games.update('owner', game.id, { expectedRevision: 1, command: { kind: 'received-lineup', side: 'home', players: [] } }), 400);
  bad(() => e.games.update('owner', game.id, { expectedRevision: 1, undo: true, command: { kind: 'finish' } }), 400);
  assert.equal(readFileSync(e.path, 'utf8'), before);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'pitch', value: 'ball' } });
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, undo: true });
  assert.equal(game.state.balls, 0);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'finish' } });
  assert.equal(game.state.finished, true);
  bad(() => e.games.update('owner', game.id, { expectedRevision: game.revision, undo: true }), 409);
  assert.deepEqual(e.games.list('owner').games[0], game);
});
test('invalid input, corrupt storage, locks and invalid commands fail explicitly without replacing data', t => {
  const e = fixture(t);
  for (const patch of [{ names: { home: '', away: 'Away' } }, { lineups: { home: [], away: named('A') } },
    { sport: 'other' }, { lineups: { home: named('A', 13), away: named('B') } }, { names: { home: 'A', away: 'a' } }]) {
    bad(() => e.games.create('owner', { ...setup, ...patch }), 400);
  }
  const game = e.games.create('owner', setup);
  const before = readFileSync(e.path, 'utf8');
  writeFileSync(`${e.path}.lock`, '');
  bad(() => e.games.update('owner', game.id, { expectedRevision: 1, command: { kind: 'finish' } }), 409);
  rmSync(`${e.path}.lock`);
  assert.equal(readFileSync(e.path, 'utf8'), before);
  writeFileSync(e.path, '{"version":99}');
  assert.throws(() => e.games.create('owner', setup), /archivo de amistosos/);
  assert.equal(readFileSync(e.path, 'utf8'), '{"version":99}');
  assert.equal(isFriendlyCommand({ kind: 'substitution', side: 'home', outId: 'x', inId: 'y', jersey: '1', position: 'P' }), false);
});
test('HTTP private access uses the authenticated account across sessions, not role keys; participants need no account', async t => {
  const e = fixture(t);
  const accessA = e.registry.createAccess().key, accessB = e.registry.createAccess().key;
  const accounts = new AccountsService({ path: join(e.dir, 'accounts.sqlite') });
  const a = await accounts.register({ email: 'a@example.test', displayName: 'Cuenta A', password: 'Frase ficticia segura 123' }, 'a');
  const b = await accounts.register({ email: 'b@example.test', displayName: 'Cuenta B', password: 'Frase ficticia segura 123' }, 'b');
  const app = await NestFactory.create({ module: class FriendlyTestModule {}, controllers: [FriendlyGamesController],
    providers: [{ provide: FriendlyGamesService, useValue: e.games }, { provide: RegistrationService, useValue: e.registry },
      { provide: AccountsService, useValue: accounts }] }, { logger: false });
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = (await app.getUrl()) + '/friendly-games';
  const headers = token => ({ Cookie: `playsport-account=${token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' });
  assert.equal((await fetch(base)).status, 401);
  assert.equal((await fetch(base, { headers: { Authorization: `Bearer ${accessA}` } })).status, 401);
  const response = await fetch(base, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ ...setup, substitutes: { home: ['Reserva local'], away: ['Reserva visitante'] },
      ownerId: e.registry.getFamily(accessB).id }) });
  assert.equal(response.status, 201);
  const game = await response.json();
  const again = await accounts.login({ email: a.account.email, password: 'Frase ficticia segura 123' }, 'other-device');
  assert.equal((await (await fetch(base, { headers: headers(again.token) })).json()).games[0].id, game.id);
  const replacement = game.seed.rosters.away.find(player => player.order === null);
  const substitution = { kind: 'substitution', side: 'away', outId: game.seed.lineups.away[3].id,
    inId: replacement.id, position: 'NA', jersey: '' };
  const changedResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: game.revision, command: substitution }) });
  assert.equal(changedResponse.status, 201);
  const changed = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(changed.commands, [substitution]);
  assert.equal(changed.state.lineups.away[3].id, replacement.id);
  assert.equal(changed.state.lineups.away[3].order, 4);
  assert.deepEqual(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0], changed);
  assert.equal((await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(b.token),
    body: JSON.stringify({ expectedRevision: changed.revision, command: substitution }) })).status, 403);
  assert.equal((await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: game.revision, undo: true }) })).status, 409);
  const restoredResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(again.token),
    body: JSON.stringify({ expectedRevision: changed.revision, undo: true }) });
  assert.equal(restoredResponse.status, 201);
  Object.assign(game, await restoredResponse.json());
  const command = { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] };
  const scored = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: game.revision, command }) });
  assert.equal(scored.status, 201);
  const remote = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(remote.commands.at(-1), { ...command, destinations: { [game.seed.lineups.away[0].id]: 0 } });
  assert.deepEqual(remote.state.log.at(-1).fieldingSequence, [6, 3]);
  assert.deepEqual(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].state.log.at(-1).fieldingSequence, [6, 3]);
  assert.equal((await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: game.revision, command }) })).status, 409);
  const undone = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(again.token),
    body: JSON.stringify({ expectedRevision: remote.revision, undo: true }) });
  assert.equal(undone.status, 201);
  assert.equal((await (await fetch(base, { headers: headers(a.token) })).json()).games[0].commands.length, 0);
  const undoneGame = await undone.json();
  const walkResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: undoneGame.revision, command: { kind: 'play', result: 'walk' } }) });
  assert.equal(walkResponse.status, 201);
  const walked = await walkResponse.json();
  const selectionCommand = { kind: 'play', result: 'fieldersChoice', battedBallType: 'ground', fieldingSequence: [6, 4],
    destinations: { [walked.seed.lineups.away[0].id]: 0, [walked.seed.lineups.away[1].id]: 1 } };
  const selected = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: walked.revision, command: selectionCommand }) });
  assert.equal(selected.status, 201);
  const anotherClient = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(anotherClient.commands.at(-1), selectionCommand);
  assert.deepEqual(anotherClient.state.log.at(-1).fieldingSequence, [6, 4]);
  assert.equal(anotherClient.state.outs, 1);
  assert.deepEqual(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].commands.at(-1), selectionCommand);
  const selectionUndo = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: anotherClient.revision, undo: true }) });
  assert.equal(selectionUndo.status, 201);
  const beforeRunner = await selectionUndo.json();
  const runnerCommand = { kind: 'runner', action: 'caught', from: 1, to: 0, fieldingSequence: [2, 6] };
  const caught = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: beforeRunner.revision, command: runnerCommand }) });
  assert.equal(caught.status, 201);
  const runnerOnAnotherClient = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(runnerOnAnotherClient.commands.at(-1), runnerCommand);
  assert.deepEqual(runnerOnAnotherClient.state.log.at(-1).fieldingSequence, [2, 6]);
  assert.equal(runnerOnAnotherClient.state.log.at(-1).battedBallType, undefined);
  assert.deepEqual(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].commands.at(-1), runnerCommand);
  let infieldSetup = runnerOnAnotherClient;
  for (let index = 0; index < 2; index++) {
    const walkedForInfield = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
      body: JSON.stringify({ expectedRevision: infieldSetup.revision, command: { kind: 'play', result: 'walk' } }) });
    assert.equal(walkedForInfield.status, 201);
    infieldSetup = await walkedForInfield.json();
  }
  const infield = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: infieldSetup.revision, command: { kind: 'play', result: 'flyOut', infieldFly: true } }) });
  assert.equal(infield.status, 201);
  const infieldOnAnotherClient = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.equal(infieldOnAnotherClient.state.log.at(-1).infieldFly, true);
  assert.deepEqual(infieldOnAnotherClient.state.bases, infieldSetup.state.bases);
  assert.equal(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].state.log.at(-1).infieldFly, true);
  const ruleCommand = { kind: 'play', result: 'ruleOut', batterRuleOut: { reason: 'outsideBox', umpireConfirmed: true } };
  const ruleResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: infieldOnAnotherClient.revision, command: ruleCommand }) });
  assert.equal(ruleResponse.status, 201);
  const ruleOnAnotherClient = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(ruleOnAnotherClient.commands.at(-1).batterRuleOut, ruleCommand.batterRuleOut);
  assert.deepEqual(ruleOnAnotherClient.state.log.at(-1).batterRuleOut, ruleCommand.batterRuleOut);
  assert.equal(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].state.log.at(-1).batterRuleOut.reason, 'outsideBox');
  const ruleUndo = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(again.token),
    body: JSON.stringify({ expectedRevision: ruleOnAnotherClient.revision, undo: true }) });
  assert.equal(ruleUndo.status, 201);
  const restoredRule = await ruleUndo.json();
  assert.deepEqual(restoredRule.state.bases, infieldOnAnotherClient.state.bases);
  assert.equal(restoredRule.state.outs, infieldOnAnotherClient.state.outs);
  const defender = restoredRule.state.lineups.home[0];
  const defenseResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: restoredRule.revision,
      command: { kind: 'position', side: 'home', playerId: defender.id, position: 'SS', jersey: defender.jersey } }) });
  assert.equal(defenseResponse.status, 201);
  const preparedDefense = await defenseResponse.json();
  const catcher = require('@playsport/shared').defensivePlayerAt(preparedDefense.state, 6);
  const catchCommand = { kind: 'play', result: 'lineOut', battedBallType: 'line', fieldingSequence: [6],
    caughtBy: { playerId: catcher.id, position: 6 } };
  const catchResponse = await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ expectedRevision: preparedDefense.revision, command: catchCommand }) });
  assert.equal(catchResponse.status, 201);
  const catchRemote = (await (await fetch(base, { headers: headers(again.token) })).json()).games[0];
  assert.deepEqual(catchRemote.state.log.at(-1).caughtBy, catchCommand.caughtBy);
  assert.deepEqual(new FriendlyGamesService(e.path).list(`account:${a.account.id}`).games[0].commands.at(-1).caughtBy, catchCommand.caughtBy);
  assert.equal((await (await fetch(base, { headers: headers(b.token) })).json()).games.length, 0);
  assert.equal((await fetch(`${base}/${game.id}/updates`, { method: 'POST', headers: headers(b.token),
    body: JSON.stringify({ expectedRevision: 1, command: { kind: 'finish' } }) })).status, 403);
  assert.equal((await fetch(base, { method: 'POST', headers: { ...headers(a.token), Origin: 'http://localhost:8083' },
    body: JSON.stringify(setup) })).status, 403);
  assert.equal(e.registry.getFamily(accessA).adult, null);
  assert.deepEqual(e.registry.getFamily(accessA).children, []);
  assert.equal('ownerId' in game, false);
  const legacy = e.games.create(e.registry.getFamily(accessA).id, setup);
  assert.equal((await (await fetch(base, { headers: headers(a.token) })).json()).games.length, 1);
  const preview = await fetch(`${base}/legacy/preview`, { method: 'POST', headers: headers(a.token), body: JSON.stringify({ key: accessA }) });
  assert.equal((await preview.json()).games[0].id, legacy.id);
  assert.equal((await fetch(`${base}/legacy/import`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ key: accessA, ids: [legacy.id] }) })).status, 400);
  const imported = await fetch(`${base}/legacy/import`, { method: 'POST', headers: headers(a.token),
    body: JSON.stringify({ key: accessA, ids: [legacy.id], confirmed: true }) });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).games[0].revision, 2);
  assert.equal((await fetch(`${base}/legacy/import`, { method: 'POST', headers: headers(b.token),
    body: JSON.stringify({ key: accessA, ids: [legacy.id], confirmed: true }) })).status, 403);
  assert.equal((await (await fetch(base, { headers: headers(again.token) })).json()).games.length, 2);
});
test('friendly two-out selection preserves ordered retirements, the safe batter and undo after reload', t => {
  const { fieldersChoiceTwoOutOptions, currentBatter } = require('@playsport/shared');
  const e = fixture(t);
  let game = e.games.create('owner', setup);
  for (let index = 0; index < 3; index++) game = e.games.update('owner', game.id,
    { expectedRevision: game.revision, command: { kind: 'play', result: 'walk' } });
  const before = structuredClone(game.state), batter = currentBatter(before), option = fieldersChoiceTwoOutOptions(before)
    .find(option => option.selectionOuts[0].base === 4 && option.selectionOuts[1].base === 3);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: {
    kind: 'play', result: 'fieldersChoice', destinations: option.destinations, selectionOuts: option.selectionOuts, note: option.label
  } });
  assert.equal(game.state.outs, 2); assert.equal(game.state.bases[0], batter);
  assert.equal(privateStats(game.state, 'away', batter).hits, 0);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0].state, game.state);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, undo: true });
  assert.deepEqual(game.state, before);
});

test('friendly selection plus error stores the saved runner and attribution without hit or out, and undoes after reload', t => {
  const e = fixture(t);
  let game = e.games.create('owner', setup);
  const defender = game.seed.lineups.home[0].id;
  const update = command => game = e.games.update('owner', game.id, { expectedRevision: game.revision, command });
  update({ kind: 'position', side: 'home', playerId: defender, position: 'SS' });
  update({ kind: 'play', result: 'single' });
  const before = structuredClone(game.state), runner = game.seed.lineups.away[0].id, batter = game.seed.lineups.away[1].id;
  update({ kind: 'play', result: 'fieldersChoice', destinations: { [runner]: 2, [batter]: 1 },
    errorSavedRunnerId: runner, errorOuts: 1, rbis: 0, errors: [{ playerId: defender, position: 'SS', type: 'throwing' }] });
  assert.equal(game.state.outs, 0); assert.equal(privateStats(game.state, 'away', batter).hits, 0);
  assert.equal(game.state.log.at(-1).errorSavedRunnerId, runner);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0].state, game.state);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, undo: true });
  assert.deepEqual(game.state, before);
});

test('friendly errors retain the shared run-accounting correction and do not invent extra advances', t => {
  const e = fixture(t);
  let game = e.games.create('owner', { ...setup, lineups: { home: named('H'), away: named('A') } });
  const defender = game.seed.lineups.home[0].id;
  game = e.games.update('owner', game.id, { expectedRevision: game.revision,
    command: { kind: 'position', side: 'home', playerId: defender, position: 'SS' } });
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'play', result: 'single' } });
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, command: { kind: 'play', result: 'single' } });
  assert.equal(game.state.scores.away, 0);
  assert.equal(game.state.bases[1], game.seed.lineups.away[0].id);
  game = e.games.update('owner', game.id, { expectedRevision: game.revision,
    command: { kind: 'play', result: 'error', errors: [{ playerId: defender, position: 'SS', type: 'fielding' }] } });
  game = e.games.update('owner', game.id, { expectedRevision: game.revision, errorOuts: 1 });
  assert.equal(game.commands.at(-1).errorOuts, 1);
});
test('creation enforces 9–12 ordered participants, persists positions and rejects duplicates before writing', t => {
  const e = fixture(t);
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF4', 'SF', 'DH'];
  for (const count of [9, 10, 11, 12]) {
    const participants = named('Participante', count).map((name, index) => ({ name, position: positions[index] }));
    const game = e.games.create('owner', { ...setup, lineups: { home: participants, away: participants },
      substitutes: { home: named('Reserva local', 25), away: named('Reserva visitante', 25) } });
    assert.equal(game.seed.lineups.home.length, count);
    assert.equal(game.seed.rosters.home.length, count + 25);
    assert.deepEqual(game.seed.lineups.home.map(p => [p.order, p.position]), participants.map((p, index) => [index + 1, p.position]));
    assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games.at(-1), game);
  }
  const before = readFileSync(e.path, 'utf8');
  for (const count of [0, 1, 8, 13]) bad(() => e.games.create('owner', { ...setup, lineups: { ...setup.lineups, home: named('H', count) } }), 400);
  const participants = named('H').map(name => ({ name, position: 'NA' }));
  participants[0].position = 'P'; participants[1].position = 'P';
  bad(() => e.games.create('owner', { ...setup, lineups: { ...setup.lineups, home: participants } }), 400);
  participants[1].position = 'INVALID';
  bad(() => e.games.create('owner', { ...setup, lineups: { ...setup.lineups, home: participants } }), 400);
  participants[1] = { name: '', position: 'NA' };
  bad(() => e.games.create('owner', { ...setup, lineups: { ...setup.lineups, home: participants } }), 400);
  assert.equal(readFileSync(e.path, 'utf8'), before);
});
test('old name-only drafts retain order while new drafts retain all twelve slots and positions', () => {
  const draft = { ...initialFriendlyDraft, home: 'H', away: 'A', homePlayers: named('H').join('\n'), awayPlayers: named('A', 12).join('\n') };
  assert.equal(isFriendlyDraft(draft), true);
  assert.equal(friendlyDraftLineup(draft, 'home').length, 12);
  assert.equal(friendlySetupFromDraft(draft).lineups.home.length, 9);
  const withPositions = { ...draft, homePositions: ['P', ...Array(11).fill('NA')] };
  assert.equal(friendlySetupFromDraft(JSON.parse(JSON.stringify(withPositions))).lineups.home[0].position, 'P');
  assert.equal(isFriendlyDraft({ ...draft, homePlayers: named('H', 13).join('\n') }), false);
  assert.throws(() => friendlySetupFromDraft({ ...draft, homePlayers: named('H', 8).join('\n') }), /9 y 12/);
  assert.throws(() => friendlySetupFromDraft({ ...draft, homePlayers: [...named('H', 9), '', 'Once'].join('\n') }), /filas intermedias/);
  assert.throws(() => friendlySetupFromDraft({ ...draft, homePositions: [...Array(11).fill('NA'), 'P'] }), /turno 10/);
});

test('both benches are separate from 9–12 starters, uncapped, name-only and stable after restart', t => {
  const e = fixture(t);
  const substitutes = { home: ['  Reserva  ', 'Alex', 'Alex'], away: named('Reserva visitante', 25) };
  const game = e.games.create('owner', { ...setup, substitutes });
  for (const side of ['home', 'away']) {
    assert.equal(game.seed.lineups[side].length, 9);
    assert.equal(game.seed.rosters[side].length, 9 + substitutes[side].length);
    const bench = game.seed.rosters[side].slice(9);
    assert.deepEqual(bench.map(p => p.name), substitutes[side].map(name => name.trim()));
    assert.ok(bench.every(p => p.order === null && p.position === 'NA' && p.jersey === ''));
    assert.equal(new Set(game.seed.rosters[side].map(p => p.id)).size, game.seed.rosters[side].length);
    assert.deepEqual(game.state.lineups[side], game.seed.lineups[side]);
  }
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
  const before = readFileSync(e.path, 'utf8');
  for (const substitutes of [null, [], { home: [] }, { home: [''], away: [] },
    { home: [], away: [' '.repeat(3)] }, { home: [null], away: [] }, { home: ['X'.repeat(101)], away: [] }])
    bad(() => e.games.create('owner', { ...setup, substitutes }), 400);
  assert.equal(readFileSync(e.path, 'utf8'), before);
});

test('friendly substitutes inherit the slot, replace a runner, keep individual stats and can be undone', t => {
  const e = fixture(t);
  let game = e.games.create('owner', { ...setup, substitutes: { home: ['Local banca'], away: ['Visitante banca'] } });
  const send = operation => game = e.games.update('owner', game.id, { expectedRevision: game.revision, ...operation });
  send({ command: { kind: 'play', result: 'walk' } });
  const before = game.state, outgoing = before.lineups.away[0], incoming = game.seed.rosters.away.at(-1);
  const command = { kind: 'substitution', side: 'away', outId: outgoing.id, inId: incoming.id, position: 'NA', jersey: '' };
  assert.equal(isFriendlyCommand(command), true);
  send({ command });
  assert.equal(game.state.lineups.away.length, 9);
  assert.deepEqual(game.state.lineups.away[0], { ...incoming, order: 1 });
  assert.deepEqual(game.state.lineups.away.slice(1), before.lineups.away.slice(1));
  assert.equal(game.state.bases[0], incoming.id);
  assert.equal(privateStats(game.state, 'away', outgoing.id).walks, 1);
  assert.equal(privateStats(game.state, 'away', incoming.id).pa, 0);
  assert.match(game.state.log.at(-1).text, /Visitante banca.*conserva su turno/);
  assert.deepEqual(new FriendlyGamesService(e.path).list('owner').games[0], game);
  const stored = readFileSync(e.path, 'utf8');
  for (const patch of [{ inId: before.lineups.away[1].id }, { inId: game.seed.rosters.home.at(-1).id },
    { inId: 'missing' }, { outId: 'missing' }, { jersey: '9' }, { order: 10 }])
    bad(() => e.games.update('owner', game.id, { expectedRevision: game.revision, command: { ...command, outId: incoming.id, ...patch } }), 400);
  assert.equal(readFileSync(e.path, 'utf8'), stored);
  send({ undo: true });
  assert.deepEqual(game.state, before);
  send({ command });
  const homeOut = game.state.lineups.home[3], homeIn = game.seed.rosters.home.at(-1);
  send({ command: { kind: 'substitution', side: 'home', outId: homeOut.id, inId: homeIn.id, position: 'SS', jersey: '' } });
  assert.equal(game.state.lineups.home[3].order, 4);
  assert.equal(game.state.lineups.home[3].position, 'SS');
});

test('bench drafts keep both teams, reject malformed rows and do not silently drop blanks', () => {
  const draft = { ...initialFriendlyDraft, home: 'H', away: 'A',
    homePlayers: named('H').join('\n'), awayPlayers: named('A').join('\n'),
    homeSubstitutes: ['Local banca'], awaySubstitutes: named('Visitante banca', 25) };
  assert.equal(isFriendlyDraft(draft), true);
  assert.deepEqual(friendlySetupFromDraft(JSON.parse(JSON.stringify(draft))).substitutes,
    { home: draft.homeSubstitutes, away: draft.awaySubstitutes });
  assert.equal(isFriendlyDraft({ ...draft, homeSubstitutes: [null] }), false);
  assert.equal(isFriendlyDraft({ ...draft, homeSubstitutes: ['X'.repeat(101)] }), false);
  assert.equal(isFriendlyDraft({ ...draft, homeSubstitutes: [''] }), true);
  assert.throws(() => friendlySetupFromDraft({ ...draft, homeSubstitutes: [''] }), /suplente del local/);
  const { homeSubstitutes, awaySubstitutes, ...legacy } = draft;
  assert.deepEqual(friendlySetupFromDraft(legacy).substitutes, { home: [], away: [] });
});
