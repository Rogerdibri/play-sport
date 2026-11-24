export type GameClock = {
  startedAt: string;
  runningSince: string | null;
  elapsedMs: number;
};
export type GameClockAction = 'start' | 'pause' | 'resume';

const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export function isGameClock(value: unknown): value is GameClock {
  if (!value || typeof value !== 'object') return false;
  const clock = value as Record<string, unknown>;
  return timestamp(clock.startedAt) && (clock.runningSince === null ||
    timestamp(clock.runningSince) && Date.parse(clock.runningSince) >= Date.parse(clock.startedAt)) &&
    typeof clock.elapsedMs === 'number' && Number.isSafeInteger(clock.elapsedMs) && clock.elapsedMs >= 0;
}

export function isGameClockAction(value: unknown): value is GameClockAction {
  return value === 'start' || value === 'pause' || value === 'resume';
}

export function gameClockElapsed(clock: GameClock | undefined, now: number): number {
  if (!Number.isFinite(now)) throw new Error('La hora del cronómetro no es válida.');
  if (!clock) return 0;
  if (!isGameClock(clock)) throw new Error('El cronómetro del partido contiene datos inválidos.');
  return clock.elapsedMs + (clock.runningSince ? Math.max(0, now - Date.parse(clock.runningSince)) : 0);
}

export function pauseGameClock(clock: GameClock, now: string): GameClock {
  if (!timestamp(now)) throw new Error('La hora del cronómetro no es válida.');
  return { ...clock, elapsedMs: gameClockElapsed(clock, Date.parse(now)), runningSince: null };
}

export function changeGameClock(clock: GameClock | undefined, action: GameClockAction, now: string): GameClock {
  if (!isGameClockAction(action) || !timestamp(now) || clock && !isGameClock(clock)) {
    throw new Error('La operación del cronómetro no es válida.');
  }
  if (action === 'start') {
    if (clock) throw new Error('El tiempo de juego ya fue iniciado.');
    return { startedAt: now, runningSince: now, elapsedMs: 0 };
  }
  if (!clock) throw new Error('Primero inicia el tiempo de juego.');
  if (Date.parse(now) < Date.parse(clock.runningSince ?? clock.startedAt)) {
    throw new Error('La hora actual es anterior al inicio del cronómetro.');
  }
  if (action === 'pause') {
    if (!clock.runningSince) throw new Error('El tiempo de juego ya está pausado.');
    return pauseGameClock(clock, now);
  }
  if (clock.runningSince) throw new Error('El tiempo de juego ya está corriendo.');
  return { ...clock, runningSince: now };
}

export function isTimedScoringCommand(command: PrivateCommand): boolean {
  return ['pitch', 'play', 'runner', 'misplay'].includes(command.kind);
}

export function startOrResumeGameClock(clock: GameClock | undefined, now: string): GameClock {
  if (!timestamp(now) || clock && !isGameClock(clock)) throw new Error('El cronómetro del partido contiene datos inválidos.');
  if (clock?.runningSince) return clock;
  return changeGameClock(clock, clock ? 'resume' : 'start', now);
}

export function formatGameClock(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('La duración del partido no es válida.');
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
import type { PrivateCommand } from './scorecard.js';
