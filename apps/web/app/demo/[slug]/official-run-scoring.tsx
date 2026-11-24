'use client';

import { useEffect, useRef, useState } from 'react';
import { InstitutionName } from '../../institutional-logos';
import { useRouter } from 'next/navigation';
import { fieldPositionLabels, readOfficialObservation, isScorecardCommand, type GameSuspension, type GameProtest, type OfficialGameStatus, type PersonnelAction, type PersonnelRole, type PrivateCommand, type PrivateState, type Side } from '@playsport/shared';
import GameSuspensionPanel from './game-suspension-panel';
import ManagerPersonnelRequests from './manager-personnel-requests';
import { TeamSheetPanel } from './team-sheets';
import PrivateScorecardView from './private-scorecard-view';
import { OfficialEntryForm, officialRoleLabels, useTeamSheets, type TeamSheetConnection } from './team-sheets';
import { connectVisibleStream } from './live-stream';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { isChoiceDraft, isTextDraft } from '../../navigation-drafts';
import LiveScoringHeader from './live-scoring-header';
import GameProtestPanel from './game-protest-panel';
import OfficialResult from './official-result';
import GameChat from './game-chat';
import { type GameClockAction } from '@playsport/shared';

type Snapshot = {
  serverTime?: string;
  state: { officialVersion: number; status: OfficialGameStatus; homeScore: number; awayScore: number; protest?: GameProtest; suspension?: GameSuspension };
  playByPlay: { scorecard: PrivateState; canUndo: boolean; lastScorecardCommand: PrivateCommand | null; scoreMatches: boolean };
  lineup: { teams: { homeTeamId: string; awayTeamId: string } | null };
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function readOfficialScorecard(value: unknown): Snapshot {
  const observation = readOfficialObservation(value);
  if (!record(value) || !record(value.playByPlay) ||
      typeof value.playByPlay.canUndo !== 'boolean' ||
      !record(value.playByPlay.runAccounting) || typeof value.playByPlay.runAccounting.scoreMatches !== 'boolean' ||
      !(value.playByPlay.lastScorecardCommand === null || isScorecardCommand(value.playByPlay.lastScorecardCommand)) ||
      !record(value.lineup) || !(value.lineup.teams === null || record(value.lineup.teams) &&
        typeof value.lineup.teams.homeTeamId === 'string' && typeof value.lineup.teams.awayTeamId === 'string')) {
    throw new Error('La pizarra oficial contiene datos inválidos. Actualiza el servicio y vuelve a cargar.');
  }
  return {
    ...(record(value) && typeof value.serverTime === 'string' && Number.isFinite(Date.parse(value.serverTime)) ? { serverTime: value.serverTime } :
      record(value) && typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp)) ? { serverTime: value.timestamp } : {}),
    state: { officialVersion: observation.officialVersion, status: observation.status,
      homeScore: observation.homeScore, awayScore: observation.awayScore,
      ...(observation.protest ? { protest: observation.protest } : {}),
      ...(observation.suspension ? { suspension: observation.suspension } : {}) },
    playByPlay: { scorecard: observation.scorecard, canUndo: value.playByPlay.canUndo, lastScorecardCommand: value.playByPlay.lastScorecardCommand,
      scoreMatches: value.playByPlay.runAccounting.scoreMatches },
    lineup: { teams: value.lineup.teams === null ? null : {
      homeTeamId: String(value.lineup.teams.homeTeamId), awayTeamId: String(value.lineup.teams.awayTeamId)
    } }
  };
}
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la anotación oficial.';

export default function OfficialRunScoring({ apiBase, actorId = '', actorRole = 'manager', publicView = false, allowManagerRequests = false, connection: providedConnection,
  gameId = 'game-global-1', tournamentId = 'tour-global-1', onBack, onState, backLabel = publicView ? 'Volver a mi inicio' : 'Volver al partido y al lineup', ownTeamId, teamNames }: {
  apiBase: string; connection?: TeamSheetConnection;
  allowManagerRequests?: boolean;
  onState?: (_state: Snapshot['state']) => void; // eslint-disable-line no-unused-vars
  gameId?: string; tournamentId?: string; ownTeamId?: string; onBack?: () => void; backLabel?: string; teamNames?: Record<string, string>;
} & ({ publicView: true; actorId?: never; actorRole?: never } |
  { publicView?: false; actorId: string; actorRole: PersonnelRole })) {
  const router = useRouter();
  const localConnection = useTeamSheets({ apiBase, gameId, tournamentId, userId: actorId, role: actorRole, enabled: !providedConnection && !publicView });
  const connection = providedConnection ?? localConnection;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const observer = useRef(onState);
  observer.current = onState;
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  useNavigationBusy(busy);
  const sending = useRef(false);
  const [retry, setRetry] = useState(0);
  const draftScope = `${tournamentId}:${gameId}:official`;
  const [selectedSide, setSelectedSide] = useNavigationDraft<Side>(publicView || actorRole === 'manager' ? null : `${draftScope}:side`, 'home', isChoiceDraft(['home', 'away']));
  const [arrival, setArrival] = useNavigationDraft(publicView || actorRole === 'manager' ? null : `${draftScope}:${selectedSide}:arrival`, '', isTextDraft);
  const path = `${apiBase}/games/${encodeURIComponent(gameId)}`;
  const readQuery = new URLSearchParams({ tournamentId, ...(!publicView && actorRole === 'scorekeeper' ? { role: 'scorekeeper', userId: actorId } : {}) }).toString();
  const readOnly = publicView || actorRole === 'manager' || Boolean(snapshot?.state.protest) || snapshot?.state.status === 'suspended';
  const accept = (value: unknown) => {
    const next = readOfficialScorecard(value);
    if (!latest.current || next.state.officialVersion >= latest.current.state.officialVersion) {
      latest.current = next;
      if (next.serverTime) setClockOffsetMs(Date.parse(next.serverTime) - Date.now());
      setSnapshot(next);
      observer.current?.(next.state);
    }
  };
  const load = async () => {
    const response = await fetch(`${path}/state?${readQuery}`, { cache: 'no-store' });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : 'No se pudo cargar el partido oficial.');
    accept(body);
  };
  useEffect(() => {
    let active = true;
    const receive = (value: unknown) => { if (active) accept(value); };
    void fetch(`${path}/state?${readQuery}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('No se pudo cargar el partido oficial.');
      receive(await response.json());
    }).catch((failure: unknown) => { if (active) setError(message(failure)); });
    const update = (event: MessageEvent<string>) => {
      if (!active) return;
      try { receive(JSON.parse(event.data)); if (active) { setStreamError(''); setError(''); } }
      catch (failure) { if (active) setStreamError(message(failure)); }
    };
    const disconnect = connectVisibleStream(`${path}/stream?${readQuery}`, (stream) => {
      stream.addEventListener('snapshot', update);
      stream.addEventListener('official_update', update);
      stream.onerror = () => { if (active) setStreamError('La conexión en vivo está interrumpida. Espera la reconexión antes de anotar.'); };
    });
    return () => { active = false; disconnect(); };
  }, [path, readQuery, retry]);
  const submit = async (operation: { scorecardCommand?: PrivateCommand; undoLast?: boolean; regulationInnings?: 7 | 9; lastErrorOuts?: number | null; clockAction?: GameClockAction },
    personnel?: { teamId: string; action: PersonnelAction }) => {
    if (readOnly || !connection.data?.canDecide) throw new Error('Este rol solo puede consultar el partido oficial.');
    if (connection.data.scoringBlockReason) throw new Error(connection.data.scoringBlockReason);
    if (sending.current) throw new Error('Espera a que termine la anotación anterior.');
    if (streamError || connection.streamError) throw new Error('Recupera la conexión en vivo antes de anotar.');
    sending.current = true; setBusy(true); setError('');
    try {
      if (!latest.current) throw new Error('Carga primero la pizarra oficial.');
      if (personnel) {
        await connection.record(personnel.teamId, personnel.action, latest.current.state.officialVersion);
        await load();
      } else {
        const response = await fetch(`${path}/official-updates`, {
          credentials: 'include',
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tournamentId, actorId, actorRole, expectedOfficialVersion: latest.current.state.officialVersion, patch: {}, ...operation })
        });
        const value: unknown = await response.json();
        if (!response.ok) throw new Error(record(value) && typeof value.message === 'string' ? value.message : 'No se pudo guardar la anotación oficial.');
        accept(value);
      }
    } catch (failure) {
      setError(message(failure));
      throw failure;
    } finally { sending.current = false; setBusy(false); }
  };
  const command = async (value: PrivateCommand) => {
    const teams = latest.current?.lineup.teams;
    if (!teams) throw new Error('El partido todavía no tiene equipos asignados.');
    if (value.kind === 'substitution') return submit({}, {
      teamId: value.side === 'home' ? teams.homeTeamId : teams.awayTeamId,
      action: { kind: 'substitution', outgoingIdentificationNumber: value.outId, incomingIdentificationNumber: value.inId, fieldPosition: value.position, jerseyNumber: value.jersey,
        ...(value.arrival ? { arrival: true } : {}) }
    });
    if (value.kind === 'position') return submit({}, {
      teamId: value.side === 'home' ? teams.homeTeamId : teams.awayTeamId,
      action: { kind: 'defense', identificationNumber: value.playerId, fieldPosition: value.position,
        ...(value.swapWith ? { swapWith: value.swapWith } : {}) }
    });
    await submit({ scorecardCommand: value });
  };
  const teams = snapshot?.lineup.teams;
  const side = ownTeamId && teams ? ownTeamId === teams.homeTeamId ? 'home' : 'away' : selectedSide;
  const state = snapshot?.playByPlay.scorecard;
  const names: Record<string, string> = teamNames ?? { 'team-A': 'Tigres del Valle', 'team-B': 'Leones del Norte' };
  const teamId = teams ? side === 'home' ? teams.homeTeamId : teams.awayTeamId : '';
  const sheet = connection.data?.sheets.find((entry) => entry.teamId === teamId);
  const present = sheet ? [...sheet.lineup, ...sheet.presentSubstitutes].map((player) => player.identificationNumber) : [];
  const ready = Boolean(state?.lineups.home.length && state.lineups.away.length);
  const blocked = busy || !ready || !publicView && !connection.data || !readOnly && !connection.data?.canDecide ||
    Boolean(streamError || connection.streamError || connection.error || connection.data?.scoringBlockReason);
  const goBack = onBack ?? (() => router.push(publicView ? '/' : '/demo/live-scoring'));
  const tools = <>
    <span className="liveScoringMode">{readOnly ? 'Solo lectura' : 'Anotación oficial'}</span>
    <button type="button" className="managerButtonOutline" disabled={busy} onClick={goBack}>{backLabel}</button>
    <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => { setRetry((n) => n + 1); connection.refresh(); }}>Actualizar pizarra oficial</button>
  </>;
  return <section className="officialScorecard" aria-label={publicView ? 'Consulta pública del partido' : readOnly ? 'Consulta oficial del manager' : 'Herramienta de anotación oficial'}>
    {!state || !teams ? <LiveScoringHeader tools={tools} /> : null}
    {error || streamError || connection.error || connection.streamError ? <p className="managerWarning" role="alert">{error || streamError || connection.error || connection.streamError}</p> : null}
    {snapshot && teams && !snapshot.state.protest ? <OfficialResult game={{ ...teams, ...snapshot.state, details: null }} teamNames={names} /> : null}
    {snapshot ? <GameProtestPanel apiBase={apiBase} gameId={gameId} tournamentId={tournamentId} actorId={actorId}
      role={publicView ? 'public' : actorRole} status={snapshot.state.status} version={snapshot.state.officialVersion}
      protest={snapshot.state.protest} names={names} disabled={busy || Boolean(error || streamError || connection.error || connection.streamError)}
      onUpdated={value => { accept(value); connection.refresh(); }} /> : null}
    {snapshot ? <GameSuspensionPanel apiBase={apiBase} gameId={gameId} tournamentId={tournamentId} actorId={actorId}
      role={publicView ? 'public' : actorRole} status={snapshot.state.status} version={snapshot.state.officialVersion}
      suspension={snapshot.state.suspension} disabled={busy || Boolean(error || streamError || connection.error || connection.streamError)}
      onUpdated={value => { accept(value); connection.refresh(); }} /> : null}
    {snapshot && !snapshot.playByPlay.scoreMatches ? <p className="managerWarning" role="status">El marcador contiene ajustes sin carreras reconstruidas. El desglose de CL y CS está incompleto.</p> : null}
    {connection.data?.scoringBlockReason ? <p className="managerWarning" role="status">{connection.data.scoringBlockReason}</p> : null}
    {allowManagerRequests && !publicView && actorRole === 'manager' && state && snapshot &&
      ['scheduled','in_progress'].includes(snapshot.state.status) ? <>
      <ManagerPersonnelRequests connection={connection} state={state} disabled={busy || Boolean(error || streamError)} />
      <details className="managerCard managerStepCard"><summary>Lineup entregado, llegadas y solicitudes de personal</summary>
        <fieldset className="privateControls" disabled={busy || Boolean(error || streamError)}>
          <TeamSheetPanel connection={connection} names={names} positionLabels={fieldPositionLabels} allowManagerRequests
            roster={state.seed.rosters[side].map(player => ({ identificationNumber: player.id, displayName: player.name, jerseyNumber: player.jersey }))} />
        </fieldset>
      </details>
    </> : null}
    {!ready ? <p className="managerWarning" role="status">Falta recibir el lineup de {state && !state.lineups.home.length ? 'local' : 'visitante'}. {readOnly ? 'Puedes consultar los datos disponibles, sin editar el partido.' : 'Las jugadas se habilitan cuando ambos managers entregan sus alineaciones.'}</p> : null}
    {!state || !teams ? <p role="status">Consultando pizarra oficial…</p> : <PrivateScorecardView
      headerTools={tools}
      matchChat={<GameChat key={gameId} gameId={gameId} />}
      apiBase={apiBase} tournamentId={tournamentId} gameId={gameId} managerId={actorId}
      homeId={teams.homeTeamId} awayId={teams.awayTeamId} ownSide={side}
      homeName={names[teams.homeTeamId] ?? teams.homeTeamId} awayName={names[teams.awayTeamId] ?? teams.awayTeamId}
      initialLineup={state.lineups[side]} positionLabels={fieldPositionLabels}
      onBack={goBack}
      official={{
        actorRole: publicView ? undefined : actorRole,
        session: {
          seed: state.seed, commands: snapshot.playByPlay.lastScorecardCommand ? [snapshot.playByPlay.lastScorecardCommand] : [],
          state: { ...state, seed: { ...state.seed, names: { home: names[teams.homeTeamId] ?? teams.homeTeamId, away: names[teams.awayTeamId] ?? teams.awayTeamId } } }
        },
        readOnly, publicView, busy: blocked, canUndo: snapshot.playByPlay.canUndo, connection,
        onCommand: command, onUndo: () => submit({ undoLast: true }),
        ...(allowManagerRequests && actorRole === 'manager' && !publicView && !snapshot.state.protest &&
          ['scheduled', 'in_progress'].includes(snapshot.state.status) ? {
          onPersonnelRequest: async (requestedSide: Side, action: PersonnelAction) => {
            const requestedTeam = requestedSide === 'home' ? teams.homeTeamId : teams.awayTeamId;
            if (connection.data?.ownTeamId !== requestedTeam) throw new Error('Solo puedes solicitar cambios para tu equipo.');
            await connection.request(requestedTeam, action);
          }
        } : {}),
        onDuration: (regulationInnings) => submit({ regulationInnings }), onErrorOuts: (lastErrorOuts) => submit({ lastErrorOuts }),
        onClock: clockAction => submit({ clockAction }), clockOffsetMs
      }} />}
    {!publicView && state && teams ? <details className="managerCard managerStepCard">
      <summary>Equipo para consultar alineaciones y gestionar personal</summary>
      <label className="managerField"><span>Equipo de la alineación</span>
        <select value={side} onChange={(event) => setSelectedSide(event.target.value === 'away' ? 'away' : 'home')} disabled={Boolean(ownTeamId) || busy}>
          <option value="home">{names[teams.homeTeamId] ?? teams.homeTeamId}</option>
          <option value="away">{names[teams.awayTeamId] ?? teams.awayTeamId}</option>
        </select>
      </label>
    </details> : null}
    {!readOnly && state && sheet ? <details className="managerCard">
      <summary>Llegadas y personal presente · <InstitutionName id={teamId}>{names[teamId] ?? teamId}</InstitutionName></summary>
      <label className="managerField"><span>Jugador que llega</span><select value={arrival} disabled={blocked || state.finished} onChange={(event) => setArrival(event.target.value)}>
        <option value="">Selecciona un jugador</option>
        {state.seed.rosters[side].filter((player) => !present.includes(player.id)).map((player) => <option value={player.id} key={player.id}>{player.name} · {player.id}</option>)}
      </select></label>
      <button className="managerButtonOutline" type="button" disabled={blocked || state.finished || !arrival}
        onClick={() => { void submit({}, { teamId, action: { kind: 'arrival', identificationNumber: arrival } }).then(() => setArrival('')).catch((failure) => setError(message(failure))); }}>Registrar llegada oficial</button>
      <OfficialEntryForm draftKey={`${draftScope}:${teamId}:staff-form`} disabled={blocked || state.finished} onAdd={(official) => submit({}, { teamId, action: { kind: 'staff-arrival', official } })} />
      {sheet.presentOfficials.map((official) => <p key={`${official.role}:${official.identificationNumber}`}>
        {officialRoleLabels[official.role]} · {official.displayName}
        <button type="button" className="managerButtonOutline" disabled={blocked || state.finished}
          onClick={() => { void submit({}, { teamId, action: { kind: 'staff-departure', role: official.role, identificationNumber: official.identificationNumber } }).catch((failure) => setError(message(failure))); }}>Registrar retiro</button>
      </p>)}
    </details> : null}
  </section>;
}
