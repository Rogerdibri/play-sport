import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional, type OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readWalletRecharge, readWalletRequestRecharge, readWalletReviewRecharge, readWalletRechargeRequest, readWalletRequestResult,
  walletPaymentMethods, walletProofMaximumBytes, type WalletSnapshot, type WalletResult, type WalletRequestResult, type WalletRechargeRequest } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { commercePath, openCommerceDatabase } from '../commerce-database';
import { commerceCanModerate } from '../commerce-moderation';
import { WalletLedger } from './wallet-ledger';
type Options = { path: string; now?: () => number };
export type WalletProofUpload = { buffer: Buffer; originalname: string; mimetype: string; size: number };

@Injectable()
export class WalletService implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly accounts: AccountsService;
  private readonly now: () => number;
  private readonly ledger: WalletLedger;
  private readonly moderatorsPath: string;
  constructor(accounts: AccountsService, @Optional() options?: Options) {
    this.accounts = accounts; this.now = options?.now ?? Date.now;
    const path = commercePath(options?.path);
    this.moderatorsPath = resolve(dirname(path), 'moderators.json');
    this.db = openCommerceDatabase(path);
    this.ledger = new WalletLedger(this.db, this.now);
    try { this.transaction(() => this.ledger.initialize()); }
    catch (error) { this.db.close(); throw error; }
  }
  onModuleDestroy() { this.db.close(); }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private request(row: Record<string, unknown> | undefined): WalletRechargeRequest {
    if (!row) throw new NotFoundException('La solicitud de recarga no existe.');
    if (typeof row.payload !== 'string') throw new Error('La solicitud guardada no es válida.');
    return readWalletRechargeRequest(JSON.parse(row.payload));
  }
  read(token: string | undefined, before = Number.MAX_SAFE_INTEGER, beforeRecharge = Number.MAX_SAFE_INTEGER, beforeReview = Number.MAX_SAFE_INTEGER): WalletSnapshot {
    const account = this.accounts.authenticate(token);
    if ([before, beforeRecharge, beforeReview].some(value => !Number.isSafeInteger(value) || value < 1)) throw new BadRequestException('La página del historial no es válida.');
    return this.transaction(() => {
      const rows = this.ledger.movements(account.id, before);
      const recharges = this.db.prepare('SELECT payload FROM wallet_recharge_requests WHERE account_id=? AND id<? ORDER BY id DESC LIMIT 51').all(account.id, beforeRecharge).map(row => this.request(row));
      const canReviewRecharges = commerceCanModerate(account.id, this.moderatorsPath);
      const reviews = canReviewRecharges ? this.db.prepare("SELECT payload FROM wallet_recharge_requests WHERE status='pending' AND id<? ORDER BY id DESC LIMIT 51").all(beforeReview).map(row => this.request(row)) : [];
      return { mode: 'test', currency: 'USD_DEMO', accountId: account.id, balance: this.ledger.balance(account.id),
        serverNow: new Date(this.now()).toISOString(), movements: rows.slice(0, 50), hasMore: rows.length > 50,
        recharges: recharges.slice(0, 50), rechargesHasMore: recharges.length > 50, canReviewRecharges,
        rechargeReviews: reviews.slice(0, 50), rechargeReviewsHasMore: reviews.length > 50 };
    });
  }
  recharge(token: string | undefined, value: unknown, existingOnly = false): WalletResult {
    this.accounts.authenticate(token);
    let input;
    try { input = readWalletRecharge(value); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La recarga no es válida.'); }
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(() => {
      const account = this.accounts.authenticate(token);
      const previous = this.db.prepare('SELECT body_hash,event_id FROM wallet_commands WHERE account_id=? AND request_id=?').get(account.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices una solicitud de recarga con otro importe.');
        if (typeof previous.event_id !== 'number') throw new Error('La recarga guardada no es válida.');
        return { notice: 'Recarga registrada en tu billetera común.', eventId: previous.event_id };
      }
      if (existingOnly) throw new ConflictException('La recarga directa fue sustituida por solicitudes con método y comprobante. No se acreditó saldo.');
      const count = this.db.prepare('SELECT count(*) AS count FROM wallet_commands WHERE account_id=? AND created_at>?').get(account.id, this.now() - 60000)?.count;
      if (typeof count !== 'number') throw new Error('No se pudo comprobar el límite de recargas.');
      if (count >= 60) throw new HttpException('Demasiadas recargas. Espera un minuto.', 429);
      const eventId = this.ledger.recharge(account.id, input.amountCents, input.requestId);
      this.db.prepare('INSERT INTO wallet_commands VALUES(?,?,?,?,?)').run(account.id, input.requestId, hash, this.now(), eventId);
      return { notice: 'Recarga registrada en tu billetera común.', eventId };
    });
  }
  submit(token: string | undefined, value: unknown, upload: WalletProofUpload | undefined): WalletRequestResult {
    const account = this.accounts.authenticate(token);
    let input;
    try { input = readWalletRequestRecharge(value); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La solicitud de recarga no es válida.'); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se registró la recarga para otra cuenta.');
    if (!upload || !Buffer.isBuffer(upload.buffer) || upload.size !== upload.buffer.length || upload.size < 12 || upload.size > walletProofMaximumBytes) throw new BadRequestException('Adjunta un comprobante de prueba válido, de hasta 2 MB.');
    const bytes = upload.buffer;
    const formats = [
      { type: 'image/png', extension: /\.png$/i, valid: bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
      { type: 'image/jpeg', extension: /\.jpe?g$/i, valid: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 },
      { type: 'image/webp', extension: /\.webp$/i, valid: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' },
      { type: 'application/pdf', extension: /\.pdf$/i, valid: bytes.subarray(0, 5).toString() === '%PDF-' }
    ];
    const format = formats.find(format => format.type === upload.mimetype && format.valid);
    if (!format || !format.extension.test(upload.originalname) || upload.originalname.length > 100 ||
      /[/\\]/.test(upload.originalname) || [...upload.originalname].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new BadRequestException('El comprobante debe ser un archivo JPG, PNG, WebP o PDF con contenido y extensión correspondientes.');
    const proofHash = createHash('sha256').update(bytes).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(input)).update(upload.originalname).update(upload.mimetype).update(proofHash).digest('hex');
    const paymentKey = createHash('sha256').update(JSON.stringify([input.method, input.reference,
      input.method === 'transfer' || input.method === 'pagomovil' ? [input.details.bank.toUpperCase(), input.paidAt.slice(0, 10)] : null])).digest('hex');
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT payload,body_hash FROM wallet_recharge_requests WHERE account_id=? AND request_id=?').get(account.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices la solicitud con otros datos o comprobante.');
        return { notice: 'La solicitud ya está registrada. Consulta su estado; el reintento no la duplica.', rechargeId: this.request(previous).id };
      }
      if (Date.parse(input.paidAt) > this.now() + 300000 || Date.parse(input.paidAt) < this.now() - 365 * 86400000) throw new BadRequestException('La fecha del pago debe corresponder al último año y no estar en el futuro.');
      if (this.db.prepare("SELECT id FROM wallet_recharge_requests WHERE status!='rejected' AND (payment_key=? OR proof_hash=?)").get(paymentKey, proofHash)) throw new ConflictException('Esta referencia de pago o comprobante ya tiene una solicitud pendiente o aprobada.');
      const limits = this.db.prepare("SELECT count(*) FILTER(WHERE status='pending') AS pending, count(*) FILTER(WHERE created_at>?) AS recent, COALESCE(sum(length(proof)),0) AS bytes FROM wallet_recharge_requests WHERE account_id=?").get(this.now() - 60000, account.id);
      if (!limits || typeof limits.pending !== 'number' || typeof limits.recent !== 'number' || typeof limits.bytes !== 'number') throw new Error('No se pudieron comprobar los límites de solicitudes.');
      if (limits.pending >= 10) throw new ConflictException('Tienes 10 recargas pendientes. Espera su revisión antes de enviar otra.');
      if (limits.recent >= 60) throw new HttpException('Demasiadas solicitudes de recarga. Espera un minuto.', 429);
      if (limits.bytes + upload.size > 40 * 1024 * 1024) throw new HttpException('Alcanzaste el límite de 40 MB de comprobantes de esta demo.', 413);
      const id = this.db.prepare('SELECT COALESCE(max(id),0)+1 AS id FROM wallet_recharge_requests').get()?.id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) throw new Error('No se pudo asignar la solicitud.');
      const request: WalletRechargeRequest = { id, accountId: account.id, amountCents: input.amountCents, method: input.method,
        payerName: input.payerName, paidAt: input.paidAt, reference: input.reference, details: input.details, status: 'pending',
        createdAt: new Date(this.now()).toISOString(), proof: { name: upload.originalname, type: upload.mimetype, size: upload.size },
        reviewedAt: null, reviewerId: null, reason: null, eventId: null };
      this.db.prepare("INSERT INTO wallet_recharge_requests VALUES(?,?,?,?,?,?,?,?,?,'pending')").run(id, account.id, input.requestId, hash, paymentKey, proofHash, bytes, JSON.stringify(request), this.now());
      return { notice: 'Solicitud enviada para revisión. El saldo se acredita solo al aprobarla.', rechargeId: id };
    });
  }
  review(token: string | undefined, value: unknown): WalletRequestResult {
    const account = this.accounts.authenticate(token);
    if (!commerceCanModerate(account.id, this.moderatorsPath)) throw new ForbiddenException('Tu cuenta no tiene permiso para revisar recargas locales.');
    let input;
    try { input = readWalletReviewRecharge(value); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La revisión no es válida.'); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se revisó la recarga.');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT body_hash,result FROM wallet_recharge_reviews WHERE account_id=? AND request_id=?').get(account.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices la revisión con otra decisión o motivo.');
        if (typeof previous.result !== 'string') throw new Error('La revisión guardada no es válida.');
        return readWalletRequestResult(JSON.parse(previous.result));
      }
      const request = this.request(this.db.prepare('SELECT payload FROM wallet_recharge_requests WHERE id=?').get(input.rechargeId));
      if (request.status !== 'pending') throw new ConflictException('La recarga ya fue revisada. No se volvió a acreditar saldo.');
      if (request.accountId === account.id && !input.demoSelfReview) throw new ForbiddenException('Otra cuenta moderadora debe revisar tu recarga, salvo autorrevisión explícita solo para la demo.');
      const method = walletPaymentMethods.find(method => method.id === request.method);
      if (!method) throw new Error('El método de recarga guardado no es válido.');
      const eventId = input.decision === 'approve' ? this.ledger.recharge(request.accountId, request.amountCents, `reviewed:${request.id}`, `Recarga aprobada · ${method.label} · solicitud #${request.id}`) : null;
      const reviewed: WalletRechargeRequest = { ...request, status: input.decision === 'approve' ? 'approved' : 'rejected',
        reviewedAt: new Date(this.now()).toISOString(), reviewerId: account.id, reason: input.reason, eventId };
      this.db.prepare('UPDATE wallet_recharge_requests SET status=?,payload=? WHERE id=?').run(reviewed.status, JSON.stringify(reviewed), request.id);
      const result = { notice: input.decision === 'approve' ? `Recarga por ${method.label} aprobada y acreditada una sola vez.` : 'Recarga rechazada. No se acreditó saldo.', rechargeId: request.id };
      this.db.prepare('INSERT INTO wallet_recharge_reviews VALUES(?,?,?,?,?,?)').run(account.id, input.requestId, request.id, hash, JSON.stringify(result), this.now());
      return result;
    });
  }
  proof(token: string | undefined, id: number): { buffer: Uint8Array; name: string; type: string } {
    const account = this.accounts.authenticate(token);
    if (!Number.isSafeInteger(id) || id < 1) throw new BadRequestException('La solicitud no es válida.');
    const row = this.db.prepare('SELECT account_id,payload,proof FROM wallet_recharge_requests WHERE id=?').get(id);
    if (!row || row.account_id !== account.id && !commerceCanModerate(account.id, this.moderatorsPath)) throw new NotFoundException('El comprobante no está disponible para tu cuenta.');
    const request = this.request(row);
    if (!(row.proof instanceof Uint8Array)) throw new Error('El comprobante guardado no es válido.');
    return { buffer: row.proof, name: request.proof.name, type: request.proof.type };
  }
}
