'use client';

import { type ComponentRef, type ReactNode, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AccountScorecardClient, availableLineupPositions, availablePersonnelPositions, battingOrderRule, defensivePlayContext, hasAccountFeature, linkScorecardParticipant } from '@playsport/shared';
import ParticipantIdentityLinks from './participant-identity-links';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy, useNavigationDraft, useScreenBack } from '../../navigation-hooks';
import { isTextDraft } from '../../navigation-drafts';
import type { PersonnelAction, TeamSheetPlayer } from '@playsport/shared';
import { fillDemoScorecardJerseys, getDemoJerseyNumber } from './demo-players';
import DemoJerseyAssignments from './demo-jersey-assignments';
import PrivateInningCell from './private-inning-cell';
import DefensiveErrorsSheet from './defensive-errors-sheet';
import LiveScoringHeader from './live-scoring-header';
import GameClockDisplay from './game-clock';
import { changeGameClock, isTimedScoringCommand, pauseGameClock, startOrResumeGameClock, type GameClockAction } from '@playsport/shared';
import { InstitutionName } from '../../institutional-logos';
import PredeterminedPlays from './predetermined-plays';
import DefensiveRouteFields from './defensive-route-fields';
import ScorecardPlayerActions, { type PlayerSelection } from './scorecard-player-actions';
import { GameFinalReviewForm, GameReportScreen } from './game-final-report';
import { DefensiveErrorConfirmation } from './defensive-error-fields';
import RunAccountingPanel, { ErrorOutsField } from './run-accounting-panel';
import { personnelDescription, readTeamSheets, TeamSheetPanel, useTeamSheets } from './team-sheets';
import {
  applyPrivateCommand, assertScoringSubmission, createPrivateState, currentBatter, playerName,   privateFinishSuggestion, privateInningEntries, privateInningRuns, privateStats,
  isSoftballScorecard, minimumDestinations, privateFieldingStats, reachedOnErrorResults, readPrivateSave, replayPrivate, runnerLabels, runnerRuleOutHelp, runnerRuleOutIssue, runnerRuleOutLabels, runnerRuleOutOptions, scorecardRegulationInnings, setLastPrivateErrorOuts, softballTieBreakerNotice, undoPrivateCommand,
  type Destination, type PrivateCommand, type PrivatePlayer, type PrivateSeed,
  type PrivateState, type RunnerRuleOut, type Side
} from './private-scorecard';

export type OfficialScorecardControls = {
  actorRole?: 'organizer' | 'scorekeeper' | 'manager';
  onClock?: (_action: GameClockAction) => Promise<void>; // eslint-disable-line no-unused-vars
  clockOffsetMs?: number;
  session: Session;
  readOnly: boolean;
  publicView?: boolean;
  busy: boolean;
  canUndo: boolean;
  connection: ReturnType<typeof useTeamSheets>;
  onCommand: (_command: PrivateCommand) => Promise<void>; // eslint-disable-line no-unused-vars
  onPersonnelRequest?: (_side: Side, _action: PersonnelAction) => Promise<void>; // eslint-disable-line no-unused-vars
  onFriendlyArrival?: (_side: Side, _outId: string, _name: string) => Promise<void>; // eslint-disable-line no-unused-vars
  onUndo: () => Promise<void>;
  onDuration: (_innings: 7 | 9) => Promise<void>; // eslint-disable-line no-unused-vars
  onErrorOuts: (_outs: number | null) => Promise<void>; // eslint-disable-line no-unused-vars
};
type Props = {
  friendly?: boolean;
  apiBase: string;
  tournamentId: string;
  gameId: string;
  managerId: string;
  homeId: string;
  awayId: string;
  ownSide: Side;
  homeName: string;
  awayName: string;
  initialLineup: PrivatePlayer[];
  positionLabels: Record<string, string>;
  onBack: () => void;
  headerTools?: ReactNode;
  matchChat?: ReactNode;
} & ({
  observation: PrivateState;
  example?: never;
  official?: never;
} | {
  observation?: never;
  example?: { seed: PrivateSeed; commands: PrivateCommand[]; presentSubstitutes?: Record<Side, string[]> };
  official?: OfficialScorecardControls;
});
export type Session = { seed: PrivateSeed; commands: PrivateCommand[]; state: PrivateState };
const baseActions = ['steal', 'caught', 'pickoff', 'advance', 'advanceOut', 'courtesy', 'ruleOut'] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return 'No se pudo guardar la anotación privada.';
  if (error.name === 'QuotaExceededError') return 'No hay espacio disponible en este navegador. La anotación no se guardó.';
  if (error.name === 'SecurityError') return 'Este navegador no permite guardar la planilla. Revisa sus permisos de almacenamiento.';
  if (error instanceof SyntaxError) return 'El servicio devolvió datos que no se pueden leer.';
  if (/Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED/.test(error.message)) return 'No hay conexión con el servicio de anotación. Vuelve a intentarlo cuando esté disponible.';
  return error.message;
};

export function privateStorageKey(tournamentId: string, gameId: string, teamId: string, managerId: string) {
  return `playsport:private-scorecard:v1:${tournamentId}:${gameId}:${teamId}:${managerId}`;
}

function readRoster(value: unknown): PrivatePlayer[] {
  if (!record(value) || !Array.isArray(value.rosterPlayers)) throw new Error('No se pudo leer la plantilla del equipo.');
  return value.rosterPlayers.map((player) => {
    if (!record(player) || typeof player.identificationNumber !== 'string' || typeof player.displayName !== 'string') {
      throw new Error('La plantilla contiene un jugador con datos inválidos.');
    }
    return {
      id: player.identificationNumber, name: player.displayName, order: null, position: 'NA',
      jersey: getDemoJerseyNumber(player.identificationNumber)
    };
  });
}

function readOpponentLineup(value: unknown, teamId: string, roster: PrivatePlayer[]): PrivatePlayer[] {
  if (!record(value) || !record(value.lineup) || !Array.isArray(value.lineup.lineups)) throw new Error('No se pudo leer la alineación rival.');
  const lineup = value.lineup.lineups.find((row: unknown) => record(row) && row.teamId === teamId);
  if (lineup === undefined) return [];
  if (!record(lineup) || !Array.isArray(lineup.lineupEntries)) throw new Error('La alineación rival no tiene un formato válido.');
  return lineup.lineupEntries.map((entry) => {
    if (!record(entry) || typeof entry.identificationNumber !== 'string' ||
        typeof entry.fieldPosition !== 'string' || (entry.battingOrder !== null && typeof entry.battingOrder !== 'number') ||
        (entry.jerseyNumber !== null && typeof entry.jerseyNumber !== 'string')) throw new Error('La alineación rival contiene datos inválidos.');
    const player = roster.find((p) => p.id === entry.identificationNumber);
    if (!player) throw new Error('Un jugador de la alineación rival no pertenece a su plantilla.');
    return { ...player, order: entry.battingOrder, position: entry.fieldPosition, jersey: entry.jerseyNumber ?? '' };
  });
}

export default function PrivateScorecardView(props: Props) {
  if (!props.example && !props.official && !props.observation) return <AccountPrivateScorecard {...props} />;
  return <ScorecardView {...props} />;
}
function AccountPrivateScorecard(props: Props) {
  const { account, ready } = usePlatformSession();
  if (!ready) return <p role="status">Comprobando tu cuenta…</p>;
  if (!account) return <section className="managerCard"><h2>Planilla privada</h2>
    <p>Inicia sesión para guardar y recuperar tu planilla en cualquier dispositivo.</p><Link href="/account">Iniciar sesión</Link></section>;
  return <ScorecardView key={`${account.id}:${props.tournamentId}:${props.gameId}`} {...props} accountId={account.id} />;
}
function ScorecardView(props: Props & { accountId?: string }) {
  const { account, session: platformSession } = usePlatformSession();
  const activeRole = props.official?.actorRole ?? platformSession?.role;
  const detailedStatistics = Boolean(props.example || (activeRole === 'scorekeeper' ?
    hasAccountFeature(account, 'scorekeeper-box-score') : activeRole !== 'manager' || hasAccountFeature(account, 'team-statistics')));
  const [finishReview, setFinishReview] = useState(false);
  const [showReport, setShowReport] = useState(true);
  const draftScope = props.observation || props.official?.readOnly ? null : `${props.tournamentId}:${props.gameId}:${props.ownSide}:scorecard`;
  const initial = useRef(props);
  const heading = useRef<ComponentRef<'h2'>>(null);
  const lineupHeading = useRef<ComponentRef<'h2'>>(null);
  const [localSession, setSession] = useState<Session | null>(null);
  const session: Session | null = props.observation ?
    { seed: props.observation.seed, commands: [], state: props.observation } : props.official?.session ?? localSession;
  const sessionRef = useRef<Session | null>(null);
  if (props.official || props.observation) sessionRef.current = session;
  const savedRaw = useRef<string | null>(null);
  const accountClient = useMemo(() => new AccountScorecardClient(), []);
  const accountRevision = useRef(0);
  const saving = useRef(false);
  const [persisting, setPersisting] = useState(false);
  useNavigationBusy(persisting);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingError, setPendingError] = useState<PrivateCommand | null>(null);
  const [dismissedFinish, setDismissedFinish] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [playerSelection, setPlayerSelection] = useState<PlayerSelection | null>(null);
  const [playerChanging, setPlayerChanging] = useState(false);
  const playerSending = useRef(false);
  const [activeBase, setActiveBase] = useState<number | null>(null);
  const [baseDetail, setBaseDetail] = useState<'advance' | 'advanceOut' | 'courtesy' | 'ruleOut' | null>(null);
  const [runnerOut, setRunnerOut] = useState<{ detail?: RunnerRuleOut; note: string; confirmed: boolean }>({ note: '', confirmed: false });
  const [advanceCause, setAdvanceCause] = useNavigationDraft(draftScope && `${draftScope}:advance`, '', isTextDraft);
  const [errorOuts, setErrorOuts] = useNavigationDraft(draftScope && `${draftScope}:error-outs`, '', isTextDraft);
  const [homeOutFrom, setHomeOutFrom] = useNavigationDraft(draftScope && `${draftScope}:home-out`, '', isTextDraft);
  const [incoming, setIncoming, incomingReady] = useNavigationDraft(draftScope && `${draftScope}:incoming`, '', isTextDraft);
  const [outgoing, setOutgoing, outgoingReady] = useNavigationDraft(draftScope && `${draftScope}:outgoing`, '', isTextDraft);
  const [swapTarget, setSwapTarget] = useNavigationDraft(draftScope && `${draftScope}:swap`, '', isTextDraft);
  const [position, setPosition, positionReady] = useNavigationDraft(draftScope && `${draftScope}:position`, 'P', isTextDraft);
  const [jersey, setJersey, jerseyReady] = useNavigationDraft(draftScope && `${draftScope}:jersey`, '', isTextDraft);
  const jerseyPlayer = useRef<{ side: Side; id: string } | null>(null);
  useScreenBack(() => {
    if (activeBase !== null) { setActiveBase(null); setBaseDetail(null); }
    else setLineupOpen(false);
  }, lineupOpen || activeBase !== null, 3);
  const [runnerRule, setRunnerRule] = useState<'BENCH' | 'ROSTER' | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [pendingRoute, setPendingRoute] = useState<{
    command: Extract<PrivateCommand, { kind: 'runner' }>; context: string; sequence: number[]
  } | null>(null);
  const routePanel = useRef<ComponentRef<'section'>>(null);
  const routeSending = useRef(false);
  useScreenBack(() => setPendingRoute(null), pendingRoute !== null, 4);
  useEffect(() => {
    if (!pendingRoute) return;
    routePanel.current?.focus({ preventScroll: true });
    routePanel.current?.scrollIntoView({ block: 'start' });
  }, [pendingRoute?.context]);
  useEffect(() => setPendingRoute(null), [props.gameId, props.tournamentId, props.ownSide]);
  const ownPlayers = session?.state.lineups[props.ownSide];
  const teamId = props.ownSide === 'home' ? props.homeId : props.awayId;
  const storageKey = privateStorageKey(props.tournamentId, props.gameId, teamId, props.managerId);
  const accountScope = JSON.stringify([props.tournamentId, props.gameId, teamId]);
  const localDelivery = useTeamSheets({
    apiBase: props.apiBase, gameId: props.gameId, tournamentId: props.tournamentId, userId: props.managerId, role: 'manager',
    enabled: !props.example && !props.official && !props.observation
  });
  const delivery = props.official?.connection ?? localDelivery;
  const deliveredSheet = delivery.data?.sheets.find(sheet => sheet.teamId === teamId);
  const availablePositions = useMemo(() => deliveredSheet && !props.friendly && !props.example ?
    availablePersonnelPositions(deliveredSheet, outgoing) : availableLineupPositions(
      (ownPlayers ?? []).map(player => ({ identificationNumber: player.id, fieldPosition: player.position })), outgoing
    ), [deliveredSheet, props.friendly, props.example, ownPlayers, outgoing]);
  const readOnly = Boolean(props.observation) || (props.official?.readOnly ?? false);
  const writeBlocked = readOnly || Boolean(props.official?.busy) || persisting;
  const privatePlayer = (player: TeamSheetPlayer): PrivatePlayer => ({
    id: player.identificationNumber, name: player.displayName, order: player.battingOrder,
    position: player.fieldPosition, jersey: player.jerseyNumber ?? ''
  });

  useEffect(() => {
    setActiveBase(null); setBaseDetail(null);
  }, [props.ownSide]);

  useEffect(() => {
    if (outgoingReady && positionReady && !availablePositions.includes(position)) setPosition(availablePositions[0] ?? '');
  }, [availablePositions, position, outgoingReady, positionReady, setPosition]);

  useEffect(() => {
    if (!incomingReady || !jerseyReady) return;
    const previous = jerseyPlayer.current;
    jerseyPlayer.current = { side: props.ownSide, id: incoming };
    if ((!previous || previous.side !== props.ownSide) && jersey) return;
    if (previous?.side === props.ownSide && previous.id === incoming) return;
    const player = sessionRef.current?.seed.rosters[props.ownSide].find((entry) => entry.id === incoming);
    setJersey(props.friendly ? '' : player?.jersey || getDemoJerseyNumber(incoming));
  }, [incoming, incomingReady, jerseyReady, jersey, props.ownSide, props.friendly, setJersey]);

  useEffect(() => {
    if (lineupOpen) lineupHeading.current?.focus();
    else heading.current?.focus();
  }, [lineupOpen]);

  useEffect(() => {
    if (props.official || props.observation) return;
    let active = true;
    const load = async () => {
      setError('');
      try {
        const remote = props.accountId ? (await accountClient.list(accountScope))[0] : undefined;
        if (!active) return;
        accountRevision.current = remote?.revision ?? 0;
        const raw = props.accountId ? null : globalThis.localStorage.getItem(storageKey);
        const saved = remote?.save ?? (raw !== null ? readPrivateSave(raw) : null);
        let seed: PrivateSeed;
        let commands: PrivateCommand[];
        if (saved && (initial.current.example || saved.commands.length > 0 || saved.clock || !initial.current.initialLineup.length)) {
          ({ seed, commands } = saved);
        } else if (initial.current.example) {
          ({ seed, commands } = initial.current.example);
        } else {
          const config = initial.current;
          if (!config.initialLineup.length) throw new Error('Todavía no hay una planilla privada guardada. Prepara y envía primero la alineación.');
          const get = async (path: string): Promise<unknown> => {
            const response = await fetch(`${config.apiBase}/${path}`);
            const body: unknown = await response.json();
            if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : `Error ${response.status} al cargar la planilla.`);
            return body;
          };
          const [home, away, lineups, rules, shared] = await Promise.all([
            get(`tournaments/${config.tournamentId}/teams/${config.homeId}/roster`),
            get(`tournaments/${config.tournamentId}/teams/${config.awayId}/roster`),
            get(`games/${config.gameId}/lineups?tournamentId=${config.tournamentId}`),
            get(`tournaments/${config.tournamentId}/authorization`),
            get(`games/${config.gameId}/team-sheets?${new URLSearchParams({ tournamentId: config.tournamentId, userId: config.managerId, role: 'manager' })}`)
          ]);
          if (!record(rules) || (rules.courtesyRunnerSource !== 'BENCH' && rules.courtesyRunnerSource !== 'ROSTER')) throw new Error('No se pudo consultar la regla del corredor temporal definida por el organizador.');
          const rosters = { home: readRoster(home), away: readRoster(away) };
          const rivalSide = config.ownSide === 'home' ? 'away' : 'home';
          const opponent = readOpponentLineup(lineups, rivalSide === 'home' ? config.homeId : config.awayId, rosters[rivalSide]);
          const snapshot = readTeamSheets(shared);
          const homeSheet = snapshot.sheets.find((sheet) => sheet.teamId === config.homeId);
          const awaySheet = snapshot.sheets.find((sheet) => sheet.teamId === config.awayId);
          seed = {
            names: { home: config.homeName, away: config.awayName },
            rosters,
            lineups: config.ownSide === 'home' ? { home: config.initialLineup, away: opponent } : { home: opponent, away: config.initialLineup },
            courtesyRunnerSource: rules.courtesyRunnerSource
          };
          if (saved?.seed.regulationInnings !== undefined) seed.regulationInnings = saved.seed.regulationInnings;
          if (homeSheet) seed.lineups.home = homeSheet.lineup.map(privatePlayer);
          if (awaySheet) seed.lineups.away = awaySheet.lineup.map(privatePlayer);
          seed.teamSheetRevisions = { home: homeSheet?.revision ?? 0, away: awaySheet?.revision ?? 0 };
          createPrivateState(seed);
          commands = [];
        }
        seed = fillDemoScorecardJerseys(seed);
        const state = { ...replayPrivate(seed, commands), ...(saved?.clock ? { clock: saved.clock } : {}) };
        if (state.seed.softballTieBreakerFromInning !== undefined) seed = { ...seed, softballTieBreakerFromInning: state.seed.softballTieBreakerFromInning };
        if (!active) return;
        const serialized = JSON.stringify({ version: 1, seed, commands, ...(state.clock ? { clock: state.clock } : {}) });
        if (props.accountId) {
          if (!remote) {
            const stored = await accountClient.save(accountScope, 0, readPrivateSave(serialized));
            accountRevision.current = stored.revision;
          }
        } else {
          if (globalThis.localStorage.getItem(storageKey) !== raw) throw new Error('La planilla cambió en otra pestaña. Vuelve a abrirla para no sobrescribir anotaciones.');
          globalThis.localStorage.setItem(storageKey, serialized);
        }
        if (!active) return;
        savedRaw.current = serialized;
        sessionRef.current = { seed, commands, state };
        setSession(sessionRef.current);
        heading.current?.focus();
      } catch (failure) {
        if (active) setError(`No se pudo abrir la planilla privada: ${errorText(failure)} No se alteró la copia guardada.`);
      }
    };
    void load();
    return () => { active = false; };
  }, [storageKey, accountScope, accountClient, props.accountId, attempt, props.official, props.observation]);

  const save = async (next: Session) => {
    if (props.observation) throw new Error('Esta pizarra es de solo lectura y no guarda anotaciones.');
    if (props.official) throw new Error('Las anotaciones oficiales solo se guardan en el servicio del partido.');
    if (next.state.seed.softballTieBreakerFromInning !== undefined) next = { ...next,
      seed: { ...next.seed, softballTieBreakerFromInning: next.state.seed.softballTieBreakerFromInning } };
    if (saving.current) throw new Error('Espera a que termine de guardarse la anotación anterior.');
    if (!props.accountId && globalThis.localStorage.getItem(storageKey) !== savedRaw.current) throw new Error('Otra pestaña modificó esta planilla. Vuelve a abrirla antes de continuar.');
    const clock = next.state.clock ?? sessionRef.current?.state.clock;
    if (clock) next = { ...next, state: { ...next.state, clock: next.state.finished ? pauseGameClock(clock, new Date().toISOString()) : clock } };
    const raw = JSON.stringify({ version: 1, seed: next.seed, commands: next.commands, ...(next.state.clock ? { clock: next.state.clock } : {}) });
    if (props.accountId) {
      saving.current = true; setPersisting(true);
      try {
        const stored = await accountClient.save(accountScope, accountRevision.current, readPrivateSave(raw));
        accountRevision.current = stored.revision;
      } finally { saving.current = false; setPersisting(false); }
    } else globalThis.localStorage.setItem(storageKey, raw);
    savedRaw.current = raw;
    sessionRef.current = next;
    setSession(next);
    setActiveBase(null);
    setBaseDetail(null);
    setErrorOuts('');
    setAdvanceCause('');
    setError('');
    setNotice('');
  };
  const changeClock = async (action: GameClockAction) => {
    if (props.official) {
      if (!props.official.onClock) { setError('El cronómetro no está disponible en esta pizarra.'); return; }
      void props.official.onClock(action).catch(failure => setError(errorText(failure)));
      return;
    }
    try {
      const current = sessionRef.current;
      if (!current || props.observation || current.state.finished) throw new Error('Esta pizarra no permite modificar el tiempo.');
      await save({ ...current, state: { ...current.state, clock: changeGameClock(current.state.clock, action, new Date().toISOString()) } });
    } catch (failure) { setError(errorText(failure)); }
  };
  const configureRegulationInnings = async (value: string) => {
    if (props.official) {
      if (value === '7' || value === '9') void props.official.onDuration(value === '7' ? 7 : 9).catch((failure) => setError(errorText(failure)));
      return;
    }
    try {
      const current = sessionRef.current;
      if (!current) throw new Error('No se pudo leer el seguimiento privado.');
      if (current.state.finished) throw new Error('Deshaz el cierre antes de cambiar la duración del seguimiento.');
      if (value !== '' && value !== '7' && value !== '9') throw new Error('Selecciona softbol a 7 entradas o béisbol a 9 entradas.');
      const seed = { ...current.seed };
      if (value === '') delete seed.regulationInnings;
      else seed.regulationInnings = value === '7' ? 7 : 9;
      if (isSoftballScorecard(current.state.seed) && scorecardRegulationInnings(current.state.seed) !== scorecardRegulationInnings({ ...current.state.seed, regulationInnings: seed.regulationInnings }) &&
          current.state.inning > Math.min(scorecardRegulationInnings(current.state.seed) ?? 7, seed.regulationInnings ?? 7))
        throw new Error('La duración no se puede cambiar después de alcanzar las entradas extra.');
      await save({ ...current, seed, state: replayPrivate(seed, current.commands) });
      setDismissedFinish(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const configureLastErrorOuts = async (value: string) => {
    if (props.official) {
      void props.official.onErrorOuts(value === '' ? null : Number(value)).catch((failure) => setError(errorText(failure)));
      return;
    }
    try {
      const current = sessionRef.current;
      if (!current) throw new Error('No se pudo leer el seguimiento privado.');
      if (!['', '0', '1', '2', '3'].includes(value)) throw new Error('Indica entre cero y tres outs evitados por el error.');
      await save({ ...current, ...setLastPrivateErrorOuts(current.seed, current.commands, value === '' ? undefined : Number(value)) });
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const annotate = async (command: PrivateCommand) => {
    const current = sessionRef.current;
    if (!current) { setError('No se pudo leer la pizarra para registrar la jugada.'); return false; }
    try {
      if (writeBlocked) throw new Error(readOnly ? 'Esta pizarra solo permite consultar el partido.' : 'Espera a que termine de guardarse la anotación anterior.');
      if (pendingRoute && (command.kind !== 'runner' || command.action !== pendingRoute.command.action ||
          command.from !== pendingRoute.command.from || !command.fieldingSequence))
        throw new Error('Completa o cancela el recorrido defensivo pendiente.');
      if (command.kind === 'runner' && ['caught', 'pickoff', 'advanceOut'].includes(command.action) && !command.fieldingSequence) {
        setPendingRoute({ command, context: defensivePlayContext(current.state), sequence: [] });
        return false;
      }
      try { assertScoringSubmission(current.state, command); }
      catch (failure) {
        if ((command.kind === 'misplay' ||
            command.kind === 'runner' && ['error', 'obstruction'].includes(command.action) ||
            command.kind === 'play' && reachedOnErrorResults.includes(command.result)) && !command.errors?.length) {
          setPendingError(command);
          return false;
        }
        throw failure;
      }
      if (props.official) {
        await props.official.onCommand(command);
        if (command.kind === 'substitution' || command.kind === 'position') {
          setOutgoing(''); setIncoming(''); setSwapTarget('');
        }
        setActiveBase(null); setBaseDetail(null); setError(''); setNotice(props.friendly ? 'Anotación del amistoso guardada.' : 'Anotación oficial guardada y compartida en vivo.');
        return true;
      }
      // Explicit destinations preserve new advances without changing replay of older saved plays.
      const recordedCommand = command.kind === 'play' && command.destinations === undefined
        ? { ...command, destinations: minimumDestinations(current.state, command.result) }
        : command;
      let action: PersonnelAction | null = null;
      if (command.kind === 'substitution') action = {
        kind: 'substitution', outgoingIdentificationNumber: command.outId, incomingIdentificationNumber: command.inId,
        fieldPosition: command.position, jerseyNumber: command.jersey, ...(command.arrival ? { arrival: true } : {})
      };
      if (command.kind === 'position') action = { kind: 'defense', identificationNumber: command.playerId, fieldPosition: command.position,
        ...(command.swapWith ? { swapWith: command.swapWith } : {}) };
      if (command.kind === 'courtesy' && current.state.side === props.ownSide) {
        const runner = current.state.bases[command.from - 1];
        if (!runner) throw new Error('No hay corredor en la base seleccionada.');
        action = {
          kind: 'courtesy', fromBase: command.from, outgoingIdentificationNumber: current.state.courtesyFor[runner] ?? runner,
          incomingIdentificationNumber: command.playerId
        };
      }
      if (action && !props.example) {
        applyPrivateCommand(current.state, command);
        await delivery.request(teamId, action);
        setActiveBase(null);
        setBaseDetail(null);
        setError('');
        setNotice('Movimiento comunicado y pendiente de confirmación. Todavía no se aplicó a la alineación ni a la planilla privada.');
        return false;
      }
      let state = applyPrivateCommand(current.state, recordedCommand);
      if (isTimedScoringCommand(recordedCommand)) state = {
        ...state, clock: startOrResumeGameClock(current.state.clock, new Date().toISOString())
      };
      await save({ ...current, commands: [...current.commands, recordedCommand], state });
      return true;
    } catch (failure) {
      setError(errorText(failure));
      setNotice('');
      return false;
    }
  };
  const undo = async () => {
    if (props.official) {
      void props.official.onUndo().then(() => { setError(''); setDismissedFinish(null); setNotice(props.friendly ? 'Última anotación del amistoso deshecha.' : 'Última anotación oficial deshecha.'); })
        .catch((failure) => setError(errorText(failure)));
      return;
    }
    const current = sessionRef.current;
    if (!current || !current.commands.length) return;
    try {
      await save({ ...current, ...undoPrivateCommand(current.seed, current.commands) });
      setDismissedFinish(null);
      setNotice('Última anotación privada deshecha y guardada.');
    } catch (failure) { setError(errorText(failure)); }
  };
  const refreshRunnerRule = async () => {
    if (props.friendly) {
      const rule = sessionRef.current?.seed.courtesyRunnerSource;
      if (!rule) throw new Error('No se pudo leer la regla del amistoso.');
      setRunnerRule(rule);
      return rule;
    }
    if (props.example) {
      setRunnerRule(props.example.seed.courtesyRunnerSource);
      return props.example.seed.courtesyRunnerSource;
    }
    const response = await fetch(`${props.apiBase}/tournaments/${props.tournamentId}/authorization`);
    const body: unknown = await response.json();
    if (!response.ok || !record(body) || (body.courtesyRunnerSource !== 'BENCH' && body.courtesyRunnerSource !== 'ROSTER')) {
      throw new Error('No se pudo consultar la regla vigente del organizador. No se registró ningún corredor temporal.');
    }
    setRunnerRule(body.courtesyRunnerSource);
    return body.courtesyRunnerSource;
  };
  const consultRunnerRule = async (register: boolean, base: number) => {
    setRuleBusy(true);
    try {
      const sourceRule = await refreshRunnerRule();
      if (register) await annotate({ kind: 'courtesy', from: base, playerId: incoming, sourceRule });
      else { setError(''); setNotice(props.friendly ? 'Regla del corredor temporal del amistoso consultada.' : props.example ? 'Regla de práctica del corredor temporal consultada.' : 'Regla del corredor temporal actualizada desde el organizador.'); }
    } catch (failure) {
      setError(errorText(failure));
    } finally { setRuleBusy(false); }
  };

  const loaded = session !== null;
  useEffect(() => {
    if (props.official || props.observation) return;
    const snapshot = delivery.data;
    const starting = sessionRef.current;
    if (!snapshot || !starting) return;
    const synchronize = async () => {
    let current = starting;
    try {
      const receive = (command: PrivateCommand) => {
        if (!current) return;
        current = { ...current, commands: [...current.commands, command], state: applyPrivateCommand(current.state, command) };
      };
      for (const sheet of snapshot.sheets) {
        const side: Side = sheet.teamId === props.homeId ? 'home' : 'away';
        if ((current.state.seed.teamSheetRevisions?.[side] ?? 0) === 0) {
          receive({
            kind: 'received-lineup', side, players: sheet.initialLineup.map(privatePlayer),
            sharedRequestId: `initial:${sheet.teamId}`, teamSheetSide: side, teamSheetRevision: 1
          });
        }
        const approved = snapshot.requests.filter((request) => request.teamId === sheet.teamId && request.status === 'approved' && request.appliedRevision !== null)
          .sort((a, b) => (a.appliedRevision ?? 0) - (b.appliedRevision ?? 0));
        for (const request of approved) {
          if (request.appliedRevision === null || request.appliedRevision <= (current.state.seed.teamSheetRevisions?.[side] ?? 0)) continue;
          const action = request.action;
          let command: PrivateCommand = { kind: 'note', note: `Movimiento confirmado en ${current.state.seed.names[side]}: ${personnelDescription(action, props.positionLabels)}` };
          if (action.kind === 'substitution') command = {
            kind: 'substitution', side, outId: action.outgoingIdentificationNumber, inId: action.incomingIdentificationNumber,
            position: action.fieldPosition, jersey: action.jerseyNumber, ...(action.arrival ? { arrival: true } : {})
          };
          if (action.kind === 'defense') command = { kind: 'position', side, playerId: action.identificationNumber, position: action.fieldPosition,
            ...(action.swapWith ? { swapWith: action.swapWith } : {}) };
          if (action.kind === 'courtesy') {
            const runner = current.state.bases[action.fromBase - 1];
            if (current.state.side === side && runner && (current.state.courtesyFor[runner] ?? runner) === action.outgoingIdentificationNumber) {
              if (!request.courtesyRunnerSource) throw new Error('No se recibió la regla con la que se confirmó el corredor temporal.');
              command = { kind: 'courtesy', from: action.fromBase, playerId: action.incomingIdentificationNumber, sourceRule: request.courtesyRunnerSource };
            } else {
              command = { kind: 'note', note: `Corredor temporal confirmado: ${personnelDescription(action, props.positionLabels)}. No se modificaron las bases privadas porque no coinciden con el momento del movimiento.` };
            }
          }
          receive({ ...command, sharedRequestId: request.id, teamSheetSide: side, teamSheetRevision: request.appliedRevision });
        }
      }
      if (current !== sessionRef.current) {
        await save(current);
        setOutgoing('');
        setIncoming('');
        setSwapTarget('');
        setNotice('Movimientos confirmados recibidos y guardados en la planilla privada. Las jugadas privadas no se enviaron.');
      }
    } catch (failure) {
      setError(`No se pudo reflejar el movimiento confirmado en la planilla privada: ${errorText(failure)}. Revisa la entrega compartida y reintenta la sincronización.`);
    }
    };
    void synchronize();
  }, [delivery.data, loaded, props.homeId, props.positionLabels, syncAttempt, props.official, props.observation]);

  const lineupControl = <button type="button" className="managerButtonOutline" disabled={!session}
      aria-pressed={lineupOpen} onClick={() => {
        setActiveBase(null);
        setBaseDetail(null);
        setLineupOpen(true);
      }}>{props.official || props.observation ? 'Alineaciones del partido' : 'Mi Alineación'}</button>;
  const sharedHeader = Boolean(props.official || props.observation);
  const header = <LiveScoringHeader tools={sharedHeader ? <>{props.headerTools}{lineupControl}</> : props.headerTools}>
    {sharedHeader ? null : lineupControl}
  </LiveScoringHeader>;
  if (!session) return (
    <>
    {header}
    {props.matchChat}
    <article className="managerCard managerStepCard">
      <h2>Planilla privada del partido</h2>
      {error ? <p role="alert">{error}</p> : <p role="status">Abriendo planilla privada…</p>}
      <div className="managerButtonRow">
        <button type="button" className="managerButtonOutline" onClick={props.onBack}>Volver al partido</button>
        {error ? <button type="button" className="managerButtonOutline" onClick={() => setAttempt((n) => n + 1)}>Reintentar</button> : null}
      </div>
    </article>
    </>
  );
  const state = session.state;
  const participantLinks = props.accountId ? <ParticipantIdentityLinks seed={state.seed} busy={persisting}
    onSave={async identity => {
      const current = sessionRef.current;
      if (!current) throw new Error('No se pudo recuperar la planilla para vincular al participante.');
      const seed = linkScorecardParticipant(current.seed, identity);
      await save({ ...current, seed, state: replayPrivate(seed, current.commands) });
    }} /> : null;
  const reportAvailable = Boolean(props.example || props.official || props.accountId);
  if (state.finished && showReport && reportAvailable) {
    const endpoint = props.friendly ? `/api/friendly-games/${encodeURIComponent(props.gameId)}/final-report` :
      props.official ? `${props.apiBase}/games/${encodeURIComponent(props.gameId)}/final-report?${new URLSearchParams({
        tournamentId: props.tournamentId, ...(activeRole === 'scorekeeper' ? { role: 'scorekeeper' } : {}),
      })}` :
        props.accountId ? `/api/accounts/scorecards/report?${new URLSearchParams({ scope: accountScope })}` : undefined;
    return <>{participantLinks}<GameReportScreen key={`${account?.id ?? 'public'}:${props.gameId}:${state.log.length}`} state={state}
      endpoint={endpoint} onBack={() => setShowReport(false)} onExit={props.onBack} showDetails={detailedStatistics} /></>;
  }
  const requestFinish = () => {
    if (writeBlocked || pendingRoute || pendingError || ruleBusy || delivery.busy) {
      setError('Termina o cancela la operación pendiente antes de revisar el cierre.');
      return;
    }
    setError(''); setFinishReview(true);
  };
  const mayChangePlayer = (side: Side) => !state.finished && !props.observation &&
    (props.friendly || props.example ? true : props.official ?
      !readOnly || Boolean(props.official.onPersonnelRequest) && delivery.data?.ownTeamId === (side === 'home' ? props.homeId : props.awayId) :
      !readOnly && side === props.ownSide);
  const changePlayer = async (command: PrivateCommand) => {
    if (playerSending.current) return false;
    playerSending.current = true; setPlayerChanging(true);
    try {
      const current = sessionRef.current;
      if (!current || !playerSelection || defensivePlayContext(current.state) !== playerSelection.context)
        throw new Error('La hoja cambió. Vuelve a tocar al jugador antes de registrar el cambio.');
      if (!mayChangePlayer(playerSelection.side) || props.official?.busy || persisting || delivery.busy || pendingRoute)
        throw new Error('Este movimiento no está disponible. Revisa los permisos y termina la operación pendiente.');
      assertScoringSubmission(current.state, command);
      if (command.kind !== 'position' && command.kind !== 'substitution') throw new Error('Selecciona un cambio de jugadores válido.');
      const action: PersonnelAction = command.kind === 'position' ?
        { kind: 'defense', identificationNumber: command.playerId, fieldPosition: command.position, ...(command.swapWith ? { swapWith: command.swapWith } : {}) } :
        { kind: 'substitution', outgoingIdentificationNumber: command.outId, incomingIdentificationNumber: command.inId,
          fieldPosition: command.position, jerseyNumber: command.jersey, ...(command.arrival ? { arrival: true } : {}) };
      if (props.official?.onPersonnelRequest) {
        await props.official.onPersonnelRequest(command.side, action);
        setNotice('Solicitud enviada; el cambio espera confirmación del anotador u organizador.');
      } else if (!props.official && !props.example) {
        await delivery.request(command.side === 'home' ? props.homeId : props.awayId, action);
        setNotice('Solicitud enviada; el cambio espera confirmación del anotador u organizador.');
      } else if (props.official) {
        await props.official.onCommand(command);
        setNotice(props.friendly ? 'Anotación del amistoso guardada.' : 'Anotación oficial guardada y compartida en vivo.');
      } else {
        await save({ ...current, commands: [...current.commands, command], state: applyPrivateCommand(current.state, command) });
        setNotice('Cambio de práctica guardado.');
      }
      setError(''); setPlayerSelection(null);
      return true;
    } catch (failure) { setError(errorText(failure)); throw failure; }
    finally { playerSending.current = false; setPlayerChanging(false); }
  };
  const touchPlayer = (side: Side, player: PrivatePlayer) => {
    if (playerSelection?.mode === 'internal') {
      if (side !== playerSelection.side || player.id === playerSelection.id || !state.lineups[side].some(entry => entry.id === player.id)) {
        setError('Toca a otro jugador activo del mismo equipo para intercambiar sus posiciones.');
        return;
      }
      void changePlayer({ kind: 'position', side, playerId: playerSelection.id, position: player.position, swapWith: player.id })
        .catch(failure => setError(errorText(failure)));
    } else {
      setPlayerSelection({ side, id: player.id, mode: 'menu', context: defensivePlayContext(state) });
    }
  };
  const selectedSheet = playerSelection ? delivery.data?.sheets.find(sheet =>
    sheet.teamId === (playerSelection.side === 'home' ? props.homeId : props.awayId)) : undefined;
  const selectedPresent = selectedSheet ? [...selectedSheet.lineup.map(player => player.identificationNumber),
    ...selectedSheet.presentSubstitutes.map(player => player.identificationNumber)] :
    playerSelection && props.example?.presentSubstitutes ? [
      ...state.seed.lineups[playerSelection.side].map(player => player.id), ...props.example.presentSubstitutes[playerSelection.side],
      ...session.commands.flatMap(command => command.kind === 'substitution' && command.side === playerSelection.side ? [command.inId] : [])
    ] : undefined;
  const lastCommand = session.commands.at(-1);
  const finishSuggestion = privateFinishSuggestion(state);
  const finishSuggestionKey = finishSuggestion ? JSON.stringify({ ...finishSuggestion, scores: state.scores }) : null;
  const undoDisabled = writeBlocked || Boolean(pendingRoute) || ruleBusy || (props.official ? !props.official.canUndo : !session.commands.some((command) => !command.sharedRequestId));
  const batter = currentBatter(state);
  const routeRunner = pendingRoute ? state.bases[pendingRoute.command.from - 1] : null;
  const nextBatter = currentBatter({ ...state, indexes: { ...state.indexes, [state.side]: state.indexes[state.side] + 1 } });
  const battingQueue = [
    batter, nextBatter,
    currentBatter({ ...state, indexes: { ...state.indexes, [state.side]: state.indexes[state.side] + 2 } })
  ];
  const lineupSides: Side[] = props.official || props.observation ? ['home', 'away'] : [props.ownSide];
  const ownLineup = state.lineups[props.ownSide];
  const outgoingPlayer = ownLineup.find(player => player.id === outgoing);
  const sourceRule = runnerRule ?? state.seed.courtesyRunnerSource;
  const courtesyPlayers = state.seed.rosters[state.side].filter((player) =>
    !state.bases.includes(player.id) &&
    (sourceRule === 'ROSTER' || !state.lineups[state.side].some((active) => active.id === player.id)));
  const sharedSheet = delivery.data?.sheets.find((sheet) => sheet.teamId === teamId);
  const available = state.seed.rosters[props.ownSide].filter((p) => props.example || props.friendly ?
    !ownLineup.some((active) => active.id === p.id) :
    sharedSheet?.presentSubstitutes.some((sub) => sub.identificationNumber === p.id));
  const innings = Array.from({ length: Math.max(state.seed.regulationInnings ?? (state.seed.sport === 'baseball' ? 9 : 7), state.inning) }, (_, index) => index + 1);
  const sheetPlayers = (side: Side) => {
    const players = new Map(state.seed.lineups[side].map((p) => [p.id, p]));
    state.lineups[side].forEach((p) => players.set(p.id, p));
    state.log.forEach((e) => {
      const ids = e.side === side ? [e.batterId, e.runnerId, ...e.runs, e.stolenBy] :
        [...(e.errors ?? []).map(error => error.playerId), e.legacyError?.playerId];
      for (const id of ids) {
        if (id && !players.has(id)) players.set(id, state.seed.rosters[side].find((p) => p.id === id) ??
          { id, name: playerName(state, id), position: 'NA', jersey: '', order: null });
      }
    });
    return [...players.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  };
  const statusMessages = <>
    {props.accountId ? <p role="status">{persisting ? 'Guardando en tu cuenta…' : error ? 'Comprueba la sincronización antes de continuar.' : 'Planilla privada sincronizada con tu cuenta.'}
      {' '}<Link href="/account/saved-games">Ver mis planillas y recuperar datos anteriores</Link></p> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {error && !props.example && !props.official && !props.observation ? <button type="button" className="managerButtonOutline" onClick={() => setSyncAttempt((n) => n + 1)}>Reintentar sincronización de movimientos confirmados</button> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {softballTieBreakerNotice(state) ? <p className="managerWarning" role="status">{softballTieBreakerNotice(state)}</p> : null}
  </>;
  const battingQueuePanel = <section aria-label="Bateador actual y dos siguientes" aria-live="polite" aria-atomic="true">
          <ol className="privateBattingQueue">
            {battingQueue.map((id, index) => {
              const player = state.lineups[state.side].find((entry) => entry.id === id);
              const stats = privateStats(state, state.side, id);
              return <li key={index} aria-current={index === 0 ? 'true' : undefined}>
                <div className="privateBattingQueueLabel">
                  <strong>{['Al bate', 'Sigue', 'Luego'][index]}</strong>
                  <span className="privateBattingPosition"
                    aria-label={player ? `Posición actual: ${props.positionLabels[player.position]}` : 'Posición sin identificar'}
                    title={player ? props.positionLabels[player.position] : 'Posición sin identificar'}>{player?.position ?? '—'}</span>
                </div>
                <span>{playerName(state, id)}</span>
                {detailedStatistics ? <span className="privateBattingRecord"
                  aria-label={player ? `${stats.hits} ${stats.hits === 1 ? 'imparable' : 'imparables'} en ${stats.atBats} ${stats.atBats === 1 ? 'turno oficial' : 'turnos oficiales'}` : 'Jugador sin identificar: resumen no disponible'}
                  title="Imparables en turnos oficiales del partido">Bateo: {player ? `${stats.hits} de ${stats.atBats}` : '—'}</span> : null}
                <small className="privateBattingMeta">
                  <span aria-label={player ? props.friendly ? `Turno ${player.order}` : `Turno ${player.order} · ${player.jersey ? `Camiseta ${player.jersey}` : 'Camiseta sin registrar'}` : undefined}>
                    {player ? props.friendly ? `${player.order}.º` : `${player.order}.º · ${player.jersey ? `#${player.jersey}` : 'Sin camiseta'}` : 'Alineación no recibida'}
                  </span>
                  {player && detailedStatistics ? <span className="privateBattingAverage" aria-label={`Average del partido: ${stats.average}`}
                    title="Promedio de bateo de este partido">AVG {stats.average}</span> : null}
                </small>
              </li>;
            })}
          </ol>
        </section>;
  const baseControls = <ol className="privateBases" aria-label="Corredores en base">
          {state.bases.map((id, index) => {
            const base = index + 1;
            const next: Destination = base === 3 ? 4 : base === 2 ? 3 : 2;
            const disabled = writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy;
            const runner = id ? state.lineups[state.side].find((player) => player.id === id) ??
              state.seed.rosters[state.side].find((player) => player.id === id) : undefined;
            const runnerStats = id && runner ? privateStats(state, state.side, id) : null;
            const runnerPosition = runner && runner.position !== 'NA' ? runner.position : null;
            const replaced = state.lineups[state.side].find((player) => player.id === (id ? state.courtesyFor[id] ?? id : null));
            const canUseCourtesy = Boolean(replaced && ['P', 'C'].includes(replaced.position) && courtesyPlayers.length);
            const BaseControl = readOnly ? 'div' : 'button';
            const indicator = readOnly ? '' : activeBase === base ? '−' : '+';
            return <li key={base} data-occupied={Boolean(id)}
              data-runner-rule-out={activeBase === base && baseDetail === 'ruleOut' || undefined}
              data-advance-cause={activeBase === base && baseDetail === 'advance' ? advanceCause || undefined : undefined}>
              <BaseControl type={readOnly ? undefined : 'button'} role={readOnly ? 'group' : undefined}
                className={`privateBaseButton${id ? ' privateBaseButtonOccupied' : ''}${readOnly ? ' privateBaseReadOnly' : ''}`} disabled={readOnly ? undefined : disabled}
                aria-label={`${base}.ª Base: ${id ? playerName(state, id) : 'Vacía'}`}
                aria-describedby={id ? `${detailedStatistics ? `private-base-runner-stats-${base} private-base-runner-average-${base} ` : ''}private-base-runner-meta-${base}` : undefined}
                aria-expanded={readOnly ? undefined : activeBase === base} aria-controls={readOnly ? undefined : `private-base-menu-${base}`}
                onClick={readOnly ? undefined : () => {
                  setActiveBase(activeBase === base ? null : base);
                  setBaseDetail(null);
                }}>
                {id ? <>
                  <span className="privateBaseSize" aria-hidden="true">
                    <strong>{base}.ª Base {indicator}</strong>
                    <span>{playerName(state, id)}</span>
                  </span>
                  <span className="privateBaseRunnerContent">
                    <span className="privateBaseHeading">
                      <strong>{base}.ª Base {indicator}</strong>
                    </span>
                    <span className="privateBaseRunnerName" title={playerName(state, id)}>{playerName(state, id)}</span>
                    {detailedStatistics ? <><span id={`private-base-runner-stats-${base}`} className="privateBaseRunnerStats"
                      title="Imparables en turnos oficiales del partido"
                      aria-label={runnerStats ? `${runnerStats.hits} ${runnerStats.hits === 1 ? 'imparable' : 'imparables'} en ${runnerStats.atBats} ${runnerStats.atBats === 1 ? 'turno oficial' : 'turnos oficiales'}` : 'Jugador sin identificar: resumen no disponible'}>
                      Bateo: {runnerStats ? `${runnerStats.hits} de ${runnerStats.atBats}` : '—'}
                    </span>
                    <span id={`private-base-runner-average-${base}`} className="privateBaseRunnerAverage"
                      title="Promedio de bateo de este partido"
                      aria-label={`Average del partido: ${runnerStats?.average ?? '—'}`}>
                      AVG {runnerStats?.average ?? '—'}
                    </span></> : null}
                    <span id={`private-base-runner-meta-${base}`} className="privateBaseRunnerMeta"
                      aria-label={`${!props.friendly ? `${runner?.jersey ? `Camiseta ${runner.jersey}` : 'Camiseta sin registrar'} · ` : ''}${runnerPosition ? `Posición actual: ${props.positionLabels[runnerPosition]}` : 'Posición sin identificar'}`}
                      title={runnerPosition ? props.positionLabels[runnerPosition] : 'Posición sin identificar'}>
                      {!props.friendly ? `#${runner?.jersey || '—'} · ` : ''}{runnerPosition ?? '—'}
                    </span>
                  </span>
                </> : <>
                  <strong>{base}.ª Base {indicator}</strong>
                  <span>Vacía</span>
                </>}
              </BaseControl>
              {!readOnly && activeBase === base ? <div id={`private-base-menu-${base}`} className="privateBaseMenu"
                role="group" aria-label={`Jugadas del corredor en ${base}.ª base`}>
                {!id ? <p>Base vacía: no hay corredor para registrar una jugada.</p> : null}
                {baseActions.map((action) => (
                  <Fragment key={action}>
                    <button type="button" className="managerButtonOutline"
                      aria-expanded={action === 'advance' || action === 'ruleOut' ? baseDetail === action : undefined}
                      aria-controls={action === 'advance' ? `private-base-advance-${base}` : undefined}
                      disabled={disabled || !id || state.seed.scoringRules === 'softball-slowpitch' && ['steal', 'caught'].includes(action) ||
                        (action === 'steal' && next < 4 && Boolean(state.bases[next - 1])) ||
                        (action === 'courtesy' && !canUseCourtesy) ||
                        (action === 'advance' && !([2, 3, 4] as const).some((destination) =>
                          destination > base && (destination === 4 || !state.bases[destination - 1])))}
                      onClick={() => {
                        if (action === 'advance') setBaseDetail(baseDetail === 'advance' ? null : 'advance');
                        else if (action === 'ruleOut') {
                          setRunnerOut({ note: '', confirmed: false }); setBaseDetail(baseDetail === 'ruleOut' ? null : 'ruleOut');
                        }
                        else if (action === 'advanceOut') setBaseDetail(action);
                        else if (action === 'courtesy') {
                          setBaseDetail('courtesy');
                          void consultRunnerRule(false, base);
                        } else {
                          void annotate({ kind: 'runner', action, from: base, to: action === 'steal' ? next : 0 });
                        }
                      }}>{action === 'courtesy' ? 'Corredor temporal' : runnerLabels[action]}</button>
                    {action === 'ruleOut' && baseDetail === 'ruleOut' ? <div className="privateBaseMenu privateRunnerRuleOut" role="group" aria-label="Out por regla del corredor">
                      <label className="managerField"><span>Causa del out por regla</span>
                        <select disabled={disabled} value={runnerOut.detail?.reason ?? ''} onChange={event => {
                          const reason = runnerRuleOutOptions(state).find(reason => reason === event.currentTarget.value);
                          setRunnerOut({ ...(reason ? { detail: { reason } } : {}), note: '', confirmed: false });
                        }}>
                          <option value="">Selecciona la causa</option>
                          {runnerRuleOutOptions(state).map(reason => <option key={reason} value={reason}>{runnerRuleOutLabels[reason]}</option>)}
                        </select>
                      </label>
                      {runnerOut.detail ? <p>{runnerRuleOutHelp[runnerOut.detail.reason]}</p> : null}
                      {runnerOut.detail && ['missedBase', 'missedRetouch'].includes(runnerOut.detail.reason) ? <div className="privateRunnerRuleOutBases" role="group" aria-label="Base apelada">
                        <strong>Base apelada</strong>
                        {([1, 2, 3, 4] as const).filter(destination => runnerOut.detail?.reason !== 'missedRetouch' || destination < 4).map(destination =>
                          <button key={destination} type="button" className={runnerOut.detail?.appealBase === destination ? 'managerButtonSolid' : 'managerButtonOutline'} disabled={disabled}
                            aria-pressed={runnerOut.detail?.appealBase === destination} onClick={() => setRunnerOut(previous => ({
                              ...previous, confirmed: false, detail: previous.detail ? { ...previous.detail, appealBase: destination } : undefined
                            }))}>{destination === 4 ? 'Home' : `${destination}.ª base`}</button>)}
                      </div> : null}
                      {runnerOut.detail?.reason === 'other' ? <label className="managerField"><span>Motivo del out por regla</span>
                        <textarea disabled={disabled} value={runnerOut.note} maxLength={500}
                          onChange={event => setRunnerOut(previous => ({ ...previous, note: event.target.value }))} />
                      </label> : null}
                      <p>Registra solo el out de este corredor. Anota por separado el resultado del bateador y los avances que correspondan. Si hubo una anulación, corrige esas jugadas antes de confirmar.</p>
                      <label className="privateRunnerRuleOutConfirmation"><input type="checkbox" disabled={disabled || !runnerOut.detail} checked={runnerOut.confirmed}
                        onChange={event => setRunnerOut(previous => ({ ...previous, confirmed: event.target.checked }))} />
                        El árbitro declaró out a este corredor
                      </label>
                      <button type="button" className="managerButtonSolid"
                        disabled={disabled || !runnerOut.confirmed || Boolean(runnerRuleOutIssue(state, runnerOut.detail, runnerOut.note))}
                        onClick={() => { void annotate({ kind: 'runner', action: 'ruleOut', from: base, to: 0,
                          ruleOut: runnerOut.detail, ...(runnerOut.note.trim() ? { note: runnerOut.note.trim() } : {}) }); }}>Confirmar out por regla</button>
                      <button type="button" className="managerButtonOutline" disabled={disabled} onClick={() => setBaseDetail(null)}>Cancelar out por regla</button>
                    </div> : null}
                    {action === 'advance' && baseDetail === 'advance' ? <div id={`private-base-advance-${base}`}
                      className="privateBaseMenu privateAdvanceDestinations" role="group" aria-label="Destino del avance" data-advance-cause={advanceCause || undefined}>
                      <label className="managerField"><span>Causa del avance</span>
                        <select value={advanceCause} disabled={disabled} onChange={(event) => {
                          setAdvanceCause(event.target.value); setErrorOuts('');
                        }}>
                          <option value="">Selecciona la causa</option>
                          <option value="advance">Jugada sin error</option>
                          <option value="error">Error defensivo</option>
                          <option value="obstruction">Avance por obstrucción defensiva</option>
                          <option value="passed" disabled={state.seed.scoringRules === 'softball-slowpitch'}>Bola pasada</option>
                          <option value="wild" disabled={state.seed.scoringRules === 'softball-slowpitch'}>Lanzamiento descontrolado</option>
                          <option value="balk" disabled={state.seed.scoringRules === 'softball-slowpitch'}>Movimiento ilegal del lanzador</option>
                        </select>
                      </label>
                      {advanceCause === 'error' ? <ErrorOutsField value={errorOuts} onChange={setErrorOuts} disabled={disabled} runnerOnly /> : null}
                      {advanceCause === 'obstruction' ? <>
                        <p><strong>{runnerLabels.obstruction}.</strong> Selecciona la base concedida por el árbitro. Solo se mueve este corredor y se identifica al defensor responsable.</p>
                        <ErrorOutsField value={errorOuts} onChange={setErrorOuts} disabled={disabled} runnerOnly required={false} />
                      </> : null}
                      <strong>Destino del corredor</strong>
                      {([2, 3, 4] as const).map((destination) => <button type="button" className="managerButtonOutline" key={destination}
                        disabled={disabled || !id || !advanceCause || advanceCause === 'error' && !errorOuts ||
                          destination <= base || (destination < 4 && Boolean(state.bases[destination - 1]))}
                        onClick={() => {
                          if (advanceCause === 'advance') void annotate({ kind: 'runner', action: 'advance', cleanAdvance: true, from: base, to: destination });
                          else if (advanceCause === 'error') void annotate({ kind: 'runner', action: 'error', errorOuts: Number(errorOuts), from: base, to: destination });
                          else if (advanceCause === 'obstruction') void annotate({ kind: 'runner', action: 'obstruction',
                            ...(errorOuts ? { errorOuts: Number(errorOuts) } : {}), from: base, to: destination });
                          else if (advanceCause === 'passed' || advanceCause === 'wild' || advanceCause === 'balk') {
                            void annotate({ kind: 'runner', action: advanceCause, from: base, to: destination });
                          }
                        }}
                      >{destination === 4 ? 'Anotar carrera' : `Avanzar a ${destination}.ª base`}</button>)}
                    </div> : null}
                  </Fragment>
                ))}
                <button type="button" className="managerButtonOutline privateUndoButton" disabled={undoDisabled}
                  onClick={undo}>Deshacer última anotación</button>
                {baseDetail === 'advanceOut' ? <div className="privateBaseMenu" role="group" aria-label="Lugar del out al avanzar">
                  <strong>¿Dónde intentaba llegar?</strong>
                  {([2, 3, 4] as const).map((destination) => <button type="button" className="managerButtonOutline" key={destination}
                    disabled={disabled || !id || destination <= base}
                    onClick={() => annotate({ kind: 'runner', action: 'advanceOut', from: base, to: 0, attemptedBase: destination })}
                  >{destination === 4 ? 'Out en home' : `Out en ${destination}.ª base`}</button>)}
                </div> : null}
                {baseDetail === 'courtesy' ? <div className="privateBaseMenu">
                  <p>{sourceRule === 'BENCH' ? 'Corredor temporal fuera de la alineación.' : 'Corredor temporal de la plantilla.'} Solo reemplaza al lanzador o receptor.</p>
                  <label className="managerField"><span>Corredor temporal para {base}.ª base</span>
                    <select value={incoming} disabled={disabled} onChange={(event) => setIncoming(event.target.value)}>
                      <option value="">Selecciona un jugador</option>
                      {courtesyPlayers.map((player) => <option key={player.id} value={player.id}>{player.name}{!props.friendly ? ` · Camiseta ${player.jersey}` : ''}</option>)}
                    </select>
                  </label>
                  <button type="button" className="managerButtonOutline" disabled={disabled || !id || !incoming || !canUseCourtesy}
                    onClick={() => consultRunnerRule(true, base)}>Registrar corredor temporal</button>
                </div> : null}
              </div> : null}
            </li>;
          })}
          {!readOnly ? <li>
            <button type="button" className="privateBaseButton" aria-label="Home"
              disabled={writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy}
              aria-expanded={activeBase === 4} aria-controls="private-home-menu"
              onClick={() => {
                setActiveBase(activeBase === 4 ? null : 4);
                setBaseDetail(null);
                setHomeOutFrom('');
              }}>
              <strong>Home {activeBase === 4 ? '−' : '+'}</strong>
              <span>Eliminado al intentar anotar</span>
            </button>
            {activeBase === 4 ? <div id="private-home-menu" className="privateBaseMenu" role="group" aria-label="Jugadas en home">
              <button type="button" className="managerButtonOutline"
                disabled={writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy || !state.bases.some(Boolean)}
                onClick={() => setBaseDetail('advanceOut')}>Out al avanzar</button>
              <button type="button" className="managerButtonOutline privateUndoButton" disabled={undoDisabled}
                onClick={undo}>Deshacer última anotación</button>
              {!state.bases.some(Boolean) ? <p>No hay corredores en base para registrar este out.</p> : null}
              {baseDetail === 'advanceOut' ? <>
                <label className="managerField"><span>Corredor eliminado al intentar llegar a home</span>
                  <select value={homeOutFrom} disabled={writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy}
                    onChange={(event) => setHomeOutFrom(event.target.value)}>
                    <option value="">Selecciona el corredor</option>
                    {state.bases.map((id, index) => id ? <option key={id} value={index + 1}>
                      {playerName(state, id)} · Desde {index + 1}.ª base
                    </option> : null)}
                  </select>
                </label>
                <button type="button" className="managerButtonOutline"
                  disabled={writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy || !homeOutFrom || !state.bases[Number(homeOutFrom) - 1]}
                  onClick={() => annotate({ kind: 'runner', action: 'advanceOut', from: Number(homeOutFrom), to: 0, attemptedBase: 4 })}
                >Registrar out en home</button>
              </> : null}
            </div> : null}
          </li> : null}
        </ol>;
  return (
    <>
      {header}
      {participantLinks}
      {props.matchChat}
      {playerSelection ? <ScorecardPlayerActions key={`${props.gameId}:${playerSelection.side}:${playerSelection.id}`}
        state={state} selected={playerSelection} positionLabels={props.positionLabels}
        canManage={mayChangePlayer(playerSelection.side)}
        pendingApproval={Boolean(props.official?.onPersonnelRequest) || !props.official && !props.example}
        presentIds={selectedPresent}
        disabled={Boolean(props.official?.busy) || persisting || delivery.busy || playerChanging || Boolean(pendingRoute)}
        onClose={() => setPlayerSelection(null)}
        onMode={mode => setPlayerSelection(previous => previous ? { ...previous, mode } : null)}
        onCommand={changePlayer}
        {...(props.official?.onFriendlyArrival ? { onFriendlyArrival: async (name: string) => {
          if (playerSending.current) return false;
          playerSending.current = true; setPlayerChanging(true);
          try {
            if (!sessionRef.current || defensivePlayContext(sessionRef.current.state) !== playerSelection.context)
              throw new Error('La hoja cambió. Vuelve a seleccionar al jugador.');
            const arrival = props.official?.onFriendlyArrival;
            if (!arrival) throw new Error('No se pueden incorporar participantes en esta hoja.');
            await arrival(playerSelection.side, playerSelection.id, name);
            setPlayerSelection(null); setNotice('Participante incorporado a reserva y sustitución del amistoso guardada.');
            return true;
          } catch (failure) { setError(errorText(failure)); throw failure; }
          finally { playerSending.current = false; setPlayerChanging(false); }
        } } : {})}
      /> : null}
      {lineupOpen ? <article className="managerCard managerStepCard">
        <p>{props.friendly ? 'El orden al bate corresponde al ingresado al crear el amistoso. Los cambios defensivos no lo modifican.' : battingOrderRule}</p>
        {lineupSides.map((side, index) => {
          const displayedLineup = [...state.lineups[side]].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
          return <section key={side} aria-label={props.official || props.observation ? `Alineación vigente de ${state.seed.names[side]}` : 'Mi alineación vigente'}>
          <header className="privateSheetHeader">
            <h2 ref={index === 0 ? lineupHeading : undefined} tabIndex={-1}>{props.official || props.observation ? 'Alineación vigente' : 'Mi Alineación'} · <InstitutionName example={props.friendly || Boolean(props.example || props.observation)} id={props.friendly ? undefined : side === 'home' ? props.homeId : props.awayId}>{state.seed.names[side]}</InstitutionName></h2>
            {index === 0 ? <button type="button" className="managerButtonOutline" onClick={() => setLineupOpen(false)}>Volver al juego</button> : null}
          </header>
          {displayedLineup.length ? <ol className="lineupPreviewList">
            {displayedLineup.map((player) => <li className={`lineupPreviewPlayer${props.friendly ? ' friendlyLineupPlayer' : ''}`} key={player.id}>
              <span className="lineupPreviewOrder">{player.order ?? '—'}</span>
              {!props.friendly ? <span className="lineupPreviewNumber" aria-label={player.jersey ? `Camiseta ${player.jersey}` : 'Camiseta sin registrar'}>{player.jersey ? `#${player.jersey}` : '—'}</span> : null}
              <button type="button" className="lineupPreviewName scorecardPlayerTrigger" title={player.name}
                aria-label={`Opciones de ${player.name}`} disabled={playerChanging} onClick={() => touchPlayer(side, player)}>{player.name}</button>
              <span className="lineupPreviewPosition" title={props.positionLabels[player.position]}>{player.position}</span>
            </li>)}
          </ol> : <p>Alineación no recibida. No se inventan jugadores ni posiciones.</p>}
        </section>;
        })}
        {statusMessages}
      </article> : null}
      {!lineupOpen ? <>
      <article className="managerCard managerStepCard" aria-label="Pizarra por entradas y corredores en base">
        <div className="privateSummaryHeader">
          <div>
            <h2 className="privateLiveScoringTitle">PIZARRA RESUMEN</h2>
            <div className="privateLineScoreStatus" role="group" aria-label="Entrada actual y estado del partido" aria-live="polite" aria-atomic="true">
              <strong>{state.inning}.ª entrada · {state.side === 'away' ? 'Parte alta' : 'Parte baja'}</strong>
              {state.finished ? <><strong>{props.official ? 'Partido finalizado' : 'Seguimiento cerrado'}</strong>
                {reportAvailable ? <button type="button" className="managerButtonOutline" onClick={() => setShowReport(true)}>Ver resumen final</button> : null}</> : null}
            </div>
          </div>
          <div className="privateScoreboardCounters">
          <dl className="privateGameCount" aria-label="Conteo actual" aria-live="polite" aria-atomic="true">
            <div data-count="balls"><dt>Bolas</dt><dd>{state.balls}</dd></div>
            <div data-count="strikes"><dt>Strikes</dt><dd>{state.strikes}</dd></div>
            <div data-count="outs"><dt>Outs</dt><dd>{state.outs}</dd></div>
          </dl>
          <GameClockDisplay clock={state.clock} finished={state.finished} disabled={writeBlocked || ruleBusy || delivery.busy}
            offsetMs={props.official?.clockOffsetMs} privateClock={!props.official && !props.observation}
            onAction={!readOnly && (!props.official || props.official.onClock) ? changeClock : undefined} />
          </div>
          <svg className="privateBaseDiamond" viewBox="0 0 100 82" role="img" aria-live="polite" aria-atomic="true">
            <title>Diamante de bases: {state.bases.map((id, index) =>
              `${index + 1}.ª base ${id ? `ocupada por ${playerName(state, id)}` : 'vacía'}`
            ).join('; ')}</title>
            <path d="M50 75 L4 29 Q50 -12 96 29 Z" fill="#d8eee0" />
            <path d="M50 69 L24 46 L50 23 L76 46 Z" fill="#dec6a0" stroke="#fff" strokeWidth="1.5" />
            <path d="M6 27 L50 69 L94 27" fill="none" stroke="#fff" strokeWidth="1.5" />
            <circle cx="50" cy="48" r="4" fill="#f3e5cd" />
            {state.bases.map((id, index) => {
              const [x, y] = [[76, 46], [50, 23], [24, 46]][index];
              return <g key={index} className="privateDiamondBase" data-base={index + 1}
                data-occupied={Boolean(id)} transform={`translate(${x} ${y})`}>
                <rect x="-5" y="-5" width="10" height="10" rx="1" transform="rotate(45)" />
                {id ? <g className="privateDiamondRunner">
                  <circle cy="-13" r="2.5" />
                  <path d="M-4 -5 V-7 A4 4 0 0 1 4 -7 V-5 Z" />
                </g> : null}
                <text x={index === 2 ? -13 : 13} y="4" textAnchor="middle">{index + 1}</text>
              </g>;
            })}
            <path d="M46 66 H54 V71 L50 75 L46 71 Z" fill="#fff" stroke="#58706b" strokeWidth="1" />
          </svg>
        </div>
        <div className="privateLineScoreScroll">
          <table className="privateLineScore" aria-label="Pizarra por entradas" aria-live="polite">
            <thead><tr>
              <th scope="col">Equipo</th>
              {innings.map((inning) => <th scope="col" key={inning}>{inning}</th>)}
              <th scope="col">Total</th>
              <th scope="col" aria-label="Errores defensivos"><abbr title="Errores defensivos del equipo">E</abbr></th>
            </tr></thead>
            <tbody>{(['away', 'home'] as Side[]).map((side) => <tr key={side}
              aria-current={side === state.side ? 'true' : undefined}>
              <th scope="row">
                <span><InstitutionName example={props.friendly || Boolean(props.example || props.observation)} id={props.friendly ? undefined : side === 'home' ? props.homeId : props.awayId}>{state.seed.names[side]}</InstitutionName></span>
                <small>{side === 'away' ? 'Alta · Visitante' : 'Baja · Local'}{side === state.side ? ' · Al bate' : ''}</small>
              </th>
              {innings.map((inning) => {
                const runs = privateInningRuns(state, side, inning);
                return <td key={inning} className={side === state.side && inning === state.inning ? 'privateLineScoreCurrent' : undefined}>
                  {runs === null ? <span aria-label="Sin jugar">—</span> : runs}
                </td>;
              })}
              <td>{state.scores[side]}</td>
              <td data-fielding-team={side}>{privateFieldingStats(state, side).errors ?? '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {baseControls}
      </article>
      <article className="managerCard managerStepCard">
        <header className="privateSheetHeader">
          <h2 ref={heading} tabIndex={-1}>{props.friendly ? `AMISTOSO${readOnly ? ' · SOLO LECTURA' : ' · ANOTACIÓN'}` : props.observation ? 'PARTIDO EN VIVO · SOLO LECTURA' : readOnly ? 'PARTIDO OFICIAL EN VIVO' : 'ANOTACION DE JUGADAS EN VIVO'}</h2>
        </header>
        {readOnly ? <p><strong>Pitcher actual: </strong>
          {state.lineups[state.side === 'away' ? 'home' : 'away'].find(player => player.position === 'P')?.name ?? 'Sin pitcher identificado'}
        </p> : null}
        {(['home', 'away'] as Side[]).filter((side) => state.seed.lineups[side].length === 0).map((side) => (
          <p key={side} className="managerWarning"><InstitutionName example={props.friendly || Boolean(props.example || props.observation)} id={props.friendly ? undefined : side === 'home' ? props.homeId : props.awayId}>{state.seed.names[side]}</InstitutionName>: alineación no recibida al abrir la planilla. Los turnos rivales quedan sin identificar; no se inventan nombres ni posiciones.</p>
        ))}
        {statusMessages}
        {pendingRoute && !readOnly ? <section ref={routePanel} tabIndex={-1} data-runner-route className="managerCard">
          <h3>{runnerLabels[pendingRoute.command.action]} · Recorrido defensivo</h3>
          <p>Corredor en {pendingRoute.command.from}.ª · {routeRunner ? playerName(state, routeRunner) : 'Corredor ya no disponible'}</p>
          {pendingRoute.context !== defensivePlayContext(state) ? <p role="alert">El partido cambió. Cancela este recorrido y revisa la pizarra.</p> : null}
          <fieldset className="privateMultipleOut" disabled={writeBlocked || pendingRoute.context !== defensivePlayContext(state)}>
            <legend>Vía de la jugada</legend>
            <DefensiveRouteFields state={state} sequence={pendingRoute.sequence}
              onChange={sequence => setPendingRoute(current => current ? { ...current, sequence } : null)} />
            <button type="button" className="managerButtonSolid" disabled={!pendingRoute.sequence.length || writeBlocked}
              onClick={async () => {
                if (routeSending.current) return;
                const current = sessionRef.current;
                if (!current || pendingRoute.context !== defensivePlayContext(current.state)) {
                  setError('El partido cambió. Cancela este recorrido y revisa la pizarra.'); return;
                }
                if (!pendingRoute.sequence.length) { setError('Completa la vía defensiva antes de confirmar.'); return; }
                routeSending.current = true;
                try {
                  if (await annotate({ ...pendingRoute.command, fieldingSequence: pendingRoute.sequence })) setPendingRoute(null);
                } finally { routeSending.current = false; }
              }}>Confirmar out del corredor</button>
          </fieldset>
          <button type="button" className="managerButtonOutline" disabled={writeBlocked} onClick={() => setPendingRoute(null)}>Cancelar recorrido</button>
        </section> : null}
        {!readOnly ? <PredeterminedPlays
          key={`${props.tournamentId}:${props.gameId}`} state={state}
          disabled={writeBlocked || Boolean(pendingRoute) || state.finished || ruleBusy || delivery.busy}
          undoDisabled={undoDisabled}
          blockingReason={state.finished ? 'El partido está cerrado; no se pueden registrar nuevas jugadas.' :
            props.official && (!state.lineups.home.length || !state.lineups.away.length) ?
              'Para habilitar las jugadas, ambos managers deben entregar sus lineups.' : undefined}
          onCommand={annotate} onUndo={undo}
        /> : null}
        {pendingError && !readOnly ? <DefensiveErrorConfirmation key={JSON.stringify(pendingError)}
          state={state} command={pendingError} onConfirm={annotate} onCancel={() => setPendingError(null)} /> : null}
        {battingQueuePanel}
        {readOnly ? <p role="status">{props.friendly ? 'Amistoso finalizado · Solo consulta. No modifica estadísticas oficiales.' : props.observation ? 'Consulta del juego seleccionado · Solo lectura.' :
          'Consulta en vivo del registro oficial. El anotador u organizador registra las jugadas y los cambios comunicados en el campo.'}</p> : <fieldset className="officialScoringControls" disabled={writeBlocked}>
        {lastCommand?.kind === 'play' && lastCommand.result === 'error' && !lastCommand.sharedRequestId ?
          <details className="privateBaseMenu">
            <summary>Detalle opcional del error registrado</summary>
            <p>La jugada ya está guardada. Completa los outs evitados para calcular CL y CS sin suposiciones.</p>
            <ErrorOutsField value={lastCommand.errorOuts === undefined ? '' : String(lastCommand.errorOuts)}
              onChange={configureLastErrorOuts} disabled={state.finished || ruleBusy || delivery.busy} required={false} />
          </details> : null}
        <details>
          <summary>Error en foul que prolonga el turno</summary>
          <p>Úsalo solo cuando una atrapada de foul debió producir un out. Conserva el bateador y la cuenta; registra el out evitado para reconstruir las carreras.</p>
          <button type="button" className="managerButtonOutline" disabled={state.finished || ruleBusy}
            onClick={() => annotate({ kind: 'misplay', errorOuts: 1 })}>Registrar error en foul sin terminar turno</button>
        </details>
        {finishSuggestion && finishSuggestionKey !== dismissedFinish ? <section className="managerWarning privateFinishPrompt"
          aria-label={props.friendly ? 'Confirmación del final del amistoso' : props.official ? 'Confirmación del final oficial' : 'Confirmación de cierre del seguimiento privado'}>
          <div role="status">
            <strong>Posible final del partido</strong>
            <p>{{
              homeAheadAfterTop: `Terminó la parte alta de la ${finishSuggestion.inning}.ª entrada con el local arriba.`,
              walkOff: `El local anotó la carrera de la ventaja en la baja de la ${finishSuggestion.inning}.ª entrada.`,
              completedInning: `Terminó la ${finishSuggestion.inning}.ª entrada con un equipo en ventaja.`
            }[finishSuggestion.reason]} El marcador favorece a <InstitutionName example={props.friendly || Boolean(props.example || props.observation)} id={props.friendly ? undefined : finishSuggestion.winner === 'home' ? props.homeId : props.awayId}>{state.seed.names[finishSuggestion.winner]}</InstitutionName>.
              Revisa las jugadas antes de confirmar. {props.friendly ? 'Solo se cierra este amistoso privado, sin afectar torneos.' : props.official ? 'El cierre publica el final oficial del partido.' : 'Este cierre no afecta el partido oficial.'}</p>
          </div>
          <div className="managerButtonRow">
            <button type="button" className="managerButtonSolid" disabled={ruleBusy}
              onClick={requestFinish}>{props.official ? 'Confirmar final del partido' : 'Confirmar cierre privado'}</button>
            <button type="button" className="managerButtonOutline"
              onClick={() => setDismissedFinish(finishSuggestionKey)}>Seguir anotando</button>
          </div>
        </section> : null}
        <p>Las jugadas con opciones se guardan al confirmar. En las jugadas directas solo avanzan los corredores obligados por la llegada del bateador. Revisa los destinos o marca los avances adicionales y su causa desde las bases. Puedes deshacer la última anotación.</p>
        <div className="managerButtonRow">
          <button type="button" className="managerButtonOutline" disabled={ruleBusy} onClick={props.onBack}>Volver al partido sin borrar anotaciones</button>
          {!props.friendly ? <label className="managerField privateGameLength">
            <span>Duración:</span>
            <select aria-label={props.official ? 'Entradas reglamentarias del partido' : 'Entradas reglamentarias del seguimiento privado'}
              title={props.official ? 'Duración del partido oficial.' : 'Solo se aplica a la detección del final de este seguimiento, no cambia las reglas oficiales.'}
              value={scorecardRegulationInnings(state.seed) ?? ''} disabled={state.finished || ruleBusy || delivery.busy}
              onChange={(event) => configureRegulationInnings(event.target.value)}>
              <option value="" disabled={Boolean(props.official)}>Sin definir</option>
              <option value="7">Softbol · 7 entradas</option>
              <option value="9">Béisbol · 9 entradas</option>
            </select>
          </label> : <span>Duración del amistoso: {state.seed.regulationInnings} entradas</span>}
          <button type="button" className="managerButtonOutline" disabled={state.finished || ruleBusy || finishReview} onClick={requestFinish}>{props.friendly ? 'Finalizar amistoso' : props.official ? 'Finalizar partido oficial' : 'Cerrar seguimiento privado'}</button>
        </div>
        </fieldset>}
      </article>

      {detailedStatistics || !readOnly ? <RunAccountingPanel runs={state.runAccounting.runs} name={(id) => playerName(state, id)} detailed={detailedStatistics}
        draftKey={draftScope ?? undefined}
        readOnly={readOnly} disabled={writeBlocked || state.finished || ruleBusy || delivery.busy}
        onReview={(review) => { void annotate({ kind: 'run-review', review }); }} /> : null}

      {finishReview && !readOnly && !state.finished ? <GameFinalReviewForm state={state}
        detailed={Boolean(props.example || detailedStatistics && (activeRole === 'scorekeeper' ?
          hasAccountFeature(account, 'scorekeeper-box-score') : hasAccountFeature(account, 'final-report-details')))} disabled={writeBlocked || ruleBusy || delivery.busy}
        onCancel={() => setFinishReview(false)} onConfirm={async review => {
          const saved = await annotate({ kind: 'finish', review });
          if (saved) { setFinishReview(false); setShowReport(true); }
          return saved;
        }} /> : null}

      {!props.example && !props.official && !props.observation ? <DemoJerseyAssignments assignedPlayers={[
        ...state.seed.rosters.home, ...state.seed.rosters.away, ...state.lineups.home, ...state.lineups.away
      ]} /> : null}

      {(['away', 'home'] as Side[]).map((side) => (
        <article className="scorecardPreview" key={side}>
          <header className="scorecardPreviewHeader"><div><p className="lineupPreviewEyebrow">{props.friendly ? 'PLANILLA DEL AMISTOSO · PRIVADA · NO OFICIAL' : props.observation ? 'HOJA DEL JUEGO SELECCIONADO · SOLO LECTURA' : props.official ? 'PLANILLA OFICIAL · ACTUALIZADA EN VIVO' : 'PLANILLA PRIVADA · DATOS DE ESTE SEGUIMIENTO'}</p><h2><InstitutionName example={props.friendly || Boolean(props.example || props.observation)} id={props.friendly ? undefined : side === 'home' ? props.homeId : props.awayId}>{state.seed.names[side]}</InstitutionName></h2><p>Mantén pulsada una actuación para ver el detalle; al soltar o retirar el dedo se oculta. Con teclado, mantén Espacio o Enter.</p></div></header>
          <div className="scorecardTableScroll"><table className="scorecardTable privateScorecardTable">
            <thead><tr><th scope="col" className="scorecardPlayerHeading">Jugador y turno</th>
              {detailedStatistics ? <th scope="col" aria-label="Errores defensivos"><abbr title="Errores defensivos cometidos por el jugador">E</abbr></th> : null}
              {innings.map((inning) => <th scope="col" key={inning}>Entrada {inning}</th>)}
              {detailedStatistics ? ['Apariciones', 'Turnos oficiales al bate', 'Imparables', 'Promedio de bateo', 'Jonrones', 'Bases por bolas', 'Ponches', 'Carreras', 'Impulsadas', 'Robos'].map((label) => <th scope="col" key={label}>{label}</th>) : null}
            </tr></thead>
            <tbody>{sheetPlayers(side).map((p) => {
              const stats = privateStats(state, side, p.id);
              const active = state.lineups[side].some((player) => player.id === p.id);
              return <tr key={p.id} aria-current={side === state.side && p.id === batter ? 'true' : undefined}>
                <th scope="row" className="scorecardPlayer"><button type="button" className="scorecardPlayerInfo scorecardPlayerTrigger"
                  aria-label={`Opciones de ${p.name}`} disabled={playerChanging || p.id.startsWith('unknown:')} onClick={() => touchPlayer(side, p)}>
                  <strong>{p.order ?? 'Sin turno'} · {p.name}{!active && !p.id.startsWith('unknown:') ? ' · fuera de la alineación' : ''}</strong><small>{p.jersey ? `#${p.jersey} · ` : ''}{props.positionLabels[p.position]}{side === state.side && p.id === batter ? ' · AL BATE' : ''}</small></button></th>
                {detailedStatistics ? <td data-fielding-player={p.id}>{privateFieldingStats(state, side, p.id).errors ?? '—'}</td> : null}
                {innings.map((inning) => <td className="privateInningCell" key={inning}>
                  <PrivateInningCell playerId={p.id} playerName={p.name} inning={inning}
                    entries={privateInningEntries(state.log, side, inning, p.id)} />
                </td>)}
                {detailedStatistics ? [stats.pa, stats.atBats, stats.hits, stats.average, stats.homeRuns, stats.walks, stats.strikeouts, stats.runs, stats.rbis, stats.steals].map((value, index) => <td key={index}>{value}</td>) : null}
              </tr>;
            })}</tbody>
          </table></div>
          {!sheetPlayers(side).length ? <p className="scorecardPreviewNote">Sin turnos registrados ni alineación recibida.</p> : null}
          {detailedStatistics ? <DefensiveErrorsSheet state={state} side={side} /> : null}
        </article>
      ))}

      </> : null}
      {lineupOpen && !readOnly ? <details className="managerCard managerStepCard">
        <summary>Ajustes avanzados de posiciones</summary>
        <h2>{props.friendly ? 'Sustituciones y posiciones del equipo seleccionado' : 'Cambios de mi equipo'}</h2>
        <fieldset className="privateControls" disabled={writeBlocked || state.finished || ruleBusy || delivery.busy}>
          <legend>{props.friendly ? 'Cambios del amistoso: no modifican el orden al bate' : props.official ? 'Registro oficial de los cambios comunicados en el campo' : props.example ? 'Cambios de práctica; solo se aplican a este ejemplo' : 'Solicitudes compartidas de cambios; se aplican solo después de confirmarse'}</legend>
              <p>{props.friendly ? 'La posición defensiva es opcional. Cambiarla no altera el orden al bate. Se ofrecen las posiciones libres y la del participante seleccionado.' : <>{battingOrderRule} Solo se ofrecen posiciones libres y la del jugador seleccionado. Para cambiar dos jugadores de puesto, usa el intercambio de posiciones. Este seguimiento no certifica la legalidad de reingresos ni de cambios entre bateador asignado y jugador flexible.</>}</p>
              <p>Un suplente entra por el 4.º bate y conserva ese turno. Si después intercambia su posición defensiva con el 7.º bate, siguen bateando cuarto y séptimo.</p>
              {deliveredSheet && !props.friendly && !props.example ? <p>La entrega fija la cantidad de titulares y defensores. Una sustitución no agrega turnos ni aumenta o reduce la defensa.</p> : null}
              <label className="managerField"><span>Jugador que sale o cambia de posición</span><select value={outgoing} onChange={(e) => {
                setOutgoing(e.target.value);
                setSwapTarget('');
                const player = ownLineup.find((p) => p.id === e.target.value);
                if (player) setPosition(player.position);
              }}><option value="">Selecciona un jugador activo</option>{ownLineup.map((p) => <option key={p.id} value={p.id}>{p.order ?? 'Sin turno'} · {p.name}</option>)}</select></label>
              {outgoingPlayer ? <p role="status"><strong>Turno al bate fijo: {outgoingPlayer.order === null ? 'Sin turno de bateo' : `${outgoingPlayer.order}.º`}</strong>. El suplente hereda este lugar; un cambio defensivo no lo modifica.</p> : null}
              <label className="managerField"><span>Suplente de la banca o reserva</span><select value={incoming} onChange={(e) => setIncoming(e.target.value)}><option value="">Selecciona un sustituto</option>{available.map((p) => <option key={p.id} value={p.id}>{props.friendly ? p.name : <>{p.name} · {p.id}{p.jersey || getDemoJerseyNumber(p.id) ? ` · Camiseta ${p.jersey || getDemoJerseyNumber(p.id)}` : ''}</>}</option>)}</select></label>
              {!available.length ? <p>No hay suplentes fuera de la alineación en la plantilla actual.</p> : null}
              <label className="managerField"><span>Nueva posición defensiva</span><select value={position} disabled={!outgoing} onChange={(e) => setPosition(e.target.value)}>{availablePositions.map((key) => <option key={key} value={key}>{props.positionLabels[key]}</option>)}</select></label>
              {!props.friendly ? <label className="managerField"><span>Camiseta del sustituto (0–99)</span><input value={jersey} inputMode="numeric" onChange={(e) => setJersey(e.target.value)} /></label> : null}
              <div className="managerButtonRow">
                <button type="button" className="managerButtonSolid" disabled={!outgoing || !incoming} onClick={() => annotate({ kind: 'substitution', side: props.ownSide, outId: outgoing, inId: incoming, position, jersey: props.friendly ? '' : jersey })}>{props.friendly ? 'Registrar sustitución del amistoso' : props.official ? 'Registrar sustitución oficial' : props.example ? 'Aplicar sustitución de práctica' : 'Comunicar sustitución para confirmación'}</button>
                <button type="button" className="managerButtonOutline" disabled={!outgoing} onClick={() => annotate({ kind: 'position', side: props.ownSide, playerId: outgoing, position })}>{props.friendly ? 'Guardar posición' : props.official ? 'Registrar cambio defensivo oficial' : props.example ? 'Aplicar cambio defensivo de práctica' : 'Comunicar cambio defensivo para confirmación'}</button>
              </div>
              <h3>Intercambiar posiciones defensivas sin cambiar turnos al bate</h3>
              <label className="managerField"><span>Intercambiar posición con</span><select value={swapTarget} disabled={!outgoing} onChange={(e) => setSwapTarget(e.target.value)}>
                <option value="">Selecciona el otro jugador</option>
                {ownLineup.filter((player) => player.id !== outgoing && !['DH', 'NA'].includes(player.position)).map((player) => <option key={player.id} value={player.id}>{player.order === null ? 'Sin turno' : `${player.order}.º`} · {player.name} · {props.positionLabels[player.position]}</option>)}
              </select></label>
              <button type="button" className="managerButtonOutline" disabled={!outgoing || !swapTarget} onClick={() => {
                const target = ownLineup.find((player) => player.id === swapTarget && player.id !== outgoing);
                if (!target) { setError('Selecciona otro jugador activo para intercambiar posiciones.'); return; }
                void annotate({ kind: 'position', side: props.ownSide, playerId: outgoing, position: target.position });
              }}>{props.friendly ? 'Intercambiar posiciones' : props.official ? 'Registrar intercambio oficial' : props.example ? 'Aplicar intercambio de práctica' : 'Comunicar intercambio de posiciones para confirmación'}</button>
        </fieldset>
      </details> : null}
      {lineupOpen && !props.example && !props.official && !props.observation ? <TeamSheetPanel connection={delivery}
        names={{ [props.homeId]: props.homeName, [props.awayId]: props.awayName }} positionLabels={props.positionLabels}
        roster={state.seed.rosters[props.ownSide].map((p) => ({ identificationNumber: p.id, displayName: p.name, jerseyNumber: p.jersey }))} /> : null}
    </>
  );
}
