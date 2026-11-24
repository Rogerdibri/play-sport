import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isMarketplacePhotoPath, marketplacePhotoMaxLength } from '@playsport/shared';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export class MarketplacePhotos {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  validate(value: unknown): string | null {
    if (value === null) return null;
    if (isMarketplacePhotoPath(value)) {
      try { this.read(value.slice(value.lastIndexOf('/') + 1)); }
      catch (error) {
        if (error instanceof NotFoundException) throw new BadRequestException('La foto guardada ya no está disponible. Selecciónala nuevamente.');
        throw error;
      }
      return value;
    }
    if (typeof value !== 'string') throw new BadRequestException('La foto debe ser un JPEG local de tamaño permitido.');
    this.decode(value);
    return value;
  }
  private decode(value: unknown): Buffer {
    if (typeof value !== 'string' || value.length > marketplacePhotoMaxLength ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new BadRequestException('La foto debe ser un JPEG local de tamaño permitido.');
    }
    const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
      throw new BadRequestException('El archivo no es una foto JPEG válida.');
    }
    return bytes;
  }
  store(value: unknown): string | null {
    if (value === null || isMarketplacePhotoPath(value)) return this.validate(value);
    const bytes = this.decode(value);
    const filename = `${hash(bytes)}.jpg`;
    const path = resolve(this.directory, filename);
    if (existsSync(path)) this.read(filename);
    else {
      const temporary = resolve(this.directory, `.${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
    }
    return `/api/marketplace/photos/${filename}`;
  }
  read(filename: string): Buffer {
    if (!isMarketplacePhotoPath(`/api/marketplace/photos/${filename}`)) throw new NotFoundException('La foto no existe.');
    let bytes: Buffer;
    try { bytes = readFileSync(resolve(this.directory, filename)); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new NotFoundException('La foto no existe.');
      throw error;
    }
    if (hash(bytes) !== filename.slice(0, -4)) throw new Error('La foto guardada no coincide con su identificador. Restaura su respaldo.');
    return bytes;
  }
  migrate(db: DatabaseSync, databasePath: string): { migrated: number; backup: string | null } {
    const jobs: { table: string; column: string; id: number | bigint; original: string; photo: string; value: Record<string, unknown> }[] = [];
    for (const [table, column] of [
      ['market_listings', 'payload'], ['market_audits', 'before_payload'], ['market_audits', 'after_payload'],
    ]) {
      const rows = db.prepare(`SELECT id,${column} AS payload FROM ${table} WHERE json_extract(${column},'$.photo') LIKE 'data:%'`).all();
      for (const row of rows) {
        if (typeof row.payload !== 'string' || typeof row.id !== 'number' && typeof row.id !== 'bigint') throw new Error('El registro de foto a migrar no es válido.');
        const value: unknown = JSON.parse(row.payload);
        if (!value || typeof value !== 'object' || Array.isArray(value) || !('photo' in value) || typeof value.photo !== 'string') throw new Error('La foto a migrar no es válida.');
        this.decode(value.photo);
        jobs.push({ table, column, id: row.id, original: row.payload, photo: value.photo, value });
      }
    }
    if (!jobs.length) return { migrated: 0, backup: null };
    const backups = resolve(dirname(databasePath), 'backups');
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = resolve(backups, `before-photo-migration-${randomUUID()}.sqlite`);
    db.prepare('VACUUM INTO ?').run(backup);
    chmodSync(backup, 0o600);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const job of jobs) {
        const payload = JSON.stringify({ ...job.value, photo: this.store(job.photo) });
        const result = db.prepare(`UPDATE ${job.table} SET ${job.column}=? WHERE id=? AND ${job.column}=?`).run(payload, job.id, job.original);
        if (result.changes !== 1) throw new Error('El anuncio cambió durante la migración de fotos. Reintenta sin otros procesos de escritura.');
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    db.exec('VACUUM');
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (checkpoint?.busy !== 0) throw new Error('Las fotos se migraron, pero otro lector impide compactar SQLite. Cierra los lectores y ejecuta VACUUM y wal_checkpoint(TRUNCATE).');
    return { migrated: jobs.length, backup };
  }
}
