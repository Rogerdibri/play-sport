import { isCalendarDate } from './events-calendar.js';
import type { OfficialGameStatus } from './official-games.js';
import type { RosterMember, RosterRole } from './roster.js';

export type RosterGroup = 'players' | 'direction' | 'coaches' | 'support';
export const rosterGroups = [
  { id: 'players', title: 'Jugadores', roles: ['PLAYER'] },
  { id: 'direction', title: 'Dirección', roles: ['DIRIGENTE', 'MANAGER', 'DELEGADO'] },
  { id: 'coaches', title: 'Cuerpo técnico', roles: ['COACH_FIRST', 'COACH_THIRD', 'COACH_BENCH', 'COACH_PITCHING', 'COACH_BATTING'] },
  { id: 'support', title: 'Personal de apoyo', roles: ['TRAINER', 'MEDICAL', 'PHYSIO', 'EQUIPMENT'] }
] satisfies { id: RosterGroup; title: string; roles: RosterRole[] }[];
export type RosterCaps = Record<RosterGroup, number>;
export type RosterCutoff =
  | { kind: 'date'; date: string }
  | { kind: 'round'; round: number; moment: 'start' | 'finish'; rounds: Record<string, number> }
  | { kind: 'games'; games: number; count: 'tournament' | 'first-team' | 'all-teams' };
export type RosterRules = { caps: RosterCaps; cutoff: RosterCutoff };
export type RosterRuleGame = { gameId: string; homeTeamId: string; awayTeamId: string; status: OfficialGameStatus; label: string; started: boolean };
export type RosterAdmission = {
  configured: boolean; closed: boolean; reason: string; closedAt: string | null;
  groups: Record<RosterGroup, { used: number; limit: number | null }>;
};
export type RosterRulesView = {
  tournamentId: string; tournamentName: string; organizerId: string; revision: number;
  rules: RosterRules | null; closedAt: string | null; closed: boolean; reason: string;
  games: RosterRuleGame[]; teamIds: string[];
};
export type RosterRulesDraft = {
  caps: Record<RosterGroup, string>; kind: RosterCutoff['kind']; date: string; round: string; games: string;
  moment: 'start' | 'finish'; count: 'tournament' | 'first-team' | 'all-teams'; rounds: Record<string, string>;
};
export function rosterRulesDraft(rules: RosterRules | null): RosterRulesDraft {
  const cutoff = rules?.cutoff;
  return { caps: { players: rules ? String(rules.caps.players) : '', direction: rules ? String(rules.caps.direction) : '',
    coaches: rules ? String(rules.caps.coaches) : '', support: rules ? String(rules.caps.support) : '' },
    kind: cutoff?.kind ?? 'date', date: cutoff?.kind === 'date' ? cutoff.date : '', round: cutoff?.kind === 'round' ? String(cutoff.round) : '',
    games: cutoff?.kind === 'games' ? String(cutoff.games) : '', moment: cutoff?.kind === 'round' ? cutoff.moment : 'start',
    count: cutoff?.kind === 'games' ? cutoff.count : 'tournament',
    rounds: cutoff?.kind === 'round' ? Object.fromEntries(Object.entries(cutoff.rounds).map(([id, round]) => [id, String(round)])) : {} };
}
export function rulesFromDraft(draft: RosterRulesDraft): RosterRules {
  if (rosterGroups.some(group => !/^\d+$/.test(draft.caps[group.id]))) throw new Error('Completa los cuatro cupos con números enteros no negativos.');
  return readRosterRules({ caps: Object.fromEntries(rosterGroups.map(group => [group.id, Number(draft.caps[group.id])])),
    cutoff: draft.kind === 'date' ? { kind: 'date', date: draft.date } : draft.kind === 'games' ?
      { kind: 'games', games: Number(draft.games), count: draft.count } :
      { kind: 'round', round: Number(draft.round), moment: draft.moment,
        rounds: Object.fromEntries(Object.entries(draft.rounds).filter(([, value]) => value.trim()).map(([id, value]) => [id, Number(value)])) } });
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
export function rosterGroup(role: RosterRole): RosterGroup {
  const group = rosterGroups.find(item => item.roles.some(candidate => candidate === role));
  if (!group) throw new Error('Cargo de roster inválido.');
  return group.id;
}
export function readRosterRules(value: unknown): RosterRules {
  if (!record(value) || !record(value.caps) || !rosterGroups.every(group => integer(record(value.caps) ? value.caps[group.id] : undefined)) ||
      !record(value.cutoff)) throw new Error('Configura los cuatro cupos del roster con números enteros no negativos.');
  const cutoff = value.cutoff;
  const caps = { players: Number(value.caps.players), direction: Number(value.caps.direction), coaches: Number(value.caps.coaches), support: Number(value.caps.support) };
  if (cutoff.kind === 'date' && isCalendarDate(cutoff.date) && Object.keys(cutoff).every(key => ['kind','date'].includes(key))) {
    return { caps, cutoff: { kind: 'date', date: cutoff.date } };
  }
  if (cutoff.kind === 'round' && integer(cutoff.round, 1) && (cutoff.moment === 'start' || cutoff.moment === 'finish') &&
      record(cutoff.rounds) && Object.entries(cutoff.rounds).every(([key,round]) => key.length > 0 && integer(round,1)) &&
      Object.keys(cutoff).every(key => ['kind','round','moment','rounds'].includes(key))) {
    return { caps, cutoff: { kind: 'round', round: cutoff.round, moment: cutoff.moment,
      rounds: Object.fromEntries(Object.entries(cutoff.rounds).map(([id, round]) => [id, Number(round)])) } };
  }
  if (cutoff.kind === 'games' && integer(cutoff.games, 1) &&
      (cutoff.count === 'tournament' || cutoff.count === 'first-team' || cutoff.count === 'all-teams') &&
      Object.keys(cutoff).every(key => ['kind','games','count'].includes(key))) {
    return { caps, cutoff: { kind: 'games', games: cutoff.games, count: cutoff.count } };
  }
  throw new Error('Elige una sola modalidad de cierre y completa su fecha, ronda o cantidad de juegos y criterio.');
}
export function rosterClosure(rules: RosterRules, games: RosterRuleGame[], teamIds: string[], now = new Date()): { closed: boolean; reason: string; latch: boolean } {
  const cutoff = rules.cutoff;
  let closed = false, reason = '';
  if (cutoff.kind === 'date') {
    closed = now.getTime() > Date.parse(`${cutoff.date}T23:59:59.999-04:00`);
    reason = `Cierre para todos: ${cutoff.date}, al terminar el día en Venezuela (UTC−4).`;
  } else if (cutoff.kind === 'round') {
    if (games.some(game => cutoff.rounds[game.gameId] === undefined)) {
      return { closed: true, latch: false, reason: 'Incorporaciones bloqueadas: el organizador debe asignar ronda a todos los partidos del torneo.' };
    }
    const reached = games.filter(game => cutoff.rounds[game.gameId] >= cutoff.round);
    closed = cutoff.moment === 'start'
      ? reached.some(game => game.started)
      : reached.some(game => cutoff.rounds[game.gameId] > cutoff.round && game.started) ||
        games.some(game => cutoff.rounds[game.gameId] === cutoff.round) &&
        games.filter(game => cutoff.rounds[game.gameId] <= cutoff.round).every(game => game.status === 'final');
    reason = `Cierre para todos al ${cutoff.moment === 'start' ? 'comenzar' : 'terminar'} la ronda ${cutoff.round}.`;
  } else {
    const final = games.filter(game => game.status === 'final');
    const counts = teamIds.map(id => final.filter(game => game.homeTeamId === id || game.awayTeamId === id).length);
    closed = cutoff.count === 'tournament' ? final.length >= cutoff.games : cutoff.count === 'first-team'
      ? counts.some(count => count >= cutoff.games) : counts.length > 0 && counts.every(count => count >= cutoff.games);
    reason = `Cierre para todos a los ${cutoff.games} juegos finalizados: ${cutoff.count === 'tournament' ? 'total del torneo' : cutoff.count === 'first-team' ? 'cuando llegue el primer equipo' : 'cuando lleguen todos los equipos'}.`;
  }
  return { closed, latch: closed, reason };
}
export function rosterAdmission(members: RosterMember[], rules: RosterRules | null, closure: { closed: boolean; reason: string }, closedAt: string | null): RosterAdmission {
  const groups = {} as RosterAdmission['groups'];
  for (const group of rosterGroups) groups[group.id] = {
    used: members.filter(row => rosterGroup(row.role) === group.id).length, limit: rules?.caps[group.id] ?? null
  };
  return { configured: rules !== null, closed: Boolean(closedAt) || closure.closed,
    reason: closedAt ? 'Roster definitivo: incorporaciones cerradas simultáneamente para todo el torneo.' : closure.reason, closedAt, groups };
}
export function readRosterRulesView(value: unknown): RosterRulesView {
  if (!record(value) || !['tournamentId','tournamentName','organizerId','reason'].every(key => typeof value[key] === 'string') ||
      !integer(value.revision) || typeof value.closed !== 'boolean' || !(value.closedAt === null || typeof value.closedAt === 'string' && Number.isFinite(Date.parse(value.closedAt))) ||
      !Array.isArray(value.teamIds) || !value.teamIds.every(id => typeof id === 'string') || !Array.isArray(value.games) ||
      !value.games.every(game => record(game) && ['gameId','homeTeamId','awayTeamId','label'].every(key => typeof game[key] === 'string') &&
        typeof game.started === 'boolean' && ['scheduled','in_progress','suspended','protested','final'].includes(String(game.status)))) throw new Error('La API devolvió reglas de roster inválidas.');
  if (value.rules !== null) readRosterRules(value.rules);
  return value as RosterRulesView;
}
export class RosterRulesClient {
  private readonly base: string;
  private readonly organizerId: string;
  constructor(base: string, organizerId: string) { this.base = base.replace(/\/official-scoring\/?$/, '').replace(/\/$/,''); this.organizerId = organizerId; }
  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}/registration/roster/rules${path}`, body === undefined ? { credentials: 'include' } :
      { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(record(value) && typeof value.message === 'string' ? value.message : `No se pudieron consultar las reglas (${response.status}).`);
    return value;
  }
  async tournaments(): Promise<{ tournamentId: string; tournamentName: string }[]> {
    const value = await this.request(`?organizerId=${encodeURIComponent(this.organizerId)}`);
    if (!record(value) || !Array.isArray(value.tournaments) || !value.tournaments.every(row => record(row) &&
        typeof row.tournamentId === 'string' && typeof row.tournamentName === 'string')) throw new Error('La API no confirmó tus torneos.');
    return value.tournaments;
  }
  async load(tournamentId: string) {
    const value = readRosterRulesView(await this.request(`/${encodeURIComponent(tournamentId)}?organizerId=${encodeURIComponent(this.organizerId)}`));
    if (value.tournamentId !== tournamentId || value.organizerId !== this.organizerId) throw new Error('Las reglas no corresponden a este torneo u organizador.');
    return value;
  }
  async save(tournamentId: string, rules: RosterRules, revision: number, reopen: boolean) {
    readRosterRules(rules);
    const value = readRosterRulesView(await this.request(`/${encodeURIComponent(tournamentId)}`, { organizerId: this.organizerId, rules, revision, reopen }));
    if (value.tournamentId !== tournamentId || value.organizerId !== this.organizerId) throw new Error('No se confirmó el reglamento de este torneo.');
    return value;
  }
}
