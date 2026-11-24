import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  readTournament,
  tournamentParticipationBlock,
  tournamentScheduleConflicts,
  venezuelaToday,
  registrationIdentification,
  estimateTournamentCapacity,
  readOrganizerFreeReservation,
  readOrganizerPlanRequest, readOrganizerPlanAuthorization, readOrganizerGameRestart, organizerPlanQuote,
  type TournamentDocument,
  type TournamentRecord
} from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { OfficialScoringService } from '../live-scoring/official-scoring.service';

type Options = { path: string; now?: () => number };
type PlanningCommand = {
  requestId: string;
  expectedAccountId: string;
  expectedRevision: number;
  role: 'organizer';
  actorId: string;
  action: 'save' | 'publish' | 'approve-roster' | 'reject-roster';
  document: TournamentDocument;
  teamId: string;
  reviewNote?: string;
};
@Injectable()
export class TournamentsService implements OnModuleDestroy, OnModuleInit {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly accounts: AccountsService;
  private readonly scoring: OfficialScoringService;
  constructor(accounts: AccountsService, scoring: OfficialScoringService, @Optional() options?: Options) {
    this.accounts = accounts;
    this.scoring = scoring;
    this.now = options?.now ?? Date.now;
    const path = resolve(
      options?.path ?? process.env.PLAYSPORT_TOURNAMENTS_PATH ?? '.local/tournaments/tournaments.sqlite'
    );
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2) throw new Error('La base de torneos no es compatible. No se sobrescribió.');
      this.db
        .exec(`CREATE TABLE IF NOT EXISTS tournaments(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,document TEXT NOT NULL,revision INTEGER NOT NULL,published INTEGER NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tournament_commands(account_id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,tournament_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(account_id,request_id));
        CREATE TABLE IF NOT EXISTS tournament_history(id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL,account_id TEXT NOT NULL,action TEXT NOT NULL,revision INTEGER NOT NULL,at TEXT NOT NULL,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tournament_actors(tournament_id TEXT NOT NULL,actor_id TEXT NOT NULL,identification TEXT NOT NULL,PRIMARY KEY(tournament_id,actor_id));
        CREATE TABLE IF NOT EXISTS tournament_leagues(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tournament_capacity(tournament_id TEXT PRIMARY KEY,account_id TEXT NOT NULL);
        `);
      if (version !== 2) this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE tournaments ADD COLUMN organizer_actor_id TEXT NOT NULL DEFAULT 'org-demo';
        ALTER TABLE tournament_leagues ADD COLUMN organizer_actor_id TEXT NOT NULL DEFAULT 'org-demo';
        PRAGMA user_version=2; COMMIT;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  onModuleDestroy() {
    this.db.close();
  }
  onModuleInit() {
    this.scoring.setTournamentPlanning({
      document: (id) => this.document(id),
      organizerCapacity: (id) => this.capacityMode(id),
      assertParticipation: (tournamentId, gameId, teamId, players, kind) =>
        this.assertParticipation(tournamentId, gameId, teamId, players, kind),
      managerAccount: (tournamentId, managerId, accountId) => this.managerAccount(tournamentId, managerId, accountId),
      organizerAccount: (tournamentId, accountId) =>
        this.db.prepare('SELECT 1 FROM tournaments WHERE id=? AND account_id=?').get(tournamentId, accountId) !==
        undefined,
      published: (tournamentId) =>
        this.db.prepare('SELECT published FROM tournaments WHERE id=?').get(tournamentId)?.published === 1,
      institutions: (includePrivate) => {
        const tournaments = this.db.prepare('SELECT * FROM tournaments').all().map(row => {
          if (typeof row.account_id !== 'string') throw new Error('La propiedad del torneo no es válida.');
          return { ...this.record(row), ownerAccountId: row.account_id };
        });
        const published = new Set(tournaments.filter(row => row.public).map(row => row.document.leagueId).filter(Boolean));
        const leagues = this.db.prepare('SELECT id,name,account_id,organizer_actor_id FROM tournament_leagues').all().flatMap(row => {
          if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.account_id !== 'string' ||
              typeof row.organizer_actor_id !== 'string')
            throw new Error('La identidad de la liga no es válida.');
          if (!includePrivate && !published.has(row.id)) return [];
          return [{ kind: 'league' as const, id: row.id, name: row.name, ownerAccountId: row.account_id,
            organizerId: row.organizer_actor_id, managerId: null, tournamentId: '', managerOwned: false }];
        });
        return [...leagues, ...tournaments.filter(row => includePrivate || row.public).map(row => ({
          kind: 'tournament' as const, id: row.document.id, name: row.document.name || row.document.leagueName,
          ownerAccountId: row.ownerAccountId, organizerId: this.organizerActor(row.document.id), managerId: null,
          tournamentId: row.document.id, managerOwned: false
        }))];
      }
    });
    this.reconcile();
  }
  reconcile() {
    const actors = this.db
      .prepare('SELECT actor_id,identification FROM tournament_actors')
      .all()
      .map((row) => {
        if (typeof row.actor_id !== 'string' || typeof row.identification !== 'string')
          throw new Error('Las identidades del torneo no son válidas.');
        return { actorId: row.actor_id, identification: row.identification };
      });
    this.scoring.restorePlannedActors(actors);
    for (const row of this.db.prepare('SELECT * FROM tournaments').all()) {
      const record = this.record(row);
      this.scoring.projectPlannedTournament(record.document, record.public, this.organizerActor(record.document.id));
    }
  }
  private editor(token: string | undefined, role: unknown, actorId: unknown) {
    const account = this.accounts.authenticate(token);
    const demo = account.localTestAccess && process.env.NODE_ENV !== 'production' && actorId === 'org-demo';
    const verified = account.identity?.status === 'verified' && actorId === account.identity.actorId;
    if (role !== 'organizer' || (!demo && !verified))
      throw new ForbiddenException(
        'Verifica tu identidad y utiliza tu propia cuenta para organizar torneos. Elegir un rol no concede acceso a torneos ajenos.'
      );
    return account;
  }
  private organizerActor(id: string) {
    const actor = this.db.prepare('SELECT organizer_actor_id FROM tournaments WHERE id=?').get(id)?.organizer_actor_id;
    if (typeof actor !== 'string') throw new Error('Falta el organizador propietario del torneo.');
    return actor;
  }
  private record(value: unknown): TournamentRecord {
    if (
      !value ||
      typeof value !== 'object' ||
      !('document' in value) ||
      typeof value.document !== 'string' ||
      !('revision' in value) ||
      typeof value.revision !== 'number' ||
      !('published' in value) ||
      !('updated_at' in value) ||
      typeof value.updated_at !== 'string'
    )
      throw new Error('El registro persistente del torneo es inválido.');
    return {
      document: readTournament(JSON.parse(value.document)),
      revision: value.revision,
      public: value.published === 1,
      updatedAt: value.updated_at
    };
  }
  document(id: string): TournamentDocument | null {
    const row = this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id);
    return row ? this.record(row).document : null;
  }
  private capacityMode(id: string) {
    const owner = this.db.prepare('SELECT account_id FROM tournaments WHERE id=?').get(id);
    if (!owner) return null;
    if (typeof owner.account_id !== 'string') throw new Error('La titularidad de la capacidad no es válida.');
    const mode = this.db.prepare('SELECT account_id FROM tournament_capacity WHERE tournament_id=?').get(id);
    if (mode && mode.account_id !== owner.account_id) throw new Error('La capacidad no corresponde al propietario del torneo.');
    return { accountId: owner.account_id, legacy: !mode };
  }
  capacity(token: string | undefined) {
    const account = this.accounts.authenticate(token);
    this.editor(token, 'organizer', account.identity?.actorId ?? 'org-demo');
    return { accountId: account.id, free: this.scoring.organizerFreeAccess(account.id),
      tournaments: this.db.prepare('SELECT id FROM tournaments WHERE account_id=? ORDER BY id').all(account.id).map(row => {
        if (typeof row.id !== 'string') throw new Error('La identidad del torneo no es válida.');
        return { tournamentId: row.id, legacy: this.capacityMode(row.id)!.legacy, played: this.scoring.organizerGameUsage(row.id),
          plan: this.scoring.organizerPlan(row.id), planRevision: this.scoring.organizerPlanRevision(row.id), restarts: this.scoring.organizerRestarts(row.id) };
      }) };
  }
  reserveFree(token: string | undefined, body: unknown) {
    const account = this.accounts.authenticate(token);
    if (account.identity?.status !== 'verified') throw new ForbiddenException('Verifica tu identidad para reservar el torneo gratuito.');
    let input;
    try { input = readOrganizerFreeReservation(body); }
    catch (error) { if (!(error instanceof Error)) throw error; throw new BadRequestException(error.message); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se modificó la reserva.');
    if (input.tournamentId !== null) {
      const owned = this.owned(input.tournamentId, account.id);
      if (!owned) throw new NotFoundException('Guarda tu propio torneo antes de reservar la oportunidad gratuita.');
      if (this.capacityMode(input.tournamentId)!.legacy) throw new ConflictException('Los torneos anteriores conservan su acceso y no utilizan esta reserva.');
      if (!estimateTournamentCapacity(owned.document, this.scoring.organizerGameUsage(input.tournamentId)).freeEligible)
        throw new ForbiddenException({ code: 'ORGANIZER_FREE_LIMIT', message: 'Define un torneo de 2 a 5 equipos y hasta 13 partidos ordinarios, incluyendo el máximo de sus series, más hasta 3 desempates adicionales justificados.' });
    }
    const result = this.scoring.reserveOrganizerFree(input);
    return { capacity: this.capacity(token), appliedRevision: result.appliedRevision, replayed: result.replayed };
  }
  selectPlan(token: string | undefined, body: unknown) {
    const account = this.accounts.authenticate(token);
    this.editor(token, 'organizer', account.identity?.actorId);
    let input;
    try { input = readOrganizerPlanRequest(body); }
    catch (error) { if (!(error instanceof Error)) throw error; throw new BadRequestException(error.message); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se modificó el plan.');
    const owned = this.owned(input.tournamentId, account.id);
    if (!owned) throw new NotFoundException('Guarda el torneo antes de elegir su plan.');
    if (this.capacityMode(input.tournamentId)!.legacy) throw new ConflictException('Los torneos anteriores conservan su acceso.');
    if (['finished','cancelled'].includes(owned.document.status)) throw new ConflictException('Un torneo cerrado no reutiliza su contratación para otra edición.');
    if (input.selection && !organizerPlanQuote(owned.document, input.selection, this.scoring.organizerPlan(input.tournamentId),
        this.scoring.organizerGameUsage(input.tournamentId)).fits)
      throw new ForbiddenException('El paquete no cubre los equipos o partidos previstos. Completa la planificación o elige otra capacidad.');
    const result = this.scoring.selectOrganizerPlan(input);
    return { ...result, capacity: this.capacity(token) };
  }
  authorizePlan(token: string | undefined, body: unknown) {
    this.accounts.administration(token, {});
    const administrator = this.accounts.authenticate(token);
    let input;
    try { input = readOrganizerPlanAuthorization(body); }
    catch (error) { if (!(error instanceof Error)) throw error; throw new BadRequestException(error.message); }
    if (input.expectedAdminId !== administrator.id) throw new ConflictException('La cuenta administradora cambió.');
    const doc = this.document(input.tournamentId), access = this.scoring.organizerPlan(input.tournamentId);
    if (!doc || !access || this.capacityMode(input.tournamentId)?.accountId !== access.accountId)
      throw new NotFoundException('El torneo no tiene una selección propia de capacidad.');
    if (['finished','cancelled'].includes(doc.status)) throw new ConflictException('El torneo ya está cerrado.');
    if (input.action === 'authorize-test' && !organizerPlanQuote(doc, access.selection, null, this.scoring.organizerGameUsage(doc.id)).fits)
      throw new ConflictException('La planificación supera la capacidad seleccionada.');
    return { ...this.scoring.authorizeOrganizerPlan(input), plan: this.scoring.organizerPlan(input.tournamentId) };
  }
  adminCapacity(token: string | undefined, tournamentId: string) {
    this.accounts.administration(token, {});
    const mode = this.capacityMode(tournamentId), doc = this.document(tournamentId);
    if (!mode || !doc) throw new NotFoundException('El torneo no existe.');
    return { tournamentId, name: doc.name, accountId: mode.accountId, plan: this.scoring.organizerPlan(tournamentId),
      revision: this.scoring.organizerPlanRevision(tournamentId), closed: ['finished','cancelled'].includes(doc.status) };
  }
  restartGame(token: string | undefined, body: unknown) {
    const account = this.accounts.authenticate(token);
    this.editor(token, 'organizer', account.identity?.actorId);
    let input;
    try { input = readOrganizerGameRestart(body); }
    catch (error) { if (!(error instanceof Error)) throw error; throw new BadRequestException(error.message); }
    if (input.expectedAccountId !== account.id) throw new ConflictException('La cuenta cambió. No se anuló el partido.');
    const owned = this.owned(input.tournamentId, account.id);
    if (!owned || !owned.document.fixtures.some(fixture => this.scoring.plannedGameId(input.tournamentId, fixture.id) === input.gameId))
      throw new NotFoundException('El partido no pertenece a tu planificación.');
    if (['finished','cancelled'].includes(owned.document.status)) throw new ConflictException('El torneo está cerrado.');
    const organizerId = account.identity?.actorId;
    if (!organizerId) throw new ForbiddenException('Verifica tu identidad de organizador.');
    const result = this.scoring.restartOrganizerGame(input, organizerId);
    return { ...result, capacity: this.capacity(token) };
  }
  private publicRecord(record: TournamentRecord): TournamentRecord {
    return {
      ...record,
      document: {
        ...record.document,
        teams: record.document.teams.map((team) => ({
          ...team,
          managerId: '',
          managerIdentification: '',
          rosterSignature: '',
          blocked: false,
          blockReason: '',
          blockScopes: [],
          withdrawalReason: team.status === 'withdrawn' ? 'Retiro registrado por el organizador.' : '',
          ...(team.enrollment
            ? { enrollment: { ...team.enrollment, contact: '', notes: '', reviewNotes: '', submittedAt: '' } }
            : {})
        })),
        sanctions: [],
        notices: record.document.notices.filter((notice) => notice.public)
      },
      officialFixtureIds: record.document.fixtures
        .filter((fixture) => this.scoring.plannedFixtureAvailable(record.document.id, fixture.id))
        .map((fixture) => fixture.id)
    };
  }
  list(token: string | undefined, role: unknown, actorId: unknown) {
    const account = this.editor(token, role, actorId);
    return {
      accountId: account.id,
      leagues: this.db.prepare('SELECT id,name FROM tournament_leagues WHERE account_id=? ORDER BY name,id').all(account.id),
      tournaments: this.db
        .prepare('SELECT * FROM tournaments WHERE account_id=? ORDER BY updated_at DESC')
        .all(account.id)
        .map((row) => this.record(row))
    };
  }
  publicList() {
    return {
      tournaments: this.db
        .prepare('SELECT * FROM tournaments WHERE published=1 ORDER BY updated_at DESC')
        .all()
        .map((row) => this.publicRecord(this.record(row)))
    };
  }
  getPublic(id: string) {
    const row = this.db.prepare('SELECT * FROM tournaments WHERE id=? AND published=1').get(id);
    if (!row) throw new NotFoundException('El torneo no existe o todavía es un borrador privado.');
    return this.publicRecord(this.record(row));
  }
  private owned(id: string, accountId: string) {
    const row = this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(id);
    if (row && row.account_id !== accountId) throw new ForbiddenException('No administras este torneo.');
    return row ? this.record(row) : null;
  }
  private managerAccount(tournamentId: string, managerId: string, accountId: string) {
    const team = this.document(tournamentId)?.teams.find((team) => team.enrollment && team.managerId === managerId);
    return !!team && this.accounts.verifiedPerson(team.managerIdentification)?.accountId === accountId;
  }
  managerList(token: string | undefined) {
    const account = this.accounts.authenticate(token);
    const identity = account.identity;
    return {
      accountId: account.id,
      tournaments:
        identity?.status !== 'verified'
          ? []
          : this.db
              .prepare('SELECT * FROM tournaments ORDER BY updated_at DESC')
              .all()
              .flatMap((row) => {
                const record = this.record(row);
                const teams = record.document.teams.filter(
                  (team) => team.enrollment && team.managerIdentification === identity.identification
                );
                return teams.map((team) => ({
                  tournamentId: record.document.id,
                  tournamentName: record.document.name || record.document.leagueName,
                  teamId: team.id,
                  teamName: team.name,
                  managerId: team.managerId,
                  revision: record.revision,
                  enrollment: team.enrollment,
                  rosterStatus: team.rosterStatus,
                  status: team.status
                }));
              })
    };
  }
  managerChange(token: string | undefined, body: unknown) {
    const account = this.accounts.authenticate(token);
    if (!account.identity || account.identity.status !== 'verified')
      throw new ForbiddenException(
        'Completa la verificación privada de tu identidad antes de gestionar una inscripción.'
      );
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Envía los detalles de tu inscripción.');
    const input = Object.fromEntries(Object.entries(body));
    if (
      Object.keys(input).some(
        (key) =>
          ![
            'requestId',
            'expectedAccountId',
            'expectedRevision',
            'tournamentId',
            'teamId',
            'action',
            'name',
            'contact',
            'notes'
          ].includes(key)
      ) ||
      typeof input.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(input.requestId) ||
      input.expectedAccountId !== account.id ||
      typeof input.tournamentId !== 'string' ||
      typeof input.teamId !== 'string' ||
      !['save', 'submit'].includes(String(input.action)) ||
      typeof input.name !== 'string' ||
      typeof input.contact !== 'string' ||
      typeof input.notes !== 'string'
    )
      throw new BadRequestException('La solicitud de inscripción no es válida.');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    let next: TournamentRecord;
    this.db.exec('BEGIN IMMEDIATE');
    let open = true;
    try {
      const row = this.db.prepare('SELECT * FROM tournaments WHERE id=?').get(input.tournamentId);
      if (!row) throw new NotFoundException('La inscripción no está disponible.');
      const previous = this.record(row),
        doc = previous.document;
      const team = doc.teams.find((team) => team.id === input.teamId);
      if (!team?.enrollment || team.managerIdentification !== account.identity.identification)
        throw new ForbiddenException('Esta inscripción no está asignada a tu identidad.');
      const replay = this.db
        .prepare('SELECT hash,revision FROM tournament_commands WHERE account_id=? AND request_id=?')
        .get(account.id, input.requestId);
      if (replay) {
        if (replay.hash !== hash) throw new ConflictException('Esta operación ya se usó para otros datos.');
        this.db.exec('COMMIT');
        open = false;
        this.scoring.projectPlannedTournament(doc, previous.public, this.organizerActor(doc.id));
        return { appliedRevision: replay.revision, replayed: true };
      }
      this.accounts.assertManagerTeamAccess(account, this.scoring.managerPlanTeams(account.identity.actorId!, account.id),
        doc.id, team.id);
      if (previous.revision !== input.expectedRevision)
        throw new ConflictException('El torneo cambió. Actualiza la inscripción antes de guardar.');
      if (team.status === 'withdrawn' || doc.status === 'finished' || doc.status === 'cancelled')
        throw new ConflictException('Esta inscripción ya no admite cambios.');
      if (team.enrollment.status === 'submitted')
        throw new ConflictException(
          'La inscripción está en revisión. El organizador debe solicitar correcciones antes de modificarla.'
        );
      if (team.blocked && team.blockScopes.includes('registration'))
        throw new ForbiddenException('El organizador bloqueó las incorporaciones de esta inscripción.');
      team.name = input.name;
      team.enrollment.contact = input.contact;
      team.enrollment.notes = input.notes;
      team.enrollment.status = input.action === 'submit' ? 'submitted' : 'draft';
      team.rosterStatus = 'pending';
      team.rosterSignature = '';
      if (input.action === 'submit') {
        if (!this.signature(doc.id, team.id).members.some((member) => member.role === 'PLAYER'))
          throw new ConflictException('Prepara el roster con al menos un jugador antes de enviarlo.');
        team.enrollment.submittedAt = new Date(this.now()).toISOString();
      }
      const document = this.command({
        requestId: input.requestId,
        expectedAccountId: account.id,
        expectedRevision: previous.revision,
        role: 'organizer',
        actorId: this.organizerActor(doc.id),
        action: 'save',
        document: doc,
        teamId: ''
      }).document;
      this.scoring.validatePlannedTournament(document, this.record(row).document, this.organizerActor(doc.id));
      next = { ...previous, document, revision: previous.revision + 1, updatedAt: new Date(this.now()).toISOString() };
      this.db
        .prepare('UPDATE tournaments SET document=?,revision=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(document), next.revision, next.updatedAt, doc.id);
      this.db
        .prepare('INSERT INTO tournament_commands VALUES(?,?,?,?,?)')
        .run(account.id, input.requestId, hash, doc.id, next.revision);
      this.db
        .prepare('INSERT INTO tournament_history VALUES(?,?,?,?,?,?,?)')
        .run(
          randomUUID(),
          doc.id,
          account.id,
          `manager-${input.action}`,
          next.revision,
          next.updatedAt,
          JSON.stringify(document)
        );
      this.db.exec('COMMIT');
      open = false;
    } catch (error) {
      if (open) this.db.exec('ROLLBACK');
      throw error;
    }
    this.scoring.projectPlannedTournament(next.document, next.public, this.organizerActor(next.document.id));
    return { appliedRevision: next.revision, replayed: false };
  }
  roster(token: string | undefined, role: unknown, actorId: unknown, id: string, teamId: string) {
    const account = this.editor(token, role, actorId),
      record = this.owned(id, account.id);
    if (!record?.document.teams.some((team) => team.id === teamId))
      throw new NotFoundException('El equipo no pertenece a este torneo.');
    return { members: this.scoring.plannedRoster(id, teamId) };
  }
  history(token: string | undefined, role: unknown, actorId: unknown, id: string) {
    const account = this.editor(token, role, actorId);
    if (!this.owned(id, account.id)) throw new NotFoundException('El torneo no existe.');
    return {
      events: this.db
        .prepare(
          'SELECT action,revision,at FROM tournament_history WHERE tournament_id=? ORDER BY revision DESC LIMIT 100'
        )
        .all(id)
    };
  }
  private signature(id: string, teamId: string) {
    const members = this.scoring.plannedRoster(id, teamId);
    return {
      members,
      signature: createHash('sha256')
        .update(JSON.stringify(members.map((member) => [member.person.id, member.role]).sort()))
        .digest('hex')
    };
  }
  assertParticipation(
    tournamentId: string,
    gameId: string,
    teamId: string,
    players: string[],
    kind: 'roster' | 'lineup' | 'play'
  ) {
    const doc = this.document(tournamentId);
    if (!doc) return;
    const team = doc.teams.find((team) => team.id === teamId);
    if (!team) throw new ForbiddenException('El equipo no pertenece al torneo.');
    if (kind === 'roster') {
      if (team.status === 'withdrawn' || (team.blocked && team.blockScopes.includes('registration')))
        throw new ForbiddenException('Las incorporaciones de este equipo están bloqueadas. Consulta al organizador.');
      if (team.enrollment?.status === 'submitted')
        throw new ConflictException(
          'El roster está enviado para revisión. Solicita correcciones al organizador antes de modificarlo.'
        );
      return;
    }
    if (doc.status === 'suspended' || doc.status === 'cancelled' || doc.status === 'finished')
      throw new ConflictException('El estado del torneo no permite nuevas participaciones.');
    const fixture = doc.fixtures.find((fixture) => this.scoring.plannedGameId(doc.id, fixture.id) === gameId);
    const identities = this.scoring
      .plannedRoster(doc.id, teamId)
      .filter((member) => players.some((id) => [member.person.id, member.person.identification].includes(id)))
      .flatMap((member) => [member.person.id, member.person.identification]);
    const block = tournamentParticipationBlock(
      doc,
      teamId,
      fixture?.phaseId ?? '',
      fixture?.date || venezuelaToday(new Date(this.now())),
      [...players, ...identities],
      kind
    );
    if (block) throw new ForbiddenException(block);
    if (team.rosterStatus !== 'approved' || team.rosterSignature !== this.signature(doc.id, team.id).signature)
      throw new ForbiddenException(
        'El organizador debe aprobar la versión actual del roster antes de entregar el lineup o iniciar el juego.'
      );
  }
  private command(body: unknown): PlanningCommand {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException('Envía el comando del torneo.');
    const r: Record<string, unknown> = body as Record<string, unknown>;
    if (
      Object.keys(r).some(
        (key) =>
          ![
            'requestId',
            'expectedAccountId',
            'expectedRevision',
            'role',
            'actorId',
            'action',
            'document',
            'teamId',
            'reviewNote'
          ].includes(key)
      ) ||
      typeof r.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(r.requestId) ||
      typeof r.expectedAccountId !== 'string' ||
      typeof r.expectedRevision !== 'number' ||
      !Number.isSafeInteger(r.expectedRevision) ||
      r.expectedRevision < 0 ||
      r.role !== 'organizer' ||
      typeof r.actorId !== 'string' ||
      !/^(?:org-demo|person:[a-f0-9-]{36})$/.test(r.actorId) ||
      typeof r.teamId !== 'string' ||
      (r.reviewNote !== undefined &&
        (typeof r.reviewNote !== 'string' ||
          r.reviewNote.length > 2000 ||
          [...r.reviewNote].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) ||
      !['save', 'publish', 'approve-roster', 'reject-roster'].includes(String(r.action))
    )
      throw new BadRequestException('El comando del torneo no es válido.');
    let document: TournamentDocument;
    try {
      document = readTournament(r.document);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Revisa el torneo.');
    }
    return {
      requestId: r.requestId,
      expectedAccountId: r.expectedAccountId,
      expectedRevision: r.expectedRevision,
      role: r.role,
      actorId: r.actorId,
      action: r.action as PlanningCommand['action'],
      document,
      teamId: r.teamId,
      ...(typeof r.reviewNote === 'string' ? { reviewNote: r.reviewNote.trim() } : {})
    };
  }
  private validatePlanningSchedule(document: TournamentDocument, organizerId: string) {
    const documents = this.db
      .prepare('SELECT * FROM tournaments WHERE published=1 AND id<>?')
      .all(document.id)
      .map((row) => this.record(row).document);
    documents.push(document);
    const fixtures = documents.flatMap((doc) => {
      const actors = new Map(this.scoring.plannedActors(doc, doc.id === document.id ? organizerId : this.organizerActor(doc.id))
        .map((actor) => [actor.actorId, actor.identification]));
      return doc.fixtures.map((fixture) => {
        const venue = doc.venues.find((venue) => venue.id === fixture.venueId);
        const venueId =
          venue?.stateId && venue.municipalityId
            ? JSON.stringify([
                venue.stateId,
                venue.municipalityId,
                venue.name
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .trim()
                  .toLowerCase()
              ])
            : fixture.venueId
              ? `${doc.id}:${fixture.venueId}`
              : '';
        return {
          ...fixture,
          id: `${doc.id}:${fixture.id}`,
          venueId,
          scorekeeperIds: fixture.scorekeeperIds.map((id) => {
            const identity = actors.get(id);
            if (!identity)
              throw new ConflictException('No se pudo verificar la identidad del anotador del calendario.');
            return identity;
          })
        };
      });
    });
    if (tournamentScheduleConflicts({ ...document, fixtures }).length)
      throw new ConflictException(
        'El horario se superpone con otro cruce del plan o de un torneo publicado: equipo, sede o anotador ocupado.'
      );
  }
  change(token: string | undefined, body: unknown) {
    this.accounts.authenticate(token);
    const input = this.command(body),
      account = this.editor(token, input.role, input.actorId);
    if (account.id !== input.expectedAccountId)
      throw new ConflictException('La cuenta cambió. No se modificó el torneo.');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    let transactionOpen = true;
    let next: TournamentRecord;
    try {
      const previous = this.owned(input.document.id, account.id);
      const replay = this.db
        .prepare('SELECT * FROM tournament_commands WHERE account_id=? AND request_id=?')
        .get(account.id, input.requestId);
      if (replay) {
        if (replay.hash !== hash || !previous)
          throw new ConflictException('Ese identificador de operación ya se utilizó para otros datos.');
        this.db.exec('COMMIT');
        transactionOpen = false;
        this.scoring.projectPlannedTournament(previous.document, previous.public, this.organizerActor(previous.document.id));
        return { record: previous, appliedRevision: replay.revision, replayed: true };
      }
      if ((previous?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException('El torneo cambió en otra pantalla. Recarga antes de guardar; no se sobrescribió.');
      if (!previous && !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.document.id))
        throw new BadRequestException('Usa un identificador nuevo de torneo, no el de un torneo existente.');
      const recent = this.db
        .prepare('SELECT COUNT(*) AS hits FROM tournament_history WHERE account_id=? AND at>?')
        .get(account.id, new Date(this.now() - 60000).toISOString());
      if (Number(recent?.hits) >= 60) throw new ConflictException('Espera un minuto antes de realizar más cambios.');
      const doc = input.document;
      const organizerId = previous ? this.organizerActor(doc.id) : input.actorId;
      const access = this.scoring.organizerPlan(doc.id), freeAccess = this.scoring.organizerFreeAccess(account.id);
      const committed = (access?.authorizedGames ?? 0) > 0 || freeAccess.tournamentId === doc.id && Boolean(freeAccess.consumedAt);
      if (previous && committed && ['finished','cancelled'].includes(previous.document.status) && doc.status !== previous.document.status)
        throw new ConflictException('La contratación terminó al cerrar este torneo. Otra edición requiere un torneo nuevo.');
      if (previous && committed && this.scoring.organizerGameUsage(doc.id).length && doc.season !== previous.document.season)
        throw new ConflictException('Una contratación iniciada no se traslada a otra temporada o edición.');
      if (input.actorId !== organizerId) throw new ForbiddenException('Utiliza la identidad organizadora propietaria de este torneo.');
      if (organizerId !== 'org-demo') {
        const actors = [{ actorId: organizerId, identification: account.identity!.identification }];
        for (const fixture of doc.fixtures) fixture.scorekeeperIds = [...new Set(fixture.scorekeeperIds.map(value => {
          const person = this.accounts.verifiedSportingPerson(value);
          if (!person?.identity.actorId) throw new BadRequestException('Cada anotador debe tener una cuenta con cédula verificada.');
          actors.push({ actorId: person.identity.actorId, identification: person.identity.identification });
          return person.identity.actorId;
        }))];
        this.scoring.restorePlannedActors(actors);
        if (doc.teams.some(team => !team.enrollment))
          throw new BadRequestException('Los equipos reales se inscriben mediante la cuenta de su manager.');
      }
      if (doc.leagueId) {
        const league = this.db.prepare('SELECT account_id,name FROM tournament_leagues WHERE id=?').get(doc.leagueId);
        if (!league || league.account_id !== account.id)
          throw new ForbiddenException('No administras esta liga. Selecciona una liga propia o crea una nueva.');
        if (league.name !== doc.leagueName)
          throw new ConflictException('El nombre de la liga no coincide. Selecciona de nuevo la liga guardada.');
      } else if (doc.leagueName) {
        doc.leagueId = randomUUID();
        this.db.prepare('INSERT INTO tournament_leagues(id,account_id,name,organizer_actor_id) VALUES(?,?,?,?)')
          .run(doc.leagueId, account.id, doc.leagueName, organizerId);
      }
      for (const team of doc.teams) {
        const old = previous?.document.teams.find((row) => row.id === team.id);
        if (old?.enrollment || team.enrollment || team.id.startsWith('inscription:')) {
          if (!team.enrollment)
            throw new BadRequestException('No se puede quitar la propiedad de una inscripción del manager.');
          if (!old) {
            if (!team.id.startsWith(`inscription:${doc.id}:`))
              throw new BadRequestException('Cada inscripción necesita una identidad interna propia de este torneo.');
            if (!team.managerIdentification)
              throw new BadRequestException('Indica la cédula del manager para crear la inscripción.');
            team.managerIdentification = registrationIdentification(team.managerIdentification);
            team.managerId = this.accounts.personalActor(team.managerIdentification);
            team.name = 'Inscripción pendiente';
            team.status = 'pending';
            team.enrollment = { status: 'invited', contact: '', notes: '', submittedAt: '', reviewNotes: '' };
          } else {
            if (
              !old.enrollment ||
              old.managerIdentification !== team.managerIdentification ||
              old.managerId !== team.managerId
            )
              throw new ConflictException(
                'La identidad del manager no se sustituye desde el plan. Retira la inscripción y crea una nueva para otra persona.'
              );
            if (old.name !== team.name || JSON.stringify(old.enrollment) !== JSON.stringify(team.enrollment))
              throw new ForbiddenException(
                'El nombre y los detalles de esta inscripción los prepara su manager. Recarga el torneo.'
              );
            team.enrollment = { ...old.enrollment };
          }
        }
        team.rosterStatus = old?.rosterStatus ?? 'pending';
        team.rosterSignature = old?.rosterSignature ?? '';
      }
      if (input.action === 'approve-roster' || input.action === 'reject-roster') {
        if (!previous) throw new ConflictException('Guarda el torneo y asigna el manager antes de revisar su roster.');
        const team = doc.teams.find((team) => team.id === input.teamId);
        if (!team) throw new BadRequestException('Selecciona el equipo.');
        if (team.enrollment && team.enrollment.status !== 'submitted')
          throw new ConflictException('El manager debe enviar su inscripción y roster antes de revisarlos.');
        if (input.action === 'approve-roster') {
          const current = this.signature(doc.id, team.id);
          if (!current.members.some((member) => member.role === 'PLAYER'))
            throw new ConflictException(
              'El roster no tiene jugadores. El manager debe prepararlo primero desde ROSTER.'
            );
          team.rosterStatus = 'approved';
          team.rosterSignature = current.signature;
          if (team.enrollment) team.status = 'accepted';
        } else {
          team.rosterStatus = 'rejected';
          team.rosterSignature = '';
          if (team.enrollment) {
            team.enrollment.status = 'changes-requested';
            if (!input.reviewNote) throw new BadRequestException('Explica qué debe corregir el manager.');
            team.enrollment.reviewNotes = input.reviewNote;
          }
        }
      }
      if (previous?.public && doc.status === 'draft')
        throw new ConflictException(
          'Un torneo publicado no vuelve a borrador. Puedes suspenderlo o cancelarlo sin borrar su historial.'
        );
      if (input.action === 'publish' && doc.status === 'draft') doc.status = 'registration';
      next = {
        document: doc,
        revision: (previous?.revision ?? 0) + 1,
        public: previous?.public === true || input.action === 'publish',
        updatedAt: new Date(this.now()).toISOString()
      };
      if (this.scoring.organizerFreeAccess(account.id).tournamentId === doc.id &&
          !estimateTournamentCapacity(doc, this.scoring.organizerGameUsage(doc.id)).freeEligible)
        throw new ForbiddenException({ code: 'ORGANIZER_FREE_LIMIT',
          message: 'El torneo reservado debe mantenerse entre 2 y 5 equipos y hasta 13 partidos. Antes de jugar puedes liberar la reserva para planificar otra capacidad.' });
      this.scoring.validatePlannedTournament(doc, previous?.document, organizerId);
      this.validatePlanningSchedule(doc, organizerId);
      for (const actor of this.scoring.plannedActors(doc, organizerId))
        this.db
          .prepare(
            'INSERT INTO tournament_actors VALUES(?,?,?) ON CONFLICT(tournament_id,actor_id) DO UPDATE SET identification=excluded.identification'
          )
          .run(doc.id, actor.actorId, actor.identification);
      this.db
        .prepare(
          `INSERT INTO tournaments(id,account_id,document,revision,published,updated_at,organizer_actor_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,revision=excluded.revision,published=excluded.published,updated_at=excluded.updated_at`
        )
        .run(doc.id, account.id, JSON.stringify(doc), next.revision, next.public ? 1 : 0, next.updatedAt, organizerId);
      if (!previous && organizerId !== 'org-demo')
        this.db.prepare('INSERT INTO tournament_capacity(tournament_id,account_id) VALUES(?,?)').run(doc.id, account.id);
      this.db
        .prepare('INSERT INTO tournament_commands VALUES(?,?,?,?,?)')
        .run(account.id, input.requestId, hash, doc.id, next.revision);
      this.db
        .prepare('INSERT INTO tournament_history VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), doc.id, account.id, input.action, next.revision, next.updatedAt, JSON.stringify(doc));
      this.db.exec('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) this.db.exec('ROLLBACK');
      throw error;
    }
    this.scoring.projectPlannedTournament(next.document, next.public, this.organizerActor(next.document.id));
    return { record: next, appliedRevision: next.revision, replayed: false };
  }
}
