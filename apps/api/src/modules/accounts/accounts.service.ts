import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, Optional, UnauthorizedException, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readAccountPhoto, readAccountPhotoChange, readDemoProfiles, newDemoPersonalProfile, demoProfileLocation, readFavoriteChange, readFavoriteRef, type FavoriteTarget, type AccountProfile } from '@playsport/shared';
import { AccountIdentities } from './account-identities';
import { AccountTrials } from './account-trials';
import { AccountRoleValidity } from './account-role-validity';
import { AccountScorekeeperAccess } from './account-scorekeeper-access';
import { roleValidityAllowsOperation, type MembershipRole, type ScorekeeperTournament } from '@playsport/shared';
import { hasAccountFeature, managerPlanLevel, managerTeamLimit, managerTeamKey, readManagerSelection,
  type ManagedTeam, type ManagerTeamAccess } from '@playsport/shared';
import { newSportsSheet, readSportsSheet, projectPublicSportsSheet, type SportsSheetTeam } from '@playsport/shared';
import { createGameReport, readAccountScorecard, readPrivateSave, replayPrivate, normalizeProfileIdentification,
  personalScorecardStatistics, type StatisticsGame } from '@playsport/shared';

type Options = { path: string; now?: () => number };
type StoredAccount = { id: string; email: string; display_name: string; password_hash: string; created_at: number };
const absoluteSessionMs = 400 * 24 * 60 * 60 * 1000;
const idleSessionMs = 30 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidSession = () => new UnauthorizedException('La sesión no es válida o venció. Inicia sesión.');
const hasControls = (value: string) => [...value].some(character => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

@Injectable()
export class AccountsService implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly localTesterPath: string;
  private hashing = 0;
  private readonly identities: AccountIdentities;
  private readonly trials: AccountTrials;
  private readonly roleValidityStore: AccountRoleValidity;
  private readonly scorekeeperAccessStore: AccountScorekeeperAccess;

  constructor(@Optional() options?: Options) {
    const path = resolve(options?.path ?? process.env.PLAYSPORT_ACCOUNTS_PATH ?? '.local/accounts/accounts.sqlite');
    this.localTesterPath = resolve(dirname(path), 'local-tester.json');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.now = options?.now ?? Date.now;
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error('La versión de la base de cuentas no es compatible. No se sobrescribió.');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_sessions (
        token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id);
      CREATE TABLE IF NOT EXISTS account_attempts (
        key TEXT PRIMARY KEY, started_at INTEGER NOT NULL, hits INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_photos (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        photo TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), updated_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_photo_commands (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
        body_hash TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,request_id)
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    this.identities = new AccountIdentities(this.db, resolve(dirname(path), 'identity.key'));
    this.trials = new AccountTrials(this.db, this.now);
    this.roleValidityStore = new AccountRoleValidity(this.db, this.now);
    this.scorekeeperAccessStore = new AccountScorekeeperAccess(this.db, this.now);
    this.db.exec(`CREATE TABLE IF NOT EXISTS account_manager_teams(
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      selection TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0)) STRICT;`);
    this.db.exec('CREATE TABLE IF NOT EXISTS account_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id),document TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS account_private_scorecards(
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      scope TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      PRIMARY KEY(account_id,scope)) STRICT;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS account_sports_sheets(
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      public_ref TEXT NOT NULL UNIQUE, document TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0)) STRICT;`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS account_favorites(
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('team','player','league')), id TEXT NOT NULL,
      PRIMARY KEY(account_id,kind,id)) STRICT;
      CREATE TABLE IF NOT EXISTS account_favorite_commands(
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
      body_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,request_id)) STRICT;`);
  }

  onModuleDestroy() { this.db.close(); }

  scorekeeperAccess(account: AccountProfile, tournaments: ScorekeeperTournament[]) {
    return { ...this.scorekeeperAccessStore.access(account, tournaments), operational: this.roleValidity(account, 'scorekeeper') };
  }
  changeScorekeeperTournaments(account: AccountProfile, tournaments: ScorekeeperTournament[], body: unknown) {
    return this.transaction(() => ({ ...this.scorekeeperAccessStore.select(account, tournaments, body), operational: this.roleValidity(account, 'scorekeeper') }));
  }
  assertScorekeeperAccess(account: AccountProfile, tournaments: ScorekeeperTournament[], tournamentId: string, gameId?: string) {
    this.scorekeeperAccessStore.assert(account, tournaments, tournamentId, gameId);
  }
  requestScorekeeperExtra(account: AccountProfile, body: unknown) {
    return this.transaction(() => this.scorekeeperAccessStore.request(account, body));
  }
  scorekeeperExtraQueue(token: string | undefined) {
    const admin = this.administrator(token);
    return { accountId: admin.id, requests: this.scorekeeperAccessStore.queue() };
  }
  reviewScorekeeperExtra(token: string | undefined, body: unknown) {
    const admin = this.administrator(token);
    return this.transaction(() => this.scorekeeperAccessStore.review(admin.id, body));
  }

  managerTeamAccess(account: AccountProfile, teams: ManagedTeam[]): ManagerTeamAccess {
    const stored = this.db.prepare('SELECT selection,revision FROM account_manager_teams WHERE account_id=?').get(account.id);
    const limit = managerTeamLimit(account), available = teams.filter(team => team.active).map(managerTeamKey);
    let selected = limit === null || available.length <= limit ? available : [];
    let revision = 0;
    if (stored) {
      if (typeof stored.selection !== 'string' || typeof stored.revision !== 'number')
        throw new Error('La selección de equipos guardada no es válida. No se reemplazó.');
      const value = readManagerSelection({ expectedAccountId: account.id, expectedRevision: stored.revision,
        selected: JSON.parse(stored.selection) });
      selected = value.selected.filter(key => available.includes(key)); revision = stored.revision;
    }
    const overLimit = limit !== null && selected.length > limit;
    return { accountId: account.id, level: managerPlanLevel(account), limit, revision,
      selectionRequired: available.length > 0 && (overLimit || !selected.length),
      teams: teams.map(team => ({ ...team, managed: team.active && !overLimit && selected.includes(managerTeamKey(team)) })),
      operational: this.roleValidity(account, 'manager') };
  }
  changeManagerTeams(account: AccountProfile, teams: ManagedTeam[], body: unknown) {
    let input;
    try { input = readManagerSelection(body); }
    catch (error) { if (error instanceof Error) throw new BadRequestException(error.message); throw error; }
    if (input.expectedAccountId !== account.id) throw new ForbiddenException('La selección no pertenece a tu cuenta.');
    const limit = managerTeamLimit(account);
    if (limit !== null && input.selected.length > limit) throw new ForbiddenException({
      code: 'MANAGER_TEAM_LIMIT', message: `Tu nivel permite ${limit} ${limit === 1 ? 'inscripción activa' : 'inscripciones activas'}. Amplía tu acceso o elige cuáles administrar.`,
    });
    const available = teams.filter(team => team.active).map(managerTeamKey);
    if (input.selected.some(key => !available.includes(key))) throw new ForbiddenException('Solo puedes activar tus propias inscripciones vigentes.');
    return this.transaction(() => {
      if (this.managerTeamAccess(account, teams).revision !== input.expectedRevision)
        throw new ConflictException('Tus cupos cambiaron en otro dispositivo. Actualiza antes de guardar.');
      this.db.prepare(`INSERT INTO account_manager_teams(account_id,selection,revision) VALUES(?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET selection=excluded.selection,revision=excluded.revision`)
        .run(account.id, JSON.stringify(input.selected), input.expectedRevision + 1);
      return this.managerTeamAccess(account, teams);
    });
  }
  assertManagerTeamAccess(account: AccountProfile, teams: ManagedTeam[], tournamentId: string, teamId: string, startedAt?: string | null) {
    const team = this.managerTeamAccess(account, teams).teams.find(team => team.tournamentId === tournamentId && team.teamId === teamId);
    if (!team || !team.managed && !this.roleContinuationAllowed(account, 'manager', startedAt)) throw new ForbiddenException({ code: 'MANAGER_TEAM_LIMIT',
      message: 'Esta inscripción no está activa en tus cupos de Manager. Elige tus equipos en Mis cupos; los datos se conservan para consulta.' });
    this.assertRoleOperation(account, 'manager', startedAt);
  }

  private isAdministrator(accountId: string) {
    return accountId === process.env.PLAYSPORT_ADMIN_ACCOUNT_ID ||
      process.env.NODE_ENV !== 'production' && accountId === this.localTesterId();
  }
  private administrator(token: string | undefined) {
    const account = this.authenticate(token);
    if (!this.isAdministrator(account.id)) throw new ForbiddenException('La administración está reservada a una cuenta autorizada por el servidor.');
    return account;
  }
  administration(token: string | undefined, query: Record<string, unknown>) {
    const account = this.administrator(token);
    return this.trials.snapshot(account.id, query);
  }
  changeTrial(token: string | undefined, body: unknown) {
    const account = this.administrator(token);
    return this.transaction(() => ({ trial: this.trials.change(account, body) }));
  }
  ownAccess(token: string | undefined) {
    const account = this.authenticate(token);
    const snapshot = this.trials.own(account.id, account.localTestAccess === true);
    return { ...snapshot, roles: (['player', 'manager', 'scorekeeper'] as const).map(role =>
      this.roleValidityStore.role(account.id, role, snapshot.trials, Date.parse(snapshot.now))) };
  }
  activateRole(token: string | undefined, body: unknown) {
    const account = this.authenticate(token);
    if (account.identity?.status !== 'verified') throw new ForbiddenException('Verifica tu identidad antes de activar un rol operativo.');
    this.transaction(() => this.roleValidityStore.activate(account.id, body));
    return this.ownAccess(token);
  }
  roleValidity(account: AccountProfile, role: MembershipRole) {
    return this.roleValidityStore.role(account.id, role, this.trials.trials(account.id));
  }
  roleOperationAllowed(account: AccountProfile, role: 'manager' | 'scorekeeper', startedAt?: string | null) {
    if (account.localTestAccess) return true;
    const validity = this.roleValidity(account, role);
    if (roleValidityAllowsOperation(validity)) return true;
    return this.roleContinuationAllowed(account, role, startedAt);
  }
  roleContinuationAllowed(account: AccountProfile, role: 'manager' | 'scorekeeper', startedAt?: string | null) {
    if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return false;
    const now = this.now(), validity = this.roleValidity(account, role);
    const deadlines = this.trials.trials(account.id).filter(trial => trial.active &&
      (trial.planId === role || trial.planId === `${role}-numbers` || trial.planId === `${role}-basic`)).map(trial => trial.expiresAt);
    if (validity.freeExpiresAt) deadlines.push(validity.freeExpiresAt);
    return deadlines.some(deadline => Date.parse(deadline) <= now && Date.parse(startedAt) < Date.parse(deadline));
  }
  assertRoleOperation(account: AccountProfile, role: 'manager' | 'scorekeeper', startedAt?: string | null) {
    if (!this.roleOperationAllowed(account, role, startedAt)) throw new ForbiddenException({
      code: 'ROLE_OPERATION_REQUIRED',
      message: `Activa o renueva tu acceso operativo de ${role === 'manager' ? 'Manager' : 'Anotador'} en Mis planes. La cuenta, resultados y consultas básicas se conservan.`
    });
  }

  privateScorecards(token: string | undefined, scope?: string) {
    const account = this.authenticate(token);
    const rows = scope === undefined ?
      this.db.prepare('SELECT scope,document,revision FROM account_private_scorecards WHERE account_id=? ORDER BY scope').all(account.id) :
      this.db.prepare('SELECT scope,document,revision FROM account_private_scorecards WHERE account_id=? AND scope=?').all(account.id, scope);
    return { scorecards: rows.map(row => {
      if (typeof row.document !== 'string') throw new Error('La planilla privada guardada no es válida. No se reemplazó.');
      return readAccountScorecard({ scope: row.scope, revision: row.revision, save: JSON.parse(row.document) });
    }) };
  }
  privateScorecardReport(token: string | undefined, scope: string) {
    const account = this.authenticate(token);
    const scorecard = this.privateScorecards(token, scope).scorecards[0];
    if (!scorecard) throw new NotFoundException('No se encontró esa planilla en tu cuenta.');
    const state = replayPrivate(scorecard.save.seed, scorecard.save.commands);
    return createGameReport(state, { source: 'private', detailed: hasAccountFeature(account, 'final-report-details') });
  }
  personalPrivateStatistics(identification: string, knownGames: readonly StatisticsGame[]): StatisticsGame[] {
    const person = normalizeProfileIdentification(identification);
    const rows = this.db.prepare(`SELECT account_id,scope,document,revision FROM account_private_scorecards
      WHERE EXISTS (SELECT 1 FROM json_tree(document,'$.seed.rosters') WHERE key IN ('identification','id') AND value IN (?,?))`).all(person, person.replace('-', ''));
    const copies = new Map<string, StatisticsGame>();
    const conflicting = new Set<string>();
    const projected = rows.flatMap(row => {
      if (typeof row.document !== 'string') throw new Error('La planilla privada guardada no es válida. No se reemplazó.');
      const stored = readAccountScorecard({ scope: row.scope, revision: row.revision,
        save: JSON.parse(row.document) });
      let origin: unknown;
      let canonical: string | undefined;
      // An opaque scope is valid; only the existing three-part game scope identifies an official mirror.
      try { origin = JSON.parse(stored.scope); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (Array.isArray(origin) && origin.length === 3 && origin.every(value => typeof value === 'string')) {
        const [tournamentId, gameId] = origin;
        if (knownGames.some(game => game.tournamentId === tournamentId && game.gameId === gameId)) return [];
        canonical = JSON.stringify([tournamentId, gameId]);
      }
      return personalScorecardStatistics(replayPrivate(stored.save.seed, stored.save.commands), person, {
        kind: 'private', gameId: `private-${digest(JSON.stringify(canonical === undefined ?
          ['owner', row.account_id, stored.scope] : ['game', canonical]))}`,
        tournamentId: 'private', tournamentName: 'Planilla privada', version: stored.revision,
      });
    });
    for (const game of projected) {
      const previous = copies.get(game.gameId);
      if (!previous) copies.set(game.gameId, game);
      else if (!conflicting.has(game.gameId) && JSON.stringify({ ...previous, version: 0 }) !== JSON.stringify({ ...game, version: 0 })) {
        conflicting.add(game.gameId);
        copies.set(game.gameId, { ...previous, line: null, qualification: 'excluded', result: null,
          reason: 'Hay copias privadas discrepantes del mismo partido. No se suman ni se elige una versión entre distintos creadores.' });
      }
    }
    return [...copies.values()];
  }

  savePrivateScorecard(token: string | undefined, input: unknown) {
    const account = this.authenticate(token);
    if (!input || typeof input !== 'object' || !('scope' in input) || typeof input.scope !== 'string' ||
        !input.scope || input.scope.length > 1000 || hasControls(input.scope) ||
        !('expectedRevision' in input) || typeof input.expectedRevision !== 'number' ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || !('save' in input))
      throw new BadRequestException('Indica la planilla y su revisión vigente.');
    let save: ReturnType<typeof readPrivateSave>;
    try { save = readPrivateSave(JSON.stringify(input.save)); }
    catch (error) {
      if (error instanceof Error) throw new BadRequestException(error.message);
      throw error;
    }
    const scope = input.scope, expected = input.expectedRevision, document = JSON.stringify(save);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT revision FROM account_private_scorecards WHERE account_id=? AND scope=?').get(account.id, scope);
      if ((row?.revision ?? 0) !== expected)
        throw new ConflictException('La planilla cambió en otro dispositivo. Vuelve a abrirla; no se sobrescribió ninguna anotación.');
      const revision = expected + 1;
      this.db.prepare(`INSERT INTO account_private_scorecards(account_id,scope,document,revision) VALUES(?,?,?,?)
        ON CONFLICT(account_id,scope) DO UPDATE SET document=excluded.document,revision=excluded.revision`).run(account.id, scope, document, revision);
      return readAccountScorecard({ scope, revision, save });
    });
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

  private account(row: unknown): StoredAccount | null {
    if (row === undefined) return null;
    if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' ||
        !('email' in row) || typeof row.email !== 'string' || !('display_name' in row) || typeof row.display_name !== 'string' ||
        !('password_hash' in row) || typeof row.password_hash !== 'string' ||
        !/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(row.password_hash) ||
        !('created_at' in row) || typeof row.created_at !== 'number') {
      throw new Error('La base de cuentas contiene un registro inválido.');
    }
    return { id: row.id, email: row.email, display_name: row.display_name, password_hash: row.password_hash, created_at: row.created_at };
  }

  private publicAccount(row: StoredAccount): AccountProfile {
    const stored = this.db.prepare('SELECT photo,revision FROM account_photos WHERE account_id=?').get(row.id);
    let photo: { photo: string; photoRevision: number } | undefined;
    if (stored) {
      if (typeof stored.revision !== 'number' || !Number.isSafeInteger(stored.revision) || stored.revision < 1) throw new Error('La revisión de foto guardada no es válida.');
      photo = { photo: readAccountPhoto(stored.photo), photoRevision: stored.revision };
    }
    return { id: row.id, email: row.email, displayName: row.display_name, createdAt: new Date(row.created_at).toISOString(),
      emailVerified: false, identityVerification: this.identities.get(row.id)?.status === 'verified' ? 'manual' : 'unavailable', financialAccess: false,
      ...(row.id === this.localTesterId() ? { localTestAccess: true as const } : {}),
      ...(this.isAdministrator(row.id) ? { administrationAccess: true as const } : {}),
      features: this.trials.features(row.id, row.id === this.localTesterId()),
      ...(this.isIdentityReviewer(row.id) ? { identityReviewer: true as const } : {}),
      ...(this.identities.get(row.id) ? { identity: this.identities.get(row.id) } : {}), ...photo };
  }

  private isIdentityReviewer(accountId: string) {
    return accountId === this.localTesterId() || accountId === process.env.PLAYSPORT_IDENTITY_REVIEWER_ACCOUNT_ID;
  }
  private identityReviewer(token: string | undefined) {
    const account = this.authenticate(token);
    if (!this.isIdentityReviewer(account.id)) throw new ForbiddenException('La revisión documental está reservada al administrador de identidad autorizado, no al organizador.');
    return account;
  }
  submitIdentity(token: string | undefined, body: unknown) {
    const account = this.authenticate(token);
    this.attempt(`identity:${account.id}`, 10);
    this.transaction(() => this.identities.submit(account.id, body));
    return { account: this.authenticate(token) };
  }
  identityQueue(token: string | undefined) {
    const account = this.identityReviewer(token);
    return { accountId: account.id, requests: this.identities.queue() };
  }
  identityEvidence(token: string | undefined, accountId: string) {
    this.identityReviewer(token);
    return this.identities.evidence(accountId);
  }
  reviewIdentity(token: string | undefined, body: unknown) {
    const account = this.identityReviewer(token);
    this.transaction(() => this.identities.review(account.id, body));
    return this.identityQueue(token);
  }
  verifiedPerson(identification: string) { return this.identities.verified(identification); }
  verifiedSportingPerson(input: string) {
    return input.startsWith('person:') ? this.identities.verifiedActor(input) : this.identities.verified(input);
  }
  personalActor(identification: string) { return this.identities.actorId(identification); }
  favoritePlayerId(identification: string) { return this.identities.favoritePlayerId(identification); }
  favorites(token: string | undefined) {
    const account = this.authenticate(token);
    return { accountId: account.id, items: this.db.prepare('SELECT kind,id FROM account_favorites WHERE account_id=? ORDER BY kind,id').all(account.id).map(readFavoriteRef) };
  }
  changeFavorite(token: string | undefined, body: unknown, catalog: FavoriteTarget[]) {
    const account = this.authenticate(token);
    let input;
    try { input = readFavoriteChange(body); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'El favorito no es válido.'); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se modificaron los favoritos.');
    const hash = digest(JSON.stringify(input));
    this.transaction(() => {
      const current = this.authenticateInTransaction(token);
      const previous = this.db.prepare('SELECT body_hash FROM account_favorite_commands WHERE account_id=? AND request_id=?').get(current.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices una solicitud para otro cambio de favorito.');
        return;
      }
      if (input.favorite && !catalog.some(row => row.kind === input.kind && row.id === input.id))
        throw new BadRequestException('Este equipo, jugador o liga ya no está disponible públicamente.');
      const count = this.db.prepare('SELECT count(*) AS count FROM account_favorite_commands WHERE account_id=? AND created_at>?').get(current.id, this.now() - 60000)?.count;
      if (typeof count !== 'number') throw new Error('No se pudo verificar el límite de cambios de favoritos.');
      if (count >= 60) throw new HttpException('Demasiados cambios seguidos. Espera un minuto.', 429);
      if (input.favorite)
        this.db.prepare('INSERT INTO account_favorites VALUES(?,?,?) ON CONFLICT DO NOTHING').run(current.id, input.kind, input.id);
      else this.db.prepare('DELETE FROM account_favorites WHERE account_id=? AND kind=? AND id=?').run(current.id, input.kind, input.id);
      this.db.prepare('INSERT INTO account_favorite_commands VALUES(?,?,?,?)').run(current.id, input.requestId, hash, this.now());
    });
    return { ...this.favorites(token), catalog };
  }
  setRegisteredPersonLookup(lookup: (_identification: string) => string | undefined) { this.identities.setRegisteredPersonLookup(lookup); } // eslint-disable-line no-unused-vars
  sportsSheet(token: string | undefined) {
    const account = this.authenticate(token);
    const row = this.db.prepare('SELECT public_ref,document,revision FROM account_sports_sheets WHERE account_id=?').get(account.id);
    if (!row) return { accountId: account.id, revision: 0, publicRef: null, document: newSportsSheet() };
    if (typeof row.document !== 'string' || typeof row.public_ref !== 'string' || typeof row.revision !== 'number')
      throw new Error('La hoja deportiva guardada no es válida.');
    return { accountId: account.id, revision: row.revision, publicRef: row.public_ref, document: readSportsSheet(JSON.parse(row.document)) };
  }
  changeSportsSheet(token: string | undefined, body: unknown) {
    const account = this.authenticate(token);
    const input = this.fields(body, ['expectedAccountId', 'expectedRevision', 'document']);
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se modificó la hoja deportiva.');
    if (typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER)
      throw new BadRequestException('La revisión de la hoja no es válida.');
    let document;
    try { document = readSportsSheet(input.document); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La hoja deportiva no es válida.'); }
    const serialized = JSON.stringify(document);
    this.attempt(`sports-sheet:${account.id}`, 60);
    this.transaction(() => {
      const row = this.db.prepare('SELECT document,revision FROM account_sports_sheets WHERE account_id=?').get(account.id);
      if (row?.revision === Number(input.expectedRevision) + 1 && row.document === serialized) return;
      if ((row?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException('La hoja cambió en otra pantalla. Recarga la versión guardada antes de continuar.');
      this.db.prepare(`INSERT INTO account_sports_sheets VALUES(?,?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET document=excluded.document,revision=excluded.revision`)
        .run(account.id, randomBytes(18).toString('base64url'), serialized, Number(input.expectedRevision) + 1);
    });
    return this.sportsSheet(token);
  }
  publishedSportsSheet(ref: string, teams: (_account: AccountProfile) => SportsSheetTeam[]) { // eslint-disable-line no-unused-vars
    if (!/^[a-zA-Z0-9_-]{24}$/.test(ref)) throw new NotFoundException('Esta hoja deportiva no está publicada.');
    const row = this.db.prepare('SELECT account_id,document FROM account_sports_sheets WHERE public_ref=?').get(ref);
    if (!row) throw new NotFoundException('Esta hoja deportiva no está publicada.');
    if (typeof row.document !== 'string' || typeof row.account_id !== 'string') throw new Error('La hoja deportiva guardada no es válida.');
    const document = readSportsSheet(JSON.parse(row.document));
    if (!document.privacy.published) throw new NotFoundException('Esta hoja deportiva no está publicada.');
    const stored = this.account(this.db.prepare('SELECT * FROM accounts WHERE id=?').get(row.account_id));
    if (!stored) throw new Error('La cuenta de la hoja deportiva no está disponible.');
    const account = this.publicAccount(stored);
    return projectPublicSportsSheet(document, { name: account.displayName, photo: account.photo,
      verifiedIdentity: account.identity?.status === 'verified' }, document.privacy.teams ? teams(account) : []);
  }
  personalProfile(token: string | undefined) {
    const account = this.authenticate(token);
    if (account.identity?.status !== 'verified') throw new ForbiddenException('Verifica primero tu identidad personal global.');
    const row = this.db.prepare('SELECT document,revision FROM account_profiles WHERE account_id=?').get(account.id);
    if (row && (typeof row.document !== 'string' || typeof row.revision !== 'number')) throw new Error('El perfil personal guardado no es válido.');
    return { accountId: account.id, revision: row ? Number(row.revision) : 0, document: readDemoProfiles(row ? String(row.document) : null) };
  }
  changePersonalProfile(token: string | undefined, body: unknown) {
    const account = this.authenticate(token), identity = account.identity;
    if (identity?.status !== 'verified') throw new ForbiddenException('Verifica primero tu identidad personal global.');
    const input = this.fields(body, ['expectedAccountId','expectedRevision','document']);
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se modificó el perfil.');
    let document;
    try { document = readDemoProfiles(JSON.stringify(input.document)); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'El perfil no es válido.'); }
    const keys = Object.keys(newDemoPersonalProfile(account.id, demoProfileLocation));
    if (document.saved.length > 1 || document.drafts.length > 1 || [...document.saved,...document.drafts].some(profile =>
      profile.accountId !== account.id || profile.identification !== identity.identification || profile.fullName !== identity.fullName ||
      profile.birthDate !== identity.birthDate || Object.keys(profile).some(key => !keys.includes(key))))
      throw new ForbiddenException('El perfil debe conservar la misma cuenta y los datos de su identidad verificada en todos los roles.');
    this.transaction(() => {
      const current = this.db.prepare('SELECT revision FROM account_profiles WHERE account_id=?').get(account.id);
      if (input.expectedRevision !== (current?.revision ?? 0)) throw new ConflictException('El perfil cambió en otra pantalla. Recarga antes de guardar.');
      this.db.prepare('INSERT INTO account_profiles VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET document=excluded.document,revision=excluded.revision')
        .run(account.id, JSON.stringify(document), Number(input.expectedRevision) + 1);
    });
    return this.personalProfile(token);
  }

  private localTesterId(): string | null {
    if (process.env.NODE_ENV === 'production') return null;
    const origin = new URL(process.env.PLAYSPORT_WEB_ORIGIN ?? 'http://localhost:3000');
    if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
        !existsSync(this.localTesterPath)) return null;
    const value: unknown = JSON.parse(readFileSync(this.localTesterPath, 'utf8'));
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
        !('accountId' in value) || typeof value.accountId !== 'string' ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.accountId)) {
      throw new Error('La configuración privada de la cuenta de pruebas no es válida.');
    }
    return value.accountId;
  }

  private fields(body: unknown, allowed: string[]): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Envía los datos de la cuenta como un objeto.');
    const fields = Object.fromEntries(Object.entries(body));
    if (Object.keys(fields).some(key => !allowed.includes(key))) throw new BadRequestException('La solicitud contiene campos no permitidos.');
    return fields;
  }

  private email(value: unknown): string {
    if (typeof value !== 'string' || value.length > 254 || hasControls(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
      throw new BadRequestException('Indica un correo electrónico válido.');
    }
    return value.trim().toLowerCase();
  }

  private password(value: unknown, creating: boolean): string {
    if (typeof value !== 'string' || value.length > 128 || hasControls(value) ||
        [...value].length < (creating ? 15 : 1)) {
      throw new BadRequestException(creating ? 'Usa una contraseña de 15 a 128 caracteres; puedes usar una frase.' : 'Indica tu contraseña.');
    }
    return value;
  }

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 80 || hasControls(value)) {
      throw new BadRequestException('Indica un nombre público de 1 a 80 caracteres.');
    }
    return value.trim().replace(/\s+/g, ' ');
  }

  private attempt(key: string, limit: number) {
    const now = this.now(), windowMs = 15 * 60 * 1000;
    const hits = this.transaction(() => {
      this.db.prepare('DELETE FROM account_attempts WHERE started_at <= ?').run(now - windowMs);
      this.db.prepare(`INSERT INTO account_attempts(key, started_at, hits) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET hits = hits + 1`).run(digest(key), now);
      return this.db.prepare('SELECT hits FROM account_attempts WHERE key = ?').get(digest(key))?.hits;
    });
    if (typeof hits !== 'number') throw new Error('No se pudo verificar el límite de intentos.');
    if (hits > limit) throw new HttpException('Demasiados intentos. Espera 15 minutos antes de volver a intentar.', 429);
  }

  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.hashing >= 4) throw new HttpException('El servicio está ocupado. Vuelve a intentar en unos segundos.', 429);
    this.hashing++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
          error ? reject(error) : resolve(key));
      });
    } finally { this.hashing--; }
  }

  private async encode(password: string): Promise<string> {
    const salt = randomBytes(16);
    return `scrypt-v1$${salt.toString('hex')}$${(await this.derive(password, salt)).toString('hex')}`;
  }

  private async matches(password: string, encoded: string): Promise<boolean> {
    const [, salt, hash] = encoded.split('$');
    return timingSafeEqual(await this.derive(password, Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
  }

  private session(account: StoredAccount) {
    const token = randomBytes(32).toString('base64url'), now = this.now();
    this.db.prepare('DELETE FROM account_sessions WHERE (created_at <= ? OR last_seen_at <= ?) AND account_id != ?')
      .run(now - absoluteSessionMs, now - idleSessionMs, this.localTesterId() ?? '');
    this.db.prepare('INSERT INTO account_sessions(token_hash, account_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .run(digest(token), account.id, now, now);
    return { account: this.publicAccount(account), token };
  }

  async register(body: unknown, remoteAddress: string) {
    this.attempt(`register:${remoteAddress}`, 10);
    const fields = this.fields(body, ['email', 'password', 'displayName']);
    const email = this.email(fields.email), displayName = this.name(fields.displayName);
    const passwordHash = await this.encode(this.password(fields.password, true));
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM accounts WHERE email = ?').get(email)) {
        throw new ConflictException('No se pudo crear la cuenta con ese correo. Si ya tienes una cuenta, inicia sesión.');
      }
      const row = { id: randomUUID(), email, display_name: displayName, password_hash: passwordHash, created_at: this.now() };
      this.db.prepare('INSERT INTO accounts(id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, row.email, row.display_name, row.password_hash, row.created_at);
      return this.session(row);
    });
  }

  async login(body: unknown, remoteAddress: string) {
    const fields = this.fields(body, ['email', 'password']);
    const email = this.email(fields.email), password = this.password(fields.password, false);
    this.attempt(`login-ip:${remoteAddress}`, 60);
    this.attempt(`login-email:${email}`, 10);
    const row = this.account(this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(email));
    const valid = await this.matches(password, row?.password_hash ?? `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(32)}`);
    if (!row || !valid) throw new UnauthorizedException('El correo o la contraseña son incorrectos.');
    return this.transaction(() => {
      const current = this.account(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(row.id));
      if (!current || current.password_hash !== row.password_hash) throw invalidSession();
      this.db.prepare('DELETE FROM account_attempts WHERE key = ?').run(digest(`login-email:${email}`));
      return this.session(current);
    });
  }

  authenticate(token: string | undefined): AccountProfile {
    return this.transaction(() => this.authenticateInTransaction(token));
  }

  private authenticateInTransaction(token: string | undefined): AccountProfile {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidSession();
    const session = this.db.prepare('SELECT * FROM account_sessions WHERE token_hash = ?').get(digest(token));
    const now = this.now();
    if (!session || typeof session.created_at !== 'number' || typeof session.last_seen_at !== 'number' ||
        session.account_id !== this.localTesterId() &&
        (session.created_at <= now - absoluteSessionMs || session.last_seen_at <= now - idleSessionMs)) {
      throw invalidSession();
    }
    const row = this.account(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(session.account_id));
    if (!row) throw invalidSession();
    this.db.prepare('UPDATE account_sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, digest(token));
    return this.publicAccount(row);
  }

  logout(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM account_sessions WHERE token_hash = ?').run(digest(token));
  }
  changePhoto(token: string | undefined, body: unknown): { account: AccountProfile; appliedRevision: number } {
    const account = this.authenticate(token);
    let input;
    try { input = readAccountPhotoChange(body); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La foto no es válida.'); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se guardó la foto para otra persona.');
    if (input.photo) {
      const encoded = input.photo.slice('data:image/jpeg;base64,'.length), bytes = Buffer.from(encoded, 'base64');
      if (bytes.toString('base64') !== encoded || bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
        bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw new BadRequestException('La imagen no contiene un JPEG válido. Prepárala desde el selector de foto.');
    }
    const hash = digest(JSON.stringify(input));
    return this.transaction(() => {
      const current = this.authenticateInTransaction(token);
      const previous = this.db.prepare('SELECT body_hash,revision FROM account_photo_commands WHERE account_id=? AND request_id=?').get(current.id, input.requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices la solicitud de foto con otra imagen o revisión.');
        if (typeof previous.revision !== 'number') throw new Error('La actualización guardada no es válida.');
        return { account: current, appliedRevision: previous.revision };
      }
      const recent = this.db.prepare('SELECT count(*) AS count FROM account_photo_commands WHERE account_id=? AND created_at>?').get(current.id, this.now() - 60000)?.count;
      if (typeof recent !== 'number') throw new Error('No se pudo verificar el límite de actualizaciones de foto.');
      if (recent >= 30) throw new HttpException('Demasiadas actualizaciones de foto. Espera un minuto.', 429);
      if ((current.photoRevision ?? 0) !== input.expectedRevision) throw new ConflictException('La foto cambió en otra pantalla. Recarga la foto guardada antes de reemplazarla.');
      const revision = input.expectedRevision + 1;
      this.db.prepare('INSERT INTO account_photos VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET photo=excluded.photo,revision=excluded.revision,updated_at=excluded.updated_at')
        .run(current.id, input.photo, revision, this.now());
      this.db.prepare('INSERT INTO account_photo_commands VALUES(?,?,?,?,?)').run(current.id, input.requestId, hash, revision, this.now());
      return { account: this.authenticateInTransaction(token), appliedRevision: revision };
    });
  }

  async changePassword(token: string | undefined, body: unknown) {
    const profile = this.authenticate(token);
    this.attempt(`password:${profile.id}`, 5);
    const fields = this.fields(body, ['currentPassword', 'newPassword']);
    const currentPassword = this.password(fields.currentPassword, false), nextPassword = this.password(fields.newPassword, true);
    const row = this.account(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(profile.id));
    if (!row) throw invalidSession();
    if (!await this.matches(currentPassword, row.password_hash)) throw new BadRequestException('La contraseña actual es incorrecta.');
    if (currentPassword === nextPassword) throw new BadRequestException('Elige una contraseña diferente de la actual.');
    const nextHash = await this.encode(nextPassword);
    return this.transaction(() => {
      this.authenticateInTransaction(token);
      const changed = this.db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ? AND password_hash = ?')
        .run(nextHash, row.id, row.password_hash);
      if (changed.changes !== 1) throw invalidSession();
      this.db.prepare('DELETE FROM account_sessions WHERE account_id = ?').run(row.id);
      return this.session({ ...row, password_hash: nextHash });
    });
  }
}
