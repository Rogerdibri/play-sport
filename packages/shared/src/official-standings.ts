import { calculateStandings, type StandingRow } from './standings.js';
import { readOfficialGames, type OfficialGameSummary } from './official-games.js';
import type { CalendarGame } from './events-calendar.js';
import { officialGameResult } from './official-results.js';

export type OfficialStandingGame = Omit<OfficialGameSummary, 'assignedScorekeeperIds' | 'availableScorekeeperIds' | 'scoringBlockReason'>;
export type OfficialTournamentStandings = {
  id: string; name: string; rows: StandingRow[]; teamNames: Record<string, string>; pendingProtests: number;
};
export function readOfficialStandingGames(value: unknown): OfficialStandingGame[] {
  if (!value || typeof value !== 'object' || !('games' in value) || !Array.isArray(value.games) ||
      value.games.some(game => !game || typeof game !== 'object' || Array.isArray(game))) {
    throw new Error('La clasificación oficial contiene datos inválidos.');
  }
  const parsed = readOfficialGames({
    userId: 'public', role: 'organizer',
    games: value.games.map(game => ({ ...game, assignedScorekeeperIds: [], availableScorekeeperIds: [] }))
  }, 'public', 'organizer');
  return parsed.games;
}
export function calculateOfficialStandings(games: readonly OfficialStandingGame[]): OfficialTournamentStandings[] {
  return [...new Set(games.map(game => game.tournamentId))].map(id => {
    const tournament = games.filter(game => game.tournamentId === id);
    const teamNames: Record<string, string> = Object.fromEntries(tournament.flatMap(game => [
      [game.homeTeamId, game.details?.homeTeamName ?? game.homeTeamId],
      [game.awayTeamId, game.details?.awayTeamName ?? game.awayTeamId]
    ]));
    const completed: CalendarGame[] = tournament.filter(game => game.status === 'final').map(game => {
      const result = officialGameResult(game);
      return {
        id: game.gameId, homeTeam: game.homeTeamId, awayTeam: game.awayTeamId, date: game.details?.date ?? '',
        time: game.details?.time ?? '', venueId: '', sport: 'baseball', status: 'finished',
        score: { home: game.homeScore, away: game.awayScore, innings: 0 },
        ...(result.source === 'technical' && result.winnerTeamId ? { decidedWinner: result.winnerTeamId } : {})
      };
    });
    return {
      id, name: tournament.find(game => game.details)?.details?.tournamentName ?? id, teamNames,
      rows: calculateStandings(Object.keys(teamNames), completed),
      pendingProtests: tournament.filter(game => game.status === 'protested').length
    };
  });
}
