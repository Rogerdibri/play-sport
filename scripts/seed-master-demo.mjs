import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newSportsRoleCard, newSportsSheet, platformRoles, readSportsSheetSnapshot, readWalletSnapshot } from '@playsport/shared';

if (process.env.NODE_ENV === 'production') throw new Error('Los ejemplos maestros solo se preparan en desarrollo local.');
const origin = 'http://localhost:3000';
const credentials = JSON.parse(readFileSync(fileURLToPath(new URL('../apps/api/.local/accounts/tester-credentials.json', import.meta.url)), 'utf8'));
const tester = JSON.parse(readFileSync(fileURLToPath(new URL('../apps/api/.local/accounts/local-tester.json', import.meta.url)), 'utf8'));
assert.equal(tester.version, 1);
assert.equal(credentials.accountId, tester.accountId);
const login = await fetch(`${origin}/api/accounts/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }), signal: AbortSignal.timeout(10000),
});
assert.ok(login.ok, `No se pudo abrir la cuenta maestra (HTTP ${login.status}).`);
const { account } = await login.json();
assert.ok(account?.id === tester.accountId && account.localTestAccess === true && account.financialAccess === false,
  'La cuenta debe ser la maestra ficticia, sin acceso a dinero real.');
const cookie = login.headers.getSetCookie().filter(value => value.startsWith('playsport-account=')).map(value => value.split(';')[0]).join('; ');
assert.ok(cookie, 'No se recibió la sesión de pruebas.');
const call = async (path, body) => {
  const multipart = body instanceof FormData;
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { origin, cookie, ...(!multipart ? { 'content-type': 'application/json' } : {}) },
    body: body ? multipart ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return null;
  const result = await response.json();
  assert.ok(response.ok, `No se completó ${path} (HTTP ${response.status}): ${result.message ?? 'respuesta no válida'}`);
  return result;
};
function receipt() {
  const content = 'BT /F1 14 Tf 40 170 Td (PLAYSPORT - SOLO EJEMPLO, SIN DINERO REAL) Tj 0 -25 Td (Saldo ficticio: 100 USD_DEMO. No existe pago bancario.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
    offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([document], { type: 'application/pdf' });
}
try {
  const wallet = readWalletSnapshot(await call('/api/wallet'));
  assert.equal(wallet.accountId, account.id);
  const reference = 'PLAYSPORT-EJEMPLO-MOVIL-01';
  const existing = wallet.recharges.find(request => request.reference === reference);
  const pristine = wallet.balance.totalCents === 0 && wallet.movements.length === 0 && wallet.recharges.length === 0;
  if (pristine || existing?.status === 'pending')
    assert.ok(wallet.canReviewRecharges, 'La cuenta maestra no está autorizada para revisar la recarga ficticia. No se ampliaron sus permisos.');
  const sheet = readSportsSheetSnapshot(await call('/api/sports-sheet/me'), account.id);
  let sheetCreated = false;
  if (sheet.revision === 0 && JSON.stringify(sheet.document) === JSON.stringify(newSportsSheet())) {
    await call('/api/sports-sheet/me', {
      expectedAccountId: account.id, expectedRevision: 0,
      document: {
        ...newSportsSheet(), sportingName: 'Pelotero de ejemplo', city: 'Valencia', sports: ['Béisbol', 'Softbol'],
        cards: platformRoles.map(role => ({
          ...newSportsRoleCard(role.id),
          specialty: role.id === 'player' ? 'Softbol de lanzamiento lento' : '',
          category: 'Adultos', positions: role.id === 'player' ? 'Campocorto · Segunda base' : '',
          number: role.id === 'player' ? '12' : '', bats: role.id === 'player' ? 'right' : '',
          throws: role.id === 'player' ? 'right' : '', available: role.id === 'player',
        })),
      },
    });
    sheetCreated = true;
  }
  let rechargeId = existing?.id;
  if (pristine) {
    const form = new FormData();
    form.set('input', JSON.stringify({
      kind: 'request-recharge', requestId: '305cc6c8-beb5-4cf1-bbe6-c01db9c5e033', expectedAccountId: account.id,
      amountCents: 10000, method: 'transfer', payerName: 'Cuenta maestra de ejemplo', paidAt: new Date().toISOString(),
      reference, details: { bank: 'BANCO DE EJEMPLO NO OPERATIVO', accountLastFour: '0000', identification: 'EJEMPLO000' },
    }));
    form.set('proof', receipt(), 'comprobante-ficticio-playsport.pdf');
    rechargeId = (await call('/api/wallet/recharges', form)).rechargeId;
  }
  if (pristine || existing?.status === 'pending') {
    await call('/api/wallet', {
      kind: 'review-recharge', requestId: '889f4795-aeb0-4bfa-b61c-8e766fe83547', expectedAccountId: account.id,
      rechargeId, decision: 'approve', demoSelfReview: true,
      reason: 'Ejemplo solicitado para recorrer la cuenta maestra desde el teléfono. Comprobante sintético, sin pago ni dinero real.',
    });
  }
  const finalWallet = readWalletSnapshot(await call('/api/wallet'));
  const finalSheet = readSportsSheetSnapshot(await call('/api/sports-sheet/me'), account.id);
  assert.ok(!pristine || finalWallet.balance.availableCents === 10000, 'No se confirmó el saldo ficticio solicitado.');
  const friendly = await call('/api/friendly-games');
  assert.ok(Array.isArray(friendly.games), 'No se pudo consultar la lista privada de amistosos de ejemplo.');
  for (const [sport, home, away] of [
    ['baseball', 'Guardianes de ejemplo con banca', 'Titanes de ejemplo con banca'],
    ['softball', 'Estrellas de ejemplo con banca', 'Halcones de ejemplo con banca'],
  ]) {
    if (friendly.games.some(game => game.sport === sport && game.seed.names.home === home && game.seed.names.away === away)) continue;
    await call('/api/friendly-games', {
      sport, names: { home, away },
      substitutes: {
        home: ['Reserva local de ejemplo 1', 'Reserva local de ejemplo 2'],
        away: ['Reserva visitante de ejemplo 1', 'Reserva visitante de ejemplo 2'],
      },
      lineups: Object.fromEntries(['home', 'away'].map(side => [side,
        ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'].map((position, index) => ({
          name: `Jugador ${side === 'home' ? 'local' : 'visitante'} de ejemplo ${index + 1}`, position,
        })),
      ])),
    });
  }
  const finalFriendly = await call('/api/friendly-games');
  assert.ok(finalFriendly.games.length >= 2, 'No se confirmaron los amistosos ficticios.');
  console.log(JSON.stringify({ masterExamplesReady: true, sheetCreated, sportsCards: finalSheet.document.cards.length,
    walletMode: finalWallet.mode, currency: finalWallet.currency, availableCents: finalWallet.balance.availableCents,
    privateFriendlyGames: finalFriendly.games.length, existingRecordsPreserved: true }));
} finally {
  await call('/api/accounts/logout', {});
}
