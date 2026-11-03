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
  lineupEntries?: Array<{
    identificationNumber?: string;
    playerIdentificationNumber?: string;
    playerId?: string;
    battingOrder: number;
    fieldPosition: string;
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

  @Post('games/:gameId/lineups')
  configureGameLineup(@Param('gameId') gameId: string, @Body() body: GameLineupBody) {
    const lineupEntries = body.lineupEntries?.map((entry) => ({
      identificationNumber:
        entry.identificationNumber ?? entry.playerIdentificationNumber ?? entry.playerId ?? '',
      battingOrder: entry.battingOrder,
      fieldPosition: entry.fieldPosition
    }));

    const command: GameLineupCommand = {
      gameId,
      tournamentId: body.tournamentId,
      teamId: body.teamId,
      managerId: body.managerId,
      playerIdentificationNumbers: body.playerIdentificationNumbers ?? body.playerIds ?? [],
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
      playEvent
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
