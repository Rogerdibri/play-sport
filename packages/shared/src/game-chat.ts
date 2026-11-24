import type { OfficialGameStatus } from './official-games.js';

export const gameChatFinalWindowMs = 30 * 60 * 1000;
export const gameChatTextLimit = 300;
export type GameChatWindow = 'waiting' | 'live' | 'postgame' | 'closed' | 'paused';
export type GameChatAuthor = { id: string; displayName: string };
export type GameChatMessage = { id: number; author: GameChatAuthor; text: string; createdAt: string };
export type GameChatSnapshot = {
  gameId: string; window: GameChatWindow; closesAt: string | null; serverNow: string;
  viewer: GameChatAuthor | null; sessionExpired: boolean;
  messages: GameChatMessage[]; mutedAuthors: GameChatAuthor[]; hasOlder: boolean;
};
export type GameChatAction =
  { kind: 'message'; text: string } |
  { kind: 'report'; messageId: number; reason: 'spam' | 'abuse' | 'other' } |
  { kind: 'mute'; authorId: string; muted: boolean };

export function gameChatWindow(status: OfficialGameStatus, finishedAt: string | null, now: number): {
  window: GameChatWindow; closesAt: string | null;
} {
  if (!Number.isFinite(now) || finishedAt !== null && !Number.isFinite(Date.parse(finishedAt))) {
    throw new Error('El horario del chat del partido es inválido.');
  }
  if (status === 'in_progress') return { window: 'live', closesAt: null };
  if (status === 'scheduled') return { window: 'waiting', closesAt: null };
  if (status !== 'final') return { window: 'paused', closesAt: null };
  if (!finishedAt) return { window: 'closed', closesAt: null };
  const cutoff = Date.parse(finishedAt) + gameChatFinalWindowMs;
  return { window: now < cutoff ? 'postgame' : 'closed', closesAt: new Date(cutoff).toISOString() };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const author = (value: unknown): value is GameChatAuthor => record(value) &&
  typeof value.id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.id) &&
  typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 80;
export function readGameChat(value: unknown): GameChatSnapshot {
  if (!record(value) || typeof value.gameId !== 'string' || !value.gameId ||
      !['waiting', 'live', 'postgame', 'closed', 'paused'].includes(String(value.window)) ||
      !(value.closesAt === null || date(value.closesAt)) || !date(value.serverNow) ||
      !(value.viewer === null || author(value.viewer)) || typeof value.sessionExpired !== 'boolean' ||
      !Array.isArray(value.mutedAuthors) || !value.mutedAuthors.every(author) ||
      typeof value.hasOlder !== 'boolean' || !Array.isArray(value.messages) || value.messages.length > 50 ||
      !value.messages.every(item => record(item) && Number.isSafeInteger(item.id) && Number(item.id) > 0 &&
        author(item.author) && typeof item.text === 'string' && item.text.trim().length > 0 &&
        [...item.text].length <= gameChatTextLimit && date(item.createdAt)) ||
      value.window === 'postgame' && value.closesAt === null ||
      value.messages.some((item, index, items) => index > 0 && item.id <= items[index - 1].id)) {
    throw new Error('El chat del partido contiene datos inválidos. Vuelve a cargarlo.');
  }
  return value as GameChatSnapshot;
}
