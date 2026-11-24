import { membershipDurations, readRoleValidity, type MembershipMonths, type RoleValidity } from './role-validity.js';
export const accessFeatures = ['player-statistics', 'team-statistics', 'career', 'final-report-details', 'player-statistics-analysis', 'manager-statistics-analysis', 'scorekeeper-box-score', 'scorekeeper-tournament-analysis'] as const;
export type AccessFeature = typeof accessFeatures[number];
export const trialPlanIds = ['player', 'player-numbers', 'manager', 'manager-numbers', 'manager-basic', 'scorekeeper', 'scorekeeper-numbers', 'scorekeeper-basic', 'organizer'] as const;
export type TrialPlanId = typeof trialPlanIds[number];
export const trialPlans: ReadonlyArray<{ id: TrialPlanId; name: string; features: readonly AccessFeature[] }> = [
  { id: 'player', name: 'Jugador · Nivel 3 · Análisis completo', features: ['player-statistics', 'career', 'final-report-details', 'player-statistics-analysis'] },
  { id: 'player-numbers', name: 'Jugador · Nivel 2 · Mis números', features: ['player-statistics', 'final-report-details'] },
  { id: 'manager', name: 'Manager · Nivel 3 · Análisis completo', features: ['team-statistics', 'career', 'final-report-details', 'manager-statistics-analysis'] },
  { id: 'manager-numbers', name: 'Manager · Nivel 2 · Mis equipos por juego', features: ['team-statistics', 'final-report-details'] },
  { id: 'manager-basic', name: 'Manager · Nivel 1 · Básico operativo', features: [] },
  { id: 'scorekeeper', name: 'Anotador · Nivel 3 · Torneos completos', features: ['scorekeeper-box-score', 'scorekeeper-tournament-analysis'] },
  { id: 'scorekeeper-numbers', name: 'Anotador · Nivel 2 · Box score por partido', features: ['scorekeeper-box-score'] },
  { id: 'scorekeeper-basic', name: 'Anotador · Nivel 1 · Básico operativo', features: [] },
  { id: 'organizer', name: 'Organizador', features: ['career', 'final-report-details'] },
];
export const accessFeatureLabels: Record<AccessFeature, string> = {
  'player-statistics': 'Estadísticas personales', 'team-statistics': 'Estadísticas de equipos que dirigí',
  career: 'Trayectoria deportiva', 'final-report-details': 'Cifras detalladas del resumen final',
  'player-statistics-analysis': 'Análisis personal con filtros y desgloses',
  'manager-statistics-analysis': 'Análisis de equipos e inscripciones ilimitadas de Manager',
  'scorekeeper-box-score': 'Box score de los partidos autorizados de Anotador',
  'scorekeeper-tournament-analysis': 'Acumulados individuales de Anotador separados por torneo',
};
export type ScorekeeperPlanLevel = 1 | 2 | 3;
export const scorekeeperPlanLevels = [
  { level: 1, name: 'Básico · 6 meses gratuitos', limit: 1,
    benefits: ['Un torneo', 'Pizarra de 9 innings en béisbol y 7 en softbol', 'Reconocimientos solo con nombres, sin cifras detalladas',
      'Acceso puntual adicional por partido de otro torneo'] },
  { level: 2, name: 'Box score por partido', limit: 3,
    benefits: ['Hasta tres torneos, aunque pertenezcan a la misma liga', 'Box score completo únicamente del partido consultado',
      'Sin acumulados individuales', 'Acceso puntual adicional por partido fuera de tus tres torneos'] },
  { level: 3, name: 'Torneos completos', limit: null,
    benefits: ['Inscripciones ilimitadas', 'Todo el box score del nivel 2', 'Detalle y acumulados individuales solo del torneo seleccionado',
      'Nunca trayectoria global ni mezcla de torneos o ligas'] },
] as const;
export function scorekeeperPlanLevel(account: { localTestAccess?: true; features?: readonly AccessFeature[] } | null | undefined): ScorekeeperPlanLevel {
  if (account?.localTestAccess) return 3;
  if (!account?.features?.includes('scorekeeper-box-score')) return 1;
  return account.features.includes('scorekeeper-tournament-analysis') ? 3 : 2;
}
export const scorekeeperTournamentLimit = (account: Parameters<typeof scorekeeperPlanLevel>[0]): number | null =>
  scorekeeperPlanLevels[scorekeeperPlanLevel(account) - 1].limit;
export type PlayerPlanLevel = 1 | 2 | 3;
export type ManagerPlanLevel = 1 | 2 | 3;
export const playerPlanLevels: ReadonlyArray<{ level: PlayerPlanLevel; name: string; description: string; benefits: readonly string[] }> = [
  { level: 1, name: 'Básico gratuito', description: 'Participa y sigue tus juegos, sin estadísticas personales.',
    benefits: ['Perfil y fotografía', 'Tus equipos, ligas y cartelera', 'Notificaciones de tus juegos dentro de PlaySport',
      'Marcador, pizarra por innings y reconocimientos sin cifras individuales'] },
  { level: 2, name: 'Mis números', description: 'Consulta tus cifras de cada juego por separado, sin acumulados ni filtros personalizados.',
    benefits: ['Todo lo incluido en el nivel básico', 'Estadísticas personales de cada partido',
      'Participaciones oficiales, amistosas y privadas vinculadas a tu identidad', 'Bateo, pitcheo y defensa únicamente del juego que abras'] },
  { level: 3, name: 'Análisis completo', description: 'Consulta y analiza tu historia con filtros y desgloses.',
    benefits: ['Todo lo incluido en Mis números', 'Filtros por juego, torneo, temporada, liga, equipo y fechas',
      'Acumulados históricos y personalizados', 'Trayectoria detallada de Jugador'] },
];
export function playerPlanLevel(account: { localTestAccess?: true; features?: readonly AccessFeature[] } | null | undefined): PlayerPlanLevel {
  if (account?.localTestAccess) return 3;
  if (!account?.features?.includes('player-statistics')) return 1;
  return account.features.includes('player-statistics-analysis') ? 3 : 2;
}
export const managerPlanLevels = [
  { level: 1, name: 'Básico · 6 meses gratuitos', limit: 1, description: 'Administra una inscripción activa, sin estadísticas detalladas. La gratuidad comienza al activar el rol.',
    benefits: ['Plantel, alineaciones y calendario', 'Pizarra y resultados básicos', 'Los equipos históricos no consumen cupos'] },
  { level: 2, name: 'Mis equipos por juego', limit: 3, description: 'Consulta cada partido por separado.',
    benefits: ['Hasta tres inscripciones activas', 'Estadísticas del equipo y de cada jugador del partido abierto',
      'Sin acumulados ni filtros de análisis'] },
  { level: 3, name: 'Análisis completo', limit: null, description: 'Administra inscripciones ilimitadas y analiza tus equipos.',
    benefits: ['Inscripciones activas ilimitadas', 'Filtros y análisis de los equipos que dirigiste',
      'Estadísticas de cada jugador solo por partido, nunca acumuladas', 'Torneos activos y cerrados: consulta individual partido por partido'] },
] as const;
export function managerPlanLevel(account: { localTestAccess?: true; features?: readonly AccessFeature[] } | null | undefined): ManagerPlanLevel {
  if (account?.localTestAccess) return 3;
  if (!account?.features?.includes('team-statistics')) return 1;
  return account.features.includes('manager-statistics-analysis') ? 3 : 2;
}
export const managerTeamLimit = (account: Parameters<typeof managerPlanLevel>[0]): number | null =>
  managerPlanLevels[managerPlanLevel(account) - 1].limit;
export function isAccessFeature(value: unknown): value is AccessFeature {
  return accessFeatures.some(feature => feature === value);
}
export function isTrialPlanId(value: unknown): value is TrialPlanId {
  return trialPlanIds.some(plan => plan === value);
}
export function hasAccountAccessControls(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
export function hasAccountFeature(account: { localTestAccess?: true; features?: AccessFeature[] } | null | undefined, feature: AccessFeature) {
  return Boolean(account?.localTestAccess || account?.features?.includes(feature));
}
export type AccountTrial = {
  planId: TrialPlanId; active: boolean; expiresAt: string; updatedAt: string; revision: number;
};
export function trialStatus(trial: AccountTrial, now: number): 'active' | 'expired' | 'revoked' {
  return !trial.active ? 'revoked' : Date.parse(trial.expiresAt) <= now ? 'expired' : 'active';
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Los datos de acceso no son válidos.');
  return Object.fromEntries(Object.entries(value));
}
function iso(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function readAccountTrial(value: unknown): AccountTrial {
  const row = record(value);
  if (!isTrialPlanId(row.planId) || typeof row.active !== 'boolean' || !iso(row.expiresAt) || !iso(row.updatedAt) ||
      typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) {
    throw new Error('La prueba guardada no es válida.');
  }
  return { planId: row.planId, active: row.active, expiresAt: row.expiresAt, updatedAt: row.updatedAt, revision: row.revision };
}
export type TrialChange = {
  requestId: string; expectedAdminId: string; accountId: string; planId: TrialPlanId; expectedRevision: number;
  action: 'grant' | 'revoke'; reason: string; expiresAt?: string; months?: MembershipMonths;
};
export function readTrialChange(value: unknown): TrialChange {
  const row = record(value);
  if (Object.keys(row).some(key => !['requestId', 'expectedAdminId', 'accountId', 'planId', 'expectedRevision', 'action', 'reason', 'expiresAt', 'months'].includes(key)) ||
      typeof row.requestId !== 'string' || !uuid.test(row.requestId) ||
      typeof row.expectedAdminId !== 'string' || !uuid.test(row.expectedAdminId) ||
      typeof row.accountId !== 'string' || !uuid.test(row.accountId) || !isTrialPlanId(row.planId) ||
      typeof row.expectedRevision !== 'number' || !Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 0 ||
      row.expectedRevision >= Number.MAX_SAFE_INTEGER || !['grant', 'revoke'].includes(String(row.action)) ||
      typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 500 || hasAccountAccessControls(row.reason) ||
      row.action === 'grant' && (('expiresAt' in row) === ('months' in row) ||
        'expiresAt' in row && !iso(row.expiresAt) || 'months' in row && !membershipDurations.some(duration => duration.months === row.months)) ||
      row.action === 'revoke' && ('expiresAt' in row || 'months' in row) || row.planId === 'organizer' && 'months' in row) {
    throw new Error('Indica la cuenta, plan, revisión, motivo y vencimiento válidos.');
  }
  return { requestId: row.requestId, expectedAdminId: row.expectedAdminId, accountId: row.accountId, planId: row.planId,
    expectedRevision: row.expectedRevision, action: row.action === 'grant' ? 'grant' : 'revoke', reason: row.reason.trim(),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
    ...(typeof row.months === 'number' ? { months: row.months as MembershipMonths } : {}) };
}
export type OwnAccountAccess = { accountId: string; now: string; features: AccessFeature[]; trials: AccountTrial[]; roles?: RoleValidity[] };
export function readOwnAccountAccess(value: unknown, accountId: string): OwnAccountAccess {
  const row = record(value);
  if (row.accountId !== accountId || !iso(row.now) || !Array.isArray(row.features) || !row.features.every(isAccessFeature) || !Array.isArray(row.trials)) {
    throw new Error('Los accesos no corresponden a tu cuenta.');
  }
  let roles: RoleValidity[] | undefined;
  if (row.roles !== undefined) {
    if (!Array.isArray(row.roles) || row.roles.length !== 3) throw new Error('Las vigencias de roles no son válidas.');
    roles = row.roles.map(value => readRoleValidity(value));
    if (new Set(roles.map(value => value.role)).size !== 3 || roles.some(value => value.now !== row.now))
      throw new Error('Las vigencias de roles son inconsistentes.');
  }
  return { accountId, now: row.now, features: row.features, trials: row.trials.map(readAccountTrial), ...(roles ? { roles } : {}) };
}
export type AdministrationUser = { id: string; displayName: string; email: string; identityVerified: boolean; trials: AccountTrial[] };
export type TrialAudit = {
  id: number; actorName: string; targetName: string; planId: TrialPlanId; action: 'grant' | 'revoke';
  reason: string; at: string; previousExpiresAt: string | null; expiresAt: string;
};
export type AdministrationSnapshot = {
  accountId: string; now: string; page: number; total: number; users: AdministrationUser[];
  auditPage: number; auditTotal: number; audit: TrialAudit[];
};
export function readAdministrationSnapshot(value: unknown, accountId: string): AdministrationSnapshot {
  const row = record(value);
  const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  if (row.accountId !== accountId || !iso(row.now) || !integer(row.page) || !integer(row.total) ||
      !integer(row.auditPage) || !integer(row.auditTotal) || !Array.isArray(row.users) || row.users.length > 25 ||
      !Array.isArray(row.audit) || row.audit.length > 25) throw new Error('No se pudo validar la administración de esta cuenta.');
  const users = row.users.map(value => {
    const user = record(value);
    if (typeof user.id !== 'string' || !uuid.test(user.id) || typeof user.displayName !== 'string' || !user.displayName ||
        typeof user.email !== 'string' || typeof user.identityVerified !== 'boolean' || !Array.isArray(user.trials)) {
      throw new Error('El usuario administrativo no es válido.');
    }
    return { id: user.id, displayName: user.displayName, email: user.email, identityVerified: user.identityVerified, trials: user.trials.map(readAccountTrial) };
  });
  const audit = row.audit.map((value): TrialAudit => {
    const event = record(value);
    if (!integer(event.id) || event.id < 1 || typeof event.actorName !== 'string' || typeof event.targetName !== 'string' ||
        !isTrialPlanId(event.planId) || (event.action !== 'grant' && event.action !== 'revoke') || typeof event.reason !== 'string' ||
        !iso(event.at) || !iso(event.expiresAt) || event.previousExpiresAt !== null && !iso(event.previousExpiresAt)) throw new Error('La auditoría recibida no es válida.');
    return { id: event.id, actorName: event.actorName, targetName: event.targetName, planId: event.planId, action: event.action,
      reason: event.reason, at: event.at, previousExpiresAt: event.previousExpiresAt, expiresAt: event.expiresAt };
  });
  return { accountId, now: row.now, page: row.page, total: row.total, users, auditPage: row.auditPage, auditTotal: row.auditTotal, audit };
}
