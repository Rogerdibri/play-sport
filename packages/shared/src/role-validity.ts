export const membershipDurations = [
  { months: 1, name: 'Mensual' }, { months: 3, name: 'Trimestral' },
  { months: 6, name: 'Semestral' }, { months: 12, name: 'Anual' }
] as const;
export type MembershipMonths = typeof membershipDurations[number]['months'];
export type MembershipRole = 'player' | 'manager' | 'scorekeeper';
export type RoleValidity = {
  role: MembershipRole; status: 'permanent' | 'not_activated' | 'active' | 'expired' | 'plan';
  activatedAt: string | null; freeExpiresAt: string | null; expiresAt: string | null; now: string;
};
export function addMembershipMonths(start: string, months: MembershipMonths): string {
  const date = new Date(start);
  if (!Number.isFinite(date.getTime()) || !membershipDurations.some(duration => duration.months === months))
    throw new Error('La fecha o duración de la membresía no es válida.');
  const day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}
export function roleValidityAllowsOperation(validity: RoleValidity | undefined): boolean {
  return Boolean(validity && (validity.status === 'permanent' ||
    ['active', 'plan'].includes(validity.status) && validity.expiresAt && Date.parse(validity.expiresAt) > Date.parse(validity.now)));
}
export function readRoleValidity(value: unknown, role?: MembershipRole): RoleValidity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La vigencia del rol no es válida.');
  const row = Object.fromEntries(Object.entries(value));
  const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  if (!['player', 'manager', 'scorekeeper'].includes(String(row.role)) || role && row.role !== role ||
      !['permanent', 'not_activated', 'active', 'expired', 'plan'].includes(String(row.status)) || !iso(row.now) ||
      row.activatedAt !== null && !iso(row.activatedAt) || row.freeExpiresAt !== null && !iso(row.freeExpiresAt) ||
      row.expiresAt !== null && !iso(row.expiresAt) ||
      (row.activatedAt === null) !== (row.freeExpiresAt === null) ||
      iso(row.activatedAt) && row.freeExpiresAt !== addMembershipMonths(row.activatedAt, 6) ||
      row.role === 'player' && (row.status !== 'permanent' || row.activatedAt !== null || row.expiresAt !== null) ||
      row.role !== 'player' && row.status === 'permanent' ||
      ['active', 'plan'].includes(String(row.status)) && (!iso(row.expiresAt) || Date.parse(row.expiresAt) <= Date.parse(row.now)) ||
      row.status === 'active' && row.expiresAt !== row.freeExpiresAt ||
      row.status === 'expired' && (!iso(row.expiresAt) || Date.parse(row.expiresAt) > Date.parse(row.now)) ||
      row.status === 'not_activated' && (row.activatedAt !== null || row.expiresAt !== null))
    throw new Error('Las fechas y estado de vigencia del rol son inconsistentes.');
  return { role: row.role as MembershipRole, status: row.status as RoleValidity['status'],
    activatedAt: row.activatedAt as string | null, freeExpiresAt: row.freeExpiresAt as string | null,
    expiresAt: row.expiresAt as string | null, now: row.now };
}
