import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
export function privateAddress(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part, index) => /^\d{1,3}$/.test(address.split('.')[index]) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

export function createMobileDemoServer({ upstreamOrigin, publicOrigin, credentials, accountId, familyAccess, entryRole, lifetimeMs = 30 * 60000 }) {
  if (process.env.NODE_ENV === 'production') throw new Error('El acceso de pruebas no está disponible en producción.');
  const upstream = new URL(upstreamOrigin), published = new URL(publicOrigin);
  if (upstream.protocol !== 'http:' || !loopback(upstream.hostname) || upstream.origin !== upstreamOrigin ||
      published.protocol !== 'http:' || !privateAddress(published.hostname) || published.origin !== publicOrigin)
    throw new Error('La demostración requiere una web local y una dirección privada de la red.');
  if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string' ||
      typeof accountId !== 'string' || credentials.accountId !== accountId)
    throw new Error('La configuración privada no corresponde a la cuenta maestra.');
  if (familyAccess !== undefined && !/^[a-f0-9]{64}$/.test(familyAccess))
    throw new Error('El acceso a los amistosos de ejemplo no es válido.');
  if (entryRole !== undefined && entryRole !== 'scorekeeper')
    throw new Error('El acceso directo de pruebas solo admite el rol de anotador.');
  const entryPath = `/entrar/${randomBytes(32).toString('base64url')}`;
  const expiresAt = Date.now() + lifetimeMs;
  let consumed = false;
  const sockets = new Set();
  const targetFor = request => {
    if (request.headers.host !== published.host || !request.url?.startsWith('/') || request.url.startsWith('//')) return null;
    const url = new URL(request.url, upstream);
    return url.origin === upstream.origin ? url : null;
  };
  const headersFor = request => {
    const headers = { ...request.headers, host: upstream.host };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];
    delete headers.forwarded;
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-')) delete headers[key];
    if (headers.origin) headers.origin = upstream.origin;
    return headers;
  };
  const failure = (response, status, message) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    response.end(message);
  };
  const server = http.createServer((request, response) => {
    const target = targetFor(request);
    if (!target) return failure(response, 403, 'Este acceso solo admite la dirección privada configurada.');
    if (request.headers.origin && request.headers.origin !== published.origin)
      return failure(response, 403, 'La solicitud no proviene de esta demostración.');
    if (target.pathname.startsWith('/entrar/')) {
      if (request.method !== 'GET') return failure(response, 405, 'Abre el enlace de acceso en el navegador.');
      if (target.pathname !== entryPath || target.search || consumed || Date.now() >= expiresAt)
        return failure(response, 410, 'El enlace no es válido, venció o ya fue utilizado. Solicita un enlace nuevo.');
      if (/prefetch/i.test(`${request.headers.purpose ?? ''} ${request.headers['sec-purpose'] ?? ''}`))
        return failure(response, 425, 'Abre el enlace directamente para iniciar la cuenta de pruebas.');
      consumed = true;
      void (async () => {
        const login = await fetch(new URL('/api/accounts/login', upstream), {
          method: 'POST', headers: { 'content-type': 'application/json', origin: upstream.origin },
          body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        if (!login.ok) throw new Error(`No se pudo iniciar la cuenta maestra (HTTP ${login.status}).`);
        const result = await login.json();
        if (result.account?.id !== accountId || result.account.localTestAccess !== true)
          throw new Error('El servicio no confirmó la cuenta maestra de pruebas.');
        const cookies = login.headers.getSetCookie().filter(cookie => cookie.startsWith('playsport-account='));
        if (cookies.length !== 1) throw new Error('El servicio no entregó una sesión de pruebas válida.');
        if (familyAccess || entryRole) {
          const nonce = randomBytes(24).toString('base64');
          const aliases = familyAccess ? ['fan-demo', 'player-demo', 'mgr-A', 'mgr-B', 'org-demo', 'scorer-demo', 'scout-demo'] : [];
          const preference = entryRole ? { version: 1, accountId, session: { version: 1, role: entryRole, team: 'team-A' } } : null;
          const destination = entryRole ? '/demo/live-scoring?view=scorekeeper&entry=live' : '/account';
          response.writeHead(200, {
            'set-cookie': cookies, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
            'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
          });
          response.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Abriendo PlaySport</title><p id="status">Abriendo tu cuenta y sus ejemplos…</p><script nonce="${nonce}">try { for (const alias of ${JSON.stringify(aliases)}) { const key = 'playsport:demo-registration:access:' + alias; if (localStorage.getItem(key) === null) localStorage.setItem(key, ${JSON.stringify(familyAccess)}); } const preference = ${JSON.stringify(preference)}; if (preference) { localStorage.setItem('playsport:local-test-profile:v1', JSON.stringify(preference)); sessionStorage.setItem('playsport:demo-session:v1', JSON.stringify(preference.session)); } location.replace(${JSON.stringify(destination)}); } catch (error) { document.getElementById('status').textContent = 'No se pudieron abrir los ejemplos. Permite el almacenamiento de este sitio y solicita un enlace nuevo. ' + error.message; }</script></html>`);
        } else {
          response.writeHead(303, { 'set-cookie': cookies, location: '/account', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
          response.end();
        }
      })().catch(error => {
        console.error(error.message);
        if (!response.headersSent) failure(response, 502, 'No se pudo abrir la cuenta maestra. Solicita un enlace nuevo; no se modificaron sus credenciales.');
        else response.destroy(error);
      });
      return;
    }
    if (!['GET', 'HEAD', 'POST'].includes(request.method ?? ''))
      return failure(response, 405, 'El método no está disponible en esta demostración.');
    if (request.method === 'POST' && request.headers.origin !== published.origin)
      return failure(response, 403, 'Las operaciones requieren el origen de esta demostración.');
    const upstreamRequest = http.request(target, { method: request.method, headers: headersFor(request) }, upstreamResponse => {
      const headers = { ...upstreamResponse.headers, 'referrer-policy': 'no-referrer' };
      if (headers.location) {
        const destination = new URL(headers.location, upstream);
        if (destination.origin === upstream.origin) headers.location = `${destination.pathname}${destination.search}${destination.hash}`;
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
      upstreamResponse.on('error', error => response.destroy(error));
    });
    upstreamRequest.setTimeout(30000, () => upstreamRequest.destroy(new Error('La web local no respondió a tiempo.')));
    upstreamRequest.on('error', error => {
      if (request.aborted || response.destroyed) return;
      console.error(`Demostración móvil: ${error.message}`);
      if (!response.headersSent) failure(response, 502, 'No se pudo conectar con PlaySport. Comprueba que la web local está activa.');
      else response.destroy(error);
    });
    request.on('aborted', () => upstreamRequest.destroy());
    request.on('error', error => upstreamRequest.destroy(error));
    response.on('close', () => { if (!response.writableFinished) upstreamRequest.destroy(); });
    request.pipe(upstreamRequest);
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (request, socket, head) => {
    const target = targetFor(request);
    if (!target || target.pathname !== '/_next/webpack-hmr' || request.headers.origin !== published.origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstreamRequest = http.request(target, { headers: headersFor(request) });
    upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}\r\n` +
        Object.entries(upstreamResponse.headers).map(([name, value]) => `${name}: ${value}\r\n`).join('') + '\r\n');
      if (head.length) upstreamSocket.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      socket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('close', () => upstreamSocket.destroy());
      upstreamSocket.on('close', () => socket.destroy());
    });
    upstreamRequest.on('response', upstreamResponse => { upstreamResponse.resume(); socket.end(); });
    upstreamRequest.on('error', error => { console.error(`Conexión de desarrollo: ${error.message}`); socket.destroy(); });
    upstreamRequest.setTimeout(10000, () => upstreamRequest.destroy(new Error('La conexión de desarrollo no respondió.')));
    upstreamRequest.end();
  });
  return { server, entryPath, expiresAt, close: () => { for (const socket of sockets) socket.destroy(); server.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const address = process.env.PLAYSPORT_MOBILE_DEMO_IP ??
      Object.values(networkInterfaces()).flat().find(item => item && !item.internal && item.family === 'IPv4' && privateAddress(item.address))?.address;
    const port = Number(process.env.PLAYSPORT_MOBILE_DEMO_PORT ?? 3100);
    if (!address || !privateAddress(address) || !Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Configura una dirección privada y un puerto local válido para el teléfono.');
    const accounts = fileURLToPath(new URL('../apps/api/.local/accounts/', import.meta.url));
    const tester = JSON.parse(readFileSync(resolve(accounts, 'local-tester.json'), 'utf8'));
    if (tester.version !== 1) throw new Error('La configuración de la cuenta maestra no es válida.');
    const publicOrigin = `http://${address}:${port}`;
    const familyPath = resolve(accounts, 'mobile-demo-family.json');
    let familyAccess;
    if (existsSync(familyPath)) {
      const family = JSON.parse(readFileSync(familyPath, 'utf8'));
      if (family.version !== 1 || family.accountId !== tester.accountId) throw new Error('Los amistosos de ejemplo no corresponden a la cuenta maestra.');
      familyAccess = family.key;
    }
    const demo = createMobileDemoServer({
      upstreamOrigin: 'http://localhost:3000', publicOrigin,
      credentials: JSON.parse(readFileSync(resolve(accounts, 'tester-credentials.json'), 'utf8')), accountId: tester.accountId, familyAccess,
      entryRole: process.env.PLAYSPORT_MOBILE_DEMO_ROLE,
    });
    demo.server.on('error', error => { console.error(`No se pudo abrir la demostración móvil: ${error.message}`); demo.close(); process.exitCode = 1; });
    demo.server.listen(port, address, () => {
      console.log(`ACCESO_MAESTRO_UN_SOLO_USO=${publicOrigin}${demo.entryPath}`);
      console.log(`ENLACE_VENCE=${new Date(demo.expiresAt).toISOString()}`);
      console.log(`DESPUES_DE_ENTRAR=${publicOrigin}${process.env.PLAYSPORT_MOBILE_DEMO_ROLE === 'scorekeeper' ? '/demo/live-scoring?view=scorekeeper&entry=live' : '/account'}`);
    });
    process.once('SIGINT', () => demo.close());
    process.once('SIGTERM', () => demo.close());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
