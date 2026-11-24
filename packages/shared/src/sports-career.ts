import { isCalendarDate } from './events-calendar.js';
import { isOfficialGameStatus, type OfficialGameStatus } from './official-games.js';
import { exampleStatisticsGames, statisticsExampleObservation } from './sports-statistics-examples.js';

export const careerRoles = ['player', 'manager', 'scorekeeper', 'organizer'] as const;
export type CareerRole = typeof careerRoles[number];
export type CareerGame = {
  gameId: string; tournamentId: string; tournamentName: string; leagueId: string; leagueName: string;
  sport: string; modality: string; category: string; season: string; date: string | null;
  homeTeamName: string; awayTeamName: string; teamId: string | null; teamName: string | null;
  role: CareerRole; positions: string[]; evidence: 'lineup' | 'scoring' | 'organization';
  status: OfficialGameStatus; version: number; public: boolean; technical: boolean;
};
export type CareerSnapshot = {
  accountId: string; source: 'official' | 'example'; identityVerified: boolean; games: CareerGame[];
};
export type CareerFilters = {
  sport: string; modality: string; season: string; role: string; league: string;
  tournament: string; team: string; from: string; to: string;
};
export const emptyCareerFilters = (): CareerFilters =>
  ({ sport: '', modality: '', season: '', role: '', league: '', tournament: '', team: '', from: '', to: '' });
export const careerGameKey = (game: CareerGame) => JSON.stringify([game.tournamentId, game.gameId, game.role, game.teamId]);
export const careerLeagueKey = (game: CareerGame) => JSON.stringify([game.leagueId, game.leagueName]);
export const careerTeamKey = (game: CareerGame) => JSON.stringify([game.tournamentId, game.teamId]);
export const careerPeriodKey = (game: CareerGame) => JSON.stringify([
  game.season, game.sport, game.modality, game.category, game.leagueId, game.leagueName,
  game.tournamentId, game.teamId, game.role,
]);
export const careerDisposition = (game: CareerGame): 'completed' | 'ongoing' | 'review' =>
  game.status === 'final' && !game.technical ? 'completed' : game.status === 'in_progress' ? 'ongoing' : 'review';
export function latestCareerGames(games: readonly CareerGame[]): CareerGame[] {
  const versions = new Map<string, number>();
  for (const game of games) {
    const key = JSON.stringify([game.tournamentId, game.gameId]);
    versions.set(key, Math.max(versions.get(key) ?? -1, game.version));
  }
  const latest = new Map<string, CareerGame>();
  for (const game of games) {
    if (game.version !== versions.get(JSON.stringify([game.tournamentId, game.gameId]))) continue;
    const key = careerGameKey(game), previous = latest.get(key);
    if (!previous || previous.version < game.version) latest.set(key, game);
    else if (previous.version === game.version && JSON.stringify(previous) !== JSON.stringify(game))
      throw new Error('Hay participaciones distintas con la misma versión oficial.');
  }
  return [...latest.values()].sort((a, b) => Number(a.date === null) - Number(b.date === null) ||
    (b.date ?? '').localeCompare(a.date ?? '') || careerRoles.indexOf(a.role) - careerRoles.indexOf(b.role) ||
    careerGameKey(a).localeCompare(careerGameKey(b)));
}
export function filterCareerGames(games: readonly CareerGame[], filters: CareerFilters): CareerGame[] {
  if (filters.from && !isCalendarDate(filters.from) || filters.to && !isCalendarDate(filters.to) ||
      filters.from && filters.to && filters.from > filters.to)
    throw new Error('Revisa el rango de fechas de la trayectoria.');
  return latestCareerGames(games).filter(game =>
    (!filters.sport || JSON.stringify(game.sport) === filters.sport) &&
    (!filters.modality || JSON.stringify(game.modality) === filters.modality) &&
    (!filters.season || JSON.stringify(game.season) === filters.season) &&
    (!filters.role || game.role === filters.role) &&
    (!filters.league || careerLeagueKey(game) === filters.league) &&
    (!filters.tournament || game.tournamentId === filters.tournament) &&
    (!filters.team || careerTeamKey(game) === filters.team) &&
    (!filters.from || game.date !== null && game.date >= filters.from) &&
    (!filters.to || game.date !== null && game.date <= filters.to));
}
export function careerCounts(games: readonly CareerGame[]) {
  const counts = { completed: new Set<string>(), ongoing: new Set<string>(), review: new Set<string>() };
  for (const game of latestCareerGames(games))
    counts[careerDisposition(game)].add(JSON.stringify([game.tournamentId, game.gameId]));
  return { completed: counts.completed.size, ongoing: counts.ongoing.size, review: counts.review.size };
}
export function careerPeriods(games: readonly CareerGame[]) {
  const periods = new Map<string, { key: string; games: CareerGame[] }>();
  for (const game of latestCareerGames(games)) {
    const key = careerPeriodKey(game);
    if (!periods.has(key)) periods.set(key, { key, games: [] });
    periods.get(key)!.games.push(game);
  }
  return [...periods.values()].map(period => {
    const dates = period.games.flatMap(game => game.date ? [game.date] : []).sort();
    return { ...period, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null,
      missingDates: period.games.filter(game => game.date === null).length, ...careerCounts(period.games) };
  });
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const text = (value: unknown, required = false): value is string =>
  typeof value === 'string' && value.length <= 200 && (!required || value.trim().length > 0) &&
  !/[\u0000-\u001f\u007f]/.test(value);
export function readCareerSnapshot(value: unknown, accountId: string, source: CareerSnapshot['source']): CareerSnapshot {
  if (!record(value) || !exactKeys(value, ['accountId', 'source', 'identityVerified', 'games']) ||
      value.accountId !== accountId || value.source !== source || typeof value.identityVerified !== 'boolean' || !Array.isArray(value.games) ||
      source === 'official' && !value.identityVerified && value.games.length > 0)
    throw new Error('No se pudo comprobar la trayectoria de esta cuenta.');
  const games = value.games.map<CareerGame>(game => {
    if (!record(game) || !exactKeys(game, ['gameId', 'tournamentId', 'tournamentName', 'leagueId', 'leagueName',
      'sport', 'modality', 'category', 'season', 'date', 'homeTeamName', 'awayTeamName', 'teamId', 'teamName',
      'role', 'positions', 'evidence', 'status', 'version', 'public', 'technical']) ||
      !text(game.gameId, true) || !text(game.tournamentId, true) || !text(game.tournamentName, true) ||
      !text(game.homeTeamName, true) || !text(game.awayTeamName, true) ||
      !text(game.leagueId) || !text(game.leagueName) || !text(game.sport) || !text(game.modality) || !text(game.category) || !text(game.season) ||
      !(game.date === null || typeof game.date === 'string' && isCalendarDate(game.date)) ||
      !(game.role === 'player' || game.role === 'manager' || game.role === 'scorekeeper' || game.role === 'organizer') ||
      !isOfficialGameStatus(game.status) || game.status === 'scheduled' ||
      typeof game.version !== 'number' || !Number.isSafeInteger(game.version) || game.version < 0 ||
      typeof game.public !== 'boolean' || typeof game.technical !== 'boolean' ||
      !Array.isArray(game.positions) || game.positions.length > 16 || !game.positions.every(position => text(position, true)) ||
      new Set(game.positions).size !== game.positions.length)
      throw new Error('Una participación de la trayectoria no tiene un respaldo válido.');
    const teamRole = game.role === 'player' || game.role === 'manager';
    if (teamRole ? !text(game.teamId, true) || !text(game.teamName, true) || game.evidence !== 'lineup' :
      game.teamId !== null || game.teamName !== null || game.positions.length > 0 ||
      game.evidence !== (game.role === 'scorekeeper' ? 'scoring' : 'organization'))
      throw new Error('El rol y el respaldo de la participación no coinciden.');
    return {
      gameId: game.gameId, tournamentId: game.tournamentId, tournamentName: game.tournamentName,
      leagueId: game.leagueId, leagueName: game.leagueName, sport: game.sport,
      modality: game.modality, category: game.category, season: game.season, date: game.date,
      homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName,
      teamId: typeof game.teamId === 'string' ? game.teamId : null, teamName: typeof game.teamName === 'string' ? game.teamName : null,
      role: game.role, positions: game.positions, evidence: game.evidence === 'lineup' ? 'lineup' :
        game.evidence === 'scoring' ? 'scoring' : 'organization',
      status: game.status, version: game.version, public: game.public, technical: game.technical,
    };
  });
  return { accountId, source, identityVerified: value.identityVerified, games: latestCareerGames(games) };
}
export function exampleCareerGames(): CareerGame[] {
  const current = exampleStatisticsGames('player');
  const previous = { ...current[0], gameId: 'example-career-baseball-2025', tournamentId: 'example-career-2025',
    tournamentName: 'Copa del Lago 2025', teamId: 'example-career-pioneros', teamName: 'Pioneros del Lago',
    season: '2025', date: '2025-10-10' };
  return [previous, ...current].flatMap(game => (['player', 'manager'] as const).map(role => ({
    gameId: game.gameId, tournamentId: game.tournamentId, tournamentName: game.tournamentName,
    leagueId: game.leagueId, leagueName: game.leagueName, sport: game.sport === 'baseball' ? 'Béisbol' : 'Softbol',
    modality: game.modality, category: game.category, season: game.season, date: game.date,
    homeTeamName: game.opponentName, awayTeamName: game.teamName, teamId: game.teamId, teamName: game.teamName,
    role, positions: role === 'player' ? ['P'] : [], evidence: 'lineup' as const,
    status: game.status, version: game.version, public: false, technical: false,
  })));
}
export function careerExampleObservation(id: string) {
  const previous = id === 'example-career-baseball-2025';
  if (!exampleCareerGames().some(game => game.gameId === id)) throw new Error('La participación de ejemplo no existe.');
  const state = statisticsExampleObservation(previous ? 'example-stats-baseball-1' : id);
  if (previous) state.seed.names.away = 'Pioneros del Lago';
  return state;
}
