const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  MobileDraftStorage, mobileDraftStorageKey, newMobileDrafts, newManagerGameDraft, newOfficialGameDraft,
  managerDraftKey, officialDraftKey, readMobileDrafts
} = require('../drafts');

function memoryStorage(raw = null) {
  let value = raw;
  const writes = [];
  return {
    writes,
    getItem: async key => { assert.equal(key, mobileDraftStorageKey); return value; },
    setItem: async (key, next) => { assert.equal(key, mobileDraftStorageKey); writes.push(next); value = next; }
  };
}
function managerDraft() {
  const state = newMobileDrafts();
  state.manager.games[managerDraftKey(state.manager.context)] = {
    ...newManagerGameDraft(), cedula: 'PRUEBA009', position: 'RF', jersey: '42',
    entries: Array.from({ length: 9 }, (_, i) => ({
      identificationNumber: `PRUEBA${String(i + 1).padStart(3, '0')}`, battingOrder: i + 1,
      fieldPosition: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][i],
      lineupRole: 'PLAYER', jerseyNumber: String(i + 1), displayName: `Jugador ficticio ${i + 1}`
    }))
  };
  return state;
}

test('a new device starts with empty drafts and never restores a session or official score', () => {
  const state = readMobileDrafts(null);
  assert.deepEqual(Object.keys(state), ['version', 'manager', 'officials']);
  assert.deepEqual(state.manager.games, {});
  assert.equal('sessionRoleId' in state, false);
  assert.equal('officialLiveState' in state, false);
});

test('a new app instance recovers all nine lineup entries and incomplete input after closure', async () => {
  const storage = memoryStorage(), saved = managerDraft();
  await new MobileDraftStorage(storage).save(saved);
  const recovered = await new MobileDraftStorage(storage).load();
  assert.deepEqual(recovered, saved);
  const game = recovered.manager.games[managerDraftKey(recovered.manager.context)];
  assert.equal(game.entries.length, 9);
  assert.equal(game.jersey, '42');
  assert.equal(game.cedula, 'PRUEBA009');
});

test('draft keys isolate tournaments, games, teams and account identities', () => {
  const original = newMobileDrafts().manager.context;
  const keys = ['tournamentId', 'gameId', 'teamId', 'managerId'].map(field =>
    managerDraftKey({ ...original, [field]: `${original[field]}-other` }));
  assert.equal(new Set([managerDraftKey(original), ...keys]).size, 5);
  assert.equal(managerDraftKey({ ...original, gameId: ` ${original.gameId} ` }), managerDraftKey(original));
  assert.notEqual(managerDraftKey({ ...original, tournamentId: 'a:b', gameId: 'c' }),
    managerDraftKey({ ...original, tournamentId: 'a', gameId: 'b:c' }));
  const official = newMobileDrafts().officials.scorekeeper.context;
  for (const field of ['tournamentId', 'gameId', 'actorId']) {
    assert.notEqual(officialDraftKey(official), officialDraftKey({ ...official, [field]: `${official[field]}-other` }));
  }
});

test('organizer and scorekeeper fields remain separate even when using the same game and actor', async () => {
  const state = managerDraft(), storage = memoryStorage();
  for (const role of ['organizer', 'scorekeeper']) {
    const profile = state.officials[role];
    profile.games[officialDraftKey(profile.context)] = { ...newOfficialGameDraft(), batter: role, errorOuts: '1' };
  }
  await new MobileDraftStorage(storage).save(state);
  const recovered = await new MobileDraftStorage(storage).load();
  for (const role of ['organizer', 'scorekeeper']) {
    const profile = recovered.officials[role];
    assert.equal(profile.games[officialDraftKey(profile.context)].batter, role);
  }
});

test('all official play fields persist only as unconfirmed text', async () => {
  const state = newMobileDrafts(), storage = memoryStorage(), profile = state.officials.scorekeeper;
  const game = {
    offenseTeam: 'team-B', batter: 'PRUEBA010', runner: 'PRUEBA011', fielder: 'PRUEBA001',
    fromBase: '1', toBase: '2', runs: '0', outs: '1', errorOuts: '1', eventType: 'error', courtesySource: 'ROSTER'
  };
  profile.games[officialDraftKey(profile.context)] = game;
  await new MobileDraftStorage(storage).save(state);
  assert.deepEqual((await new MobileDraftStorage(storage).load()).officials.scorekeeper.games, profile.games);
  assert.equal('commands' in game, false);
});

test('slow storage cannot let an older draft overwrite the latest input', async () => {
  let raw = null;
  const releases = [], written = [];
  const store = new MobileDraftStorage({
    getItem: async () => raw,
    setItem: async (_key, value) => {
      written.push(value);
      await new Promise(resolve => releases.push(resolve));
      raw = value;
    }
  });
  const first = managerDraft(), second = structuredClone(first);
  second.manager.context.gameId = 'latest-game';
  const a = store.save(first), b = store.save(second);
  await new Promise(setImmediate);
  assert.equal(written.length, 1);
  releases.shift()();
  await new Promise(setImmediate);
  assert.equal(written.length, 2);
  releases.shift()();
  await Promise.all([a, b, store.flush()]);
  assert.deepEqual(await store.load(), second);
});

test('write errors remain explicit and retry can save the retained draft', async () => {
  let fail = true, raw = null;
  const store = new MobileDraftStorage({
    getItem: async () => raw,
    setItem: async (_key, value) => { if (fail) throw new Error('Device storage full'); raw = value; }
  });
  const saved = managerDraft();
  await assert.rejects(store.save(saved), /Device storage full/);
  assert.equal(raw, null);
  fail = false;
  await store.save(saved);
  assert.deepEqual(await new MobileDraftStorage({ getItem: async () => raw, setItem: async () => {} }).load(), saved);
});

test('loading and flushing wait for a pending device write', async () => {
  let raw = null, release, finished = false;
  const saved = managerDraft();
  const store = new MobileDraftStorage({
    getItem: async () => raw,
    setItem: async (_key, value) => { await new Promise(resolve => { release = resolve; }); raw = value; }
  });
  const writing = store.save(saved);
  const loading = store.load();
  const flushing = store.flush().then(() => { finished = true; });
  await new Promise(setImmediate);
  assert.equal(finished, false);
  release();
  await Promise.all([writing, flushing]);
  assert.equal(finished, true);
  assert.deepEqual(await loading, saved);
});

test('invalid stored data and read failures never trigger overwriting with empty defaults', async () => {
  for (const raw of ['invalid-json', '{"version":2}', JSON.stringify({ ...newMobileDrafts(), officialLiveState: {} })]) {
    const storage = memoryStorage(raw);
    await assert.rejects(new MobileDraftStorage(storage).load());
    assert.deepEqual(storage.writes, []);
    assert.equal(await storage.getItem(mobileDraftStorageKey), raw);
  }
  await assert.rejects(new MobileDraftStorage({
    getItem: async () => { throw new Error('Device read failed'); }, setItem: async () => assert.fail('Unexpected write')
  }).load(), /Device read failed/);
});

test('invalid input cannot replace the previously stored draft', async () => {
  const saved = managerDraft(), storage = memoryStorage(JSON.stringify(saved)), store = new MobileDraftStorage(storage);
  await assert.rejects(store.save({ ...saved, version: 99 }));
  const invalid = structuredClone(saved);
  invalid.manager.games[managerDraftKey(saved.manager.context)].entries[0].battingOrder = '1';
  await assert.rejects(store.save(invalid));
  assert.deepEqual(await store.load(), saved);
  assert.deepEqual(storage.writes, []);
});
