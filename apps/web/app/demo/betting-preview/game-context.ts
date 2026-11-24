import { calendarExampleVenues, officialGameStatusLabels, type CalendarExampleGame, type OfficialStandingGame } from '@playsport/shared';

export type PreviewGame = {
  id: string; home: string; away: string; status: 'scheduled' | 'live' | 'finished';
  label: string; homeRuns: number; awayRuns: number; detail: string;
  homeTeamId?: string; awayTeamId?: string;
};

export const bettingPreviewOpen = (status: string) => status === 'scheduled' || status === 'live' || status === 'in_progress';
export const bettingPreviewHref = (source: 'example' | 'official', id: string) =>
  `/demo/betting-preview?${source === 'example' ? 'game' : 'official'}=${encodeURIComponent(id)}`;

export function examplePreviewGame(game: CalendarExampleGame): PreviewGame {
  if (!bettingPreviewOpen(game.status)) throw new Error('El juego no está por iniciar ni en curso.');
  const venue = calendarExampleVenues.find(item => item.id === game.venueId);
  if (!venue) throw new Error('El juego no tiene una sede registrada.');
  return { id: `example:${game.id}`, home: game.homeTeam, away: game.awayTeam,
    status: game.status === 'live' ? 'live' : 'scheduled',
    label: `${game.status === 'live' ? 'En vivo' : 'Por iniciar'} · ${game.date} · ${game.time}`,
    homeRuns: game.score?.home ?? 0, awayRuns: game.score?.away ?? 0,
    detail: `${game.sport === 'baseball' ? 'Béisbol' : 'Softbol'} · ${venue.name}` };
}

export function officialPreviewGame(game: OfficialStandingGame): PreviewGame {
  if (!bettingPreviewOpen(game.status)) throw new Error('El juego no está por iniciar ni en curso.');
  return { id: `official:${game.gameId}`, home: game.details?.homeTeamName ?? game.homeTeamId,
    away: game.details?.awayTeamName ?? game.awayTeamId, status: game.status === 'in_progress' ? 'live' : 'scheduled',
    label: `${officialGameStatusLabels[game.status]} · ${game.details?.date ?? 'Fecha pendiente'} · ${game.details?.time ?? 'Hora pendiente'}`,
    homeRuns: game.homeScore, awayRuns: game.awayScore, detail: game.details?.venue ?? 'Sede pendiente',
    homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId };
}
