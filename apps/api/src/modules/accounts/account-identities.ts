import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import {
  identityImageMaxLength,
  readPersonIdentity,
  registrationIdentification,
  type PersonIdentity
} from '@playsport/shared';

export class AccountIdentities {
  private registeredPersonId?: (_identification: string) => string | undefined; // eslint-disable-line no-unused-vars
  private readonly db: DatabaseSync;
  private readonly keyPath: string;
  constructor(db: DatabaseSync, keyPath: string) {
    this.db = db;
    this.keyPath = keyPath;
    db.exec(`CREATE TABLE IF NOT EXISTS person_directory(identification TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE) STRICT;
    CREATE TABLE IF NOT EXISTS person_identities(
      account_id TEXT PRIMARY KEY REFERENCES accounts(id), identification TEXT NOT NULL, full_name TEXT NOT NULL,
      birth_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected')),
      revision INTEGER NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS person_identity_unique ON person_identities(identification) WHERE status IN ('pending','verified');
    CREATE TABLE IF NOT EXISTS identity_commands(account_id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(account_id,request_id)) STRICT;
    CREATE TABLE IF NOT EXISTS identity_reviews(
      account_id TEXT NOT NULL, revision INTEGER NOT NULL, reviewer_id TEXT NOT NULL, decision TEXT NOT NULL,
      reason TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(account_id,revision)
    ) STRICT;`);
  }
  // eslint-disable-next-line no-unused-vars
  setRegisteredPersonLookup(lookup: (_identification: string) => string | undefined) {
    this.registeredPersonId = lookup;
  }
  actorId(identification: string) {
    const key = registrationIdentification(identification);
    const existing = /^PERSON([A-F0-9]{32})$/.exec(this.registeredPersonId?.(key) ?? '');
    const hex = existing?.[1].toLowerCase();
    const actor = hex
      ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
      : randomUUID();
    this.db
      .prepare('INSERT INTO person_directory VALUES(?,?) ON CONFLICT(identification) DO NOTHING')
      .run(key, `person:${actor}`);
    const row = this.db.prepare('SELECT actor_id FROM person_directory WHERE identification=?').get(key);
    if (typeof row?.actor_id !== 'string') throw new Error('No se pudo resolver el vínculo global de identidad.');
    return row.actor_id;
  }
  favoritePlayerId(identification: string) {
    const identity = this.registeredPersonId?.(identification) ?? identification;
    return `player:${createHmac('sha256', this.key()).update(`favorites:v1:${identity.trim().toUpperCase()}`).digest('hex')}`;
  }
  private key() {
    if (!existsSync(this.keyPath)) {
      if (this.db.prepare("SELECT 1 FROM person_identities WHERE evidence<>'' LIMIT 1").get())
        throw new Error('Falta la clave de documentos de identidad. Restaura la copia segura; no se reemplazó.');
      try {
        writeFileSync(this.keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error;
      }
    }
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) throw new Error('La clave privada de documentos no es válida.');
    return key;
  }
  private encrypt(accountId: string, value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(accountId));
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }
  private decrypt(accountId: string, value: string) {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !data) throw new Error('Los documentos privados están dañados.');
    const cipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(accountId));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  }
  private fields(body: unknown, keys: string[]): Record<string, unknown> {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !keys.includes(key))
    )
      throw new BadRequestException('La solicitud de identidad contiene campos no permitidos.');
    return Object.fromEntries(Object.entries(body));
  }
  private uuid(value: unknown) {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value))
      throw new BadRequestException('La cuenta o clave de operación no es válida.');
    return value;
  }
  private image(value: unknown) {
    if (
      typeof value !== 'string' ||
      value.length > identityImageMaxLength ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      throw new BadRequestException('Adjunta ambas fotos como JPEG preparado, de hasta 420.000 caracteres cada una.');
    const encoded = value.slice(value.indexOf(',') + 1),
      data = Buffer.from(encoded, 'base64');
    if (
      data.length < 12 ||
      data[0] !== 255 ||
      data[1] !== 216 ||
      data[2] !== 255 ||
      data.at(-2) !== 255 ||
      data.at(-1) !== 217 ||
      data.toString('base64') !== encoded
    )
      throw new BadRequestException('La fotografía no contiene un JPEG válido.');
    return value;
  }
  get(accountId: string): PersonIdentity | undefined {
    const row = this.db.prepare('SELECT * FROM person_identities WHERE account_id=?').get(accountId);
    return row
      ? readPersonIdentity({
          identification: row.identification,
          fullName: row.full_name,
          birthDate: row.birth_date,
          status: row.status,
          revision: row.revision,
          reason: row.reason,
          actorId: this.actorId(String(row.identification))
        })
      : undefined;
  }
  verifiedActor(actorId: string) {
    const row = this.db.prepare(`SELECT p.identification FROM person_identities p
      JOIN person_directory d USING(identification) WHERE d.actor_id=? AND p.status='verified'`).get(actorId);
    return typeof row?.identification === 'string' ? this.verified(row.identification) : null;
  }
  verified(identification: string) {
    const id = /^PERSON([A-F0-9]{32})$/.exec(identification);
    if (id) {
      const hex = id[1].toLowerCase(),
        actorId = `person:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      const row = this.db
        .prepare(
          "SELECT p.account_id FROM person_identities p JOIN person_directory d USING(identification) WHERE d.actor_id=? AND p.status='verified'"
        )
        .get(actorId);
      return typeof row?.account_id === 'string'
        ? { accountId: row.account_id, identity: this.get(row.account_id)! }
        : null;
    }
    if (!/^[ve][-\s]?\d+$/i.test(identification)) return null;
    const row = this.db
      .prepare("SELECT account_id FROM person_identities WHERE identification=? AND status='verified'")
      .get(registrationIdentification(identification));
    return typeof row?.account_id === 'string'
      ? { accountId: row.account_id, identity: this.get(row.account_id)! }
      : null;
  }
  submit(accountId: string, body: unknown) {
    const input = this.fields(body, [
      'expectedAccountId',
      'requestId',
      'expectedRevision',
      'identification',
      'fullName',
      'birthDate',
      'documentPhoto',
      'personalPhoto',
      'consent'
    ]);
    if (this.uuid(input.expectedAccountId) !== accountId)
      throw new ConflictException('La cuenta cambió. No se enviaron documentos.');
    const requestId = this.uuid(input.requestId),
      old = this.get(accountId);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const replay = this.db
      .prepare('SELECT hash FROM identity_commands WHERE account_id=? AND request_id=?')
      .get(accountId, requestId);
    if (replay) {
      if (replay.hash !== hash) throw new ConflictException('Esta clave de operación ya se usó para otros documentos.');
      return;
    }
    if (old?.status === 'verified')
      throw new ConflictException('Tu identidad ya está verificada. La cédula no se puede sustituir desde el perfil.');
    if (input.expectedRevision !== (old?.revision ?? 0))
      throw new ConflictException('La solicitud cambió. Recarga antes de reenviarla.');
    if (input.consent !== true)
      throw new BadRequestException('Confirma que los documentos son tuyos y autorizas su revisión privada.');
    let identity: PersonIdentity;
    try {
      identity = readPersonIdentity({ ...input, status: 'pending', revision: (old?.revision ?? 0) + 1, reason: '' });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Revisa tu identidad.');
    }
    const duplicate = this.db
      .prepare(
        "SELECT account_id FROM person_identities WHERE identification=? AND status IN ('pending','verified') AND account_id<>?"
      )
      .get(identity.identification, accountId);
    if (duplicate)
      throw new ConflictException(
        'No se pudo vincular esa cédula. Si es tuya, solicita revisión privada al soporte; no se creó otra identidad.'
      );
    const evidence = this.encrypt(
      accountId,
      JSON.stringify({ documentPhoto: this.image(input.documentPhoto), personalPhoto: this.image(input.personalPhoto) })
    );
    this.db
      .prepare(
        `INSERT INTO person_identities VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET identification=excluded.identification,full_name=excluded.full_name,birth_date=excluded.birth_date,
      status=excluded.status,revision=excluded.revision,reason=excluded.reason,evidence=excluded.evidence,updated_at=excluded.updated_at`
      )
      .run(
        accountId,
        identity.identification,
        identity.fullName,
        identity.birthDate,
        'pending',
        identity.revision,
        '',
        evidence,
        new Date().toISOString()
      );
    this.db.prepare('INSERT INTO identity_commands VALUES(?,?,?)').run(accountId, requestId, hash);
  }
  queue() {
    return this.db
      .prepare("SELECT account_id FROM person_identities WHERE status='pending' ORDER BY updated_at LIMIT 100")
      .all()
      .map((row) => {
        if (typeof row.account_id !== 'string') throw new Error('La cola de revisión está dañada.');
        return { accountId: row.account_id, identity: this.get(row.account_id)! };
      });
  }
  evidence(accountId: string) {
    const row = this.db.prepare('SELECT evidence FROM person_identities WHERE account_id=?').get(accountId);
    if (typeof row?.evidence !== 'string' || !row.evidence)
      throw new NotFoundException('No hay documentos pendientes de revisión.');
    const value: unknown = JSON.parse(this.decrypt(accountId, row.evidence));
    if (!value || typeof value !== 'object' || !('documentPhoto' in value) || !('personalPhoto' in value))
      throw new Error('Los documentos privados no son válidos.');
    return { documentPhoto: this.image(value.documentPhoto), personalPhoto: this.image(value.personalPhoto) };
  }
  review(reviewerId: string, body: unknown) {
    const input = this.fields(body, [
      'expectedAccountId',
      'accountId',
      'expectedRevision',
      'decision',
      'reason',
      'documentsMatch'
    ]);
    if (input.expectedAccountId !== reviewerId) throw new ConflictException('La cuenta revisora cambió.');
    const accountId = this.uuid(input.accountId),
      old = this.get(accountId);
    if (accountId === reviewerId) throw new ForbiddenException('No puedes verificar tu propia identidad.');
    if (!old || old.status !== 'pending' || old.revision !== input.expectedRevision)
      throw new ConflictException('La solicitud ya fue revisada o cambió. Actualiza la lista.');
    if (
      !['verified', 'rejected'].includes(String(input.decision)) ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.length > 2000 ||
      [...input.reason].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      throw new BadRequestException('Indica la decisión y el motivo de revisión.');
    if (input.decision === 'verified' && input.documentsMatch !== true)
      throw new BadRequestException('Debes comprobar la cédula, los datos y la correspondencia de ambas fotografías.');
    this.db
      .prepare(
        'UPDATE person_identities SET status=?,reason=?,revision=revision+1,evidence=?,updated_at=? WHERE account_id=?'
      )
      .run(String(input.decision), input.reason.trim(), '', new Date().toISOString(), accountId);
    this.db
      .prepare('INSERT INTO identity_reviews VALUES(?,?,?,?,?,?)')
      .run(
        accountId,
        old.revision + 1,
        reviewerId,
        String(input.decision),
        input.reason.trim(),
        new Date().toISOString()
      );
  }
}
