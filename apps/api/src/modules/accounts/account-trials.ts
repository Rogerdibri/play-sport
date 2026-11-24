import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { accessFeatures, addMembershipMonths, hasAccountAccessControls, readAccountTrial, readTrialChange, trialPlans, trialStatus,
  type AccessFeature, type AccountTrial, type AdministrationSnapshot, type OwnAccountAccess, type TrialAudit } from '@playsport/shared';

export class AccountTrials {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {
    db.exec(`CREATE TABLE IF NOT EXISTS account_trials(
      account_id TEXT NOT NULL REFERENCES accounts(id), plan_id TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)), expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(account_id,plan_id)) STRICT;
      CREATE TABLE IF NOT EXISTS account_trial_commands(
      actor_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL, body_hash TEXT NOT NULL,
      result TEXT NOT NULL, PRIMARY KEY(actor_id,request_id)) STRICT;
      CREATE TABLE IF NOT EXISTS account_trial_audit(
      id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES accounts(id), account_id TEXT NOT NULL REFERENCES accounts(id),
      actor_name TEXT NOT NULL, target_name TEXT NOT NULL, plan_id TEXT NOT NULL, action TEXT NOT NULL,
      reason TEXT NOT NULL, at TEXT NOT NULL, previous_expires_at TEXT, expires_at TEXT NOT NULL) STRICT;`);
  }

  private trial(row: Record<string, unknown>): AccountTrial {
    if (row.active !== 0 && row.active !== 1) throw new Error('El estado de prueba guardado no es válido.');
    return readAccountTrial({ planId: row.plan_id, active: row.active === 1, expiresAt: row.expires_at,
      updatedAt: row.updated_at, revision: row.revision });
  }
  trials(accountId: string): AccountTrial[] {
    return this.db.prepare('SELECT * FROM account_trials WHERE account_id=? ORDER BY plan_id').all(accountId).map(row => this.trial(row));
  }
  features(accountId: string, master: boolean, now = this.now()): AccessFeature[] {
    if (master) return [...accessFeatures];
    const active = this.trials(accountId).filter(trial => trialStatus(trial, now) === 'active');
    return accessFeatures.filter(feature => active.some(trial => trialPlans.some(plan => plan.id === trial.planId && plan.features.includes(feature))));
  }
  own(accountId: string, master: boolean): OwnAccountAccess {
    const now = this.now();
    return { accountId, now: new Date(now).toISOString(), features: this.features(accountId, master, now), trials: this.trials(accountId) };
  }
  private count(row: Record<string, unknown> | undefined): number {
    if (!row || typeof row.total !== 'number' || !Number.isSafeInteger(row.total) || row.total < 0) throw new Error('No se pudo leer el total administrativo.');
    return row.total;
  }
  snapshot(accountId: string, query: Record<string, unknown>): AdministrationSnapshot {
    if (Object.keys(query).some(key => !['q', 'page', 'auditPage'].includes(key)) ||
        Object.values(query).some(value => typeof value !== 'string')) throw new BadRequestException('La consulta administrativa no es válida.');
    const search = typeof query.q === 'string' ? query.q.trim() : '';
    if (search.length > 100 || hasAccountAccessControls(search)) throw new BadRequestException('La búsqueda no es válida.');
    const pageNumber = (value: unknown) => {
      if (value === undefined) return 0;
      if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) ||
          Number(value) > Number.MAX_SAFE_INTEGER / 25) throw new BadRequestException('La página no es válida.');
      return Number(value);
    };
    const page = pageNumber(query.page), auditPage = pageNumber(query.auditPage);
    const where = 'instr(lower(display_name || char(32) || email), lower(?)) > 0';
    const total = this.count(this.db.prepare(`SELECT COUNT(*) AS total FROM accounts WHERE ${where}`).get(search));
    const users = this.db.prepare(`SELECT id,display_name,email FROM accounts WHERE ${where} ORDER BY created_at DESC,id LIMIT 25 OFFSET ?`)
      .all(search, page * 25).map(row => {
        if (typeof row.id !== 'string' || typeof row.display_name !== 'string' || typeof row.email !== 'string') throw new Error('La cuenta guardada no es válida.');
        const verified = this.db.prepare("SELECT 1 FROM person_identities WHERE account_id=? AND status='verified'").get(row.id);
        return { id: row.id, displayName: row.display_name, email: row.email, identityVerified: Boolean(verified), trials: this.trials(row.id) };
      });
    const auditTotal = this.count(this.db.prepare('SELECT COUNT(*) AS total FROM account_trial_audit').get());
    const audit: TrialAudit[] = this.db.prepare('SELECT * FROM account_trial_audit ORDER BY id DESC LIMIT 25 OFFSET ?').all(auditPage * 25).map(row => {
      const trial = readAccountTrial({ planId: row.plan_id, active: true, expiresAt: row.expires_at, updatedAt: row.at, revision: 1 });
      if (typeof row.id !== 'number' || typeof row.actor_name !== 'string' || typeof row.target_name !== 'string' ||
          typeof row.reason !== 'string' || row.action !== 'grant' && row.action !== 'revoke' ||
          row.previous_expires_at !== null && typeof row.previous_expires_at !== 'string') throw new Error('La auditoría guardada no es válida.');
      return { id: row.id, actorName: row.actor_name, targetName: row.target_name, planId: trial.planId, action: row.action,
        reason: row.reason, at: trial.updatedAt, previousExpiresAt: row.previous_expires_at, expiresAt: trial.expiresAt };
    });
    return { accountId, now: new Date(this.now()).toISOString(), page, total, users, auditPage, auditTotal, audit };
  }
  change(actor: { id: string; displayName: string }, body: unknown): AccountTrial {
    let input;
    try { input = readTrialChange(body); }
    catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    if (input.expectedAdminId !== actor.id) throw new ConflictException('La cuenta administradora cambió. Vuelve a abrir el panel.');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const replay = this.db.prepare('SELECT body_hash,result FROM account_trial_commands WHERE actor_id=? AND request_id=?').get(actor.id, input.requestId);
    if (replay) {
      if (replay.body_hash !== hash) throw new ConflictException('La solicitud ya fue utilizada con otros datos.');
      if (typeof replay.result !== 'string') throw new Error('La confirmación guardada no es válida.');
      return readAccountTrial(JSON.parse(replay.result));
    }
    const target = this.db.prepare('SELECT display_name FROM accounts WHERE id=?').get(input.accountId);
    if (!target) throw new NotFoundException('No se encontró la cuenta destinataria.');
    if (typeof target.display_name !== 'string') throw new Error('El nombre de la cuenta guardada no es válido.');
    const row = this.db.prepare('SELECT * FROM account_trials WHERE account_id=? AND plan_id=?').get(input.accountId, input.planId);
    const previous = row ? this.trial(row) : null;
    if ((previous?.revision ?? 0) !== input.expectedRevision) throw new ConflictException('El acceso cambió en otro dispositivo. Actualiza antes de modificarlo.');
    if (input.action === 'revoke' && !previous) throw new BadRequestException('No hay una prueba registrada para revocar.');
    const now = this.now();
    const grantExpiresAt = input.months ? addMembershipMonths(
      previous && trialStatus(previous, now) === 'active' ? previous.expiresAt : new Date(now).toISOString(), input.months) : input.expiresAt;
    if (input.action === 'grant' && (!grantExpiresAt || Date.parse(grantExpiresAt) <= now)) throw new BadRequestException('El vencimiento debe ser posterior al momento actual.');
    const expiresAt = input.action === 'grant' ? grantExpiresAt : previous?.expiresAt;
    if (!expiresAt) throw new Error('No se pudo resolver el vencimiento del acceso.');
    const trial: AccountTrial = { planId: input.planId, active: input.action === 'grant', expiresAt,
      updatedAt: new Date(now).toISOString(), revision: input.expectedRevision + 1 };
    this.db.prepare(`INSERT INTO account_trials(account_id,plan_id,active,expires_at,updated_at,revision) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_id,plan_id) DO UPDATE SET active=excluded.active,expires_at=excluded.expires_at,
      updated_at=excluded.updated_at,revision=excluded.revision`).run(input.accountId, trial.planId, Number(trial.active), expiresAt, trial.updatedAt, trial.revision);
    this.db.prepare(`INSERT INTO account_trial_audit(actor_id,account_id,actor_name,target_name,plan_id,action,reason,at,previous_expires_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(actor.id, input.accountId, actor.displayName, target.display_name, trial.planId, input.action, input.reason,
        trial.updatedAt, previous?.expiresAt ?? null, expiresAt);
    this.db.prepare('INSERT INTO account_trial_commands(actor_id,request_id,body_hash,result) VALUES(?,?,?,?)')
      .run(actor.id, input.requestId, hash, JSON.stringify(trial));
    return trial;
  }
}
