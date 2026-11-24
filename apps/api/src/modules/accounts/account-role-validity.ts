import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { addMembershipMonths, readRoleValidity, trialStatus, type AccountTrial, type MembershipRole, type RoleValidity } from '@playsport/shared';

export class AccountRoleValidity {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {
    db.exec(`CREATE TABLE IF NOT EXISTS account_role_activations(
      account_id TEXT NOT NULL REFERENCES accounts(id), role TEXT NOT NULL CHECK(role IN ('manager','scorekeeper')),
      activated_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(account_id,role)) STRICT;`);
  }
  role(accountId: string, role: MembershipRole, trials: AccountTrial[], now = this.now()): RoleValidity {
    const at = new Date(now).toISOString();
    if (role === 'player') return { role, status: 'permanent', activatedAt: null, freeExpiresAt: null, expiresAt: null, now: at };
    const row = this.db.prepare('SELECT activated_at,expires_at FROM account_role_activations WHERE account_id=? AND role=?').get(accountId, role);
    const own = trials.filter(trial => trial.planId === role || trial.planId === `${role}-numbers` || trial.planId === `${role}-basic`);
    const active = own.filter(trial => trialStatus(trial, now) === 'active').sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt))[0];
    const freeExpiresAt = row?.expires_at ?? null, activatedAt = row?.activated_at ?? null;
    const expired = own.filter(trial => trial.active && Date.parse(trial.expiresAt) <= now).map(trial => trial.expiresAt);
    if (typeof freeExpiresAt === 'string') expired.push(freeExpiresAt);
    const deadline = expired.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    const status = active ? 'plan' : typeof freeExpiresAt === 'string' && Date.parse(freeExpiresAt) > now ? 'active' : deadline ? 'expired' : 'not_activated';
    return readRoleValidity({ role, status, activatedAt, freeExpiresAt,
      expiresAt: active?.expiresAt ?? (status === 'active' ? freeExpiresAt : deadline), now: at }, role);
  }
  activate(accountId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Selecciona el rol que deseas activar.');
    const row = Object.fromEntries(Object.entries(body));
    if (Object.keys(row).some(key => !['expectedAccountId', 'role'].includes(key)) ||
        row.role !== 'manager' && row.role !== 'scorekeeper')
      throw new BadRequestException('La activación requiere únicamente tu cuenta y el rol Manager o Anotador.');
    if (row.expectedAccountId !== accountId) throw new ConflictException('La cuenta cambió. Actualiza antes de activar el rol.');
    const at = new Date(this.now()).toISOString();
    this.db.prepare('INSERT INTO account_role_activations(account_id,role,activated_at,expires_at) VALUES(?,?,?,?) ON CONFLICT(account_id,role) DO NOTHING')
      .run(accountId, row.role, at, addMembershipMonths(at, 6));
  }
}
