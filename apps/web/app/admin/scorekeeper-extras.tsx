'use client';

import { useEffect, useRef, useState } from 'react';
import { readScorekeeperExtraQueue, type ScorekeeperExtraRequest } from '@playsport/shared';
import { accessRequest } from '../account/access/access-request';

export default function ScorekeeperExtras({ accountId }: { accountId: string }) {
  const [requests, setRequests] = useState<ScorekeeperExtraRequest[]>([]);
  const [reason, setReason] = useState(''), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    setError(''); setRequests([]);
    void accessRequest('/api/accounts/scorekeeper-extras').then(value => {
      const next = readScorekeeperExtraQueue(value, accountId);
      if (active) setRequests(next);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudieron recuperar las solicitudes.'); });
    return () => { active = false; };
  }, [accountId, attempt]);
  const review = async (request: ScorekeeperExtraRequest, action: 'grant' | 'revoke') => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await accessRequest('/api/accounts/scorekeeper-extras', { expectedAdminId: accountId, accountId: request.accountId,
        tournamentId: request.tournamentId, gameId: request.gameId, expectedRevision: request.revision, action, reason });
      setReason(''); setAttempt(value => value + 1);
      setNotice(action === 'grant' ? 'Acceso de prueba autorizado para un solo partido. No se realizó ningún cobro ni asignación deportiva.' :
        'Acceso puntual revocado. Los datos se conservan.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo confirmar la revisión. Actualiza antes de reintentar.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <section className="managerCard managerStepCard"><h2>Accesos puntuales de Anotador</h2>
    <p>Autorizaciones administrativas de prueba, sin precios ni cobros. Solo un partido ya asignado; nunca todo el torneo.
      Cada solicitud y decisión queda auditada.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    <button className="managerButtonOutline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Actualizar solicitudes</button>
    <label className="managerField"><span>Motivo de la autorización o revocación</span>
      <textarea maxLength={500} required value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
    <div className="adminUserGrid">{requests.map(request => <article className="adminUserCard" key={JSON.stringify([request.accountId, request.tournamentId, request.gameId])}>
      <h3>{request.accountName}</h3><p>Torneo: {request.tournamentId}</p><p>Partido: {request.gameId}</p>
      <p>Estado: {request.status === 'requested' ? 'Pendiente' : request.status === 'granted' ? 'Autorizado' : 'Revocado'} · Revisión {request.revision}</p>
      <div className="managerButtonRow"><button className="managerButtonOutline" disabled={busy || !reason.trim() || request.status === 'granted'}
        onClick={() => void review(request, 'grant')}>Autorizar prueba de un partido</button>
        <button className="managerButtonOutline" disabled={busy || !reason.trim() || request.status === 'revoked'}
          onClick={() => void review(request, 'revoke')}>Revocar acceso puntual</button></div>
    </article>)}</div>
    {!requests.length && !error ? <p>No hay solicitudes para mostrar.</p> : null}
  </section>;
}
