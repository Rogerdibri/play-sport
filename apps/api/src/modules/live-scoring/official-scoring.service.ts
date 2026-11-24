import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { RegistrationService, type RosterRulesContext } from './registration.service';
import { isCalendarDate, isGameTime, isProfileLocation as isProfileLocationForPlan, type GameSuspension, type ManagerRosterTeam, type RosterPerson, type RosterRole } from '@playsport/shared';
import type { PersonnelAction, PersonnelRequest, PresentOfficial, TeamSheetPlayer, TeamSheetsSnapshot } from '@playsport/shared';
import { isPresentOfficialRole } from '@playsport/shared';
import {
  accountRuns, createRunAccounting, findDuplicateFieldPosition, lineupFieldPositions, lineupSizeError,
  reviewAccountedRun, runTotals, validRunEvidence, validRunReview,
  applyPrivateCommand, assertScoringSubmission, declaredScoringRules, noAtBatResults, reachedOnErrorResults, isScorecardCommand, minimumDestinations, isOfficialGameDetails, isSoftballScorecard, placeSoftballTieBreakerRunner, softballTieBreakerNotice,
  type AccountedRun, type RunAccounting, type RunReview, type PrivateCommand,
  type PrivateState, type PrivatePlayer, type PrivateLog, type PlayResult, type DefensiveError, type StrikeoutType,
  type OfficialGameDetails, type OfficialGameSummary, type OfficialGamesSnapshot, type OfficialGameStatus, type GameProtest, type OfficialStandingGame
} from '@playsport/shared';
import { Observable, Subject } from 'rxjs';
import { deserialize, serialize } from 'node:v8';
import { createHash, randomUUID } from 'node:crypto';
import { OfficialStateStore } from './official-state.store';
import { supportsOfficialTournamentScoring, type TournamentDocument, type RosterMember, type InstitutionKind } from '@playsport/shared';
import { scorecardStatistics, calculateStatisticsRates, createGameReport, managerTeamKey,
  type ManagedTeam, type ManagerStatisticsPlayer, type GameFinalReview, type StatisticsGame, type StatisticsSnapshot } from '@playsport/shared';
import type { CareerGame, CareerRole } from '@playsport/shared';
import { changeGameClock, pauseGameClock, isGameClock, isGameClockAction, isTimedScoringCommand, startOrResumeGameClock, type GameClock } from '@playsport/shared';
import { readScorekeeperSubstitutions, type ScorekeeperSubstitutionState } from '@playsport/shared';
import type { OrganizerFreeReservation, OrganizerPlanRequest, OrganizerPlanAuthorization, OrganizerGameRestart } from '@playsport/shared';
import { OrganizerCapacityState } from './organizer-capacity-state';

type InstitutionalIdentity = {
  kind: InstitutionKind; id: string; name: string; organizerId: string; managerId: string | null;
  tournamentId: string; managerOwned: boolean; ownerAccountId?: string;
};

type TournamentPlanning = {
  document: (id: string) => TournamentDocument | null;
  assertParticipation: (tournamentId: string, gameId: string, teamId: string, players: string[], kind: 'roster' | 'lineup' | 'play') => void;
  managerAccount?: (tournamentId: string, managerId: string, accountId: string) => boolean;
  organizerAccount?: (tournamentId: string, accountId: string) => boolean;
  published?: (tournamentId: string) => boolean;
  institutions?: (includePrivate: boolean) => InstitutionalIdentity[];
  organizerCapacity?: (tournamentId: string) => { accountId: string; legacy: boolean } | null;
};

type OfficialActorRole = 'organizer' | 'scorekeeper';

type AppRole = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';

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
  privateRegistration?: boolean;
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
  officialIdentifications: Set<string>;
  participantIdentifications: Set<string>;
  updatedAt: string;
};

type OfficialGameState = {
  clock?: GameClock;
  protest?: GameProtest;
  suspension?: GameSuspension;
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
  fielderPosition?: string;
  strikeoutType?: StrikeoutType;
  battedBallType?: PrivateLog['battedBallType'];
  fieldingSequence?: number[];
  caughtBy?: PrivateLog['caughtBy'];
  infieldFly?: true;
  batterRuleOut?: PrivateLog['batterRuleOut'];
  ruleOut?: PrivateLog['ruleOut'];
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
  finalReview?: GameFinalReview;
  tieBreakerRunner?: PrivateState['tieBreakerRunner'];
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
  replacementPending?: boolean;
  operationStartedAt?: string;
  scorekeeperSubstitutions?: ScorekeeperSubstitutionState;
  plannedProjectionSignature?: string;
  plannedScorekeeperIds?: string[];
  chatFinishedAt?: string | null;
  hasStarted: boolean;
  suspensionArchives: Array<{ suspension: GameSuspension; state: OfficialGameState; lineup: LineupProjection; playByPlay: PlayByPlayProjection }>;
  scoringActors: Set<string>;
  regulationInnings?: 7 | 9;
  softballTieBreakerFromInning?: number;
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
  details: OfficialGameDetails | null;
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
    errorIndex: number;
    position: string | null;
    type: DefensiveError['type'] | null;
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
  organizerIdentificationNumber?: string;
  scorekeeperIdentities?: Array<{ actorId: string; identificationNumber: string }>;
  subscriptionTier?: SubscriptionTier;
  rosterRules?: unknown;
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
  managerIdentificationNumber?: string;
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
  clockAction?: unknown;
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

function OfficialMutation<Args extends unknown[], Result>(
  _target: OfficialScoringService, _name: string,
  descriptor: TypedPropertyDescriptor<(..._args: Args) => Result>
) {
  const original = descriptor.value;
  if (!original) throw new Error('Falta la operación deportiva transaccional.');
  descriptor.value = function(this: OfficialScoringService, ...args: Args): Result {
    return this.runOfficialMutation(() => original.apply(this, args));
  };
}

@Injectable()
export class OfficialScoringService {
  private readonly organizerCapacity = new OrganizerCapacityState();
  organizerFreeAccess(accountId: string) { return this.organizerCapacity.access(accountId); }
  organizerGameUsage(tournamentId: string) { return this.organizerCapacity.usage(tournamentId); }
  organizerPlan(tournamentId: string) { return this.organizerCapacity.plan(tournamentId); }
  organizerPlanRevision(tournamentId: string) { return this.organizerCapacity.planRevision(tournamentId); }
  organizerRestarts(tournamentId: string) { return this.organizerCapacity.restarts(tournamentId); }
  @OfficialMutation
  selectOrganizerPlan(input: OrganizerPlanRequest) { return this.organizerCapacity.select(input); }
  @OfficialMutation
  authorizeOrganizerPlan(input: OrganizerPlanAuthorization) { return this.organizerCapacity.authorize(input, this.nowIso()); }
  @OfficialMutation
  restartOrganizerGame(input: OrganizerGameRestart, organizerId: string) {
    const tournament = this.getTournamentOrThrow(input.tournamentId), game = this.games.get(input.gameId);
    if (tournament.organizerId !== organizerId) throw new ForbiddenException('Solo el organizador de este torneo puede anular el partido.');
    if (!game || game.tournamentId !== input.tournamentId) throw new NotFoundException('El partido no pertenece al torneo.');
    const key = `restart:${input.expectedAccountId}:${input.requestId}`;
    const replay = this.organizerCapacity.replay(key, input);
    if (replay !== undefined) return { appliedRevision: replay, replayed: true };
    if (!['in_progress','suspended'].includes(game.officialState.status) || game.officialState.protest)
      throw new ConflictException('Solo se anulan por fuerza mayor partidos en curso o suspendidos, nunca finalizados ni bajo protesta.');
    this.assertProtestVersion(game, input.expectedOfficialVersion);
    const previousAttempt = this.organizerCapacity.restarts(input.tournamentId).filter(row => row.gameId === input.gameId).at(-1);
    this.games.delete(input.gameId);
    const replacement = this.getOrCreateGame(input.gameId, input.tournamentId);
    replacement.teams = game.teams; replacement.details = game.details; replacement.regulationInnings = game.regulationInnings;
    replacement.replacementPending = true;
    replacement.softballTieBreakerFromInning = (game.regulationInnings ?? 7) + 1;
    replacement.hasGameScopedAuthorization = game.hasGameScopedAuthorization;
    replacement.gameAuthorizedScorekeepers = new Set(game.gameAuthorizedScorekeepers);
    replacement.plannedProjectionSignature = game.plannedProjectionSignature;
    replacement.plannedScorekeeperIds = game.plannedScorekeeperIds ? [...game.plannedScorekeeperIds] : undefined;
    if (game.scorekeeperSubstitutions) replacement.scorekeeperSubstitutions = { ...game.scorekeeperSubstitutions,
      members: structuredClone(game.scorekeeperSubstitutions.members), audit: structuredClone(game.scorekeeperSubstitutions.audit), movements: [] };
    replacement.officialState.officialVersion = game.officialState.officialVersion + 1;
    replacement.personnelVersion = game.personnelVersion + 1;
    replacement.officialState.updatedBy = { id: organizerId, role: 'organizer' };
    this.organizerCapacity.recordRestart({ accountId: input.expectedAccountId, tournamentId: input.tournamentId, gameId: input.gameId,
      organizerId, cancelledAttemptId: previousAttempt?.replacementAttemptId ?? randomUUID(), replacementAttemptId: randomUUID(),
      at: this.nowIso(), reason: input.reason });
    this.publishPersonnel(replacement, tournament); this.publishScoringAvailability();
    this.organizerCapacity.record(key, input, replacement.officialState.officialVersion);
    return { appliedRevision: replacement.officialState.officialVersion, replayed: false };
  }
  organizerGameOperationAllowed(tournamentId: string, gameId: string) {
    const mode = this.tournamentPlanning?.organizerCapacity?.(tournamentId);
    if (!mode || mode.legacy) return true;
    const doc = this.tournamentPlanning?.document(tournamentId);
    if (!doc) throw new ConflictException('Falta el plan para validar la capacidad de este torneo.');
    return doc.fixtures.some(fixture => this.plannedGameId(tournamentId, fixture.id) === gameId && this.tieBreakerReady(doc, fixture.phaseId)) &&
      this.organizerCapacity.allows(mode.accountId, doc, gameId);
  }
  private tieBreakerReady(doc: TournamentDocument, phaseId: string) {
    const phase = doc.phases.find(phase => phase.id === phaseId);
    if (phase?.purpose !== 'tie-breaker') return true;
    const source = doc.phases.find(row => row.id === phase.sourcePhaseId);
    const fixtures = doc.fixtures.filter(row => row.phaseId === source?.id);
    return source?.status === 'finished' && fixtures.length > 0 &&
      fixtures.every(fixture => this.games.get(this.plannedGameId(doc.id, fixture.id))?.officialState.status === 'final');
  }
  @OfficialMutation
  reserveOrganizerFree(input: OrganizerFreeReservation) { return this.organizerCapacity.reserve(input); }
  private tournamentPlanning?: TournamentPlanning;
  setTournamentPlanning(planning: TournamentPlanning) { this.tournamentPlanning = planning; }
  accountManagesTournament(tournamentId: string, managerId: string, accountId: string) {
    return this.tournamentPlanning?.managerAccount?.(tournamentId, managerId, accountId) === true;
  }
  accountOrganizesTournament(tournamentId: string, accountId: string) {
    return this.tournamentPlanning?.organizerAccount?.(tournamentId, accountId) === true;
  }
  actorAssignedTournament(tournamentId: string, actorId: string) {
    return this.tournamentAuthorizations.get(tournamentId)?.authorizedScorekeepers.has(actorId) === true;
  }
  accountHasInscription(tournamentId: string, accountId: string, teamId?: string) {
    return this.tournamentPlanning?.document(tournamentId)?.teams.some(team => team.enrollment && (!teamId || team.id === teamId) &&
      this.accountManagesTournament(tournamentId, team.managerId, accountId)) === true;
  }
  hasManagedInscriptions(tournamentId: string) {
    return this.tournamentPlanning?.document(tournamentId)?.teams.some(team => team.enrollment) === true;
  }
  assertPlannedRosterEditable(tournamentId: string, teamId: string) {
    this.tournamentPlanning?.assertParticipation(tournamentId, '', teamId, [], 'roster');
  }
  plannedActors(doc: TournamentDocument, organizerId = 'org-demo') {
    const pending = new Map<string, string>();
    pending.set(organizerId, this.requireActorIdentity(organizerId));
    for (const team of doc.teams) if (team.managerId)
      pending.set(team.managerId, this.prepareActorIdentity(pending, team.managerId, team.managerIdentification || undefined));
    for (const fixture of doc.fixtures) for (const actor of fixture.scorekeeperIds)
      pending.set(actor, this.requireActorIdentity(actor));
    return [...pending].map(([actorId, identification]) => ({ actorId, identification }));
  }
  @OfficialMutation
  restorePlannedActors(rows: Array<{ actorId: string; identification: string }>) {
    const pending = new Map<string, string>();
    for (const row of rows) this.prepareActorIdentity(pending, row.actorId, row.identification);
    this.commitActorIdentities(pending);
  }
  plannedGameId(tournamentId: string, fixtureId: string) { return `plan:${tournamentId}:${fixtureId}`; }
  plannedFixtureAvailable(tournamentId: string, fixtureId: string) {
    const game = this.games.get(this.plannedGameId(tournamentId, fixtureId));
    return game?.tournamentId === tournamentId && Boolean(game.details);
  }
  plannedRoster(tournamentId: string, teamId: string): RosterMember[] {
    const tournament = this.tournamentAuthorizations.get(tournamentId), roster = tournament?.teamRosters.get(teamId);
    if (!roster) return [];
    const direct = this.registration?.rosterMembers({ tournamentId, teamId, managerId: roster.managerId,
      teamName: teamId, tournamentName: tournamentId }) ?? [];
    const found = new Set(direct.map(member => member.person.id));
    const approved: RosterMember[] = [...roster.playerIdentificationNumbers].flatMap(id => {
      const person = this.registration?.rosterPerson(id) ?? this.lookupRosterPerson(id);
      if (!person) throw new ConflictException('No se pudo resolver un integrante del roster.');
      return found.has(person.id) ? [] : [{ person, role: 'PLAYER', approvalStatus: 'approved' }];
    });
    return [...approved, ...direct];
  }
  validatePlannedTournament(doc: TournamentDocument, previous?: TournamentDocument, organizerId = 'org-demo') {
    for (const sanction of doc.sanctions) if (sanction.target === 'player') {
      const person = this.registration?.rosterPerson(sanction.targetId) ?? this.lookupRosterPerson(sanction.targetId);
      if (!person) throw new ConflictException('La sanción debe identificar a un jugador real del registro o roster.');
      sanction.targetId = person.id;
    }
    const pending = new Map<string, string>();
    const managerTeams = new Set<string>();
    const participantIdentities = new Set<string>();
    const officialIdentities = new Set<string>([this.requireActorIdentity(organizerId)]);
    for (const fixture of doc.fixtures) for (const actor of fixture.scorekeeperIds) officialIdentities.add(this.requireActorIdentity(actor));
    for (const team of doc.teams) {
      if (team.managerId) {
        const identity = this.prepareActorIdentity(pending, team.managerId, team.managerIdentification || undefined);
        if (officialIdentities.has(identity)) throw new ConflictException('Una persona no puede ser manager y organizador o anotador del mismo torneo.');
        if (participantIdentities.has(identity)) throw new ConflictException('La misma persona no puede dirigir dos equipos del torneo con cuentas distintas.');
        participantIdentities.add(identity);
        if (managerTeams.has(team.managerId)) throw new ConflictException('Un mismo manager no puede dirigir dos equipos en este torneo.');
        managerTeams.add(team.managerId);
      }
      const different = this.institutionalIdentities().find(row => row.kind === 'team' && row.id === team.id && row.name !== row.id && row.name !== team.name);
      if (different && !team.enrollment) throw new ConflictException(`El ID ${team.id} pertenece a ${different.name}. Conserva su identidad o usa un ID de equipo nuevo.`);
      const old = previous?.teams.find(row => row.id === team.id);
      if (old?.enrollment && old.name !== team.name && [...this.games.values()].some(game =>
        game.tournamentId === doc.id && game.teams && [game.teams.homeTeamId, game.teams.awayTeamId].includes(team.id) &&
        (game.officialState.officialVersion > 0 || game.teamSheets.size > 0 || game.lineups.size > 0)))
        throw new ConflictException('El nombre de esta inscripción ya figura en un partido con alineación o anotación. No se reescribió su historial.');
      if (old?.managerId && old.managerId !== team.managerId && this.tournamentAuthorizations.get(doc.id)?.teamRosters.has(team.id))
        throw new ConflictException('Cambiar el manager requiere reasignar expresamente su identidad deportiva; no se reemplazó desde el plan.');
    }
    if (previous?.teams.some(team => !doc.teams.some(current => current.id === team.id)))
      throw new ConflictException('Conserva los equipos inscritos. Usa Retirado para no borrar su historial.');
    if (previous) for (const old of previous.fixtures) {
      const game = this.games.get(this.plannedGameId(doc.id, old.id));
      if (!game) continue;
      const fixture = doc.fixtures.find(row => row.id === old.id);
      if (!fixture) throw new ConflictException('No se puede borrar un encuentro publicado. Conserva su historial y gestiona su situación.');
      if (game.officialState.officialVersion > 0 || game.teamSheets.size > 0 || game.lineups.size > 0) {
        const protectedFields = game.replacementPending && !game.hasStarted && !game.teamSheets.size && !game.lineups.size ?
          ['phaseId','homeTeamId','awayTeamId','round','series','scorekeeperIds'] as const :
          ['phaseId','homeTeamId','awayTeamId','date','time','venueId','round','series','scorekeeperIds'] as const;
        if (protectedFields.some(field => JSON.stringify(old[field]) !== JSON.stringify(fixture[field])))
          throw new ConflictException('Este encuentro ya tiene alineaciones o anotación. Usa las herramientas oficiales de suspensión y reprogramación.');
        const phase = previous.phases.find(row => row.id === old.phaseId), current = doc.phases.find(row => row.id === old.phaseId);
        if (phase && current && ((phase.purpose ?? 'regular') !== (current.purpose ?? 'regular') ||
            ['kind','turns','bestOf','pairing'].some(key => phase[key as keyof typeof phase] !== current[key as keyof typeof current])))
          throw new ConflictException('La modalidad de una fase con encuentros iniciados no puede reescribirse. Crea una fase nueva.');
      }
    }
    for (const fixture of doc.fixtures.filter(row => row.date && row.time)) {
      const start = Date.parse(`${fixture.date}T${fixture.time}:00-04:00`);
      const venue = doc.venues.find(row => row.id === fixture.venueId);
      for (const game of this.games.values()) {
        if (game.tournamentId === doc.id || !game.details || !game.teams || game.officialState.status === 'final') continue;
        const other = Date.parse(`${game.details.date}T${game.details.time}:00-04:00`);
        const otherPlan = this.tournamentPlanning?.document(game.tournamentId);
        const otherFixture = otherPlan?.fixtures.find(row => this.plannedGameId(otherPlan.id, row.id) === game.gameId);
        if (start >= other + (otherFixture?.durationMinutes ?? 120) * 60000 || other >= start + fixture.durationMinutes * 60000) continue;
        if ([fixture.homeTeamId, fixture.awayTeamId].some(id => id && [game.teams?.homeTeamId, game.teams?.awayTeamId].includes(id)) ||
            fixture.scorekeeperIds.some(id => game.gameAuthorizedScorekeepers.has(id)) ||
            venue?.name === game.details.venue && venue.stateId === game.details.stateId && venue.municipalityId === game.details.municipalityId)
          throw new ConflictException('El horario se superpone con otro partido oficial del equipo, sede o anotador. Revisa la cartelera.');
      }
    }
    for (const fixture of doc.fixtures) for (const actor of fixture.scorekeeperIds) {
      const identity = this.requireActorIdentity(actor), tournament = this.tournamentAuthorizations.get(doc.id);
      if (tournament) this.assertRoleCompatible(tournament, identity, 'official');
    }
  }
  @OfficialMutation
  projectPlannedTournament(doc: TournamentDocument, published: boolean, organizerId = 'org-demo') {
    if (!published && !doc.teams.some(team => team.enrollment)) return;
    let tournament = this.tournamentAuthorizations.get(doc.id);
    let changed = false;
    const scorekeepers = [...new Set(doc.fixtures.flatMap(game => game.scorekeeperIds))];
    if (!tournament) {
      this.configureTournamentAuthorization({ tournamentId: doc.id, organizerId, scorekeeperIds: scorekeepers });
      tournament = this.getTournamentOrThrow(doc.id);
      changed = true;
    } else {
      if (tournament.organizerId !== organizerId) throw new ConflictException('La propiedad deportiva del torneo no coincide con su plan.');
      changed = tournament.authorizedScorekeepers.size !== scorekeepers.length ||
        scorekeepers.some(actor => !tournament!.authorizedScorekeepers.has(actor));
      tournament.authorizedScorekeepers = new Set(scorekeepers);
      for (const actor of [organizerId, ...scorekeepers]) tournament.officialIdentifications.add(this.requireActorIdentity(actor));
    }
    for (const team of doc.teams) {
      if (!team.managerId || tournament.teamRosters.has(team.id)) continue;
      const identities = new Map<string, string>();
      const manager = this.prepareActorIdentity(identities, team.managerId, team.managerIdentification || undefined);
      this.commitActorIdentities(identities);
      tournament.participantIdentifications.add(manager);
      tournament.teamRosters.set(team.id, { tournamentId: doc.id, teamId: team.id, managerId: team.managerId,
        playerIdentificationNumbers: new Set<string>(), updatedAt: this.nowIso() });
      changed = true;
    }
    if (!published || !supportsOfficialTournamentScoring(doc.sport)) return;
    for (const fixture of doc.fixtures) {
      if (!fixture.homeTeamId || !fixture.awayTeamId || !tournament.teamRosters.has(fixture.homeTeamId) || !tournament.teamRosters.has(fixture.awayTeamId)) continue;
      const gameId = this.plannedGameId(doc.id, fixture.id), existing = this.games.get(gameId);
      const signature = createHash('sha256').update(JSON.stringify([fixture, doc.name, doc.leagueName,
        doc.teams.filter(team => [fixture.homeTeamId, fixture.awayTeamId].includes(team.id)).map(team => [team.id, team.name]),
        doc.venues.find(venue => venue.id === fixture.venueId)])).digest('hex');
      if (existing?.plannedProjectionSignature === signature) continue;
      if (existing && (existing.officialState.officialVersion > 0 && !(existing.replacementPending && !existing.hasStarted) ||
          existing.teamSheets.size > 0 || existing.lineups.size > 0)) continue;
      const game = this.getOrCreateGame(gameId, doc.id);
      game.plannedProjectionSignature = signature;
      changed = true;
      game.teams = { homeTeamId: fixture.homeTeamId, awayTeamId: fixture.awayTeamId };
      if (!game.plannedScorekeeperIds ||
          JSON.stringify(game.plannedScorekeeperIds) !== JSON.stringify(fixture.scorekeeperIds)) {
        game.hasGameScopedAuthorization = true; game.gameAuthorizedScorekeepers = new Set(fixture.scorekeeperIds);
      }
      game.plannedScorekeeperIds = [...fixture.scorekeeperIds];
      game.officialState.offenseTeamId = fixture.awayTeamId;
      const venue = doc.venues.find(row => row.id === fixture.venueId);
      game.details = fixture.date && fixture.time && venue && isProfileLocationForPlan(venue) ? {
        tournamentName: doc.name || doc.leagueName, homeTeamName: doc.teams.find(team => team.id === fixture.homeTeamId)!.name,
        awayTeamName: doc.teams.find(team => team.id === fixture.awayTeamId)!.name, date: fixture.date, time: fixture.time,
        venue: venue.name, stateId: venue.stateId, municipalityId: venue.municipalityId
      } : null;
    }
    if (changed) this.publishScoringAvailability();
  }
  private readonly tournamentAuthorizations = new Map<string, TournamentAuthorizationRecord>();
  private readonly globalPlayersByIdentification = new Map<string, RegisteredPlayerRecord>();
  private readonly games = new Map<string, OfficialGameRecord>();
  private readonly streams = new Map<string, Subject<OfficialScoringStreamPayload>>();
  private readonly personnelStreams = new Map<string, Subject<void>>();
  private readonly actorIdentifications = new Map<string, string>();
  private readonly registration?: RegistrationService;
  private readonly persistentStore?: OfficialStateStore;
  private mutationDepth = 0;
  private notifications: Array<() => void> = [];

  constructor(@Optional() registration?: RegistrationService, @Optional() options?: { path: string }) {
    this.registration = registration;
    this.persistentStore = options ? new OfficialStateStore(options.path) : undefined;
    try {
      const saved = this.persistentStore?.load();
      if (saved) this.restoreStoredState(saved);
      if (saved && registration && this.persistentStore?.registration() === null)
        throw new Error('Falta el registro deportivo de esta base. Restaura la copia; no se importó un registro antiguo.');
      if (this.persistentStore) registration?.usePersistentStore(this.persistentStore);
      this.refreshRegisteredMinors();
    } catch (error) {
      this.persistentStore?.close();
      throw error;
    }
  }

  onModuleDestroy() {
    for (const stream of this.streams.values()) stream.complete();
    for (const stream of this.personnelStreams.values()) stream.complete();
    this.persistentStore?.close();
  }

  private storedState() {
    return { games: this.games, tournamentAuthorizations: this.tournamentAuthorizations,
      globalPlayersByIdentification: this.globalPlayersByIdentification, actorIdentifications: this.actorIdentifications,
      organizerCapacity: this.organizerCapacity.export() };
  }

  private restoreStoredState(payload: Uint8Array) {
    const value: unknown = deserialize(payload);
    if (!value || typeof value !== 'object' ||
        !('games' in value) || !(value.games instanceof Map) ||
        !('tournamentAuthorizations' in value) || !(value.tournamentAuthorizations instanceof Map) ||
        !('globalPlayersByIdentification' in value) || !(value.globalPlayersByIdentification instanceof Map) ||
        !('actorIdentifications' in value) || !(value.actorIdentifications instanceof Map)) {
      throw new Error('El estado deportivo no tiene el formato esperado. No se inició un marcador vacío.');
    }
    for (const [id, game] of value.games) {
      if (typeof id !== 'string' || !game || game.gameId !== id || typeof game.tournamentId !== 'string' ||
          !game.officialState || !Number.isSafeInteger(game.officialState.officialVersion) ||
          game.replacementPending !== undefined && typeof game.replacementPending !== 'boolean' ||
          game.operationStartedAt !== undefined && (typeof game.operationStartedAt !== 'string' ||
            !Number.isFinite(Date.parse(game.operationStartedAt))) ||
          game.officialState.clock !== undefined && !isGameClock(game.officialState.clock) ||
          game.softballTieBreakerFromInning !== undefined &&
            (!Number.isSafeInteger(game.softballTieBreakerFromInning) || game.softballTieBreakerFromInning < 8) ||
          !(game.lineups instanceof Map) || !(game.teamSheets instanceof Map) ||
          !(game.scoringActors instanceof Set) || !Array.isArray(game.scoringHistory) || !game.playByPlay)
        throw new Error('Un partido persistente no es válido. No se sobrescribió.');
      if (game.scorekeeperSubstitutions !== undefined)
        readScorekeeperSubstitutions({ ...game.scorekeeperSubstitutions, accountId: 'stored', tournamentId: game.tournamentId, gameId: id },
          'stored', game.tournamentId, id);
    }
    for (const [id, tournament] of value.tournamentAuthorizations) {
      if (typeof id !== 'string' || !tournament || tournament.tournamentId !== id ||
          typeof tournament.organizerId !== 'string' || !(tournament.teamRosters instanceof Map) ||
          !(tournament.authorizedScorekeepers instanceof Set))
        throw new Error('Una autorización deportiva persistente no es válida.');
    }
    for (const [actor, identity] of value.actorIdentifications)
      if (typeof actor !== 'string' || typeof identity !== 'string') throw new Error('Una identidad deportiva guardada no es válida.');
    if ('organizerCapacity' in value) this.organizerCapacity.restore(value.organizerCapacity);
    this.games.clear();
    for (const [key, game] of value.games) {
      game.softballTieBreakerFromInning ??= Math.max((game.regulationInnings ?? 7) + 1, game.officialState.inning + 1);
      this.games.set(key, game);
    }
    this.tournamentAuthorizations.clear(); for (const [key, tournament] of value.tournamentAuthorizations) this.tournamentAuthorizations.set(key, tournament);
    this.globalPlayersByIdentification.clear(); for (const [key, player] of value.globalPlayersByIdentification) this.globalPlayersByIdentification.set(key, player);
    this.actorIdentifications.clear(); for (const [key, identity] of value.actorIdentifications) this.actorIdentifications.set(key, identity);
  }

  runOfficialMutation<T>(work: () => T): T {
    if (!this.persistentStore || this.mutationDepth) return work();
    const before = serialize(this.storedState());
    this.mutationDepth++;
    let result: T;
    try {
      result = this.persistentStore.transaction(() => {
        const answer = work();
        this.persistentStore!.save(serialize(this.storedState()));
        return answer;
      });
    } catch (error) {
      this.restoreStoredState(before);
      this.notifications = [];
      throw error;
    } finally {
      this.mutationDepth--;
    }
    const notifications = this.notifications;
    this.notifications = [];
    for (const notify of notifications) notify();
    return result;
  }

  private emitGameEvent(gameId: string, event: OfficialScoringStreamPayload) {
    const notify = () => this.getOrCreateStream(gameId).next(event);
    if (this.mutationDepth) this.notifications.push(notify);
    else notify();
  }

  private emitPersonnel(gameId: string) {
    const notify = () => this.personnelStreams.get(gameId)?.next();
    if (this.mutationDepth) this.notifications.push(notify);
    else notify();
  }

  @OfficialMutation
  refreshRegisteredMinors() {
    for (const minor of this.registration?.players() ?? []) {
      if (!this.globalPlayersByIdentification.has(minor.id)) {
        const now = this.nowIso();
        this.globalPlayersByIdentification.set(minor.id, {
          privateRegistration: true, displayName: minor.fullName, identificationNumber: minor.id,
          isMinor: true, representativeIdentificationNumber: null, extraProfile: {},
          createdAt: now, updatedAt: now, createdById: minor.representativeId
        });
      }
    }
  }

  hasExistingPlayerIdentity(identification: string) {
    const key = identification.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const player = this.globalPlayersByIdentification.get(key);
    return Boolean(player && !player.privateRegistration) ||
      Array.from(this.actorIdentifications.values()).includes(key) ||
      Array.from(this.tournamentAuthorizations.values()).some(tournament =>
        tournament.officialIdentifications.has(key) || tournament.participantIdentifications.has(key));
  }

  @OfficialMutation
  configureTournamentAuthorization(command: TournamentAuthorizationCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');
    const scorekeeperIds = this.sanitizeIds(command.scorekeeperIds, 'scorekeeperIds');

    const existing = this.tournamentAuthorizations.get(tournamentId);
    if (existing && existing.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial del torneo puede actualizar autorizaciones.');
    }
    if (existing) this.refreshDirectRosterMembers(existing);
    const identities = new Map<string, string>();
    const organizerIdentification = this.prepareActorIdentity(identities, organizerId, command.organizerIdentificationNumber);
    const suppliedScorekeepers = this.scorekeeperIdentityInputs(command.scorekeeperIdentities, scorekeeperIds);
    const officialIdentifications = new Set(existing?.officialIdentifications ?? []);
    for (const identificationNumber of [
      organizerIdentification,
      ...scorekeeperIds.map((id) => this.prepareActorIdentity(identities, id, suppliedScorekeepers.get(id)))
    ]) {
      if (existing) this.assertRoleCompatible(existing, identificationNumber, 'official');
      officialIdentifications.add(identificationNumber);
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
      officialIdentifications,
      participantIdentifications: existing?.participantIdentifications ?? new Set<string>(),
      updatedAt: this.nowIso()
    };

    if (command.rosterRules !== undefined) {
      if (existing) throw new BadRequestException('Modifica las reglas del roster en su panel, confirmando la revisión vigente.');
      if (!this.registration) throw new ConflictException('El registro persistente no está disponible para guardar las reglas.');
      this.registration.saveRosterRules({ tournamentId, organizerId, tournamentName: tournamentId, games: [], teamIds: [], members: {} },
        command.rosterRules, 0, false);
    }
    this.commitActorIdentities(identities);
    this.tournamentAuthorizations.set(tournamentId, nextRecord);
    if (existing) this.publishScoringAvailability();
    return this.serializeTournamentAuthorization(nextRecord);
  }

  @OfficialMutation
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

  @OfficialMutation
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

  @OfficialMutation
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
    if (isMinor) {
      throw new BadRequestException('Los menores deben inscribirse desde el registro familiar, con su representante y un identificador permanente.');
    }
    const representativeFromInput = command.player.representativeIdentificationNumber
      ? this.normalizeIdentificationNumber(
          command.player.representativeIdentificationNumber,
          'representativeIdentificationNumber'
        )
      : null;

    const representativeIdentificationNumber = representativeFromInput;

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

  @OfficialMutation
  registerTournamentPlayer(command: RegisterTournamentPlayerCommand) {
    const tournamentId = this.requireText(command.tournamentId, 'tournamentId');
    const organizerId = this.requireText(command.organizerId, 'organizerId');

    const tournament = this.getTournamentOrThrow(tournamentId);
    if (tournament.organizerId !== organizerId) {
      throw new ForbiddenException('Solo el organizador oficial puede registrar jugadores desde este endpoint.');
    }
    const participantIdentification = this.normalizeIdentificationNumber(command.player.identificationNumber, 'identificationNumber');
    this.assertRoleCompatible(tournament, participantIdentification, 'participant');

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
    tournament.participantIdentifications.add(participantIdentification);

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

  @OfficialMutation
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
      throw new ForbiddenException('Solo el organizador puede reemplazar la configuración oficial; el manager incorpora desde ROSTER.');
    }
    const existingRoster = tournament.teamRosters.get(teamId);
    const identities = new Map<string, string>();
    const managerIdentification = this.prepareActorIdentity(identities, managerId, command.managerIdentificationNumber);
    for (const identification of [managerIdentification, ...playerIdentificationNumbers]) {
      this.assertRoleCompatible(tournament, identification, 'participant');
    }

    if (existingRoster && existingRoster.managerId !== managerId && !isOrganizerOverride) {
      throw new ForbiddenException(
        `Solo el manager ${existingRoster.managerId} o el organizador pueden modificar el roster de ${teamId}.`
      );
    }

    this.assertManagerSingleTeamPerTournament(tournament, teamId, managerId, managerIdentification);

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

    this.registration?.configureOfficialRoster(this.rosterRulesContext(tournamentId), teamId,
      playerIdentificationNumbers.map(id => {
        const person = this.registration?.rosterPerson(id) ?? this.lookupRosterPerson(id);
        if (!person) throw new ConflictException('No se pudo resolver un integrante del roster.');
        return { person, role: 'PLAYER' as const, approvalStatus: 'approved' as const };
      }));
    this.commitActorIdentities(identities);
    for (const identification of [managerIdentification, ...playerIdentificationNumbers]) {
      tournament.participantIdentifications.add(identification);
    }
    tournament.teamRosters.set(teamId, roster);
    tournament.updatedAt = roster.updatedAt;
    for (const game of this.games.values()) {
      if (game.tournamentId !== tournamentId || game.officialState.status === 'final') continue;
      const representative = game.fieldRepresentatives.get(teamId);
      if (
        representative &&
        (!this.matchRosterPerson(tournament, teamId, representative.identificationNumber) ||
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

  @OfficialMutation
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
      this.assertRoleCompatible(tournament, this.requireActorIdentity(scorekeeperId), 'official');
    }

    const game = this.getOrCreateGame(gameId, tournamentId);
    game.hasGameScopedAuthorization = true;
    game.gameAuthorizedScorekeepers = new Set(scorekeeperIds);
    this.publishScoringAvailability();

    const authorization = this.serializeGameAuthorization(game, tournament);
    const event: OfficialScoringAuthorizationUpdatedEvent = {
      kind: 'authorization_updated',
      gameId,
      tournamentId,
      authorization,
      timestamp: this.nowIso()
    };

    game.events.push(event);
    this.emitGameEvent(gameId, event);

    return authorization;
  }

  getGameAuthorization(gameIdRaw: string, tournamentIdRaw: string) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameIdRaw, tournamentId);
    return this.serializeGameAuthorization(game, tournament);
  }

  listManagerRosterTeams(managerIdRaw: string): ManagerRosterTeam[] {
    const managerId = this.requireText(managerIdRaw, 'managerId');
    const teams: ManagerRosterTeam[] = [];
    for (const tournament of this.tournamentAuthorizations.values()) for (const roster of tournament.teamRosters.values()) {
      if (roster.managerId !== managerId) continue;
      const game = Array.from(this.games.values()).find(item => item.tournamentId === tournament.tournamentId &&
        item.teams && [item.teams.homeTeamId, item.teams.awayTeamId].includes(roster.teamId) && item.details);
      teams.push({ tournamentId: tournament.tournamentId, teamId: roster.teamId, managerId,
        tournamentName: this.tournamentPlanning?.document(tournament.tournamentId)?.name || this.tournamentPlanning?.document(tournament.tournamentId)?.leagueName || game?.details?.tournamentName || tournament.tournamentId,
        teamName: this.tournamentPlanning?.document(tournament.tournamentId)?.teams.find(team => team.id === roster.teamId)?.name ??
          (game?.teams?.homeTeamId === roster.teamId ? game.details?.homeTeamName ?? roster.teamId : game?.details?.awayTeamName ?? roster.teamId) });
    }
    return teams;
  }

  private sportingTournament(tournament: TournamentAuthorizationRecord): SportsTournament {
    const doc = this.tournamentPlanning?.document(tournament.tournamentId);
    const games = Array.from(this.games.values()).filter(game => game.tournamentId === tournament.tournamentId);
    return {
      id: tournament.tournamentId,
      name: doc?.name || doc?.leagueName || games.find(game => game.details)?.details?.tournamentName || tournament.tournamentId,
      leagueId: doc?.leagueId ?? '', leagueName: doc?.leagueName ?? '',
      location: doc && isProfileLocation(doc.location) ? { stateId: doc.location.stateId, municipalityId: doc.location.municipalityId } : null,
      teams: Array.from(tournament.teamRosters.keys()).flatMap(id => {
        const planned = doc?.teams.find(team => team.id === id);
        if (planned?.status === 'withdrawn') return [];
        const game = games.find(item => item.teams && [item.teams.homeTeamId, item.teams.awayTeamId].includes(id) && item.details);
        return [{ id, name: planned?.name ??
          (game?.teams?.homeTeamId === id ? game.details?.homeTeamName : game?.details?.awayTeamName) ?? id }];
      })
    };
  }

  listManagerSportsTeams(managerIdRaw: string, accountId: string): PlayerTeamMembership[] {
    return this.listManagerRosterTeams(managerIdRaw).flatMap(team => {
      const tournament = this.tournamentAuthorizations.get(team.tournamentId);
      if (!tournament) throw new ConflictException('El equipo asignado no tiene su torneo registrado.');
      const doc = this.tournamentPlanning?.document(team.tournamentId);
      const planned = doc?.teams.find(item => item.id === team.teamId);
      if (doc && !planned || planned?.status === 'withdrawn' || planned?.enrollment &&
          !this.accountManagesTournament(team.tournamentId, managerIdRaw, accountId)) return [];
      const competition = this.sportingTournament(tournament);
      return [{ tournamentId: competition.id, tournamentName: competition.name, teamId: team.teamId, teamName: team.teamName,
        leagueId: competition.leagueId, leagueName: competition.leagueName, location: competition.location }];
    });
  }

  publicSportsTournaments(): { tournaments: SportsTournament[] } {
    return { tournaments: Array.from(this.tournamentAuthorizations.values())
      .filter(tournament => !this.tournamentPlanning?.document(tournament.tournamentId) ||
        this.tournamentPlanning.published?.(tournament.tournamentId) === true)
      .map(tournament => this.sportingTournament(tournament)) };
  }

  listPlayerTeams(identification: string): PlayerTeamMembership[] {
    const key = this.normalizeIdentificationNumber(identification, 'identificación del jugador');
    const teams: PlayerTeamMembership[] = [];
    for (const tournament of this.tournamentAuthorizations.values()) {
      const doc = this.tournamentPlanning?.document(tournament.tournamentId);
      const direct = this.registration?.rosterPersonnel(tournament.tournamentId) ?? [];
      const context = this.sportingTournament(tournament);
      for (const roster of tournament.teamRosters.values()) {
        const planned = doc?.teams.find(team => team.id === roster.teamId);
        if (planned && (planned.status !== 'accepted' || planned.rosterStatus !== 'approved')) continue;
        const member = direct.some(row => row.teamId === roster.teamId && row.role === 'PLAYER' && this.rosterPersonKey(row.person) === key);
        const legacy = !planned?.enrollment && roster.playerIdentificationNumbers.has(key) &&
          !this.globalPlayersByIdentification.get(key)?.privateRegistration;
        if (!member && !legacy) continue;
        const team = context.teams.find(item => item.id === roster.teamId);
        if (!team) continue;
        teams.push({ tournamentId: context.id, tournamentName: context.name, teamId: team.id, teamName: team.name,
          leagueId: context.leagueId, leagueName: context.leagueName, location: context.location });
      }
    }
    return teams;
  }

  managerPlanTeams(managerId: string, accountId: string): ManagedTeam[] {
    const teams = new Map<string, ManagedTeam>();
    for (const team of this.listManagerRosterTeams(managerId)) {
      const doc = this.tournamentPlanning?.document(team.tournamentId);
      const planned = doc?.teams.find(item => item.id === team.teamId);
      if (planned?.enrollment && !this.accountManagesTournament(team.tournamentId, managerId, accountId)) continue;
      const active = (!doc || !['finished', 'cancelled'].includes(doc.status)) &&
        (!doc || planned?.managerId === managerId && planned.status !== 'withdrawn');
      teams.set(managerTeamKey(team), { tournamentId: team.tournamentId, tournamentName: team.tournamentName,
        teamId: team.teamId, teamName: team.teamName, active });
    }
    for (const game of this.games.values()) {
      if (!game.teams) continue;
      const doc = this.tournamentPlanning?.document(game.tournamentId);
      for (const side of ['home', 'away'] as const) {
        const teamId = side === 'home' ? game.teams.homeTeamId : game.teams.awayTeamId;
        const manager = game.teamSheets.get(teamId)?.managerId ?? game.lineups.get(teamId)?.managerId;
        const key = managerTeamKey({ tournamentId: game.tournamentId, teamId });
        if (manager !== managerId || teams.has(key)) continue;
        teams.set(key, { tournamentId: game.tournamentId,
          tournamentName: doc?.name || game.details?.tournamentName || game.tournamentId, teamId,
          teamName: (side === 'home' ? game.details?.homeTeamName : game.details?.awayTeamName) ??
            doc?.teams.find(team => team.id === teamId)?.name ?? teamId, active: false });
      }
    }
    return [...teams.values()];
  }
  managerStatistics(managerId: string) {
    const players: ManagerStatisticsPlayer[] = [];
    return { games: this.personalStatistics(null, managerId, 'team', players), players };
  }
  scorekeeperTournaments(actorId: string) {
    return [...this.tournamentAuthorizations.values()].filter(tournament => tournament.authorizedScorekeepers.has(actorId)).map(tournament => {
      const doc = this.tournamentPlanning?.document(tournament.tournamentId);
      return { tournamentId: tournament.tournamentId, tournamentName: doc?.name ??
        [...this.games.values()].find(game => game.tournamentId === tournament.tournamentId)?.details?.tournamentName ?? tournament.tournamentId,
        active: !doc || !['finished', 'cancelled'].includes(doc.status) };
    });
  }
  scorekeeperGameAssigned(actorId: string, tournamentId: string, gameId: string) {
    const game = this.games.get(gameId), tournament = this.tournamentAuthorizations.get(tournamentId);
    return Boolean(game && tournament && game.tournamentId === tournamentId && this.canWriteOfficial(game, tournament, actorId, 'scorekeeper'));
  }
  gameOperationStartedAt(tournamentId: string, gameId: string) {
    const game = this.games.get(gameId);
    return game?.tournamentId === tournamentId && game.officialState.status === 'in_progress' ?
      game.operationStartedAt ?? game.officialState.updatedAt : null;
  }
  isScorekeeperSubstitute(actorId: string, tournamentId: string, gameId: string) {
    const game = this.games.get(gameId);
    return Boolean(game?.tournamentId === tournamentId &&
      game.scorekeeperSubstitutions?.members.some(member => member.actorId === actorId && member.status === 'granted'));
  }
  scorekeeperSubstituteGames(actorId: string) {
    return [...this.games.values()].filter(game => this.isScorekeeperSubstitute(actorId, game.tournamentId, game.gameId)).map(game => ({
      tournamentId: game.tournamentId, gameId: game.gameId,
      tournamentName: this.tournamentPlanning?.document(game.tournamentId)?.name ?? game.details?.tournamentName ?? game.tournamentId
    }));
  }
  scorekeeperTournamentActive(tournamentId: string) {
    const doc = this.tournamentPlanning?.document(tournamentId);
    return !doc || !['finished', 'cancelled'].includes(doc.status);
  }
  scorekeeperSubstitutions(organizerId: string, tournamentId: string, gameId: string): ScorekeeperSubstitutionState {
    const tournament = this.getTournamentOrThrow(tournamentId), game = this.games.get(gameId);
    if (tournament.organizerId !== organizerId) throw new ForbiddenException('Solo el organizador de este torneo puede autorizar suplencias.');
    if (!game || game.tournamentId !== tournamentId) throw new ForbiddenException('El partido no pertenece a este torneo.');
    return structuredClone(game.scorekeeperSubstitutions ?? { revision: 0, members: [], audit: [] });
  }
  @OfficialMutation
  changeScorekeeperSubstitution(command: {
    organizerId: string; tournamentId: string; gameId: string; expectedRevision: number; action: 'grant' | 'revoke';
    substituteActorId: string; name?: string; identification?: string; reason: string;
  }) {
    const state = this.scorekeeperSubstitutions(command.organizerId, command.tournamentId, command.gameId);
    if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 || command.expectedRevision >= Number.MAX_SAFE_INTEGER ||
        !['grant', 'revoke'].includes(command.action) || !command.substituteActorId.startsWith('person:') ||
        typeof command.reason !== 'string' || !command.reason.trim() || command.reason.length > 500)
      throw new BadRequestException('Completa el suplente, la revisión y el motivo de la autorización.');
    if (state.revision !== command.expectedRevision) throw new ConflictException('Las suplencias cambiaron en otro dispositivo. Actualiza antes de guardar.');
    const tournament = this.getTournamentOrThrow(command.tournamentId), game = this.games.get(command.gameId)!;
    let member = state.members.find(row => row.actorId === command.substituteActorId);
    if (command.action === 'grant') {
      if (!this.scorekeeperTournamentActive(command.tournamentId) || !['scheduled', 'in_progress'].includes(game.officialState.status))
        throw new ConflictException('Solo puedes autorizar suplencias de partidos pendientes o en curso de un torneo activo.');
      if (!command.identification || !command.name?.trim()) throw new BadRequestException('El suplente requiere una cuenta con identidad verificada.');
      if (command.organizerId === command.substituteActorId) throw new ConflictException('El organizador ya tiene su propio permiso oficial; no puede suplirse a sí mismo.');
      const identities = new Map<string, string>();
      const identity = this.prepareActorIdentity(identities, command.substituteActorId, command.identification);
      this.assertRoleCompatible(tournament, identity, 'official');
      this.commitActorIdentities(identities);
      tournament.officialIdentifications.add(identity);
      if (!member) { member = { actorId: command.substituteActorId, name: command.name.trim(), status: 'granted' }; state.members.push(member); }
      else { member.name = command.name.trim(); member.status = 'granted'; }
    } else {
      if (!member) throw new BadRequestException('Este usuario no tiene una suplencia registrada en el partido.');
      member.status = 'revoked';
    }
    state.revision++;
    state.audit.push({ revision: state.revision, actorId: command.substituteActorId, organizerId: command.organizerId,
      action: command.action, reason: command.reason.trim(), at: this.nowIso() });
    game.scorekeeperSubstitutions = state;
    this.publishScoringAvailability();
    return structuredClone(state);
  }
  scorekeeperStatistics(actorId: string, tournamentId: string, gameId?: string) {
    if (!this.actorAssignedTournament(tournamentId, actorId) && !(gameId && this.isScorekeeperSubstitute(actorId, tournamentId, gameId)))
      throw new ForbiddenException('No tienes este torneo o partido asignado como Anotador.');
    if (gameId && this.games.get(gameId)?.tournamentId !== tournamentId) throw new ForbiddenException('Este partido no pertenece al torneo autorizado.');
    const players: ManagerStatisticsPlayer[] = [];
    return { games: this.personalStatistics(null, actorId, 'team', players, { tournamentId, gameId }), players };
  }
  personalStatistics(identification: string | null, managerId: string | null, mode: StatisticsSnapshot['mode'],
    players?: ManagerStatisticsPlayer[], scope?: { tournamentId: string; gameId?: string }): StatisticsGame[] {
    const person = identification === null ? null : this.normalizeIdentificationNumber(identification, 'identificación del jugador');
    const publicIds = new Set(this.publicSportsTournaments().tournaments.map(tournament => tournament.id));
    const rows: StatisticsGame[] = [];
    for (const game of this.games.values()) {
      if (!game.teams) continue;
      if (scope && (game.tournamentId !== scope.tournamentId || scope.gameId && game.gameId !== scope.gameId)) continue;
      const doc = this.tournamentPlanning?.document(game.tournamentId);
      const normalizedSport = doc?.sport.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const sport = normalizedSport === 'baseball' || normalizedSport === 'beisbol' ? 'baseball' :
        normalizedSport === 'softball' || normalizedSport === 'softbol' ? 'softball' : null;
      if (doc && sport === null) continue;
      const rule = doc?.customRules.find(item => item.name.trim().toLowerCase() === 'base del pcl');
      const eraBase = rule ? rule.value.trim() === '7' ? 7 : 9 : sport === 'baseball' ? 9 : sport === 'softball' ? 7 : null;
      const state = this.serializeScorecard(game, this.getTournamentOrThrow(game.tournamentId));
      for (const side of ['home', 'away'] as const) {
        const teamId = side === 'home' ? game.teams.homeTeamId : game.teams.awayTeamId;
        const initial = game.teamSheets.get(teamId)?.initialLineup ?? [];
        const positions = this.gameParticipantPositions(game, state, teamId, side);
        const manager = game.teamSheets.get(teamId)?.managerId ?? game.lineups.get(teamId)?.managerId;
        if (!scope && (mode === 'player' ? person === null || !positions.has(person) : managerId === null || manager !== managerId)) continue;
        if (rule && !['7', '9'].includes(rule.value.trim())) throw new ConflictException('La regla «Base del PCL» del torneo debe indicar 7 o 9.');
        const allIds = mode === 'player' ? [person!] : [...positions.keys()];
        const groups = players && mode === 'team' ? [allIds, ...allIds.map(id => [id])] : [allIds];
        for (const [index, ids] of groups.entries()) {
          const individual = mode === 'player' || index > 0;
          const ownPositions = [...new Set(ids.flatMap(id => [...(positions.get(id) ?? [])]))];
          const defense = state.log.filter(entry => entry.side !== side);
          const fullEvents = game.playByPlay.events.length === game.playByPlay.sequence;
          const errorEvents = game.playByPlay.events.filter(event => event.defenseTeamId === teamId &&
            ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(event.type));
          const caughtStealing = fullEvents ? game.playByPlay.events.filter(event => event.battingTeamId === teamId &&
            event.type === 'CAUGHT_STEALING' && event.runnerIdentificationNumber && ids.includes(event.runnerIdentificationNumber)).length : null;
          const errors = !fullEvents || individual && errorEvents.some(event => !event.fielderIdentificationNumber) ? null :
            !individual ? ids.reduce((sum, id) => sum + (game.playByPlay.fieldingStatsByIdentification.get(id)?.errors ?? 0), 0) +
              errorEvents.filter(event => !event.fielderIdentificationNumber).length :
              ids.reduce((sum, id) => sum + (game.playByPlay.fieldingStatsByIdentification.get(id)?.errors ?? 0), 0);
          const complete = this.statisticsSourceComplete(game, state);
          const unknownPitching = defense.some(entry => (entry.result || entry.outs || entry.runs.length || entry.pitch) && !entry.pitcherId) ||
            state.runAccounting.runs.some(run => run.offenseId !== teamId && run.pitcherId === null);
          const line = complete ? calculateStatisticsRates(scorecardStatistics(state, side, ids, {
            team: !individual, positions: ownPositions, caughtStealing, errors, offenseId: teamId,
            startingPitcherIds: initial.length ? initial.filter(entry => entry.fieldPosition === 'P').map(entry => entry.identificationNumber) : null,
            battingAtBats: ids.reduce((sum, id) => sum + (game.playByPlay.batterStatsByIdentification.get(id)?.atBats ?? 0), 0),
            pitchingWalks: ids.reduce((sum, id) => sum + (game.playByPlay.pitcherStatsByIdentification.get(id)?.walksAllowed ?? 0), 0),
            pitchingComplete: !individual || !unknownPitching,
          }), eraBase) : null;
          const status = game.officialState.status;
          const reason = status === 'protested' ? 'Bajo protesta: pendiente de resolución.' :
            status === 'suspended' ? 'Suspendido: no se suma al acumulado oficial.' :
            status === 'scheduled' ? 'Pendiente de inicio.' :
            status === 'in_progress' ? 'En curso: cifras provisionales, fuera del acumulado oficial.' :
            game.officialState.protest ? 'Resultado técnico: validación estadística pendiente.' :
            !sport || !doc?.modality.trim() ? 'Falta definir deporte o modalidad en el torneo.' :
            !complete ? 'Anotación incompleta o marcador sin respaldo completo de jugadas.' : '';
          const official = status === 'final' && reason === '';
          const ownScore = state.scores[side], otherScore = state.scores[side === 'home' ? 'away' : 'home'];
          const row: StatisticsGame = {
            gameId: game.gameId, tournamentId: game.tournamentId, tournamentName: doc?.name || game.details?.tournamentName || game.tournamentId,
            teamId, teamName: (side === 'home' ? game.details?.homeTeamName : game.details?.awayTeamName) ??
              doc?.teams.find(team => team.id === teamId)?.name ?? teamId,
            opponentName: (side === 'home' ? game.details?.awayTeamName : game.details?.homeTeamName) ??
              (side === 'home' ? game.teams.awayTeamId : game.teams.homeTeamId),
            leagueId: doc?.leagueId ?? '', leagueName: doc?.leagueName ?? '', date: game.details?.date ?? null,
            season: doc?.season ?? '', sport, modality: doc?.modality.trim() ?? '', category: doc?.category.trim() ?? '', eraBase,
            version: game.officialState.officialVersion, status,
            qualification: official ? 'official' : ['in_progress', 'scheduled'].includes(status) ? 'provisional' : 'excluded',
            reason, public: publicIds.has(game.tournamentId), positions: ownPositions, line,
            result: official ? ownScore === otherScore ? 'tie' : ownScore > otherScore ? 'win' : 'loss' : null,
          };
          if (players && index > 0) {
            const player = state.seed.rosters[side].find(player => player.id === ids[0]);
            players.push({ id: `player-${createHash('sha256').update(JSON.stringify([managerId, ids[0]])).digest('hex')}`,
              name: player?.name && player.name !== ids[0] ? player.name : null,
              activeTournament: Boolean(doc && !['finished', 'cancelled'].includes(doc.status) &&
                doc.teams.some(team => team.id === teamId && team.managerId === managerId && team.status !== 'withdrawn') &&
                this.getTournamentOrThrow(game.tournamentId).teamRosters.get(teamId)?.managerId === managerId), game: row });
          } else rows.push(row);
        }
      }
    }
    return rows;
  }

  private gameParticipantPositions(game: OfficialGameRecord, state: PrivateState, teamId: string, side: 'home' | 'away') {
    const positions = new Map<string, Set<string>>();
    const member = (id: string, position?: string) => {
      if (!positions.has(id)) positions.set(id, new Set());
      if (position) positions.get(id)!.add(position);
    };
    for (const entry of [...(game.teamSheets.get(teamId)?.initialLineup ?? []), ...(game.lineups.get(teamId)?.lineupEntries ?? [])])
      member(entry.identificationNumber, entry.fieldPosition);
    for (const request of game.personnelRequests.filter(item => item.teamId === teamId && item.status === 'approved')) {
      const action = request.action;
      if (action.kind === 'substitution') {
        member(action.incomingIdentificationNumber, action.fieldPosition); member(action.outgoingIdentificationNumber);
      } else if (action.kind === 'defense') member(action.identificationNumber, action.fieldPosition);
      else if (action.kind === 'courtesy') member(action.incomingIdentificationNumber);
    }

    for (const entry of state.log) {
      if (entry.side === side) for (const id of [entry.batterId, entry.runnerId, entry.stolenBy, ...entry.runs]) {
        if (id) member(id);
      }
      else if (entry.pitcherId) member(entry.pitcherId, 'P');
    }
    return positions;
  }

  private statisticsSourceComplete(game: OfficialGameRecord, state: PrivateState): boolean {
    return !!game.teams && state.log.length > 0 &&
      state.log.filter(entry => !entry.scoringRules).length === game.playByPlay.sequence &&
      state.log.filter(entry => entry.result !== null).length === game.playByPlay.plateAppearanceSequence &&
      (['home', 'away'] as const).every(side => {
        const offenseId = side === 'home' ? game.teams!.homeTeamId : game.teams!.awayTeamId;
        return state.log.filter(entry => entry.side === side).reduce((sum, entry) => sum + entry.runs.length, 0) === state.scores[side] &&
          runTotals(state.runAccounting.runs.filter(run => run.offenseId === offenseId), 'team').total === state.scores[side];
      });
  }

  personalCareer(identification: string, actorId: string): CareerGame[] {
    const person = this.normalizeIdentificationNumber(identification, 'identificación deportiva');
    const actor = this.requireText(actorId, 'identidad deportiva verificada');
    const matchesActor = (id: string) => id === actor || this.actorIdentifications.get(id) === person;
    const published = new Set(this.publicSportsTournaments().tournaments.map(tournament => tournament.id));
    const rows: CareerGame[] = [];
    for (const game of this.games.values()) {
      if (!game.teams || game.officialState.status === 'scheduled' || !game.hasStarted ||
          game.playByPlay.scorecardLog.length === 0 && game.playByPlay.sequence === 0) continue;
      const tournament = this.getTournamentOrThrow(game.tournamentId);
      const doc = this.tournamentPlanning?.document(game.tournamentId);
      const state = this.serializeScorecard(game, tournament);
      const homeTeamName = game.details?.homeTeamName ?? doc?.teams.find(team => team.id === game.teams!.homeTeamId)?.name ?? game.teams.homeTeamId;
      const awayTeamName = game.details?.awayTeamName ?? doc?.teams.find(team => team.id === game.teams!.awayTeamId)?.name ?? game.teams.awayTeamId;
      const append = (role: CareerRole, teamId: string | null, teamName: string | null, positions: string[]) => rows.push({
        gameId: game.gameId, tournamentId: game.tournamentId,
        tournamentName: doc?.name || game.details?.tournamentName || game.tournamentId,
        leagueId: doc?.leagueId ?? '', leagueName: doc?.leagueName ?? '', sport: doc?.sport.trim() ?? '',
        modality: doc?.modality.trim() ?? '', category: doc?.category.trim() ?? '', season: doc?.season.trim() ?? '',
        date: game.details?.date ?? null, homeTeamName, awayTeamName, teamId, teamName, role, positions,
        evidence: role === 'scorekeeper' ? 'scoring' as const : role === 'organizer' ? 'organization' as const : 'lineup' as const,
        status: game.officialState.status, version: game.officialState.officialVersion,
        public: published.has(game.tournamentId), technical: Boolean(game.officialState.protest),
      });
      for (const side of ['home', 'away'] as const) {
        const teamId = side === 'home' ? game.teams.homeTeamId : game.teams.awayTeamId;
        const teamName = side === 'home' ? homeTeamName : awayTeamName;
        const positions = this.gameParticipantPositions(game, state, teamId, side);
        if (positions.has(person)) append('player', teamId, teamName, [...positions.get(person)!]);
        const manager = game.teamSheets.get(teamId)?.managerId ?? game.lineups.get(teamId)?.managerId;
        if (manager && matchesActor(manager)) append('manager', teamId, teamName, []);
      }
      const effectiveStates = [game.officialState, ...game.scoringHistory.map(entry => entry.state),
        ...game.suspensionArchives.map(entry => entry.state)];
      for (const role of ['scorekeeper', 'organizer'] as const)
        if (effectiveStates.some(entry => entry.updatedBy?.role === role && matchesActor(entry.updatedBy.id)))
          append(role, null, null, []);
    }
    return rows;
  }

  lookupRosterPerson(input: string): RosterPerson | null {
    const key = this.requireText(input, 'cédula o ID').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const person = this.globalPlayersByIdentification.get(key);
    if (!person) return null;
    return { id: person.identificationNumber, identification: person.isMinor ? '' : person.identificationNumber,
      fullName: person.displayName, isMinor: person.isMinor, registrationStatus: 'sports-record' };
  }

  listOrganizerRosterTournaments(organizerIdRaw: string) {
    const organizerId = this.requireText(organizerIdRaw, 'organizerId');
    return Array.from(this.tournamentAuthorizations.values()).filter(row => row.organizerId === organizerId).map(row => {
      const context = this.rosterRulesContext(row.tournamentId);
      return { tournamentId: context.tournamentId, tournamentName: context.tournamentName };
    });
  }

  publicFavoritePlayers() {
    return this.publicSportsTournaments().tournaments.flatMap(tournament =>
      tournament.teams.flatMap(team => {
        const planned = this.tournamentPlanning?.document(tournament.id)?.teams.find(row => row.id === team.id);
        if (planned && (planned.status !== 'accepted' || planned.rosterStatus !== 'approved')) return [];
        const roster = this.tournamentAuthorizations.get(tournament.id)?.teamRosters.get(team.id);
        if (!roster) return [];
        return Array.from(roster.playerIdentificationNumbers).map(id => {
          const player = this.globalPlayersByIdentification.get(id);
          if (!player) throw new ConflictException('No se pudo resolver un jugador del roster público.');
          return { identificationNumber: player.identificationNumber, name: player.displayName, tournamentId: tournament.id, teamId: team.id };
        });
      }));
  }

  institutionalIdentities(includePrivate = false): InstitutionalIdentity[] {
    const planned = this.tournamentPlanning?.institutions?.(includePrivate) ?? [];
    const keys = new Set(planned.map(row => `${row.kind}:${row.id}`));
    const live = Array.from(this.tournamentAuthorizations.values()).flatMap(tournament => {
      const plan = this.tournamentPlanning?.document(tournament.tournamentId);
      const managerOwned = (teamId: string) => !!plan?.teams.find(team => team.id === teamId)?.enrollment;
      if (!includePrivate && plan && this.tournamentPlanning?.published?.(plan.id) === false) return [];
      const games = Array.from(this.games.values()).filter(game => game.tournamentId === tournament.tournamentId && game.teams);
      return [
        { kind: 'tournament' as const, id: tournament.tournamentId,
          name: this.tournamentPlanning?.document(tournament.tournamentId)?.name || this.tournamentPlanning?.document(tournament.tournamentId)?.leagueName || games.find(game => game.details)?.details?.tournamentName || tournament.tournamentId,
          organizerId: tournament.organizerId, managerId: null, tournamentId: tournament.tournamentId, managerOwned: false },
        ...Array.from(tournament.teamRosters.values()).map(roster => {
          const game = games.find(game => game.details && game.teams &&
            [game.teams.homeTeamId, game.teams.awayTeamId].includes(roster.teamId));
          return { kind: 'team' as const, id: roster.teamId,
            name: this.tournamentPlanning?.document(tournament.tournamentId)?.teams.find(team => team.id === roster.teamId)?.name ??
              (game?.teams?.homeTeamId === roster.teamId ? game.details?.homeTeamName ?? roster.teamId : game?.details?.awayTeamName ?? roster.teamId),
            organizerId: tournament.organizerId, managerId: roster.managerId, tournamentId: tournament.tournamentId, managerOwned: managerOwned(roster.teamId) };
        })
      ];
    });
    return [...planned, ...live.filter(row => !keys.has(`${row.kind}:${row.id}`))];
  }

  rosterRulesContext(tournamentId: string): RosterRulesContext {
    const tournament = this.getTournamentOrThrow(tournamentId);
    const games = Array.from(this.games.values()).filter(game => game.tournamentId === tournamentId && game.teams);
    const members: RosterRulesContext['members'] = {};
    for (const roster of tournament.teamRosters.values()) members[roster.teamId] = Array.from(roster.playerIdentificationNumbers).map(id => {
      const person = this.registration?.rosterPerson(id) ?? this.lookupRosterPerson(id);
      if (!person) throw new ConflictException('No se pudo resolver un integrante del roster.');
      return { person, role: 'PLAYER' as const, approvalStatus: 'approved' as const };
    });
    return { tournamentId, tournamentName: this.tournamentPlanning?.document(tournamentId)?.name || this.tournamentPlanning?.document(tournamentId)?.leagueName || games.find(game => game.details)?.details?.tournamentName || tournamentId,
      organizerId: tournament.organizerId, members, teamIds: Array.from(tournament.teamRosters.keys()),
      games: games.flatMap(game => !game.teams ? [] : [{ gameId: game.gameId, ...game.teams, status: game.officialState.status,
        started: ['in_progress', 'final', 'protested'].includes(game.officialState.status) ||
          game.officialState.suspension?.wasStarted === true || game.suspensionArchives.some(entry => entry.suspension.wasStarted) ||
          game.playByPlay.scorecardLog.length > 0 || game.playByPlay.events.length > 0 || game.playByPlay.plateAppearances.length > 0,
        label: game.details ? `${game.details.awayTeamName} vs. ${game.details.homeTeamName}` : game.gameId }]) };
  }

  private observeRosterClosure(tournamentId: string, gameId?: string, status?: OfficialGameStatus) {
    if (!this.registration) return;
    const context = this.rosterRulesContext(tournamentId);
    this.registration.rosterRules(context);
    if (gameId && status) this.registration.rosterRules({ ...context, games: context.games.map(game => game.gameId === gameId ?
      { ...game, status, started: game.started || ['in_progress', 'final', 'protested'].includes(status) } : game) });
  }

  assertManagerRosterAddition(team: ManagerRosterTeam, role: RosterRole, person: RosterPerson) {
    this.tournamentPlanning?.assertParticipation(team.tournamentId, '', team.teamId, [person.identification || person.id], 'roster');
    const tournament = this.getTournamentOrThrow(team.tournamentId);
    if (this.getTeamRosterOrThrow(tournament, team.teamId).managerId !== team.managerId) throw new ForbiddenException('Solo el manager actual puede incorporar personal.');
    if (role !== 'DELEGADO') {
      const key = this.rosterPersonKey(person);
      this.assertRoleCompatible(tournament, key, 'participant');
      if (role === 'PLAYER') this.assertPlayersNotInOtherTeamRoster(tournament, team.teamId, [key]);
    }
  }

  private rosterPersonKey(person: RosterPerson) { return this.normalizeIdentificationNumber(person.identification || person.id, 'cédula o ID'); }

  private refreshDirectRosterMembers(tournament: TournamentAuthorizationRecord) {
    const members = this.registration?.rosterPersonnel(tournament.tournamentId) ?? [];
    const playerTeams = new Map<string, string>();
    for (const { teamId, person, role } of members) {
      if (!tournament.teamRosters.has(teamId)) continue;
      const key = this.rosterPersonKey(person);
      if (role !== 'DELEGADO') this.assertRoleCompatible(tournament, key, 'participant');
      if (role === 'PLAYER') {
        this.assertPlayersNotInOtherTeamRoster(tournament, teamId, [key]);
        if (playerTeams.has(key) && playerTeams.get(key) !== teamId) throw new ConflictException('Una persona persistida no puede jugar para dos equipos del mismo torneo.');
        playerTeams.set(key, teamId);
      }
    }
    for (const { teamId, person, role } of members) {
      const roster = tournament.teamRosters.get(teamId);
      if (!roster) continue;
      const key = this.rosterPersonKey(person);
      if (role !== 'DELEGADO') tournament.participantIdentifications.add(key);
      if (role !== 'PLAYER') continue;
      if (!this.globalPlayersByIdentification.has(key)) {
        const now = this.nowIso();
        this.globalPlayersByIdentification.set(key, { privateRegistration: true, displayName: person.fullName,
          identificationNumber: key, isMinor: person.isMinor, representativeIdentificationNumber: null,
          extraProfile: {}, createdAt: now, updatedAt: now, createdById: roster.managerId });
      }
      roster.playerIdentificationNumbers.add(key);
    }
  }

  listOfficialGames(userIdRaw: string, role: AppRole, tournamentConsultation = false): OfficialGamesSnapshot {
    const userId = this.requireText(userIdRaw, 'userId');
    if (role !== 'organizer' && role !== 'scorekeeper' && role !== 'manager') throw new ForbiddenException('Este perfil no tiene una bandeja de partidos asignados.');
    const games: OfficialGameSummary[] = [];
    for (const game of this.games.values()) {
      const tournament = this.getTournamentOrThrow(game.tournamentId);
      if (!game.teams) continue;
      const managerTeamId = role === 'manager' ? [game.teams.homeTeamId, game.teams.awayTeamId]
        .find(id => tournament.teamRosters.get(id)?.managerId === userId) : undefined;
      if (role === 'manager' ? !managerTeamId : role === 'organizer' ? tournament.organizerId !== userId :
        !(tournamentConsultation ? tournament.authorizedScorekeepers.has(userId) || this.isScorekeeperSubstitute(userId, game.tournamentId, game.gameId) :
          this.canWriteOfficial(game, tournament, userId, role))) continue;
      games.push({
        gameId: game.gameId, tournamentId: game.tournamentId,
        ...game.teams, status: game.officialState.status,
        homeScore: game.officialState.homeScore, awayScore: game.officialState.awayScore,
        details: game.details ? { ...game.details } : null,
        ...(managerTeamId ? { managerTeamId } : {}),
        ...(game.officialState.protest ? { protest: structuredClone(game.officialState.protest) } : {}),
        ...(game.officialState.suspension ? { suspension: structuredClone(game.officialState.suspension) } : {}),
        assignedScorekeeperIds: this.serializeGameAuthorization(game, tournament).effectiveScorekeeperIds,
        availableScorekeeperIds: [...new Set([...tournament.authorizedScorekeepers,
          ...this.serializeGameAuthorization(game, tournament).effectiveScorekeeperIds])],
        scoringBlockReason: role === 'manager' ? null : this.scoringBlockReason(game.gameId, userId)
      });
    }
    games.sort((a, b) => (a.details?.date ?? '9999').localeCompare(b.details?.date ?? '9999') ||
      (a.details?.time ?? '').localeCompare(b.details?.time ?? '') || a.gameId.localeCompare(b.gameId));
    return { userId, role, games };
  }

  getOfficialStandings(): { games: OfficialStandingGame[] } {
    return { games: Array.from(this.games.values()).flatMap(game => !game.teams ? [] : [{
      gameId: game.gameId, tournamentId: game.tournamentId, ...game.teams, status: game.officialState.status,
      homeScore: game.officialState.homeScore, awayScore: game.officialState.awayScore,
      details: game.details ? { ...game.details } : null,
      ...(game.officialState.protest ? { protest: structuredClone(game.officialState.protest) } : {}),
      ...(game.officialState.suspension ? { suspension: structuredClone(game.officialState.suspension) } : {})
    }]) };
  }

  getGameChatContext(gameId: string) {
    const game = this.games.get(gameId);
    if (!game?.teams) throw new NotFoundException('Este partido oficial no está disponible para el chat.');
    return { status: game.officialState.status, finishedAt: game.chatFinishedAt ?? null };
  }

  @OfficialMutation
  declareGameProtest(input: { gameId: string; tournamentId: string; actorId: string; actorRole: string;
    expectedOfficialVersion: number; teamId: string; reason: string }) {
    const tournament = this.getTournamentOrThrow(input.tournamentId);
    const game = this.getOrCreateGame(input.gameId, input.tournamentId);
    if (input.actorRole !== 'scorekeeper' || !this.canWriteOfficial(game, tournament, input.actorId, 'scorekeeper')) {
      throw new ForbiddenException('Solo el anotador asignado puede registrar el juego bajo protesta.');
    }
    this.assertScoringAvailable(game, input.actorId);
    if (game.officialState.status !== 'in_progress' || game.officialState.protest) {
      throw new ConflictException('Solo un juego en curso y sin protesta previa puede quedar bajo protesta.');
    }
    this.assertProtestVersion(game, input.expectedOfficialVersion);
    if (!game.teams || ![game.teams.homeTeamId, game.teams.awayTeamId].includes(input.teamId)) {
      throw new BadRequestException('Selecciona el equipo que presenta la protesta.');
    }
    const reason = this.requireText(input.reason, 'motivo de la protesta');
    if (reason.length > 2000) throw new BadRequestException('El motivo admite hasta 2000 caracteres.');
    const { inning, outs, balls, strikes, homeScore, awayScore, officialVersion, lastPlay } = game.officialState;
    this.observeRosterClosure(game.tournamentId);
    game.officialState = {
      ...game.officialState, status: 'protested',
      ...(game.officialState.clock ? { clock: pauseGameClock(game.officialState.clock, this.nowIso()) } : {}),
      protest: { teamId: input.teamId, reason, declaredAt: this.nowIso(), declaredBy: input.actorId,
        moment: { inning, outs, balls, strikes, homeScore, awayScore, officialVersion, lastPlay }, resolution: null },
      lastPlay: 'Juego bajo protesta. Pendiente de mesa técnica.', updatedBy: { id: input.actorId, role: 'scorekeeper' }
    };
    this.publishPersonnel(game, tournament);
    this.publishScoringAvailability();
    return this.getOfficialState(game.gameId, game.tournamentId);
  }

  @OfficialMutation
  resolveGameProtest(input: { gameId: string; tournamentId: string; organizerId: string; expectedOfficialVersion: number;
    winnerTeamId: string; reason: string; recordReference: string }) {
    const tournament = this.getTournamentOrThrow(input.tournamentId);
    if (tournament.organizerId !== input.organizerId) throw new ForbiddenException('Solo el organizador del torneo puede registrar el acta de mesa técnica.');
    const game = this.getOrCreateGame(input.gameId, input.tournamentId);
    if (game.officialState.status !== 'protested' || !game.officialState.protest || game.officialState.protest.resolution) {
      throw new ConflictException('No hay una protesta pendiente de resolución.');
    }
    this.assertProtestVersion(game, input.expectedOfficialVersion);
    if (!game.teams || ![game.teams.homeTeamId, game.teams.awayTeamId].includes(input.winnerTeamId)) {
      throw new BadRequestException('El ganador debe ser uno de los equipos del partido.');
    }
    const reason = this.requireText(input.reason, 'fundamento de la decisión');
    const recordReference = this.requireText(input.recordReference, 'referencia del acta');
    if (reason.length > 4000 || recordReference.length > 500) throw new BadRequestException('El fundamento admite 4000 caracteres y la referencia 500.');
    const loserTeamId = input.winnerTeamId === game.teams.homeTeamId ? game.teams.awayTeamId : game.teams.homeTeamId;
    this.observeRosterClosure(game.tournamentId, game.gameId, 'final');
    game.officialState = {
      ...game.officialState, status: 'final', lastPlay: 'Resultado determinado por mesa técnica.',
      protest: { ...game.officialState.protest, resolution: {
        winnerTeamId: input.winnerTeamId, loserTeamId, reason, recordReference, recordedAt: this.nowIso(), recordedBy: input.organizerId
      } }, updatedBy: { id: input.organizerId, role: 'organizer' }
    };
    game.chatFinishedAt = this.nowIso();
    this.publishPersonnel(game, tournament);
    this.publishScoringAvailability();
    return this.getOfficialState(game.gameId, game.tournamentId);
  }

  private assertProtestVersion(game: OfficialGameRecord, version: number) {
    if (!Number.isSafeInteger(version) || version < 0) throw new BadRequestException('La operación requiere la versión actual de la pizarra.');
    if (version !== game.officialState.officialVersion) throw new ConflictException('La pizarra cambió. Actualízala antes de registrar la protesta o su decisión.');
  }

  @OfficialMutation
  suspendGame(input: { gameId: string; tournamentId: string; actorId: string; actorRole: string;
    expectedOfficialVersion: number; cause: unknown; scoreHandling: unknown; reason: string }) {
    const tournament = this.getTournamentOrThrow(input.tournamentId);
    const game = this.getOrCreateGame(input.gameId, input.tournamentId);
    if ((input.actorRole !== 'organizer' && input.actorRole !== 'scorekeeper') ||
        !this.canWriteOfficial(game, tournament, input.actorId, input.actorRole)) throw new ForbiddenException('Solo el organizador o anotador asignado puede suspender el juego.');
    if (!['scheduled', 'in_progress'].includes(game.officialState.status) || game.officialState.protest) throw new ConflictException('Solo se aplazan juegos pendientes o en curso, sin protesta.');
    if (!game.teams || !game.details) throw new ConflictException('Completa equipos y ficha de sede antes de suspender el partido.');
    this.assertProtestVersion(game, input.expectedOfficialVersion);
    const reason = this.requireText(input.reason, 'motivo de suspensión');
    if (!['weather', 'force-majeure'].includes(String(input.cause)) || !['keep', 'reset'].includes(String(input.scoreHandling)) || reason.length > 2000) {
      throw new BadRequestException('Indica clima o fuerza mayor, motivo y si se conserva o reinicia el juego completo.');
    }
    const suspension: GameSuspension = { id: `${game.gameId}:suspension:${game.suspensionArchives.length + 1}`,
      cause: input.cause === 'weather' ? 'weather' : 'force-majeure', scoreHandling: input.scoreHandling === 'keep' ? 'keep' : 'reset',
      reason, recordedAt: this.nowIso(), recordedBy: input.actorId, role: input.actorRole === 'organizer' ? 'organizer' : 'scorekeeper',
      wasStarted: game.officialState.status === 'in_progress' || game.playByPlay.scorecardLog.length > 0 ||
        game.playByPlay.events.length > 0 || game.playByPlay.plateAppearances.length > 0 ||
        game.officialState.homeScore > 0 || game.officialState.awayScore > 0,
      originalDate: game.details?.date ?? null, originalTime: game.details?.time ?? null, rescheduled: null };
    this.observeRosterClosure(game.tournamentId);
    if (game.officialState.clock) game.officialState.clock = pauseGameClock(game.officialState.clock, this.nowIso());
    game.suspensionArchives.push(structuredClone({ suspension, state: game.officialState,
      lineup: this.serializeLineupStatus(game, tournament), playByPlay: this.serializePlayByPlay(game, tournament) }));
    if (suspension.scoreHandling === 'reset') {
      delete game.officialState.clock;
      game.playByPlay = this.emptyPlayByPlay();
      for (const lineup of game.lineups.values()) lineup.currentBatterIndex = 0;
      game.officialState = { ...game.officialState, inning: 1, outs: 0, balls: 0, strikes: 0, homeScore: 0, awayScore: 0,
        offenseTeamId: game.teams?.awayTeamId ?? null, lastBatterId: null,
        nextBatterId: game.teams ? this.resolveNextBatterId(game, game.teams.awayTeamId) : null };
    }
    game.scoringHistory = [];
    game.scoringActors.clear();
    game.officialState = { ...game.officialState, status: 'suspended', suspension, lastPlay: 'Juego suspendido. Nueva fecha pendiente.',
      updatedBy: { id: input.actorId, role: suspension.role } };
    this.publishPersonnel(game, tournament); this.publishScoringAvailability();
    return this.getOfficialState(game.gameId, game.tournamentId);
  }

  @OfficialMutation
  rescheduleGame(input: { gameId: string; tournamentId: string; organizerId: string; expectedOfficialVersion: number; date: string; time: string }) {
    const tournament = this.getTournamentOrThrow(input.tournamentId);
    if (tournament.organizerId !== input.organizerId) throw new ForbiddenException('Solo el organizador puede fijar la nueva fecha.');
    const game = this.getOrCreateGame(input.gameId, input.tournamentId);
    if (game.officialState.status !== 'suspended' || !game.officialState.suspension || !game.details) throw new ConflictException('Este juego no está suspendido o le falta su ficha de sede.');
    this.assertProtestVersion(game, input.expectedOfficialVersion);
    if (!isCalendarDate(input.date) || !isGameTime(input.time)) throw new BadRequestException('Indica una nueva fecha y hora válidas.');
    const suspension: GameSuspension = { ...game.officialState.suspension,
      rescheduled: { date: input.date, time: input.time, recordedBy: input.organizerId, recordedAt: this.nowIso() } };
    this.observeRosterClosure(game.tournamentId);
    game.details = { ...game.details, date: input.date, time: input.time };
    const archive = game.suspensionArchives.find(entry => entry.suspension.id === suspension.id);
    if (archive) archive.suspension = structuredClone(suspension);
    game.officialState = { ...game.officialState, suspension, status: 'scheduled', lastPlay: 'Partido reprogramado. Pendiente de iniciar.',
      updatedBy: { id: input.organizerId, role: 'organizer' } };
    this.publishPersonnel(game, tournament); this.publishScoringAvailability();
    return this.getOfficialState(game.gameId, game.tournamentId);
  }

  suspensionArchive(gameId: string, tournamentId: string, id?: string) {
    this.getTournamentOrThrow(tournamentId);
    const game = this.getOrCreateGame(gameId, tournamentId);
    const entries = game.suspensionArchives;
    if (!id) return { interruptions: entries.map(entry => structuredClone(entry.suspension)) };
    const entry = entries.find(entry => entry.suspension.id === id);
    if (!entry) throw new NotFoundException('No existe esta anotación archivada.');
    return structuredClone(entry);
  }

  @OfficialMutation
  configureGameDetails(command: { gameId: string; tournamentId: string; organizerId: string; details: unknown }) {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    if (tournament.organizerId !== this.requireText(command.organizerId, 'organizerId')) throw new ForbiddenException('Solo el organizador del torneo puede editar los datos del partido.');
    if (!isOfficialGameDetails(command.details)) throw new BadRequestException('Revisa equipos, torneo, fecha, hora, estadio y ubicación de la sede del partido.');
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    this.assertProtestUnlocked(game);
    game.details = { ...command.details };
    return { gameId: game.gameId, tournamentId: game.tournamentId, details: { ...game.details } };
  }

  @OfficialMutation
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
    this.assertProtestUnlocked(game);
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

  @OfficialMutation
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
    this.assertProtestUnlocked(game);
    if (game.officialState.status === 'final') {
      throw new BadRequestException('No se puede cambiar al representante de un partido finalizado.');
    }
    const identificationNumber = this.normalizeIdentificationNumber(command.identificationNumber, 'cedula');
    if (!this.matchRosterPerson(tournament, teamId, identificationNumber)) {
      throw new BadRequestException('El representante debe pertenecer a la plantilla oficial del equipo.');
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
    const person = this.registration?.rosterPerson(representative.identificationNumber) ?? this.lookupRosterPerson(representative.identificationNumber);
    if (!person) throw new NotFoundException('No se encontró la identidad del dirigente autorizado para este partido.');
    return { ...representative, displayName: person.fullName };
  }

  private matchRosterPerson(tournament: TournamentAuthorizationRecord, teamId: string, identification: string): RosterPerson | null {
    const direct = this.registration?.rosterPersonnel(tournament.tournamentId)
      .find(row => row.teamId === teamId && this.rosterPersonKey(row.person) === identification);
    if (direct) return direct.person;
    if (!tournament.teamRosters.get(teamId)?.playerIdentificationNumbers.has(identification)) return null;
    return this.lookupRosterPerson(identification);
  }

  @OfficialMutation
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
    this.tournamentPlanning?.assertParticipation(tournamentId, gameId, teamId, lineupEntries.map(entry => entry.identificationNumber), 'lineup');

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
    this.assertTeamStaffCompatible(tournament, officials);
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
    this.rememberTeamStaff(tournament, officials);

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

  private canWithdrawLineup(game: OfficialGameRecord): boolean {
    return game.officialState.status === 'scheduled' && !game.hasStarted &&
      !game.officialState.protest && !game.officialState.suspension &&
      game.playByPlay.scorecardLog.length === 0 && game.playByPlay.events.length === 0 &&
      game.playByPlay.plateAppearances.length === 0 &&
      game.officialState.homeScore === 0 && game.officialState.awayScore === 0;
  }

  @OfficialMutation
  withdrawTeamSheet(command: {
    gameId: string; tournamentId: string; teamId: string; managerId: string;
    expectedRevision: number; expectedVersion: number;
  }): TeamSheetsSnapshot {
    const tournament = this.getTournamentOrThrow(command.tournamentId);
    const game = this.getOrCreateGame(command.gameId, tournament.tournamentId);
    const roster = this.getTeamRosterOrThrow(tournament, command.teamId);
    if (roster.managerId !== command.managerId ||
        !game.teams || ![game.teams.homeTeamId, game.teams.awayTeamId].includes(command.teamId)) {
      throw new ForbiddenException('Solo el dirigente participante puede cancelar la alineación de su propio equipo.');
    }
    this.assertPersonnelOpen(game);
    if (!this.canWithdrawLineup(game)) {
      throw new ConflictException('Solo puedes cancelar la alineación antes de que comience el partido. Una vez iniciado, los cambios los registra el anotador u organizador.');
    }
    const sheet = game.teamSheets.get(command.teamId);
    if (!sheet) throw new ConflictException('Esta alineación ya no está enviada. Actualiza los datos del partido.');
    if (sheet.revision !== command.expectedRevision || game.personnelVersion !== command.expectedVersion) {
      throw new ConflictException('La entrega cambió. Actualiza los datos antes de cancelar la alineación.');
    }
    const now = this.nowIso();
    for (const request of game.personnelRequests) {
      if (request.teamId === command.teamId && request.status === 'pending') {
        request.status = 'rejected';
        request.decidedAt = now;
        request.decisionNote = 'El dirigente canceló la alineación antes del inicio del partido.';
      }
    }
    game.teamSheets.delete(command.teamId);
    game.lineups.delete(command.teamId);
    if (game.officialState.offenseTeamId === command.teamId) game.officialState.nextBatterId = null;
    this.publishPersonnel(game, tournament);
    return this.getTeamSheets(game.gameId, game.tournamentId, command.managerId, 'manager');
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
      scoringBlockReason: canDecide ? this.scoringBlockReason(game.gameId, userId) : null,
      sheets: Array.from(game.teamSheets.values()).map((sheet) => {
        const lineup = game.lineups.get(sheet.teamId);
        if (!lineup) throw new NotFoundException('No se encontró la alineación de la entrega.');
        return {
          teamId: sheet.teamId, managerId: sheet.managerId, revision: sheet.revision,
          canWithdraw: role === 'manager' && ownTeamId === sheet.teamId && this.canWithdrawLineup(game),
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

  @OfficialMutation
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

  @OfficialMutation
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
    this.assertScoringAvailable(game, command.actorId);
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
      this.claimScoring(game, command.actorId);
    }
    request.status = command.decision === 'approve' ? 'approved' : 'rejected';
    request.decidedAt = this.nowIso();
    request.decidedBy = { id: command.actorId, role: command.actorRole };
    request.decisionNote = note;
    this.publishPersonnel(game, tournament);
    return this.getTeamSheets(game.gameId, game.tournamentId, command.actorId, command.actorRole);
  }

  @OfficialMutation
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
    this.assertScoringAvailable(game, command.actorId);
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
    this.claimScoring(game, command.actorId);
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
      this.rememberTeamStaff(tournament, next.presentOfficials);
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
        if (action.arrival) {
          registered(action.incomingIdentificationNumber);
          if (presentPlayers.includes(action.incomingIdentificationNumber))
            throw new BadRequestException('El jugador ya llegó. Selecciónalo desde la reserva actual.');
          presentPlayers.push(action.incomingIdentificationNumber);
        }
        reserve(action.incomingIdentificationNumber);
        entries = entries.map((entry) => entry === outgoing ? {
          ...entry, identificationNumber: action.incomingIdentificationNumber,
          fieldPosition: action.fieldPosition, jerseyNumber: action.jerseyNumber
        } : entry);
        break;
      }
      case 'defense': {
        const player = active(action.identificationNumber);
        const swap = action.swapWith ? active(action.swapWith) : ['DH', 'NA'].includes(action.fieldPosition) ? undefined :
          entries.find((entry) => entry !== player && entry.fieldPosition === action.fieldPosition);
        if (action.swapWith && (swap === player || swap?.fieldPosition !== action.fieldPosition))
          throw new BadRequestException('El otro jugador cambió de posición. Actualiza la hoja antes del intercambio.');
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
        this.assertTeamStaffCompatible(tournament, [action.official]);
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
    const sizeError = lineupSizeError(sheet.initialLineup, lineupEntries);
    if (sizeError) throw new BadRequestException(sizeError);
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
      if (!isPresentOfficialRole(entry.role)) {
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
    if ((value.kind === 'substitution' || value.kind === 'defense') && ('battingOrder' in value || 'order' in value)) {
      throw new BadRequestException('El orden de bateo es fijo: el suplente hereda el turno del jugador saliente y los cambios defensivos no lo modifican.');
    }
    const text = (key: string) => this.personnelText(key in value ? Reflect.get(value, key) : undefined, key);
    const id = (key: string) => this.normalizeIdentificationNumber(text(key), 'cédula');
    if ('arrival' in value && (value.kind !== 'substitution' || value.arrival !== true))
      throw new BadRequestException('La llegada conjunta solo admite una sustitución con arrival: true.');
    if ('swapWith' in value && value.kind !== 'defense')
      throw new BadRequestException('El intercambio de jugadores solo corresponde a un cambio defensivo.');
    switch (value.kind) {
      case 'arrival': return { kind: 'arrival', identificationNumber: id('identificationNumber') };
      case 'substitution': return {
        kind: 'substitution', outgoingIdentificationNumber: id('outgoingIdentificationNumber'),
        incomingIdentificationNumber: id('incomingIdentificationNumber'),
        fieldPosition: this.normalizeFieldPosition(text('fieldPosition'), 'posición'),
        jerseyNumber: this.normalizeJerseyNumber(text('jerseyNumber'), 'camiseta'),
        ...('arrival' in value ? { arrival: true } : {})
      };
      case 'defense': return { kind: 'defense', identificationNumber: id('identificationNumber'), fieldPosition: this.normalizeFieldPosition(text('fieldPosition'), 'posición'),
        ...('swapWith' in value ? { swapWith: id('swapWith') } : {}) };
      case 'courtesy': return {
        kind: 'courtesy', fromBase: this.requireIntegerRange('fromBase' in value && typeof value.fromBase === 'number' ? value.fromBase : NaN, 'base', 1, 3),
        outgoingIdentificationNumber: id('outgoingIdentificationNumber'), incomingIdentificationNumber: id('incomingIdentificationNumber')
      };
      case 'staff-arrival': return { kind: 'staff-arrival', official: this.sanitizePresentOfficials(['official' in value ? value.official : null])[0] };
      case 'staff-departure': {
        const role = text('role');
        if (!isPresentOfficialRole(role)) throw new BadRequestException('Cargo de personal inválido.');
        return { kind: 'staff-departure', identificationNumber: id('identificationNumber'), role };
      }
      default: throw new BadRequestException('Movimiento de personal no permitido.');
    }
  }

  private assertPersonnelOpen(game: OfficialGameRecord) {
    this.assertProtestUnlocked(game);
    if (game.officialState.status === 'final') throw new BadRequestException('No se permite modificar el personal de un juego finalizado.');
  }

  private publishPersonnel(game: OfficialGameRecord, tournament: TournamentAuthorizationRecord) {
    game.officialState = {
      ...game.officialState, officialVersion: game.officialState.officialVersion + 1, updatedAt: this.nowIso()
    };
    game.personnelVersion += 1;
    this.emitPersonnel(game.gameId);
    this.emitGameEvent(game.gameId, {
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
      scoringBlockReason: canOfficialWrite ? this.scoringBlockReason(gameId, userId) : null,
      canPrivateWrite,
      canSubmitLineup: role === 'manager' && managerTeams.length > 0,
      canRegisterPlayers: role === 'organizer',
      managerTeamIds: managerTeams,
      subscriptionTier: tournament.subscriptionTier,
      scoringMode: canOfficialWrite ? 'official' : 'read_only'
    } as const;
  }

  @OfficialMutation
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
      events: [...stored.events], scoringHistory: [...stored.scoringHistory], scoringActors: new Set(stored.scoringActors)
    };

    if (!this.canWriteOfficial(game, tournament, actorId, actorRole)) {
      throw new ForbiddenException(
        'No autorizado para anotacion oficial. Solo organizador o anotadores autorizados pueden publicar el resultado legal.'
      );
    }
    this.assertProtestUnlocked(game);
    this.assertScoringAvailable(game, actorId);
    if (game.officialState.status === 'scheduled' && game.teams) for (const teamId of [game.teams.homeTeamId, game.teams.awayTeamId])
      this.tournamentPlanning?.assertParticipation(tournamentId, gameId, teamId,
        game.lineups.get(teamId)?.lineupEntries.map(entry => entry.identificationNumber) ?? [], 'play');
    if (command.expectedOfficialVersion !== undefined && command.expectedOfficialVersion !== game.officialState.officialVersion) {
      throw new ConflictException('La pizarra oficial cambió. Recárgala antes de anotar.');
    }
    const scorecardOperation = command.scorecardCommand !== undefined || command.undoLast !== undefined ||
      command.regulationInnings !== undefined || command.lastErrorOuts !== undefined || command.clockAction !== undefined;
    if (scorecardOperation && command.expectedOfficialVersion === undefined) {
      throw new BadRequestException('La anotación requiere la versión actual de la pizarra.');
    }
    if (scorecardOperation && (command.playEvent || command.plateAppearance || command.runReview ||
        Object.keys(command.patch ?? {}).length ||
        [command.scorecardCommand, command.undoLast, command.regulationInnings, command.lastErrorOuts, command.clockAction].filter((v) => v !== undefined).length !== 1)) {
      throw new BadRequestException('Envía una sola operación oficial por vez.');
    }
    const before = {
      state: structuredClone(game.officialState), playByPlay: structuredClone(game.playByPlay),
      indexes: new Map(Array.from(game.lineups, ([id, lineup]) => [id, lineup.currentBatterIndex]))
    };
    const restore = (entry: typeof before) => {
      game.officialState = { ...structuredClone(entry.state), officialVersion: stored.officialState.officialVersion };
      if (stored.officialState.clock) game.officialState.clock = structuredClone(stored.officialState.clock);
      else delete game.officialState.clock;
      game.playByPlay = structuredClone(entry.playByPlay);
      for (const [id, index] of entry.indexes) {
        const lineup = game.lineups.get(id);
        if (lineup) lineup.currentBatterIndex = index;
      }
    };
    let scorecardCommand: PrivateCommand | undefined;
    if (command.clockAction !== undefined) {
      if (!isGameClockAction(command.clockAction)) throw new BadRequestException('La operación del cronómetro no es válida.');
      if (game.officialState.status === 'final') throw new ConflictException('El tiempo de un partido finalizado no se modifica.');
      if (!game.teams || !game.lineups.get(game.teams.homeTeamId)?.lineupEntries.length ||
          !game.lineups.get(game.teams.awayTeamId)?.lineupEntries.length) {
        throw new ConflictException('Ambos managers deben entregar su lineup antes de iniciar el tiempo.');
      }
      try { game.officialState.clock = changeGameClock(game.officialState.clock, command.clockAction, this.nowIso()); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new BadRequestException(error.message);
      }
    }
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
      if (isSoftballScorecard(this.serializeScorecard(game, tournament).seed) && game.regulationInnings !== command.regulationInnings &&
          game.officialState.inning > Math.min(game.regulationInnings ?? 7, command.regulationInnings))
        throw new BadRequestException('La duración no se puede cambiar después de alcanzar las entradas extra.');
      game.regulationInnings = command.regulationInnings;
    }
    if (command.scorecardCommand !== undefined) {
      if (!isScorecardCommand(command.scorecardCommand) || command.scorecardCommand.sharedRequestId ||
          !['pitch', 'play', 'runner', 'misplay', 'courtesy', 'finish', 'run-review', 'rules'].includes(command.scorecardCommand.kind)) {
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
      if (scorecardCommand.kind === 'play' && scorecardCommand.destinations === undefined &&
          scorecardCommand.result !== 'fieldersChoice') {
        scorecardCommand = { ...scorecardCommand, destinations: minimumDestinations(current, scorecardCommand.result) };
      }
      if (scorecardCommand.kind === 'courtesy') {
        const teamId = game.officialState.offenseTeamId;
        if (!teamId || !game.teamSheets.get(teamId)?.presentPlayers.includes(scorecardCommand.playerId)) {
          throw new BadRequestException('El corredor temporal debe estar presente y confirmado.');
        }
        scorecardCommand = { ...scorecardCommand, sourceRule: tournament.courtesyRunnerSource };
      }
      try {
        assertScoringSubmission(current, scorecardCommand);
        preview = applyPrivateCommand(current, scorecardCommand);
        if (scorecardCommand.kind === 'rules') game.playByPlay.scorecardLog = preview.log;
        if (scorecardCommand.kind === 'finish' && scorecardCommand.review)
          game.playByPlay.finalReview = structuredClone(scorecardCommand.review);
      }
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
      ...(command.clockAction === 'start' || command.clockAction === 'resume' ? { status: 'in_progress' as const } : {}),
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

    const newScoring = command.scorecardCommand !== undefined && scorecardCommand && isTimedScoringCommand(scorecardCommand) ||
      command.playEvent && playEventResult?.type !== 'COURTESY_RUNNER' || command.plateAppearance;
    if (newScoring) {
      try { game.officialState.clock = startOrResumeGameClock(game.officialState.clock, this.nowIso()); }
      catch (error) {
        if (!(error instanceof Error)) throw error;
        throw new BadRequestException(error.message);
      }
    }
    const nextState = this.applyPatch(game, game.officialState, patch, actorId, actorRole);
    if (nextState.status === 'in_progress' || newScoring) {
      const capacity = this.tournamentPlanning?.organizerCapacity?.(tournamentId);
      if (capacity && !capacity.legacy) {
        const doc = this.tournamentPlanning?.document(tournamentId);
        const fixture = doc?.fixtures.find(item => this.plannedGameId(tournamentId, item.id) === gameId);
        if (!doc || !fixture || !game.teams) throw new ConflictException('Falta el cruce oficial para validar la capacidad del torneo.');
        if (!this.tieBreakerReady(doc, fixture.phaseId)) throw new ConflictException('El desempate requiere justificación y una fase de origen concluida con sus partidos finalizados.');
        this.organizerCapacity.start(capacity.accountId, doc, { gameId, fixtureId: fixture.id,
          teamIds: [game.teams.homeTeamId, game.teams.awayTeamId], at: nextState.updatedAt });
      }
    }
    if (!game.operationStartedAt && nextState.status === 'in_progress')
      game.operationStartedAt = stored.officialState.status === 'in_progress' ? stored.officialState.updatedAt : nextState.updatedAt;
    if (game.scorekeeperSubstitutions) (game.scorekeeperSubstitutions.movements ??= []).push({
      version: nextState.officialVersion, actorId, role: actorRole, at: nextState.updatedAt,
      action: scorecardCommand ? scorecardCommand.kind === 'play' ? `play:${scorecardCommand.result}` : scorecardCommand.kind :
        command.undoLast ? 'undo' : command.clockAction ? 'clock' : 'update'
    });
    const identity = this.requireActorIdentity(actorId);
    const availabilityChanged = stored.officialState.status !== nextState.status ||
      nextState.status === 'in_progress' && !stored.scoringActors.has(identity);
    this.observeRosterClosure(tournamentId, gameId, nextState.status);
    if (nextState.status === 'in_progress') game.scoringActors.add(identity);
    else game.scoringActors.clear();
    game.officialState = nextState;
    if (nextState.status === 'final' && stored.officialState.status !== 'final') game.chatFinishedAt = nextState.updatedAt;
    else if (nextState.status !== 'final') game.chatFinishedAt = null;
    game.hasStarted ||= ['in_progress', 'final', 'protested'].includes(nextState.status);
    if (game.hasStarted) game.replacementPending = false;
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
    if (availabilityChanged) this.publishScoringAvailability();
    this.emitGameEvent(gameId, event);

    return {
      status: 'ok',
      mode: 'official',
      gameId,
      tournamentId,
      ...(nextState.clock ? { serverTime: this.nowIso() } : {}),
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
      ...(game.officialState.clock ? { serverTime: this.nowIso() } : {}),
      state: game.officialState,
      lineup: this.serializeLineupStatus(game, tournament),
      playByPlay: this.serializePlayByPlay(game, tournament)
    };
  }

  gameReport(gameIdRaw: string, tournamentIdRaw: string, detailed: boolean) {
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');
    const tournament = this.getTournamentOrThrow(tournamentId);
    const game = this.games.get(this.requireText(gameIdRaw, 'gameId'));
    if (!game || game.tournamentId !== tournamentId) throw new NotFoundException('El partido no existe en este torneo.');
    const state = this.serializeScorecard(game, tournament);
    const doc = this.tournamentPlanning?.document(tournamentId);
    const rule = doc?.customRules.find(item => item.name.trim().toLowerCase() === 'base del pcl');
    if (rule && !['7', '9'].includes(rule.value.trim())) throw new ConflictException('La regla «Base del PCL» del torneo debe indicar 7 o 9.');
    const eraBase = rule?.value.trim() === '7' ? 7 : rule?.value.trim() === '9' ? 9 : undefined;
    state.seed.names = {
      home: game.details?.homeTeamName ?? doc?.teams.find(team => team.id === game.teams?.homeTeamId)?.name ?? state.seed.names.home,
      away: game.details?.awayTeamName ?? doc?.teams.find(team => team.id === game.teams?.awayTeamId)?.name ?? state.seed.names.away
    };
    return createGameReport(state, {
      source: 'official', detailed, ...(eraBase ? { eraBase } : {}),
      metadata: { tournament: doc?.name ?? game.details?.tournamentName ?? null,
        date: game.details?.date ?? null, time: game.details?.time ?? null, venue: game.details?.venue ?? null,
        revision: game.officialState.officialVersion },
      sourceComplete: this.statisticsSourceComplete(game, state),
      ...(game.playByPlay.events.length === game.playByPlay.sequence ? {
        caughtStealing: new Map([...state.seed.rosters.home, ...state.seed.rosters.away].map(player => [player.id,
          game.playByPlay.events.filter(event => event.type === 'CAUGHT_STEALING' && event.runnerIdentificationNumber === player.id).length]))
      } : {}),
      atBats: new Map(Array.from(game.playByPlay.batterStatsByIdentification, ([id, stats]) => [id, stats.atBats])),
      pitchingWalks: new Map(Array.from(game.playByPlay.pitcherStatsByIdentification, ([id, stats]) => [id, stats.walksAllowed])),
      ...(game.teams ? { offenseIds: { home: game.teams.homeTeamId, away: game.teams.awayTeamId } } : {})
    });
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

  private identityCanScore(game: OfficialGameRecord, identity: string) {
    const tournament = this.getTournamentOrThrow(game.tournamentId);
    return [tournament.organizerId, ...this.serializeGameAuthorization(game, tournament).effectiveScorekeeperIds]
      .some(id => this.actorIdentifications.get(id) === identity);
  }

  private scoringBlockReason(gameId: string, actorId: string): string | null {
    if (this.games.get(gameId)?.officialState.status === 'suspended') return 'Juego suspendido. Solo el organizador puede reprogramarlo; no admite anotaciones.';
    if (this.games.get(gameId)?.officialState.protest) return 'La anotación está bloqueada por protesta. Consulta la resolución de mesa técnica.';
    const plannedGame = this.games.get(gameId);
    if (plannedGame?.officialState.status === 'scheduled' && plannedGame.teams) {
      try {
        for (const teamId of [plannedGame.teams.homeTeamId, plannedGame.teams.awayTeamId])
          this.tournamentPlanning?.assertParticipation(plannedGame.tournamentId, gameId, teamId,
            plannedGame.lineups.get(teamId)?.lineupEntries.map(entry => entry.identificationNumber) ?? [], 'play');
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof ConflictException) return error.message;
        throw error;
      }
    }
    const identity = this.requireActorIdentity(actorId);
    const active = Array.from(this.games.values()).find(game => game.gameId !== gameId &&
      game.officialState.status === 'in_progress' && game.scoringActors.has(identity) && this.identityCanScore(game, identity));
    if (!active) return null;
    const name = active.details ? `${active.details.awayTeamName} vs. ${active.details.homeTeamName}` : 'otro partido';
    return `Ya estás anotando ${name}. Finaliza ese partido o solicita al organizador que te releve antes de anotar otro.`;
  }

  private assertProtestUnlocked(game: OfficialGameRecord) {
    if (game.officialState.status === 'suspended') throw new ConflictException('Juego suspendido. No se modifican jugadas ni datos hasta su reprogramación por el organizador.');
    if (game.officialState.protest) throw new ConflictException('El juego está bloqueado por protesta. No permite modificar jugadas, lineups ni datos; la decisión se registra mediante mesa técnica.');
  }

  private assertScoringAvailable(game: OfficialGameRecord, actorId: string) {
    const reason = this.scoringBlockReason(game.gameId, actorId);
    if (reason) throw new ConflictException(reason);
  }

  private claimScoring(game: OfficialGameRecord, actorId: string) {
    if (game.officialState.status !== 'in_progress') return;
    const identity = this.requireActorIdentity(actorId);
    if (!game.scoringActors.has(identity)) {
      game.scoringActors.add(identity);
      this.publishScoringAvailability();
    }
  }

  private publishScoringAvailability() {
    for (const game of this.games.values()) {
      for (const identity of game.scoringActors) {
        if (!this.identityCanScore(game, identity)) game.scoringActors.delete(identity);
      }
      game.personnelVersion += 1;
      this.emitPersonnel(game.gameId);
    }
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
    if (this.isScorekeeperSubstitute(actorId, game.tournamentId, game.gameId)) return true;

    const isTournamentAuthorized = tournament.authorizedScorekeepers.has(actorId);
    if (!isTournamentAuthorized) {
      return false;
    }

    return game.hasGameScopedAuthorization && game.gameAuthorizedScorekeepers.has(actorId);
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
      intentionalWalk: 'WALK', insideParkHomeRun: 'HOME_RUN', groundRuleDouble: 'HIT_DOUBLE',
      buntHit: 'HIT_SINGLE', buntOut: 'OUT', droppedThirdStrike: 'STRIKEOUT',
      sacrificeBuntError: 'ERROR', sacrificeFlyError: 'ERROR', catcherInterference: 'ERROR',
      walk: 'WALK', hitByPitch: 'HIT_BY_PITCH', strikeout: 'STRIKEOUT', groundOut: 'GROUND_OUT',
      flyOut: 'FLY_OUT', lineOut: 'LINE_OUT', battedOut: 'OUT', ruleOut: 'FORCE_OUT',
      sacrificeFly: 'SACRIFICE_FLY', sacrificeBunt: 'BUNT', error: 'ERROR',
      fieldersChoice: 'FORCE_OUT', doublePlay: 'DOUBLE_PLAY', triplePlay: 'TRIPLE_PLAY'
    };
    if (command.kind === 'pitch') return { type: command.value === 'ball' ? 'BALL' : command.value === 'strike' ? 'STRIKE' : 'FOUL' };
    if (command.kind === 'play') return { type: command.batterRuleOut ? 'OUT' : command.selectionOuts ? 'DOUBLE_PLAY' : plays[command.result], errorOuts: command.errorOuts, note: command.note,
      fielderIdentificationNumber: command.caughtBy?.playerId ?? command.errors?.[0]?.playerId };
    if (command.kind === 'misplay') return { type: 'DROPPED_FOUL', errorOuts: 1, fielderIdentificationNumber: command.errors?.[0]?.playerId };
    if (command.kind === 'courtesy') return { type: 'COURTESY_RUNNER', fromBase: command.from, runnerIdentificationNumber: command.playerId };
    if (command.kind === 'runner') {
      const actions: Record<typeof command.action, PlayEventType> = {
        steal: 'STEAL_BASE', caught: 'CAUGHT_STEALING', pickoff: 'PICKOFF', wild: 'WILD_PITCH',
        passed: 'PASSED_BALL', balk: 'BALK', advance: 'RUNNER_ADVANCE', error: 'ERROR_ADVANCE',
        run: 'RUN_SCORED', ruleOut: 'RUNNER_OUT', advanceOut: 'RUNNER_OUT', obstruction: 'ERROR_ADVANCE'
      };
      return { type: actions[command.action], fromBase: command.from,
        runnerIdentificationNumber: state.bases[command.from - 1] ?? undefined,
        ...(command.to ? { toBase: command.to } : {}), errorOuts: command.errorOuts, note: command.note,
        fielderIdentificationNumber: command.errors?.[0]?.playerId };
    }
    return undefined;
  }

  private applyPlayEvent(game: OfficialGameRecord, input: PlayEventInput, preview?: PrivateState): OfficialPlayEventRecord {
    const previewLog = preview?.log.at(-1);
    if (!game.teams) {
      throw new BadRequestException('Debes definir los equipos del juego antes de registrar jugada a jugada.');
    }

    const type = this.requirePlayEventType(input.type);
    if (!validRunEvidence(input) || input.errorOuts !== undefined && !previewLog?.errors?.length && !['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(type)) {
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
    const errorEvent = ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(type);
    const errorDefender = game.lineups.get(defenseTeamId)?.lineupEntries.find(entry =>
      entry.identificationNumber === fielderFromInput && !['NA', 'DH'].includes(entry.fieldPosition));
    if (errorEvent && !previewLog?.errors?.length && !errorDefender) {
      throw new BadRequestException('Identifica al defensor responsable del error en la alineación defensiva activa.');
    }

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

      if (fielderFromInput && !previewLog?.errors?.length) {
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
      if (fielderFromInput && !previewLog?.errors?.length) this.getOrCreateFieldingStats(game, fielderFromInput).errors += 1;
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
        type === 'ERROR_ADVANCE' ? previewLog?.errors?.some(error => error.type === 'obstruction') ?
          'Avance por obstrucción defensiva.' : 'Avance por error defensivo.' : 'Avance de corredor sin error.';
      if (type === 'ERROR_ADVANCE' && fielderFromInput && !previewLog?.errors?.length) this.getOrCreateFieldingStats(game, fielderFromInput).errors += 1;
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

    for (const error of previewLog?.errors ?? []) this.getOrCreateFieldingStats(game, error.playerId).errors += 1;
    if (preview && previewLog) {
      basesAfter = preview.inning !== game.officialState.inning || preview.side !== (offenseTeamId === game.teams.homeTeamId ? 'home' : 'away') ?
        { first: null, second: null, third: null } : { first: preview.bases[0], second: preview.bases[1], third: preview.bases[2] };
      scoredRunnerIds = previewLog.runs;
      runsScored = previewLog.runs.length;
      outsRecorded = previewLog.outs;
      description = previewLog.text;
      if (previewLog.result) applyAtBatToBatter = !noAtBatResults.includes(previewLog.result);
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
        batterStats.rbis += previewLog ? previewLog.rbis : runsScored;
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

    if (fielderFromInput && outsRecorded > 0 && !previewLog?.errors?.length) {
      const fieldingStats = this.getOrCreateFieldingStats(game, fielderFromInput);
      fieldingStats.outsRecorded += outsRecorded;
    }

    const accountedBasesAfter = [basesAfter.first, basesAfter.second, basesAfter.third];
    const nextAccounting = accountRuns(game.playByPlay.runAccounting, {
      eventId: game.playByPlay.sequence + 1,
      half: `${game.officialState.inning}:${offenseTeamId}`, offenseId: offenseTeamId,
      pitcherId: pitcherFromInput, outsBefore: game.officialState.outs,
      batterId: batterIdentification, plateCompleted, reachedOnError: previewLog?.result ?
        reachedOnErrorResults.includes(previewLog.result) || previewLog.thirdStrikeCause === 'passed' && preview!.bases.includes(batterIdentification) : type === 'ERROR',
      basesBefore: [basesBefore.first, basesBefore.second, basesBefore.third],
      basesAfter: accountedBasesAfter, scored: scoredRunnerIds, totalRuns: runsScored,
      misplay: previewLog?.errors?.length || ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(type) ? 'error' :
        type === 'PASSED_BALL' || previewLog?.thirdStrikeCause === 'passed' ? 'passedBall' : undefined,
      errorOuts: previewLog?.result === 'catcherInterference' ? 0 : type === 'DROPPED_FOUL' ? 1 : input.errorOuts,
      errorSavedRunnerId: previewLog?.errorSavedRunnerId,
      tieBreakerRunnerId: game.playByPlay.tieBreakerRunner?.runnerId,
      passedThirdStrike: previewLog?.thirdStrikeCause === 'passed' && Boolean(preview?.bases.includes(batterIdentification)),
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
    if (inningAfter !== game.officialState.inning || offenseTeamAfter !== offenseTeamId) {
      const nextHalf = this.serializeScorecard(game, this.getTournamentOrThrow(game.tournamentId));
      Object.assign(nextHalf, { inning: inningAfter, side: offenseTeamAfter === game.teams.homeTeamId ? 'home' : 'away',
        outs: outsAfter, balls: ballsAfter, strikes: strikesAfter,
        scores: { home: homeScoreAfter, away: awayScoreAfter }, bases: [null, null, null] });
      placeSoftballTieBreakerRunner(nextHalf, offenseTeamAfter);
      game.playByPlay.runAccounting = nextHalf.runAccounting;
      basesAfter = { first: nextHalf.bases[0], second: nextHalf.bases[1], third: nextHalf.bases[2] };
      game.playByPlay.tieBreakerRunner = nextHalf.tieBreakerRunner;
      if (nextHalf.tieBreakerRunner && !preview) description += ` · ${softballTieBreakerNotice(nextHalf)}`;
    }

    const note = this.normalizeOptionalText(input.note);

    if (previewLog?.fieldingSequence) description += ` · vía ${previewLog.fieldingSequence.join('-')}`;
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
      ...(errorEvent && errorDefender ? { fielderPosition: errorDefender.fieldPosition } : {}),
      ...(previewLog?.strikeoutType ? { strikeoutType: previewLog.strikeoutType } : {}),
      ...(previewLog?.battedBallType ? { battedBallType: previewLog.battedBallType } : {}),
      ...(previewLog?.fieldingSequence ? { fieldingSequence: [...previewLog.fieldingSequence] } : {}),
      ...(previewLog?.caughtBy ? { caughtBy: { ...previewLog.caughtBy } } : {}),
      ...(previewLog?.infieldFly ? { infieldFly: true as const } : {}),
      ...(previewLog?.batterRuleOut ? { batterRuleOut: structuredClone(previewLog.batterRuleOut) } : {}),
      ...(previewLog?.ruleOut ? { ruleOut: structuredClone(previewLog.ruleOut) } : {}),
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
      rbis: awardRbiToBatter ? runsScored : 0, pitcherId: pitcherFromInput,
      ...(errorEvent ? { legacyError: { playerId: fielderFromInput, position: errorDefender?.fieldPosition ?? null } } : {})
    });
    if (game.playByPlay.tieBreakerRunner && (inningAfter !== game.officialState.inning || offenseTeamAfter !== offenseTeamId))
      game.playByPlay.scorecardLog.at(-1)!.tieBreakerRunner = { ...game.playByPlay.tieBreakerRunner };
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
    if (next.status === 'final' && next.clock) next.clock = pauseGameClock(next.clock, next.updatedAt);

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

    this.refreshDirectRosterMembers(tournament);
    return tournament;
  }

  private getOrCreateGame(gameIdRaw: string, tournamentIdRaw: string): OfficialGameRecord {
    const gameId = this.requireText(gameIdRaw, 'gameId');
    const tournamentId = this.requireText(tournamentIdRaw, 'tournamentId');

    const existing = this.games.get(gameId);
    if (existing) {
      if (existing.tournamentId !== tournamentId) {
        throw new BadRequestException(
          `El juego ${gameId} ya existe asociado al torneo ${existing.tournamentId}.`
        );
      }

      existing.softballTieBreakerFromInning ??= Math.max((existing.regulationInnings ?? 7) + 1, existing.officialState.inning + 1);
      return existing;
    }

    if (this.persistentStore && !this.mutationDepth)
      return this.runOfficialMutation(() => this.getOrCreateGame(gameId, tournamentId));
    const newGame: OfficialGameRecord = {
      softballTieBreakerFromInning: 8,
      suspensionArchives: [],
      scoringActors: new Set<string>(),
      hasStarted: false,
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
      details: null,
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
      playByPlay: this.emptyPlayByPlay(),
      events: []
    };

    this.games.set(gameId, newGame);
    return newGame;
  }

  private emptyPlayByPlay(): PlayByPlayRecord {
    return {
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
      };
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
    const effectiveIds = [...new Set([...(game.hasGameScopedAuthorization ? gameScopedIds.filter(id => tournament.authorizedScorekeepers.has(id)) : []),
      ...(game.scorekeeperSubstitutions?.members.filter(member => member.status === 'granted').map(member => member.actorId) ?? [])])];

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
    const participants = (teamId: string | undefined): PrivatePlayer[] => {
      const known = new Map(players(teamId, true).map(player => [player.id, player]));
      for (const request of game.personnelRequests.filter(item => item.teamId === teamId && item.status === 'approved')) {
        const action = request.action;
        if (action.kind === 'substitution') {
          const incoming = roster(teamId).find(player => player.id === action.incomingIdentificationNumber);
          if (incoming) known.set(incoming.id, { ...incoming,
            order: known.get(action.outgoingIdentificationNumber)?.order ?? null,
            position: action.fieldPosition, jersey: action.jerseyNumber });
        } else if (action.kind === 'courtesy') {
          const incoming = roster(teamId).find(player => player.id === action.incomingIdentificationNumber);
          if (incoming && !known.has(incoming.id)) known.set(incoming.id, incoming);
        }
      }
      for (const player of players(teamId)) known.set(player.id, player);
      return [...known.values()];
    };
    const document = this.tournamentPlanning?.document(game.tournamentId);
    const declaredRules = document ? declaredScoringRules(document.sport, document.modality) : undefined;
    const log = structuredClone(game.playByPlay.scorecardLog);
    const events = new Map(game.playByPlay.events.map(event => [event.sequence, event]));
    let sequence = 0;
    for (const entry of log) {
      if (entry.scoringRules) continue;
      const event = events.get(++sequence);
      if (!entry.errors?.length && event && ['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(event.type)) {
        entry.legacyError = { playerId: event.fielderIdentificationNumber, position: event.fielderPosition ?? null };
      }
    }
    return {
      seed: {
        names: { home: home ?? 'Local', away: away ?? 'Visitante' },
        lineups: { home: players(home, true), away: players(away, true) },
        rosters: { home: roster(home), away: roster(away) },
        courtesyRunnerSource: tournament.courtesyRunnerSource,
        regulationInnings: game.regulationInnings,
        softballTieBreakerFromInning: game.softballTieBreakerFromInning ??
          Math.max((game.regulationInnings ?? 7) + 1, game.officialState.inning + 1),
        scoringRules: [...game.playByPlay.scorecardLog].reverse().find(entry => entry.scoringRules)?.scoringRules ?? declaredRules,
        ...(declaredRules ? { sport: declaredRules === 'baseball' ? 'baseball' as const : 'softball' as const } : {})
      },
      lineups: { home: players(home), away: players(away) },
      participants: { home: participants(home), away: participants(away) },
      inning: game.officialState.inning, side: game.officialState.offenseTeamId === home ? 'home' : 'away',
      balls: game.officialState.balls, strikes: game.officialState.strikes, outs: game.officialState.outs,
      scores: { home: game.officialState.homeScore, away: game.officialState.awayScore },
      indexes: { home: home ? game.lineups.get(home)?.currentBatterIndex ?? 0 : 0, away: away ? game.lineups.get(away)?.currentBatterIndex ?? 0 : 0 },
      bases: [game.playByPlay.baseRunners.first, game.playByPlay.baseRunners.second, game.playByPlay.baseRunners.third],
      courtesyFor: structuredClone(game.playByPlay.courtesyFor), log,
      ...(game.playByPlay.events.length < game.playByPlay.sequence ? { fieldingIncomplete: true as const } : {}),
      finished: game.officialState.status === 'final', runAccounting: structuredClone(game.playByPlay.runAccounting),
      ...(game.playByPlay.finalReview ? { finalReview: structuredClone(game.playByPlay.finalReview) } : {}),
      ...(game.playByPlay.tieBreakerRunner ? { tieBreakerRunner: structuredClone(game.playByPlay.tieBreakerRunner) } : {}),
      ...(game.officialState.clock ? { clock: structuredClone(game.officialState.clock) } : {})
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

    const scoringLog = game.playByPlay.scorecardLog.filter(entry => !entry.scoringRules);
    const fieldingErrors: PlayByPlayProjection['fieldingErrors'] = scoringLog.flatMap((entry, index) => {
      const errors = entry.errors?.length ? entry.errors : entry.legacyError?.playerId ?
        [{ playerId: entry.legacyError.playerId, position: entry.legacyError.position, type: null }] : [];
      return errors.map((error, errorIndex) => ({
        sequence: index + 1,
        inning: entry.inning,
        defenseTeamId: game.teams ? entry.side === 'away' ? game.teams.homeTeamId : game.teams.awayTeamId : null,
        fielderIdentificationNumber: error.playerId,
        errorIndex: errorIndex + 1,
        position: error.position,
        type: error.type,
        description: entry.text
      }));
    });
    for (const event of game.playByPlay.events) {
      if (scoringLog[event.sequence - 1]?.errors?.length || scoringLog[event.sequence - 1]?.legacyError?.playerId ||
          !['ERROR', 'ERROR_ADVANCE', 'DROPPED_FOUL'].includes(event.type) || !event.fielderIdentificationNumber) continue;
      fieldingErrors.push({
        sequence: event.sequence, inning: event.inning, defenseTeamId: event.defenseTeamId,
        fielderIdentificationNumber: event.fielderIdentificationNumber, errorIndex: 1,
        position: event.fielderPosition ?? null, type: null, description: event.description
      });
    }
    fieldingErrors.sort((left, right) => left.sequence - right.sequence || left.errorIndex - right.errorIndex);

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
      fieldingErrors,
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
    managerId: string,
    managerIdentification: string
  ) {
    for (const [otherTeamId, roster] of tournament.teamRosters.entries()) {
      if (otherTeamId === teamId) {
        continue;
      }

      if (this.requireActorIdentity(roster.managerId) === managerIdentification) {
        throw new BadRequestException(
          `El manager ${managerId} ya dirige el equipo ${otherTeamId} en este torneo. Puede dirigir otros equipos solo en torneos distintos.`
        );
      }
    }
  }

  private prepareActorIdentity(pending: Map<string, string>, actorId: string, input?: string) {
    const existing = pending.get(actorId) ?? this.actorIdentifications.get(actorId);
    if (input === undefined) {
      if (!existing) throw new BadRequestException(`Debes vincular una cédula a la cuenta ${actorId} antes de asignarle un rol en el torneo.`);
      return existing;
    }
    const identification = this.normalizeIdentificationNumber(input, 'cédula de la cuenta');
    if (existing && existing !== identification) {
      throw new ConflictException('La cuenta ya está vinculada a otra cédula. No puedes cambiar su identidad para eludir la incompatibilidad.');
    }
    pending.set(actorId, identification);
    return identification;
  }

  private commitActorIdentities(pending: Map<string, string>) {
    for (const [actorId, identification] of pending) this.actorIdentifications.set(actorId, identification);
  }

  private requireActorIdentity(actorId: string) {
    const identification = this.actorIdentifications.get(actorId);
    if (!identification) throw new ConflictException('La cuenta no tiene una identidad vinculada. No se puede validar su participación.');
    return identification;
  }

  private scorekeeperIdentityInputs(input: TournamentAuthorizationCommand['scorekeeperIdentities'], allowedIds: string[]) {
    const result = new Map<string, string>();
    if (input === undefined) return result;
    if (!Array.isArray(input)) throw new BadRequestException('Las identidades de anotadores deben enviarse como una lista.');
    for (const entry of input) {
      if (!entry || typeof entry !== 'object') throw new BadRequestException('Cada anotador debe indicar cuenta y cédula.');
      const actorId = this.requireText(entry.actorId, 'cuenta del anotador');
      if (!allowedIds.includes(actorId) || result.has(actorId)) throw new BadRequestException('Las identidades deben corresponder a anotadores solicitados y no pueden repetirse.');
      result.set(actorId, this.normalizeIdentificationNumber(entry.identificationNumber, 'cédula del anotador'));
    }
    return result;
  }

  private assertRoleCompatible(tournament: TournamentAuthorizationRecord, identification: string, group: 'official' | 'participant') {
    const conflicting = group === 'official' ? tournament.participantIdentifications : tournament.officialIdentifications;
    if (conflicting.has(identification)) {
      throw new ConflictException(group === 'official' ?
        'Incompatibilidad de roles: esta persona ya fue jugador o manager en este torneo y no puede ser anotador ni organizador.' :
        'Incompatibilidad de roles: esta persona ya fue organizador o anotador en este torneo y no puede ser jugador ni manager.');
    }
  }

  private assertTeamStaffCompatible(tournament: TournamentAuthorizationRecord, officials: PresentOfficial[]) {
    for (const official of officials) {
      if (official.role !== 'DELEGADO') this.assertRoleCompatible(tournament, official.identificationNumber, 'participant');
    }
  }

  private rememberTeamStaff(tournament: TournamentAuthorizationRecord, officials: PresentOfficial[]) {
    for (const official of officials) {
      if (official.role !== 'DELEGADO') tournament.participantIdentifications.add(official.identificationNumber);
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

    if (visibility === 'free' || record.privateRegistration) {
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
    const registered = this.registration?.resolvePlayer(raw);
    if (registered) return registered.id;
    const person = this.registration?.rosterPerson(raw);
    if (person && this.globalPlayersByIdentification.get(person.id)?.privateRegistration) return person.id;
    if (person?.privateIdentity) return person.id;
    if (/^[VE]-\d+-\d+$/.test(raw)) {
      throw new BadRequestException('Este número de registro no existe. Los códigos de menores los asigna el registro familiar.');
    }
    const normalized = (person?.identification || raw).replace(/[^A-Z0-9]/g, '');

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
import { isProfileLocation, type SportsTournament, type PlayerTeamMembership } from '@playsport/shared';
