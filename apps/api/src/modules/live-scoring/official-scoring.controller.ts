import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse
} from '@nestjs/common';
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

type AppRole = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';

type OfficialActorRole = 'organizer' | 'scorekeeper';

type SubscriptionTier = 'free' | 'paid';

type TournamentAuthorizationBody = {
  organizerId: string;
  scorekeeperIds: string[];
  subscriptionTier?: SubscriptionTier;
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
export class OfficialScoringController {
  constructor(private readonly officialScoringService: OfficialScoringService) {}

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
      subscriptionTier: body.subscriptionTier
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
    @Query('userId') userId: string, @Query('role') role: AppRole): Observable<MessageEvent> {
    return this.officialScoringService.createTeamSheetStream(gameId, this.requireQuery(tournamentId, 'tournamentId'),
      this.requireQuery(userId, 'userId'), this.requireRole(role)).pipe(map((data) => ({ data })));
  }

  @Post('games/:gameId/team-sheets/:teamId/requests')
  requestPersonnelChange(@Param('gameId') gameId: string, @Param('teamId') teamId: string,
    @Body() body: { tournamentId: string; managerId: string; expectedRevision: number; action: unknown }) {
    return this.officialScoringService.requestPersonnelChange({ ...body, gameId, teamId });
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
      regulationInnings: body.regulationInnings, lastErrorOuts: body.lastErrorOuts
    };

    return this.officialScoringService.submitOfficialUpdate(command);
  }

  @Sse('games/:gameId/stream')
  streamGame(
    @Param('gameId') gameId: string,
    @Query('tournamentId') tournamentId: string
  ): Observable<MessageEvent> {
    return this.officialScoringService
      .createGameStream(gameId, this.requireQuery(tournamentId, 'tournamentId'))
      .pipe(map((event: OfficialScoringStreamPayload) => ({ type: event.kind, data: event })));
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
