import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function commercePath(path?: string): string {
  return resolve(path ?? process.env.PLAYSPORT_MARKETPLACE_PATH ?? '.local/marketplace/marketplace.sqlite');
}
export function openCommerceDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (![0, 1, 2, 3, 4, 5, 6].includes(Number(version))) throw new Error('La base de comercio no es compatible. No se sobrescribió.');
    return db;
  } catch (error) { db.close(); throw error; }
}
