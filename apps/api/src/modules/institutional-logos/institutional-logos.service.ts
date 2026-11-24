import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
  type OnModuleDestroy
} from '@nestjs/common';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  readInstitutionLogoChange,
  readInstitutionLogos,
  readInstitutionKind,
  readInstitutionId,
  institutionLogoKey,
  type InstitutionKind,
  type InstitutionLogo
} from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { OfficialScoringService } from '../live-scoring/official-scoring.service';
type Options = { path: string; now?: () => number };
@Injectable()
export class InstitutionalLogosService implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly accounts: AccountsService;
  private readonly scoring: OfficialScoringService;
  constructor(accounts: AccountsService, scoring: OfficialScoringService, @Optional() options?: Options) {
    this.accounts = accounts;
    this.scoring = scoring;
    this.now = options?.now ?? Date.now;
    const path = resolve(options?.path ?? process.env.PLAYSPORT_LOGOS_PATH ?? '.local/identity/logos.sqlite');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1)
        throw new Error('La base de identidad visual no es compatible. No se sobrescribió.');
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS logos(kind TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,logo TEXT NOT NULL,revision INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS logo_commands(account_id TEXT NOT NULL,request_id TEXT NOT NULL,body_hash TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,role TEXT NOT NULL,actor_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,request_id));
        PRAGMA user_version=1;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  onModuleDestroy() {
    this.db.close();
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private catalog(includePrivate = false) {
    const rows = this.scoring.institutionalIdentities(includePrivate);
    const names = new Map<string, string>();
    for (const row of rows) {
      const key = institutionLogoKey(row.kind, row.id),
        previous = names.get(key);
      if (previous && previous !== row.name && previous !== row.id && row.name !== row.id) {
        throw new ConflictException(
          'Un identificador de equipo representa nombres distintos. Corrige esa identidad antes de compartir su logo.'
        );
      }
      if (!previous || previous === row.id) names.set(key, row.name);
    }
    return { rows, names };
  }
  list(includePrivate = false): InstitutionLogo[] {
    const { rows, names } = this.catalog(includePrivate),
      found = new Set<string>();
    const hidden = new Set(this.scoring.institutionalIdentities(true).map(row => institutionLogoKey(row.kind, row.id)));
    for (const row of this.scoring.institutionalIdentities()) hidden.delete(institutionLogoKey(row.kind, row.id));
    const stored = this.db.prepare('SELECT * FROM logos').all();
    const entities = rows.flatMap((entity) => {
      const key = institutionLogoKey(entity.kind, entity.id);
      if (found.has(key)) return [];
      found.add(key);
      const saved = this.db
        .prepare('SELECT logo,revision FROM logos WHERE kind=? AND id=?')
        .get(entity.kind, entity.id);
      return [
        {
          kind: entity.kind,
          id: entity.id,
          name: names.get(key),
          revision: saved?.revision ?? 0,
          hasLogo: !!saved?.logo
        }
      ];
    });
    return readInstitutionLogos([
      ...entities,
      ...stored
        .filter((row) => row.kind !== 'league' && !found.has(institutionLogoKey(readInstitutionKind(row.kind), readInstitutionId(row.id))) &&
          (includePrivate || !hidden.has(institutionLogoKey(readInstitutionKind(row.kind), readInstitutionId(row.id)))))
        .map((row) => ({ kind: row.kind, id: row.id, name: row.name, revision: row.revision, hasLogo: !!row.logo }))
    ]);
  }
  private editor(token: string | undefined, role: unknown, actorId: unknown) {
    const account = this.accounts.authenticate(token);
    if ((role === 'manager' || role === 'organizer') && account.identity?.status === 'verified' && typeof actorId === 'string' &&
        actorId === account.identity.actorId) {
      if (role === 'manager') this.accounts.assertRoleOperation(account, 'manager');
      return account;
    }
    if (!account.localTestAccess || process.env.NODE_ENV === 'production')
      throw new ForbiddenException(
        'La edición institucional está habilitada solo para la cuenta autorizada. Elegir un rol no concede permisos.'
      );
    if (
      typeof actorId !== 'string' ||
      !(
        (role === 'organizer' && actorId === 'org-demo') ||
        (role === 'manager' && ['mgr-A', 'mgr-B'].includes(actorId))
      )
    ) {
      throw new ForbiddenException('Solo el manager o el organizador autorizado puede editar estos logos.');
    }
    return account;
  }
  manageable(token: string | undefined, role: unknown, actorId: unknown) {
    const account = this.editor(token, role, actorId);
    const managed = role === 'manager' && account.identity?.status === 'verified' ?
      this.accounts.managerTeamAccess(account, this.scoring.managerPlanTeams(String(actorId), account.id)).teams : null;
    const permitted = new Set(
      this.catalog(true)
        .rows.filter((row) =>
          role === 'organizer' ? row.organizerId === actorId && !row.managerOwned &&
            (!row.ownerAccountId || row.ownerAccountId === account.id) :
            row.kind === 'team' && row.managerId === actorId &&
            (!row.managerOwned || this.scoring.accountManagesTournament(row.tournamentId, String(actorId), account.id)) &&
            (managed === null || managed.some(team => team.managed && team.teamId === row.id && team.tournamentId === row.tournamentId))
        )
        .map((row) => institutionLogoKey(row.kind, row.id))
    );
    return {
      accountId: account.id,
      entities: this.list(true).filter((row) => permitted.has(institutionLogoKey(row.kind, row.id)))
    };
  }
  private image(logo: string) {
    if (!logo) return null;
    const encoded = logo.slice(logo.indexOf(',') + 1),
      bytes = Buffer.from(encoded, 'base64');
    const png = logo.startsWith('data:image/png;');
    const valid = png
      ? bytes.length >= 45 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
      : bytes.length >= 12 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255 &&
        bytes.at(-2) === 255 &&
        bytes.at(-1) === 217;
    if (!valid || bytes.toString('base64') !== encoded)
      throw new BadRequestException('El logo debe ser una imagen PNG o JPEG preparada, no un enlace ni otro archivo.');
    return { buffer: bytes, type: png ? 'image/png' : 'image/jpeg' };
  }
  readImage(kind: InstitutionKind, id: string, revision: number, token?: string) {
    let entity = this.list().find((row) => row.kind === kind && row.id === id);
    if (!entity && token) {
      const account = this.accounts.authenticate(token);
      const actorId = account.identity?.status === 'verified' ? account.identity.actorId ?? '' : '';
      const allowed = this.scoring.institutionalIdentities(true).some(row => row.kind === kind && row.id === id &&
        (row.kind === 'league' ? row.ownerAccountId === account.id :
          row.managerOwned ? this.scoring.accountManagesTournament(row.tournamentId, actorId, account.id) :
          this.scoring.accountOrganizesTournament(row.tournamentId, account.id)));
      if (allowed) entity = this.list(true).find(row => row.kind === kind && row.id === id);
    }
    if (!entity?.hasLogo) throw new NotFoundException('Esta identidad no tiene logo.');
    if (entity.revision !== revision) throw new ConflictException('El logo cambió. Recarga la identidad visual.');
    const row = this.db.prepare('SELECT logo FROM logos WHERE kind=? AND id=?').get(kind, id);
    if (typeof row?.logo !== 'string') throw new Error('El logo guardado no es válido.');
    const image = this.image(row.logo);
    if (!image) throw new Error('El logo guardado está vacío.');
    return image;
  }
  change(token: string | undefined, body: unknown) {
    this.accounts.authenticate(token);
    let input;
    try {
      input = readInstitutionLogoChange(body);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'La solicitud de logo no es válida.');
    }
    this.image(input.logo);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return this.transaction(() => {
      const account = this.editor(token, input.role, input.actorId);
      if (input.expectedAccountId !== account.id)
        throw new ConflictException('La cuenta cambió. No se actualizó el logo.');
      const allowed = this.manageable(token, input.role, input.actorId).entities.some(
        (row) => row.kind === input.kind && row.id === input.id
      );
      if (!allowed) throw new ForbiddenException('No administras este equipo, torneo o liga.');
      const ownedTeam = this.scoring.institutionalIdentities(true).find(row => row.kind === input.kind && row.id === input.id && row.managerOwned);
      if (ownedTeam) this.scoring.assertPlannedRosterEditable(ownedTeam.tournamentId, input.id);
      const previous = this.db
        .prepare('SELECT body_hash,revision FROM logo_commands WHERE account_id=? AND request_id=?')
        .get(account.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash)
          throw new ConflictException('No reutilices una solicitud para otro cambio de logo.');
        return { entities: this.manageable(token, input.role, input.actorId).entities, appliedRevision: previous.revision };
      }
      const count = this.db
        .prepare('SELECT count(*) AS count FROM logo_commands WHERE account_id=? AND created_at>?')
        .get(account.id, this.now() - 60000)?.count;
      if (typeof count !== 'number') throw new Error('No se pudo verificar el límite de cambios.');
      if (count >= 30) throw new HttpException('Demasiados cambios de logo. Espera un minuto.', 429);
      const current = this.db.prepare('SELECT revision FROM logos WHERE kind=? AND id=?').get(input.kind, input.id);
      if ((current?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException('El logo cambió en otra pantalla. Recarga el logo guardado antes de reemplazarlo.');
      const revision = input.expectedRevision + 1;
      const name = this.catalog(true).names.get(institutionLogoKey(input.kind, input.id));
      if (!name) throw new Error('No se pudo resolver la identidad del logo.');
      this.db
        .prepare(
          'INSERT INTO logos VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET name=excluded.name,logo=excluded.logo,revision=excluded.revision,updated_at=excluded.updated_at'
        )
        .run(input.kind, input.id, name, input.logo, revision, this.now());
      this.db
        .prepare('INSERT INTO logo_commands VALUES(?,?,?,?,?,?,?,?,?)')
        .run(account.id, input.requestId, hash, input.kind, input.id, revision, input.role, input.actorId, this.now());
      return { entities: this.manageable(token, input.role, input.actorId).entities, appliedRevision: revision };
    });
  }
}
