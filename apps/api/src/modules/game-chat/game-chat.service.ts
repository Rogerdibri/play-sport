import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional, UnauthorizedException, type OnModuleDestroy } from '@nestjs/common';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gameChatTextLimit, gameChatWindow, type GameChatAuthor, type GameChatMessage, type GameChatSnapshot } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { OfficialScoringService } from '../live-scoring/official-scoring.service';

type Options = { path: string; now?: () => number };
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

@Injectable()
export class GameChatService implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly accounts: AccountsService;
  private readonly games: OfficialScoringService;
  constructor(accounts: AccountsService, games: OfficialScoringService, @Optional() options?: Options) {
    this.accounts = accounts; this.games = games;
    const path = resolve(options?.path ?? process.env.PLAYSPORT_CHAT_PATH ?? '.local/chat/game-chat.sqlite');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.now = options?.now ?? Date.now;
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new Error('La versión de la base del chat no es compatible. No se sobrescribió.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_rooms (game_id TEXT PRIMARY KEY, finished_at TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY, game_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
        text TEXT NOT NULL, normalized_text TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS chat_game_messages ON chat_messages(game_id, id);
      CREATE INDEX IF NOT EXISTS chat_author_messages ON chat_messages(author_id, created_at);
      CREATE TABLE IF NOT EXISTS chat_mutes (
        game_id TEXT NOT NULL, viewer_id TEXT NOT NULL, author_id TEXT NOT NULL,
        PRIMARY KEY(game_id, viewer_id, author_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS chat_reports (
        message_id INTEGER NOT NULL REFERENCES chat_messages(id), reporter_id TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(message_id, reporter_id)
      ) STRICT;
      PRAGMA user_version = 1;
    `);
  }
  onModuleDestroy() { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = work(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private window(gameId: string) {
    const context = this.games.getGameChatContext(gameId);
    const previous = this.db.prepare('SELECT finished_at FROM chat_rooms WHERE game_id = ?').get(gameId)?.finished_at;
    const finishedAt = context.status === 'final' ? context.finishedAt ?? (typeof previous === 'string' ? previous : null) : null;
    this.db.prepare(`INSERT INTO chat_rooms(game_id, finished_at) VALUES (?, ?)
      ON CONFLICT(game_id) DO UPDATE SET finished_at = excluded.finished_at`).run(gameId, finishedAt);
    return gameChatWindow(context.status, finishedAt, this.now());
  }
  private message(row: unknown): GameChatMessage {
    if (!record(row) || typeof row.id !== 'number' || typeof row.author_id !== 'string' ||
        typeof row.author_name !== 'string' || typeof row.text !== 'string' || typeof row.created_at !== 'number') {
      throw new Error('La base del chat contiene un mensaje inválido.');
    }
    return { id: row.id, author: { id: row.author_id, displayName: row.author_name }, text: row.text,
      createdAt: new Date(row.created_at).toISOString() };
  }
  read(gameId: string, token?: string, before?: number, after?: number): GameChatSnapshot {
    if (before !== undefined && after !== undefined ||
        [before, after].some(cursor => cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1))) {
      throw new BadRequestException('El cursor de comentarios no es válido.');
    }
    const window = this.window(gameId);
    let viewer: GameChatAuthor | null = null, sessionExpired = false;
    if (token) {
      try {
        const account = this.accounts.authenticate(token);
        viewer = { id: account.id, displayName: account.displayName };
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        sessionExpired = true;
      }
    }
    const rows = this.db.prepare(`SELECT m.* FROM chat_messages m WHERE m.game_id = ? AND m.id < ? AND m.id > ?
      AND NOT EXISTS (SELECT 1 FROM chat_mutes b WHERE b.game_id = m.game_id AND b.viewer_id = ? AND b.author_id = m.author_id)
      ORDER BY m.id ${after === undefined ? 'DESC' : 'ASC'} LIMIT 51`)
      .all(gameId, before ?? Number.MAX_SAFE_INTEGER, after ?? 0, viewer?.id ?? '');
    const mutedAuthors = viewer ? this.db.prepare(`SELECT b.author_id, MAX(m.author_name) AS author_name FROM chat_mutes b
      JOIN chat_messages m ON m.game_id = b.game_id AND m.author_id = b.author_id
      WHERE b.game_id = ? AND b.viewer_id = ? GROUP BY b.author_id`).all(gameId, viewer.id).map(row => {
        if (typeof row.author_id !== 'string' || typeof row.author_name !== 'string') throw new Error('No se pudieron leer los usuarios silenciados.');
        return { id: row.author_id, displayName: row.author_name };
      }) : [];
    const page = rows.slice(0, 50);
    return { gameId, ...window, serverNow: new Date(this.now()).toISOString(), viewer, sessionExpired,
      messages: (after === undefined ? page.reverse() : page).map(row => this.message(row)), mutedAuthors,
      hasOlder: after === undefined && rows.length > 50 };
  }

  perform(gameId: string, token: string | undefined, input: unknown) {
    this.accounts.authenticate(token);
    if (!record(input)) throw new BadRequestException('Envía la operación del chat como un objeto.');
    const allowed = input.kind === 'message' ? ['kind', 'text'] : input.kind === 'report' ?
      ['kind', 'messageId', 'reason'] : input.kind === 'mute' ? ['kind', 'authorId', 'muted'] : [];
    if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new BadRequestException('La operación del chat contiene campos no permitidos.');
    const notice = this.transaction(() => {
      const account = this.accounts.authenticate(token), window = this.window(gameId), now = this.now();
      if (input.kind === 'message') {
        if (!['live', 'postgame'].includes(window.window)) throw new ConflictException('El chat no admite mensajes ahora. Se abre durante el partido y cierra 30 minutos después del final oficial.');
        if (typeof input.text !== 'string' || !input.text.trim() || [...input.text].length > gameChatTextLimit ||
            [...input.text].some(character => character.charCodeAt(0) < 32 && character !== '\n' || character.charCodeAt(0) === 127)) {
          throw new BadRequestException(`Escribe un comentario de 1 a ${gameChatTextLimit} caracteres, sin caracteres de control.`);
        }
        const text = input.text.trim(), normalized = text.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
        const recent = this.db.prepare('SELECT created_at, normalized_text FROM chat_messages WHERE author_id = ? AND created_at > ?')
          .all(account.id, now - 60000);
        if (recent.some(row => row.normalized_text === normalized)) throw new HttpException('No repitas el mismo comentario durante un minuto.', 429);
        if (recent.some(row => typeof row.created_at === 'number' && row.created_at > now - 3000) ||
            recent.filter(row => typeof row.created_at === 'number' && row.created_at > now - 30000).length >= 5) {
          throw new HttpException('Espera unos segundos antes de comentar nuevamente. Máximo cinco mensajes en 30 segundos.', 429);
        }
        this.db.prepare('INSERT INTO chat_messages(game_id, author_id, author_name, text, normalized_text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(gameId, account.id, account.displayName, text, normalized, now);
        return 'Comentario publicado.';
      }
      if (input.kind === 'report') {
        if (!Number.isSafeInteger(input.messageId) || Number(input.messageId) < 1 || !['spam', 'abuse', 'other'].includes(String(input.reason))) {
          throw new BadRequestException('Selecciona un comentario y un motivo válido para reportarlo.');
        }
        if (!this.db.prepare('SELECT id FROM chat_messages WHERE id = ? AND game_id = ?').get(Number(input.messageId), gameId)) {
          throw new NotFoundException('Este comentario no pertenece al partido.');
        }
        this.db.prepare('INSERT INTO chat_reports(message_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
          .run(Number(input.messageId), account.id, String(input.reason), now);
        return 'Reporte guardado. La revisión humana está pendiente; no se oculta el mensaje para otros usuarios.';
      }
      if (typeof input.authorId !== 'string' || typeof input.muted !== 'boolean' || input.authorId === account.id) {
        throw new BadRequestException('Selecciona otro usuario para silenciarlo en este partido.');
      }
      if (!this.db.prepare('SELECT id FROM chat_messages WHERE game_id = ? AND author_id = ?').get(gameId, input.authorId)) {
        throw new NotFoundException('Este usuario no ha comentado en el partido.');
      }
      if (input.muted) this.db.prepare('INSERT INTO chat_mutes(game_id, viewer_id, author_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
        .run(gameId, account.id, input.authorId);
      else this.db.prepare('DELETE FROM chat_mutes WHERE game_id = ? AND viewer_id = ? AND author_id = ?').run(gameId, account.id, input.authorId);
      return input.muted ? 'Usuario silenciado solo para ti en este partido.' : 'Ya puedes leer a este usuario.';
    });
    return { notice, chat: this.read(gameId, token) };
  }
}
