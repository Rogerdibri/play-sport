import { venezuelaStates, type ProfileLocation } from './venezuela.js';
import type { OfficialStandingGame } from './official-standings.js';

export type CalendarFilters = ProfileLocation & { date: string };
export type CalendarVenue = ProfileLocation & { id: string; name: string; address: string; latitude: number; longitude: number; source: string };
export type CalendarScore = { home: number; away: number; innings: number };
export type CalendarGame = {
  id: string; date: string; time: string; venueId: string; homeTeam: string; awayTeam: string;
  sport: 'baseball' | 'softball'; status: 'scheduled' | 'live' | 'finished' | 'cancelled'; score: CalendarScore | null;
  decidedWinner?: string;
};
export const calendarTimeZone = 'America/Caracas';
export function calendarDirectionsUrl(venue: Pick<CalendarVenue, 'latitude' | 'longitude'>): string {
  if (!Number.isFinite(venue.latitude) || !Number.isFinite(venue.longitude) ||
      Math.abs(venue.latitude) > 90 || Math.abs(venue.longitude) > 180) {
    throw new Error('La sede no tiene coordenadas válidas para consultar cómo llegar.');
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${venue.latitude},${venue.longitude}`)}`;
}
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export function venezuelaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: calendarTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => {
    const value = parts.find(item => item.type === type)?.value;
    if (!value) throw new Error('No se pudo determinar la fecha de Venezuela.');
    return value;
  };
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function calendarDateLabel(date: string): string {
  if (!isCalendarDate(date)) throw new Error('Selecciona una fecha válida.');
  return new Intl.DateTimeFormat('es-VE', { timeZone: calendarTimeZone, day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${date}T12:00:00-04:00`));
}
export function shiftCalendarDate(date: string, days: number): string {
  if (!isCalendarDate(date) || !Number.isInteger(days)) throw new Error('No se pudo cambiar la fecha del calendario.');
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  const result = next.toISOString().slice(0, 10);
  if (!isCalendarDate(result)) throw new Error('La fecha está fuera del calendario admitido.');
  return result;
}
export function isCalendarFilters(value: unknown): value is CalendarFilters {
  if (!value || typeof value !== 'object' || !('date' in value) || !('stateId' in value) || !('municipalityId' in value)) return false;
  const state = venezuelaStates.find(item => item.id === value.stateId);
  return (value.date === '' || isCalendarDate(value.date)) && (value.stateId === '' && value.municipalityId === '' || Boolean(state &&
    (state.municipalities.length === 0 ? value.municipalityId === '' : state.municipalities.some(m => m.id === value.municipalityId))));
}
export function calendarGames(games: readonly CalendarGame[], venues: readonly CalendarVenue[], filters: CalendarFilters): CalendarGame[] {
  if (!isCalendarFilters(filters) || !isCalendarDate(filters.date)) throw new Error('Revisa la fecha, el estado y el municipio seleccionados.');
  const byId = new Map(venues.map(venue => [venue.id, venue]));
  return games.filter(game => {
    const venue = byId.get(game.venueId);
    if (!venue) throw new Error(`El partido ${game.id} no tiene una sede válida.`);
    return game.date === filters.date && (!filters.stateId ||
      venue.stateId === filters.stateId && venue.municipalityId === filters.municipalityId);
  }).sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}
export function calendarOfficialGames(games: readonly OfficialStandingGame[], filters: CalendarFilters): OfficialStandingGame[] {
  if (!isCalendarFilters(filters) || !isCalendarDate(filters.date)) throw new Error('Revisa la fecha, el estado y el municipio seleccionados.');
  return games.filter(game => game.details?.date === filters.date && (!filters.stateId ||
    game.details.stateId === filters.stateId && game.details.municipalityId === filters.municipalityId))
    .sort((a, b) => (a.details?.time ?? '').localeCompare(b.details?.time ?? '') || a.gameId.localeCompare(b.gameId));
}
export function calendarScoreLabel(game: CalendarGame): string {
  if (game.status === 'cancelled') return 'No se disputó el partido.';
  if (game.status === 'scheduled') return 'Sin resultado registrado.';
  if (!game.score) throw new Error('El partido no tiene un marcador registrado.');
  return `${game.awayTeam} ${game.score.away} – ${game.score.home} ${game.homeTeam}`;
}
export function calendarResultSummary(game: CalendarGame): string {
  if (game.status !== 'finished') return calendarScoreLabel(game);
  if (!game.score) throw new Error('El partido finalizado no tiene un resultado registrado.');
  const { home, away, innings } = game.score;
  return home === away ? `Empate ${home}–${away} en ${innings} entradas.` :
    `Ganó ${home > away ? game.homeTeam : game.awayTeam} ${Math.max(home, away)}–${Math.min(home, away)} en ${innings} entradas.`;
}
