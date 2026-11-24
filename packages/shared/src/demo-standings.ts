import { calendarExampleGames } from './demo-calendar.js';
import { calculateStandings } from './standings.js';

export const standingsLeagues = [
  { id: 'metropolitana-beisbol', name: 'Liga Metropolitana de Béisbol', tournaments: ['Copa Metropolitana 2026', 'Copa de Caracas 2000', 'Copa de Caracas 1952'] },
  { id: 'metropolitana-softbol', name: 'Liga Metropolitana de Softbol', tournaments: ['Copa Metropolitana de Softbol 2026'] },
  { id: 'centro', name: 'Liga de Béisbol del Centro', tournaments: ['Copa del Centro 2026', 'Copa del Centro 1990'] },
  { id: 'lago', name: 'Liga de Béisbol del Lago', tournaments: ['Copa del Lago 2026', 'Copa del Lago 1980'] },
  { id: 'carabobo', name: 'Liga de Béisbol de Carabobo', tournaments: ['Copa Carabobo 2026', 'Copa Carabobo 2020'] }
] as const;

export function demoStandings(leagueId: string, tournament: string) {
  const league = standingsLeagues.find(item => item.id === leagueId);
  if (!league || !league.tournaments.some(name => name === tournament)) throw new Error('La liga o el torneo seleccionado no está disponible.');
  const games = calendarExampleGames.filter(game => game.tournament === tournament);
  if (!games.length) throw new Error('El torneo no tiene equipos registrados para la tabla.');
  const teams = [...new Set(games.flatMap(game => [game.homeTeam, game.awayTeam]))];
  return { league, tournament, rows: calculateStandings(teams, games),
    completed: games.filter(game => game.status === 'finished').length };
}
