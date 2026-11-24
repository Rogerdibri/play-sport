import { isCalendarDate } from './events-calendar.js';
import { isGameProtest, type GameProtest } from './game-protest.js';
import { isProfileLocation } from './venezuela.js';
import { isGameSuspension, type GameSuspension } from './game-suspension.js';

export type OfficialGameStatus = 'scheduled' | 'in_progress' | 'suspended' | 'protested' | 'final';
export type OfficialGameDetails = {
  tournamentName: string; homeTeamName: string; awayTeamName: string;
  date: string; time: string; venue: string;
  stateId?: string; municipalityId?: string;
};
export type OfficialGameSummary = {
  gameId: string; tournamentId: string; homeTeamId: string; awayTeamId: string;
  status: OfficialGameStatus; homeScore: number; awayScore: number;
  details: OfficialGameDetails | null; assignedScorekeeperIds: string[]; availableScorekeeperIds: string[];
  scoringBlockReason?: string | null;
  protest?: GameProtest | null;
  suspension?: GameSuspension;
  managerTeamId?: string;
  canOperate?: boolean;
  organizerCapacityBlocked?: boolean;
};
export type OfficialGamesSnapshot = { userId: string; role: 'organizer' | 'scorekeeper' | 'manager'; games: OfficialGameSummary[] };
export const officialGameStatusLabels: Record<OfficialGameStatus, string> = {
  scheduled: 'Pendiente', in_progress: 'En curso', suspended: 'Suspendido · Fecha pendiente',
  protested: 'Bajo protesta · Pendiente de mesa técnica', final: 'Finalizado'
};
export function isOfficialGameStatus(value: unknown): value is OfficialGameStatus {
  return typeof value === 'string' && ['scheduled', 'in_progress', 'suspended', 'protested', 'final'].includes(value);
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
export function isOfficialGameDetails(value: unknown): value is OfficialGameDetails {
  return record(value) && ['tournamentName', 'homeTeamName', 'awayTeamName', 'venue'].every(key => text(value[key])) &&
    isCalendarDate(value.date) && typeof value.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    (value.stateId === undefined && value.municipalityId === undefined || isProfileLocation(value));
}
function isOfficialGameSummary(value: unknown): value is OfficialGameSummary {
  return record(value) && text(value.gameId) && text(value.tournamentId) && text(value.homeTeamId) && text(value.awayTeamId) &&
    (value.canOperate === undefined || typeof value.canOperate === 'boolean') &&
    (value.organizerCapacityBlocked === undefined || typeof value.organizerCapacityBlocked === 'boolean') &&
    value.homeTeamId !== value.awayTeamId && isOfficialGameStatus(value.status) &&
    (value.managerTeamId === undefined || text(value.managerTeamId) && [value.homeTeamId, value.awayTeamId].includes(value.managerTeamId)) &&
    (value.suspension === undefined || isGameSuspension(value.suspension)) &&
    (value.status !== 'suspended' || isGameSuspension(value.suspension) && value.suspension.rescheduled === null) &&
    (value.protest === undefined || value.protest === null || isGameProtest(value.protest)) &&
    (value.status !== 'protested' || isGameProtest(value.protest) && value.protest.resolution === null) &&
    (!value.protest || isGameProtest(value.protest) && [value.homeTeamId, value.awayTeamId].includes(value.protest.teamId) &&
      (value.status === 'protested' || value.status === 'final' && value.protest.resolution !== null &&
        [value.homeTeamId, value.awayTeamId].includes(value.protest.resolution.winnerTeamId) &&
        [value.homeTeamId, value.awayTeamId].includes(value.protest.resolution.loserTeamId))) &&
    typeof value.homeScore === 'number' && Number.isSafeInteger(value.homeScore) && value.homeScore >= 0 &&
    typeof value.awayScore === 'number' && Number.isSafeInteger(value.awayScore) && value.awayScore >= 0 &&
    (value.details === null || isOfficialGameDetails(value.details)) && ids(value.assignedScorekeeperIds) && ids(value.availableScorekeeperIds) &&
    (value.scoringBlockReason === undefined || value.scoringBlockReason === null ||
      typeof value.scoringBlockReason === 'string' && value.scoringBlockReason.trim().length > 0 && value.scoringBlockReason.length <= 1000) &&
    value.assignedScorekeeperIds.every(id => ids(value.availableScorekeeperIds) && value.availableScorekeeperIds.includes(id));
}
export function readOfficialGames(value: unknown, userId: string, role: OfficialGamesSnapshot['role'], assignedOnly = true): OfficialGamesSnapshot {
  if (!record(value) || value.userId !== userId || value.role !== role || !Array.isArray(value.games) ||
      !value.games.every(isOfficialGameSummary) || new Set(value.games.map(game => game.gameId)).size !== value.games.length ||
      role === 'manager' && value.games.some(game => !game.managerTeamId) ||
      role === 'scorekeeper' && assignedOnly && value.games.some(game => !game.assignedScorekeeperIds.includes(userId))) {
    throw new Error('La lista de partidos asignados contiene datos inválidos. Vuelve a cargarla.');
  }
  return { userId, role, games: value.games };
}
