import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class OfficialStateStore {
  private readonly db: DatabaseSync;
  private depth = 0;
  private revision = 0;

  constructor(path: string) {
    const file = resolve(path);
    const marker = `${file}.initialized`;
    if (existsSync(marker) && !existsSync(file))
      throw new Error(
        'Falta la base deportiva previamente inicializada. Restaura la copia; no se creó un marcador vacío.'
      );
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (!existsSync(marker)) writeFileSync(marker, 'playsport-official-state-v1\n', { mode: 0o600, flag: 'wx' });
    this.db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1) throw new Error('La base deportiva no es compatible. No se sobrescribió.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS official_state (
          id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
          payload BLOB NOT NULL, checksum TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS registration_state (
          id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL
        );
        PRAGMA user_version=1;
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  load(): Buffer | null {
    const row = this.db.prepare('SELECT revision,payload,checksum FROM official_state WHERE id=1').get();
    if (!row) return null;
    if (
      typeof row.revision !== 'number' ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !(row.payload instanceof Uint8Array) ||
      typeof row.checksum !== 'string' ||
      createHash('sha256').update(row.payload).digest('hex') !== row.checksum
    ) {
      throw new Error('El estado deportivo guardado es inválido. No se inició un marcador vacío.');
    }
    this.revision = row.revision;
    return Buffer.from(row.payload);
  }

  transaction<T>(work: () => T): T {
    if (this.depth) return work();
    const before = this.revision;
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.revision = before;
      throw error;
    } finally {
      this.depth--;
    }
  }

  save(payload: Uint8Array) {
    if (!this.depth) throw new Error('El estado deportivo requiere una transacción.');
    const current = this.db.prepare('SELECT revision FROM official_state WHERE id=1').get()?.revision ?? 0;
    if (current !== this.revision)
      throw new ConflictException(
        'Otra instancia modificó el estado deportivo. Reinicia esta instancia antes de escribir.'
      );
    const next = this.revision + 1;
    this.db
      .prepare(
        `INSERT INTO official_state VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,checksum=excluded.checksum`
      )
      .run(next, payload, createHash('sha256').update(payload).digest('hex'));
    this.revision = next;
  }

  registration() {
    const row = this.db.prepare('SELECT document FROM registration_state WHERE id=1').get();
    if (!row) return null;
    if (typeof row.document !== 'string') throw new Error('El registro deportivo guardado no es válido.');
    return row.document;
  }

  saveRegistration(document: string) {
    if (!this.depth) throw new Error('El registro deportivo requiere una transacción.');
    this.db
      .prepare(
        `INSERT INTO registration_state VALUES(1,?)
      ON CONFLICT(id) DO UPDATE SET document=excluded.document`
      )
      .run(document);
  }

  close() {
    this.db.close();
  }
}
