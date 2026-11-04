'use client';

import { useEffect, useRef, useState } from 'react';
import { fieldPositionLabels, isScorecardCommand, isScorecardState, type PersonnelAction, type PersonnelRole, type PrivateCommand, type PrivateState, type Side } from '@playsport/shared';
import PrivateScorecardView from './private-scorecard-view';
import { OfficialEntryForm, officialRoleLabels, useTeamSheets, type TeamSheetConnection } from './team-sheets';
import { connectVisibleStream } from './live-stream';

type Snapshot = {
  state: { officialVersion: number };
  playByPlay: { scorecard: PrivateState; canUndo: boolean; lastScorecardCommand: PrivateCommand | null; scoreMatches: boolean };
  lineup: { teams: { homeTeamId: string; awayTeamId: string } | null };
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function readOfficialScorecard(value: unknown): Snapshot {
  if (!record(value) || !record(value.state) || !Number.isInteger(value.state.officialVersion) ||
      !record(value.playByPlay) || !isScorecardState(value.playByPlay.scorecard) ||
      typeof value.playByPlay.canUndo !== 'boolean' ||
      !record(value.playByPlay.runAccounting) || typeof value.playByPlay.runAccounting.scoreMatches !== 'boolean' ||
      !(value.playByPlay.lastScorecardCommand === null || isScorecardCommand(value.playByPlay.lastScorecardCommand)) ||
      !record(value.lineup) || !(value.lineup.teams === null || record(value.lineup.teams) &&
        typeof value.lineup.teams.homeTeamId === 'string' && typeof value.lineup.teams.awayTeamId === 'string')) {
    throw new Error('La pizarra oficial contiene datos inválidos. Actualiza el servicio y vuelve a cargar.');
  }
  return {
    state: { officialVersion: Number(value.state.officialVersion) },
    playByPlay: { scorecard: value.playByPlay.scorecard, canUndo: value.playByPlay.canUndo, lastScorecardCommand: value.playByPlay.lastScorecardCommand,
      scoreMatches: value.playByPlay.runAccounting.scoreMatches },
    lineup: { teams: value.lineup.teams === null ? null : {
      homeTeamId: String(value.lineup.teams.homeTeamId), awayTeamId: String(value.lineup.teams.awayTeamId)
    } }
  };
}
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la anotación oficial.';

export default function OfficialRunScoring({ apiBase, actorId = '', actorRole = 'manager', publicView = false, connection: providedConnection,
  gameId = 'game-global-1', tournamentId = 'tour-global-1', onBack, ownTeamId }: {
  apiBase: string; connection?: TeamSheetConnection;
  gameId?: string; tournamentId?: string; ownTeamId?: string; onBack?: () => void;
} & ({ publicView: true; actorId?: never; actorRole?: never } |
  { publicView?: false; actorId: string; actorRole: PersonnelRole })) {
  const localConnection = useTeamSheets({ apiBase, gameId, tournamentId, userId: actorId, role: actorRole, enabled: !providedConnection && !publicView });
  const connection = providedConnection ?? localConnection;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [retry, setRetry] = useState(0);
  const [selectedSide, setSelectedSide] = useState<Side>('home');
  const [arrival, setArrival] = useState('');
  const path = `${apiBase}/games/${gameId}`;
  const readOnly = publicView || actorRole === 'manager';
  const accept = (value: unknown) => {
    const next = readOfficialScorecard(value);
    if (!latest.current || next.state.officialVersion >= latest.current.state.officialVersion) {
      latest.current = next;
      setSnapshot(next);
    }
  };
  const load = async () => {
    const response = await fetch(`${path}/state?tournamentId=${encodeURIComponent(tournamentId)}`, { cache: 'no-store' });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : 'No se pudo cargar el partido oficial.');
    accept(body);
  };
  useEffect(() => {
    let active = true;
    const receive = (value: unknown) => { if (active) accept(value); };
    void fetch(`${path}/state?tournamentId=${encodeURIComponent(tournamentId)}`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('No se pudo cargar el partido oficial.');
      receive(await response.json());
    }).catch((failure: unknown) => { if (active) setError(message(failure)); });
    const update = (event: MessageEvent<string>) => {
      if (!active) return;
      try { receive(JSON.parse(event.data)); if (active) { setStreamError(''); setError(''); } }
      catch (failure) { if (active) setStreamError(message(failure)); }
    };
    const disconnect = connectVisibleStream(`${path}/stream?tournamentId=${encodeURIComponent(tournamentId)}`, (stream) => {
      stream.addEventListener('snapshot', update);
      stream.addEventListener('official_update', update);
      stream.onerror = () => { if (active) setStreamError('La conexión en vivo está interrumpida. Espera la reconexión antes de anotar.'); };
    });
    return () => { active = false; disconnect(); };
  }, [path, tournamentId, retry]);
  const submit = async (operation: { scorecardCommand?: PrivateCommand; undoLast?: boolean; regulationInnings?: 7 | 9; lastErrorOuts?: number | null },
    personnel?: { teamId: string; action: PersonnelAction }) => {
    if (readOnly || !connection.data?.canDecide) throw new Error('Este perfil solo puede consultar el partido oficial.');
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
      action: { kind: 'substitution', outgoingIdentificationNumber: value.outId, incomingIdentificationNumber: value.inId, fieldPosition: value.position, jerseyNumber: value.jersey }
    });
    if (value.kind === 'position') return submit({}, {
      teamId: value.side === 'home' ? teams.homeTeamId : teams.awayTeamId,
      action: { kind: 'defense', identificationNumber: value.playerId, fieldPosition: value.position }
    });
    await submit({ scorecardCommand: value });
  };
  const teams = snapshot?.lineup.teams;
  const side = ownTeamId && teams ? ownTeamId === teams.homeTeamId ? 'home' : 'away' : selectedSide;
  const state = snapshot?.playByPlay.scorecard;
  const names: Record<string, string> = { 'team-A': 'Tigres del Valle', 'team-B': 'Leones del Norte' };
  const teamId = teams ? side === 'home' ? teams.homeTeamId : teams.awayTeamId : '';
  const sheet = connection.data?.sheets.find((entry) => entry.teamId === teamId);
  const present = sheet ? [...sheet.lineup, ...sheet.presentSubstitutes].map((player) => player.identificationNumber) : [];
  const ready = Boolean(state?.lineups.home.length && state.lineups.away.length);
  const blocked = busy || !ready || !publicView && !connection.data || !readOnly && !connection.data?.canDecide ||
    Boolean(streamError || connection.streamError || connection.error);
  return <section className="officialScorecard" aria-label={publicView ? 'Consulta pública del partido' : readOnly ? 'Consulta oficial del manager' : 'Herramienta de anotación oficial'}>
    <div className="managerCard managerButtonRow">
      <strong>{readOnly ? 'Consulta oficial en vivo · Sin edición' : 'Anotación oficial · Compartida con ambos managers'}</strong>
      {onBack ? <button type="button" className="managerButtonOutline" onClick={onBack}>Volver al partido y al lineup</button> : null}
      <label className="managerField"><span>Equipo de la alineación</span>
        <select value={side} onChange={(event) => { setSelectedSide(event.target.value === 'away' ? 'away' : 'home'); setArrival(''); }} disabled={Boolean(ownTeamId)}>
          <option value="home">{teams ? names[teams.homeTeamId] ?? teams.homeTeamId : 'Local'}</option>
          <option value="away">{teams ? names[teams.awayTeamId] ?? teams.awayTeamId : 'Visitante'}</option>
        </select>
      </label>
      <button type="button" className="managerButtonOutline" onClick={() => { setRetry((n) => n + 1); connection.refresh(); }}>Actualizar pizarra oficial</button>
    </div>
    {error || streamError || connection.error || connection.streamError ? <p className="managerWarning" role="alert">{error || streamError || connection.error || connection.streamError}</p> : null}
    {snapshot && !snapshot.playByPlay.scoreMatches ? <p className="managerWarning" role="status">El marcador contiene ajustes sin carreras reconstruidas. El desglose de CL y CS está incompleto.</p> : null}
    {!ready ? <p className="managerWarning" role="status">Falta recibir el lineup de {state && !state.lineups.home.length ? 'local' : 'visitante'}. Las jugadas se habilitan cuando ambos managers entregan sus alineaciones.</p> : null}
    {!state || !teams ? <p role="status">Consultando pizarra oficial…</p> : <PrivateScorecardView
      apiBase={apiBase} tournamentId={tournamentId} gameId={gameId} managerId={actorId}
      homeId={teams.homeTeamId} awayId={teams.awayTeamId} ownSide={side}
      homeName={names[teams.homeTeamId] ?? teams.homeTeamId} awayName={names[teams.awayTeamId] ?? teams.awayTeamId}
      initialLineup={state.lineups[side]} positionLabels={fieldPositionLabels}
      onBack={onBack ?? (() => { globalThis.location.href = publicView ? '/' : '/demo/live-scoring'; })}
      official={{
        session: {
          seed: state.seed, commands: snapshot.playByPlay.lastScorecardCommand ? [snapshot.playByPlay.lastScorecardCommand] : [],
          state: { ...state, seed: { ...state.seed, names: { home: names[teams.homeTeamId] ?? teams.homeTeamId, away: names[teams.awayTeamId] ?? teams.awayTeamId } } }
        },
        readOnly, busy: blocked, canUndo: snapshot.playByPlay.canUndo, connection,
        onCommand: command, onUndo: () => submit({ undoLast: true }),
        onDuration: (regulationInnings) => submit({ regulationInnings }), onErrorOuts: (lastErrorOuts) => submit({ lastErrorOuts })
      }} />}
    {!readOnly && state && sheet ? <details className="managerCard">
      <summary>Llegadas y personal presente · {names[teamId] ?? teamId}</summary>
      <label className="managerField"><span>Jugador que llega</span><select value={arrival} disabled={blocked || state.finished} onChange={(event) => setArrival(event.target.value)}>
        <option value="">Selecciona un jugador</option>
        {state.seed.rosters[side].filter((player) => !present.includes(player.id)).map((player) => <option value={player.id} key={player.id}>{player.name} · {player.id}</option>)}
      </select></label>
      <button className="managerButtonOutline" type="button" disabled={blocked || state.finished || !arrival}
        onClick={() => { void submit({}, { teamId, action: { kind: 'arrival', identificationNumber: arrival } }).then(() => setArrival('')).catch((failure) => setError(message(failure))); }}>Registrar llegada oficial</button>
      <OfficialEntryForm disabled={blocked || state.finished} onAdd={(official) => submit({}, { teamId, action: { kind: 'staff-arrival', official } })} />
      {sheet.presentOfficials.map((official) => <p key={`${official.role}:${official.identificationNumber}`}>
        {officialRoleLabels[official.role]} · {official.displayName}
        <button type="button" className="managerButtonOutline" disabled={blocked || state.finished}
          onClick={() => { void submit({}, { teamId, action: { kind: 'staff-departure', role: official.role, identificationNumber: official.identificationNumber } }).catch((failure) => setError(message(failure))); }}>Registrar retiro</button>
      </p>)}
    </details> : null}
  </section>;
}
