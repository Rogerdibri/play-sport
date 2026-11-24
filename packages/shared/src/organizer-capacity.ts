import type { TournamentDocument } from './tournaments.js';
import { tournamentPhaseUsesSeries } from './tournaments.js';
import { readOrganizerPlanAccess, readOrganizerRestartAudit, type OrganizerPlanAccess, type OrganizerRestartAudit } from './organizer-plans.js';

export const organizerFreeCapacity = { minTeams: 2, maxTeams: 5, maxGames: 13, tieBreakGames: 3 } as const;
export type OrganizerFreeAccess = { tournamentId: string | null; consumedAt: string | null; revision: number };
export type OrganizerPlayedGame = { gameId: string; fixtureId: string; teamIds: string[]; at: string; kind?: 'regular' | 'tie-breaker' };
export type OrganizerCapacitySnapshot = {
  accountId: string;
  free: OrganizerFreeAccess;
  tournaments: Array<{ tournamentId: string; legacy: boolean; played: OrganizerPlayedGame[];
    plan?: OrganizerPlanAccess | null; planRevision?: number; restarts?: OrganizerRestartAudit[] }>;
};
export type OrganizerFreeReservation = {
  expectedAccountId: string; expectedRevision: number; requestId: string; tournamentId: string | null;
};
export type TournamentCapacityEstimate = {
  teams: number; games: number; normalGames: number; tieBreakGames: number; complete: boolean; freeEligible: boolean;
  phases: Array<{ id: string; name: string; games: number; tieBreaker: boolean }>; pending: string[];
};

export function estimateTournamentCapacity(doc: TournamentDocument, played: OrganizerPlayedGame[] = []): TournamentCapacityEstimate {
  const pending: string[] = [];
  const teams = Math.max(doc.teamLimit ?? 0, new Set([...doc.teams.map(team => team.id), ...played.flatMap(game => game.teamIds)]).size,
    ...doc.phases.map(phase => Math.max(phase.teamLimit ?? 0,
      phase.groups.reduce((sum, group) => sum + Math.max(group.teamIds.length, group.teamLimit ?? 0), 0))));
  const phases = doc.phases.map(phase => {
    const fixtures = doc.fixtures.filter(game => game.phaseId === phase.id);
    const source = doc.phases.find(value => value.id === phase.sourcePhaseId);
    const sourceTeams = source?.groups.length ? source.groups.reduce((sum, group) => sum + (group.qualifiers ?? 0), 0) : source?.qualifiers;
    const participants = Math.max(phase.teamIds.length, phase.teamLimit ?? 0, sourceTeams ?? 0);
    const groups = phase.groups.length ? phase.groups.map(group => Math.max(group.teamIds.length, group.teamLimit ?? 0)) : [participants];
    let games = fixtures.length;
    if (phase.kind === 'round-robin') {
      if (groups.some(count => count < 2)) pending.push(`${phase.name}: define el cupo o los participantes de cada grupo.`);
      games = Math.max(games, groups.reduce((sum, count) => sum + count * (count - 1) / 2 * phase.turns, 0));
    } else if (phase.kind === 'knockout') {
      if (participants < 2) pending.push(`${phase.name}: define al menos dos participantes o el cupo de la ronda.`);
      const series = new Set(fixtures.map(game => JSON.stringify([game.series,
        [game.homeTeamId || game.homeSource, game.awayTeamId || game.awaySource].sort()])));
      games = Math.max(games, Math.max(Math.floor(participants / 2), series.size) * phase.bestOf);
      if (phase.pairing === 'manual' && phase.maxGames == null)
        pending.push(`${phase.name}: indica el máximo de partidos del formato manual.`);
    } else if (phase.kind === 'swiss') {
      if (groups.some(count => count < 2)) pending.push(`${phase.name}: define el cupo o los participantes.`);
      games = Math.max(games, groups.reduce((sum, count) => sum + Math.floor(count / 2) * phase.turns, 0));
    } else if (phase.kind === 'double-elimination') {
      if (participants < 2) pending.push(`${phase.name}: define al menos dos participantes o el cupo.`);
      games = Math.max(games, Math.max(0, 2 * participants - 1) * phase.bestOf);
    } else {
      if (phase.maxGames == null) pending.push(`${phase.name}: indica el máximo de partidos del formato manual.`);
      if (tournamentPhaseUsesSeries(phase.kind)) {
        const series = new Set(fixtures.map(game => JSON.stringify([game.series,
          [game.homeTeamId || game.homeSource, game.awayTeamId || game.awaySource].sort()])));
        games = Math.max(games, series.size * phase.bestOf);
      }
    }
    if (phase.maxGames != null) {
      if (phase.maxGames < games) pending.push(`${phase.name}: el presupuesto no cubre los cruces o el máximo de sus series.`);
      games = Math.max(games, phase.maxGames);
    }
    const tieBreaker = phase.purpose === 'tie-breaker';
    if (tieBreaker && (!phase.tieBreakReason?.trim() || !source || source.purpose === 'tie-breaker' ||
        phase.teamIds.some(id => !source.teamIds.includes(id) && !source.groups.some(group => group.teamIds.includes(id)))))
      pending.push(`${phase.name}: justifica el empate de clasificación y selecciona equipos de la fase de origen.`);
    return { id: phase.id, name: phase.name, games, tieBreaker };
  });
  if (!doc.phases.length) pending.push('Agrega las fases y define su capacidad antes de reservar el gratuito.');
  const missing = played.filter(game => !doc.fixtures.some(fixture => fixture.id === game.fixtureId));
  const normalGames = phases.filter(phase => !phase.tieBreaker).reduce((sum, phase) => sum + phase.games, 0) +
    missing.filter(game => game.kind !== 'tie-breaker').length;
  const tieBreakGames = phases.filter(phase => phase.tieBreaker).reduce((sum, phase) => sum + phase.games, 0) +
    missing.filter(game => game.kind === 'tie-breaker').length;
  const games = normalGames + tieBreakGames;
  if (!Number.isSafeInteger(games) || games < 0) throw new Error('La capacidad de partidos supera el rango admitido.');
  const complete = pending.length === 0 && games > 0;
  if (tieBreakGames > organizerFreeCapacity.tieBreakGames) pending.push('Se incluyen hasta 3 partidos adicionales de desempate por torneo.');
  return { teams, games, normalGames, tieBreakGames, complete: complete && pending.length === 0, phases, pending,
    freeEligible: complete && pending.length === 0 && teams >= organizerFreeCapacity.minTeams &&
      teams <= organizerFreeCapacity.maxTeams && normalGames <= organizerFreeCapacity.maxGames };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La capacidad de Organizador no es válida.');
  return value as Record<string, unknown>;
}
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value); }
function date(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function revision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
export function readOrganizerFreeAccess(value: unknown): OrganizerFreeAccess {
  const row = object(value);
  if (!(row.tournamentId === null || id(row.tournamentId)) || !(row.consumedAt === null || date(row.consumedAt)) ||
      !revision(row.revision) || row.consumedAt !== null && row.tournamentId === null)
    throw new Error('La oportunidad gratuita de Organizador no es válida.');
  return { tournamentId: row.tournamentId, consumedAt: row.consumedAt, revision: row.revision };
}
export function readOrganizerFreeReservation(value: unknown): OrganizerFreeReservation {
  const row = object(value), fields = ['expectedAccountId','expectedRevision','requestId','tournamentId'];
  if (Object.keys(row).some(key => !fields.includes(key)) || !id(row.expectedAccountId) || !revision(row.expectedRevision) ||
      typeof row.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(row.requestId) ||
      !(row.tournamentId === null || id(row.tournamentId)))
    throw new Error('La reserva gratuita no es válida.');
  return { expectedAccountId: row.expectedAccountId, expectedRevision: row.expectedRevision, requestId: row.requestId, tournamentId: row.tournamentId };
}
export function readOrganizerPlayedGame(value: unknown): OrganizerPlayedGame {
  const row = object(value);
  if (!id(row.gameId) || !id(row.fixtureId) || !date(row.at) || !Array.isArray(row.teamIds) || row.teamIds.length !== 2 ||
      !row.teamIds.every(id) || new Set(row.teamIds).size !== 2 ||
      row.kind !== undefined && row.kind !== 'regular' && row.kind !== 'tie-breaker') throw new Error('El consumo de partidos de Organizador no es válido.');
  return { gameId: row.gameId, fixtureId: row.fixtureId, at: row.at, teamIds: row.teamIds,
    ...(row.kind !== undefined ? { kind: row.kind } : {}) };
}
export function readOrganizerCapacity(value: unknown, accountId: string): OrganizerCapacitySnapshot {
  const row = object(value);
  if (row.accountId !== accountId || !Array.isArray(row.tournaments)) throw new Error('La capacidad no pertenece a tu cuenta.');
  const tournaments = row.tournaments.map(value => {
    const item = object(value);
    if (!id(item.tournamentId) || typeof item.legacy !== 'boolean' || !Array.isArray(item.played)) throw new Error('La capacidad del torneo no es válida.');
    const played = item.played.map(readOrganizerPlayedGame);
    if (new Set(played.map(game => game.gameId)).size !== played.length) throw new Error('El consumo contiene partidos duplicados.');
    if (item.planRevision !== undefined && !revision(item.planRevision)) throw new Error('La revisión del plan no es válida.');
    const plan = item.plan === undefined ? undefined : item.plan === null ? null : readOrganizerPlanAccess(item.plan, accountId, item.tournamentId);
    if (plan && plan.revision !== item.planRevision) throw new Error('La revisión del plan no coincide.');
    if (item.restarts !== undefined && !Array.isArray(item.restarts)) throw new Error('La constancia administrativa no es válida.');
    const restarts = Array.isArray(item.restarts) ? item.restarts.map(readOrganizerRestartAudit) : undefined;
    if (restarts?.some(audit => audit.accountId !== accountId || audit.tournamentId !== item.tournamentId))
      throw new Error('La constancia no pertenece a este torneo y cuenta.');
    return { tournamentId: item.tournamentId, legacy: item.legacy, played, ...(plan !== undefined ? { plan } : {}),
      ...(item.planRevision !== undefined ? { planRevision: item.planRevision } : {}), ...(restarts ? { restarts } : {}) };
  });
  if (new Set(tournaments.map(item => item.tournamentId)).size !== tournaments.length) throw new Error('La capacidad contiene torneos duplicados.');
  const free = readOrganizerFreeAccess(row.free);
  if (free.tournamentId && !tournaments.some(item => item.tournamentId === free.tournamentId && !item.legacy))
    throw new Error('La reserva no pertenece a un torneo propio con capacidad.');
  return { accountId, free, tournaments };
}
