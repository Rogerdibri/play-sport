import { normalizeProfileIdentification, registrationAge, registrationIdentification, validateRegistrationContact } from './registration.js';
import type { RosterAdmission } from './roster-rules.js';

export const rosterRoleLabels = {
  PLAYER: 'Jugador', DIRIGENTE: 'Dirigente', MANAGER: 'Manager', DELEGADO: 'Delegado',
  COACH_FIRST: 'Coach de primera', COACH_THIRD: 'Coach de tercera', COACH_BENCH: 'Coach de banca',
  COACH_PITCHING: 'Entrenador de lanzadores', COACH_BATTING: 'Entrenador de bateo',
  TRAINER: 'Preparador físico', MEDICAL: 'Médico', PHYSIO: 'Fisioterapeuta', EQUIPMENT: 'Utilero'
} as const;
export type RosterRole = keyof typeof rosterRoleLabels;
export function isRosterRole(value: unknown): value is RosterRole { return typeof value === 'string' && Object.hasOwn(rosterRoleLabels, value); }
export type PreRegistration = {
  identification: string; fullName: string; birthDate: string; email: string; phone: string; representativeIdentification: string;
};
export const newPreRegistration = (): PreRegistration => ({ identification: '', fullName: '', birthDate: '', email: '', phone: '', representativeIdentification: '' });
export const normalizedPersonName = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es').replace(/\s+/g, ' ').trim();
export function validatePreRegistration(input: PreRegistration, today = new Date()): PreRegistration & { isMinor: boolean } {
  if (!input || typeof input !== 'object' || typeof input.fullName !== 'string' ||
      input.fullName.length > 120 || input.fullName.trim().split(/\s+/).length < 2) throw new Error('Introduce nombre y apellido.');
  const isMinor = registrationAge(input.birthDate, today) < 18;
  const identification = input.identification === '' && isMinor ? '' : registrationIdentification(input.identification);
  const representativeIdentification = isMinor ? registrationIdentification(input.representativeIdentification) : '';
  if (identification && representativeIdentification === identification) throw new Error('La cédula del representante no puede ser la del menor.');
  return { identification, fullName: input.fullName.trim().replace(/\s+/g, ' '), birthDate: input.birthDate,
    ...validateRegistrationContact(input.email, input.phone), representativeIdentification, isMinor };
}
export type RosterPerson = {
  id: string; identification: string; fullName: string; isMinor: boolean;
  registrationStatus: 'preinscribed' | 'registered' | 'sports-record';
  privateIdentity?: true;
};
export type RosterMember = { person: RosterPerson; role: RosterRole; approvalStatus: 'approved' | 'pending'; canInvite?: boolean; addedBy?: 'manager' | 'organizer' };
export type ManagerRosterTeam = { tournamentId: string; teamId: string; managerId: string; tournamentName: string; teamName: string };
export type ManagerRoster = { team: ManagerRosterTeam; members: RosterMember[]; admission?: RosterAdmission };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function isPreRegistrationDraft(value: unknown): value is PreRegistration {
  return record(value) && Object.keys(newPreRegistration()).every(key => typeof value[key] === 'string' && String(value[key]).length <= 254);
}
export function isRosterPerson(value: unknown): value is RosterPerson {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 120 &&
    typeof value.identification === 'string' && value.identification.length <= 120 && typeof value.fullName === 'string' &&
    value.fullName.length > 0 && value.fullName.length <= 120 && typeof value.isMinor === 'boolean' &&
    ['preinscribed','registered','sports-record'].includes(String(value.registrationStatus));
}
export function isManagerRosterTeam(value: unknown): value is ManagerRosterTeam {
  return record(value) && ['tournamentId','teamId','managerId','tournamentName','teamName'].every(key => typeof value[key] === 'string' && String(value[key]).length > 0);
}
export function readManagerRoster(value: unknown): ManagerRoster {
  if (!record(value) || !isManagerRosterTeam(value.team) || !Array.isArray(value.members) ||
      !value.members.every(row => record(row) && isRosterPerson(row.person) && isRosterRole(row.role) && ['approved','pending'].includes(String(row.approvalStatus)) &&
        (row.canInvite === undefined || typeof row.canInvite === 'boolean') &&
        (row.addedBy === undefined || row.addedBy === 'manager' || row.addedBy === 'organizer'))) {
    throw new Error('La API devolvió un roster inválido. No se sustituyeron los datos.');
  }
  return { team: value.team, members: value.members, ...(value.admission === undefined ? {} : { admission: readRosterAdmission(value.admission) }) };
}
function readRosterAdmission(value: unknown): RosterAdmission {
  if (!record(value) || typeof value.configured !== 'boolean' || typeof value.closed !== 'boolean' ||
      typeof value.reason !== 'string' || !(value.closedAt === null || typeof value.closedAt === 'string' && Number.isFinite(Date.parse(value.closedAt))) ||
      !record(value.groups) || !['players','direction','coaches','support'].every(key => record(value.groups) && record(value.groups[key]) &&
        Number.isSafeInteger(value.groups[key].used) && Number(value.groups[key].used) >= 0 &&
        (value.groups[key].limit === null || Number.isSafeInteger(value.groups[key].limit) && Number(value.groups[key].limit) >= 0))) {
    throw new Error('La API no confirmó los cupos y el cierre del roster.');
  }
  return value as RosterAdmission;
}
export function rosterLookupKey(value: string) {
  const key = normalizeProfileIdentification(value);
  if (!/^[A-Z0-9-]{4,120}$/.test(key)) throw new Error('Introduce una cédula o ID válido.');
  return key;
}
export type MatchLeader = { identificationNumber: string; displayName: string; authorizedByManagerId: string; authorizedAt: string };
export function readMatchLeader(value: unknown): MatchLeader | null {
  if (!record(value) || !('representative' in value)) throw new Error('La API no confirmó al dirigente de este partido.');
  const person = value.representative;
  if (person === null) return null;
  if (!record(person) || typeof person.identificationNumber !== 'string' || typeof person.displayName !== 'string' ||
      typeof person.authorizedByManagerId !== 'string' || typeof person.authorizedAt !== 'string') {
    throw new Error('La API devolvió una designación de dirigente inválida.');
  }
  return { identificationNumber: person.identificationNumber, displayName: person.displayName,
    authorizedByManagerId: person.authorizedByManagerId, authorizedAt: person.authorizedAt };
}
export class RosterClient {
  private readonly base: string;
  private readonly managerId: string;
  constructor(base: string, managerId: string) { this.base = base; this.managerId = managerId; }
  private async request(path: string, input?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base.replace(/\/$/, '')}/registration/roster/${path}`, input === undefined ? { credentials: 'include' } :
      { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(record(value) && typeof value.message === 'string' ? value.message : `No se pudo consultar el roster (${response.status}).`);
    return value;
  }
  async teams(): Promise<ManagerRosterTeam[]> {
    const value = await this.request(`teams?managerId=${encodeURIComponent(this.managerId)}`);
    if (!record(value) || !Array.isArray(value.teams) || !value.teams.every(isManagerRosterTeam) ||
        value.teams.some(team => team.managerId !== this.managerId)) throw new Error('La API no confirmó los equipos de este manager.');
    return value.teams;
  }
  private query(team: ManagerRosterTeam) {
    return new URLSearchParams({ managerId: this.managerId, tournamentId: team.tournamentId, teamId: team.teamId });
  }
  private roster(value: unknown, team: ManagerRosterTeam) {
    const roster = readManagerRoster(value);
    if (roster.team.managerId !== this.managerId || roster.team.teamId !== team.teamId || roster.team.tournamentId !== team.tournamentId) {
      throw new Error('La respuesta no corresponde al equipo seleccionado. No se sustituyó el roster.');
    }
    return roster;
  }
  async load(team: ManagerRosterTeam) { return this.roster(await this.request(`members?${this.query(team)}`), team); }
  async lookup(team: ManagerRosterTeam, key: string): Promise<RosterPerson | null> {
    const value = await this.request(`person?${this.query(team)}&identification=${encodeURIComponent(rosterLookupKey(key))}`);
    if (!record(value) || value.person !== null && !isRosterPerson(value.person)) throw new Error('La API devolvió una persona inválida.');
    return value.person;
  }
  async add(team: ManagerRosterTeam, role: RosterRole, personId: string) {
    return this.roster(await this.request('members', { managerId: this.managerId, tournamentId: team.tournamentId, teamId: team.teamId, role, personId }), team);
  }
  async preinscribe(team: ManagerRosterTeam, role: RosterRole, person: PreRegistration) {
    validatePreRegistration(person);
    return this.roster(await this.request('preinscriptions', { managerId: this.managerId, tournamentId: team.tournamentId, teamId: team.teamId, role, person }), team);
  }
  async invite(team: ManagerRosterTeam, personId: string): Promise<string> {
    const value = await this.request('invitation', { managerId: this.managerId, tournamentId: team.tournamentId, teamId: team.teamId, personId });
    if (!record(value) || typeof value.invitation !== 'string' || !/^[a-f0-9]{64}$/.test(value.invitation)) throw new Error('La API no confirmó la invitación privada.');
    return value.invitation;
  }
}
