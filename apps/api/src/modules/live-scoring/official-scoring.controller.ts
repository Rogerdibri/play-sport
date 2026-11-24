import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Optional,
  ForbiddenException,
  Sse,
  UseGuards
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AccountsService } from '../accounts/accounts.service';
import { accountToken } from '../accounts/account-http';
import { hasAccountFeature } from '@playsport/shared';
import { Observable, map } from 'rxjs';
import type { PresentOfficial, RunReview } from '@playsport/shared';
import {
  GameAuthorizationCommand,
  GameLineupCommand,
  GamePermissionsInput,
  GameTeamsCommand,
  OfficialScoringPatch,
  OfficialScoringService,
  OfficialScoringStreamPayload,
  OfficialUpdateCommand,
  PlayEventInput,
  PlateAppearanceInput,
  RegisterGlobalPlayerCommand,
  RegisterTournamentPlayerCommand,
  TournamentAuthorizationCommand,
  TournamentSubscriptionCommand,
  TournamentTeamRosterCommand
} from './official-scoring.service';
import { SportingAccountGuard, type ScorekeeperScopedRequest } from './sporting-account.guard';

type AppRole = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';

type OfficialActorRole = 'organizer' | 'scorekeeper';

type SubscriptionTier = 'free' | 'paid';

type TournamentAuthorizationBody = {
  organizerId: string;
  scorekeeperIds: string[];
  organizerIdentificationNumber?: string;
  scorekeeperIdentities?: Array<{ actorId: string; identificationNumber: string }>;
  subscriptionTier?: SubscriptionTier;
  rosterRules?: unknown;
};

type TournamentSubscriptionBody = {
  organizerId: string;
  subscriptionTier: SubscriptionTier;
};

type PlayerExtraProfileBody = {
  birthDate?: string;
  phone?: string;
  email?: string;
  city?: string;
  notes?: string;
};

type GlobalPlayerBody = {
  actorId: string;
  displayName: string;
  identificationNumber: string;
  isMinor?: boolean;
  representativeIdentificationNumber?: string;
  extraProfile?: PlayerExtraProfileBody;
};

type TournamentPlayerBody = {
  organizerId: string;
  displayName: string;
  identificationNumber: string;
  isMinor?: boolean;
  representativeIdentificationNumber?: string;
  extraProfile?: PlayerExtraProfileBody;
};

type TournamentTeamRosterBody = {
  organizerId?: string;
  managerId: string;
  managerIdentificationNumber?: string;
  playerIdentificationNumbers?: string[];
  playerIds?: string[];
};

type GameAuthorizationBody = {
  tournamentId: string;
  organizerId: string;
  scorekeeperIds: string[];
};

type GameTeamsBody = {
  tournamentId: string;
  organizerId: string;
  homeTeamId: string;
  awayTeamId: string;
};

type GameLineupBody = {
  tournamentId: string;
  teamId: string;
  managerId: string;
  playerIdentificationNumbers?: string[];
  playerIds?: string[];
  courtesyRunnerSource?: 'BENCH' | 'ROSTER';
  presentSubstituteIdentificationNumbers?: string[];
  presentOfficials?: PresentOfficial[];
  lineupEntries?: Array<{
    identificationNumber?: string;
    playerIdentificationNumber?: string;
    playerId?: string;
    battingOrder: number | null;
    fieldPosition: string;
    lineupRole?: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
    jerseyNumber?: string;
  }>;
};

type PlateAppearanceBody = {
  teamId?: string;
  batterIdentificationNumber?: string;
  batterId?: string;
  result: string;
};

type PlayEventBody = {
  type?: string;
  eventType?: string;
  teamId?: string;
  offenseTeamId?: string;
  batterIdentificationNumber?: string;
  batterId?: string;
  pitcherIdentificationNumber?: string;
  pitcherId?: string;
  runnerIdentificationNumber?: string;
  runnerId?: string;
  fielderIdentificationNumber?: string;
  fielderId?: string;
  fromBase?: number;
  toBase?: number;
  runsScored?: number;
  outsRecorded?: number;
  errorOuts?: number;
  note?: string;
};

type OfficialUpdateBody = {
  clockAction?: unknown;
  tournamentId: string;
  actorId: string;
  actorRole: OfficialActorRole;
  sourceProfile?: OfficialActorRole;
  note?: string;
  patch?: OfficialScoringPatch;
  plateAppearance?: PlateAppearanceBody;
  playEvent?: PlayEventBody;
  runReview?: RunReview;
  expectedOfficialVersion?: number;
  scorecardCommand?: unknown;
  undoLast?: boolean;
  regulationInnings?: 7 | 9;
  lastErrorOuts?: number | null;
};

@Controller('official-scoring')
@UseGuards(SportingAccountGuard)
export class OfficialScoringController {
  private readonly officialScoringService: OfficialScoringService;
  constructor(officialScoringService: OfficialScoringService, @Optional() private readonly accounts?: AccountsService) {
    this.officialScoringService = officialScoringService;
  }

  @Post('players')
  registerGlobalPlayer(@Body() body: GlobalPlayerBody) {
    const command: RegisterGlobalPlayerCommand = {
      actorId: body.actorId,
      player: {
        displayName: body.displayName,
        identificationNumber: body.identificationNumber,
        isMinor: body.isMinor,
        representativeIdentificationNumber: body.representativeIdentificationNumber,
        extraProfile: body.extraProfile
      }
    };

    return this.officialScoringService.registerGlobalPlayer(command);
  }

  @Get('players')
  getGlobalPlayers(
    @Query('visibility') visibility?: string,
    @Query('tournamentId') tournamentId?: string
  ) {
    return this.officialScoringService.getGlobalPlayers(visibility, tournamentId);
  }

  @Post('tournaments/:tournamentId/authorization')
  configureTournamentAuthorization(
    @Param('tournamentId') tournamentId: string,
    @Body() body: TournamentAuthorizationBody
  ) {
    const command: TournamentAuthorizationCommand = {
      tournamentId,
      organizerId: body.organizerId,
      scorekeeperIds: body.scorekeeperIds ?? [],
      organizerIdentificationNumber: body.organizerIdentificationNumber,
      scorekeeperIdentities: body.scorekeeperIdentities,
      subscriptionTier: body.subscriptionTier,
      rosterRules: body.rosterRules
    };

    return this.officialScoringService.configureTournamentAuthorization(command);
  }

  @Post('tournaments/:tournamentId/subscription')
  configureTournamentSubscription(
    @Param('tournamentId') tournamentId: string,
    @Body() body: TournamentSubscriptionBody
  ) {
    const command: TournamentSubscriptionCommand = {
      tournamentId,
      organizerId: body.organizerId,
      subscriptionTier: body.subscriptionTier
    };

    return this.officialScoringService.configureTournamentSubscription(command);
  }

  @Post('tournaments/:tournamentId/rules')
  configureTournamentRules(
    @Param('tournamentId') tournamentId: string,
    @Body() body: { organizerId: string; courtesyRunnerSource: 'BENCH' | 'ROSTER' }
  ) {
    return this.officialScoringService.configureTournamentRules({ ...body, tournamentId });
  }

  @Get('tournaments/:tournamentId/authorization')
  getTournamentAuthorization(@Param('tournamentId') tournamentId: string) {
    return this.officialScoringService.getTournamentAuthorization(tournamentId);
  }

  @Post('tournaments/:tournamentId/players')
  registerTournamentPlayer(
    @Param('tournamentId') tournamentId: string,
    @Body() body: TournamentPlayerBody
  ) {
    const command: RegisterTournamentPlayerCommand = {
      tournamentId,
      organizerId: body.organizerId,
      player: {
        displayName: body.displayName,
        identificationNumber: body.identificationNumber,
        isMinor: body.isMinor,
        representativeIdentificationNumber: body.representativeIdentificationNumber,
        extraProfile: body.extraProfile
      }
    };

    return this.officialScoringService.registerTournamentPlayer(command);
  }

  @Get('tournaments/:tournamentId/players')
  getTournamentPlayers(
    @Param('tournamentId') tournamentId: string,
    @Query('visibility') visibility?: string
  ) {
    return this.officialScoringService.getTournamentPlayers(tournamentId, visibility);
  }

  @Post('tournaments/:tournamentId/teams/:teamId/roster')
  configureTournamentTeamRoster(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Body() body: TournamentTeamRosterBody
  ) {
    const command: TournamentTeamRosterCommand = {
      tournamentId,
      teamId,
      organizerId: body.organizerId,
      managerId: body.managerId,
      managerIdentificationNumber: body.managerIdentificationNumber,
      playerIdentificationNumbers: body.playerIdentificationNumbers ?? body.playerIds ?? []
    };

    return this.officialScoringService.configureTournamentTeamRoster(command);
  }

  @Get('tournaments/:tournamentId/teams/rosters')
  getTournamentTeamRosters(
    @Param('tournamentId') tournamentId: string,
    @Query('visibility') visibility?: string
  ) {
    return this.officialScoringService.getTournamentTeamRosters(tournamentId, visibility);
  }

  @Get('tournaments/:tournamentId/teams/:teamId/roster')
  getTournamentTeamRoster(
    @Param('tournamentId') tournamentId: string,
    @Param('teamId') teamId: string,
    @Query('visibility') visibility?: string
  ) {
    return this.officialScoringService.getTournamentTeamRoster(tournamentId, teamId, visibility);
  }

  @Get('games')
  listOfficialGames(@Query('userId') userId: string, @Query('role') role: string, @Req() req: IncomingMessage) {
    const snapshot = this.officialScoringService.listOfficialGames(this.requireQuery(userId, 'userId'), this.requireRole(role));
    if (this.accounts && userId.startsWith('person:') && role === 'organizer') {
      this.accounts.authenticate(accountToken(req));
      return { ...snapshot, games: snapshot.games.map(game => {
        const allowed = this.officialScoringService.organizerGameOperationAllowed(game.tournamentId, game.gameId);
        return { ...game, canOperate: allowed, ...(!allowed ? { organizerCapacityBlocked: true } : {}) };
      }) };
    }
    if (this.accounts && userId.startsWith('person:') && (role === 'manager' || role === 'scorekeeper')) {
      const account = this.accounts.authenticate(accountToken(req));
      const scorer = role === 'scorekeeper' ? this.accounts.scorekeeperAccess(account, this.officialScoringService.scorekeeperTournaments(userId)) : null;
      const manager = role === 'manager' ? this.accounts.managerTeamAccess(account, this.officialScoringService.managerPlanTeams(userId, account.id)) : null;
      return { ...snapshot, games: snapshot.games.map(game => {
        const startedAt = this.officialScoringService.gameOperationStartedAt(game.tournamentId, game.gameId);
        const scoped = scorer ? scorer.tournaments.some(tournament => tournament.tournamentId === game.tournamentId && tournament.enabled) ||
          scorer.extras.some(extra => extra.tournamentId === game.tournamentId && extra.gameId === game.gameId && extra.status === 'granted') :
          manager?.teams.some(team => team.tournamentId === game.tournamentId && team.teamId === game.managerTeamId && team.managed);
        const capacityAllowed = role === 'manager' || this.officialScoringService.organizerGameOperationAllowed(game.tournamentId, game.gameId);
        return { ...game, ...(!capacityAllowed ? { organizerCapacityBlocked: true } : {}),
          canOperate: capacityAllowed && (role === 'scorekeeper' && this.officialScoringService.isScorekeeperSubstitute(userId, game.tournamentId, game.gameId) ||
          Boolean((scoped || this.accounts!.roleContinuationAllowed(account, role, startedAt)) &&
            this.accounts!.roleOperationAllowed(account, role, startedAt))) };
      }) };
    }
    return snapshot;
  }

  @Get('standings')
  officialStandings() {
    return this.officialScoringService.getOfficialStandings();
  }

  @Get('discovery')
  sportsTournaments() {
    return this.officialScoringService.publicSportsTournaments();
  }

  @Post('games/:gameId/protest')
  declareProtest(@Param('gameId') gameId: string,
    @Body() body: { tournamentId: string; actorId: string; actorRole: string; expectedOfficialVersion: number; teamId: string; reason: string }) {
    return this.officialScoringService.declareGameProtest({ ...body, gameId });
  }

  @Post('games/:gameId/suspension')
  suspendGame(@Param('gameId') gameId: string, @Body() body: {
    tournamentId: string; actorId: string; actorRole: string; expectedOfficialVersion: number; cause: unknown; scoreHandling: unknown; reason: string;
  }) { return this.officialScoringService.suspendGame({ ...body, gameId }); }

  @Post('games/:gameId/reschedule')
  rescheduleGame(@Param('gameId') gameId: string, @Body() body: {
    tournamentId: string; organizerId: string; expectedOfficialVersion: number; date: string; time: string;
  }) { return this.officialScoringService.rescheduleGame({ ...body, gameId }); }

  @Get('games/:gameId/suspension-archive')
  suspensionArchive(@Param('gameId') gameId: string, @Query('tournamentId') tournamentId: string, @Query('id') id?: string) {
    return this.officialScoringService.suspensionArchive(gameId, this.requireQuery(tournamentId, 'tournamentId'), id);
  }

  @Post('games/:gameId/protest/decision')
  resolveProtest(@Param('gameId') gameId: string,
    @Body() body: { tournamentId: string; organizerId: string; expectedOfficialVersion: number; winnerTeamId: string; reason: string; recordReference: string }) {
    return this.officialScoringService.resolveGameProtest({ ...body, gameId });
  }

  @Post('games/:gameId/details')
  configureGameDetails(@Param('gameId') gameId: string,
    @Body() body: { tournamentId: string; organizerId: string; details: unknown }) {
    return this.officialScoringService.configureGameDetails({ ...body, gameId });
  }

  @Post('games/:gameId/authorization')
  configureGameAuthorization(@Param('gameId') gameId: string, @Body() body: GameAuthorizationBody) {
    const command: GameAuthorizationCommand = {
      gameId,
      tournamentId: body.tournamentId,
      organizerId: body.organizerId,
      scorekeeperIds: body.scorekeeperIds ?? []
    };

    return this.officialScoringService.configureGameAuthorization(command);
  }

  @Get('games/:gameId/authorization')
  getGameAuthorization(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string
  ) {
    return this.officialScoringService.getGameAuthorization(gameId, this.requireQuery(tournamentId, 'tournamentId'));
  }

  @Post('games/:gameId/teams')
  configureGameTeams(@Param('gameId') gameId: string, @Body() body: GameTeamsBody) {
    const command: GameTeamsCommand = {
      gameId,
      tournamentId: body.tournamentId,
      organizerId: body.organizerId,
      homeTeamId: body.homeTeamId,
      awayTeamId: body.awayTeamId
    };

    return this.officialScoringService.configureGameTeams(command);
  }

  @Post('games/:gameId/teams/:teamId/representative')
  authorizeFieldRepresentative(
    @Param('gameId') gameId: string,
    @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; managerId: string; identificationNumber: string }
  ) {
    return this.officialScoringService.authorizeFieldRepresentative({
      gameId, teamId,
      tournamentId: body.tournamentId,
      managerId: body.managerId,
      identificationNumber: body.identificationNumber
    });
  }

  @Get('games/:gameId/teams/:teamId/representative')
  getFieldRepresentative(
    @Param('gameId') gameId: string,
    @Param('teamId') teamId: string,
    @Query('tournamentId') tournamentId: string
  ) {
    return this.officialScoringService.getFieldRepresentative(
      gameId, this.requireQuery(tournamentId, 'tournamentId'), teamId
    );
  }

  @Post('games/:gameId/lineups')
  configureGameLineup(@Param('gameId') gameId: string, @Body() body: GameLineupBody) {
    const lineupEntries = body.lineupEntries?.map((entry) => ({
      identificationNumber:
        entry.identificationNumber ?? entry.playerIdentificationNumber ?? entry.playerId ?? '',
      battingOrder: entry.battingOrder,
      fieldPosition: entry.fieldPosition,
      lineupRole: entry.lineupRole,
      jerseyNumber: entry.jerseyNumber
    }));

    const command: GameLineupCommand = {
      gameId,
      tournamentId: body.tournamentId,
      teamId: body.teamId,
      managerId: body.managerId,
      playerIdentificationNumbers: body.playerIdentificationNumbers ?? body.playerIds ?? [],
      courtesyRunnerSource: body.courtesyRunnerSource,
      presentSubstituteIdentificationNumbers: body.presentSubstituteIdentificationNumbers,
      presentOfficials: body.presentOfficials,
      lineupEntries
    };

    return this.officialScoringService.configureGameLineup(command);
  }

  @Get('games/:gameId/lineups')
  getGameLineups(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string,
    @Query('visibility') visibility?: string
  ) {
    return this.officialScoringService.getGameLineups(
      gameId,
      this.requireQuery(tournamentId, 'tournamentId'),
      visibility
    );
  }

  @Get('games/:gameId/team-sheets')
  getTeamSheets(@Param('gameId') gameId: string, @Query('tournamentId') tournamentId: string,
    @Query('userId') userId: string, @Query('role') role: AppRole) {
    return this.officialScoringService.getTeamSheets(gameId, this.requireQuery(tournamentId, 'tournamentId'),
      this.requireQuery(userId, 'userId'), this.requireRole(role));
  }

  @Sse('games/:gameId/team-sheets/stream')
  streamTeamSheets(@Param('gameId') gameId: string, @Query('tournamentId') tournamentId: string,
    @Query('userId') userId: string, @Query('role') role: AppRole, @Req() req?: ScorekeeperScopedRequest): Observable<MessageEvent> {
    return this.officialScoringService.createTeamSheetStream(gameId, this.requireQuery(tournamentId, 'tournamentId'),
      this.requireQuery(userId, 'userId'), this.requireRole(role)).pipe(map((data) => {
        req?.assertScorekeeperAccess?.();
        return { data };
      }));
  }

  @Post('games/:gameId/team-sheets/:teamId/requests')
  requestPersonnelChange(@Param('gameId') gameId: string, @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; managerId: string; expectedRevision: number; action: unknown }) {
    return this.officialScoringService.requestPersonnelChange({ ...body, gameId, teamId });
  }

  @Post('games/:gameId/team-sheets/:teamId/withdraw')
  withdrawTeamSheet(@Param('gameId') gameId: string, @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; managerId: string; expectedRevision: number; expectedVersion: number }) {
    return this.officialScoringService.withdrawTeamSheet({ ...body, gameId, teamId });
  }

  @Post('games/:gameId/personnel-requests/:requestId/decision')
  decidePersonnelChange(@Param('gameId') gameId: string, @Param('requestId') requestId: string,
    @Body() body: { tournamentId: string; actorId: string; actorRole: AppRole; decision: 'approve' | 'reject'; expectedRevision: number; note?: string }) {
    return this.officialScoringService.decidePersonnelChange({ ...body, gameId, requestId });
  }

  @Post('games/:gameId/team-sheets/:teamId/official-changes')
  recordPersonnelChange(@Param('gameId') gameId: string, @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; actorId: string; actorRole: AppRole;
      expectedRevision: number; expectedOfficialVersion: number; action: unknown }) {
    return this.officialScoringService.recordPersonnelChange({ ...body, gameId, teamId });
  }

  @Get('games/:gameId/permissions')
  getGamePermissions(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string,
    @Query('userId') userId: string,
    @Query('role') role: AppRole
  ) {
    const command: GamePermissionsInput = {
      gameId,
      tournamentId: this.requireQuery(tournamentId, 'tournamentId'),
      userId: this.requireQuery(userId, 'userId'),
      role: this.requireRole(role)
    };

    return this.officialScoringService.getGamePermissions(command);
  }

  @Get('games/:gameId/state')
  getOfficialState(@Param('gameId') gameId: string, @Query('tournamentId') tournamentId: string) {
    return this.officialScoringService.getOfficialState(gameId, this.requireQuery(tournamentId, 'tournamentId'));
  }

  @Get('games/:gameId/final-report')
  @Header('Cache-Control', 'private, no-store')
  gameReport(@Param('gameId') gameId: string, @Query() query: Record<string, unknown>, @Req() req: IncomingMessage) {
    if (Object.keys(query).some(key => !['tournamentId', 'role'].includes(key)) ||
        query.role !== undefined && query.role !== 'scorekeeper')
      throw new BadRequestException('El resumen no admite parámetros de identidad, permisos o plan.');
    if (typeof query.tournamentId !== 'string') throw new BadRequestException('Falta tournamentId.');
    const tournamentId = this.requireQuery(query.tournamentId, 'tournamentId');
    const token = accountToken(req);
    if (token && !this.accounts) throw new ForbiddenException('El acceso de cuenta no está configurado.');
    let detailed = false;
    if (token) {
      const account = this.accounts!.authenticate(token);
      if (query.role === 'scorekeeper') {
        if (account.identity?.status !== 'verified' || !account.identity.actorId)
          throw new ForbiddenException('Verifica tu identidad como Anotador.');
        if (!this.officialScoringService.isScorekeeperSubstitute(account.identity.actorId, tournamentId, gameId))
          this.accounts!.assertScorekeeperAccess(account, this.officialScoringService.scorekeeperTournaments(account.identity.actorId),
          tournamentId, this.officialScoringService.scorekeeperGameAssigned(account.identity.actorId, tournamentId, gameId) ? gameId : undefined);
        detailed = hasAccountFeature(account, 'scorekeeper-box-score');
      } else detailed = hasAccountFeature(account, 'final-report-details');
    } else if (query.role === 'scorekeeper') throw new ForbiddenException('Inicia sesión para consultar el resumen de Anotador.');
    return this.officialScoringService.gameReport(gameId, tournamentId, detailed);
  }

  @Get('games/:gameId/play-by-play')
  getGamePlayByPlay(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string,
    @Query('visibility') visibility?: string
  ) {
    return this.officialScoringService.getGamePlayByPlay(
      gameId,
      this.requireQuery(tournamentId, 'tournamentId'),
      visibility
    );
  }

  @Post('games/:gameId/official-updates')
  submitOfficialUpdate(@Param('gameId') gameId: string, @Body() body: OfficialUpdateBody) {
    const plateAppearance: PlateAppearanceInput | undefined = body.plateAppearance
      ? {
          teamId: body.plateAppearance.teamId,
          batterIdentificationNumber:
            body.plateAppearance.batterIdentificationNumber ?? body.plateAppearance.batterId,
          batterId: body.plateAppearance.batterId,
          result: body.plateAppearance.result
        }
      : undefined;

    const playEvent: PlayEventInput | undefined = body.playEvent
      ? {
          type: (body.playEvent.type ?? body.playEvent.eventType ?? '') as PlayEventInput['type'],
          teamId: body.playEvent.teamId ?? body.playEvent.offenseTeamId,
          batterIdentificationNumber:
            body.playEvent.batterIdentificationNumber ?? body.playEvent.batterId,
          pitcherIdentificationNumber:
            body.playEvent.pitcherIdentificationNumber ?? body.playEvent.pitcherId,
          runnerIdentificationNumber:
            body.playEvent.runnerIdentificationNumber ?? body.playEvent.runnerId,
          fielderIdentificationNumber:
            body.playEvent.fielderIdentificationNumber ?? body.playEvent.fielderId,
          fromBase: body.playEvent.fromBase,
          toBase: body.playEvent.toBase,
          runsScored: body.playEvent.runsScored,
          outsRecorded: body.playEvent.outsRecorded,
          errorOuts: body.playEvent.errorOuts,
          note: body.playEvent.note
        }
      : undefined;

    const command: OfficialUpdateCommand = {
      gameId,
      tournamentId: body.tournamentId,
      actorId: body.actorId,
      actorRole: body.actorRole,
      sourceProfile: body.sourceProfile,
      note: body.note,
      patch: body.patch ?? {},
      plateAppearance,
      playEvent,
      runReview: body.runReview,
      expectedOfficialVersion: body.expectedOfficialVersion,
      scorecardCommand: body.scorecardCommand, undoLast: body.undoLast,
      regulationInnings: body.regulationInnings, lastErrorOuts: body.lastErrorOuts, clockAction: body.clockAction
    };

    return this.officialScoringService.submitOfficialUpdate(command);
  }

  @Sse('games/:gameId/stream')
  streamGame(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string,
    @Req() req?: ScorekeeperScopedRequest
  ): Observable<MessageEvent> {
    return this.officialScoringService
      .createGameStream(gameId, this.requireQuery(tournamentId, 'tournamentId'))
      .pipe(map((event: OfficialScoringStreamPayload) => {
        req?.assertScorekeeperAccess?.();
        return { type: event.kind, data: event };
      }));
  }

  private requireQuery(value: string, field: string) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${field} es requerido.`);
    }

    return normalized;
  }

  private requireRole(role: string): AppRole {
    const accepted: AppRole[] = ['fan', 'player', 'manager', 'organizer', 'scorekeeper', 'scout'];
    if (accepted.includes(role as AppRole)) {
      return role as AppRole;
    }

    throw new BadRequestException(`role invalido. Valores permitidos: ${accepted.join(', ')}.`);
  }
}
