import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { readScorekeeperAccess, readScorekeeperSelection, scorekeeperPlanLevel, scorekeeperTournamentLimit,
  type AccountProfile, type ScorekeeperAccess, type ScorekeeperExtra, type ScorekeeperTournament } from '@playsport/shared';

export class AccountScorekeeperAccess {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {
    db.exec(`CREATE TABLE IF NOT EXISTS account_scorekeeper_tournaments(
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), selection TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0)) STRICT;
      CREATE TABLE IF NOT EXISTS account_scorekeeper_extras(
      account_id TEXT NOT NULL REFERENCES accounts(id), tournament_id TEXT NOT NULL, game_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('requested','granted','revoked')), revision INTEGER NOT NULL CHECK(revision>0),
      PRIMARY KEY(account_id,tournament_id,game_id)) STRICT;
      CREATE TABLE IF NOT EXISTS account_scorekeeper_extra_audit(
      id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES accounts(id), account_id TEXT NOT NULL REFERENCES accounts(id),
      tournament_id TEXT NOT NULL, game_id TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL,
      reason TEXT NOT NULL, at TEXT NOT NULL) STRICT;`);
  }
  private extra(row: Record<string, unknown>): ScorekeeperExtra {
    if (typeof row.tournament_id !== 'string' || typeof row.game_id !== 'string' ||
        !['requested', 'granted', 'revoked'].includes(String(row.status)) || typeof row.revision !== 'number')
      throw new Error('El acceso puntual guardado no es válido.');
    return { tournamentId: row.tournament_id, gameId: row.game_id, status: row.status as ScorekeeperExtra['status'], revision: row.revision };
  }
  access(account: AccountProfile, tournaments: ScorekeeperTournament[]): ScorekeeperAccess {
    const stored = this.db.prepare('SELECT selection,revision FROM account_scorekeeper_tournaments WHERE account_id=?').get(account.id);
    const limit = scorekeeperTournamentLimit(account), active = tournaments.filter(team => team.active).map(team => team.tournamentId);
    let selected = limit === null || active.length <= limit ? active : [], revision = 0;
    if (stored) {
      if (typeof stored.selection !== 'string' || typeof stored.revision !== 'number') throw new Error('Los cupos guardados no son válidos.');
      const input = readScorekeeperSelection({ expectedAccountId: account.id, expectedRevision: stored.revision, selected: JSON.parse(stored.selection) });
      selected = input.selected.filter(id => tournaments.some(team => team.tournamentId === id)); revision = stored.revision;
    }
    const overLimit = limit !== null && active.filter(id => selected.includes(id)).length > limit;
    const extras = this.db.prepare('SELECT * FROM account_scorekeeper_extras WHERE account_id=? ORDER BY tournament_id,game_id')
      .all(account.id).map(row => this.extra(row));
    return readScorekeeperAccess({ accountId: account.id, level: scorekeeperPlanLevel(account), limit, revision,
      selectionRequired: active.length > 0 && (overLimit || !active.some(id => selected.includes(id))),
      tournaments: tournaments.map(team => ({ ...team, enabled: selected.includes(team.tournamentId) && (!team.active || !overLimit) })), extras }, account.id);
  }
  select(account: AccountProfile, tournaments: ScorekeeperTournament[], body: unknown) {
    let input;
    try { input = readScorekeeperSelection(body); }
    catch (error) { if (error instanceof Error) throw new BadRequestException(error.message); throw error; }
    if (input.expectedAccountId !== account.id) throw new ForbiddenException('Los cupos no corresponden a tu cuenta.');
    const access = this.access(account, tournaments);
    if (access.revision !== input.expectedRevision) throw new ConflictException('Tus cupos cambiaron en otro dispositivo. Actualiza antes de guardar.');
    if (input.selected.some(id => !tournaments.some(team => team.tournamentId === id && team.active)))
      throw new ForbiddenException('Solo puedes seleccionar tus propios torneos activos.');
    if (access.limit !== null && input.selected.length > access.limit) throw new ForbiddenException({
      code: 'SCOREKEEPER_TOURNAMENT_LIMIT', message: `Tu nivel permite ${access.limit} torneo(s). Elige tus cupos o solicita acceso puntual a un partido.`,
    });
    const historical = access.tournaments.filter(team => !team.active && team.enabled).map(team => team.tournamentId);
    this.db.prepare(`INSERT INTO account_scorekeeper_tournaments VALUES(?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET selection=excluded.selection,revision=excluded.revision`)
      .run(account.id, JSON.stringify([...historical, ...input.selected]), input.expectedRevision + 1);
    return this.access(account, tournaments);
  }
  assert(account: AccountProfile, tournaments: ScorekeeperTournament[], tournamentId: string, gameId?: string) {
    const access = this.access(account, tournaments);
    if (!tournaments.some(team => team.tournamentId === tournamentId))
      throw new ForbiddenException('No estás inscrito como Anotador en este torneo.');
    if (access.tournaments.some(team => team.tournamentId === tournamentId && team.enabled)) return;
    if (gameId && access.extras.some(extra => extra.tournamentId === tournamentId && extra.gameId === gameId && extra.status === 'granted')) return;
    throw new ForbiddenException({ code: 'SCOREKEEPER_TOURNAMENT_LIMIT',
      message: 'Este torneo no está habilitado en tus cupos de Anotador. Selecciona tus torneos o solicita acceso puntual al partido.' });
  }
  private input(body: unknown, review: boolean) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('El acceso puntual no es válido.');
    const row = Object.fromEntries(Object.entries(body));
    const keys = review ? ['expectedAdminId', 'accountId', 'tournamentId', 'gameId', 'expectedRevision', 'action', 'reason'] :
      ['expectedAccountId', 'tournamentId', 'gameId', 'expectedRevision'];
    if (Object.keys(row).some(key => !keys.includes(key)) ||
        ![review ? row.expectedAdminId : row.expectedAccountId, row.tournamentId, row.gameId, ...(review ? [row.accountId] : [])]
          .every(value => typeof value === 'string' && value.trim() && value.length <= 1000) ||
        !Number.isSafeInteger(row.expectedRevision) || Number(row.expectedRevision) < 0 ||
        Number(row.expectedRevision) >= Number.MAX_SAFE_INTEGER ||
        review && (!['grant', 'revoke'].includes(String(row.action)) || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500))
      throw new BadRequestException('Completa la cuenta, el partido, la revisión y el motivo correspondientes.');
    return { expectedAccountId: String(row.expectedAccountId), expectedAdminId: String(row.expectedAdminId),
      accountId: String(row.accountId), tournamentId: String(row.tournamentId), gameId: String(row.gameId),
      expectedRevision: Number(row.expectedRevision), action: row.action, reason: String(row.reason ?? '') };
  }
  request(account: AccountProfile, body: unknown) {
    const input = this.input(body, false);
    if (input.expectedAccountId !== account.id) throw new ForbiddenException('El acceso no corresponde a tu cuenta.');
    return this.write(account.id, account.id, input, 'requested', 'Solicitud sin cobro. Pendiente de autorización.');
  }
  review(adminId: string, body: unknown) {
    const input = this.input(body, true);
    if (input.expectedAdminId !== adminId) throw new ForbiddenException('La cuenta administradora cambió.');
    return this.write(adminId, input.accountId, input, input.action === 'grant' ? 'granted' : 'revoked', input.reason);
  }
  private write(actorId: string, accountId: string, input: { tournamentId: string; gameId: string; expectedRevision: number },
    status: ScorekeeperExtra['status'], reason: string) {
    const current = this.db.prepare('SELECT * FROM account_scorekeeper_extras WHERE account_id=? AND tournament_id=? AND game_id=?')
      .get(accountId, input.tournamentId, input.gameId);
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new ConflictException('El acceso puntual cambió. Actualiza antes de continuar.');
    if (status === 'requested' && current?.status === 'granted') throw new ConflictException('Este partido ya tiene un acceso puntual autorizado.');
    if (status !== 'requested' && !current) throw new BadRequestException('Primero debe existir una solicitud para este partido.');
    this.db.prepare(`INSERT INTO account_scorekeeper_extras VALUES(?,?,?,?,?)
      ON CONFLICT(account_id,tournament_id,game_id) DO UPDATE SET status=excluded.status,revision=excluded.revision`)
      .run(accountId, input.tournamentId, input.gameId, status, input.expectedRevision + 1);
    this.db.prepare('INSERT INTO account_scorekeeper_extra_audit(actor_id,account_id,tournament_id,game_id,status,revision,reason,at) VALUES(?,?,?,?,?,?,?,?)')
      .run(actorId, accountId, input.tournamentId, input.gameId, status, input.expectedRevision + 1, reason, new Date(this.now()).toISOString());
    return { tournamentId: input.tournamentId, gameId: input.gameId, status, revision: input.expectedRevision + 1 };
  }
  queue() {
    return this.db.prepare(`SELECT e.*,a.display_name AS accountName FROM account_scorekeeper_extras e JOIN accounts a ON a.id=e.account_id
      ORDER BY e.status='requested' DESC,e.account_id,e.tournament_id,e.game_id LIMIT 100`).all().map(row => ({
        ...this.extra(row), accountId: String(row.account_id), accountName: String(row.accountName),
      }));
  }
}
