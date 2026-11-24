import { scorekeeperPlanLevels, type ScorekeeperPlanLevel } from './account-access.js';
import { readRoleValidity, type RoleValidity } from './role-validity.js';
import { readManagerSelection } from './manager-access.js';
import { isStatisticsLine, readStatisticsSnapshot, type ManagerStatisticsPlayer, type StatisticsGame, type StatisticsLine } from './sports-statistics.js';

export type ScorekeeperTournament = { tournamentId: string; tournamentName: string; active: boolean };
export type ScorekeeperExtra = {
  tournamentId: string; gameId: string; status: 'requested' | 'granted' | 'revoked'; revision: number;
};
export type ScorekeeperAccess = {
  accountId: string; level: ScorekeeperPlanLevel; limit: number | null; revision: number; selectionRequired: boolean;
  tournaments: Array<ScorekeeperTournament & { enabled: boolean }>; extras: ScorekeeperExtra[];
  substitutions?: ScorekeeperSubstituteGame[];
  operational?: RoleValidity;
};
export type ScorekeeperSubstituteGame = { tournamentId: string; tournamentName: string; gameId: string };
export type ScorekeeperSubstitutionState = {
  revision: number;
  members: Array<{ actorId: string; name: string; status: 'granted' | 'revoked' }>;
  audit: Array<{ revision: number; actorId: string; organizerId: string; action: 'grant' | 'revoke'; reason: string; at: string }>;
  movements?: Array<{ version: number; actorId: string; role: 'organizer' | 'scorekeeper'; action: string; at: string }>;
};
export type ScorekeeperSubstitutions = ScorekeeperSubstitutionState & { accountId: string; tournamentId: string; gameId: string };
export function readScorekeeperSubstitutions(value: unknown, accountId: string, tournamentId: string, gameId: string): ScorekeeperSubstitutions {
  const row = record(value);
  if (row.accountId !== accountId || row.tournamentId !== tournamentId || row.gameId !== gameId ||
      !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || !Array.isArray(row.members) || !Array.isArray(row.audit))
    throw new Error('Las suplencias no corresponden a la cuenta y partido consultados.');
  const members: ScorekeeperSubstitutionState['members'] = row.members.map(value => {
    const member = record(value);
    if (typeof member.actorId !== 'string' || !member.actorId || typeof member.name !== 'string' || !member.name ||
        member.status !== 'granted' && member.status !== 'revoked') throw new Error('El suplente recibido no es válido.');
    return { actorId: member.actorId, name: member.name, status: member.status };
  });
  const audit: ScorekeeperSubstitutionState['audit'] = row.audit.map((value, index) => {
    const entry = record(value);
    if (entry.revision !== index + 1 || typeof entry.actorId !== 'string' || !entry.actorId ||
        typeof entry.organizerId !== 'string' || !entry.organizerId || entry.action !== 'grant' && entry.action !== 'revoke' ||
        typeof entry.reason !== 'string' || !entry.reason.trim() || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)))
      throw new Error('La auditoría de suplencias no es válida.');
    return { revision: index + 1, actorId: entry.actorId, organizerId: entry.organizerId, action: entry.action, reason: entry.reason, at: entry.at };
  });
  if (new Set(members.map(member => member.actorId)).size !== members.length || audit.length !== row.revision ||
      audit.some(entry => !members.some(member => member.actorId === entry.actorId)) ||
      members.some(member => audit.filter(entry => entry.actorId === member.actorId).at(-1)?.action !== (member.status === 'granted' ? 'grant' : 'revoke')))
    throw new Error('Las revisiones de suplencia son inconsistentes.');
  if (row.movements !== undefined && !Array.isArray(row.movements)) throw new Error('El registro de anotaciones no es válido.');
  const movements: NonNullable<ScorekeeperSubstitutionState['movements']> = [];
  for (const value of row.movements ?? []) {
    const movement = record(value);
    if (!Number.isSafeInteger(movement.version) || Number(movement.version) <= (movements.at(-1)?.version ?? 0) ||
        typeof movement.actorId !== 'string' || !movement.actorId || movement.role !== 'organizer' && movement.role !== 'scorekeeper' ||
        typeof movement.action !== 'string' || !movement.action || typeof movement.at !== 'string' || !Number.isFinite(Date.parse(movement.at)))
      throw new Error('La autoría de las anotaciones no es válida.');
    movements.push({ version: Number(movement.version), actorId: movement.actorId, role: movement.role, action: movement.action, at: movement.at });
  }
  return { accountId, tournamentId, gameId, revision: Number(row.revision), members, audit, movements };
}
export const readScorekeeperSelection = readManagerSelection;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los accesos de Anotador no son válidos.');
  return Object.fromEntries(Object.entries(value));
};
export function readScorekeeperAccess(value: unknown, accountId: string): ScorekeeperAccess {
  const row = record(value);
  if (row.accountId !== accountId || ![1, 2, 3].includes(Number(row.level)) ||
      typeof row.level !== 'number' || row.limit !== scorekeeperPlanLevels[row.level - 1].limit ||
      !Number.isSafeInteger(row.revision) || Number(row.revision) < 0 || typeof row.selectionRequired !== 'boolean' ||
      !Array.isArray(row.tournaments) || !Array.isArray(row.extras)) throw new Error('Los accesos no corresponden a tu cuenta.');
  const tournaments = row.tournaments.map(value => {
    const team = record(value);
    if (typeof team.tournamentId !== 'string' || !team.tournamentId || typeof team.tournamentName !== 'string' ||
        typeof team.active !== 'boolean' || typeof team.enabled !== 'boolean') throw new Error('El torneo recibido no es válido.');
    return { tournamentId: team.tournamentId, tournamentName: team.tournamentName, active: team.active, enabled: team.enabled };
  });
  const extras: ScorekeeperExtra[] = row.extras.map(value => {
    const extra = record(value);
    if (typeof extra.tournamentId !== 'string' || !extra.tournamentId || typeof extra.gameId !== 'string' || !extra.gameId ||
        !['requested', 'granted', 'revoked'].includes(String(extra.status)) ||
        !Number.isSafeInteger(extra.revision) || Number(extra.revision) < 1) throw new Error('El acceso puntual no es válido.');
    return { tournamentId: extra.tournamentId, gameId: extra.gameId, status: extra.status as ScorekeeperExtra['status'], revision: Number(extra.revision) };
  });
  let substitutions: ScorekeeperSubstituteGame[] | undefined;
  if (row.substitutions !== undefined) {
    if (!Array.isArray(row.substitutions)) throw new Error('Las suplencias recibidas no son válidas.');
    substitutions = row.substitutions.map(value => {
      const item = record(value);
      if (typeof item.tournamentId !== 'string' || !item.tournamentId || typeof item.gameId !== 'string' || !item.gameId ||
          typeof item.tournamentName !== 'string' || !item.tournamentName) throw new Error('El partido de suplencia no es válido.');
      return { tournamentId: item.tournamentId, gameId: item.gameId, tournamentName: item.tournamentName };
    });
    if (new Set(substitutions.map(item => JSON.stringify([item.tournamentId, item.gameId]))).size !== substitutions.length)
      throw new Error('El partido de suplencia está repetido.');
  }
  if (new Set(tournaments.map(team => team.tournamentId)).size !== tournaments.length ||
      new Set(extras.map(extra => JSON.stringify([extra.tournamentId, extra.gameId]))).size !== extras.length ||
      row.limit !== null && tournaments.filter(team => team.active && team.enabled).length > Number(row.limit))
    throw new Error('Los cupos recibidos son inconsistentes.');
  return { accountId, level: row.level as ScorekeeperPlanLevel, limit: row.limit === null ? null : Number(row.limit),
    revision: Number(row.revision), selectionRequired: row.selectionRequired, tournaments, extras, ...(substitutions ? { substitutions } : {}),
    ...(row.operational === undefined ? {} : { operational: readRoleValidity(row.operational, 'scorekeeper') }) };
}
export type ScorekeeperPlayerTotal = { id: string; name: string | null; group: string; line: StatisticsLine | null };
export type ScorekeeperStatistics = {
  accountId: string; tournamentId: string; gameId: string | null;
  games: StatisticsGame[]; players: ManagerStatisticsPlayer[]; totals: ScorekeeperPlayerTotal[];
};
export type ScorekeeperExtraRequest = ScorekeeperExtra & { accountId: string; accountName: string };
export function readScorekeeperExtraQueue(value: unknown, accountId: string): ScorekeeperExtraRequest[] {
  const row = record(value);
  if (row.accountId !== accountId || !Array.isArray(row.requests)) throw new Error('Las solicitudes no corresponden al administrador.');
  return row.requests.map(value => {
    const request = record(value);
    if (typeof request.accountId !== 'string' || !request.accountId || typeof request.accountName !== 'string')
      throw new Error('La solicitud puntual no es válida.');
    const access = readScorekeeperAccess({ accountId: request.accountId, level: 1, limit: 1, revision: 0,
      selectionRequired: false, tournaments: [], extras: [request] }, request.accountId);
    return { ...access.extras[0], accountId: request.accountId, accountName: request.accountName };
  });
}
export function readScorekeeperStatistics(value: unknown, accountId: string, tournamentId: string, gameId: string | null): ScorekeeperStatistics {
  const row = record(value);
  if (row.accountId !== accountId || row.tournamentId !== tournamentId || row.gameId !== gameId || !Array.isArray(row.totals))
    throw new Error('Las estadísticas no corresponden al torneo y partido solicitados.');
  const snapshot = readStatisticsSnapshot({ ...row, mode: 'team', source: 'official', identityVerified: true, analysisAllowed: gameId === null },
    accountId, 'team', 'official');
  if ([...snapshot.games, ...(snapshot.players ?? []).map(player => player.game)].some(game =>
    game.tournamentId !== tournamentId || gameId !== null && game.gameId !== gameId))
    throw new Error('El informe contiene estadísticas fuera del ámbito autorizado.');
  if (gameId !== null && row.totals.length) throw new Error('El box score por partido no admite acumulados.');
  const totals: ScorekeeperPlayerTotal[] = row.totals.map(value => {
    const total = record(value);
    if (typeof total.id !== 'string' || !/^player-[a-f0-9]{64}$/.test(total.id) ||
        !(total.name === null || typeof total.name === 'string') || typeof total.group !== 'string' ||
        !(total.line === null || isStatisticsLine(total.line))) throw new Error('El acumulado del torneo no es válido.');
    return { id: total.id, name: total.name, group: total.group, line: total.line };
  });
  return { accountId, tournamentId, gameId, games: snapshot.games, players: snapshot.players ?? [], totals };
}
