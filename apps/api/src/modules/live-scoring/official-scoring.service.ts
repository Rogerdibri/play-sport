import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PersonnelAction, PersonnelRequest, PresentOfficial, TeamSheetPlayer, TeamSheetsSnapshot } from '@playsport/shared';
import {
  accountRuns, createRunAccounting, findDuplicateFieldPosition, lineupFieldPositions,
  reviewAccountedRun, runTotals, validRunEvidence, validRunReview,
  applyPrivateCommand, isScorecardCommand, minimumDestinations,
  type AccountedRun, type RunAccounting, type RunReview, type PrivateCommand,
  type PrivateState, type PrivatePlayer, type PrivateLog, type PlayResult
} from '@playsport/shared';
import { Observable, Subject } from 'rxjs';

type OfficialActorRole = 'organizer' | 'scorekeeper';

type AppRole = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';

type OfficialGameStatus = 'scheduled' | 'in_progress' | 'final';

type SubscriptionTier = 'free' | 'paid';

export type PlayEventType =
  | 'STRIKE'
  | 'BALL'
  | 'FOUL'
  | 'WALK'
  | 'HIT_BY_PITCH'
  | 'HIT_SINGLE'
  | 'HIT_DOUBLE'
  | 'HIT_TRIPLE'
  | 'HOME_RUN'
  | 'STRIKEOUT'
  | 'OUT'
  | 'GROUND_OUT'
  | 'FLY_OUT'
  | 'LINE_OUT'
  | 'SACRIFICE_FLY'
  | 'STEAL_BASE'
  | 'CAUGHT_STEALING'
  | 'WILD_PITCH'
  | 'PASSED_BALL'
  | 'RUN_SCORED'
  | 'COURTESY_RUNNER'
  | 'ERROR'
  | 'ERROR_ADVANCE'
  | 'RUNNER_ADVANCE'
  | 'DROPPED_FOUL'
  | 'DOUBLE_PLAY'
  | 'TRIPLE_PLAY'
  | 'FORCE_OUT'
  | 'PICKOFF'
  | 'BALK'
  | 'BUNT'
  | 'RUNNER_OUT';

export type PlayEventInput = {
  type: PlayEventType;
  teamId?: string;
  batterIdentificationNumber?: string;
  pitcherIdentificationNumber?: string;
  runnerIdentificationNumber?: string;
  fielderIdentificationNumber?: string;
  fromBase?: number;
  toBase?: number;
  runsScored?: number;
  outsRecorded?: number;
  note?: string;
  errorOuts?: number;
};

export type OfficialScoringPatch = {
  inning?: number;
  outs?: number;
  balls?: number;
  strikes?: number;
  homeScore?: number;
  awayScore?: number;
  status?: OfficialGameStatus;
  lastPlay?: string;
  offenseTeamId?: string | null;
  lastBatterId?: string | null;
  nextBatterId?: string | null;
  lastBatterIdentificationNumber?: string | null;
  nextBatterIdentificationNumber?: string | null;
};

export type PlateAppearanceInput = {
  teamId?: string;
  batterId?: string;
  batterIdentificationNumber?: string;
  result: string;
};

export type TournamentPlayerExtraProfileInput = {
  birthDate?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  notes?: string | null;
};

export type TournamentPlayerInput = {
  displayName: string;
  identificationNumber: string;
  isMinor?: boolean;
  representativeIdentificationNumber?: string;
  extraProfile?: TournamentPlayerExtraProfileInput;
};

type RegisteredPlayerRecord = {
  displayName: string;
  identificationNumber: string;
  isMinor: boolean;
  representativeIdentificationNumber: string | null;
  extraProfile: TournamentPlayerExtraProfileInput;
  createdAt: string;
  updatedAt: string;
  createdById: string;
};

type TournamentTeamRosterRecord = {
  tournamentId: string;
  teamId: string;
  managerId: string;
  playerIdentificationNumbers: Set<string>;
  updatedAt: string;
};

type TournamentAuthorizationRecord = {
  tournamentId: string;
  courtesyRunnerSource: 'BENCH' | 'ROSTER';
  organizerId: string;
  subscriptionTier: SubscriptionTier;
  authorizedScorekeepers: Set<string>;
  teamRosters: Map<string, TournamentTeamRosterRecord>;
  updatedAt: string;
};

type OfficialGameState = {
  inning: number;
  outs: number;
  balls: number;
  strikes: number;
  homeScore: number;
  awayScore: number;
  status: OfficialGameStatus;
  lastPlay: string;
  offenseTeamId: string | null;
  lastBatterId: string | null;
  nextBatterId: string | null;
  officialVersion: number;
  updatedAt: string;
  updatedBy: { id: string; role: OfficialActorRole } | null;
};

type LineupEntryRecord = {
  identificationNumber: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string | null;
};

type GameLineupRecord = {
  teamId: string;
  managerId: string;
  playerIdentificationNumbers: string[];
  lineupEntries: LineupEntryRecord[];
  currentBatterIndex: number;
  updatedAt: string;
};

type BaseRunnersRecord = {
  first: string | null;
  second: string | null;
  third: string | null;
};

type BatterStatsRecord = {
  plateAppearances: number;
  atBats: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  hitByPitch: number;
  strikeouts: number;
  runs: number;
  rbis: number;
  outs: number;
  stolenBases: number;
  caughtStealing: number;
  reachedOnError: number;
};

type PitcherStatsRecord = {
  pitches: number;
  battersFaced: number;
  strikes: number;
  balls: number;
  hitsAllowed: number;
  runsAllowed: number;
  walksAllowed: number;
  strikeouts: number;
  outsRecorded: number;
  homeRunsAllowed: number;
  stolenBasesAllowed: number;
};

type FieldingStatsRecord = {
  outsRecorded: number;
  errors: number;
};

type OfficialPlayEventRecord = {
  sequence: number;
  inning: number;
  type: PlayEventType;
  battingTeamId: string;
  offenseTeamId: string;
  defenseTeamId: string | null;
  batterIdentificationNumber: string | null;
  pitcherIdentificationNumber: string | null;
  runnerIdentificationNumber: string | null;
  fielderIdentificationNumber: string | null;
  fromBase: number | null;
  toBase: number | null;
  runsScored: number;
  outsRecorded: number;
  ballsAfter: number;
  strikesAfter: number;
  outsAfter: number;
  inningAfter: number;
  homeScoreAfter: number;
  awayScoreAfter: number;
  description: string;
  note: string | null;
  timestamp: string;
  errorOuts: number | null;
  scoredRunnerIds: string[];
};

type CompletedPlateAppearanceRecord = {
  sequence: number;
  inning: number;
  offenseTeamId: string;
  batterIdentificationNumber: string;
  result: string;
  description: string;
  runsScored: number;
};

type PlayByPlayRecord = {
  scorecardLog: PrivateLog[];
  courtesyFor: Record<string, string>;
  sequence: number;
  plateAppearanceSequence: number;
  plateAppearances: CompletedPlateAppearanceRecord[];
  baseRunners: BaseRunnersRecord;
  batterStatsByIdentification: Map<string, BatterStatsRecord>;
  pitcherStatsByIdentification: Map<string, PitcherStatsRecord>;
  fieldingStatsByIdentification: Map<string, FieldingStatsRecord>;
  events: OfficialPlayEventRecord[];
  runAccounting: RunAccounting;
};

type FieldRepresentativeRecord = {
  identificationNumber: string;
  authorizedByManagerId: string;
  authorizedAt: string;
};

type FieldRepresentativeProjection = FieldRepresentativeRecord & {
  displayName: string;
};

type OfficialGameRecord = {
  regulationInnings?: 7 | 9;
  scoringHistory: Array<{
    state: OfficialGameState;
    playByPlay: PlayByPlayRecord;
    indexes: Map<string, number>;
    command?: PrivateCommand;
  }>;
  gameId: string;
  tournamentId: string;
  hasGameScopedAuthorization: boolean;
  gameAuthorizedScorekeepers: Set<string>;
  teams: { homeTeamId: string; awayTeamId: string } | null;
  lineups: Map<string, GameLineupRecord>;
  fieldRepresentatives: Map<string, FieldRepresentativeRecord>;
  teamSheets: Map<string, {
    teamId: string;
    managerId: string;
    revision: number;
    presentPlayers: string[];
    presentOfficials: PresentOfficial[];
    initialLineup: LineupEntryRecord[];
    initialSignature: string;
    submittedAt: string;
    updatedAt: string;
  }>;
  personnelRequests: PersonnelRequest[];
  personnelVersion: number;
  officialState: OfficialGameState;
  playByPlay: PlayByPlayRecord;
  events: OfficialScoringStreamPayload[];
};

type PlayerFreeProjection = {
  displayName: string;
  identificationNumber: string;
};

type PlayerPaidProjection = PlayerFreeProjection & {
  isMinor: boolean;
  representativeIdentificationNumber: string | null;
  extraProfile: TournamentPlayerExtraProfileInput;
};

type PlayerProjection = PlayerFreeProjection | PlayerPaidProjection;

type LineupProjection = {
  teams: { homeTeamId: string; awayTeamId: string } | null;
  visibility: SubscriptionTier;
  fieldRepresentatives: Array<FieldRepresentativeProjection & { teamId: string }>;
  lineups: Array<{
    teamId: string;
    managerId: string;
    lineupPlayerIdentificationNumbers: string[];
    lineupPlayerIds: string[];
    lineupEntries: Array<{
      identificationNumber: string;
      playerId: string;
      battingOrder: number | null;
      fieldPosition: string;
      lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
      jerseyNumber: string | null;
      player: PlayerProjection | null;
    }>;
    courtesyRunnerSource: 'BENCH' | 'ROSTER';
    lineupPlayers: PlayerProjection[];
    currentBatterIndex: number;
    currentBatterIdentificationNumber: string | null;
    currentBatterId: string | null;
    nextBatterIdentificationNumber: string | null;
    nextBatterId: string | null;
    updatedAt: string;
  }>;
};

type PlayByPlayProjection = {
  scorecard: PrivateState;
  canUndo: boolean;
  lastScorecardCommand: PrivateCommand | null;
  runAccounting: { runs: AccountedRun[]; totals: ReturnType<typeof runTotals>; scoreMatches: boolean };
  baseRunners: BaseRunnersRecord;
  totalEvents: number;
  recentEvents: OfficialPlayEventRecord[];
  plateAppearances: Array<{
    sequence: number;
    inning: number;
    offenseTeamId: string;
    batterIdentificationNumber: string;
    result: string;
    description: string;
    runsScored: number;
  }>;
  fieldingErrors: Array<{
    sequence: number;
    inning: number;
    defenseTeamId: string | null;
    fielderIdentificationNumber: string;
    description: string;
  }>;
  batterStats: Array<
    BatterStatsRecord & {
      identificationNumber: string;
      playerId: string;
      player: PlayerProjection | null;
    }
  >;
  pitcherStats: Array<
    PitcherStatsRecord & {
      earnedRuns: number;
      unearnedRuns: number;
      pendingRuns: number;
      identificationNumber: string;
      playerId: string;
      player: PlayerProjection | null;
    }
  >;
  fieldingStats: Array<
    FieldingStatsRecord & {
      identificationNumber: string;
      playerId: string;
      player: PlayerProjection | null;
    }
  >;
};

export type OfficialScoringSnapshotEvent = {
  kind: 'snapshot';
  gameId: string;
  tournamentId: string;
  state: OfficialGameState;
  authorization: ReturnType<OfficialScoringService['serializeGameAuthorization']>;
  lineup: LineupProjection;
  playByPlay: PlayByPlayProjection;
};

export type OfficialScoringAuthorizationUpdatedEvent = {
  kind: 'authorization_updated';
  gameId: string;
  tournamentId: string;
  authorization: ReturnType<OfficialScoringService['serializeGameAuthorization']>;
  timestamp: string;
};

export type OfficialScoringUpdateEvent = {
  kind: 'official_update';
  gameId: string;
  tournamentId: string;
  actorId: string;
  actorRole: OfficialActorRole;
  sourceProfile: OfficialActorRole;
  note: string | null;
  state: OfficialGameState;
  plateAppearance: {
    teamId: string;
    batterIdentificationNumber: string;
    batterId: string;
    result: string;
    nextBatterIdentificationNumber: string | null;
    nextBatterId: string | null;
  } | null;
  playEvent: OfficialPlayEventRecord | null;
  runReview?: RunReview;
  scorecardCommand?: PrivateCommand;
  undoLast?: boolean;
  regulationInnings?: 7 | 9;
  lastErrorOuts?: number | null;
  lineup: LineupProjection;
  playByPlay: PlayByPlayProjection;
  timestamp: string;
};

export type OfficialScoringStreamPayload =
  | OfficialScoringSnapshotEvent
  | OfficialScoringAuthorizationUpdatedEvent
  | OfficialScoringUpdateEvent;

export type TournamentAuthorizationCommand = {
  tournamentId: string;
  organizerId: string;
  scorekeeperIds: string[];
  subscriptionTier?: SubscriptionTier;
};

export type TournamentSubscriptionCommand = {
  tournamentId: string;
  organizerId: string;
  subscriptionTier: SubscriptionTier;
};

export type RegisterGlobalPlayerCommand = {
  actorId: string;
  player: TournamentPlayerInput;
};

export type RegisterTournamentPlayerCommand = {
  tournamentId: string;
  organizerId: string;
  player: TournamentPlayerInput;
};

export type TournamentTeamRosterCommand = {
  tournamentId: string;
  organizerId?: string;
  teamId: string;
  managerId: string;
  playerIdentificationNumbers: string[];
};

export type GameAuthorizationCommand = {
  gameId: string;
  tournamentId: string;
  organizerId: string;
  scorekeeperIds: string[];
};

export type GameTeamsCommand = {
  gameId: string;
  tournamentId: string;
  organizerId: string;
  homeTeamId: string;
  awayTeamId: string;
};

export type GameLineupCommand = {
  gameId: string;
  tournamentId: string;
  teamId: string;
  managerId: string;
  playerIdentificationNumbers?: string[];
  lineupEntries?: Array<{
    identificationNumber: string;
    battingOrder: number | null;
    fieldPosition: string;
    lineupRole?: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
    jerseyNumber?: string;
  }>;
  courtesyRunnerSource?: 'BENCH' | 'ROSTER';
  presentSubstituteIdentificationNumbers?: string[];
  presentOfficials?: PresentOfficial[];
};

export type OfficialUpdateCommand = {
  gameId: string;
  tournamentId: string;
  actorId: string;
  actorRole: OfficialActorRole;
  sourceProfile?: OfficialActorRole;
  note?: string;
  patch: OfficialScoringPatch;
  plateAppearance?: PlateAppearanceInput;
  playEvent?: PlayEventInput;
  runReview?: RunReview;
  expectedOfficialVersion?: number;
  scorecardCommand?: unknown;
  undoLast?: boolean;
  regulationInnings?: 7 | 9;
  lastErrorOuts?: number | null;
};

export type GamePermissionsInput = {
  gameId: string;
  tournamentId: string;
  userId: string;
  role: AppRole;
};

@Injectable()
export class OfficialScoringService {
  private readonly tournamentAuthorizations = new Map<string, TournamentAuthorizationRecord>();
  private readonly globalPlayersByIdentification = new Map<string, RegisteredPlayerRecord>();
  private readonly games = new Map<string, OfficialGameRecord>();
  private readonly streams = new Map<string, Subject<OfficialScoringStreamPayload>>();
  private readonly personnelStreams = new Map<string, Subject<void>>();

  configureTournamentAuthorization(command: TournamentAuthorizationCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    const scorekeeperIds = this.sanitizeIds(command.scorekeeperIds, 'scorekeeperIds');

    const existing = this.tournamentAuthorizations.get(tournamentId);
    if (existing && existing.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial del torneo puede actualizar autorizaciones.');
    }

    const subscriptionTier = command.subscriptionTier
      ? this.requireSubscriptionTier(command.subscriptionTier)
      : existing?.subscriptionTier ?? 'free';

    const nextRecord: TournamentAuthorizationRecord = {
      tournamentId,
      organizerId,
      subscriptionTier,
      courtesyRunnerSource: existing?.courtesyRunnerSource ?? 'BENCH',
      authorizedScorekeepers: new Set(scorekeeperIds),
      teamRosters: existing?.teamRosters ?? new Map<string, TournamentTeamRosterRecord>(),
      updatedAt: this.nowIso()
    };

    this.tournamentAuthorizations.set(tournamentId, nextRecord);
    return this.serializeTournamentAuthorization(nextRecord);
  }

  configureTournamentSubscription(command: TournamentSubscriptionCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    const subscriptionTier = this.requireSubscriptionTier(command.subscriptionTier);

    const tournament = this.getTournamentOrThrow(tournamentId);
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial puede cambiar el plan del torneo.');
    }

    tournament.subscriptionTier = subscriptionTier;
    tournament.updatedAt = this.nowIso();

    return this.serializeTournamentAuthorization(tournament);
  }

  getTournamentAuthorization(tournamentIdRaw: string) {
    const tournament = this.getTournamentOrThrow(tournamentIdRaw);
    return this.serializeTournamentAuthorization(tournament);
  }

  configureTournamentRules(command: {
    tournamentId: string;
    organizerId: string;
    courtesyRunnerSource: 'BENCH' | 'ROSTER';
  }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial puede cambiar las reglas del torneo.');
    }
    if (command.courtesyRunnerSource !== 'BENCH' && command.courtesyRunnerSource !== 'ROSTER') {
      throw new BadRequestException('courtesyRunnerSource debe ser BENCH o ROSTER.');
    }
    tournament.courtesyRunnerSource = command.courtesyRunnerSource;
    tournament.updatedAt = this.nowIso();
    return this.serializeTournamentAuthorization(tournament);
  }

  registerGlobalPlayer(command: RegisterGlobalPlayerCommand) {
    const actorId = this.requireText(command.actorId, 'actorId');
    const displayName = this.requireText(command.player.displayName, 'displayName');
    const identificationNumber = this.normalizeIdentificationNumber(
      command.player.identificationNumber,
      'identificationNumber'
    );

    if (this.globalPlayersByIdentification.has(identificationNumber)) {
      throw new BadRequestException(
        `La cedula ${identificationNumber} ya existe en el registro global. No puede repetirse en toda la app.`
      );
    }

    const isMinor = Boolean(command.player.isMinor);
    const representativeFromInput = command.player.representativeIdentificationNumber
      ? this.normalizeIdentificationNumber(
          command.player.representativeIdentificationNumber,
          'representativeIdentificationNumber'
        )
      : null;

    const representativeIdentificationNumber = isMinor
      ? representativeFromInput ?? identificationNumber
      : representativeFromInput;

    const now = this.nowIso();
    const record: RegisteredPlayerRecord = {
      displayName,
      identificationNumber,
      isMinor,
      representativeIdentificationNumber,
      extraProfile: this.sanitizeExtraProfile(command.player.extraProfile),
      createdAt: now,
      updatedAt: now,
      createdById: actorId
    };

    this.globalPlayersByIdentification.set(identificationNumber, record);

    return {
      scope: 'global',
      player: this.projectPlayer(record, 'free'),
      registeredAt: now
    };
  }

  getGlobalPlayers(visibilityRaw?: string, tournamentIdRaw?: string) {
    let visibility: SubscriptionTier = 'free';
    let tournamentId: string | undefined;

    if (tournamentIdRaw) {
      const tournament = this.getTournamentOrThrow(tournamentIdRaw);
      visibility = this.resolveVisibility(tournament, visibilityRaw);
      tournamentId = tournament.tournamentId;
    } else if (visibilityRaw) {
      visibility = this.requireSubscriptionTier(visibilityRaw, 'visibility');
      if (visibility === 'paid') {
        throw new ForbiddenException(
          'Para visibilidad paid debes consultar en contexto de un torneo con plan paid.'
        );
      }
    }

    const players = Array.from(this.globalPlayersByIdentification.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
      .map((player) => this.projectPlayer(player, visibility));

    return {
      scope: 'global',
      visibility,
      tournamentId,
      totalPlayers: players.length,
      players
    };
  }

  registerTournamentPlayer(command: RegisterTournamentPlayerCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');

    const tournament = this.getTournamentOrThrow(tournamentId);
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial puede registrar jugadores desde este endpoint.');
    }

    const registration = this.registerGlobalPlayer({
      actorId: organizerId,
      player: command.player
    });

    const visibility = tournament.subscriptionTier;
    const identificationNumber = this.normalizeIdentificationNumber(
      command.player.identificationNumber,
      'identificationNumber'
    );

    const stored = this.globalPlayersByIdentification.get(identificationNumber);
    if (!stored) {
      throw new NotFoundException('No se pudo recuperar el jugador recien registrado.');
    }

    return {
      tournamentId,
      subscriptionTier: visibility,
      scope: registration.scope,
      player: this.projectPlayer(stored, visibility),
      registeredAt: registration.registeredAt
    };
  }

  getTournamentPlayers(tournamentIdRaw: string, visibilityRaw?: string) {
    const tournament = this.getTournamentOrThrow(tournamentIdRaw);
    const visibility = this.resolveVisibility(tournament, visibilityRaw);

    const players = Array.from(this.globalPlayersByIdentification.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
      .map((player) => this.projectPlayer(player, visibility));

    return {
      tournamentId: tournament.tournamentId,
      subscriptionTier: tournament.subscriptionTier,
      visibility,
      source: 'global_registry',
      totalPlayers: players.length,
      players
    };
  }

  configureTournamentTeamRoster(command: TournamentTeamRosterCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const teamId = this.requireText(command.teamId, 'teamId');
    const managerId = this.requireText(command.managerId, 'managerId');
    const organizerId = this.normalizeOptionalText(command.organizerId);
    const playerIdentificationNumbers = this.sanitizeIdentificationList(
      command.playerIdentificationNumbers,
      'playerIdentificationNumbers'
    );

    if (playerIdentificationNumbers.length === 0) {
      throw new BadRequestException('playerIdentificationNumbers no puede estar vacio.');
    }

    const tournament = this.getTournamentOrThrow(tournamentId);
    const isOrganizerOverride = organizerId !== null && organizerId === tournament.organizerId;
    if (!isOrganizerOverride) {
      throw new ForbiddenException('Solo el organizador puede aprobar o modificar el roster oficial.');
    }
    const existingRoster = tournament.teamRosters.get(teamId);

    if (existingRoster && existingRoster.managerId !== managerId && !isOrganizerOverride) {
      throw new ForbiddenException(
        `Solo el manager ${existingRoster.managerId} o el organizador pueden modificar el roster de ${teamId}.`
      );
    }

    this.assertManagerSingleTeamPerTournament(tournament, teamId, managerId);

    for (const identificationNumber of playerIdentificationNumbers) {
      if (!this.globalPlayersByIdentification.has(identificationNumber)) {
        throw new BadRequestException(
          `La cedula ${identificationNumber} no existe en el registro global. Debes registrar jugador una sola vez.`
        );
      }
    }

    this.assertPlayersNotInOtherTeamRoster(tournament, teamId, playerIdentificationNumbers);
    for (const game of this.games.values()) {
      if (game.tournamentId === tournamentId && game.officialState.status !== 'final' &&
          game.lineups.get(teamId)?.lineupEntries.some((entry) => !playerIdentificationNumbers.includes(entry.identificationNumber))) {
        throw new ConflictException('No puedes retirar del roster a un jugador de una alineación entregada. Registra primero su cambio oficial.');
      }
    }

    const roster: TournamentTeamRosterRecord = {
      tournamentId,
      teamId,
      managerId,
      playerIdentificationNumbers: new Set(playerIdentificationNumbers),
      updatedAt: this.nowIso()
    };

    tournament.teamRosters.set(teamId, roster);
    tournament.updatedAt = roster.updatedAt;
    for (const game of this.games.values()) {
      if (game.tournamentId !== tournamentId || game.officialState.status === 'final') continue;
      const representative = game.fieldRepresentatives.get(teamId);
      if (
        representative &&
        (!roster.playerIdentificationNumbers.has(representative.identificationNumber) ||
          roster.managerId !== representative.authorizedByManagerId)
      ) {
        game.fieldRepresentatives.delete(teamId);
      }
    }

    return {
      tournamentId,
      teamId,
      managerId,
      visibility: tournament.subscriptionTier,
      rosterPlayerIdentificationNumbers: playerIdentificationNumbers,
      rosterPlayerIds: playerIdentificationNumbers,
      rosterPlayers: playerIdentificationNumbers
        .map((id) => this.globalPlayersByIdentification.get(id))
        .filter((player): player is RegisteredPlayerRecord => Boolean(player))
        .map((player) => this.projectPlayer(player, tournament.subscriptionTier)),
      updatedAt: roster.updatedAt
    };
  }

  getTournamentTeamRosters(tournamentIdRaw: string, visibilityRaw?: string) {
    const tournament = this.getTournamentOrThrow(tournamentIdRaw);
    const visibility = this.resolveVisibility(tournament, visibilityRaw);

    return {
      tournamentId: tournament.tournamentId,
      visibility,
      rosters: Array.from(tournament.teamRosters.values()).map((roster) => {
        const playerIdentificationNumbers = Array.from(roster.playerIdentificationNumbers.values());

        return {
          teamId: roster.teamId,
          managerId: roster.managerId,
          rosterPlayerIdentificationNumbers: playerIdentificationNumbers,
          rosterPlayerIds: playerIdentificationNumbers,
          rosterPlayers: playerIdentificationNumbers
            .map((id) => this.globalPlayersByIdentification.get(id))
            .filter((player): player is RegisteredPlayerRecord => Boolean(player))
            .map((player) => this.projectPlayer(player, visibility)),
          updatedAt: roster.updatedAt
        };
      })
    };
  }

  getTournamentTeamRoster(tournamentIdRaw: string, teamIdRaw: string, visibilityRaw?: string) {
    const tournament = this.getTournamentOrThrow(tournamentIdRaw);
    const visibility = this.resolveVisibility(tournament, visibilityRaw);
    const roster = this.getTeamRosterOrThrow(tournament, teamIdRaw);
    const playerIdentificationNumbers = Array.from(roster.playerIdentificationNumbers.values());

    return {
      tournamentId: tournament.tournamentId,
      teamId: roster.teamId,
      managerId: roster.managerId,
      visibility,
      rosterPlayerIdentificationNumbers: playerIdentificationNumbers,
      rosterPlayerIds: playerIdentificationNumbers,
      rosterPlayers: playerIdentificationNumbers
        .map((id) => this.globalPlayersByIdentification.get(id))
        .filter((player): player is RegisteredPlayerRecord => Boolean(player))
        .map((player) => this.projectPlayer(player, visibility)),
      updatedAt: roster.updatedAt
    };
  }

  configureGameAuthorization(command: GameAuthorizationCommand) {
    const gameId = this.requireText(command.gameId, 'gameId');
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    const scorekeeperIds = this.sanitizeIds(command.scorekeeperIds, 'scorekeeperIds');

    const tournament = this.getTournamentOrThrow(tournamentId);
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial del torneo puede autorizar anotadores del juego.');
    }

    for (const scorekeeperId of scorekeeperIds) {
      if (!tournament.authorizedScorekeepers.has(scorekeeperId)) {
        throw new BadRequestException(
          `El anotador ${scorekeeperId} no esta autorizado a nivel torneo para ${tournamentId}.`
        );
      }
    }

    const game = this.getOrCreateGame(gameId, tournamentId);
    game.hasGameScopedAuthorization = true;
    game.gameAuthorizedScorekeepers = new Set(scorekeeperIds);

    const authorization = this.serializeGameAuthorization(game, tournament);
    const event: OfficialScoringAuthorizationUpdatedEvent = {
      kind: 'authorization_updated',
      gameId,
      tournamentId,
      authorization,
      timestamp: this.nowIso()
    };

    game.events.push(event);
    this.getOrCreateStream(gameId).next(event);

    return authorization;
  }

  getGameAuthorization(gameIdRaw: string, tournamentIdRaw: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameIdRaw, tournamentId);
    return this.serializeGameAuthorization(game, tournament);
  }

  configureGameTeams(command: GameTeamsCommand) {
    const gameId = this.requireText(command.gameId, 'gameId');
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    const homeTeamId = this.requireText(command.homeTeamId, 'homeTeamId');
    const awayTeamId = this.requireText(command.awayTeamId, 'awayTeamId');

    if (homeTeamId === awayTeamId) {
      throw new BadRequestException('homeTeamId y awayTeamId deben ser distintos.');
    }

    const tournament = this.getTournamentOrThrow(tournamentId);
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial puede definir los equipos del juego.');
    }

    this.getTeamRosterOrThrow(tournament, homeTeamId);
    this.getTeamRosterOrThrow(tournament, awayTeamId);

    const game = this.getOrCreateGame(gameId, tournamentId);
    if (game.teamSheets.size > 0 && game.teams &&
        (game.teams.homeTeamId !== homeTeamId || game.teams.awayTeamId !== awayTeamId)) {
      throw new ConflictException('No se pueden cambiar los participantes después de entregar una alineación.');
    }
    game.teams = { homeTeamId, awayTeamId };

    if (!game.officialState.offenseTeamId) {
      game.officialState.offenseTeamId = awayTeamId;
    }

    game.officialState.nextBatterId = this.resolveNextBatterId(game, game.officialState.offenseTeamId);

    return {
      gameId,
      tournamentId,
      teams: game.teams,
      lineup: this.serializeLineupStatus(game, tournament)
    };
  }

  authorizeFieldRepresentative(command: {
    gameId: string;
    tournamentId: string;
    teamId: string;
    managerId: string;
    identificationNumber: string;
  }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const teamId = this.requireText(command.teamId, 'teamId');
    const roster = this.getTeamRosterOrThrow(tournament, teamId);
    const managerId = this.requireText(command.managerId, 'managerId');
    if (roster.managerId !== managerId) {
      throw new ForbiddenException('Solo el dirigente del equipo puede autorizar a su representante en el campo.');
    }
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    if (!game.teams || ![game.teams.homeTeamId, game.teams.awayTeamId].includes(teamId)) {
      throw new BadRequestException('El equipo no participa en este partido.');
    }
    if (game.officialState.status === 'final') {
      throw new BadRequestException('No se puede cambiar al representante de un partido finalizado.');
    }
    const identificationNumber = this.normalizeIdentificationNumber(command.identificationNumber, 'cedula');
    if (!roster.playerIdentificationNumbers.has(identificationNumber)) {
      throw new BadRequestException('El representante debe pertenecer a la plantilla oficial del equipo.');
    }
    if (!this.globalPlayersByIdentification.has(identificationNumber)) {
      throw new BadRequestException('La cédula no existe en el registro global.');
    }
    game.fieldRepresentatives.set(teamId, {
      identificationNumber,
      authorizedByManagerId: managerId,
      authorizedAt: this.nowIso()
    });
    return this.getFieldRepresentative(game.gameId, tournament.tournamentId, teamId);
  }

  getFieldRepresentative(gameId: string, tournamentId: string, teamIdRaw: string) {
    const tournament = this.getTournamentOrThrow(tournamentId);
    const teamId = this.requireText(teamIdRaw, 'teamId');
    this.getTeamRosterOrThrow(tournament, teamId);
    const game = this.getOrCreateGame(gameId, tournament.tournamentId);
    if (!game.teams || ![game.teams.homeTeamId, game.teams.awayTeamId].includes(teamId)) {
      throw new BadRequestException('El equipo no participa en este partido.');
    }
    return {
      gameId: game.gameId,
      tournamentId: game.tournamentId,
      teamId,
      representative: this.serializeFieldRepresentative(game, teamId)
    };
  }

  private serializeFieldRepresentative(game: OfficialGameRecord, teamId: string): FieldRepresentativeProjection | null {
    const representative = game.fieldRepresentatives.get(teamId);
    if (!representative) return null;
    const player = this.globalPlayersByIdentification.get(representative.identificationNumber);
    if (!player) {
      throw new NotFoundException('El representante autorizado no existe en el registro global.');
    }
    return { ...representative, displayName: player.displayName };
  }

  configureGameLineup(command: GameLineupCommand) {
    const gameId = this.requireText(command.gameId, 'gameId');
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const teamId = this.requireText(command.teamId, 'teamId');
    const managerId = this.requireText(command.managerId, 'managerId');
    const rawFallbackPlayers = Array.isArray(command.playerIdentificationNumbers)
      ? command.playerIdentificationNumbers
      : [];

    const normalizedFallback =
      rawFallbackPlayers.length > 0
        ? this.sanitizeIdentificationList(rawFallbackPlayers, 'playerIdentificationNumbers')
        : [];

    const lineupEntries = this.sanitizeLineupEntries(
      command.lineupEntries,
      normalizedFallback,
      'lineupEntries'
    );
    if (command.courtesyRunnerSource !== undefined) {
      throw new ForbiddenException('El manager no puede definir reglas. Las configura el organizador del torneo.');
    }

    const playerIdentificationNumbers = lineupEntries
      .filter((entry) => entry.battingOrder !== null)
      .map((entry) => entry.identificationNumber);

    const tournament = this.getTournamentOrThrow(tournamentId);
    const teamRoster = this.getTeamRosterOrThrow(tournament, teamId);

    if (teamRoster.managerId !== managerId) {
      throw new ForbiddenException(`El manager ${managerId} no esta autorizado para el equipo ${teamId}.`);
    }

    for (const identificationNumber of lineupEntries.map((entry) => entry.identificationNumber)) {
      if (!teamRoster.playerIdentificationNumbers.has(identificationNumber)) {
        throw new BadRequestException(
          `La cedula ${identificationNumber} no pertenece al roster oficial del equipo ${teamId}.`
        );
      }
      if (!this.globalPlayersByIdentification.has(identificationNumber)) {
        throw new BadRequestException(
          `La cedula ${identificationNumber} no existe en el registro global. Verifica roster.`
        );
      }
    }

    const game = this.getOrCreateGame(gameId, tournamentId);

    if (!game.teams) {
      throw new BadRequestException('Debes configurar equipos del juego antes de enviar lineup.');
    }

    if (teamId !== game.teams.homeTeamId && teamId !== game.teams.awayTeamId) {
      throw new BadRequestException(`El equipo ${teamId} no participa en el juego ${gameId}.`);
    }
    this.assertPersonnelOpen(game);
    const substitutes = command.presentSubstituteIdentificationNumbers === undefined ||
      Array.isArray(command.presentSubstituteIdentificationNumbers) && command.presentSubstituteIdentificationNumbers.length === 0 ? [] :
      this.sanitizeIdentificationList(command.presentSubstituteIdentificationNumbers, 'suplentes presentes');
    const officials = this.sanitizePresentOfficials(command.presentOfficials ?? []);
    for (const id of substitutes) {
      if (!teamRoster.playerIdentificationNumbers.has(id) || lineupEntries.some((entry) => entry.identificationNumber === id)) {
        throw new BadRequestException('Los suplentes presentes deben estar inscritos y no pertenecer a la alineación inicial.');
      }
    }
    const signature = JSON.stringify({ lineupEntries, substitutes: [...substitutes].sort(), officials });
    const existingSheet = game.teamSheets.get(teamId);
    if (existingSheet) {
      if (existingSheet.initialSignature !== signature) {
        throw new ConflictException('La alineación ya fue entregada. Los cambios requieren confirmación del anotador u organizador.');
      }
      return { gameId, tournamentId, lineup: this.serializeLineupStatus(game, tournament) };
    }

    const lineup: GameLineupRecord = {
      teamId,
      managerId,
      playerIdentificationNumbers,
      lineupEntries,
      currentBatterIndex: 0,
      updatedAt: this.nowIso()
    };

    game.lineups.set(teamId, lineup);
    game.teamSheets.set(teamId, {
      teamId, managerId, revision: 1,
      presentPlayers: [...lineupEntries.map((entry) => entry.identificationNumber), ...substitutes],
      presentOfficials: officials, initialLineup: structuredClone(lineupEntries), initialSignature: signature,
      submittedAt: lineup.updatedAt, updatedAt: lineup.updatedAt
    });

    if (game.officialState.offenseTeamId === teamId) {
      game.officialState.nextBatterId = playerIdentificationNumbers[0] ?? null;
    }
    this.publishPersonnel(game, tournament);

    return {
      gameId,
      tournamentId,
      lineup: this.serializeLineupStatus(game, tournament)
    };
  }

  getGameLineups(gameIdRaw: string, tournamentIdRaw: string, visibilityRaw?: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const visibility = this.resolveVisibility(tournament, visibilityRaw);
    const game = this.getOrCreateGame(gameIdRaw, tournamentId);

    return {
      gameId: game.gameId,
      tournamentId: game.tournamentId,
      lineup: this.serializeLineupStatus(game, tournament, visibility)
    };
  }

  getTeamSheets(gameId: string, tournamentId: string, userIdRaw: string, role: AppRole): TeamSheetsSnapshot {
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameId, tournament.tournamentId);
    const userId = this.requireText(userIdRaw, 'usuario');
    const teams = game.teams ? [game.teams.homeTeamId, game.teams.awayTeamId] : [];
    const ownTeamId = role === 'manager' ?
      teams.find((id) => tournament.teamRosters.get(id)?.managerId === userId) ?? null : null;
    const canDecide = this.canWriteOfficial(game, tournament, userId, role);
    if (!ownTeamId && !canDecide) throw new ForbiddenException('Solo los dirigentes participantes y los oficiales autorizados pueden consultar esta entrega.');
    const player = (entry: LineupEntryRecord): TeamSheetPlayer => ({
      ...entry, displayName: this.globalPlayersByIdentification.get(entry.identificationNumber)?.displayName ?? entry.identificationNumber
    });
    return {
      gameId: game.gameId, tournamentId: game.tournamentId, version: game.personnelVersion, canDecide, ownTeamId,
      sheets: Array.from(game.teamSheets.values()).map((sheet) => {
        const lineup = game.lineups.get(sheet.teamId);
        if (!lineup) throw new NotFoundException('No se encontró la alineación de la entrega.');
        return {
          teamId: sheet.teamId, managerId: sheet.managerId, revision: sheet.revision,
          lineup: lineup.lineupEntries.map(player), initialLineup: sheet.initialLineup.map(player),
          presentSubstitutes: sheet.presentPlayers.filter((id) => !lineup.lineupEntries.some((entry) => entry.identificationNumber === id)).map((id) => ({
            identificationNumber: id, displayName: this.globalPlayersByIdentification.get(id)?.displayName ?? id
          })),
          presentOfficials: structuredClone(sheet.presentOfficials),
          representative: this.serializeFieldRepresentative(game, sheet.teamId),
          submittedAt: sheet.submittedAt, updatedAt: sheet.updatedAt,
          recipients: [
            { userId: tournament.organizerId, role: 'organizer' as const },
            ...Array.from(tournament.authorizedScorekeepers).filter((id) => this.canWriteOfficial(game, tournament, id, 'scorekeeper')).map((id) => ({
              userId: id, role: 'scorekeeper' as const
            })),
            ...teams.filter((id) => id !== sheet.teamId).map((id) => ({
              userId: this.getTeamRosterOrThrow(tournament, id).managerId, role: 'manager' as const
            }))
          ]
        };
      }),
      requests: structuredClone(game.personnelRequests)
    };
  }

  createTeamSheetStream(gameId: string, tournamentId: string, userId: string, role: AppRole): Observable<TeamSheetsSnapshot> {
    this.getTeamSheets(gameId, tournamentId, userId, role);
    let stream = this.personnelStreams.get(gameId);
    if (!stream) {
      stream = new Subject<void>();
      this.personnelStreams.set(gameId, stream);
    }
    const source = stream;
    return new Observable((subscriber) => {
      const emit = () => {
        try { subscriber.next(this.getTeamSheets(gameId, tournamentId, userId, role)); }
        catch (error) { subscriber.error(error); }
      };
      const subscription = source.subscribe(emit);
      emit();
      return () => subscription.unsubscribe();
    });
  }

  requestPersonnelChange(command: {
    gameId: string; tournamentId: string; teamId: string; managerId: string;
    expectedRevision: number; action: unknown;
  }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    const roster = this.getTeamRosterOrThrow(tournament, command.teamId);
    if (roster.managerId !== command.managerId) throw new ForbiddenException('Solo el dirigente del equipo puede comunicar sus movimientos.');
    this.getTeamSheets(game.gameId, game.tournamentId, command.managerId, 'manager');
    this.assertPersonnelOpen(game);
    const sheet = game.teamSheets.get(command.teamId);
    if (!sheet) throw new BadRequestException('Envía la alineación inicial antes de solicitar movimientos.');
    if (sheet.revision !== command.expectedRevision) throw new ConflictException('La entrega cambió. Actualiza los datos antes de enviar el movimiento.');
    const action = this.sanitizePersonnelAction(command.action);
    const duplicate = game.personnelRequests.find((request) => request.teamId === command.teamId &&
      request.status === 'pending' && JSON.stringify(request.action) === JSON.stringify(action));
    if (duplicate) return this.getTeamSheets(game.gameId, game.tournamentId, command.managerId, 'manager');
    this.preparePersonnelChange(game, tournament, command.teamId, action);
    game.personnelRequests.push({
      id: `${game.gameId}:${game.personnelRequests.length + 1}`, teamId: command.teamId,
      managerId: command.managerId, action, status: 'pending', requestedAt: this.nowIso(),
      decidedAt: null, decidedBy: null, decisionNote: null, appliedRevision: null, courtesyRunnerSource: null
    });
    this.publishPersonnel(game, tournament);
    return this.getTeamSheets(game.gameId, game.tournamentId, command.managerId, 'manager');
  }

  decidePersonnelChange(command: {
    gameId: string; tournamentId: string; requestId: string; actorId: string;
    actorRole: AppRole; decision: 'approve' | 'reject'; expectedRevision: number; note?: string;
  }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    if ((command.actorRole !== 'organizer' && command.actorRole !== 'scorekeeper') ||
        !this.canWriteOfficial(game, tournament, command.actorId, command.actorRole)) {
      throw new ForbiddenException('Solo el anotador u organizador autorizado puede confirmar movimientos.');
    }
    this.assertPersonnelOpen(game);
    if (!['approve', 'reject'].includes(command.decision)) throw new BadRequestException('Selecciona confirmar o rechazar.');
    const request = game.personnelRequests.find((entry) => entry.id === command.requestId);
    if (!request) throw new NotFoundException('La solicitud no existe en este partido.');
    if (request.status !== 'pending') {
      if (request.status !== (command.decision === 'approve' ? 'approved' : 'rejected')) throw new ConflictException('La solicitud ya fue resuelta.');
      return this.getTeamSheets(game.gameId, game.tournamentId, command.actorId, command.actorRole);
    }
    const sheet = game.teamSheets.get(request.teamId);
    const lineup = game.lineups.get(request.teamId);
    if (!sheet || !lineup) throw new NotFoundException('No se encontró la entrega del equipo.');
    if (sheet.revision !== command.expectedRevision) throw new ConflictException('La entrega cambió. Revisa la versión actual antes de decidir.');
    const note = command.note === undefined ? null : this.personnelText(command.note, 'nota', true) || null;
    if (command.decision === 'reject' && !note) throw new BadRequestException('Indica el motivo del rechazo.');
    if (command.decision === 'approve') {
      this.applyPersonnelChange(game, tournament, request);
    }
    request.status = command.decision === 'approve' ? 'approved' : 'rejected';
    request.decidedAt = this.nowIso();
    request.decidedBy = { id: command.actorId, role: command.actorRole };
    request.decisionNote = note;
    this.publishPersonnel(game, tournament);
    return this.getTeamSheets(game.gameId, game.tournamentId, command.actorId, command.actorRole);
  }

  recordPersonnelChange(command: {
    gameId: string; tournamentId: string; teamId: string; actorId: string; actorRole: AppRole;
    expectedRevision: number; expectedOfficialVersion: number; action: unknown;
  }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    if (!this.canWriteOfficial(game, tournament, command.actorId, command.actorRole) ||
        (command.actorRole !== 'organizer' && command.actorRole !== 'scorekeeper')) {
      throw new ForbiddenException('Solo el anotador u organizador autorizado puede registrar cambios.');
    }
    this.assertPersonnelOpen(game);
    const sheet = game.teamSheets.get(command.teamId);
    if (!sheet) throw new BadRequestException('Recibe primero el lineup de este equipo.');
    if (sheet.revision !== command.expectedRevision || game.officialState.officialVersion !== command.expectedOfficialVersion) {
      throw new ConflictException('El partido cambió. Actualiza la pizarra antes de registrar el movimiento.');
    }
    const action = this.sanitizePersonnelAction(command.action);
    this.preparePersonnelChange(game, tournament, command.teamId, action);
    const request: PersonnelRequest = {
      id: `${game.gameId}:${game.personnelRequests.length + 1}`, teamId: command.teamId, managerId: sheet.managerId,
      action, status: 'approved', requestedAt: this.nowIso(), decidedAt: this.nowIso(),
      decidedBy: { id: command.actorId, role: command.actorRole },
      decisionNote: 'Registrado directamente por el oficial del partido.', appliedRevision: null, courtesyRunnerSource: null
    };
    this.applyPersonnelChange(game, tournament, request);
    game.personnelRequests.push(request);
    this.publishPersonnel(game, tournament);
    return this.getTeamSheets(game.gameId, game.tournamentId, command.actorId, command.actorRole);
  }

  private applyPersonnelChange(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord, request: PersonnelRequest) {
      const sheet = game.teamSheets.get(request.teamId)!;
      const lineup = game.lineups.get(request.teamId)!;
      const next = this.preparePersonnelChange(game, tournament, request.teamId, request.action);
      if (request.action.kind === 'courtesy') {
        const { outgoingIdentificationNumber: outgoing, incomingIdentificationNumber: incoming, fromBase } = request.action;
        const bases = [game.playByPlay.baseRunners.first, game.playByPlay.baseRunners.second, game.playByPlay.baseRunners.third];
        if (game.officialState.offenseTeamId !== request.teamId || bases[fromBase - 1] !== outgoing || bases.includes(incoming)) {
          throw new BadRequestException('El corredor y la base deben coincidir con la pizarra oficial.');
        }
        const key = (['first', 'second', 'third'] as const)[fromBase - 1];
        game.playByPlay.baseRunners[key] = incoming;
        game.playByPlay.courtesyFor[incoming] = outgoing;
        const owner = game.playByPlay.runAccounting.runners[outgoing];
        if (owner) {
          game.playByPlay.runAccounting.runners[incoming] = owner;
          delete game.playByPlay.runAccounting.runners[outgoing];
        }
      }
      lineup.lineupEntries = next.lineupEntries;
      lineup.playerIdentificationNumbers = next.lineupEntries.filter((entry) => entry.battingOrder !== null).map((entry) => entry.identificationNumber);
      lineup.updatedAt = this.nowIso();
      sheet.presentPlayers = next.presentPlayers;
      sheet.presentOfficials = next.presentOfficials;
      sheet.revision += 1;
      sheet.updatedAt = lineup.updatedAt;
      request.appliedRevision = sheet.revision;
      if (request.action.kind === 'courtesy') request.courtesyRunnerSource = tournament.courtesyRunnerSource;
      if ((request.action.kind === 'substitution' || request.action.kind === 'courtesy') &&
          game.officialState.offenseTeamId === request.teamId) {
        const { outgoingIdentificationNumber: outgoing, incomingIdentificationNumber: incoming } = request.action;
        for (const base of ['first', 'second', 'third'] as const) {
          if (game.playByPlay.baseRunners[base] === outgoing) {
            game.playByPlay.baseRunners[base] = incoming;
            const runner = game.playByPlay.runAccounting.runners[outgoing];
            if (runner) {
              game.playByPlay.runAccounting.runners[incoming] = runner;
              delete game.playByPlay.runAccounting.runners[outgoing];
            }
          }
        }
      }
      if (game.officialState.offenseTeamId === request.teamId) {
        game.officialState.nextBatterId = this.resolveNextBatterId(game, request.teamId);
      }
      game.scoringHistory = [];
  }

  private preparePersonnelChange(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord, teamId: string, action: PersonnelAction) {
    const sheet = game.teamSheets.get(teamId);
    const lineup = game.lineups.get(teamId);
    if (!sheet || !lineup) throw new NotFoundException('No se encontró la entrega del equipo.');
    const roster = this.getTeamRosterOrThrow(tournament, teamId);
    let entries = structuredClone(lineup.lineupEntries);
    const presentPlayers = [...sheet.presentPlayers];
    let presentOfficials = structuredClone(sheet.presentOfficials);
    const registered = (id: string) => {
      if (!roster.playerIdentificationNumbers.has(id) || !this.globalPlayersByIdentification.has(id)) {
        throw new BadRequestException('El jugador debe pertenecer a la plantilla oficial de este equipo.');
      }
    };
    const active = (id: string) => {
      const entry = entries.find((player) => player.identificationNumber === id);
      if (!entry) throw new BadRequestException('El jugador saliente no está en la alineación actual.');
      return entry;
    };
    const reserve = (id: string) => {
      registered(id);
      if (!presentPlayers.includes(id) || entries.some((entry) => entry.identificationNumber === id)) {
        throw new BadRequestException('El sustituto debe ser un suplente presente y confirmado.');
      }
    };
    switch (action.kind) {
      case 'arrival':
        registered(action.identificationNumber);
        if (presentPlayers.includes(action.identificationNumber)) throw new BadRequestException('El jugador ya está registrado como presente.');
        presentPlayers.push(action.identificationNumber);
        break;
      case 'substitution': {
        const outgoing = active(action.outgoingIdentificationNumber);
        reserve(action.incomingIdentificationNumber);
        entries = entries.map((entry) => entry === outgoing ? {
          ...entry, identificationNumber: action.incomingIdentificationNumber,
          fieldPosition: action.fieldPosition, jerseyNumber: action.jerseyNumber
        } : entry);
        break;
      }
      case 'defense': {
        const player = active(action.identificationNumber);
        const swap = ['DH', 'NA'].includes(action.fieldPosition) ? undefined :
          entries.find((entry) => entry !== player && entry.fieldPosition === action.fieldPosition);
        entries = entries.map((entry) => entry === player ? { ...entry, fieldPosition: action.fieldPosition } :
          entry === swap ? { ...entry, fieldPosition: player.fieldPosition } : entry);
        break;
      }
      case 'courtesy': {
        const outgoing = active(action.outgoingIdentificationNumber);
        registered(action.incomingIdentificationNumber);
        if (!['P', 'C'].includes(outgoing.fieldPosition) || action.incomingIdentificationNumber === outgoing.identificationNumber) {
          throw new BadRequestException('El corredor temporal solo puede reemplazar al lanzador o receptor.');
        }
        if (!presentPlayers.includes(action.incomingIdentificationNumber)) throw new BadRequestException('El corredor temporal debe estar presente y confirmado.');
        if (tournament.courtesyRunnerSource === 'BENCH') reserve(action.incomingIdentificationNumber);
        break;
      }
      case 'staff-arrival':
        if (presentOfficials.some((official) => official.role === action.official.role && official.identificationNumber === action.official.identificationNumber)) {
          throw new BadRequestException('Este directivo ya está registrado como presente en ese cargo.');
        }
        presentOfficials.push(action.official);
        break;
      case 'staff-departure':
        if (!presentOfficials.some((official) => official.role === action.role && official.identificationNumber === action.identificationNumber)) {
          throw new BadRequestException('El directivo no está registrado como presente en ese cargo.');
        }
        presentOfficials = presentOfficials.filter((official) => official.role !== action.role || official.identificationNumber !== action.identificationNumber);
        break;
    }
    const lineupEntries = this.sanitizeLineupEntries(entries.map((entry) => ({ ...entry, jerseyNumber: entry.jerseyNumber ?? undefined })), [], 'alineación');
    lineupEntries.forEach((entry) => registered(entry.identificationNumber));
    return { lineupEntries, presentPlayers, presentOfficials };
  }

  private personnelText(value: unknown, label: string, allowEmpty = false): string {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new BadRequestException(`${label}: indica un texto válido.`);
    return value.trim();
  }

  private sanitizePresentOfficials(value: unknown): PresentOfficial[] {
    if (!Array.isArray(value)) throw new BadRequestException('Los directivos presentes deben enviarse como una lista.');
    const officials = value.map((entry: unknown): PresentOfficial => {
      if (!entry || typeof entry !== 'object' || !('role' in entry) || !('identificationNumber' in entry) || !('displayName' in entry)) {
        throw new BadRequestException('Indica cargo, cédula y nombre del directivo presente.');
      }
      if (entry.role !== 'DIRIGENTE' && entry.role !== 'MANAGER' && entry.role !== 'DELEGADO') {
        throw new BadRequestException('Solo se incluyen dirigente, manager y delegados; no los coach de primera y tercera.');
      }
      return {
        role: entry.role,
        identificationNumber: this.normalizeIdentificationNumber(this.personnelText(entry.identificationNumber, 'cédula del directivo'), 'cédula del directivo'),
        displayName: this.personnelText(entry.displayName, 'nombre del directivo')
      };
    });
    if (new Set(officials.map((entry) => `${entry.role}:${entry.identificationNumber}`)).size !== officials.length) {
      throw new BadRequestException('No repitas un directivo en el mismo cargo.');
    }
    return officials;
  }

  private sanitizePersonnelAction(value: unknown): PersonnelAction {
    if (!value || typeof value !== 'object' || !('kind' in value)) throw new BadRequestException('Indica el movimiento de personal.');
    const text = (key: string) => this.personnelText(key in value ? Reflect.get(value, key) : undefined, key);
    const id = (key: string) => this.normalizeIdentificationNumber(text(key), 'cédula');
    switch (value.kind) {
      case 'arrival': return { kind: 'arrival', identificationNumber: id('identificationNumber') };
      case 'substitution': return {
        kind: 'substitution', outgoingIdentificationNumber: id('outgoingIdentificationNumber'),
        incomingIdentificationNumber: id('incomingIdentificationNumber'),
        fieldPosition: this.normalizeFieldPosition(text('fieldPosition'), 'posición'),
        jerseyNumber: this.normalizeJerseyNumber(text('jerseyNumber'), 'camiseta')
      };
      case 'defense': return { kind: 'defense', identificationNumber: id('identificationNumber'), fieldPosition: this.normalizeFieldPosition(text('fieldPosition'), 'posición') };
      case 'courtesy': return {
        kind: 'courtesy', fromBase: this.requireIntegerRange('fromBase' in value && typeof value.fromBase === 'number' ? value.fromBase : NaN, 'base', 1, 3),
        outgoingIdentificationNumber: id('outgoingIdentificationNumber'), incomingIdentificationNumber: id('incomingIdentificationNumber')
      };
      case 'staff-arrival': return { kind: 'staff-arrival', official: this.sanitizePresentOfficials(['official' in value ? value.official : null])[0] };
      case 'staff-departure': {
        const role = text('role');
        if (role !== 'DIRIGENTE' && role !== 'MANAGER' && role !== 'DELEGADO') throw new BadRequestException('Cargo de directivo inválido.');
        return { kind: 'staff-departure', identificationNumber: id('identificationNumber'), role };
      }
      default: throw new BadRequestException('Movimiento de personal no permitido.');
    }
  }

  private assertPersonnelOpen(game: OfficialGameRecord) {
    if (game.officialState.status === 'final') throw new BadRequestException('No se permite modificar el personal de un juego finalizado.');
  }

  private publishPersonnel(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord) {
    game.officialState = {
      ...game.officialState, officialVersion: game.officialState.officialVersion + 1, updatedAt: this.nowIso()
    };
    game.personnelVersion += 1;
    this.personnelStreams.get(game.gameId)?.next();
    this.getOrCreateStream(game.gameId).next({
      kind: 'snapshot', gameId: game.gameId, tournamentId: game.tournamentId,
      state: game.officialState, authorization: this.serializeGameAuthorization(game, tournament),
      lineup: this.serializeLineupStatus(game, tournament), playByPlay: this.serializePlayByPlay(game, tournament)
    });
  }

  getGamePermissions(input: GamePermissionsInput) {
    const gameId = this.requireText(input.gameId, 'gameId');
    const tournamentId = this.requireText(input.tournamentId, 'tournamentId');
    const userId = this.requireText(input.userId, 'userId');
    const role = input.role;

    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameId, tournamentId);

    const canOfficialWrite = this.canWriteOfficial(game, tournament, userId, role);
    const canPrivateWrite = false;
    const managerTeams = Array.from(tournament.teamRosters.values())
      .filter((roster) => roster.managerId === userId)
      .map((roster) => roster.teamId);

    return {
      gameId,
      tournamentId,
      userId,
      role,
      canReadOfficial: true,
      canOfficialWrite,
      canPrivateWrite,
      canSubmitLineup: role === 'manager' && managerTeams.length > 0,
      canRegisterPlayers: role === 'organizer',
      managerTeamIds: managerTeams,
      subscriptionTier: tournament.subscriptionTier,
      scoringMode: canOfficialWrite ? 'official' : 'read_only'
    } as const;
  }

  submitOfficialUpdate(command: OfficialUpdateCommand) {
    const gameId = this.requireText(command.gameId, 'gameId');
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const actorId = this.requireText(command.actorId, 'actorId');
    const actorRole = command.actorRole;

    const tournament = this.getTournamentOrThrow(tournamentId);
    const stored = this.getOrCreateGame(gameId, tournamentId);
    const game = {
      ...stored, officialState: structuredClone(stored.officialState),
      lineups: structuredClone(stored.lineups), playByPlay: structuredClone(stored.playByPlay),
      events: [...stored.events], scoringHistory: [...stored.scoringHistory]
    };

    if (!this.canWriteOfficial(game, tournament, actorId, actorRole)) {
      throw new ForbiddenException(
        'No autorizado para anotacion oficial. Solo organizador o anotadores autorizados pueden publicar el resultado legal.'
      );
    }
    if (command.expectedOfficialVersion !== undefined && command.expectedOfficialVersion !== game.officialState.officialVersion) {
      throw new ConflictException('La pizarra oficial cambió. Recárgala antes de anotar.');
    }
    const scorecardOperation = command.scorecardCommand !== undefined || command.undoLast !== undefined ||
      command.regulationInnings !== undefined || command.lastErrorOuts !== undefined;
    if (scorecardOperation && command.expectedOfficialVersion === undefined) {
      throw new BadRequestException('La anotación requiere la versión actual de la pizarra.');
    }
    if (scorecardOperation && (command.playEvent || command.plateAppearance || command.runReview ||
        Object.keys(command.patch ?? {}).length ||
        [command.scorecardCommand, command.undoLast, command.regulationInnings, command.lastErrorOuts].filter((v) => v !== undefined).length !== 1)) {
      throw new BadRequestException('Envía una sola operación oficial por vez.');
    }
    const before = {
      state: structuredClone(game.officialState), playByPlay: structuredClone(game.playByPlay),
      indexes: new Map(Array.from(game.lineups, ([id, lineup]) => [id, lineup.currentBatterIndex]))
    };
    const restore = (entry: typeof before) => {
      game.officialState = { ...structuredClone(entry.state), officialVersion: stored.officialState.officialVersion };
      game.playByPlay = structuredClone(entry.playByPlay);
      for (const [id, index] of entry.indexes) {
        const lineup = game.lineups.get(id);
        if (lineup) lineup.currentBatterIndex = index;
      }
    };
    let scorecardCommand: PrivateCommand | undefined;
    if (command.undoLast !== undefined) {
      if (command.undoLast !== true) throw new BadRequestException('Indica deshacer la última anotación.');
      const previous = game.scoringHistory.pop();
      if (!previous) throw new BadRequestException('No hay una anotación que se pueda deshacer. Los movimientos de personal se corrigen por separado.');
      restore(previous);
    }
    if (command.lastErrorOuts !== undefined) {
      const previous = game.scoringHistory.pop();
      if (previous?.command?.kind !== 'play' || previous.command.result !== 'error') {
        throw new ConflictException('La última anotación ya no es el error seleccionado.');
      }
      if (command.lastErrorOuts !== null && (!Number.isInteger(command.lastErrorOuts) || command.lastErrorOuts < 0 || command.lastErrorOuts > 3)) {
        throw new BadRequestException('Indica entre cero y tres outs evitados por el error.');
      }
      restore(previous);
      scorecardCommand = { ...previous.command };
      if (command.lastErrorOuts === null) delete scorecardCommand.errorOuts;
      else scorecardCommand.errorOuts = command.lastErrorOuts;
    }
    if (command.regulationInnings !== undefined) {
      if (![7, 9].includes(command.regulationInnings) || game.officialState.status === 'final') {
        throw new BadRequestException('Define siete o nueve entradas antes de cerrar el partido.');
      }
      game.regulationInnings = command.regulationInnings;
    }
    if (command.scorecardCommand !== undefined) {
      if (!isScorecardCommand(command.scorecardCommand) || command.scorecardCommand.sharedRequestId ||
          !['pitch', 'play', 'runner', 'misplay', 'courtesy', 'finish', 'run-review'].includes(command.scorecardCommand.kind)) {
        throw new BadRequestException('La jugada oficial contiene datos inválidos.');
      }
      scorecardCommand = command.scorecardCommand;
    }
    if ((scorecardCommand || command.playEvent || command.plateAppearance) && game.officialState.status === 'final') {
      throw new ConflictException('El partido está cerrado. Deshaz el cierre antes de continuar.');
    }
    let preview: PrivateState | undefined;
    if (scorecardCommand) {
      const current = this.serializeScorecard(game, tournament);
      if (!current.lineups.home.length || !current.lineups.away.length) {
        throw new BadRequestException('Ambos managers deben entregar su lineup antes de anotar el partido.');
      }
      if (scorecardCommand.kind === 'play' && scorecardCommand.destinations === undefined) {
        scorecardCommand = { ...scorecardCommand, destinations: minimumDestinations(current, scorecardCommand.result) };
      }
      if (scorecardCommand.kind === 'courtesy') {
        const teamId = game.officialState.offenseTeamId;
        if (!teamId || !game.teamSheets.get(teamId)?.presentPlayers.includes(scorecardCommand.playerId)) {
          throw new BadRequestException('El corredor temporal debe estar presente y confirmado.');
        }
        scorecardCommand = { ...scorecardCommand, sourceRule: tournament.courtesyRunnerSource };
      }
      try { preview = applyPrivateCommand(current, scorecardCommand); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new BadRequestException(error.message);
      }
      if (scorecardCommand.kind === 'run-review') command = { ...command, runReview: scorecardCommand.review };
    }
    if (command.runReview !== undefined) {
      if (!validRunReview(command.runReview) || command.playEvent || command.plateAppearance) {
        throw new BadRequestException('La revisión de carrera debe enviarse por separado y con su justificación.');
      }
      if (!game.playByPlay.runAccounting.runs.some((run) => run.eventId === command.runReview?.eventId && run.runnerId === command.runReview.runnerId)) {
        throw new BadRequestException('No se encontró la carrera que deseas revisar.');
      }
      game.playByPlay.runAccounting = reviewAccountedRun(game.playByPlay.runAccounting, command.runReview);
    }

    let patch: OfficialScoringPatch = {
      ...(command.patch ?? {}),
      ...(scorecardCommand?.kind === 'finish' ? { status: 'final' as const, lastPlay: 'Partido finalizado oficialmente' } : {}),
      ...(command.undoLast ? { lastPlay: 'Última anotación oficial deshecha' } : {})
    };
    let plateAppearanceResult: {
      teamId: string;
      batterIdentificationNumber: string;
      batterId: string;
      result: string;
      nextBatterIdentificationNumber: string | null;
      nextBatterId: string | null;
    } | null = null;
    let playEventResult: OfficialPlayEventRecord | null = null;

    if (command.plateAppearance) {
      plateAppearanceResult = this.applyPlateAppearance(game, command.plateAppearance);
      patch = {
        ...patch,
        status: patch.status ?? 'in_progress',
        offenseTeamId: plateAppearanceResult.teamId,
        lastBatterIdentificationNumber: plateAppearanceResult.batterIdentificationNumber,
        nextBatterIdentificationNumber: plateAppearanceResult.nextBatterIdentificationNumber,
        lastBatterId: plateAppearanceResult.batterIdentificationNumber,
        nextBatterId: plateAppearanceResult.nextBatterIdentificationNumber,
        lastPlay:
          patch.lastPlay ??
          `${plateAppearanceResult.batterIdentificationNumber}: ${plateAppearanceResult.result}`
      };
    }

    const playEvent = scorecardCommand && preview ? this.scorecardPlayEvent(scorecardCommand, this.serializeScorecard(game, tournament)) : command.playEvent;
    if (playEvent) {
      playEventResult = this.applyPlayEvent(game, playEvent, preview);
      patch = {
        ...patch,
        status: patch.status ?? 'in_progress',
        inning: patch.inning ?? playEventResult.inningAfter,
        outs: patch.outs ?? playEventResult.outsAfter,
        balls: patch.balls ?? playEventResult.ballsAfter,
        strikes: patch.strikes ?? playEventResult.strikesAfter,
        homeScore: patch.homeScore ?? playEventResult.homeScoreAfter,
        awayScore: patch.awayScore ?? playEventResult.awayScoreAfter,
        offenseTeamId: patch.offenseTeamId ?? playEventResult.offenseTeamId,
        lastBatterIdentificationNumber:
          patch.lastBatterIdentificationNumber ?? playEventResult.batterIdentificationNumber,
        nextBatterIdentificationNumber:
          patch.nextBatterIdentificationNumber ?? this.resolveNextBatterId(game, playEventResult.offenseTeamId),
        lastBatterId:
          patch.lastBatterId ?? playEventResult.batterIdentificationNumber,
        nextBatterId:
          patch.nextBatterId ?? this.resolveNextBatterId(game, playEventResult.offenseTeamId),
        lastPlay: patch.lastPlay ?? playEventResult.description
      };
    }

    const nextState = this.applyPatch(game, game.officialState, patch, actorId, actorRole);
    game.officialState = nextState;
    if (scorecardCommand || command.playEvent || command.plateAppearance || command.runReview || !scorecardOperation) {
      game.scoringHistory.push({ ...before, command: scorecardCommand });
      if (command.lastErrorOuts !== undefined) {
        const replaced = stored.scoringHistory.at(-1);
        if (replaced) game.scoringHistory[game.scoringHistory.length - 1] = { ...replaced, command: scorecardCommand };
      }
    }

    const event: OfficialScoringUpdateEvent = {
      kind: 'official_update',
      gameId,
      tournamentId,
      actorId,
      actorRole,
      sourceProfile: command.sourceProfile ?? actorRole,
      note: command.note ? command.note.trim() : null,
      state: nextState,
      plateAppearance: plateAppearanceResult,
      playEvent: playEventResult,
      runReview: command.runReview,
      scorecardCommand,
      undoLast: command.undoLast,
      regulationInnings: command.regulationInnings,
      lastErrorOuts: command.lastErrorOuts,
      lineup: this.serializeLineupStatus(game, tournament),
      playByPlay: this.serializePlayByPlay(game, tournament),
      timestamp: this.nowIso()
    };

    game.events.push(event);
    Object.assign(stored, game);
    this.getOrCreateStream(gameId).next(event);

    return {
      status: 'ok',
      mode: 'official',
      gameId,
      tournamentId,
      state: nextState,
      plateAppearance: plateAppearanceResult,
      playEvent: playEventResult,
      lineup: this.serializeLineupStatus(game, tournament),
      playByPlay: this.serializePlayByPlay(game, tournament),
      event
    };
  }

  getOfficialState(gameIdRaw: string, tournamentIdRaw: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameIdRaw, tournamentId);
    return {
      gameId: game.gameId,
      tournamentId: game.tournamentId,
      state: game.officialState,
      lineup: this.serializeLineupStatus(game, tournament),
      playByPlay: this.serializePlayByPlay(game, tournament)
    };
  }

  getGamePlayByPlay(gameIdRaw: string, tournamentIdRaw: string, visibilityRaw?: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const visibility = this.resolveVisibility(tournament, visibilityRaw);
    const game = this.getOrCreateGame(gameIdRaw, tournamentId);

    return {
      gameId: game.gameId,
      tournamentId: game.tournamentId,
      visibility,
      playByPlay: this.serializePlayByPlay(game, tournament, visibility)
    };
  }

  createGameStream(gameIdRaw: string, tournamentIdRaw: string): Observable<OfficialScoringStreamPayload> {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const gameId = this.requireText(gameIdRaw, 'gameId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameId, tournamentId);
    const stream = this.getOrCreateStream(gameId);

    return new Observable<OfficialScoringStreamPayload>((subscriber) => {
      const snapshot: OfficialScoringSnapshotEvent = {
        kind: 'snapshot',
        gameId,
        tournamentId,
        state: game.officialState,
        authorization: this.serializeGameAuthorization(game, tournament),
        lineup: this.serializeLineupStatus(game, tournament),
        playByPlay: this.serializePlayByPlay(game, tournament)
      };

      subscriber.next(snapshot);
      const subscription = stream.subscribe((event) => subscriber.next(event));

      return () => subscription.unsubscribe();
    });
  }

  private canWriteOfficial(
    game: OfficialGameRecord,
    tournament: TournamentAuthorizationRecord,
    actorId: string,
    role: OfficialActorRole | AppRole
  ) {
    if (role === 'organizer') {
      return tournament.organizerId === actorId;
    }

    if (role !== 'scorekeeper') {
      return false;
    }

    const isTournamentAuthorized = tournament.authorizedScorekeepers.has(actorId);
    if (!isTournamentAuthorized) {
      return false;
    }

    if (!game.hasGameScopedAuthorization) {
      return true;
    }

    return game.gameAuthorizedScorekeepers.has(actorId);
  }

  private recordPlateAppearance(
    game: OfficialGameRecord,
    plateAppearance: Omit<CompletedPlateAppearanceRecord, 'sequence'>
  ) {
    game.playByPlay.plateAppearanceSequence += 1;
    game.playByPlay.plateAppearances.push({
      sequence: game.playByPlay.plateAppearanceSequence,
      ...plateAppearance
    });

    if (game.playByPlay.plateAppearances.length > 500) {
      game.playByPlay.plateAppearances = game.playByPlay.plateAppearances.slice(-500);
    }
  }

  private applyPlateAppearance(game: OfficialGameRecord, plateAppearance: PlateAppearanceInput) {
    if (!game.teams) {
      throw new BadRequestException('Debes definir los equipos del juego antes de registrar turnos al bate.');
    }

    const requestedTeamId =
      plateAppearance.teamId && plateAppearance.teamId.trim().length > 0
        ? this.requireText(plateAppearance.teamId, 'teamId')
        : null;

    const teamId = requestedTeamId ?? game.officialState.offenseTeamId ?? game.teams.awayTeamId;
    if (teamId !== game.teams.homeTeamId && teamId !== game.teams.awayTeamId) {
      throw new BadRequestException(`teamId ${teamId} no pertenece a este juego.`);
    }

    const lineup = game.lineups.get(teamId);
    if (!lineup || lineup.playerIdentificationNumbers.length === 0) {
      throw new BadRequestException(
        `No existe lineup activo para ${teamId}. El manager debe registrar lineup valido contra roster.`
      );
    }

    const expectedBatterIdentification = lineup.playerIdentificationNumbers[lineup.currentBatterIndex] ?? null;
    if (!expectedBatterIdentification) {
      throw new BadRequestException(`No se pudo resolver bateador actual para ${teamId}.`);
    }

    const rawRequestedBatter =
      plateAppearance.batterIdentificationNumber ?? plateAppearance.batterId ?? null;

    const requestedBatterIdentification = rawRequestedBatter
      ? this.normalizeIdentificationNumber(rawRequestedBatter, 'batterIdentificationNumber')
      : null;

    if (requestedBatterIdentification && requestedBatterIdentification !== expectedBatterIdentification) {
      throw new BadRequestException(
        `El bateador esperado es ${expectedBatterIdentification}, no ${requestedBatterIdentification}. Revisa orden del lineup.`
      );
    }

    const result = this.requireText(plateAppearance.result, 'result');

    this.recordPlateAppearance(game, {
      inning: game.officialState.inning,
      offenseTeamId: teamId,
      batterIdentificationNumber: expectedBatterIdentification,
      result,
      description: result,
      runsScored: 0
    });

    lineup.currentBatterIndex = (lineup.currentBatterIndex + 1) % lineup.playerIdentificationNumbers.length;
    lineup.updatedAt = this.nowIso();

    const nextBatterIdentification = lineup.playerIdentificationNumbers[lineup.currentBatterIndex] ?? null;

    return {
      teamId,
      batterIdentificationNumber: expectedBatterIdentification,
      batterId: expectedBatterIdentification,
      result,
      nextBatterIdentificationNumber: nextBatterIdentification,
      nextBatterId: nextBatterIdentification
    };
  }

  private scorecardPlayEvent(command: PrivateCommand, state: PrivateState): PlayEventInput | undefined {
    const plays: Record<PlayResult, PlayEventType> = {
      single: 'HIT_SINGLE', double: 'HIT_DOUBLE', triple: 'HIT_TRIPLE', homeRun: 'HOME_RUN',
      walk: 'WALK', hitByPitch: 'HIT_BY_PITCH', strikeout: 'STRIKEOUT', groundOut: 'GROUND_OUT',
      flyOut: 'FLY_OUT', lineOut: 'LINE_OUT', battedOut: 'OUT', ruleOut: 'FORCE_OUT',
      sacrificeFly: 'SACRIFICE_FLY', sacrificeBunt: 'BUNT', error: 'ERROR',
      fieldersChoice: 'FORCE_OUT', doublePlay: 'DOUBLE_PLAY', triplePlay: 'TRIPLE_PLAY'
    };
    if (command.kind === 'pitch') return { type: command.value === 'ball' ? 'BALL' : command.value === 'strike' ? 'STRIKE' : 'FOUL' };
    if (command.kind === 'play') return { type: plays[command.result], errorOuts: command.errorOuts, note: command.note };
    if (command.kind === 'misplay') return { type: 'DROPPED_FOUL', errorOuts: 1 };
    if (command.kind === 'courtesy') return { type: 'COURTESY_RUNNER', fromBase: command.from, runnerIdentificationNumber: command.playerId };
    if (command.kind === 'runner') {
      const actions: Record<typeof command.action, PlayEventType> = {
        steal: 'STEAL_BASE', caught: 'CAUGHT_STEALING', pickoff: 'PICKOFF', wild: 'WILD_PITCH',
        passed: 'PASSED_BALL', balk: 'BALK', advance: 'RUNNER_ADVANCE', error: 'ERROR_ADVANCE',
        run: 'RUN_SCORED', ruleOut: 'RUNNER_OUT', advanceOut: 'RUNNER_OUT'
      };
      return { type: actions[command.action], fromBase: command.from,
        runnerIdentificationNumber: state.bases[command.from - 1] ?? undefined,
        ...(command.to ? { toBase: command.to } : {}), errorOuts: command.errorOuts, note: command.note };
    }
    return undefined;
  }

  private applyPlayEvent(game: OfficialGameRecord, input: PlayEventInput, preview?: PrivateState): OfficialPlayEventRecord {
    if (!game.teams) {
      throw new BadRequestException('Debes definir los equipos del juego antes de registrar jugada a jugada.');
    }

    const type = this.requirePlayEventType(input.type);
    if (!validRunEvidence(input) || input.errorOuts !== undefined && !['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(type)) {
      throw new BadRequestException('Los outs evitados deben ser de cero a tres y corresponden solo a errores defensivos.');
    }
    if (type === 'DROPPED_FOUL' && input.errorOuts !== undefined && input.errorOuts !== 1) {
      throw new BadRequestException('Un error en foul que prolonga el turno evita un out.');
    }
    if (type === 'ERROR_ADVANCE' && input.errorOuts !== undefined && input.errorOuts > 1) {
      throw new BadRequestException('El error sobre un corredor solo puede evitar cero o un out.');
    }
    if (input.errorOuts !== undefined && game.officialState.outs + input.errorOuts > 3) {
      throw new BadRequestException('Los outs evitados no pueden superar los outs que faltaban en la entrada.');
    }
    const requestedOffenseTeamId = this.normalizeOptionalText(input.teamId);
    const offenseTeamId = requestedOffenseTeamId ?? game.officialState.offenseTeamId ?? game.teams.awayTeamId;

    if (offenseTeamId !== game.teams.homeTeamId && offenseTeamId !== game.teams.awayTeamId) {
      throw new BadRequestException(`teamId ${offenseTeamId} no pertenece a este juego.`);
    }
    const defenseTeamId =
      offenseTeamId === game.teams.homeTeamId ? game.teams.awayTeamId : game.teams.homeTeamId;

    const lineup = game.lineups.get(offenseTeamId) ?? null;
    const expectedBatter =
      lineup && lineup.playerIdentificationNumbers.length > 0
        ? lineup.playerIdentificationNumbers[lineup.currentBatterIndex] ?? null
        : null;

    const requiresBatter = [
      'STRIKE',
      'BALL',
      'FOUL',
      'WALK',
      'HIT_BY_PITCH',
      'HIT_SINGLE',
      'HIT_DOUBLE',
      'HIT_TRIPLE',
      'HOME_RUN',
      'STRIKEOUT',
      'OUT',
      'FORCE_OUT',
      'GROUND_OUT',
      'FLY_OUT',
      'LINE_OUT',
      'SACRIFICE_FLY',
      'DOUBLE_PLAY',
      'TRIPLE_PLAY',
      'BUNT',
      'ERROR',
      'DROPPED_FOUL'
    ].includes(type);

    if (requiresBatter && !expectedBatter) {
      throw new BadRequestException(
        `No existe lineup activo para ${offenseTeamId}. Debes registrar lineup antes de anotar jugada a jugada.`
      );
    }

    const batterFromInput = input.batterIdentificationNumber
      ? this.normalizeIdentificationNumber(input.batterIdentificationNumber, 'playEvent.batterIdentificationNumber')
      : null;

    const runnerFromInput = input.runnerIdentificationNumber
      ? this.normalizeIdentificationNumber(input.runnerIdentificationNumber, 'playEvent.runnerIdentificationNumber')
      : null;

    const activePitcher = game.lineups.get(defenseTeamId)?.lineupEntries.find((entry) => entry.fieldPosition === 'P')?.identificationNumber ?? null;
    const suppliedPitcher = input.pitcherIdentificationNumber
      ? this.normalizeIdentificationNumber(input.pitcherIdentificationNumber, 'playEvent.pitcherIdentificationNumber')
      : null;
    if (suppliedPitcher && suppliedPitcher !== activePitcher) {
      throw new BadRequestException('El lanzador debe coincidir con la posición P de la alineación defensiva vigente. Registra primero el cambio.');
    }
    const pitcherFromInput = activePitcher;

    const fielderFromInput = input.fielderIdentificationNumber
      ? this.normalizeIdentificationNumber(input.fielderIdentificationNumber, 'playEvent.fielderIdentificationNumber')
      : null;

    let batterIdentification = requiresBatter ? expectedBatter : batterFromInput;
    if (requiresBatter && batterFromInput && batterFromInput !== expectedBatter) {
      throw new BadRequestException(
        `El bateador esperado es ${expectedBatter}, no ${batterFromInput}. Revisa orden del lineup.`
      );
    }

    if (!batterIdentification && requiresBatter) {
      throw new BadRequestException('No se pudo resolver bateador actual para esta jugada.');
    }

    const basesBefore = game.playByPlay.baseRunners;
    let basesAfter: BaseRunnersRecord = {
      first: basesBefore.first,
      second: basesBefore.second,
      third: basesBefore.third
    };

    let inningAfter = game.officialState.inning;
    let outsAfter = game.officialState.outs;
    let ballsAfter = game.officialState.balls;
    let strikesAfter = game.officialState.strikes;
    let homeScoreAfter = game.officialState.homeScore;
    let awayScoreAfter = game.officialState.awayScore;
    let offenseTeamAfter = offenseTeamId;
    let plateCompleted = false;
    let outsRecorded = 0;
    let runsScored = 0;
    let description = '';
    let scoredRunnerIds: string[] = [];
    let awardRbiToBatter = false;
    let applyAtBatToBatter = false;
    let applyPlateAppearanceToBatter = false;
    let applyStrikeoutToBatter = false;
    let applyWalkToBatter = false;
    let applyHitByPitchToBatter = false;
    let applyReachedOnErrorToBatter = false;
    let batterHitKind: 'single' | 'double' | 'triple' | 'home_run' | null = null;

    const addRunsToScoreboard = (teamId: string, runs: number) => {
      if (runs <= 0) {
        return;
      }

      if (teamId === game.teams?.homeTeamId) {
        homeScoreAfter += runs;
        return;
      }

      awayScoreAfter += runs;
    };

    const registerRunnerScored = (runnerIds: string[]) => {
      for (const runnerId of runnerIds) {
        const stats = this.getOrCreateBatterStats(game, runnerId);
        stats.runs += 1;
      }
    };

    const fromBase = input.fromBase !== undefined ? this.requireBase(input.fromBase, 'playEvent.fromBase') : null;
    const toBase = input.toBase !== undefined ? this.requireTargetBase(input.toBase, 'playEvent.toBase') : null;

    if (type === 'STRIKE') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para STRIKE.');
      }

      if (strikesAfter >= 2) {
        outsRecorded = 1;
        plateCompleted = true;
        ballsAfter = 0;
        strikesAfter = 0;
        description = `${batterIdentification} se poncha.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
        applyStrikeoutToBatter = true;
      } else {
        strikesAfter += 1;
        description = `Strike para ${batterIdentification}.`;
      }

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
        pitcherStats.strikes += 1;
      }
    } else if (type === 'BALL') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para BALL.');
      }

      if (ballsAfter >= 3) {
        const walkResult = this.advanceRunnersForWalk(basesAfter, batterIdentification);
        basesAfter = walkResult.nextBases;
        runsScored = walkResult.runsScored;
        scoredRunnerIds = walkResult.scoredRunnerIds;
        plateCompleted = true;
        ballsAfter = 0;
        strikesAfter = 0;
        description = `${batterIdentification} recibe base por bolas.`;
        applyPlateAppearanceToBatter = true;
        applyWalkToBatter = true;
        awardRbiToBatter = runsScored > 0;
      } else {
        ballsAfter += 1;
        description = `Bola para ${batterIdentification}.`;
      }

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
        pitcherStats.balls += 1;
      }
    } else if (type === 'FOUL') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para FOUL.');
      }

      if (strikesAfter < 2) {
        strikesAfter += 1;
      }

      description = `Foul de ${batterIdentification}.`;

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
        pitcherStats.strikes += 1;
      }
    } else if (type === 'WALK') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para WALK.');
      }

      const walkResult = this.advanceRunnersForWalk(basesAfter, batterIdentification);
      basesAfter = walkResult.nextBases;
      runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : walkResult.runsScored;
      scoredRunnerIds = walkResult.scoredRunnerIds;
      plateCompleted = true;
      ballsAfter = 0;
      strikesAfter = 0;
      description = `${batterIdentification} recibe base por bolas.`;
      applyPlateAppearanceToBatter = true;
      applyWalkToBatter = true;
      awardRbiToBatter = runsScored > 0;
    } else if (type === 'HIT_BY_PITCH') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para HIT_BY_PITCH.');
      }

      const hbpResult = this.advanceRunnersForWalk(basesAfter, batterIdentification);
      basesAfter = hbpResult.nextBases;
      runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : hbpResult.runsScored;
      scoredRunnerIds = hbpResult.scoredRunnerIds;
      plateCompleted = true;
      ballsAfter = 0;
      strikesAfter = 0;
      description = `${batterIdentification} se embasa por pelotazo.`;
      applyPlateAppearanceToBatter = true;
      applyHitByPitchToBatter = true;
      awardRbiToBatter = runsScored > 0;

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
      }
    } else if (['HIT_SINGLE', 'HIT_DOUBLE', 'HIT_TRIPLE', 'HOME_RUN'].includes(type)) {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para evento de hit.');
      }

      const basesAwardedByType: Record<string, number> = {
        HIT_SINGLE: 1,
        HIT_DOUBLE: 2,
        HIT_TRIPLE: 3,
        HOME_RUN: 4
      };

      const hitResult = this.advanceRunnersForHit(
        basesAfter,
        batterIdentification,
        basesAwardedByType[type]
      );

      basesAfter = hitResult.nextBases;
      runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : hitResult.runsScored;
      scoredRunnerIds = hitResult.scoredRunnerIds;
      plateCompleted = true;
      ballsAfter = 0;
      strikesAfter = 0;
      applyPlateAppearanceToBatter = true;
      applyAtBatToBatter = true;
      awardRbiToBatter = runsScored > 0;

      if (type === 'HIT_SINGLE') {
        batterHitKind = 'single';
        description = `${batterIdentification} conecta sencillo.`;
      } else if (type === 'HIT_DOUBLE') {
        batterHitKind = 'double';
        description = `${batterIdentification} conecta doble.`;
      } else if (type === 'HIT_TRIPLE') {
        batterHitKind = 'triple';
        description = `${batterIdentification} conecta triple.`;
      } else {
        batterHitKind = 'home_run';
        description = `${batterIdentification} conecta home run.`;
      }

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
      }
    } else if (type === 'ERROR') {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para ERROR.');
      }

      const errorResult = this.advanceRunnersForWalk(basesAfter, batterIdentification);
      basesAfter = errorResult.nextBases;
      runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : errorResult.runsScored;
      scoredRunnerIds = errorResult.scoredRunnerIds;
      plateCompleted = true;
      ballsAfter = 0;
      strikesAfter = 0;
      description = `${batterIdentification} se embasa por error defensivo.`;
      applyPlateAppearanceToBatter = true;
      applyAtBatToBatter = true;
      applyReachedOnErrorToBatter = true;

      if (fielderFromInput) {
        const fieldingStats = this.getOrCreateFieldingStats(game, fielderFromInput);
        fieldingStats.errors += 1;
      }
    } else if (
      [
        'STRIKEOUT',
        'OUT',
        'GROUND_OUT',
        'FLY_OUT',
        'LINE_OUT',
        'SACRIFICE_FLY',
        'DOUBLE_PLAY',
        'TRIPLE_PLAY',
        'FORCE_OUT',
        'BUNT'
      ].includes(type)
    ) {
      if (!batterIdentification) {
        throw new BadRequestException('No se pudo resolver bateador para evento de out.');
      }

      outsRecorded =
        input.outsRecorded !== undefined
          ? this.requireIntegerRange(input.outsRecorded, 'playEvent.outsRecorded', 1, 3)
          : type === 'DOUBLE_PLAY'
            ? 2
            : type === 'TRIPLE_PLAY'
              ? 3
              : 1;

      plateCompleted = true;
      ballsAfter = 0;
      strikesAfter = 0;

      if (type === 'STRIKEOUT') {
        description = `${batterIdentification} se poncha.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
        applyStrikeoutToBatter = true;
      } else if (type === 'SACRIFICE_FLY') {
        description = `${batterIdentification} produce out de sacrificio.`;
        applyPlateAppearanceToBatter = true;
        const scoredFromBases = this.scoreFromBases(basesAfter, input.runsScored ?? 1);
        basesAfter = scoredFromBases.nextBases;
        runsScored = scoredFromBases.runsScored;
        scoredRunnerIds = scoredFromBases.scoredRunnerIds;
        awardRbiToBatter = runsScored > 0;
      } else if (type === 'DOUBLE_PLAY') {
        description = `${batterIdentification} batea para doble play.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
      } else if (type === 'TRIPLE_PLAY') {
        description = `${batterIdentification} batea para triple play.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
      } else if (type === 'FORCE_OUT') {
        description = `${batterIdentification} out forzado.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
      } else if (type === 'BUNT') {
        description = `${batterIdentification} out por toque de bola.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
      } else {
        description = `${batterIdentification} queda out.`;
        applyPlateAppearanceToBatter = true;
        applyAtBatToBatter = true;
      }

      if (type === 'GROUND_OUT') {
        description = `${batterIdentification} out por rolling.`;
      } else if (type === 'FLY_OUT') {
        description = `${batterIdentification} out por elevado.`;
      } else if (type === 'LINE_OUT') {
        description = `${batterIdentification} out por linea.`;
      }
    } else if (type === 'COURTESY_RUNNER') {
      if (!runnerFromInput) {
        throw new BadRequestException('playEvent.runnerIdentificationNumber es requerido para COURTESY_RUNNER.');
      }
      if (!fromBase) {
        throw new BadRequestException('playEvent.fromBase es requerido para COURTESY_RUNNER.');
      }

      const currentRunner =
        fromBase === 1 ? basesAfter.first : fromBase === 2 ? basesAfter.second : basesAfter.third;
      if (!currentRunner) {
        throw new BadRequestException(`No hay un corredor en la base ${fromBase}.`);
      }

      const replacedPlayer = lineup?.lineupEntries.find(
        (entry) => entry.identificationNumber === (game.playByPlay.courtesyFor[currentRunner] ?? currentRunner)
      );
      if (!replacedPlayer || !['P', 'C'].includes(replacedPlayer.fieldPosition)) {
        throw new BadRequestException('El corredor temporal solo puede reemplazar al pitcher o al receptor.');
      }

      if (
        [basesAfter.first, basesAfter.second, basesAfter.third].includes(runnerFromInput) ||
        runnerFromInput === currentRunner
      ) {
        throw new BadRequestException('El corredor temporal ya esta en base o es el jugador reemplazado.');
      }

      const tournament = this.getTournamentOrThrow(game.tournamentId);
      const teamRoster = this.getTeamRosterOrThrow(tournament, offenseTeamId);
      if (!teamRoster.playerIdentificationNumbers.has(runnerFromInput)) {
        throw new BadRequestException('El corredor temporal debe pertenecer al roster del equipo ofensivo.');
      }
      if (!this.globalPlayersByIdentification.has(runnerFromInput)) {
        throw new BadRequestException(`La cedula ${runnerFromInput} no existe en el registro global.`);
      }
      if (
        tournament.courtesyRunnerSource !== 'ROSTER' &&
        lineup?.lineupEntries.some((entry) => entry.identificationNumber === runnerFromInput)
      ) {
        throw new BadRequestException('La regla de este juego solo permite corredor temporal fuera del lineup.');
      }

      if (fromBase === 1) {
        basesAfter.first = runnerFromInput;
      } else if (fromBase === 2) {
        basesAfter.second = runnerFromInput;
      } else {
        basesAfter.third = runnerFromInput;
      }
      description = `${runnerFromInput} entra como corredor temporal por ${currentRunner} en base ${fromBase}.`;
    } else if (type === 'STEAL_BASE') {
      if (!runnerFromInput) {
        throw new BadRequestException('playEvent.runnerIdentificationNumber es requerido para STEAL_BASE.');
      }

      const currentBase = fromBase ?? this.findRunnerBase(basesAfter, runnerFromInput);
      if (!currentBase) {
        throw new BadRequestException(`No se encontro al corredor ${runnerFromInput} en las bases.`);
      }

      const nextBase = toBase ?? Math.min(4, currentBase + 1);
      const advanceResult = this.advanceSpecificRunner(basesAfter, runnerFromInput, currentBase, nextBase);
      basesAfter = advanceResult.nextBases;
      runsScored = advanceResult.runsScored;
      scoredRunnerIds = advanceResult.scoredRunnerIds;
      description = `${runnerFromInput} roba base.`;

      const runnerStats = this.getOrCreateBatterStats(game, runnerFromInput);
      runnerStats.stolenBases += 1;

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.stolenBasesAllowed += 1;
      }
    } else if (type === 'CAUGHT_STEALING') {
      if (!runnerFromInput) {
        throw new BadRequestException('playEvent.runnerIdentificationNumber es requerido para CAUGHT_STEALING.');
      }

      const currentBase = fromBase ?? this.findRunnerBase(basesAfter, runnerFromInput);
      if (!currentBase) {
        throw new BadRequestException(`No se encontro al corredor ${runnerFromInput} en las bases.`);
      }

      basesAfter = this.removeRunnerFromBase(basesAfter, currentBase);
      outsRecorded = 1;
      description = `${runnerFromInput} es puesto out en intento de robo.`;

      const runnerStats = this.getOrCreateBatterStats(game, runnerFromInput);
      runnerStats.caughtStealing += 1;
    } else if (type === 'PICKOFF' || type === 'RUNNER_OUT') {
      if (!runnerFromInput) {
        throw new BadRequestException('playEvent.runnerIdentificationNumber es requerido para PICKOFF.');
      }

      const currentBase = fromBase ?? this.findRunnerBase(basesAfter, runnerFromInput);
      if (!currentBase) {
        throw new BadRequestException(`No se encontro al corredor ${runnerFromInput} en las bases.`);
      }

      basesAfter = this.removeRunnerFromBase(basesAfter, currentBase);
      outsRecorded =
        input.outsRecorded !== undefined
          ? this.requireIntegerRange(input.outsRecorded, 'playEvent.outsRecorded', 1, 2)
          : 1;
      description = type === 'RUNNER_OUT' ? `${runnerFromInput} queda out en las bases.` : `${runnerFromInput} es puesto out por pickoff.`;

      const runnerStats = this.getOrCreateBatterStats(game, runnerFromInput);
      if (type === 'PICKOFF') runnerStats.caughtStealing += 1;
    } else if (type === 'BALK') {
      const balkResult = this.advanceAllRunnersOneBase(basesAfter);
      basesAfter = balkResult.nextBases;
      runsScored = balkResult.runsScored;
      scoredRunnerIds = balkResult.scoredRunnerIds;
      description = 'Balk del pitcher con avance de corredores.';

      if (pitcherFromInput) {
        const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);
        pitcherStats.pitches += 1;
      }
    } else if (type === 'DROPPED_FOUL') {
      description = `Error en foul que prolonga el turno de ${batterIdentification}.`;
      if (fielderFromInput) this.getOrCreateFieldingStats(game, fielderFromInput).errors += 1;
    } else if (['WILD_PITCH', 'PASSED_BALL', 'ERROR_ADVANCE', 'RUNNER_ADVANCE'].includes(type)) {
      if (['ERROR_ADVANCE', 'RUNNER_ADVANCE'].includes(type) && !runnerFromInput) {
        throw new BadRequestException('Identifica al corredor para registrar la causa de su avance.');
      }
      if (runnerFromInput) {
        const currentBase = fromBase ?? this.findRunnerBase(basesAfter, runnerFromInput);
        if (!currentBase) {
          throw new BadRequestException(`No se encontro al corredor ${runnerFromInput} en las bases.`);
        }

        const nextBase = toBase ?? Math.min(4, currentBase + 1);
        const advanceResult = this.advanceSpecificRunner(basesAfter, runnerFromInput, currentBase, nextBase);
        basesAfter = advanceResult.nextBases;
        runsScored = advanceResult.runsScored;
        scoredRunnerIds = advanceResult.scoredRunnerIds;
      }

      description = type === 'WILD_PITCH' ? 'Lanzamiento descontrolado con avance de corredores.' :
        type === 'PASSED_BALL' ? 'Bola pasada con avance de corredores.' :
        type === 'ERROR_ADVANCE' ? 'Avance por error defensivo.' : 'Avance de corredor sin error.';
      if (type === 'ERROR_ADVANCE' && fielderFromInput) this.getOrCreateFieldingStats(game, fielderFromInput).errors += 1;
    } else if (type === 'RUN_SCORED') {
      if (runnerFromInput) {
        const currentBase = fromBase ?? this.findRunnerBase(basesAfter, runnerFromInput);
        if (currentBase) {
          basesAfter = this.removeRunnerFromBase(basesAfter, currentBase);
          scoredRunnerIds = [runnerFromInput];
          runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : 1;
        } else {
          runsScored = input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : 1;
        }
      } else {
        const scoredFromBases = this.scoreFromBases(
          basesAfter,
          input.runsScored !== undefined ? this.requireNonNegativeInteger(input.runsScored, 'playEvent.runsScored') : 1
        );
        basesAfter = scoredFromBases.nextBases;
        runsScored = scoredFromBases.runsScored;
        scoredRunnerIds = scoredFromBases.scoredRunnerIds;
      }

      description = 'Carrera registrada.';
    } else {
      throw new BadRequestException(`Tipo de jugada no soportado: ${type}.`);
    }

    const previewLog = preview?.log.at(-1);
    if (preview && previewLog) {
      basesAfter = { first: preview.bases[0], second: preview.bases[1], third: preview.bases[2] };
      scoredRunnerIds = previewLog.runs;
      runsScored = previewLog.runs.length;
      outsRecorded = previewLog.outs;
      description = previewLog.text;
      if (type === 'BUNT') applyAtBatToBatter = false;
      awardRbiToBatter = previewLog.rbis > 0;
    }
    if (runsScored < scoredRunnerIds.length) {
      throw new BadRequestException('Las carreras indicadas no pueden ser menores que los corredores que anotaron en la jugada.');
    }
    if (runsScored > 0) {
      addRunsToScoreboard(offenseTeamId, runsScored);
      registerRunnerScored(scoredRunnerIds);
    }

    if (batterIdentification && applyPlateAppearanceToBatter) {
      const batterStats = this.getOrCreateBatterStats(game, batterIdentification);
      batterStats.plateAppearances += 1;

      if (applyAtBatToBatter) {
        batterStats.atBats += 1;
      }

      if (applyWalkToBatter) {
        batterStats.walks += 1;
      }

      if (applyHitByPitchToBatter) {
        batterStats.hitByPitch += 1;
      }

      if (applyStrikeoutToBatter) {
        batterStats.strikeouts += 1;
      }

      if (outsRecorded > 0) {
        batterStats.outs += outsRecorded;
      }

      if (batterHitKind) {
        batterStats.hits += 1;
        if (batterHitKind === 'single') {
          batterStats.singles += 1;
        } else if (batterHitKind === 'double') {
          batterStats.doubles += 1;
        } else if (batterHitKind === 'triple') {
          batterStats.triples += 1;
        } else {
          batterStats.homeRuns += 1;
        }
      }

      if (applyReachedOnErrorToBatter) {
        batterStats.reachedOnError += 1;
      }

      if (awardRbiToBatter && runsScored > 0) {
        batterStats.rbis += runsScored;
      }
    }

    if (pitcherFromInput) {
      const pitcherStats = this.getOrCreatePitcherStats(game, pitcherFromInput);

      if (applyPlateAppearanceToBatter) {
        pitcherStats.battersFaced += 1;
      }

      if (applyWalkToBatter) {
        pitcherStats.walksAllowed += 1;
      }

      if (applyStrikeoutToBatter) {
        pitcherStats.strikeouts += 1;
      }

      if (batterHitKind) {
        pitcherStats.hitsAllowed += 1;
        if (batterHitKind === 'home_run') {
          pitcherStats.homeRunsAllowed += 1;
        }
      }

      if (outsRecorded > 0) {
        pitcherStats.outsRecorded += outsRecorded;
      }

    }

    if (fielderFromInput && outsRecorded > 0) {
      const fieldingStats = this.getOrCreateFieldingStats(game, fielderFromInput);
      fieldingStats.outsRecorded += outsRecorded;
    }

    const accountedBasesAfter = [basesAfter.first, basesAfter.second, basesAfter.third];
    const nextAccounting = accountRuns(game.playByPlay.runAccounting, {
      eventId: game.playByPlay.sequence + 1,
      half: `${game.officialState.inning}:${offenseTeamId}`, offenseId: offenseTeamId,
      pitcherId: pitcherFromInput, outsBefore: game.officialState.outs,
      batterId: batterIdentification, plateCompleted, reachedOnError: type === 'ERROR',
      basesBefore: [basesBefore.first, basesBefore.second, basesBefore.third],
      basesAfter: accountedBasesAfter, scored: scoredRunnerIds, totalRuns: runsScored,
      misplay: ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(type) ? 'error' : type === 'PASSED_BALL' ? 'passedBall' : undefined,
      errorOuts: type === 'DROPPED_FOUL' ? 1 : input.errorOuts,
      unknownAdvance: type === 'RUN_SCORED',
      homeRun: type === 'HOME_RUN',
      uncertainPlay: ['DOUBLE_PLAY', 'TRIPLE_PLAY', 'FORCE_OUT'].includes(type),
      prolongedBatter: type === 'DROPPED_FOUL',
      ballsBefore: game.officialState.balls, strikesBefore: game.officialState.strikes, walk: applyWalkToBatter,
      eliminated: outsRecorded ? [...[basesBefore.first, basesBefore.second, basesBefore.third], ...(plateCompleted ? [batterIdentification] : [])]
        .filter((id): id is string => id !== null && !accountedBasesAfter.includes(id) && !scoredRunnerIds.includes(id)) : [],
      replacement: type === 'COURTESY_RUNNER' && fromBase && runnerFromInput && [basesBefore.first, basesBefore.second, basesBefore.third][fromBase - 1] ?
        { outgoing: [basesBefore.first, basesBefore.second, basesBefore.third][fromBase - 1]!, incoming: runnerFromInput } : undefined
    });
    for (const run of nextAccounting.runs.filter((entry) => entry.eventId === game.playByPlay.sequence + 1)) {
      if (run.pitcherId) this.getOrCreatePitcherStats(game, run.pitcherId).runsAllowed += run.count;
    }
    game.playByPlay.runAccounting = nextAccounting;
    if (applyWalkToBatter && batterIdentification) {
      const owner = nextAccounting.runners[batterIdentification]?.pitcherId ?? null;
      if (owner !== pitcherFromInput) {
        if (pitcherFromInput) this.getOrCreatePitcherStats(game, pitcherFromInput).walksAllowed -= 1;
        if (owner) this.getOrCreatePitcherStats(game, owner).walksAllowed += 1;
      }
    }

    if (outsRecorded > 0) {
      const totalOuts = outsAfter + outsRecorded;
      if (totalOuts >= 3) {
        outsAfter = 0;
        if (offenseTeamId === game.teams?.homeTeamId) inningAfter += 1;
        ballsAfter = 0;
        strikesAfter = 0;
        basesAfter = { first: null, second: null, third: null };
        offenseTeamAfter = defenseTeamId;
      } else {
        outsAfter = totalOuts;
      }
    }

    if (plateCompleted && lineup && lineup.playerIdentificationNumbers.length > 0) {
      lineup.currentBatterIndex = (lineup.currentBatterIndex + 1) % lineup.playerIdentificationNumbers.length;
      lineup.updatedAt = this.nowIso();
    }
    if (preview) {
      inningAfter = preview.inning;
      outsAfter = preview.outs;
      ballsAfter = preview.balls;
      strikesAfter = preview.strikes;
      offenseTeamAfter = preview.side === 'home' ? game.teams!.homeTeamId : game.teams!.awayTeamId;
      game.playByPlay.courtesyFor = preview.courtesyFor;
    }

    const note = this.normalizeOptionalText(input.note);

    game.playByPlay.baseRunners = basesAfter;
    game.playByPlay.sequence += 1;

    const eventRecord: OfficialPlayEventRecord = {
      sequence: game.playByPlay.sequence,
      inning: game.officialState.inning,
      type,
      battingTeamId: offenseTeamId,
      offenseTeamId: offenseTeamAfter,
      defenseTeamId,
      batterIdentificationNumber: batterIdentification ?? null,
      pitcherIdentificationNumber: pitcherFromInput,
      runnerIdentificationNumber: runnerFromInput,
      fielderIdentificationNumber: fielderFromInput,
      fromBase,
      toBase,
      runsScored,
      outsRecorded,
      ballsAfter,
      strikesAfter,
      outsAfter,
      inningAfter,
      homeScoreAfter,
      awayScoreAfter,
      description,
      note,
      timestamp: this.nowIso(),
      errorOuts: type === 'DROPPED_FOUL' ? 1 : input.errorOuts ?? null,
      scoredRunnerIds
    };

    game.playByPlay.events.push(eventRecord);
    const resultByType: Partial<Record<PlayEventType, PlayResult>> = {
      HIT_SINGLE: 'single', HIT_DOUBLE: 'double', HIT_TRIPLE: 'triple', HOME_RUN: 'homeRun', WALK: 'walk',
      HIT_BY_PITCH: 'hitByPitch', STRIKEOUT: 'strikeout', OUT: 'battedOut', GROUND_OUT: 'groundOut',
      FLY_OUT: 'flyOut', LINE_OUT: 'lineOut', SACRIFICE_FLY: 'sacrificeFly', DOUBLE_PLAY: 'doublePlay',
      TRIPLE_PLAY: 'triplePlay', FORCE_OUT: 'ruleOut', BUNT: 'sacrificeBunt', ERROR: 'error'
    };
    game.playByPlay.scorecardLog.push(previewLog ?? {
      inning: eventRecord.inning, side: offenseTeamId === game.teams?.homeTeamId ? 'home' : 'away',
      batterId: batterIdentification, runnerId: runnerFromInput,
      result: plateCompleted ? type === 'BALL' ? 'walk' : type === 'STRIKE' ? 'strikeout' : resultByType[type] ?? null : null,
      pitch: type === 'BALL' ? 'ball' : type === 'STRIKE' ? 'strike' : type === 'FOUL' ? 'foul' : null,
      text: description, runs: scoredRunnerIds, outs: outsRecorded,
      stolenBy: type === 'STEAL_BASE' ? runnerFromInput : null,
      rbis: awardRbiToBatter ? runsScored : 0, pitcherId: pitcherFromInput
    });
    if (plateCompleted && batterIdentification) {
      this.recordPlateAppearance(game, {
        inning: eventRecord.inning,
        offenseTeamId: eventRecord.battingTeamId,
        batterIdentificationNumber: batterIdentification,
        result: type,
        description,
        runsScored
      });
    }

    if (game.playByPlay.events.length > 500) {
      game.playByPlay.events = game.playByPlay.events.slice(-500);
    }

    return eventRecord;
  }

  private applyPatch(
    game: OfficialGameRecord,
    current: OfficialGameState,
    patch: OfficialScoringPatch,
    actorId: string,
    actorRole: OfficialActorRole
  ): OfficialGameState {
    const nextOffenseTeamId =
      patch.offenseTeamId !== undefined ? this.normalizeOptionalText(patch.offenseTeamId) : current.offenseTeamId;

    if (nextOffenseTeamId && game.teams) {
      if (nextOffenseTeamId !== game.teams.homeTeamId && nextOffenseTeamId !== game.teams.awayTeamId) {
        throw new BadRequestException(`offenseTeamId ${nextOffenseTeamId} no pertenece al juego.`);
      }
    }

    const requestedLastBatter =
      patch.lastBatterIdentificationNumber !== undefined
        ? patch.lastBatterIdentificationNumber
        : patch.lastBatterId;

    const requestedNextBatter =
      patch.nextBatterIdentificationNumber !== undefined
        ? patch.nextBatterIdentificationNumber
        : patch.nextBatterId;

    const next: OfficialGameState = {
      ...current,
      inning: patch.inning !== undefined ? this.requireIntegerRange(patch.inning, 'inning', 1, 99) : current.inning,
      outs: patch.outs !== undefined ? this.requireIntegerRange(patch.outs, 'outs', 0, 2) : current.outs,
      balls: patch.balls !== undefined ? this.requireIntegerRange(patch.balls, 'balls', 0, 3) : current.balls,
      strikes:
        patch.strikes !== undefined ? this.requireIntegerRange(patch.strikes, 'strikes', 0, 2) : current.strikes,
      homeScore:
        patch.homeScore !== undefined
          ? this.requireIntegerRange(patch.homeScore, 'homeScore', 0, 999)
          : current.homeScore,
      awayScore:
        patch.awayScore !== undefined
          ? this.requireIntegerRange(patch.awayScore, 'awayScore', 0, 999)
          : current.awayScore,
      status: patch.status ?? current.status,
      lastPlay: patch.lastPlay !== undefined ? this.requireText(patch.lastPlay, 'lastPlay') : current.lastPlay,
      offenseTeamId: nextOffenseTeamId,
      lastBatterId:
        requestedLastBatter !== undefined ? this.normalizeOptionalText(requestedLastBatter) : current.lastBatterId,
      nextBatterId:
        requestedNextBatter !== undefined ? this.normalizeOptionalText(requestedNextBatter) : current.nextBatterId,
      officialVersion: current.officialVersion + 1,
      updatedAt: this.nowIso(),
      updatedBy: { id: actorId, role: actorRole }
    };

    if (!['scheduled', 'in_progress', 'final'].includes(next.status)) {
      throw new BadRequestException('status debe ser scheduled, in_progress o final.');
    }

    return next;
  }

  private getTeamRosterOrThrow(tournament: TournamentAuthorizationRecord, teamIdRaw: string) {
    const teamId = this.requireText(teamIdRaw, 'teamId');
    const roster = tournament.teamRosters.get(teamId);

    if (!roster) {
      throw new NotFoundException(`No existe roster oficial para el equipo ${teamId}.`);
    }

    return roster;
  }

  private getTournamentOrThrow(tournamentIdRaw: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.tournamentAuthorizations.get(tournamentId);

    if (!tournament) {
      throw new NotFoundException(
        `No existe configuracion de autorizaciones para el torneo ${tournamentId}.`
      );
    }

    return tournament;
  }

  private getOrCreateGame(gameIdRaw: string, tournamentIdRaw: string) {
    const gameId = this.requireText(gameIdRaw, 'gameId');
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');

    const existing = this.games.get(gameId);
    if (existing) {
      if (existing.tournamentId !== tournamentId) {
        throw new BadRequestException(
          `El juego ${gameId} ya existe asociado al torneo ${existing.tournamentId}.`
        );
      }

      return existing;
    }

    const newGame: OfficialGameRecord = {
      scoringHistory: [],
      gameId,
      tournamentId,
      hasGameScopedAuthorization: false,
      gameAuthorizedScorekeepers: new Set<string>(),
      teams: null,
      lineups: new Map<string, GameLineupRecord>(),
      fieldRepresentatives: new Map<string, FieldRepresentativeRecord>(),
      teamSheets: new Map(),
      personnelRequests: [],
      personnelVersion: 0,
      officialState: {
        inning: 1,
        outs: 0,
        balls: 0,
        strikes: 0,
        homeScore: 0,
        awayScore: 0,
        status: 'scheduled',
        lastPlay: 'Sin eventos oficiales',
        offenseTeamId: null,
        lastBatterId: null,
        nextBatterId: null,
        officialVersion: 0,
        updatedAt: this.nowIso(),
        updatedBy: null
      },
      playByPlay: {
        scorecardLog: [],
        courtesyFor: {},
        sequence: 0,
        plateAppearanceSequence: 0,
        plateAppearances: [],
        baseRunners: {
          first: null,
          second: null,
          third: null
        },
        batterStatsByIdentification: new Map<string, BatterStatsRecord>(),
        pitcherStatsByIdentification: new Map<string, PitcherStatsRecord>(),
        fieldingStatsByIdentification: new Map<string, FieldingStatsRecord>(),
        events: [],
        runAccounting: createRunAccounting()
      },
      events: []
    };

    this.games.set(gameId, newGame);
    return newGame;
  }

  private serializeTournamentAuthorization(record: TournamentAuthorizationRecord) {
    return {
      tournamentId: record.tournamentId,
      organizerId: record.organizerId,
      subscriptionTier: record.subscriptionTier,
      courtesyRunnerSource: record.courtesyRunnerSource,
      authorizedScorekeeperIds: Array.from(record.authorizedScorekeepers.values()),
      registeredPlayers: this.globalPlayersByIdentification.size,
      playerRegistryScope: 'global',
      teamsWithRoster: Array.from(record.teamRosters.keys()),
      updatedAt: record.updatedAt
    };
  }

  private serializeGameAuthorization(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord) {
    const tournamentIds = Array.from(tournament.authorizedScorekeepers.values());
    const gameScopedIds = Array.from(game.gameAuthorizedScorekeepers.values());
    const effectiveIds = game.hasGameScopedAuthorization ? gameScopedIds : tournamentIds;

    return {
      gameId: game.gameId,
      tournamentId: game.tournamentId,
      hasGameScopedAuthorization: game.hasGameScopedAuthorization,
      tournamentAuthorizedScorekeeperIds: tournamentIds,
      gameAuthorizedScorekeeperIds: gameScopedIds,
      effectiveScorekeeperIds: effectiveIds,
      officialOrganizerId: tournament.organizerId
    };
  }

  private serializeLineupStatus(
    game: OfficialGameRecord,
    tournament: TournamentAuthorizationRecord,
    visibility: SubscriptionTier = tournament.subscriptionTier
  ): LineupProjection {
    const lineupRows = Array.from(game.lineups.values()).map((lineup) => {
      const currentBatterIdentificationNumber =
        lineup.playerIdentificationNumbers[lineup.currentBatterIndex] ?? null;
      const nextIndex = (lineup.currentBatterIndex + 1) % lineup.playerIdentificationNumbers.length;
      const nextBatterIdentificationNumber = lineup.playerIdentificationNumbers[nextIndex] ?? null;

      const lineupPlayers = lineup.lineupEntries
        .map((entry) => entry.identificationNumber)
        .map((id) => this.globalPlayersByIdentification.get(id))
        .filter((player): player is RegisteredPlayerRecord => Boolean(player))
        .map((player) => this.projectPlayer(player, visibility));

      const safeLineupEntries =
        Array.isArray(lineup.lineupEntries) && lineup.lineupEntries.length > 0
          ? lineup.lineupEntries
          : lineup.playerIdentificationNumbers.map((identificationNumber, index) => ({
              identificationNumber,
              battingOrder: index + 1,
              fieldPosition: 'NA',
              lineupRole: 'PLAYER' as const,
              jerseyNumber: null
            }));

      const lineupEntries = safeLineupEntries.map((entry) => {
        const player = this.globalPlayersByIdentification.get(entry.identificationNumber) ?? null;

        return {
          identificationNumber: entry.identificationNumber,
          playerId: entry.identificationNumber,
          battingOrder: entry.battingOrder,
          fieldPosition: entry.fieldPosition,
          lineupRole: entry.lineupRole ?? 'PLAYER',
          jerseyNumber: entry.jerseyNumber,
          player: player ? this.projectPlayer(player, visibility) : null
        };
      });

      return {
        teamId: lineup.teamId,
        managerId: lineup.managerId,
        lineupPlayerIdentificationNumbers: lineup.playerIdentificationNumbers,
        lineupPlayerIds: lineup.playerIdentificationNumbers,
        lineupEntries,
        lineupPlayers,
        courtesyRunnerSource: tournament.courtesyRunnerSource,
        currentBatterIndex: lineup.currentBatterIndex,
        currentBatterIdentificationNumber,
        currentBatterId: currentBatterIdentificationNumber,
        nextBatterIdentificationNumber,
        nextBatterId: nextBatterIdentificationNumber,
        updatedAt: lineup.updatedAt
      };
    });

    return {
      teams: game.teams,
      visibility,
      fieldRepresentatives: Array.from(game.fieldRepresentatives.keys()).flatMap((teamId) => {
        const representative = this.serializeFieldRepresentative(game, teamId);
        return representative ? [{ ...representative, teamId }] : [];
      }),
      lineups: lineupRows
    };
  }

  private serializeScorecard(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord): PrivateState {
    const home = game.teams?.homeTeamId, away = game.teams?.awayTeamId;
    const players = (teamId: string | undefined, initial = false): PrivatePlayer[] => {
      if (!teamId) return [];
      const entries = initial ? game.teamSheets.get(teamId)?.initialLineup : game.lineups.get(teamId)?.lineupEntries;
      return (entries ?? []).map((entry) => ({
        id: entry.identificationNumber,
        name: this.globalPlayersByIdentification.get(entry.identificationNumber)?.displayName ?? entry.identificationNumber,
        order: entry.battingOrder, position: entry.fieldPosition, jersey: entry.jerseyNumber ?? ''
      }));
    };
    const roster = (teamId: string | undefined): PrivatePlayer[] => {
      if (!teamId) return [];
      const known = [...players(teamId, true), ...players(teamId)];
      return Array.from(tournament.teamRosters.get(teamId)?.playerIdentificationNumbers ?? []).map((id) =>
        known.find((player) => player.id === id) ?? {
          id, name: this.globalPlayersByIdentification.get(id)?.displayName ?? id, order: null, position: 'NA', jersey: ''
        });
    };
    return {
      seed: {
        names: { home: home ?? 'Local', away: away ?? 'Visitante' },
        lineups: { home: players(home, true), away: players(away, true) },
        rosters: { home: roster(home), away: roster(away) },
        courtesyRunnerSource: tournament.courtesyRunnerSource,
        regulationInnings: game.regulationInnings
      },
      lineups: { home: players(home), away: players(away) },
      inning: game.officialState.inning, side: game.officialState.offenseTeamId === home ? 'home' : 'away',
      balls: game.officialState.balls, strikes: game.officialState.strikes, outs: game.officialState.outs,
      scores: { home: game.officialState.homeScore, away: game.officialState.awayScore },
      indexes: { home: home ? game.lineups.get(home)?.currentBatterIndex ?? 0 : 0, away: away ? game.lineups.get(away)?.currentBatterIndex ?? 0 : 0 },
      bases: [game.playByPlay.baseRunners.first, game.playByPlay.baseRunners.second, game.playByPlay.baseRunners.third],
      courtesyFor: structuredClone(game.playByPlay.courtesyFor), log: structuredClone(game.playByPlay.scorecardLog),
      finished: game.officialState.status === 'final', runAccounting: structuredClone(game.playByPlay.runAccounting)
    };
  }

  private serializePlayByPlay(
    game: OfficialGameRecord,
    tournament: TournamentAuthorizationRecord,
    visibility: SubscriptionTier = tournament.subscriptionTier
  ): PlayByPlayProjection {
    const batterStats = Array.from(game.playByPlay.batterStatsByIdentification.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'es'))
      .map(([identificationNumber, stats]) => {
        const player = this.globalPlayersByIdentification.get(identificationNumber) ?? null;

        return {
          identificationNumber,
          playerId: identificationNumber,
          player: player ? this.projectPlayer(player, visibility) : null,
          ...stats
        };
      });

    const pitcherStats = Array.from(game.playByPlay.pitcherStatsByIdentification.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'es'))
      .map(([identificationNumber, stats]) => {
        const player = this.globalPlayersByIdentification.get(identificationNumber) ?? null;
        const runs = runTotals(game.playByPlay.runAccounting.runs.filter((run) => run.pitcherId === identificationNumber), 'pitcher');

        return {
          identificationNumber,
          playerId: identificationNumber,
          player: player ? this.projectPlayer(player, visibility) : null,
          ...stats,
          earnedRuns: runs.earned,
          unearnedRuns: runs.unearned,
          pendingRuns: runs.pending
        };
      });

    const fieldingStats = Array.from(game.playByPlay.fieldingStatsByIdentification.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'es'))
      .map(([identificationNumber, stats]) => {
        const player = this.globalPlayersByIdentification.get(identificationNumber) ?? null;

        return {
          identificationNumber,
          playerId: identificationNumber,
          player: player ? this.projectPlayer(player, visibility) : null,
          ...stats
        };
      });

    return {
      scorecard: this.serializeScorecard(game, tournament),
      canUndo: game.scoringHistory.length > 0,
      lastScorecardCommand: game.scoringHistory.at(-1)?.command ?? null,
      runAccounting: {
        runs: structuredClone(game.playByPlay.runAccounting.runs),
        totals: runTotals(game.playByPlay.runAccounting.runs, 'team'),
        scoreMatches: runTotals(game.playByPlay.runAccounting.runs.filter((run) => run.offenseId === game.teams?.homeTeamId), 'team').total === game.officialState.homeScore &&
          runTotals(game.playByPlay.runAccounting.runs.filter((run) => run.offenseId === game.teams?.awayTeamId), 'team').total === game.officialState.awayScore
      },
      baseRunners: {
        first: game.playByPlay.baseRunners.first,
        second: game.playByPlay.baseRunners.second,
        third: game.playByPlay.baseRunners.third
      },
      totalEvents: game.playByPlay.events.length,
      recentEvents: game.playByPlay.events.slice(-120),
      plateAppearances: game.playByPlay.plateAppearances.map((plateAppearance) => ({
        ...plateAppearance
      })),
      fieldingErrors: game.playByPlay.events
        .filter(
          (event): event is OfficialPlayEventRecord & { fielderIdentificationNumber: string } =>
            ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(event.type) && Boolean(event.fielderIdentificationNumber)
        )
        .map((event) => ({
          sequence: event.sequence,
          inning: event.inning,
          defenseTeamId: event.defenseTeamId,
          fielderIdentificationNumber: event.fielderIdentificationNumber,
          description: event.description
        })),
      batterStats,
      pitcherStats,
      fieldingStats
    };
  }

  private resolveNextBatterId(game: OfficialGameRecord, teamId: string | null) {
    if (!teamId) {
      return null;
    }

    const lineup = game.lineups.get(teamId);
    if (!lineup || lineup.playerIdentificationNumbers.length === 0) {
      return null;
    }

    return lineup.playerIdentificationNumbers[lineup.currentBatterIndex] ?? null;
  }

  private requirePlayEventType(value: string): PlayEventType {
    const raw = this.requireText(value, 'playEvent.type');
    const normalized = raw
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    const aliases: Record<string, PlayEventType> = {
      STRIKE: 'STRIKE',
      PONCHE_CANTADO: 'STRIKE',
      BOLA: 'BALL',
      BALL: 'BALL',
      FOUL: 'FOUL',
      FAUL: 'FOUL',
      BASE_POR_BOLAS: 'WALK',
      BOLETO: 'WALK',
      WALK: 'WALK',
      PELOTAZO: 'HIT_BY_PITCH',
      HIT_BY_PITCH: 'HIT_BY_PITCH',
      HIT_SENCILLO: 'HIT_SINGLE',
      SENCILLO: 'HIT_SINGLE',
      SINGLE: 'HIT_SINGLE',
      HIT_SINGLE: 'HIT_SINGLE',
      HIT_DOBLE: 'HIT_DOUBLE',
      DOBLE: 'HIT_DOUBLE',
      DOUBLE: 'HIT_DOUBLE',
      HIT_DOUBLE: 'HIT_DOUBLE',
      HIT_TRIPLE: 'HIT_TRIPLE',
      TRIPLE: 'HIT_TRIPLE',
      HOME_RUN: 'HOME_RUN',
      JONRON: 'HOME_RUN',
      HUME_RUN: 'HOME_RUN',
      HOMERUN: 'HOME_RUN',
      STRIKEOUT: 'STRIKEOUT',
      PONCHE: 'STRIKEOUT',
      OUT: 'OUT',
      OUT_GENERAL: 'OUT',
      OUT_ROLLING: 'GROUND_OUT',
      GROUND_OUT: 'GROUND_OUT',
      ROLLING_OUT: 'GROUND_OUT',
      OUT_ELEVADO: 'FLY_OUT',
      FLY_OUT: 'FLY_OUT',
      OUT_LINEA: 'LINE_OUT',
      LINE_OUT: 'LINE_OUT',
      SACRIFICIO: 'SACRIFICE_FLY',
      SACRIFICE_FLY: 'SACRIFICE_FLY',
      ROBO_BASE: 'STEAL_BASE',
      STEAL_BASE: 'STEAL_BASE',
      ATRAPADO_ROBANDO: 'CAUGHT_STEALING',
      CAUGHT_STEALING: 'CAUGHT_STEALING',
      LANZAMIENTO_DESCONTROLADO: 'WILD_PITCH',
      WILD_PITCH: 'WILD_PITCH',
      BOLA_PASADA: 'PASSED_BALL',
      PASSED_BALL: 'PASSED_BALL',
      CARRERA: 'RUN_SCORED',
      RUN_SCORED: 'RUN_SCORED',
      CORREDOR_TEMPORAL: 'COURTESY_RUNNER',
      CORREDOR_DE_CORTESIA: 'COURTESY_RUNNER',
      COURTESY_RUNNER: 'COURTESY_RUNNER',
      ERROR: 'ERROR',
      ERROR_ADVANCE: 'ERROR_ADVANCE',
      RUNNER_ADVANCE: 'RUNNER_ADVANCE',
      DROPPED_FOUL: 'DROPPED_FOUL',
      DOBLE_PLAY: 'DOUBLE_PLAY',
      DOUBLE_PLAY: 'DOUBLE_PLAY',
      TRIPLE_PLAY: 'TRIPLE_PLAY',
      FORCE_OUT: 'FORCE_OUT',
      OUT_FORZADO: 'FORCE_OUT',
      PICKOFF: 'PICKOFF',
      RUNNER_OUT: 'RUNNER_OUT',
      PIKOFF: 'PICKOFF',
      BALK: 'BALK',
      BOLK: 'BALK',
      BUNT: 'BUNT',
      TOQUE: 'BUNT',
      TOQUE_DE_BOLA: 'BUNT'
    };

    const resolved = aliases[normalized];
    if (resolved) {
      return resolved;
    }

    const accepted = Array.from(new Set(Object.values(aliases))).sort();
    throw new BadRequestException(
      `playEvent.type invalido. Usa terminos como strike, bola, sencillo, doble, triple, jonron, out, error, robo_base, etc. Eventos soportados: ${accepted.join(', ')}.`
    );
  }

  private requireBase(value: number, field: string) {
    return this.requireIntegerRange(value, field, 1, 3);
  }

  private requireTargetBase(value: number, field: string) {
    return this.requireIntegerRange(value, field, 2, 4);
  }

  private requireNonNegativeInteger(value: number, field: string) {
    return this.requireIntegerRange(value, field, 0, 99);
  }

  private findRunnerBase(bases: BaseRunnersRecord, runnerIdentificationNumber: string) {
    if (bases.first === runnerIdentificationNumber) {
      return 1;
    }

    if (bases.second === runnerIdentificationNumber) {
      return 2;
    }

    if (bases.third === runnerIdentificationNumber) {
      return 3;
    }

    return null;
  }

  private removeRunnerFromBase(bases: BaseRunnersRecord, fromBase: number): BaseRunnersRecord {
    if (fromBase === 1) {
      return {
        first: null,
        second: bases.second,
        third: bases.third
      };
    }

    if (fromBase === 2) {
      return {
        first: bases.first,
        second: null,
        third: bases.third
      };
    }

    return {
      first: bases.first,
      second: bases.second,
      third: null
    };
  }

  private advanceSpecificRunner(
    bases: BaseRunnersRecord,
    runnerIdentificationNumber: string,
    fromBase: number,
    toBase: number
  ) {
    const runnerAtBase =
      fromBase === 1 ? bases.first : fromBase === 2 ? bases.second : bases.third;

    if (runnerAtBase !== runnerIdentificationNumber) {
      throw new BadRequestException(
        `El corredor ${runnerIdentificationNumber} no esta en la base ${fromBase}.`
      );
    }

    let nextBases = this.removeRunnerFromBase(bases, fromBase);
    let runsScored = 0;
    const scoredRunnerIds: string[] = [];

    if (toBase >= 4) {
      runsScored = 1;
      scoredRunnerIds.push(runnerIdentificationNumber);

      return {
        nextBases,
        runsScored,
        scoredRunnerIds
      };
    }

    if (toBase === 2) {
      if (nextBases.second) {
        throw new BadRequestException('La base destino 2B ya esta ocupada.');
      }

      nextBases = {
        ...nextBases,
        second: runnerIdentificationNumber
      };

      return {
        nextBases,
        runsScored,
        scoredRunnerIds
      };
    }

    if (nextBases.third) {
      throw new BadRequestException('La base destino 3B ya esta ocupada.');
    }

    nextBases = {
      ...nextBases,
      third: runnerIdentificationNumber
    };

    return {
      nextBases,
      runsScored,
      scoredRunnerIds
    };
  }

  private scoreFromBases(bases: BaseRunnersRecord, runsRequested: number) {
    const runs = Math.max(0, runsRequested);
    const scoredRunnerIds: string[] = [];
    let nextBases: BaseRunnersRecord = {
      first: bases.first,
      second: bases.second,
      third: bases.third
    };

    for (let index = 0; index < runs; index += 1) {
      if (nextBases.third) {
        scoredRunnerIds.push(nextBases.third);
        nextBases = {
          ...nextBases,
          third: null
        };
        continue;
      }

      if (nextBases.second) {
        scoredRunnerIds.push(nextBases.second);
        nextBases = {
          ...nextBases,
          second: null
        };
        continue;
      }

      if (nextBases.first) {
        scoredRunnerIds.push(nextBases.first);
        nextBases = {
          ...nextBases,
          first: null
        };
      }
    }

    return {
      nextBases,
      runsScored: scoredRunnerIds.length,
      scoredRunnerIds
    };
  }

  private advanceAllRunnersOneBase(bases: BaseRunnersRecord) {
    const scoredRunnerIds: string[] = [];

    if (bases.third) {
      scoredRunnerIds.push(bases.third);
    }

    return {
      nextBases: {
        first: null,
        second: bases.first,
        third: bases.second
      },
      runsScored: scoredRunnerIds.length,
      scoredRunnerIds
    };
  }

  private advanceRunnersForWalk(bases: BaseRunnersRecord, batterIdentificationNumber: string) {
    if (!bases.first) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.second,
          third: bases.third
        },
        runsScored: 0,
        scoredRunnerIds: [] as string[]
      };
    }

    if (!bases.second) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.first,
          third: bases.third
        },
        runsScored: 0,
        scoredRunnerIds: [] as string[]
      };
    }

    if (!bases.third) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.first,
          third: bases.second
        },
        runsScored: 0,
        scoredRunnerIds: [] as string[]
      };
    }

    return {
      nextBases: {
        first: batterIdentificationNumber,
        second: bases.first,
        third: bases.second
      },
      runsScored: 1,
      scoredRunnerIds: [bases.third]
    };
  }

  private advanceRunnersForHit(
    bases: BaseRunnersRecord,
    batterIdentificationNumber: string,
    basesAwarded: number
  ) {
    if (basesAwarded >= 4) {
      const scoredRunnerIds = [bases.first, bases.second, bases.third, batterIdentificationNumber].filter(
        (value): value is string => Boolean(value)
      );

      return {
        nextBases: {
          first: null,
          second: null,
          third: null
        },
        runsScored: scoredRunnerIds.length,
        scoredRunnerIds
      };
    }

    const runners = [
      { identificationNumber: bases.third, base: 3 },
      { identificationNumber: bases.second, base: 2 },
      { identificationNumber: bases.first, base: 1 }
    ].filter((item): item is { identificationNumber: string; base: number } => Boolean(item.identificationNumber));

    const nextBases: BaseRunnersRecord = {
      first: null,
      second: null,
      third: null
    };

    const scoredRunnerIds: string[] = [];

    for (const runner of runners) {
      const targetBase = runner.base + basesAwarded;
      if (targetBase >= 4) {
        scoredRunnerIds.push(runner.identificationNumber);
      } else if (targetBase === 3) {
        nextBases.third = runner.identificationNumber;
      } else if (targetBase === 2) {
        nextBases.second = runner.identificationNumber;
      } else {
        nextBases.first = runner.identificationNumber;
      }
    }

    if (basesAwarded === 3) {
      nextBases.third = batterIdentificationNumber;
    } else if (basesAwarded === 2) {
      nextBases.second = batterIdentificationNumber;
    } else {
      nextBases.first = batterIdentificationNumber;
    }

    return {
      nextBases,
      runsScored: scoredRunnerIds.length,
      scoredRunnerIds
    };
  }

  private getOrCreateBatterStats(game: OfficialGameRecord, identificationNumber: string) {
    const existing = game.playByPlay.batterStatsByIdentification.get(identificationNumber);
    if (existing) {
      return existing;
    }

    const created: BatterStatsRecord = {
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      singles: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      walks: 0,
      hitByPitch: 0,
      strikeouts: 0,
      runs: 0,
      rbis: 0,
      outs: 0,
      stolenBases: 0,
      caughtStealing: 0,
      reachedOnError: 0
    };

    game.playByPlay.batterStatsByIdentification.set(identificationNumber, created);
    return created;
  }

  private getOrCreatePitcherStats(game: OfficialGameRecord, identificationNumber: string) {
    const existing = game.playByPlay.pitcherStatsByIdentification.get(identificationNumber);
    if (existing) {
      return existing;
    }

    const created: PitcherStatsRecord = {
      pitches: 0,
      battersFaced: 0,
      strikes: 0,
      balls: 0,
      hitsAllowed: 0,
      runsAllowed: 0,
      walksAllowed: 0,
      strikeouts: 0,
      outsRecorded: 0,
      homeRunsAllowed: 0,
      stolenBasesAllowed: 0
    };

    game.playByPlay.pitcherStatsByIdentification.set(identificationNumber, created);
    return created;
  }

  private getOrCreateFieldingStats(game: OfficialGameRecord, identificationNumber: string) {
    const existing = game.playByPlay.fieldingStatsByIdentification.get(identificationNumber);
    if (existing) {
      return existing;
    }

    const created: FieldingStatsRecord = {
      outsRecorded: 0,
      errors: 0
    };

    game.playByPlay.fieldingStatsByIdentification.set(identificationNumber, created);
    return created;
  }

  private assertPlayersNotInOtherTeamRoster(
    tournament: TournamentAuthorizationRecord,
    teamId: string,
    playerIdentificationNumbers: string[]
  ) {
    for (const [otherTeamId, roster] of tournament.teamRosters.entries()) {
      if (otherTeamId === teamId) {
        continue;
      }

      for (const identificationNumber of playerIdentificationNumbers) {
        if (roster.playerIdentificationNumbers.has(identificationNumber)) {
          throw new BadRequestException(
            `La cedula ${identificationNumber} ya pertenece al roster del equipo ${otherTeamId} en este torneo.`
          );
        }
      }
    }
  }

  private assertManagerSingleTeamPerTournament(
    tournament: TournamentAuthorizationRecord,
    teamId: string,
    managerId: string
  ) {
    for (const [otherTeamId, roster] of tournament.teamRosters.entries()) {
      if (otherTeamId === teamId) {
        continue;
      }

      if (roster.managerId === managerId) {
        throw new BadRequestException(
          `El manager ${managerId} ya dirige el equipo ${otherTeamId} en este torneo. Puede dirigir otros equipos solo en torneos distintos.`
        );
      }
    }
  }

  private resolveVisibility(tournament: TournamentAuthorizationRecord, visibilityRaw?: string): SubscriptionTier {
    const requestedVisibility = visibilityRaw
      ? this.requireSubscriptionTier(visibilityRaw, 'visibility')
      : tournament.subscriptionTier;

    if (requestedVisibility === 'paid' && tournament.subscriptionTier !== 'paid') {
      throw new ForbiddenException('El torneo esta en version gratuita. Solo se muestran nombre y cedula.');
    }

    return requestedVisibility;
  }

  private projectPlayer(record: RegisteredPlayerRecord, visibility: SubscriptionTier): PlayerProjection {
    const base: PlayerFreeProjection = {
      displayName: record.displayName,
      identificationNumber: record.identificationNumber
    };

    if (visibility === 'free') {
      return base;
    }

    const paid: PlayerPaidProjection = {
      ...base,
      isMinor: record.isMinor,
      representativeIdentificationNumber: record.representativeIdentificationNumber,
      extraProfile: { ...record.extraProfile }
    };

    return paid;
  }

  private getOrCreateStream(gameIdRaw: string) {
    const gameId = this.requireText(gameIdRaw, 'gameId');
    const existing = this.streams.get(gameId);

    if (existing) {
      return existing;
    }

    const stream = new Subject<OfficialScoringStreamPayload>();
    this.streams.set(gameId, stream);
    return stream;
  }

  private sanitizeIds(input: string[], field: string) {
    if (!Array.isArray(input)) {
      throw new BadRequestException(`${field} debe ser un arreglo de IDs.`);
    }

    const normalized = input
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);

    return Array.from(new Set(normalized));
  }

  private sanitizeIdentificationList(input: string[], field: string) {
    if (!Array.isArray(input)) {
      throw new BadRequestException(`${field} debe ser un arreglo de cedulas.`);
    }

    const normalized = input
      .map((id) => this.normalizeIdentificationNumber(id, field))
      .filter((id) => id.length > 0);

    if (normalized.length === 0) {
      throw new BadRequestException(`${field} no puede estar vacio.`);
    }

    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException(`${field} no puede contener cedulas repetidas.`);
    }

    return normalized;
  }

  private sanitizeLineupEntries(
    entries:
      | Array<{
          identificationNumber: string;
          battingOrder: number | null;
          fieldPosition: string;
          lineupRole?: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
          jerseyNumber?: string;
        }>
      | undefined,
    fallbackPlayers: string[],
    field: string
  ) {
    const source =
      Array.isArray(entries) && entries.length > 0
        ? entries
        : fallbackPlayers.map((identificationNumber, index) => ({
            identificationNumber,
            battingOrder: index + 1,
            fieldPosition: 'NA',
            lineupRole: 'PLAYER' as const,
            jerseyNumber: undefined
          }));

    if (source.length === 0) {
      throw new BadRequestException(`${field} no puede estar vacio.`);
    }

    const normalized = source.map((entry) => {
      const identificationNumber = this.normalizeIdentificationNumber(
        entry.identificationNumber,
        `${field}.identificationNumber`
      );

      const lineupRole = entry.lineupRole ?? 'PLAYER';
      if (!['PLAYER', 'DP', 'FLEX', 'EH'].includes(lineupRole)) {
        throw new BadRequestException(`${field}.lineupRole invalido.`);
      }

      const battingOrder =
        entry.battingOrder === null
          ? null
          : this.requireIntegerRange(entry.battingOrder, `${field}.battingOrder`, 1, 13);
      if ((lineupRole === 'FLEX') !== (battingOrder === null)) {
        throw new BadRequestException(`${field}: FLEX debe ser el unico rol sin turno en el orden de bateo.`);
      }

      const fieldPosition = this.normalizeFieldPosition(entry.fieldPosition, `${field}.fieldPosition`);
      if (lineupRole === 'FLEX' && fieldPosition === 'NA') {
        throw new BadRequestException(`${field}: FLEX debe tener una posicion defensiva.`);
      }
      const jerseyNumber = entry.jerseyNumber === undefined
        ? null
        : this.normalizeJerseyNumber(entry.jerseyNumber, `${field}.jerseyNumber`);

      return {
        identificationNumber,
        battingOrder,
        fieldPosition,
        lineupRole,
        jerseyNumber
      };
    });

    const byPlayer = new Set(normalized.map((entry) => entry.identificationNumber));
    if (byPlayer.size !== normalized.length) {
      throw new BadRequestException(`${field} no puede tener cedulas repetidas.`);
    }
    const duplicatePosition = findDuplicateFieldPosition(normalized);
    if (duplicatePosition) {
      throw new BadRequestException(`${field}: la posición ${duplicatePosition} ya está ocupada; no se permiten posiciones repetidas.`);
    }

    const battingEntries = normalized.filter((entry) => entry.battingOrder !== null);
    if (battingEntries.length < 9 || battingEntries.length > 13) {
      throw new BadRequestException(`${field} debe tener entre 9 y 13 bateadores.`);
    }

    if (normalized.length > 14) {
      throw new BadRequestException(`${field} permite hasta 13 bateadores y un FLEX.`);
    }

    const byBattingOrder = new Set(battingEntries.map((entry) => entry.battingOrder));
    if (byBattingOrder.size !== battingEntries.length) {
      throw new BadRequestException(`${field} no puede tener posiciones de bateo repetidas.`);
    }
    const orderedBattingEntries = [...battingEntries].sort(
      (left, right) => (left.battingOrder ?? 0) - (right.battingOrder ?? 0)
    );
    if (orderedBattingEntries.some((entry, index) => entry.battingOrder !== index + 1)) {
      throw new BadRequestException(`${field} debe ordenar a los bateadores consecutivamente del 1 al total.`);
    }

    const designatedHitters = normalized.filter((entry) => entry.lineupRole === 'DP').length;
    const flexPlayers = normalized.filter((entry) => entry.lineupRole === 'FLEX').length;
    if (designatedHitters !== flexPlayers || flexPlayers > 1) {
      throw new BadRequestException(`${field}: DP y FLEX deben registrarse juntos, con un jugador de cada rol.`);
    }

    const jerseyNumbers = normalized
      .map((entry) => entry.jerseyNumber)
      .filter((jerseyNumber): jerseyNumber is string => jerseyNumber !== null);
    if (new Set(jerseyNumbers).size !== jerseyNumbers.length) {
      throw new BadRequestException(`${field} no puede tener numeros de camiseta repetidos.`);
    }

    return [...normalized].sort(
      (a, b) => (a.battingOrder ?? Number.MAX_SAFE_INTEGER) - (b.battingOrder ?? Number.MAX_SAFE_INTEGER)
    );
  }

  private normalizeJerseyNumber(value: string, field: string) {
    const normalized = this.requireText(value, field);
    if (!/^\d{1,2}$/.test(normalized)) {
      throw new BadRequestException(`${field} debe ser un numero de camiseta entre 0 y 99.`);
    }
    return normalized;
  }

  private normalizeFieldPosition(value: string, field: string) {
    const normalized = this.requireText(value, field).toUpperCase();
    const accepted = lineupFieldPositions;

    if (!accepted.includes(normalized)) {
      throw new BadRequestException(
        `${field} invalida. Usa una de: ${accepted.join(', ')}.`
      );
    }

    return normalized;
  }

  private normalizeIdentificationNumber(value: string, field: string) {
    const raw = this.requireText(value, field).toUpperCase();
    const normalized = raw.replace(/[^A-Z0-9]/g, '');

    if (normalized.length < 4) {
      throw new BadRequestException(`${field} debe tener al menos 4 caracteres alfanumericos.`);
    }

    return normalized;
  }

  private sanitizeExtraProfile(extraProfile?: TournamentPlayerExtraProfileInput): TournamentPlayerExtraProfileInput {
    if (!extraProfile) {
      return {};
    }

    return {
      birthDate: this.normalizeOptionalText(extraProfile.birthDate),
      phone: this.normalizeOptionalText(extraProfile.phone),
      email: this.normalizeOptionalText(extraProfile.email),
      city: this.normalizeOptionalText(extraProfile.city),
      notes: this.normalizeOptionalText(extraProfile.notes)
    };
  }

  private requireText(value: string, field: string) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${field} es requerido.`);
    }

    return normalized;
  }

  private normalizeOptionalText(value: string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private requireSubscriptionTier(value: string, field = 'subscriptionTier'): SubscriptionTier {
    if (value === 'free' || value === 'paid') {
      return value;
    }

    throw new BadRequestException(`${field} debe ser free o paid.`);
  }

  private requireIntegerRange(value: number, field: string, min: number, max: number) {
    if (!Number.isInteger(value)) {
      throw new BadRequestException(`${field} debe ser entero.`);
    }

    if (value < min || value > max) {
      throw new BadRequestException(`${field} debe estar entre ${min} y ${max}.`);
    }

    return value;
  }

  private nowIso() {
    return new Date().toISOString();
  }
}
