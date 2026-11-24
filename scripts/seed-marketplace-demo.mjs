import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = new URL(process.env.PLAYSPORT_LOCAL_API ?? 'http://localhost:4000/api/');
const origin = process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000';
if (process.env.NODE_ENV === 'production' || base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Los artículos ficticios solo se crean en una API local fuera de producción.');
}
const web = new URL(origin);
assert.ok(web.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(web.hostname), 'El origen de pruebas debe ser local.');
let cookie = '';
const call = async (path, data) => {
  const response = await fetch(new URL(path, base), { method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
  if (response.status === 204) {
    assert.equal(path, 'accounts/logout', 'Una operación distinta al cierre de sesión no devolvió su respuesta.');
    return null;
  }
  const result = await response.json();
  assert.ok(response.ok, `No se completó ${path}: ${JSON.stringify(result)}`);
  const next = response.headers.get('set-cookie'); if (next) cookie = next.split(';')[0];
  return result;
};
const path = fileURLToPath(new URL('../apps/api/.local/accounts/marketplace-vendor.json', import.meta.url));
let vendor;
if (existsSync(path)) {
  vendor = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(vendor.version === 1 && typeof vendor.accountId === 'string' && typeof vendor.password === 'string' &&
    typeof vendor.email === 'string' && Number.isFinite(vendor.seedTime), 'La configuración privada del vendedor de pruebas es inválida.');
} else {
  vendor = { version: 1, email: 'vendedor-marketplace@playsport.example.test', displayName: 'Tienda ficticia PlaySport',
    password: 'Vendedor-1' + randomBytes(24).toString('base64url'), seedTime: Date.now() };
  const result = await call('accounts/register', { email: vendor.email, displayName: vendor.displayName, password: vendor.password });
  vendor.accountId = result.account.id;
  writeFileSync(path, JSON.stringify(vendor, null, 2), { mode: 0o600, flag: 'wx' });
}
try {
  if (!cookie) {
    const login = await call('accounts/login', { email: vendor.email, password: vendor.password });
    assert.equal(login.account.id, vendor.accountId);
  }
  const feed = await call('marketplace');
  assert.equal(feed.viewer.id, vendor.accountId);
  const samples = [
    ['Guante de entrenamiento ficticio', 'equipment', 'sale', 3500, 5, null],
    ['Camiseta deportiva ficticia', 'clothing', 'sale', 1500, 8, null],
    ['Kit de pelotas de práctica ficticio', 'accessories', 'sale', 1200, 6, null],
    ['Bate deportivo ficticio · subasta rápida', 'equipment', 'auction', 2000, 1, vendor.seedTime + 8 * 60000],
    ['Jersey coleccionable ficticio', 'collectibles', 'auction', 4000, 1, vendor.seedTime + 86400000],
    ['Bolso deportivo ficticio · subasta', 'accessories', 'auction', 1000, 1, vendor.seedTime + 3 * 86400000]
  ];
  let created = 0;
  for (const [title, category, type, priceCents, stock, ends] of samples) {
    if (feed.myListings.some(item => item.title === title)) continue;
    await call('marketplace', { kind: 'publish', requestId: randomUUID(), title, category, type, priceCents, stock,
      description: 'Artículo completamente ficticio para probar PlaySport. No existe mercancía, cobro ni envío real. Puedes probar compras, consultas privadas y pujas con tu cuenta.',
      condition: 'new', location: 'Estadio de pruebas · ubicación ficticia', photo: null,
      stateId: 'VE-A', municipalityId: 'VE-A:libertador', sport: 'multisport', sportsOnly: true,
      incrementCents: type === 'auction' ? 100 : 0, endsAt: ends === null ? null : new Date(Math.max(ends, Date.now() + 8 * 60000)).toISOString() });
    created++;
  }
  console.log(JSON.stringify({ created, vendor: vendor.email, testOnly: true, existingListingsPreserved: true }));
} finally {
  if (cookie) await call('accounts/logout', {});
}
