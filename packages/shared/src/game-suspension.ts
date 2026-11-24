import { isCalendarDate } from './events-calendar.js';

export type GameSuspension = {
  id: string; cause: 'weather' | 'force-majeure'; scoreHandling: 'keep' | 'reset';
  reason: string; recordedAt: string; recordedBy: string; role: 'organizer' | 'scorekeeper'; wasStarted: boolean;
  originalDate: string | null; originalTime: string | null;
  rescheduled: null | { date: string; time: string; recordedAt: string; recordedBy: string };
};
export const preservesStartedGame = (suspension?: GameSuspension) => suspension?.wasStarted === true && suspension.scoreHandling === 'keep';
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const isGameTime = (v: unknown): v is string => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export function isGameSuspension(v: unknown): v is GameSuspension {
  return record(v) && text(v.id) && ['weather', 'force-majeure'].includes(String(v.cause)) &&
    ['keep', 'reset'].includes(String(v.scoreHandling)) && text(v.reason) && String(v.reason).length <= 2000 &&
    timestamp(v.recordedAt) && text(v.recordedBy) && ['organizer', 'scorekeeper'].includes(String(v.role)) && typeof v.wasStarted === 'boolean' &&
    (v.originalDate === null || isCalendarDate(v.originalDate)) && (v.originalTime === null || isGameTime(v.originalTime)) &&
    (v.rescheduled === null || record(v.rescheduled) && isCalendarDate(v.rescheduled.date) && isGameTime(v.rescheduled.time) &&
      timestamp(v.rescheduled.recordedAt) && text(v.rescheduled.recordedBy));
}
