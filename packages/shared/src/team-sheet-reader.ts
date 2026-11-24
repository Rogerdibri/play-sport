import type { PersonnelAction, PresentOfficial, TeamSheetsSnapshot } from './game-personnel.js';
import { isPresentOfficialRole } from './game-personnel.js';
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function isOfficial(value: unknown): value is PresentOfficial {
  return isRecord(value) && isPresentOfficialRole(value.role) &&
    typeof value.identificationNumber === 'string' && typeof value.displayName === 'string';
}
function isAction(value: unknown): value is PersonnelAction {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'arrival': return typeof value.identificationNumber === 'string';
    case 'substitution': return typeof value.outgoingIdentificationNumber === 'string' && typeof value.incomingIdentificationNumber === 'string' && typeof value.fieldPosition === 'string' && typeof value.jerseyNumber === 'string' && (value.arrival === undefined || value.arrival === true);
    case 'defense': return typeof value.identificationNumber === 'string' && typeof value.fieldPosition === 'string' && (value.swapWith === undefined || typeof value.swapWith === 'string' && value.swapWith.length > 0);
    case 'courtesy': return typeof value.outgoingIdentificationNumber === 'string' && typeof value.incomingIdentificationNumber === 'string' && typeof value.fromBase === 'number';
    case 'staff-arrival': return isOfficial(value.official);
    case 'staff-departure': return typeof value.identificationNumber === 'string' && isPresentOfficialRole(value.role);
    default: return false;
  }
}
function isSnapshot(value: unknown): value is TeamSheetsSnapshot {
  if (!isRecord(value) || typeof value.gameId !== 'string' || typeof value.tournamentId !== 'string' ||
      typeof value.version !== 'number' || typeof value.canDecide !== 'boolean' ||
      !(value.scoringBlockReason === undefined || value.scoringBlockReason === null || typeof value.scoringBlockReason === 'string') ||
      !(value.ownTeamId === null || typeof value.ownTeamId === 'string') ||
      !Array.isArray(value.sheets) || !Array.isArray(value.requests)) return false;
  const player = (item: unknown) => isRecord(item) && typeof item.identificationNumber === 'string' &&
    typeof item.displayName === 'string' && (item.battingOrder === null || typeof item.battingOrder === 'number') &&
    typeof item.fieldPosition === 'string' && ['PLAYER', 'DP', 'FLEX', 'EH'].includes(String(item.lineupRole)) &&
    (item.jerseyNumber === null || typeof item.jerseyNumber === 'string');
  return value.sheets.every((sheet: unknown) => isRecord(sheet) && typeof sheet.teamId === 'string' &&
    typeof sheet.managerId === 'string' && typeof sheet.revision === 'number' &&
    (sheet.canWithdraw === undefined || typeof sheet.canWithdraw === 'boolean') &&
    Array.isArray(sheet.lineup) && sheet.lineup.every(player) && Array.isArray(sheet.initialLineup) && sheet.initialLineup.every(player) &&
    Array.isArray(sheet.presentOfficials) && sheet.presentOfficials.every(isOfficial) &&
    Array.isArray(sheet.presentSubstitutes) && sheet.presentSubstitutes.every((p: unknown) => isRecord(p) && typeof p.identificationNumber === 'string' && typeof p.displayName === 'string') &&
    Array.isArray(sheet.recipients) && sheet.recipients.every((r: unknown) => isRecord(r) && typeof r.userId === 'string' && ['organizer', 'scorekeeper', 'manager'].includes(String(r.role))) &&
    (sheet.representative === null || isRecord(sheet.representative) && typeof sheet.representative.identificationNumber === 'string' && typeof sheet.representative.displayName === 'string') &&
    typeof sheet.submittedAt === 'string' && typeof sheet.updatedAt === 'string') &&
    value.requests.every((r: unknown) => isRecord(r) && typeof r.id === 'string' && typeof r.teamId === 'string' &&
      typeof r.managerId === 'string' && isAction(r.action) && ['pending', 'approved', 'rejected'].includes(String(r.status)) &&
      typeof r.requestedAt === 'string' && (r.decidedAt === null || typeof r.decidedAt === 'string') &&
      (r.decisionNote === null || typeof r.decisionNote === 'string') && (r.appliedRevision === null || typeof r.appliedRevision === 'number') &&
      (r.courtesyRunnerSource === null || r.courtesyRunnerSource === 'BENCH' || r.courtesyRunnerSource === 'ROSTER') &&
      (r.decidedBy === null || isRecord(r.decidedBy) && typeof r.decidedBy.id === 'string' && ['organizer', 'scorekeeper'].includes(String(r.decidedBy.role))));
}
export function readTeamSheets(value: unknown): TeamSheetsSnapshot {
  if (!isSnapshot(value)) throw new Error('La entrega compartida contiene datos inválidos.');
  return value;
}
