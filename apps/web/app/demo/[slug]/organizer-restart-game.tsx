'use client';

import { useRef, useState } from 'react';
import { readOfficialObservation, readOrganizerCapacity, type OfficialGameSummary } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy } from '../../navigation-hooks';

export default function OrganizerRestartGame({ game, onRestart }: { game: OfficialGameSummary; onRestart: () => void }) {
  const { account } = usePlatformSession();
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useNavigationBusy(busy);
  const allowed = (game.status === 'in_progress' || game.status === 'suspended') && !game.protest;
  const restart = async () => {
    if (!account || !allowed || sending.current || !confirmed) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/official-scoring/games/${encodeURIComponent(game.gameId)}/state?${new URLSearchParams({ tournamentId: game.tournamentId })}`,
        { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo consultar la revisión del partido.');
      const observation = readOfficialObservation(body);
      const result = await fetch('/api/tournaments/restart-game', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedAccountId: account.id, tournamentId: game.tournamentId,
          gameId: game.gameId, expectedOfficialVersion: observation.officialVersion, requestId: crypto.randomUUID(), reason }) });
      const value = await result.json();
      if (!result.ok) throw new Error(typeof value.message === 'string' ? value.message : 'No se pudo anular el intento por fuerza mayor.');
      readOrganizerCapacity(value.capacity, account.id);
      onRestart();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo anular el partido.'); }
    finally { sending.current = false; setBusy(false); }
  };
  if (!account || !allowed) return null;
  return <details className="managerCard managerStepCard">
    <summary>Anular por fuerza mayor y repetir sin otro cupo</summary>
    <p>Solo el organizador puede hacerlo antes de finalizar el partido. Se eliminan las jugadas, marcador, estadísticas, historial de correcciones
      y archivos de suspensión de este intento. El encuentro vuelve a pendiente y requiere nuevas alineaciones.</p>
    <p>No recupera la oportunidad gratuita del torneo ni consume otro partido. Se conserva únicamente una constancia administrativa.
      Esta acción no puede deshacerse.</p>
    <label className="managerField"><span>Motivo de fuerza mayor</span><textarea maxLength={1000} value={reason} disabled={busy}
      onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label>
    <label className="managerTeamChoice"><input type="checkbox" checked={confirmed} disabled={busy}
      onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo descartar toda la anotación de este intento y repetir desde cero.</span></label>
    <button type="button" className="managerButtonOutline" disabled={busy || !confirmed || !reason.trim()} onClick={() => { void restart(); }}>
      {busy ? 'Anulando intento…' : 'Confirmar anulación por fuerza mayor'}
    </button>
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
