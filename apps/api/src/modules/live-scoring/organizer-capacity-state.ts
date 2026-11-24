import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  estimateTournamentCapacity, organizerFreeCapacity, readOrganizerFreeAccess, readOrganizerFreeReservation, readOrganizerPlayedGame,
  type OrganizerFreeAccess, type OrganizerFreeReservation, type OrganizerPlayedGame, type TournamentDocument,
  readOrganizerPlanAccess, readOrganizerRestartAudit, organizerPlanCapacity,
  type OrganizerPlanAccess, type OrganizerPlanRequest, type OrganizerPlanAuthorization, type OrganizerRestartAudit,
} from '@playsport/shared';

type ReservationCommand = { input: OrganizerFreeReservation; appliedRevision: number };
type State = {
  free: Map<string, OrganizerFreeAccess>;
  played: Map<string, Map<string, OrganizerPlayedGame>>;
  commands: Map<string, ReservationCommand>;
  plans: Map<string, { accountId: string; revision: number; access: OrganizerPlanAccess | null }>;
  commercialCommands: Map<string, { hash: string; revision: number }>;
  restarts: Map<string, OrganizerRestartAudit[]>;
  planAudit: Map<string, Array<{ adminId: string; action: string; at: string; reason: string; revision: number }>>;
};
export class OrganizerCapacityState {
  private state: State = { free: new Map(), played: new Map(), commands: new Map(), plans: new Map(),
    commercialCommands: new Map(), restarts: new Map(), planAudit: new Map() };
  export() { return this.state; }
  restore(value: unknown) {
    if (!value || typeof value !== 'object' || !('free' in value) || !(value.free instanceof Map) ||
        !('played' in value) || !(value.played instanceof Map) || !('commands' in value) || !(value.commands instanceof Map))
      throw new Error('La capacidad persistente de Organizador no es válida. No se reinició la gratuidad.');
    const free = new Map<string, OrganizerFreeAccess>(), played = new Map<string, Map<string, OrganizerPlayedGame>>(),
      commands = new Map<string, ReservationCommand>();
    for (const [accountId, access] of value.free) {
      if (typeof accountId !== 'string' || !accountId) throw new Error('La titularidad de la gratuidad no es válida.');
      free.set(accountId, readOrganizerFreeAccess(access));
    }
    for (const [tournamentId, entries] of value.played) {
      if (typeof tournamentId !== 'string' || !tournamentId || !(entries instanceof Map)) throw new Error('El consumo persistente no es válido.');
      const games = new Map<string, OrganizerPlayedGame>();
      for (const [gameId, value] of entries) {
        const game = readOrganizerPlayedGame(value);
        if (gameId !== game.gameId) throw new Error('La identidad de un partido consumido no es válida.');
        games.set(gameId, game);
      }
      played.set(tournamentId, games);
    }
    for (const [key, command] of value.commands) {
      if (!command || typeof command !== 'object' || !('input' in command) || !('appliedRevision' in command) ||
          typeof command.appliedRevision !== 'number' || !Number.isSafeInteger(command.appliedRevision) || command.appliedRevision < 0)
        throw new Error('La auditoría de reserva no es válida.');
      const input = readOrganizerFreeReservation(command.input);
      if (key !== `${input.expectedAccountId}:${input.requestId}`) throw new Error('La titularidad de una reserva no es válida.');
      commands.set(key, { input, appliedRevision: command.appliedRevision });
    }
    for (const access of free.values()) if (access.consumedAt && access.tournamentId &&
      ![...(played.get(access.tournamentId)?.values() ?? [])].some(game => game.at === access.consumedAt))
      throw new Error('Falta la evidencia del primer partido. No se reinició la gratuidad.');
    const extra: Pick<State, 'plans' | 'commercialCommands' | 'restarts' | 'planAudit'> = {
      plans: new Map(), commercialCommands: new Map(), restarts: new Map(), planAudit: new Map() };
    const additional: Record<string, unknown> = { ...value };
    for (const key of ['plans','commercialCommands','restarts','planAudit'] as const) {
      if (!(key in additional)) continue;
      const entries = additional[key];
      if (!(entries instanceof Map)) throw new Error('La capacidad comercial persistente no es válida.');
      for (const [id, item] of entries) {
        if (typeof id !== 'string' || !id) throw new Error('La titularidad de capacidad no es válida.');
        if (key === 'plans') {
          if (!item || typeof item.accountId !== 'string' || !Number.isSafeInteger(item.revision) || item.revision < 1)
            throw new Error('La selección persistente no es válida.');
          const access = item.access === null ? null : readOrganizerPlanAccess(item.access, item.accountId, id);
          if (access && access.revision !== item.revision) throw new Error('La revisión de capacidad no es válida.');
          extra.plans.set(id, { accountId: item.accountId, revision: item.revision, access });
        } else if (key === 'commercialCommands') {
          if (!item || typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash) ||
              !Number.isSafeInteger(item.revision) || item.revision < 0) throw new Error('La operación persistente no es válida.');
          extra.commercialCommands.set(id, { hash: item.hash, revision: item.revision });
        } else if (key === 'restarts') {
          if (!Array.isArray(item)) throw new Error('La constancia de anulación no es válida.');
          const audits = item.map(readOrganizerRestartAudit);
          if (audits.some(audit => audit.tournamentId !== id)) throw new Error('La constancia pertenece a otro torneo.');
          extra.restarts.set(id, audits);
        } else {
          if (!Array.isArray(item) || item.some(audit => !audit || typeof audit.adminId !== 'string' ||
              !['authorize-test','revoke-test'].includes(audit.action) || typeof audit.reason !== 'string' || !audit.reason.trim() ||
              typeof audit.at !== 'string' || !Number.isFinite(Date.parse(audit.at)) || new Date(audit.at).toISOString() !== audit.at ||
              !Number.isSafeInteger(audit.revision) || audit.revision < 1)) throw new Error('La auditoría de capacidad no es válida.');
          extra.planAudit.set(id, item.map(audit => ({ ...audit })));
        }
      }
    }
    this.state = { free, played, commands, ...extra };
  }
  access(accountId: string): OrganizerFreeAccess {
    return { ...(this.state.free.get(accountId) ?? { tournamentId: null, consumedAt: null, revision: 0 }) };
  }
  usage(tournamentId: string): OrganizerPlayedGame[] {
    return [...(this.state.played.get(tournamentId)?.values() ?? [])].map(game => ({ ...game, teamIds: [...game.teamIds] }));
  }
  allows(accountId: string, doc: TournamentDocument, gameId: string) {
    if (doc.status === 'finished' || doc.status === 'cancelled') return false;
    const free = this.access(accountId).tournamentId === doc.id, plan = this.plan(doc.id);
    const paid = plan && plan.accountId === accountId && plan.status !== 'revoked-test' && plan.authorizedGames > 0 ? plan : null;
    if (!free && !paid) return false;
    const capacity = free ? { teams: organizerFreeCapacity.maxTeams, games: organizerFreeCapacity.maxGames } :
      paid ? { teams: paid.teamCapacity, games: Math.min(paid.gameCapacity, paid.authorizedGames) } : null;
    if (!capacity) return false;
    if (this.state.played.get(doc.id)?.has(gameId)) return true;
    const usage = this.usage(doc.id), estimate = estimateTournamentCapacity(doc, usage);
    const fixture = doc.fixtures.find(fixture => `plan:${doc.id}:${fixture.id}` === gameId);
    const tieBreaker = doc.phases.find(phase => phase.id === fixture?.phaseId)?.purpose === 'tie-breaker';
    const count = usage.filter(game => (game.kind === 'tie-breaker') === tieBreaker).length;
    return estimate.complete && count < (tieBreaker ? organizerFreeCapacity.tieBreakGames : capacity.games) &&
      (free ? estimate.freeEligible : estimate.teams <= capacity.teams && estimate.normalGames <= capacity.games);
  }
  plan(tournamentId: string) {
    const access = this.state.plans.get(tournamentId)?.access;
    return access ? { ...access, selection: { ...access.selection } } : null;
  }
  planRevision(tournamentId: string) { return this.state.plans.get(tournamentId)?.revision ?? 0; }
  restarts(tournamentId: string) { return (this.state.restarts.get(tournamentId) ?? []).map(row => ({ ...row })); }
  replay(key: string, input: unknown) {
    const command = this.state.commercialCommands.get(key);
    if (command && command.hash !== createHash('sha256').update(JSON.stringify(input)).digest('hex'))
      throw new ConflictException('Esa operación ya se utilizó para otros datos.');
    return command?.revision;
  }
  record(key: string, input: unknown, revision: number) {
    this.state.commercialCommands.set(key, { hash: createHash('sha256').update(JSON.stringify(input)).digest('hex'), revision });
  }
  select(input: OrganizerPlanRequest) {
    const key = `select:${input.expectedAccountId}:${input.requestId}`, replay = this.replay(key, input);
    if (replay !== undefined) return { appliedRevision: replay, replayed: true };
    if (this.planRevision(input.tournamentId) !== input.expectedRevision) throw new ConflictException('El plan cambió. Actualiza antes de continuar.');
    if (this.access(input.expectedAccountId).tournamentId === input.tournamentId)
      throw new ConflictException('El torneo gratuito conserva sus condiciones. Libera la reserva antes de elegir un plan pago; si ya comenzó no puede convertirse.');
    const previous = this.plan(input.tournamentId), revision = input.expectedRevision + 1;
    if (!input.selection && this.usage(input.tournamentId).length) throw new ConflictException('Un torneo iniciado debe conservar su capacidad.');
    let access: OrganizerPlanAccess | null = null;
    if (input.selection) {
      const capacity = organizerPlanCapacity(input.selection);
      access = { accountId: input.expectedAccountId, tournamentId: input.tournamentId, selection: input.selection,
        teamCapacity: capacity.teams, gameCapacity: capacity.games, authorizedGames: previous?.authorizedGames ?? 0, revision,
        status: previous?.status === 'revoked-test' ? 'revoked-test' :
          (previous?.authorizedGames ?? 0) >= capacity.games ? 'authorized-test' : 'pending-pricing' };
    }
    this.state.plans.set(input.tournamentId, { accountId: input.expectedAccountId, revision, access });
    this.record(key, input, revision);
    return { appliedRevision: revision, replayed: false };
  }
  authorize(input: OrganizerPlanAuthorization, at: string) {
    const key = `authorize:${input.expectedAdminId}:${input.requestId}`, replay = this.replay(key, input);
    if (replay !== undefined) return { appliedRevision: replay, replayed: true };
    const access = this.plan(input.tournamentId);
    if (!access || access.revision !== input.expectedRevision) throw new ConflictException('Selecciona el plan y actualiza su revisión antes de autorizar.');
    access.status = input.action === 'authorize-test' ? 'authorized-test' : 'revoked-test';
    if (input.action === 'authorize-test') access.authorizedGames = Math.max(access.authorizedGames, access.gameCapacity);
    access.revision++;
    this.state.plans.set(input.tournamentId, { accountId: access.accountId, revision: access.revision, access });
    const audit = this.state.planAudit.get(input.tournamentId) ?? [];
    audit.push({ adminId: input.expectedAdminId, action: input.action, at, reason: input.reason, revision: access.revision });
    this.state.planAudit.set(input.tournamentId, audit); this.record(key, input, access.revision);
    return { appliedRevision: access.revision, replayed: false };
  }
  recordRestart(audit: OrganizerRestartAudit) {
    const rows = this.state.restarts.get(audit.tournamentId) ?? [];
    rows.push(readOrganizerRestartAudit(audit)); this.state.restarts.set(audit.tournamentId, rows);
  }
  reserve(input: OrganizerFreeReservation) {
    const key = `${input.expectedAccountId}:${input.requestId}`, replay = this.state.commands.get(key);
    if (replay) {
      if (replay.input.expectedRevision !== input.expectedRevision || replay.input.tournamentId !== input.tournamentId)
        throw new ConflictException('Esa operación de reserva ya se utilizó para otros datos.');
      return { free: this.access(input.expectedAccountId), appliedRevision: replay.appliedRevision, replayed: true };
    }
    const free = this.access(input.expectedAccountId);
    if (input.tournamentId && this.plan(input.tournamentId)) throw new ConflictException('Quita la selección de pago antes de reservar este torneo como gratuito.');
    if (free.revision !== input.expectedRevision) throw new ConflictException('La reserva cambió en otra pantalla. Actualiza antes de continuar.');
    if (free.consumedAt && free.tournamentId !== input.tournamentId)
      throw new ForbiddenException({ code: 'ORGANIZER_FREE_CONSUMED', message: 'La única oportunidad gratuita ya fue utilizada. No se recupera al terminar o cancelar el torneo.' });
    if (free.tournamentId !== input.tournamentId) { free.tournamentId = input.tournamentId; free.revision++; }
    this.state.free.set(input.expectedAccountId, free);
    this.state.commands.set(key, { input: { ...input }, appliedRevision: free.revision });
    return { free: { ...free }, appliedRevision: free.revision, replayed: false };
  }
  start(accountId: string, doc: TournamentDocument, game: OrganizerPlayedGame) {
    const free = this.access(accountId), existing = this.state.played.get(doc.id);
    const plan = this.plan(doc.id);
    if (free.tournamentId !== doc.id && (!plan || plan.status === 'revoked-test' || !plan.authorizedGames)) throw new ForbiddenException({ code: 'ORGANIZER_CAPACITY_REQUIRED',
      message: free.consumedAt ? 'Este torneo requiere capacidad adicional. Precios y cobros todavía no están habilitados.' :
        'Reserva tu única oportunidad gratuita para este torneo antes de iniciar el primer partido.' });
    if (existing?.has(game.gameId)) return;
    if (!this.allows(accountId, doc, game.gameId))
      throw new ForbiddenException({ code: 'ORGANIZER_CAPACITY_REQUIRED', message: 'Revisa los equipos y partidos de la capacidad del torneo. Se incluyen hasta 3 desempates adicionales justificados.' });
    const kind = doc.phases.find(phase => phase.id === doc.fixtures.find(fixture => fixture.id === game.fixtureId)?.phaseId)?.purpose === 'tie-breaker' ?
      'tie-breaker' : 'regular';
    const valid = readOrganizerPlayedGame({ ...game, kind });
    const entries = existing ?? new Map<string, OrganizerPlayedGame>();
    entries.set(valid.gameId, valid); this.state.played.set(doc.id, entries);
    if (free.tournamentId === doc.id && !free.consumedAt) { free.consumedAt = valid.at; free.revision++; this.state.free.set(accountId, free); }
  }
}
