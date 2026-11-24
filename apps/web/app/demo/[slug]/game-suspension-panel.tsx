'use client';

import { useRef, useState } from 'react';
import { preservesStartedGame, type GameSuspension, type OfficialGameStatus } from '@playsport/shared';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { isChoiceDraft, isTextDraft } from '../../navigation-drafts';
import SuspensionArchive from './suspension-archive';

export default function GameSuspensionPanel({ apiBase, gameId, tournamentId, actorId, role, status, version, suspension, disabled, onUpdated }: {
  apiBase: string; gameId: string; tournamentId: string; actorId: string; role: string; status: OfficialGameStatus;
  version: number; suspension?: GameSuspension; disabled: boolean; onUpdated: (_value: unknown) => void; // eslint-disable-line no-unused-vars
}) {
  const scope = `${tournamentId}:${gameId}:suspension`;
  const [reason, setReason] = useNavigationDraft(`${scope}:reason`, '', isTextDraft);
  const [cause, setCause] = useNavigationDraft(`${scope}:cause`, '', isChoiceDraft(['', 'weather', 'force-majeure']));
  const [mode, setMode] = useNavigationDraft(`${scope}:mode`, '', isChoiceDraft(['', 'keep', 'reset']));
  const [date, setDate] = useNavigationDraft(`${scope}:date`, '', isTextDraft);
  const [time, setTime] = useNavigationDraft(`${scope}:time`, '', isTextDraft);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  useNavigationBusy(busy);
  const authorized = role === 'organizer' || role === 'scorekeeper';
  const reprogramming = role === 'organizer' && status === 'suspended';
  const suspending = authorized && (status === 'scheduled' || status === 'in_progress');
  const started = status === 'in_progress' || preservesStartedGame(suspension);
  const submit = async () => {
    if (sending.current) return;
    if (!confirmed || (!reprogramming && (!reason.trim() || !cause || started && !mode))) {
      setError('Completa los datos, elige si conservar o reiniciar y confirma la decisión.'); return;
    }
    sending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${apiBase}/games/${encodeURIComponent(gameId)}/${reprogramming ? 'reschedule' : 'suspension'}`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reprogramming ? { tournamentId, organizerId: actorId, expectedOfficialVersion: version, date, time } :
          { tournamentId, actorId, actorRole: role, expectedOfficialVersion: version, reason, cause, scoreHandling: started ? mode : 'reset' })
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo registrar la suspensión o nueva fecha.');
      onUpdated(value); setConfirmed(false); setMode(''); setReason(''); setCause('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo registrar la decisión.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <>
    {suspension ? <div className="managerCard managerStepCard">
      <p><strong>{status === 'suspended' ? 'Suspendido · Nueva fecha pendiente' : 'Juego reprogramado'}</strong></p>
      <p>{suspension.cause === 'weather' ? 'Clima' : 'Fuerza mayor'} · {suspension.reason}</p>
      <p>{suspension.scoreHandling === 'keep' ? 'Se conserva el juego completo para continuarlo.' : 'Se reinicia el juego completo. La anotación anterior queda archivada.'}</p>
      <p>Registrado por {suspension.recordedBy} · {suspension.recordedAt}</p>
      {suspension.rescheduled ? <p>Nueva fecha: {suspension.rescheduled.date} · {suspension.rescheduled.time}</p> : <p>Solo el organizador puede fijar la nueva fecha.</p>}
      <SuspensionArchive key={suspension.id} apiBase={apiBase} gameId={gameId} tournamentId={tournamentId} archiveId={suspension.id} />
    </div> : null}
    {suspending || reprogramming ? <details className="managerCard managerStepCard">
      <summary>{reprogramming ? 'Organizador · Reprogramar partido' : started ? 'Suspender por clima o fuerza mayor' : 'Aplazar por clima o fuerza mayor'}</summary>
      <fieldset className="privateControls" disabled={disabled || busy}>
        {reprogramming ? <>
          <label className="managerField"><span>Nueva fecha del partido</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="managerField"><span>Nueva hora del partido</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
        </> : <>
          <label className="managerField"><span>Causa de la suspensión</span><select value={cause} onChange={e => setCause(e.target.value)}>
            <option value="">Selecciona la causa</option><option value="weather">Clima</option><option value="force-majeure">Fuerza mayor</option>
          </select></label>
          <label className="managerField"><span>Motivo de la suspensión</span><textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
          {started ? <label className="managerField"><span>¿Conservar o reiniciar el juego?</span><select value={mode} onChange={e => setMode(e.target.value)}>
            <option value="">Elige una decisión</option><option value="keep">Conservar marcador, jugadas y estadísticas</option>
            <option value="reset">Reiniciar marcador, entradas, cuenta, bases y estadísticas</option>
          </select></label> : null}
          <p>La fecha nueva queda pendiente. No se borra la anotación anterior ni se concede una victoria o derrota.</p>
        </>}
        <label className="privateCheck"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo la decisión y su registro</label>
        <button className="managerButtonOutline" type="button" onClick={() => { void submit(); }}>{busy ? 'Guardando…' : reprogramming ? 'Guardar nueva fecha' : 'Confirmar suspensión'}</button>
      </fieldset>
      {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    </details> : null}
  </>;
}
