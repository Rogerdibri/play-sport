import { estimateTournamentCapacity, organizerFreeCapacity, type OrganizerPlayedGame } from './organizer-capacity.js';
import type { TournamentDocument } from './tournaments.js';

export const organizerPackages = [
  { id: 'small', name: 'Pequeño', teams: 8, games: 40 },
  { id: 'medium', name: 'Mediano', teams: 16, games: 150 },
  { id: 'large', name: 'Grande', teams: 32, games: 550 },
] as const;
export type OrganizerPlanSelection = { planId: typeof organizerPackages[number]['id']; teams: null; games: null } |
  { planId: 'custom'; teams: number; games: number };
export type OrganizerPlanAccess = { accountId: string; tournamentId: string; selection: OrganizerPlanSelection;
  teamCapacity: number; gameCapacity: number; authorizedGames: number; status: 'pending-pricing' | 'authorized-test' | 'revoked-test'; revision: number };
export type OrganizerPlanRequest = { expectedAccountId: string; tournamentId: string; expectedRevision: number;
  requestId: string; selection: OrganizerPlanSelection | null };
export type OrganizerPlanAuthorization = { expectedAdminId: string; tournamentId: string; expectedRevision: number;
  requestId: string; action: 'authorize-test' | 'revoke-test'; reason: string };
export type OrganizerGameRestart = { expectedAccountId: string; tournamentId: string; gameId: string;
  expectedOfficialVersion: number; requestId: string; reason: string };
export type OrganizerRestartAudit = { accountId: string; tournamentId: string; gameId: string; organizerId: string;
  cancelledAttemptId: string; replacementAttemptId: string; at: string; reason: string };
const integer = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/.test(value);
const nonce = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const reason = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
function fields(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('La operación de capacidad no es válida.');
  return value as Record<string, unknown>;
}
export function readOrganizerPlanSelection(value: unknown): OrganizerPlanSelection {
  const row = fields(value, ['planId','teams','games']);
  if (row.planId === 'custom' && integer(row.teams, 2) && integer(row.games, 1))
    return { planId: 'custom', teams: row.teams, games: row.games };
  const preset = organizerPackages.find(plan => plan.id === row.planId);
  if (!preset || row.teams !== null || row.games !== null) throw new Error('Selecciona un paquete válido o define equipos y partidos del personalizado.');
  return { planId: preset.id, teams: null, games: null };
}
export function organizerPlanCapacity(selection: OrganizerPlanSelection) {
  const valid = readOrganizerPlanSelection(selection);
  const preset = organizerPackages.find(plan => plan.id === valid.planId);
  if (valid.planId === 'custom') return { teams: valid.teams, games: valid.games, name: 'Personalizado' };
  if (!preset) throw new Error('El paquete no existe.');
  return { teams: preset.teams, games: preset.games, name: preset.name };
}
export function organizerPlanQuote(doc: TournamentDocument, selection: OrganizerPlanSelection, previous?: OrganizerPlanAccess | null, played: OrganizerPlayedGame[] = []) {
  const capacity = organizerPlanCapacity(selection), estimate = estimateTournamentCapacity(doc, played);
  const activated = (previous?.authorizedGames ?? 0) > 0;
  return { capacity, estimate, amount: null, pricingStatus: 'pending' as const,
    activationUnits: activated ? 0 : 1, additionalGames: Math.max(0, capacity.games - (previous?.authorizedGames ?? 0)),
    fits: estimate.complete && estimate.teams <= capacity.teams && estimate.normalGames <= capacity.games &&
      estimate.tieBreakGames <= organizerFreeCapacity.tieBreakGames };
}
export function readOrganizerPlanRequest(value: unknown): OrganizerPlanRequest {
  const row = fields(value, ['expectedAccountId','tournamentId','expectedRevision','requestId','selection']);
  if (!identifier(row.expectedAccountId) || !identifier(row.tournamentId) || !integer(row.expectedRevision, 0) || !nonce(row.requestId))
    throw new Error('La selección del plan no es válida.');
  return { expectedAccountId: row.expectedAccountId, tournamentId: row.tournamentId, expectedRevision: row.expectedRevision,
    requestId: row.requestId, selection: row.selection === null ? null : readOrganizerPlanSelection(row.selection) };
}
export function readOrganizerPlanAuthorization(value: unknown): OrganizerPlanAuthorization {
  const row = fields(value, ['expectedAdminId','tournamentId','expectedRevision','requestId','action','reason']);
  if (!identifier(row.expectedAdminId) || !identifier(row.tournamentId) || !integer(row.expectedRevision, 0) || !nonce(row.requestId) ||
      (row.action !== 'authorize-test' && row.action !== 'revoke-test') || !reason(row.reason))
    throw new Error('La autorización de prueba por torneo no es válida.');
  return { expectedAdminId: row.expectedAdminId, tournamentId: row.tournamentId, expectedRevision: row.expectedRevision,
    requestId: row.requestId, action: row.action, reason: row.reason.trim() };
}
export function readOrganizerGameRestart(value: unknown): OrganizerGameRestart {
  const row = fields(value, ['expectedAccountId','tournamentId','gameId','expectedOfficialVersion','requestId','reason']);
  if (!identifier(row.expectedAccountId) || !identifier(row.tournamentId) || !identifier(row.gameId) ||
      !integer(row.expectedOfficialVersion, 0) || !nonce(row.requestId) || !reason(row.reason))
    throw new Error('La anulación por fuerza mayor requiere un motivo y la revisión actual del partido.');
  return { expectedAccountId: row.expectedAccountId, tournamentId: row.tournamentId, gameId: row.gameId,
    expectedOfficialVersion: row.expectedOfficialVersion, requestId: row.requestId, reason: row.reason.trim() };
}
export function readOrganizerPlanAccess(value: unknown, accountId: string, tournamentId: string): OrganizerPlanAccess {
  const row = fields(value, ['accountId','tournamentId','selection','teamCapacity','gameCapacity','authorizedGames','status','revision']);
  const selection = readOrganizerPlanSelection(row.selection), capacity = organizerPlanCapacity(selection);
  if (row.accountId !== accountId || row.tournamentId !== tournamentId || row.teamCapacity !== capacity.teams ||
      row.gameCapacity !== capacity.games || !integer(row.revision, 1) || !integer(row.authorizedGames, 0) ||
      row.status === 'authorized-test' && row.authorizedGames < capacity.games ||
      (row.status !== 'pending-pricing' && row.status !== 'authorized-test' && row.status !== 'revoked-test'))
    throw new Error('La capacidad contratada no es válida.');
  return { accountId, tournamentId, selection, teamCapacity: capacity.teams, gameCapacity: capacity.games,
    authorizedGames: row.authorizedGames, status: row.status, revision: row.revision };
}
export function readOrganizerRestartAudit(value: unknown): OrganizerRestartAudit {
  const row = fields(value, ['accountId','tournamentId','gameId','organizerId','cancelledAttemptId','replacementAttemptId','at','reason']);
  if (!identifier(row.accountId) || !identifier(row.tournamentId) || !identifier(row.gameId) || !identifier(row.organizerId) || !nonce(row.cancelledAttemptId) ||
      !nonce(row.replacementAttemptId) || row.cancelledAttemptId === row.replacementAttemptId || !reason(row.reason) ||
      typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)) || new Date(row.at).toISOString() !== row.at)
    throw new Error('La constancia administrativa de anulación no es válida.');
  return { accountId: row.accountId, tournamentId: row.tournamentId, gameId: row.gameId, organizerId: row.organizerId,
    cancelledAttemptId: row.cancelledAttemptId, replacementAttemptId: row.replacementAttemptId, at: row.at, reason: row.reason };
}
