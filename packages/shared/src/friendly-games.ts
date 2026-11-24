import { isScorecardCommand, privatePositions, readPrivateSave, replayPrivate, type ParticipantIdentity, type PrivateCommand, type PrivateSeed, type PrivateState, type Side } from './scorecard.js';
import { type GameClock, type GameClockAction } from './game-clock.js';

export type FriendlyParticipant = { name: string; position: string };
export type FriendlySetup = {
  sport: 'baseball' | 'softball'; names: Record<Side, string>; lineups: Record<Side, (string | FriendlyParticipant)[]>;
  substitutes?: Record<Side, string[]>;
};
export type FriendlyDraft = {
  sport: 'baseball' | 'softball'; home: string; away: string; homePlayers: string; awayPlayers: string;
  homePositions?: string[]; awayPositions?: string[];
  homeSubstitutes?: string[]; awaySubstitutes?: string[];
};
export const initialFriendlyDraft: FriendlyDraft = { sport: 'baseball', home: '', away: '', homePlayers: '', awayPlayers: '' };
export type FriendlyGame = {
  id: string; revision: number; sport: FriendlySetup['sport']; createdAt: string; updatedAt: string;
  seed: PrivateSeed; commands: PrivateCommand[]; state: PrivateState;
  clock?: GameClock;
};
export type FriendlyArrivalSubstitution = { side: Side; outId: string; name: string };
export type FriendlyOperation = { command: PrivateCommand } | { undo: true } | { errorOuts: number | null } | { clockAction: GameClockAction } |
  { arrivalSubstitution: FriendlyArrivalSubstitution } | { participantIdentity: ParticipantIdentity };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const name = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const position = (value: unknown): value is string => typeof value === 'string' && privatePositions.includes(value);
export function isFriendlyArrivalSubstitution(value: unknown): value is FriendlyArrivalSubstitution {
  return record(value) && (value.side === 'home' || value.side === 'away') &&
    typeof value.outId === 'string' && value.outId.length > 0 && name(value.name);
}
export function isFriendlyDraft(value: unknown): value is FriendlyDraft {
  return record(value) && (value.sport === 'baseball' || value.sport === 'softball') &&
    ['home', 'away', 'homePlayers', 'awayPlayers'].every(key => typeof value[key] === 'string') &&
    ['homePlayers', 'awayPlayers'].every(key => String(value[key]).split(/\r?\n/).length <= 12) &&
    ['homePositions', 'awayPositions'].every(key => value[key] === undefined ||
      Array.isArray(value[key]) && value[key].length === 12 && value[key].every(position)) &&
    ['homeSubstitutes', 'awaySubstitutes'].every(key => value[key] === undefined ||
      Array.isArray(value[key]) && value[key].every(entry => typeof entry === 'string' && entry.length <= 100));
}
export function friendlyDraftLineup(draft: FriendlyDraft, side: Side): FriendlyParticipant[] {
  if (!isFriendlyDraft(draft)) throw new Error('El borrador del amistoso debe tener hasta 12 filas válidas. No se reemplazó.');
  const names = (side === 'home' ? draft.homePlayers : draft.awayPlayers).split(/\r?\n/);
  const positions = side === 'home' ? draft.homePositions : draft.awayPositions;
  return Array.from({ length: 12 }, (_, index) => ({ name: names[index] ?? '', position: positions?.[index] ?? 'NA' }));
}
export function friendlySetupFromDraft(draft: FriendlyDraft): FriendlySetup {
  const lineup = (side: Side) => {
    const rows = friendlyDraftLineup(draft, side);
    const last = rows.reduce((previous, row, index) => row.name.trim() !== '' || row.position !== 'NA' ? index : previous, -1);
    return rows.slice(0, last + 1);
  };
  return readFriendlySetup({ sport: draft.sport, names: { home: draft.home, away: draft.away },
    lineups: { home: lineup('home'), away: lineup('away') },
    substitutes: { home: draft.homeSubstitutes ?? [], away: draft.awaySubstitutes ?? [] } });
}
export function readFriendlySetup(value: unknown): Omit<FriendlySetup, 'lineups' | 'substitutes'> & {
  lineups: Record<Side, FriendlyParticipant[]>; substitutes: Record<Side, string[]>;
} {
  if (!record(value) || !['baseball', 'softball'].includes(String(value.sport)) || !record(value.names) || !record(value.lineups) ||
      value.substitutes !== undefined && !record(value.substitutes)) {
    throw new Error('Indica deporte, nombres de equipos y ambas alineaciones.');
  }
  const names = value.names, lineups = value.lineups, substitutes = value.substitutes;
  const team = (side: Side) => {
    const players = lineups[side];
    if (!name(names[side]) || !Array.isArray(players) || players.length < 9 || players.length > 12) {
      throw new Error('Cada equipo necesita nombre y entre 9 y 12 participantes en orden al bate.');
    }
    const occupied = new Set<string>();
    const participants = players.map((player: unknown, index: number) => {
      const entry = typeof player === 'string' ? { name: player, position: 'NA' } : player;
      if (!record(entry) || !name(entry.name) || !position(entry.position)) {
        throw new Error(`Completa el nombre y una posición válida en el turno ${index + 1} del ${side === 'home' ? 'local' : 'visitante'}. No dejes filas intermedias vacías.`);
      }
      if (entry.position !== 'NA' && occupied.has(entry.position)) throw new Error('Dos participantes del mismo equipo no pueden compartir una posición defensiva.');
      occupied.add(entry.position);
      return { name: entry.name.trim(), position: entry.position };
    });
    const bench = substitutes === undefined ? [] : substitutes[side];
    if (!Array.isArray(bench) || !bench.every(name))
      throw new Error(`Completa el nombre de cada suplente del ${side === 'home' ? 'local' : 'visitante'} o quita la fila vacía.`);
    return { name: names[side].trim(), players: participants, substitutes: bench.map(entry => entry.trim()) };
  };
  const home = team('home'), away = team('away');
  if (home.name.toLocaleLowerCase() === away.name.toLocaleLowerCase()) throw new Error('Usa nombres distintos para identificar los dos equipos.');
  return { sport: value.sport === 'baseball' ? 'baseball' : 'softball',
    names: { home: home.name, away: away.name }, lineups: { home: home.players, away: away.players },
    substitutes: { home: home.substitutes, away: away.substitutes } };
}
export function isFriendlyCommand(value: unknown): value is PrivateCommand {
  return isScorecardCommand(value) && !value.sharedRequestId &&
    value.kind !== 'received-lineup' && (value.kind !== 'substitution' || value.jersey === '' && value.arrival === undefined);
}
export function readFriendlyGame(value: unknown): FriendlyGame {
  if (!record(value) || typeof value.id !== 'string' || !/^friendly-[a-f0-9-]{36}$/.test(value.id) ||
      typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !(value.sport === 'baseball' || value.sport === 'softball') ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('El amistoso contiene datos inválidos.');
  const { seed, commands, clock } = readPrivateSave(JSON.stringify({ version: 1, seed: value.seed, commands: value.commands, clock: value.clock }));
  if (!seed.friendly || !commands.every(isFriendlyCommand) ||
      !(['home', 'away'] as const).every(side => seed.lineups[side].length > 0 && seed.rosters[side].every(player => player.jersey === ''))) {
    throw new Error('El amistoso no puede contener camisetas ni movimientos de partidos oficiales.');
  }
  return { id: value.id, revision: value.revision, sport: value.sport, createdAt: value.createdAt, updatedAt: value.updatedAt,
    seed, commands, ...(clock ? { clock } : {}), state: { ...replayPrivate(seed, commands), ...(clock ? { clock } : {}) } };
}
export class FriendlyClient {
  private readonly base: string;
  constructor(base: string) { this.base = base.replace(/\/$/, ''); }
  private async request(path = '', body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}/friendly-games${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(record(value) && typeof value.message === 'string' ? value.message : 'No se pudo consultar o guardar el amistoso.');
    return value;
  }
  async list(): Promise<FriendlyGame[]> {
    const value = await this.request();
    if (!record(value) || !Array.isArray(value.games)) throw new Error('La lista de amistosos contiene datos inválidos.');
    return value.games.map(readFriendlyGame);
  }
  async create(setup: FriendlySetup) { return readFriendlyGame(await this.request('', readFriendlySetup(setup))); }
  async previewLegacy(key: string) {
    const value = await this.request('/legacy/preview', { key });
    if (!record(value) || !Array.isArray(value.games)) throw new Error('No se pudieron leer los amistosos anteriores.');
    return value.games.map(readFriendlyGame);
  }
  async importLegacy(key: string, ids: string[]) {
    const value = await this.request('/legacy/import', { key, ids, confirmed: true });
    if (!record(value) || !Array.isArray(value.games)) throw new Error('No se confirmó la incorporación de los amistosos.');
    return value.games.map(readFriendlyGame);
  }
  async update(game: FriendlyGame, operation: FriendlyOperation) {
    return readFriendlyGame(await this.request(`/${encodeURIComponent(game.id)}/updates`, { expectedRevision: game.revision, ...operation }));
  }
}
