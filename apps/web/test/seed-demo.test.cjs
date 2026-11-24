const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
let run = 0;

async function seed({ status = 'scheduled', delivered = ['team-A'], cookie = 'playsport-account=ficticia' } = {}) {
  const originalFetch = global.fetch;
  const originalArgs = process.argv;
  const originalCookie = process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE;
  if (cookie) process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE = cookie;
  else delete process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE;
  const posts = [];
  const sheets = delivered.map(teamId => ({ teamId, initialLineup: [{ identificationNumber: 'ENTREGAEXISTENTE' }], revision: 3 }));
  const before = structuredClone(sheets);
  global.fetch = async (url, options) => {
    const endpoint = String(url).split('/api/official-scoring/')[1];
    if (options?.method === 'POST') {
      assert.equal(options.headers.Cookie, cookie);
      assert.equal(options.headers.Origin, new URL(process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000').origin);
      const body = JSON.parse(options.body);
      posts.push({ endpoint, body });
      if (endpoint.endsWith('/lineups')) sheets.push({ teamId: body.teamId, initialLineup: body.lineupEntries, revision: 1 });
      return Response.json({});
    }
    if (endpoint === 'tournaments/tour-global-1/authorization') return Response.json({ organizerId: 'org-demo', authorizedScorekeeperIds: ['scorer-demo'] });
    if (endpoint === 'players?visibility=free') return Response.json({ players: Array.from({ length: 23 }, (_, i) => ({
      identificationNumber: i < 18 ? `PRUEBA${String(i + 1).padStart(3, '0')}` : `PRUEBA${i + 1}`
    })) });
    if (endpoint.endsWith('/teams/rosters')) return Response.json({ rosters: [
      { teamId: 'team-A', managerId: 'mgr-A', rosterPlayerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `PRUEBA${String(i + 1).padStart(3, '0')}`) },
      { teamId: 'team-B', managerId: 'mgr-B', rosterPlayerIdentificationNumbers: Array.from({ length: 9 }, (_, i) => `PRUEBA${String(i + 10).padStart(3, '0')}`) }
    ] });
    if (endpoint.startsWith('games/game-global-1/authorization')) return Response.json({ hasGameScopedAuthorization: true });
    if (endpoint.startsWith('games?')) return Response.json({ games: [{ gameId: 'game-global-1', details: { venue: 'Estadio demo' } }] });
    if (endpoint.startsWith('games/game-global-1/state')) return Response.json({ state: { status }, playByPlay: { totalEvents: status === 'scheduled' ? 0 : 1 } });
    if (endpoint.startsWith('games/game-global-1/team-sheets')) return Response.json({ sheets });
    throw new Error(`Unexpected demo request: ${endpoint}`);
  };
  process.argv = [...originalArgs, '--lineups'];
  try {
    await import(`${pathToFileURL(path.resolve(__dirname, '../../../scripts/seed-demo.mjs')).href}?test=${++run}`);
    return { posts, sheets, before };
  } finally {
    global.fetch = originalFetch; process.argv = originalArgs;
    if (originalCookie === undefined) delete process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE;
    else process.env.PLAYSPORT_DEMO_ACCOUNT_COOKIE = originalCookie;
  }
}

test('explicit demo lineup delivery preserves the home sheet and submits nine approved fictional visitors', async () => {
  const { posts, sheets, before } = await seed();
  assert.deepEqual(sheets[0], before[0]);
  const deliveries = posts.filter(post => post.endpoint.endsWith('/lineups'));
  assert.equal(deliveries.length, 1);
  const { body } = deliveries[0];
  assert.equal(body.teamId, 'team-B');
  assert.equal(body.managerId, 'mgr-B');
  assert.deepEqual(body.lineupEntries.map(player => player.battingOrder), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(body.lineupEntries.map(player => player.fieldPosition), ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']);
  assert.equal(body.lineupEntries[0].identificationNumber, 'PRUEBA010');
  assert.equal(posts.some(post => post.endpoint.endsWith('/official-updates')), false);
});

test('delivering fictional lineups is idempotent and can prepare both missing teams', async () => {
  assert.equal((await seed({ delivered: ['team-A', 'team-B'] })).posts.filter(post => post.endpoint.endsWith('/lineups')).length, 0);
  assert.equal((await seed({ delivered: [] })).posts.filter(post => post.endpoint.endsWith('/lineups')).length, 2);
});

test('the demo helper refuses to replace lineups in a started or finished game', async () => {
  for (const status of ['in_progress', 'final']) await assert.rejects(seed({ status }), /programada y sin jugadas/);
});
test('demo seeding cannot mutate the API without an explicit authenticated local test cookie', async () => {
  await assert.rejects(seed({ cookie: '' }), /requiere PLAYSPORT_DEMO_ACCOUNT_COOKIE/);
});
