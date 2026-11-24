export type PersonnelRole = 'manager' | 'organizer' | 'scorekeeper';
export const battingOrderRule = 'El suplente hereda el turno al bate del jugador saliente. Los cambios defensivos internos no alteran el orden de bateo.';
export type PresentOfficial = {
  role: Exclude<RosterRole, 'PLAYER'>;
  identificationNumber: string;
  displayName: string;
};
export const presentOfficialRoleLabels = Object.fromEntries(Object.entries(rosterRoleLabels).filter(([role]) => role !== 'PLAYER')) as Record<PresentOfficial['role'], string>;
export const isPresentOfficialRole = (value: unknown): value is PresentOfficial['role'] => isRosterRole(value) && value !== 'PLAYER';
export type PersonnelAction =
  | { kind: 'arrival'; identificationNumber: string }
  | { kind: 'substitution'; outgoingIdentificationNumber: string; incomingIdentificationNumber: string; fieldPosition: string; jerseyNumber: string; arrival?: true }
  | { kind: 'defense'; identificationNumber: string; fieldPosition: string; swapWith?: string }
  | { kind: 'courtesy'; fromBase: number; outgoingIdentificationNumber: string; incomingIdentificationNumber: string }
  | { kind: 'staff-arrival'; official: PresentOfficial }
  | { kind: 'staff-departure'; identificationNumber: string; role: PresentOfficial['role'] };
export type TeamSheetPlayer = {
  identificationNumber: string;
  displayName: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string | null;
};
export type PersonnelRequest = {
  id: string;
  teamId: string;
  managerId: string;
  action: PersonnelAction;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; role: 'organizer' | 'scorekeeper' } | null;
  decisionNote: string | null;
  appliedRevision: number | null;
  courtesyRunnerSource: 'BENCH' | 'ROSTER' | null;
};
export type TeamSheet = {
  teamId: string;
  managerId: string;
  revision: number;
  canWithdraw?: boolean;
  lineup: TeamSheetPlayer[];
  initialLineup: TeamSheetPlayer[];
  presentSubstitutes: Array<{ identificationNumber: string; displayName: string }>;
  presentOfficials: PresentOfficial[];
  representative: { identificationNumber: string; displayName: string } | null;
  submittedAt: string;
  updatedAt: string;
  recipients: Array<{ userId: string; role: PersonnelRole }>;
};
export type TeamSheetsSnapshot = {
  gameId: string;
  tournamentId: string;
  version: number;
  canDecide: boolean;
  scoringBlockReason?: string | null;
  ownTeamId: string | null;
  sheets: TeamSheet[];
  requests: PersonnelRequest[];
};

type LineupSizeEntry = Pick<TeamSheetPlayer, 'battingOrder' | 'fieldPosition'>;
const isDefender = (position: string): boolean => privatePositions.includes(position) && position !== 'DH' && position !== 'NA';

export function lineupDefenderCount(entries: ReadonlyArray<{ fieldPosition: string }>): number {
  return entries.filter(entry => isDefender(entry.fieldPosition)).length;
}

export function lineupSizeError(initial: ReadonlyArray<LineupSizeEntry>, next: ReadonlyArray<LineupSizeEntry>): string | null {
  const batters = initial.filter(entry => entry.battingOrder !== null).length;
  if (next.filter(entry => entry.battingOrder !== null).length !== batters) {
    return `El lineup enviado fija ${batters} turnos titulares; una sustitución no puede agregar ni quitar turnos.`;
  }
  const defenders = lineupDefenderCount(initial);
  if (lineupDefenderCount(next) !== defenders) {
    return `El lineup enviado fija ${defenders} defensores; el cambio debe conservar esa cantidad.`;
  }
  return null;
}

export function availablePersonnelPositions(
  sheet: Pick<TeamSheet, 'lineup' | 'initialLineup'>, outgoingId: string, allowSwap = false
): string[] {
  const player = sheet.lineup.find(entry => entry.identificationNumber === outgoingId);
  if (!player) return [];
  return privatePositions.filter(position => {
    const occupied = position === 'NA' ? undefined : sheet.lineup.find(entry =>
      entry !== player && entry.fieldPosition === position);
    const swap = allowSwap && isDefender(position) ? occupied : undefined;
    if (occupied && !swap) return false;
    const next = sheet.lineup.map(entry => entry === player ? { ...entry, fieldPosition: position } :
      entry === swap ? { ...entry, fieldPosition: player.fieldPosition } : entry);
    return lineupSizeError(sheet.initialLineup, next) === null;
  });
}

export type ManagerPersonnelFields = { player: string; outgoing: string; position: string; jersey: string; base: number; name: string; role: PresentOfficial['role'] };
export function managerPersonnelAction(kind: PersonnelAction['kind'], fields: ManagerPersonnelFields): PersonnelAction {
  const id = fields.player.trim(), outgoing = fields.outgoing.trim();
  if (!id) throw new Error('Indica la cédula del participante.');
  switch (kind) {
    case 'arrival': return { kind, identificationNumber: id };
    case 'defense': return { kind, identificationNumber: id, fieldPosition: fields.position };
    case 'substitution':
      if (!outgoing) throw new Error('Indica el jugador saliente.');
      return { kind, incomingIdentificationNumber: id, outgoingIdentificationNumber: outgoing, fieldPosition: fields.position, jerseyNumber: fields.jersey };
    case 'courtesy':
      if (!outgoing || ![1,2,3].includes(fields.base)) throw new Error('Indica el corredor saliente y su base.');
      return { kind, incomingIdentificationNumber: id, outgoingIdentificationNumber: outgoing, fromBase: fields.base };
    case 'staff-arrival':
      if (!fields.name.trim()) throw new Error('Indica el nombre del directivo presente.');
      return { kind, official: { identificationNumber: id, displayName: fields.name.trim(), role: fields.role } };
    case 'staff-departure': return { kind, identificationNumber: id, role: fields.role };
  }
}
import { isRosterRole, rosterRoleLabels, type RosterRole } from './roster.js';
import { privatePositions } from './scorecard.js';
