'use client';

import { type ComponentRef, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { availableLineupPositions } from '@playsport/shared';
import type { PersonnelAction, TeamSheetPlayer } from '@playsport/shared';
import { fillDemoScorecardJerseys, getDemoJerseyNumber } from './demo-players';
import DemoJerseyAssignments from './demo-jersey-assignments';
import PrivateInningCell from './private-inning-cell';
import LiveScoringHeader from './live-scoring-header';
import RunAccountingPanel, { ErrorOutsField } from './run-accounting-panel';
import { personnelDescription, readTeamSheets, TeamSheetPanel, useTeamSheets } from './team-sheets';
import {
  applyPrivateCommand, createPrivateState, currentBatter, playerName, playLabels, privateFinishSuggestion, privateInningRuns, privateStats,
  minimumDestinations, readPrivateSave, replayPrivate, runnerLabels, setLastPrivateErrorOuts, undoPrivateCommand,
  type Destination, type PlayResult, type PrivateCommand, type PrivatePlayer, type PrivateSeed,
  type PrivateState, type Side
} from './private-scorecard';

export type OfficialScorecardControls = {
  session: Session;
  readOnly: boolean;
  busy: boolean;
  canUndo: boolean;
  connection: ReturnType<typeof useTeamSheets>;
  onCommand: (_command: PrivateCommand) => Promise<void>; // eslint-disable-line no-unused-vars
  onUndo: () => Promise<void>;
  onDuration: (_innings: 7 | 9) => Promise<void>; // eslint-disable-line no-unused-vars
  onErrorOuts: (_outs: number | null) => Promise<void>; // eslint-disable-line no-unused-vars
};
type Props = {
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
  example?: { seed: PrivateSeed; commands: PrivateCommand[] };
  official?: OfficialScorecardControls;
  onBack: () => void;
};
export type Session = { seed: PrivateSeed; commands: PrivateCommand[]; state: PrivateState };
const manualPlayResults: PlayResult[] = [
  'single', 'double', 'triple', 'homeRun', 'hitByPitch', 'error',
  'battedOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt'
];
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
  const initial = useRef(props);
  const heading = useRef<ComponentRef<'h2'>>(null);
  const lineupHeading = useRef<ComponentRef<'h2'>>(null);
  const [localSession, setSession] = useState<Session | null>(null);
  const session = props.official?.session ?? localSession;
  const sessionRef = useRef<Session | null>(null);
  if (props.official) sessionRef.current = props.official.session;
  const savedRaw = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dismissedFinish, setDismissedFinish] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [lineupOpen, setLineupOpen] = useState(false);
  const [activeBase, setActiveBase] = useState<number | null>(null);
  const [baseDetail, setBaseDetail] = useState<'advance' | 'advanceOut' | 'courtesy' | null>(null);
  const [advanceCause, setAdvanceCause] = useState('');
  const [errorOuts, setErrorOuts] = useState('');
  const [homeOutFrom, setHomeOutFrom] = useState('');
  const [incoming, setIncoming] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [swapTarget, setSwapTarget] = useState('');
  const [position, setPosition] = useState('P');
  const [jersey, setJersey] = useState('');
  const [runnerRule, setRunnerRule] = useState<'BENCH' | 'ROSTER' | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const ownPlayers = session?.state.lineups[props.ownSide];
  const availablePositions = useMemo(() => availableLineupPositions(
    (ownPlayers ?? []).map((player) => ({ identificationNumber: player.id, fieldPosition: player.position })),
    outgoing
  ), [ownPlayers, outgoing]);
  const teamId = props.ownSide === 'home' ? props.homeId : props.awayId;
  const storageKey = privateStorageKey(props.tournamentId, props.gameId, teamId, props.managerId);
  const localDelivery = useTeamSheets({
    apiBase: props.apiBase, gameId: props.gameId, tournamentId: props.tournamentId, userId: props.managerId, role: 'manager',
    enabled: !props.example && !props.official
  });
  const delivery = props.official?.connection ?? localDelivery;
  const readOnly = props.official?.readOnly ?? false;
  const writeBlocked = readOnly || Boolean(props.official?.busy);
  const privatePlayer = (player: TeamSheetPlayer): PrivatePlayer => ({
    id: player.identificationNumber, name: player.displayName, order: player.battingOrder,
    position: player.fieldPosition, jersey: player.jerseyNumber ?? ''
  });

  useEffect(() => {
    setOutgoing(''); setIncoming(''); setSwapTarget(''); setActiveBase(null); setBaseDetail(null);
  }, [props.ownSide]);

  useEffect(() => {
    if (!availablePositions.includes(position)) setPosition(availablePositions[0] ?? '');
  }, [availablePositions, position]);

  useEffect(() => {
    const player = sessionRef.current?.seed.rosters[props.ownSide].find((entry) => entry.id === incoming);
    setJersey(player?.jersey || getDemoJerseyNumber(incoming));
  }, [incoming, props.ownSide]);

  useEffect(() => {
    if (lineupOpen) lineupHeading.current?.focus();
    else heading.current?.focus();
  }, [lineupOpen]);

  useEffect(() => {
    if (props.official) return;
    let active = true;
    const load = async () => {
      setError('');
      try {
        const raw = globalThis.localStorage.getItem(storageKey);
        const saved = raw !== null ? readPrivateSave(raw) : null;
        let seed: PrivateSeed;
        let commands: PrivateCommand[];
        if (saved && (initial.current.example || saved.commands.length > 0 || !initial.current.initialLineup.length)) {
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
        const state = replayPrivate(seed, commands);
        if (!active) return;
        const serialized = JSON.stringify({ version: 1, seed, commands });
        if (globalThis.localStorage.getItem(storageKey) !== raw) throw new Error('La planilla cambió en otra pestaña. Vuelve a abrirla para no sobrescribir anotaciones.');
        globalThis.localStorage.setItem(storageKey, serialized);
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
  }, [storageKey, attempt]);

  const save = (next: Session) => {
    if (props.official) throw new Error('Las anotaciones oficiales solo se guardan en el servicio del partido.');
    if (globalThis.localStorage.getItem(storageKey) !== savedRaw.current) throw new Error('Otra pestaña modificó esta planilla. Vuelve a abrirla antes de continuar.');
    const raw = JSON.stringify({ version: 1, seed: next.seed, commands: next.commands });
    globalThis.localStorage.setItem(storageKey, raw);
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
  const configureRegulationInnings = (value: string) => {
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
      save({ ...current, seed, state: replayPrivate(seed, current.commands) });
      setDismissedFinish(null);
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const configureLastErrorOuts = (value: string) => {
    if (props.official) {
      void props.official.onErrorOuts(value === '' ? null : Number(value)).catch((failure) => setError(errorText(failure)));
      return;
    }
    try {
      const current = sessionRef.current;
      if (!current) throw new Error('No se pudo leer el seguimiento privado.');
      if (!['', '0', '1', '2', '3'].includes(value)) throw new Error('Indica entre cero y tres outs evitados por el error.');
      save({ ...current, ...setLastPrivateErrorOuts(current.seed, current.commands, value === '' ? undefined : Number(value)) });
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  const annotate = async (command: PrivateCommand) => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      if (props.official) {
        if (readOnly) throw new Error('Este perfil solo puede consultar el partido oficial.');
        await props.official.onCommand(command);
        if (command.kind === 'substitution' || command.kind === 'position') {
          setOutgoing(''); setIncoming(''); setSwapTarget('');
        }
        setActiveBase(null); setBaseDetail(null); setError(''); setNotice('Anotación oficial guardada y compartida en vivo.');
        return;
      }
      // Explicit destinations preserve new advances without changing replay of older saved plays.
      const recordedCommand = command.kind === 'play' && command.destinations === undefined
        ? { ...command, destinations: minimumDestinations(current.state, command.result) }
        : command;
      let action: PersonnelAction | null = null;
      if (command.kind === 'substitution') action = {
        kind: 'substitution', outgoingIdentificationNumber: command.outId, incomingIdentificationNumber: command.inId,
        fieldPosition: command.position, jerseyNumber: command.jersey
      };
      if (command.kind === 'position') action = { kind: 'defense', identificationNumber: command.playerId, fieldPosition: command.position };
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
        return;
      }
      save({ ...current, commands: [...current.commands, recordedCommand], state: applyPrivateCommand(current.state, recordedCommand) });
    } catch (failure) {
      setError(errorText(failure));
      setNotice('');
    }
  };
  const undo = () => {
    if (props.official) {
      void props.official.onUndo().then(() => { setError(''); setDismissedFinish(null); setNotice('Última anotación oficial deshecha.'); })
        .catch((failure) => setError(errorText(failure)));
      return;
    }
    const current = sessionRef.current;
    if (!current || !current.commands.length) return;
    try {
      save({ ...current, ...undoPrivateCommand(current.seed, current.commands) });
      setDismissedFinish(null);
      setNotice('Última anotación privada deshecha y guardada.');
    } catch (failure) { setError(errorText(failure)); }
  };
  const refreshRunnerRule = async () => {
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
      else { setError(''); setNotice(props.example ? 'Regla de práctica del corredor temporal consultada.' : 'Regla del corredor temporal actualizada desde el organizador.'); }
    } catch (failure) {
      setError(errorText(failure));
    } finally { setRuleBusy(false); }
  };

  const loaded = session !== null;
  useEffect(() => {
    if (props.official) return;
    const snapshot = delivery.data;
    let current = sessionRef.current;
    if (!snapshot || !current) return;
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
            position: action.fieldPosition, jersey: action.jerseyNumber
          };
          if (action.kind === 'defense') command = { kind: 'position', side, playerId: action.identificationNumber, position: action.fieldPosition };
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
        save(current);
        setOutgoing('');
        setIncoming('');
        setSwapTarget('');
        setNotice('Movimientos confirmados recibidos y guardados en la planilla privada. Las jugadas privadas no se enviaron.');
      }
    } catch (failure) {
      setError(`No se pudo reflejar el movimiento confirmado en la planilla privada: ${errorText(failure)}. Revisa la entrega compartida y reintenta la sincronización.`);
    }
  }, [delivery.data, loaded, props.homeId, props.positionLabels, syncAttempt]);

  const header = <LiveScoringHeader>
    <button type="button" className="managerButtonOutline" disabled={!session}
      aria-pressed={lineupOpen} onClick={() => {
        setIncoming('');
        setOutgoing('');
        setSwapTarget('');
        setActiveBase(null);
        setBaseDetail(null);
        setLineupOpen(true);
      }}>{props.official ? 'Alineaciones del partido' : 'Mi Alineación'}</button>
  </LiveScoringHeader>;
  if (!session) return (
    <>
    {header}
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
  const lastCommand = session.commands.at(-1);
  const finishSuggestion = privateFinishSuggestion(state);
  const finishSuggestionKey = finishSuggestion ? JSON.stringify({ ...finishSuggestion, scores: state.scores }) : null;
  const undoDisabled = writeBlocked || ruleBusy || (props.official ? !props.official.canUndo : !session.commands.some((command) => !command.sharedRequestId));
  const batter = currentBatter(state);
  const nextBatter = currentBatter({ ...state, indexes: { ...state.indexes, [state.side]: state.indexes[state.side] + 1 } });
  const battingQueue = [
    batter, nextBatter,
    currentBatter({ ...state, indexes: { ...state.indexes, [state.side]: state.indexes[state.side] + 2 } })
  ];
  const displayedLineup = [...state.lineups[props.ownSide]].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const ownLineup = state.lineups[props.ownSide];
  const sourceRule = runnerRule ?? state.seed.courtesyRunnerSource;
  const courtesyPlayers = state.seed.rosters[state.side].filter((player) =>
    !state.bases.includes(player.id) &&
    (sourceRule === 'ROSTER' || !state.lineups[state.side].some((active) => active.id === player.id)));
  const sharedSheet = delivery.data?.sheets.find((sheet) => sheet.teamId === teamId);
  const available = state.seed.rosters[props.ownSide].filter((p) => props.example ?
    !ownLineup.some((active) => active.id === p.id) :
    sharedSheet?.presentSubstitutes.some((sub) => sub.identificationNumber === p.id));
  const innings = Array.from({ length: Math.max(state.seed.regulationInnings ?? 7, state.inning) }, (_, index) => index + 1);
  const sheetPlayers = (side: Side) => {
    const players = new Map(state.seed.lineups[side].map((p) => [p.id, p]));
    state.lineups[side].forEach((p) => players.set(p.id, p));
    state.log.filter((e) => e.side === side).forEach((e) => {
      for (const id of [e.batterId, e.runnerId, ...e.runs, e.stolenBy]) {
        if (id && !players.has(id)) players.set(id, state.seed.rosters[side].find((p) => p.id === id) ??
          { id, name: playerName(state, id), position: 'NA', jersey: '', order: null });
      }
    });
    return [...players.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  };
  const statusMessages = <>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {error ? <button type="button" className="managerButtonOutline" onClick={() => setSyncAttempt((n) => n + 1)}>Reintentar sincronización de movimientos confirmados</button> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </>;
  return (
    <>
      {header}
      {lineupOpen ? <article className="managerCard managerStepCard">
        <section aria-label="Mi alineación vigente">
          <header className="privateSheetHeader">
            <h2 ref={lineupHeading} tabIndex={-1}>{props.official ? 'Alineación vigente' : 'Mi Alineación'} · {state.seed.names[props.ownSide]}</h2>
            <button type="button" className="managerButtonOutline" onClick={() => setLineupOpen(false)}>Volver al juego</button>
          </header>
          {displayedLineup.length ? <ol className="lineupPreviewList">
            {displayedLineup.map((player) => <li className="lineupPreviewPlayer" key={player.id}>
              <span className="lineupPreviewOrder">{player.order ?? '—'}</span>
              <span className="lineupPreviewNumber" aria-label={player.jersey ? `Camiseta ${player.jersey}` : 'Camiseta sin registrar'}>{player.jersey ? `#${player.jersey}` : '—'}</span>
              <span className="lineupPreviewName" title={player.name}>{player.name}</span>
              <span className="lineupPreviewPosition" title={props.positionLabels[player.position]}>{player.position}</span>
            </li>)}
          </ol> : <p>Alineación no recibida. No se inventan jugadores ni posiciones.</p>}
        </section>
        {statusMessages}
      </article> : null}
      {!lineupOpen ? <>
      <article className="managerCard managerStepCard" aria-label="Pizarra por entradas y próximos bateadores">
        <div className="privateSummaryHeader">
          <div>
            <h2 className="privateLiveScoringTitle">PIZARRA RESUMEN</h2>
            <div className="privateLineScoreStatus" role="group" aria-label="Entrada, outs y cuenta actual" aria-live="polite" aria-atomic="true">
              <strong>{state.inning}.ª entrada · {state.side === 'away' ? 'Parte alta' : 'Parte baja'} · {state.outs} {state.outs === 1 ? 'out' : 'outs'}</strong>
              <span className="privatePitchCount">Bolas: {state.balls} · Strikes: {state.strikes}</span>
              {state.finished ? <strong>{props.official ? 'Partido finalizado' : 'Seguimiento cerrado'}</strong> : null}
            </div>
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
            </tr></thead>
            <tbody>{(['away', 'home'] as Side[]).map((side) => <tr key={side}
              aria-current={side === state.side ? 'true' : undefined}>
              <th scope="row">
                <span>{state.seed.names[side]}</span>
                <small>{side === 'away' ? 'Alta · Visitante' : 'Baja · Local'}{side === state.side ? ' · Al bate' : ''}</small>
              </th>
              {innings.map((inning) => {
                const runs = privateInningRuns(state, side, inning);
                return <td key={inning} className={side === state.side && inning === state.inning ? 'privateLineScoreCurrent' : undefined}>
                  {runs === null ? <span aria-label="Sin jugar">—</span> : runs}
                </td>;
              })}
              <td>{state.scores[side]}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <section aria-label="Bateador actual y dos siguientes" aria-live="polite" aria-atomic="true">
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
                <span className="privateBattingRecord"
                  aria-label={player ? `${stats.hits} ${stats.hits === 1 ? 'imparable' : 'imparables'} en ${stats.atBats} ${stats.atBats === 1 ? 'turno oficial' : 'turnos oficiales'}` : 'Jugador sin identificar: resumen no disponible'}
                  title="Imparables en turnos oficiales del partido">Bateo: {player ? `${stats.hits} de ${stats.atBats}` : '—'}</span>
                <small className="privateBattingMeta">
                  <span aria-label={player ? `Turno ${player.order} · ${player.jersey ? `Camiseta ${player.jersey}` : 'Camiseta sin registrar'}` : undefined}>
                    {player ? `${player.order}.º · ${player.jersey ? `#${player.jersey}` : 'Sin camiseta'}` : 'Alineación no recibida'}
                  </span>
                  {player ? <span className="privateBattingAverage" aria-label={`Average del partido: ${stats.average}`}
                    title="Promedio de bateo de este partido">AVG {stats.average}</span> : null}
                </small>
              </li>;
            })}
          </ol>
        </section>
      </article>
      <article className="managerCard managerStepCard">
        <header className="privateSheetHeader">
          <h2 ref={heading} tabIndex={-1}>{readOnly ? 'PARTIDO OFICIAL EN VIVO' : 'ANOTACION DE JUGADAS EN VIVO'}</h2>
        </header>
        {(['home', 'away'] as Side[]).filter((side) => state.seed.lineups[side].length === 0).map((side) => (
          <p key={side} className="managerWarning">{state.seed.names[side]}: alineación no recibida al abrir la planilla. Los turnos rivales quedan sin identificar; no se inventan nombres ni posiciones.</p>
        ))}
        <ol className="privateBases" aria-label="Corredores en base">
          {state.bases.map((id, index) => {
            const base = index + 1;
            const next: Destination = base === 3 ? 4 : base === 2 ? 3 : 2;
            const disabled = writeBlocked || state.finished || ruleBusy || delivery.busy;
            const runner = id ? state.lineups[state.side].find((player) => player.id === id) ??
              state.seed.rosters[state.side].find((player) => player.id === id) : undefined;
            const runnerStats = id && runner ? privateStats(state, state.side, id) : null;
            const runnerPosition = runner && runner.position !== 'NA' ? runner.position : null;
            const replaced = state.lineups[state.side].find((player) => player.id === (id ? state.courtesyFor[id] ?? id : null));
            const canUseCourtesy = Boolean(replaced && ['P', 'C'].includes(replaced.position) && courtesyPlayers.length);
            return <li key={base} data-occupied={Boolean(id)}>
              <button type="button" className={`privateBaseButton${id ? ' privateBaseButtonOccupied' : ''}`} disabled={disabled}
                aria-label={`${base}.ª Base: ${id ? playerName(state, id) : 'Vacía'}`}
                aria-describedby={id ? `private-base-runner-stats-${base} private-base-runner-average-${base} private-base-runner-meta-${base}` : undefined}
                aria-expanded={activeBase === base} aria-controls={`private-base-menu-${base}`}
                onClick={() => {
                  setActiveBase(activeBase === base ? null : base);
                  setBaseDetail(null);
                  setIncoming('');
                }}>
                {id ? <>
                  <span className="privateBaseSize" aria-hidden="true">
                    <strong>{base}.ª Base {activeBase === base ? '−' : '+'}</strong>
                    <span>{playerName(state, id)}</span>
                  </span>
                  <span className="privateBaseRunnerContent">
                    <span className="privateBaseHeading">
                      <strong>{base}.ª Base {activeBase === base ? '−' : '+'}</strong>
                    </span>
                    <span className="privateBaseRunnerName" title={playerName(state, id)}>{playerName(state, id)}</span>
                    <span id={`private-base-runner-stats-${base}`} className="privateBaseRunnerStats"
                      title="Imparables en turnos oficiales del partido"
                      aria-label={runnerStats ? `${runnerStats.hits} ${runnerStats.hits === 1 ? 'imparable' : 'imparables'} en ${runnerStats.atBats} ${runnerStats.atBats === 1 ? 'turno oficial' : 'turnos oficiales'}` : 'Jugador sin identificar: resumen no disponible'}>
                      Bateo: {runnerStats ? `${runnerStats.hits} de ${runnerStats.atBats}` : '—'}
                    </span>
                    <span id={`private-base-runner-average-${base}`} className="privateBaseRunnerAverage"
                      title="Promedio de bateo de este partido"
                      aria-label={`Average del partido: ${runnerStats?.average ?? '—'}`}>
                      AVG {runnerStats?.average ?? '—'}
                    </span>
                    <span id={`private-base-runner-meta-${base}`} className="privateBaseRunnerMeta"
                      aria-label={`${runner?.jersey ? `Camiseta ${runner.jersey}` : 'Camiseta sin registrar'} · ${runnerPosition ? `Posición actual: ${props.positionLabels[runnerPosition]}` : 'Posición sin identificar'}`}
                      title={runnerPosition ? props.positionLabels[runnerPosition] : 'Posición sin identificar'}>
                      #{runner?.jersey || '—'} · {runnerPosition ?? '—'}
                    </span>
                  </span>
                </> : <>
                  <strong>{base}.ª Base {activeBase === base ? '−' : '+'}</strong>
                  <span>Vacía</span>
                </>}
              </button>
              {activeBase === base ? <div id={`private-base-menu-${base}`} className="privateBaseMenu"
                role="group" aria-label={`Jugadas del corredor en ${base}.ª base`}>
                {!id ? <p>Base vacía: no hay corredor para registrar una jugada.</p> : null}
                {baseActions.map((action) => (
                  <Fragment key={action}>
                    <button type="button" className="managerButtonOutline"
                      aria-expanded={action === 'advance' ? baseDetail === 'advance' : undefined}
                      aria-controls={action === 'advance' ? `private-base-advance-${base}` : undefined}
                      disabled={disabled || !id ||
                        (action === 'steal' && next < 4 && Boolean(state.bases[next - 1])) ||
                        (action === 'courtesy' && !canUseCourtesy) ||
                        (action === 'advance' && !([2, 3, 4] as const).some((destination) =>
                          destination > base && (destination === 4 || !state.bases[destination - 1])))}
                      onClick={() => {
                        if (action === 'advance') setBaseDetail(baseDetail === 'advance' ? null : 'advance');
                        else if (action === 'advanceOut') setBaseDetail(action);
                        else if (action === 'courtesy') {
                          setBaseDetail('courtesy');
                          setIncoming('');
                          void consultRunnerRule(false, base);
                        } else {
                          void annotate({ kind: 'runner', action, from: base, to: action === 'steal' ? next : 0 });
                        }
                      }}>{action === 'courtesy' ? 'Corredor temporal' : runnerLabels[action]}</button>
                    {action === 'advance' && baseDetail === 'advance' ? <div id={`private-base-advance-${base}`}
                      className="privateBaseMenu privateAdvanceDestinations" role="group" aria-label="Destino del avance">
                      <label className="managerField"><span>Causa del avance</span>
                        <select value={advanceCause} disabled={disabled} onChange={(event) => {
                          setAdvanceCause(event.target.value); setErrorOuts('');
                        }}>
                          <option value="">Selecciona la causa</option>
                          <option value="advance">Jugada sin error</option>
                          <option value="error">Error defensivo</option>
                          <option value="passed">Bola pasada</option>
                          <option value="wild">Lanzamiento descontrolado</option>
                          <option value="balk">Movimiento ilegal del lanzador</option>
                        </select>
                      </label>
                      {advanceCause === 'error' ? <ErrorOutsField value={errorOuts} onChange={setErrorOuts} disabled={disabled} runnerOnly /> : null}
                      <strong>Destino del corredor</strong>
                      {([2, 3, 4] as const).map((destination) => <button type="button" className="managerButtonOutline" key={destination}
                        disabled={disabled || !id || !advanceCause || advanceCause === 'error' && !errorOuts ||
                          destination <= base || (destination < 4 && Boolean(state.bases[destination - 1]))}
                        onClick={() => {
                          if (advanceCause === 'advance') void annotate({ kind: 'runner', action: 'advance', cleanAdvance: true, from: base, to: destination });
                          else if (advanceCause === 'error') void annotate({ kind: 'runner', action: 'error', errorOuts: Number(errorOuts), from: base, to: destination });
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
                      {courtesyPlayers.map((player) => <option key={player.id} value={player.id}>{player.name} · Camiseta {player.jersey}</option>)}
                    </select>
                  </label>
                  <button type="button" className="managerButtonOutline" disabled={disabled || !id || !incoming || !canUseCourtesy}
                    onClick={() => consultRunnerRule(true, base)}>Registrar corredor temporal</button>
                </div> : null}
              </div> : null}
            </li>;
          })}
          <li>
            <button type="button" className="privateBaseButton" aria-label="Home"
              disabled={writeBlocked || state.finished || ruleBusy || delivery.busy}
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
                disabled={state.finished || ruleBusy || delivery.busy || !state.bases.some(Boolean)}
                onClick={() => setBaseDetail('advanceOut')}>Out al avanzar</button>
              <button type="button" className="managerButtonOutline privateUndoButton" disabled={undoDisabled}
                onClick={undo}>Deshacer última anotación</button>
              {!state.bases.some(Boolean) ? <p>No hay corredores en base para registrar este out.</p> : null}
              {baseDetail === 'advanceOut' ? <>
                <label className="managerField"><span>Corredor eliminado al intentar llegar a home</span>
                  <select value={homeOutFrom} disabled={state.finished || ruleBusy || delivery.busy}
                    onChange={(event) => setHomeOutFrom(event.target.value)}>
                    <option value="">Selecciona el corredor</option>
                    {state.bases.map((id, index) => id ? <option key={id} value={index + 1}>
                      {playerName(state, id)} · Desde {index + 1}.ª base
                    </option> : null)}
                  </select>
                </label>
                <button type="button" className="managerButtonOutline"
                  disabled={state.finished || ruleBusy || delivery.busy || !homeOutFrom || !state.bases[Number(homeOutFrom) - 1]}
                  onClick={() => annotate({ kind: 'runner', action: 'advanceOut', from: Number(homeOutFrom), to: 0, attemptedBase: 4 })}
                >Registrar out en home</button>
              </> : null}
            </div> : null}
          </li>
        </ol>
        {statusMessages}
        {readOnly ? <p role="status">Consulta en vivo del registro oficial. El anotador u organizador registra las jugadas y los cambios comunicados en el campo.</p> : <fieldset className="officialScoringControls" disabled={writeBlocked}>
        <div className="managerButtonRow privatePlayToolbar" role="group" aria-label="Lanzamientos y jugadas ofensivas">
          <button type="button" className="managerButtonSolid" disabled={state.finished || ruleBusy} onClick={() => annotate({ kind: 'pitch', value: 'ball' })}>Bola</button>
          <button type="button" className="managerButtonSolid" disabled={state.finished || ruleBusy} onClick={() => annotate({ kind: 'pitch', value: 'strike' })}>Strike</button>
          <button type="button" className="managerButtonSolid" disabled={state.finished || ruleBusy} onClick={() => annotate({ kind: 'pitch', value: 'foul' })}>Faul</button>
          {manualPlayResults.map((key) => (
            <button type="button" className={`managerButtonOutline ${['battedOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt'].includes(key) ? 'privatePlayOut' : 'privatePlayOnBase'}`} key={key}
              disabled={state.finished || ruleBusy}
              onClick={() => annotate({ kind: 'play', result: key })}
            >{key === 'homeRun' ? `${playLabels[key]} (HR)` : playLabels[key]}</button>
          ))}
          <button type="button" className="managerButtonOutline privateUndoButton" disabled={undoDisabled} onClick={undo}>Deshacer última anotación</button>
        </div>
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
          aria-label={props.official ? 'Confirmación del final oficial' : 'Confirmación de cierre del seguimiento privado'}>
          <div role="status">
            <strong>Posible final del partido</strong>
            <p>{{
              homeAheadAfterTop: `Terminó la parte alta de la ${finishSuggestion.inning}.ª entrada con el local arriba.`,
              walkOff: `El local anotó la carrera de la ventaja en la baja de la ${finishSuggestion.inning}.ª entrada.`,
              completedInning: `Terminó la ${finishSuggestion.inning}.ª entrada con un equipo en ventaja.`
            }[finishSuggestion.reason]} El marcador favorece a {state.seed.names[finishSuggestion.winner]}.
              Revisa las jugadas antes de confirmar. {props.official ? 'El cierre publica el final oficial del partido.' : 'Este cierre no afecta el partido oficial.'}</p>
          </div>
          <div className="managerButtonRow">
            <button type="button" className="managerButtonSolid" disabled={ruleBusy}
              onClick={() => annotate({ kind: 'finish' })}>{props.official ? 'Confirmar final del partido' : 'Confirmar cierre privado'}</button>
            <button type="button" className="managerButtonOutline"
              onClick={() => setDismissedFinish(finishSuggestionKey)}>Seguir anotando</button>
          </div>
        </section> : null}
        <p>Cada batazo se guarda al pulsarlo y mueve solo a los corredores obligados por la llegada del bateador. Los demás conservan su base; marca sus avances adicionales y su causa desde las bases. Puedes deshacer la última anotación.</p>
        <div className="managerButtonRow">
          <button type="button" className="managerButtonOutline" disabled={ruleBusy} onClick={props.onBack}>Volver al partido sin borrar anotaciones</button>
          <label className="managerField privateGameLength">
            <span>Duración:</span>
            <select aria-label={props.official ? 'Entradas reglamentarias del partido' : 'Entradas reglamentarias del seguimiento privado'}
              title={props.official ? 'Duración del partido oficial.' : 'Solo se aplica a la detección del final de este seguimiento, no cambia las reglas oficiales.'}
              value={state.seed.regulationInnings ?? ''} disabled={state.finished || ruleBusy || delivery.busy}
              onChange={(event) => configureRegulationInnings(event.target.value)}>
              <option value="" disabled={Boolean(props.official)}>Sin definir</option>
              <option value="7">Softbol · 7 entradas</option>
              <option value="9">Béisbol · 9 entradas</option>
            </select>
          </label>
          <button type="button" className="managerButtonOutline" disabled={state.finished || ruleBusy} onClick={() => annotate({ kind: 'finish' })}>{props.official ? 'Finalizar partido oficial' : 'Cerrar seguimiento privado'}</button>
        </div>
        </fieldset>}
      </article>

      <RunAccountingPanel runs={state.runAccounting.runs} name={(id) => playerName(state, id)}
        readOnly={readOnly} disabled={writeBlocked || state.finished || ruleBusy || delivery.busy}
        onReview={(review) => { void annotate({ kind: 'run-review', review }); }} />

      {!props.example && !props.official ? <DemoJerseyAssignments assignedPlayers={[
        ...state.seed.rosters.home, ...state.seed.rosters.away, ...state.lineups.home, ...state.lineups.away
      ]} /> : null}

      {(['away', 'home'] as Side[]).map((side) => (
        <article className="scorecardPreview" key={side}>
          <header className="scorecardPreviewHeader"><div><p className="lineupPreviewEyebrow">{props.official ? 'PLANILLA OFICIAL · ACTUALIZADA EN VIVO' : 'PLANILLA PRIVADA · DATOS DE ESTE SEGUIMIENTO'}</p><h2>{state.seed.names[side]}</h2><p>Mantén pulsada una actuación para ver el detalle; al soltar o retirar el dedo se oculta. Con teclado, mantén Espacio o Enter.</p></div></header>
          <div className="scorecardTableScroll"><table className="scorecardTable privateScorecardTable">
            <thead><tr><th scope="col" className="scorecardPlayerHeading">Jugador y turno</th>{innings.map((inning) => <th scope="col" key={inning}>Entrada {inning}</th>)}
              {['Apariciones', 'Turnos oficiales al bate', 'Imparables', 'Promedio de bateo', 'Jonrones', 'Bases por bolas', 'Ponches', 'Carreras', 'Impulsadas', 'Robos'].map((label) => <th scope="col" key={label}>{label}</th>)}
            </tr></thead>
            <tbody>{sheetPlayers(side).map((p) => {
              const stats = privateStats(state, side, p.id);
              const active = state.lineups[side].some((player) => player.id === p.id);
              return <tr key={p.id} aria-current={side === state.side && p.id === batter ? 'true' : undefined}>
                <th scope="row" className="scorecardPlayer"><span className="scorecardPlayerInfo"><strong>{p.order ?? 'Sin turno'} · {p.name}{!active && !p.id.startsWith('unknown:') ? ' · fuera de la alineación' : ''}</strong><small>{p.jersey ? `#${p.jersey} · ` : ''}{props.positionLabels[p.position]}{side === state.side && p.id === batter ? ' · AL BATE' : ''}</small></span></th>
                {innings.map((inning) => <td className="privateInningCell" key={inning}>
                  <PrivateInningCell playerId={p.id} playerName={p.name} inning={inning}
                    entries={state.log.filter((e) => e.side === side && e.inning === inning &&
                      (e.batterId === p.id || e.runnerId === p.id || e.runs.includes(p.id) || e.stolenBy === p.id))} />
                </td>)}
                {[stats.pa, stats.atBats, stats.hits, stats.average, stats.homeRuns, stats.walks, stats.strikeouts, stats.runs, stats.rbis, stats.steals].map((value, index) => <td key={index}>{value}</td>)}
              </tr>;
            })}</tbody>
          </table></div>
          {!sheetPlayers(side).length ? <p className="scorecardPreviewNote">Sin turnos registrados ni alineación recibida.</p> : null}
        </article>
      ))}

      </> : null}
      {lineupOpen && !readOnly ? <article className="managerCard managerStepCard">
        <h2>Cambios de mi equipo</h2>
        <fieldset className="privateControls" disabled={writeBlocked || state.finished || ruleBusy || delivery.busy}>
          <legend>{props.official ? 'Registro oficial de los cambios comunicados en el campo' : props.example ? 'Cambios de práctica; solo se aplican a este ejemplo' : 'Solicitudes compartidas de cambios; se aplican solo después de confirmarse'}</legend>
              <p>El sustituto conserva el turno de bateo del jugador saliente. Solo se ofrecen posiciones libres y la del jugador seleccionado. Para cambiar dos jugadores de puesto, usa el intercambio de posiciones. Este seguimiento no certifica la legalidad de reingresos ni de cambios entre bateador asignado y jugador flexible.</p>
              <label className="managerField"><span>Jugador que sale o cambia de posición</span><select value={outgoing} onChange={(e) => {
                setOutgoing(e.target.value);
                setSwapTarget('');
                const player = ownLineup.find((p) => p.id === e.target.value);
                if (player) setPosition(player.position);
              }}><option value="">Selecciona un jugador activo</option>{ownLineup.map((p) => <option key={p.id} value={p.id}>{p.order ?? 'Sin turno'} · {p.name}</option>)}</select></label>
              <label className="managerField"><span>Sustituto de la plantilla</span><select value={incoming} onChange={(e) => setIncoming(e.target.value)}><option value="">Selecciona un sustituto</option>{available.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}{p.jersey || getDemoJerseyNumber(p.id) ? ` · Camiseta ${p.jersey || getDemoJerseyNumber(p.id)}` : ''}</option>)}</select></label>
              {!available.length ? <p>No hay suplentes fuera de la alineación en la plantilla actual.</p> : null}
              <label className="managerField"><span>Nueva posición defensiva</span><select value={position} disabled={!outgoing} onChange={(e) => setPosition(e.target.value)}>{availablePositions.map((key) => <option key={key} value={key}>{props.positionLabels[key]}</option>)}</select></label>
              <label className="managerField"><span>Camiseta del sustituto (0–99)</span><input value={jersey} inputMode="numeric" onChange={(e) => setJersey(e.target.value)} /></label>
              <div className="managerButtonRow">
                <button type="button" className="managerButtonSolid" disabled={!outgoing || !incoming} onClick={() => annotate({ kind: 'substitution', side: props.ownSide, outId: outgoing, inId: incoming, position, jersey })}>{props.official ? 'Registrar sustitución oficial' : props.example ? 'Aplicar sustitución de práctica' : 'Comunicar sustitución para confirmación'}</button>
                <button type="button" className="managerButtonOutline" disabled={!outgoing} onClick={() => annotate({ kind: 'position', side: props.ownSide, playerId: outgoing, position })}>{props.official ? 'Registrar cambio defensivo oficial' : props.example ? 'Aplicar cambio defensivo de práctica' : 'Comunicar cambio defensivo para confirmación'}</button>
              </div>
              <h3>Intercambiar posiciones entre jugadores activos</h3>
              <label className="managerField"><span>Intercambiar posición con</span><select value={swapTarget} disabled={!outgoing} onChange={(e) => setSwapTarget(e.target.value)}>
                <option value="">Selecciona el otro jugador</option>
                {ownLineup.filter((player) => player.id !== outgoing && !['DH', 'NA'].includes(player.position)).map((player) => <option key={player.id} value={player.id}>{player.name} · {props.positionLabels[player.position]}</option>)}
              </select></label>
              <button type="button" className="managerButtonOutline" disabled={!outgoing || !swapTarget} onClick={() => {
                const target = ownLineup.find((player) => player.id === swapTarget && player.id !== outgoing);
                if (!target) { setError('Selecciona otro jugador activo para intercambiar posiciones.'); return; }
                void annotate({ kind: 'position', side: props.ownSide, playerId: outgoing, position: target.position });
              }}>{props.official ? 'Registrar intercambio oficial' : props.example ? 'Aplicar intercambio de práctica' : 'Comunicar intercambio de posiciones para confirmación'}</button>
        </fieldset>
      </article> : null}
      {lineupOpen && !props.example && !props.official ? <TeamSheetPanel connection={delivery}
        names={{ [props.homeId]: props.homeName, [props.awayId]: props.awayName }} positionLabels={props.positionLabels}
        roster={state.seed.rosters[props.ownSide].map((p) => ({ identificationNumber: p.id, displayName: p.name, jerseyNumber: p.jersey }))} /> : null}
    </>
  );
}
