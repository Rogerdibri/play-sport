const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { mkdtempSync, mkdirSync, rmSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { MarketplacePhotos } = require('../src/modules/marketplace/marketplace-photos');

test('a filesystem failure rolls back every photo reference and a retry recovers without losing originals', t => {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-photo-rollback-'));
  const path = join(dir, 'market.sqlite');
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE market_listings(id INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE market_audits(id INTEGER PRIMARY KEY,before_payload TEXT,after_payload TEXT)');
  const photos = new MarketplacePhotos(join(dir, 'photos'));
  const bytes = [Buffer.from([255, 216, 0, 255, 217]), Buffer.from([255, 216, 1, 255, 217])];
  const legacy = bytes.map(value => `data:image/jpeg;base64,${value.toString('base64')}`);
  legacy.forEach((photo, index) => db.prepare('INSERT INTO market_listings VALUES(?,?)').run(index + 1, JSON.stringify({ photo, stock: index + 10 })));
  const obstructed = join(dir, 'photos', `${createHash('sha256').update(bytes[1]).digest('hex')}.jpg`);
  mkdirSync(obstructed);
  assert.throws(() => photos.migrate(db, path));
  assert.deepEqual(db.prepare('SELECT payload FROM market_listings ORDER BY id').all().map(row => JSON.parse(row.payload).photo), legacy);
  assert.equal(readdirSync(join(dir, 'backups')).length, 1);
  rmSync(obstructed, { recursive: true });
  assert.equal(photos.migrate(db, path).migrated, 2);
  assert.equal(photos.migrate(db, path).migrated, 0);
  assert.equal(readdirSync(join(dir, 'photos')).length, 2);
  assert.ok(db.prepare('SELECT payload FROM market_listings').all().every(row => !row.payload.includes('base64')));
});

test('invalid legacy JPEG data stops migration without changing any record', t => {
  const dir = mkdtempSync(join(tmpdir(), 'playsport-photo-invalid-'));
  const path = join(dir, 'market.sqlite');
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec('CREATE TABLE market_listings(id INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE market_audits(id INTEGER PRIMARY KEY,before_payload TEXT,after_payload TEXT)');
  const original = JSON.stringify({ photo: 'data:image/jpeg;base64,YWJjZA==' });
  db.prepare('INSERT INTO market_listings VALUES(1,?)').run(original);
  const photos = new MarketplacePhotos(join(dir, 'photos'));
  assert.throws(() => photos.migrate(db, path), /JPEG válida/);
  assert.equal(db.prepare('SELECT payload FROM market_listings').get().payload, original);
  assert.deepEqual(readdirSync(join(dir, 'photos')), []);
});
