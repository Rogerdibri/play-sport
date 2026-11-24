export const walletMaximumCents = 1000000000000;
export const walletRechargeMaximumCents = 100000000;
export type WalletBalance = { availableCents: number; heldCents: number; totalCents: number };
export type WalletAction = 'recharge' | 'hold' | 'refund' | 'release' | 'award';
export type WalletMovement = {
  id: number; eventId: number; action: WalletAction; module: 'wallet' | 'marketplace';
  reference: string; description: string; amountCents: number;
  availableDelta: number; heldDelta: number; createdAt: string;
};
export type WalletSnapshot = {
  mode: 'test'; currency: 'USD_DEMO'; accountId: string; balance: WalletBalance;
  serverNow: string; movements: WalletMovement[]; hasMore: boolean;
  recharges: WalletRechargeRequest[]; rechargesHasMore: boolean; canReviewRecharges: boolean;
  rechargeReviews: WalletRechargeRequest[]; rechargeReviewsHasMore: boolean;
};
export type WalletRecharge = { kind: 'recharge'; requestId: string; amountCents: number };
export type WalletResult = { notice: string; eventId: number };
export const walletProofMaximumBytes = 2 * 1024 * 1024;
export const walletDemoBolivarsPerDollar = 100;
export const walletPaymentMethods = [
  { id: 'transfer', label: 'Transferencia bancaria', currency: 'Bs',
    destination: ['Banco de ejemplo · código 0000 (no operativo)', 'Beneficiario: PlaySport DEMO', 'Cuenta: 00000000000000000000', 'Documento: DEMO-00000000'],
    fields: [{ key: 'bank', label: 'Banco de origen', placeholder: 'Nombre del banco', format: 'text' },
      { key: 'accountLastFour', label: 'Últimos 4 dígitos de la cuenta de origen', placeholder: '0000', format: 'digits' },
      { key: 'identification', label: 'Documento del titular', placeholder: 'Documento del titular', format: 'text' }] },
  { id: 'pagomovil', label: 'Pago Móvil', currency: 'Bs',
    destination: ['Banco de ejemplo · código 0000 (no operativo)', 'Teléfono: 0400-0000000 (no operativo)', 'Documento: DEMO-00000000', 'Beneficiario: PlaySport DEMO'],
    fields: [{ key: 'bank', label: 'Banco de origen', placeholder: 'Nombre del banco', format: 'text' },
      { key: 'phone', label: 'Teléfono del pagador · 11 dígitos', placeholder: '04000000000', format: 'phone' },
      { key: 'identification', label: 'Documento del titular', placeholder: 'Documento del titular', format: 'text' }] },
  { id: 'zelle', label: 'Zelle', currency: 'USD',
    destination: ['Beneficiario: PlaySport DEMO', 'Correo: pagos@playsport.example.invalid', 'Este correo no recibe pagos ni mensajes.'],
    fields: [{ key: 'email', label: 'Correo del remitente', placeholder: 'pagador@example.invalid', format: 'email' }] },
  { id: 'binance', label: 'Binance', currency: 'USDT',
    destination: ['Binance Pay · sin redes blockchain', 'Pay ID: DEMO-PLAYSPORT-0000', 'Activo: USDT · 1 USDT = 1 USD', 'Este ID no recibe fondos.'],
    fields: [{ key: 'payId', label: 'Binance Pay ID del remitente', placeholder: 'ID del remitente', format: 'text' }] }
] as const;
export type WalletPaymentMethod = typeof walletPaymentMethods[number]['id'];
export type WalletRequestRecharge = {
  kind: 'request-recharge'; requestId: string; expectedAccountId: string; amountCents: number; method: WalletPaymentMethod;
  payerName: string; paidAt: string; reference: string; details: Record<string, string>;
};
export type WalletReviewRecharge = {
  kind: 'review-recharge'; requestId: string; expectedAccountId: string; rechargeId: number; decision: 'approve' | 'reject';
  reason: string; demoSelfReview: boolean;
};
export type WalletRechargeRequest = Omit<WalletRequestRecharge, 'kind' | 'requestId' | 'expectedAccountId'> & {
  id: number; accountId: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string;
  proof: { name: string; type: string; size: number }; reviewedAt: string | null;
  reviewerId: string | null; reason: string | null; eventId: number | null;
};
export type WalletRequestResult = { notice: string; rechargeId: number };
export type WalletPendingRecharge = WalletRecharge | {
  kind: 'pending-recharge'; input: WalletRequestRecharge; proof: { name: string; data: string };
};
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los datos de la billetera no son válidos.');
  return Object.fromEntries(Object.entries(value));
}
function integer(value: unknown, min = 0, max = walletMaximumCents): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('El importe de la billetera no es válido.');
  return value;
}
function text(value: unknown, max = 240): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('El texto de la billetera no es válido.');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('La fecha de la billetera no es válida.');
  return value;
}
export function readWalletBalance(value: unknown): WalletBalance {
  const v = object(value), availableCents = integer(v.availableCents), heldCents = integer(v.heldCents), totalCents = integer(v.totalCents);
  if (availableCents + heldCents !== totalCents) throw new Error('El saldo de la billetera no coincide con sus componentes.');
  return { availableCents, heldCents, totalCents };
}
export function readWalletRecharge(value: unknown): WalletRecharge {
  const v = object(value);
  if (v.kind !== 'recharge' || typeof v.requestId !== 'string' || !uuid.test(v.requestId) ||
    Object.keys(v).some(key => !['kind', 'requestId', 'amountCents'].includes(key))) throw new Error('La recarga contiene campos o una clave de solicitud inválidos.');
  return { kind: 'recharge', requestId: v.requestId, amountCents: integer(v.amountCents, 1, walletRechargeMaximumCents) };
}
export function readWalletQuery(entries: Iterable<readonly [string, unknown]>): { before?: number; beforeRecharge?: number; beforeReview?: number } {
  const result: { before?: number; beforeRecharge?: number; beforeReview?: number } = {};
  for (const [key, value] of entries) {
    if (key !== 'before' && key !== 'beforeRecharge' && key !== 'beforeReview' ||
      result[key] !== undefined || typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('La consulta de la billetera no es válida.');
    result[key] = integer(Number(value), 1, Number.MAX_SAFE_INTEGER);
  }
  return result;
}
export function readWalletSnapshot(value: unknown): WalletSnapshot {
  const v = object(value);
  if (v.mode !== 'test' || v.currency !== 'USD_DEMO' || typeof v.accountId !== 'string' || !uuid.test(v.accountId) ||
    !Array.isArray(v.movements) || typeof v.hasMore !== 'boolean') throw new Error('La respuesta de la billetera no es válida.');
  const movements = v.movements.map((value): WalletMovement => {
    const m = object(value);
    if (!['recharge', 'hold', 'refund', 'release', 'award'].includes(String(m.action)) ||
      m.module !== 'wallet' && m.module !== 'marketplace') throw new Error('El movimiento de la billetera no es válido.');
    const action = (['recharge', 'hold', 'refund', 'release', 'award'] as const).find(action => action === m.action);
    if (!action) throw new Error('El movimiento de la billetera no es válido.');
    return { id: integer(m.id, 1, Number.MAX_SAFE_INTEGER), eventId: integer(m.eventId, 1, Number.MAX_SAFE_INTEGER),
      action, module: m.module, reference: text(m.reference, 100), description: text(m.description),
      amountCents: integer(m.amountCents, 1), availableDelta: integer(m.availableDelta, -walletMaximumCents),
      heldDelta: integer(m.heldDelta, -walletMaximumCents), createdAt: date(m.createdAt) };
  });
  for (const key of ['rechargesHasMore', 'canReviewRecharges', 'rechargeReviewsHasMore']) {
    if (v[key] !== undefined && typeof v[key] !== 'boolean') throw new Error('Los permisos o páginas de recargas no son válidos.');
  }
  const requests = (value: unknown) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new Error('El historial de recargas no es válido.');
    return value.map(readWalletRechargeRequest);
  };
  return { mode: 'test', currency: 'USD_DEMO', accountId: v.accountId, balance: readWalletBalance(v.balance), serverNow: date(v.serverNow), movements, hasMore: v.hasMore,
    recharges: requests(v.recharges), rechargesHasMore: v.rechargesHasMore === true, canReviewRecharges: v.canReviewRecharges === true,
    rechargeReviews: requests(v.rechargeReviews), rechargeReviewsHasMore: v.rechargeReviewsHasMore === true };
}
export function readWalletResult(value: unknown): WalletResult {
  const v = object(value);
  return { notice: text(v.notice), eventId: integer(v.eventId, 1, Number.MAX_SAFE_INTEGER) };
}
export function readWalletRequestRecharge(value: unknown): WalletRequestRecharge {
  const v = object(value);
  if (v.kind !== 'request-recharge' || typeof v.requestId !== 'string' || !uuid.test(v.requestId) || typeof v.expectedAccountId !== 'string' || !uuid.test(v.expectedAccountId) ||
    Object.keys(v).some(key => !['kind', 'requestId', 'expectedAccountId', 'amountCents', 'method', 'payerName', 'paidAt', 'reference', 'details'].includes(key))) throw new Error('La solicitud de recarga contiene campos inválidos.');
  const method = walletPaymentMethods.find(method => method.id === v.method);
  if (!method) throw new Error('Selecciona un método de recarga válido.');
  const input = object(v.details), details: Record<string, string> = {};
  if (Object.keys(input).some(key => !method.fields.some(field => field.key === key))) throw new Error('El método de recarga contiene datos adicionales.');
  for (const field of method.fields) {
    const value = text(input[field.key], 100).trim();
    if (field.format === 'digits' && !/^\d{4}$/.test(value) ||
      field.format === 'phone' && !/^0\d{10}$/.test(value) ||
      field.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Revisa el campo: ${field.label}.`);
    details[field.key] = value;
  }
  const reference = text(v.reference, 100).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{5,99}$/.test(reference)) throw new Error('La referencia debe tener entre 6 y 100 letras, números, puntos o guiones.');
  return { kind: 'request-recharge', requestId: v.requestId, expectedAccountId: v.expectedAccountId, amountCents: integer(v.amountCents, 1, walletRechargeMaximumCents),
    method: method.id, payerName: text(v.payerName, 100).trim(), paidAt: new Date(date(v.paidAt)).toISOString(), reference, details };
}
export function readWalletReviewRecharge(value: unknown): WalletReviewRecharge {
  const v = object(value);
  if (v.kind !== 'review-recharge' || typeof v.requestId !== 'string' || !uuid.test(v.requestId) || typeof v.expectedAccountId !== 'string' || !uuid.test(v.expectedAccountId) ||
    v.decision !== 'approve' && v.decision !== 'reject' || typeof v.demoSelfReview !== 'boolean' ||
    Object.keys(v).some(key => !['kind', 'requestId', 'expectedAccountId', 'rechargeId', 'decision', 'reason', 'demoSelfReview'].includes(key))) throw new Error('La revisión de recarga contiene campos inválidos.');
  const reason = text(v.reason, 240).trim();
  if (reason.length < 3) throw new Error('Explica el motivo de la aprobación o rechazo.');
  return { kind: 'review-recharge', requestId: v.requestId, expectedAccountId: v.expectedAccountId, rechargeId: integer(v.rechargeId, 1, Number.MAX_SAFE_INTEGER), decision: v.decision, reason, demoSelfReview: v.demoSelfReview };
}
export function readWalletRechargeRequest(value: unknown): WalletRechargeRequest {
  const v = object(value), proof = object(v.proof);
  const input = readWalletRequestRecharge({ kind: 'request-recharge', requestId: '00000000-0000-0000-0000-000000000000',
    expectedAccountId: v.accountId, amountCents: v.amountCents, method: v.method, payerName: v.payerName, paidAt: v.paidAt, reference: v.reference, details: v.details });
  if (typeof v.accountId !== 'string' || !uuid.test(v.accountId) || v.status !== 'pending' && v.status !== 'approved' && v.status !== 'rejected' ||
    !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(String(proof.type))) throw new Error('La recarga guardada no es válida.');
  const reviewedAt = v.reviewedAt === null ? null : date(v.reviewedAt);
  const reviewerId = v.reviewerId === null ? null : text(v.reviewerId, 36);
  const reason = v.reason === null ? null : text(v.reason, 240);
  const eventId = v.eventId === null ? null : integer(v.eventId, 1, Number.MAX_SAFE_INTEGER);
  if (reviewerId && !uuid.test(reviewerId) || v.status === 'pending' && (reviewedAt !== null || reviewerId !== null || reason !== null || eventId !== null) ||
    v.status !== 'pending' && (!reviewedAt || !reviewerId || !reason) || v.status === 'approved' && eventId === null || v.status === 'rejected' && eventId !== null) throw new Error('El estado de revisión de la recarga no es válido.');
  return { id: integer(v.id, 1, Number.MAX_SAFE_INTEGER), accountId: v.accountId, amountCents: input.amountCents, method: input.method,
    payerName: input.payerName, paidAt: input.paidAt, reference: input.reference, details: input.details, status: v.status,
    createdAt: date(v.createdAt), proof: { name: text(proof.name, 100), type: String(proof.type), size: integer(proof.size, 1, walletProofMaximumBytes) },
    reviewedAt, reviewerId, reason, eventId };
}
export function readWalletRequestResult(value: unknown): WalletRequestResult {
  const v = object(value);
  return { notice: text(v.notice), rechargeId: integer(v.rechargeId, 1, Number.MAX_SAFE_INTEGER) };
}
export function readWalletPendingRecharge(value: unknown): WalletPendingRecharge {
  const v = object(value);
  if (v.kind === 'recharge') return readWalletRecharge(v);
  const proof = object(v.proof);
  if (v.kind !== 'pending-recharge' || typeof proof.data !== 'string' ||
    proof.data.length > Math.ceil(walletProofMaximumBytes / 3) * 4 + 100 ||
    !/^data:(?:image\/(?:jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/.test(proof.data)) throw new Error('El comprobante pendiente no se pudo recuperar.');
  return { kind: 'pending-recharge', input: readWalletRequestRecharge(v.input), proof: { name: text(proof.name, 100), data: proof.data } };
}
