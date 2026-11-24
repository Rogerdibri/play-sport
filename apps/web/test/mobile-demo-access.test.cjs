const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');

const load = () => import(pathToFileURL(resolve(__dirname, '../../../scripts/serve-mobile-demo.mjs')).href);
const credentials = { email: 'master@example.test', password: 'Only a fixture password', accountId: 'fixture-master' };
const published = 'http://192.168.10.8:3100';
async function fixture(t, options = {}) {
  const { createMobileDemoServer } = await load();
  const received = [];
  const upstream = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({ path: request.url, method: request.method, headers: request.headers, body });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/accounts/login') {
      assert.deepEqual(JSON.parse(body), { email: credentials.email, password: credentials.password });
      response.setHeader('set-cookie', 'playsport-account=test-session; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000');
      response.end(JSON.stringify({ account: { id: credentials.accountId, localTestAccess: true, ...options.account } }));
    } else if (request.url === '/redirect') {
      response.writeHead(303, { location: `http://127.0.0.1:${upstream.address().port}/account` });
      response.end();
    } else {
      const authenticated = request.headers.cookie === 'playsport-account=test-session';
      response.writeHead(authenticated ? 200 : 401);
      response.end(JSON.stringify({ authenticated }));
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${upstream.address().port}`;
  const bridge = createMobileDemoServer({
    upstreamOrigin: origin, publicOrigin: published, credentials, accountId: credentials.accountId,
    ...(options.lifetimeMs === undefined ? {} : { lifetimeMs: options.lifetimeMs }),
    ...(options.familyAccess === undefined ? {} : { familyAccess: options.familyAccess }),
    ...(options.entryRole === undefined ? {} : { entryRole: options.entryRole }),
  });
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { bridge.close(); upstream.closeAllConnections(); upstream.close(); });
  const call = (path, method = 'GET', headers = {}, body) => new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: bridge.server.address().port, path, method,
      headers: { host: new URL(published).host, ...headers },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.on('error', reject);
    request.end(body);
  });
  return { bridge, call, received, origin };
}

test('mobile demo is limited to private IPv4, a loopback upstream and the configured master outside production', async () => {
  const { privateAddress, createMobileDemoServer } = await load();
  for (const address of ['10.0.0.2', '172.16.0.1', '172.31.255.254', '192.168.1.148']) assert.equal(privateAddress(address), true);
  for (const address of ['127.0.0.1', '0.0.0.0', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.168.1.256', '192.168.1', '192.168.1.-1'])
    assert.equal(privateAddress(address), false);
  const valid = { upstreamOrigin: 'http://localhost:3000', publicOrigin: published, credentials, accountId: credentials.accountId };
  for (const change of [{ publicOrigin: 'http://8.8.8.8:3100' }, { upstreamOrigin: 'https://example.test' },
    { publicOrigin: 'https://192.168.10.8:3100' }, { accountId: 'someone-else' }, { familyAccess: '<script>unsafe</script>' }, { entryRole: 'admin' }])
    assert.throws(() => createMobileDemoServer({ ...valid, ...change }));
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createMobileDemoServer(valid), /producción/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('single-use mobile entry authenticates the real configured master, forwards only its HTTP-only cookie and survives a reload', async t => {
  const { bridge, call, received } = await fixture(t);
  const initial = await call('/api/accounts/me');
  assert.equal(initial.status, 401);
  const preview = await call(bridge.entryPath, 'GET', { 'sec-purpose': 'prefetch' });
  assert.equal(preview.status, 425);
  assert.equal(received.filter(request => request.path === '/api/accounts/login').length, 0);
  const responses = await Promise.all([call(bridge.entryPath), call(bridge.entryPath)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [303, 410]);
  const signedIn = responses.find(response => response.status === 303);
  assert.equal(signedIn.headers.location, '/account');
  assert.equal(signedIn.headers['cache-control'], 'no-store');
  assert.equal(signedIn.headers['referrer-policy'], 'no-referrer');
  assert.match(signedIn.headers['set-cookie'][0], /HttpOnly; SameSite=Lax; Path=\/; Max-Age=/);
  assert.equal(received.filter(request => request.path === '/api/accounts/login').length, 1);
  const reload = await call('/api/accounts/me', 'GET', { cookie: signedIn.headers['set-cookie'][0].split(';')[0] });
  assert.equal(reload.status, 200);
  assert.deepEqual(JSON.parse(reload.text), { authenticated: true });
  assert.doesNotMatch(signedIn.text, /Only a fixture password|master@example/);
});

test('entry rejects expired or invalid links and wrong hosts and origins without authenticating', async t => {
  const { bridge, call, received } = await fixture(t, { lifetimeMs: -1 });
  assert.equal((await call(bridge.entryPath)).status, 410);
  assert.equal((await call('/entrar/not-the-key')).status, 410);
  assert.equal((await call(bridge.entryPath, 'GET', { host: 'attacker.example' })).status, 403);
  assert.equal((await call(bridge.entryPath, 'GET', { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await call(bridge.entryPath, 'POST', { origin: published })).status, 405);
  assert.equal(received.length, 0);
});

test('master entry prepares private friendly examples without replacing the device existing family access', async t => {
  const familyAccess = 'a'.repeat(64);
  const { bridge, call } = await fixture(t, { familyAccess });
  const response = await call(bridge.entryPath);
  assert.equal(response.status, 200);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['content-security-policy'], /default-src 'none'; script-src 'nonce-/);
  assert.doesNotMatch(response.text, /Only a fixture password|master@example/);
  const script = response.text.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const values = new Map([['playsport:demo-registration:access:mgr-A', 'previous-private-family']]);
  let destination;
  runInNewContext(script, {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    location: { replace: path => { destination = path; } },
  });
  assert.equal(values.size, 7);
  assert.equal(values.get('playsport:demo-registration:access:mgr-A'), 'previous-private-family');
  assert.equal(values.get('playsport:demo-registration:access:scorer-demo'), familyAccess);
  assert.equal(destination, '/account');
  const status = {};
  runInNewContext(script, {
    localStorage: { getItem: () => { throw new Error('Storage disabled'); } },
    document: { getElementById: () => status },
    location: { replace: () => assert.fail('Storage errors must be shown rather than silently ignored') },
  });
  assert.match(status.textContent, /No se pudieron abrir los ejemplos.*Storage disabled/);
  assert.equal((await call(bridge.entryPath)).status, 410);
});

test('LAN operations require the exact public origin, retain account authorization and forward only to the loopback web', async t => {
  const { call, received, origin } = await fixture(t);
  for (const headers of [{}, { origin: 'https://attacker.example' }, { origin: 'null' }])
    assert.equal((await call('/api/test', 'POST', headers, '{}')).status, 403);
  assert.equal((await call('//attacker.example/api/test')).status, 403);
  assert.equal((await call('http://attacker.example/api/test')).status, 403);
  assert.equal((await call('/api/test', 'DELETE', { origin: published })).status, 405);
  assert.equal(received.length, 0);
  const allowed = await call('/api/test', 'POST', {
    origin: published, cookie: 'playsport-account=test-session', 'content-type': 'application/json',
    'x-forwarded-host': 'attacker.example', forwarded: 'host=attacker.example', 'proxy-authorization': 'not-forwarded',
  }, '{"example":true}');
  assert.equal(allowed.status, 200);
  assert.equal(received[0].headers.origin, origin);
  assert.equal(received[0].headers.host, new URL(origin).host);
  assert.equal(received[0].headers['x-forwarded-host'], undefined);
  assert.equal(received[0].headers.forwarded, undefined);
  assert.equal(received[0].headers['proxy-authorization'], undefined);
  assert.equal(received[0].body, '{"example":true}');
  assert.equal((await call('/api/test', 'POST', { origin: published }, '{}')).status, 401);
  assert.equal((await call('/redirect')).headers.location, '/account');
});

test('direct scorer entry selects the requested role and current writable game without clearing any saved scorecard', async t => {
  const { bridge, call } = await fixture(t, { entryRole: 'scorekeeper' });
  const response = await call(bridge.entryPath);
  assert.equal(response.status, 200);
  const script = response.text.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const local = new Map([['private-scorecard-saved', 'keep-my-annotations']]);
  const session = new Map([['playsport:demo-session:v1', JSON.stringify({ version: 1, role: 'manager', team: 'team-B' })]]);
  let destination;
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  runInNewContext(script, {
    localStorage: storage(local), sessionStorage: storage(session),
    location: { replace: path => { destination = path; } },
  });
  assert.equal(destination, '/demo/live-scoring?view=scorekeeper&entry=live');
  assert.deepEqual(JSON.parse(session.get('playsport:demo-session:v1')), { version: 1, role: 'scorekeeper', team: 'team-A' });
  assert.deepEqual(JSON.parse(local.get('playsport:local-test-profile:v1')), {
    version: 1, accountId: credentials.accountId, session: { version: 1, role: 'scorekeeper', team: 'team-A' },
  });
  assert.equal(local.get('private-scorecard-saved'), 'keep-my-annotations');
  assert.equal(local.size, 2);
  assert.equal((await call(bridge.entryPath)).status, 410);
});

test('the mobile handoff does not accept a normal account in place of the configured test master', async t => {
  const { bridge, call } = await fixture(t, { account: { localTestAccess: false } });
  const response = await call(bridge.entryPath);
  assert.equal(response.status, 502);
  assert.equal(response.headers['set-cookie'], undefined);
});

test('sporting requests use same-origin browser paths and configurable server-side rewrites', async () => {
  const { readFileSync } = require('node:fs');
  for (const file of ['profile/page.tsx', 'player-sports-context.tsx', 'manager-tournament-picker.tsx',
    'demo/[slug]/live-scoring-manager-demo.tsx', 'demo/[slug]/manager-roster.tsx',
    'demo/[slug]/use-public-official-games.ts']) {
    const source = readFileSync(resolve(__dirname, '../app', file), 'utf8');
    assert.match(source, /NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE\s*\?\?\s*'\/api\/official-scoring'/, file);
    assert.doesNotMatch(source, /http:\/\/localhost:4000/, file);
  }
  const friendly = readFileSync(resolve(__dirname, '../app/demo/[slug]/friendly-games.tsx'), 'utf8');
  assert.match(friendly, /new FriendlyClient\('\/api'\)/);
  assert.doesNotMatch(friendly, /NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE|http:\/\/localhost:4000/);
  const config = (await import(pathToFileURL(resolve(__dirname, '../next.config.mjs')).href)).default;
  const previous = process.env.PLAYSPORT_SPORTING_API_BASE;
  try {
    for (const base of ['http://localhost:4000/api', 'https://api.example.test/api/']) {
      process.env.PLAYSPORT_SPORTING_API_BASE = base;
      const rewrites = await config('phase-development-server').rewrites();
      assert.deepEqual(rewrites, ['official-scoring', 'registration', 'friendly-games'].map(resource => ({
        source: `/api/${resource}/:path*`, destination: `${base.replace(/\/$/, '')}/${resource}/:path*`,
      })));
    }
  } finally {
    if (previous === undefined) delete process.env.PLAYSPORT_SPORTING_API_BASE; else process.env.PLAYSPORT_SPORTING_API_BASE = previous;
  }
});
