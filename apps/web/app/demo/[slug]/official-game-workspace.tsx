'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { isOfficialGameDetails, isProfileLocation, venezuelaStates, type OfficialGameSummary, type ProfileLocation } from '@playsport/shared';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { TeamSheetPanel, useTeamSheets } from './team-sheets';
import { fieldPositionLabels } from './private-scorecard';
import OfficialRunScoring from './official-run-scoring';
import ScorekeeperSubstitutionsPanel from './scorekeeper-substitutions';
import OrganizerRestartGame from './organizer-restart-game';

export default function OfficialGameWorkspace({ view, game, onBack, actorId }: { view: 'organizer' | 'scorekeeper'; game: OfficialGameSummary; onBack: () => void; actorId?: string }) {
  const [liveState, setLiveState] = useState<Pick<OfficialGameSummary, 'status' | 'homeScore' | 'awayScore' | 'suspension' | 'protest'> | null>(null);
  const currentGame = liveState ? { ...game, ...liveState, details: game.details && liveState.suspension?.rescheduled ?
    { ...game.details, date: liveState.suspension.rescheduled.date, time: liveState.suspension.rescheduled.time } : game.details } : game;
  const userId = actorId ?? (view === 'organizer' ? 'org-demo' : 'scorer-demo');
  const apiBase = process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring';
  const connection = useTeamSheets({
    apiBase, gameId: game.gameId, tournamentId: game.tournamentId, userId, role: view, enabled: game.status !== 'final' || view === 'scorekeeper'
  });
  const names = { [game.homeTeamId]: game.details?.homeTeamName ?? game.homeTeamId, [game.awayTeamId]: game.details?.awayTeamName ?? game.awayTeamId };
  return <section className="managerWorkspace">
    {view === 'organizer' ? <ScorekeeperSubstitutionsPanel key={`${game.tournamentId}:${game.gameId}`} tournamentId={game.tournamentId} gameId={game.gameId} status={currentGame.status} /> : null}
    {view === 'organizer' ? <OrganizerRestartGame game={currentGame} onRestart={onBack} /> : null}
    {currentGame.status === 'final' ? <div className="managerSteps managerButtonRow"><Link className="managerButtonSolid"
      href={`/demo/events-map?official=${encodeURIComponent(game.gameId)}`}>
      Consultar y compartir resultado oficial
    </Link></div> : null}
    {view === 'organizer' && game.details ? <GameLocation key={game.gameId} apiBase={apiBase} game={currentGame} organizerId={userId} /> : null}
    {game.status === 'final' && view !== 'scorekeeper' ? <OfficialRunScoring apiBase={apiBase} publicView
      gameId={game.gameId} tournamentId={game.tournamentId} teamNames={names} onBack={onBack} backLabel="Volver a mis partidos" /> : <>
      <OfficialRunScoring apiBase={apiBase} actorId={userId} actorRole={view} connection={connection}
        onState={setLiveState}
        gameId={game.gameId} tournamentId={game.tournamentId} teamNames={names} onBack={onBack} backLabel="Volver a mis partidos" />
      <details className="managerStepCard"><summary>Entregas de lineup y registro de movimientos</summary>
        <TeamSheetPanel connection={connection} names={names} positionLabels={fieldPositionLabels} />
      </details>
    </>}
  </section>;
}

const isLocationDraft = (value: unknown): value is ProfileLocation => value !== null && typeof value === 'object' &&
  'stateId' in value && 'municipalityId' in value && (value.stateId === '' && value.municipalityId === '' || isProfileLocation(value));
export function GameLocation({ apiBase, game, organizerId }: { apiBase: string; game: OfficialGameSummary; organizerId: string }) {
  const [location, setLocation, ready] = useNavigationDraft(`official-game-location:${game.tournamentId}:${game.gameId}`,
    { stateId: game.details?.stateId ?? '', municipalityId: game.details?.municipalityId ?? '' }, isLocationDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const sending = useRef(false);
  useNavigationBusy(busy);
  const state = venezuelaStates.find(item => item.id === location.stateId);
  const locked = game.status === 'final' || game.status === 'protested' || game.status === 'suspended' || Boolean(game.protest);
  const save = async () => {
    if (sending.current) return;
    if (!game.details || !isProfileLocation(location)) { setError('Selecciona el estado y municipio reales de la sede.'); return; }
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiBase}/games/${encodeURIComponent(game.gameId)}/details`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: game.tournamentId, organizerId, details: { ...game.details, ...location } })
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(result && typeof result === 'object' && 'message' in result && typeof result.message === 'string' ?
        result.message : 'No se pudo guardar la ubicación de la sede.');
      if (!result || typeof result !== 'object' || !('details' in result) || !isOfficialGameDetails(result.details) ||
          result.details.stateId !== location.stateId || result.details.municipalityId !== location.municipalityId) {
        throw new Error('El servicio devolvió una ubicación inválida. Actualiza el partido antes de reintentar.');
      }
      setNotice('Ubicación guardada. El partido aparecerá en la cartelera de este estado y municipio.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar la ubicación de la sede.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <details className="managerCard managerStepCard">
    <summary>Ubicación de la sede para la cartelera</summary>
    <p>Sede: {game.details?.venue}. Indica dónde está el estadio, no la procedencia de los equipos.</p>
    <fieldset className="privateControls" disabled={!ready || busy || locked}>
      <label className="managerField"><span>Estado de la sede</span><select value={location.stateId}
        onChange={event => {
          const stateId = event.target.value;
          const next = venezuelaStates.find(item => item.id === stateId);
          setLocation({ stateId, municipalityId: next?.municipalities[0]?.id ?? '' });
        }}>
        <option value="">Selecciona el estado</option>
        {venezuelaStates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="managerField"><span>Municipio de la sede</span><select value={location.municipalityId}
        disabled={!state?.municipalities.length} onChange={event => setLocation({ ...location, municipalityId: event.target.value })}>
        {state?.municipalities.length ? state.municipalities.map(item => <option key={item.id} value={item.id}>{item.name}</option>) :
          <option value="">Sin división municipal catalogada</option>}
      </select></label>
      <button className="managerButtonOutline" type="button" disabled={!isProfileLocation(location)} onClick={() => { void save(); }}>
        {busy ? 'Guardando ubicación…' : 'Guardar ubicación de la sede'}
      </button>
    </fieldset>
    {locked ? <p>No se modifican los datos de juegos suspendidos, bajo protesta o finalizados.</p> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </details>;
}
