import { managerPlanLevels, type ManagerPlanLevel } from './account-access.js';
import { readRoleValidity, type RoleValidity } from './role-validity.js';

export type ManagedTeam = {
  tournamentId: string; tournamentName: string; teamId: string; teamName: string; active: boolean;
};
export type ManagerTeamAccess = {
  accountId: string; level: ManagerPlanLevel; limit: number | null; revision: number; selectionRequired: boolean;
  teams: Array<ManagedTeam & { managed: boolean }>;
  operational?: RoleValidity;
};
export const managerTeamKey = (team: Pick<ManagedTeam, 'tournamentId' | 'teamId'>) => JSON.stringify([team.tournamentId, team.teamId]);
export function readManagerSelection(value: unknown): { expectedAccountId: string; expectedRevision: number; selected: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Selecciona tus inscripciones activas.');
  const row = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).some(key => !['expectedAccountId', 'expectedRevision', 'selected'].includes(key)) ||
      typeof row.expectedAccountId !== 'string' || typeof row.expectedRevision !== 'number' ||
      !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 || row.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !Array.isArray(row.selected) || row.selected.some(key => typeof key !== 'string' || !key || key.length > 2000) ||
      new Set(row.selected).size !== row.selected.length) throw new Error('La selección de equipos o su revisión no es válida.');
  return { expectedAccountId: row.expectedAccountId, expectedRevision: row.expectedRevision, selected: row.selected };
}
export function readManagerTeamAccess(value: unknown, accountId: string): ManagerTeamAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('No se pudieron recuperar tus cupos de Manager.');
  const row = Object.fromEntries(Object.entries(value));
  if (row.accountId !== accountId || (row.level !== 1 && row.level !== 2 && row.level !== 3) ||
      row.limit !== managerPlanLevels[row.level - 1].limit ||
      typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 0 ||
      typeof row.selectionRequired !== 'boolean' || !Array.isArray(row.teams)) throw new Error('Los cupos no corresponden a tu cuenta.');
  const teams: ManagerTeamAccess['teams'] = row.teams.map(value => {
    if (!value || typeof value !== 'object') throw new Error('La inscripción de Manager no es válida.');
    const team = Object.fromEntries(Object.entries(value));
    if (!['teamId', 'teamName', 'tournamentId', 'tournamentName'].every(key => typeof team[key] === 'string' && team[key] !== '') ||
        typeof team.active !== 'boolean' || typeof team.managed !== 'boolean' || team.managed && !team.active)
      throw new Error('La inscripción de Manager no es válida.');
    return { teamId: String(team.teamId), teamName: String(team.teamName), tournamentId: String(team.tournamentId),
      tournamentName: String(team.tournamentName), active: team.active, managed: team.managed };
  });
  if (new Set(teams.map(managerTeamKey)).size !== teams.length ||
      row.limit !== null && teams.filter(team => team.managed).length > Number(row.limit))
    throw new Error('Los cupos de Manager recibidos son inconsistentes.');
  return { accountId, level: row.level, limit: row.limit === null ? null : Number(row.limit), revision: row.revision,
    selectionRequired: row.selectionRequired, teams,
    ...(row.operational === undefined ? {} : { operational: readRoleValidity(row.operational, 'manager') }) };
}
