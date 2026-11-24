import { calendarExampleGames, calendarExampleVenues } from './demo-calendar.js';
import { shiftCalendarDate } from './events-calendar.js';
import type { OfficialGameDetails, OfficialGameStatus, OfficialGameSummary } from './official-games.js';

export const assignedGameSections = [
  { status: 'in_progress', title: 'En juego', description: 'Continúa el seguimiento del encuentro.' },
  { status: 'scheduled', title: 'Próximos partidos', description: 'Prepara la anotación de tu próxima jornada.' },
  { status: 'protested', title: 'Bajo protesta', description: 'Pendientes de resolución de mesa técnica.' },
  { status: 'suspended', title: 'Suspendidos · Fecha pendiente', description: 'El organizador debe reprogramar estos juegos.' },
  { status: 'final', title: 'Finalizados', description: 'Consulta los resultados y las hojas de anotación.' }
] as const;

export type AssignedGameExample = {
  exampleId: string; status: OfficialGameStatus; details: OfficialGameDetails;
  awayScore: number; homeScore: number; innings: number | null;
};

export const assignedGameExamples: readonly AssignedGameExample[] = [
  'ejemplo-caracas-en-juego-5', 'ejemplo-manana', 'ejemplo-manana-maracay', 'ejemplo-caracas-finalizado-5'
].map(id => {
  const game = calendarExampleGames.find(item => item.id === id);
  const venue = calendarExampleVenues.find(item => item.id === game?.venueId);
  if (!game || !venue || game.status === 'cancelled') throw new Error('Un ejemplo de partidos asignados no tiene una ficha válida.');
  return {
    exampleId: game.id, status: game.status === 'live' ? 'in_progress' : game.status === 'finished' ? 'final' : 'scheduled',
    details: {
      tournamentName: game.tournament, awayTeamName: game.awayTeam, homeTeamName: game.homeTeam,
      date: game.date, time: game.time, venue: venue.name
    },
    awayScore: game.score?.away ?? 0, homeScore: game.score?.home ?? 0, innings: game.score?.innings ?? null
  };
});

export function activeAssignedGame(games: readonly OfficialGameSummary[], preferredId: string | null): OfficialGameSummary | null {
  const available = games.filter(game => !game.scoringBlockReason);
  const running = available.filter(game => game.status === 'in_progress');
  const preferred = available.find(game => game.gameId === preferredId && ['scheduled', 'in_progress'].includes(game.status));
  if (preferred?.status === 'in_progress') return preferred;
  if (running.length === 1) return running[0];
  if (running.length > 1) return null;
  return preferred ?? null;
}

export function currentAssignedGame(games: readonly OfficialGameSummary[], now = new Date()): {
  game: OfficialGameSummary | null; message: string;
} {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) throw new Error('No se pudo determinar la hora para abrir la pizarra.');
  const running = games.filter(game => game.status === 'in_progress');
  const eligible = running.length ? running : games.filter(game => {
    if (game.status !== 'scheduled' || !game.details || game.scoringBlockReason) return false;
    const start = new Date(`${game.details.date}T${game.details.time}:00-04:00`).getTime() - 60 * 60 * 1000;
    const end = new Date(`${shiftCalendarDate(game.details.date, 1)}T00:00:00-04:00`).getTime();
    return timestamp >= start && timestamp < end;
  });
  if (eligible.length > 1) return {
    game: null, message: 'Hay más de un partido posible para este momento. Revisa Mis partidos asignados antes de elegir.'
  };
  const game = eligible[0];
  if (game && !game.scoringBlockReason) return { game, message: '' };
  return { game: null, message: game?.scoringBlockReason ?? 'No tienes un partido para anotar en este momento.' };
}
