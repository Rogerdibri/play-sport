import { ConflictException, HttpException } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { walletMaximumCents, type WalletAction, type WalletBalance, type WalletMovement } from '@playsport/shared';

type Entry = { accountId: string; available: number; held: number };
type Hold = { accountId: string; amount: number; status: string };
const issuance = 'system:fictional-issuance';
export class WalletLedger {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number) { this.db = db; this.now = now; }
  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_schema(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL) STRICT;
      INSERT INTO wallet_schema VALUES(1,1) ON CONFLICT(id) DO NOTHING;
    `);
    const version = this.db.prepare('SELECT version FROM wallet_schema WHERE id=1').get()?.version;
    if (version !== 1 && version !== 2) throw new Error('La versión de la billetera no es compatible.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_events(id INTEGER PRIMARY KEY, action TEXT NOT NULL, module TEXT NOT NULL,
        reference TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
        operation_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS wallet_entries(id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES wallet_events(id),
        account_id TEXT NOT NULL, available_delta INTEGER NOT NULL, held_delta INTEGER NOT NULL,
        UNIQUE(event_id,account_id)) STRICT;
      CREATE INDEX IF NOT EXISTS wallet_account_entries ON wallet_entries(account_id,id);
      CREATE TABLE IF NOT EXISTS wallet_holds(reference TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0),
        status TEXT NOT NULL CHECK(status IN ('held','released','refunded','converted'))) STRICT;
      CREATE TABLE IF NOT EXISTS wallet_commands(account_id TEXT NOT NULL, request_id TEXT NOT NULL, body_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, event_id INTEGER NOT NULL REFERENCES wallet_events(id), PRIMARY KEY(account_id,request_id)) STRICT;
      CREATE INDEX IF NOT EXISTS wallet_command_rate ON wallet_commands(account_id,created_at);
      CREATE TRIGGER IF NOT EXISTS wallet_events_no_update BEFORE UPDATE ON wallet_events BEGIN SELECT RAISE(ABORT,'Immutable wallet events'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_events_no_delete BEFORE DELETE ON wallet_events BEGIN SELECT RAISE(ABORT,'Immutable wallet events'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_entries_no_update BEFORE UPDATE ON wallet_entries BEGIN SELECT RAISE(ABORT,'Immutable wallet entries'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_entries_no_delete BEFORE DELETE ON wallet_entries BEGIN SELECT RAISE(ABORT,'Immutable wallet entries'); END;
      CREATE TABLE IF NOT EXISTS wallet_recharge_requests(id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, request_id TEXT NOT NULL,
        body_hash TEXT NOT NULL, payment_key TEXT NOT NULL, proof_hash TEXT NOT NULL, proof BLOB NOT NULL, payload TEXT NOT NULL,
        created_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
        UNIQUE(account_id,request_id)) STRICT;
      CREATE INDEX IF NOT EXISTS wallet_recharge_account ON wallet_recharge_requests(account_id,id);
      CREATE INDEX IF NOT EXISTS wallet_recharge_queue ON wallet_recharge_requests(status,id);
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_recharge_payment ON wallet_recharge_requests(payment_key) WHERE status!='rejected';
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_recharge_proof ON wallet_recharge_requests(proof_hash) WHERE status!='rejected';
      CREATE TABLE IF NOT EXISTS wallet_recharge_reviews(account_id TEXT NOT NULL, request_id TEXT NOT NULL,
        recharge_id INTEGER NOT NULL REFERENCES wallet_recharge_requests(id), body_hash TEXT NOT NULL, result TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(account_id,request_id)) STRICT;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_no_delete BEFORE DELETE ON wallet_recharge_requests BEGIN SELECT RAISE(ABORT,'Immutable recharge submission'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_no_edit BEFORE UPDATE OF account_id,request_id,body_hash,payment_key,proof_hash,proof,created_at ON wallet_recharge_requests
        BEGIN SELECT RAISE(ABORT,'Immutable recharge submission'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_final BEFORE UPDATE ON wallet_recharge_requests WHEN OLD.status!='pending'
        BEGIN SELECT RAISE(ABORT,'Final recharge decision'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_payload_no_edit BEFORE UPDATE OF payload ON wallet_recharge_requests
        WHEN json_remove(OLD.payload,'$.status','$.reviewedAt','$.reviewerId','$.reason','$.eventId') != json_remove(NEW.payload,'$.status','$.reviewedAt','$.reviewerId','$.reason','$.eventId')
        BEGIN SELECT RAISE(ABORT,'Immutable recharge details'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_reviews_no_update BEFORE UPDATE ON wallet_recharge_reviews BEGIN SELECT RAISE(ABORT,'Immutable recharge review'); END;
      CREATE TRIGGER IF NOT EXISTS wallet_recharge_reviews_no_delete BEFORE DELETE ON wallet_recharge_reviews BEGIN SELECT RAISE(ABORT,'Immutable recharge review'); END;
      UPDATE wallet_schema SET version=2 WHERE id=1;
    `);
  }
  private number(value: unknown, min = 0, max = walletMaximumCents): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('La billetera contiene un importe inválido.');
    return value;
  }
  balance(accountId: string): WalletBalance {
    const row = this.db.prepare('SELECT COALESCE(sum(available_delta),0) AS available,COALESCE(sum(held_delta),0) AS held FROM wallet_entries WHERE account_id=?').get(accountId);
    const availableCents = this.number(row?.available), heldCents = this.number(row?.held);
    return { availableCents, heldCents, totalCents: this.number(availableCents + heldCents) };
  }
  private post(action: WalletAction, module: 'wallet' | 'marketplace', reference: string, amount: number, key: string, description: string, entries: Entry[]): number {
    this.number(amount, 1);
    if (entries.reduce((sum, entry) => sum + entry.available + entry.held, 0) !== 0 || new Set(entries.map(entry => entry.accountId)).size !== entries.length) throw new Error('El movimiento contable no está equilibrado.');
    for (const entry of entries) {
      this.number(entry.available, -walletMaximumCents); this.number(entry.held, -walletMaximumCents);
      if (entry.accountId !== issuance) {
        const balance = this.balance(entry.accountId), available = balance.availableCents + entry.available, held = balance.heldCents + entry.held;
        if (available < 0 || held < 0) throw new HttpException('Saldo disponible insuficiente. Recarga tu billetera antes de continuar.', 402);
        if (available + held > walletMaximumCents) throw new ConflictException('La billetera alcanzaría el límite de saldo permitido.');
      }
    }
    const id = this.number(Number(this.db.prepare('INSERT INTO wallet_events(action,module,reference,description,amount,operation_key,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(action, module, reference, description, amount, key, this.now()).lastInsertRowid), 1, Number.MAX_SAFE_INTEGER);
    for (const entry of entries) this.db.prepare('INSERT INTO wallet_entries(event_id,account_id,available_delta,held_delta) VALUES(?,?,?,?)').run(id, entry.accountId, entry.available, entry.held);
    return id;
  }
  recharge(accountId: string, amount: number, requestId: string, description = 'Recarga de la billetera común'): number {
    return this.post('recharge', 'wallet', `recharge:${requestId}`, amount, `recharge:${accountId}:${requestId}`, description,
      [{ accountId, available: amount, held: 0 }, { accountId: issuance, available: -amount, held: 0 }]);
  }
  private hold(reference: string): Hold {
    const row = this.db.prepare('SELECT account_id,amount,status FROM wallet_holds WHERE reference=?').get(reference);
    if (!row || typeof row.account_id !== 'string' || typeof row.status !== 'string') throw new Error('No se encontró la retención requerida para la operación.');
    return { accountId: row.account_id, amount: this.number(row.amount, 1), status: row.status };
  }
  retain(reference: string, accountId: string, amount: number, key: string): void {
    const old = this.db.prepare('SELECT status FROM wallet_holds WHERE reference=?').get(reference);
    if (old && old.status !== 'refunded') throw new ConflictException('La operación ya tiene una retención.');
    this.post('hold', 'marketplace', reference, amount, key, `Saldo retenido · ${reference}`,
      [{ accountId, available: -amount, held: amount }]);
    this.db.prepare("INSERT INTO wallet_holds VALUES(?,?,?,'held') ON CONFLICT(reference) DO UPDATE SET account_id=excluded.account_id,amount=excluded.amount,status='held'")
      .run(reference, accountId, amount);
  }
  refund(reference: string, key: string): void {
    const hold = this.hold(reference);
    if (hold.status !== 'held') throw new ConflictException('La retención ya no admite devolución.');
    this.post('refund', 'marketplace', reference, hold.amount, key, `Retención devuelta · ${reference}`,
      [{ accountId: hold.accountId, available: hold.amount, held: -hold.amount }]);
    this.db.prepare("UPDATE wallet_holds SET status='refunded' WHERE reference=?").run(reference);
  }
  release(reference: string, buyerId: string, sellerId: string, amount: number): void {
    const hold = this.hold(reference);
    if (hold.status !== 'held' || hold.accountId !== buyerId || hold.amount !== amount || buyerId === sellerId) throw new Error('El pago no coincide con la retención del pedido.');
    this.post('release', 'marketplace', reference, amount, `release:${reference}`, `Pago liberado al vendedor · ${reference}`,
      [{ accountId: buyerId, available: 0, held: -amount }, { accountId: sellerId, available: amount, held: 0 }]);
    this.db.prepare("UPDATE wallet_holds SET status='released' WHERE reference=?").run(reference);
  }
  award(auctionId: number, orderId: number, buyerId: string, amount: number): void {
    const reference = `auction:${auctionId}`, hold = this.hold(reference);
    if (hold.status !== 'held' || hold.accountId !== buyerId || hold.amount !== amount) throw new Error('La adjudicación no coincide con la puja retenida.');
    this.post('award', 'marketplace', `order:${orderId}`, amount, `award:${reference}`, `Retención de subasta #${auctionId} trasladada al pedido #${orderId}`,
      [{ accountId: buyerId, available: 0, held: 0 }]);
    this.db.prepare("UPDATE wallet_holds SET status='converted' WHERE reference=?").run(reference);
    this.db.prepare("INSERT INTO wallet_holds VALUES(?,?,?,'held')").run(`order:${orderId}`, buyerId, amount);
  }
  movements(accountId: string, before: number): WalletMovement[] {
    return this.db.prepare(`SELECT e.id,e.event_id,v.action,v.module,v.reference,v.description,v.amount,e.available_delta,e.held_delta,v.created_at
      FROM wallet_entries e JOIN wallet_events v ON v.id=e.event_id WHERE e.account_id=? AND e.id<? ORDER BY e.id DESC LIMIT 51`).all(accountId, before).map(row => {
      const action = (['recharge', 'hold', 'refund', 'release', 'award'] as const).find(action => action === row.action);
      if (!action || row.module !== 'wallet' && row.module !== 'marketplace' || typeof row.reference !== 'string' || typeof row.description !== 'string') throw new Error('El historial de la billetera contiene datos inválidos.');
      return { id: this.number(row.id, 1, Number.MAX_SAFE_INTEGER), eventId: this.number(row.event_id, 1, Number.MAX_SAFE_INTEGER),
        action, module: row.module, reference: row.reference, description: row.description, amountCents: this.number(row.amount, 1),
        availableDelta: this.number(row.available_delta, -walletMaximumCents), heldDelta: this.number(row.held_delta, -walletMaximumCents),
        createdAt: new Date(this.number(row.created_at, 0, Number.MAX_SAFE_INTEGER)).toISOString() };
    });
  }
}
