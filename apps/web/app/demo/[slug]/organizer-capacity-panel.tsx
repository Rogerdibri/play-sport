'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import OrganizerCommercialPanel from './organizer-commercial-panel';
import { estimateTournamentCapacity, readOrganizerCapacity, type OrganizerCapacitySnapshot,
  type OrganizerPlayedGame, type TournamentDocument } from '@playsport/shared';

export function OrganizerCapacityEstimate({ document, played = [] }: { document: TournamentDocument; played?: OrganizerPlayedGame[] }) {
  let estimate;
  try { estimate = estimateTournamentCapacity(document, played); }
  catch (error) { if (!(error instanceof Error)) throw error; return <p role="alert">{error.message}</p>; }
  return <div>
    <h3>Capacidad máxima del torneo</h3>
    <div className="adminUserGrid">
      <div className="adminUserCard"><strong>{estimate.teams} {estimate.teams === 1 ? 'equipo' : 'equipos'}</strong><span> · Participantes y cupos definidos</span></div>
      <div className="adminUserCard"><strong>{estimate.normalGames} {estimate.normalGames === 1 ? 'partido' : 'partidos'} ordinarios</strong><span> · Máximo previsto, incluyendo series</span></div>
    </div>
    {estimate.phases.length ? <ul>{estimate.phases.map(phase => <li key={phase.id}>{phase.name}: hasta {phase.games} {phase.games === 1 ? 'partido' : 'partidos'}{phase.tieBreaker ? ' de desempate incluido' : ''}</li>)}</ul> : null}
    <p>{estimate.tieBreakGames} de 3 desempates adicionales previstos. No son partidos ordinarios ni innings extras.</p>
    {estimate.pending.length ? <div role="status"><p>Estimación pendiente de completar:</p><ul>{estimate.pending.map(value => <li key={value}>{value}</li>)}</ul></div> :
      <p>{estimate.freeEligible ? 'Dentro de la capacidad gratuita: 2 a 5 equipos y hasta 13 partidos ordinarios, más hasta 3 desempates adicionales incluidos.' :
        'Esta configuración requiere capacidad adicional por torneo.'}</p>}
    <p>{played.length} {played.length === 1 ? 'partido ya iniciado' : 'partidos ya iniciados'}. Retirar equipos o quitar fases no devuelve capacidad.
      Una anulación autorizada por fuerza mayor descarta la anotación y permite repetir el mismo encuentro sin otro cupo.</p>
    <p>Los grupos, vueltas y fases se reflejan en el total de juegos; no son cobros separados. No se cobra por cantidad de jugadores.
      La capacidad del torneo no cambia el nivel, los cupos ni el precio del Anotador.</p>
  </div>;
}

export default function OrganizerCapacityPanel({ accountId, document, saved, dirty }: {
  accountId: string; document: TournamentDocument; saved: boolean; dirty: boolean;
}) {
  const [snapshot, setSnapshot] = useState<OrganizerCapacitySnapshot | null>(null), [loadingError, setLoadingError] = useState(''),
    [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''),
    [attempt, setAttempt] = useState(0);
  const generation = useRef(0), sending = useRef(false), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = async () => {
      const revision = ++generation.current;
      try {
        const response = await fetch('/api/tournaments/capacity', { credentials: 'include', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo consultar tu capacidad.');
        const next = readOrganizerCapacity(body, accountId);
        if (mounted.current && revision === generation.current) { setSnapshot(next); setLoadingError(''); setNotice(''); }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof Error)) throw error;
        if (mounted.current && revision === generation.current) setLoadingError(error.message);
      }
    };
    void load();
    const timer = globalThis.setInterval(() => { if (!sending.current) void load(); }, 30000);
    const focus = () => { if (!sending.current) void load(); };
    globalThis.addEventListener('focus', focus);
    return () => { mounted.current = false; generation.current++; controller.abort(); globalThis.clearInterval(timer); globalThis.removeEventListener('focus', focus); };
  }, [accountId, attempt]);
  const change = async (tournamentId: string | null) => {
    if (sending.current || !snapshot) return;
    sending.current = true; setBusy(true); setActionError(''); setNotice('');
    const revision = ++generation.current;
    try {
      const response = await fetch('/api/tournaments/free-reservation', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedAccountId: accountId,
          expectedRevision: snapshot.free.revision, requestId: globalThis.crypto.randomUUID(), tournamentId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo modificar la reserva.');
      const next = readOrganizerCapacity(body.capacity, accountId);
      if (mounted.current && revision === generation.current) { setSnapshot(next); setNotice(tournamentId ? 'Reserva guardada, sin consumir la oportunidad.' : 'Reserva liberada, sin consumir la oportunidad.'); }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (mounted.current && revision === generation.current) setActionError(error.message);
    } finally {
      sending.current = false; if (mounted.current && revision === generation.current) setBusy(false);
    }
  };
  const current = snapshot?.tournaments.find(item => item.tournamentId === document.id);
  const selected = snapshot?.free.tournamentId === document.id;
  let eligible = false, eligibilityError = '';
  try { eligible = estimateTournamentCapacity(document, current?.played).freeEligible; }
  catch (error) { if (!(error instanceof Error)) throw error; eligibilityError = error.message; }
  return <section className="managerCard" aria-label="Capacidad y oportunidad gratuita de Organizador">
    <h2>Organizador · Capacidad por torneo</h2>
    <p>Sin niveles ni límite global de torneos. Una sola oportunidad gratuita por organizador: de 2 a 5 equipos y hasta 13 partidos ordinarios,
      más hasta 3 desempates adicionales justificados, con formato flexible.</p>
    {loadingError || actionError ? <p role="alert">{actionError || loadingError}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!snapshot && !loadingError ? <p role="status">Consultando tu oportunidad gratuita…</p> : null}
    {snapshot ? <p><strong>{snapshot.free.consumedAt ? 'Oportunidad gratuita ya consumida.' :
      snapshot.free.tournamentId ? 'Oportunidad reservada, todavía no consumida.' : 'Tu única oportunidad gratuita está disponible.'}</strong>
      {snapshot.free.consumedAt ? ` Inicio del primer partido: ${new Date(snapshot.free.consumedAt).toLocaleString('es-VE')}.` : ''}</p> : null}
    <p>Guardar, publicar, abrir la planilla o preparar alineaciones no consume el beneficio.
      Se consume al iniciar oficialmente el primer partido. Antes puedes cambiar la reserva; después no se recupera al finalizar o cancelar.</p>
    {eligibilityError ? <p role="alert">{eligibilityError}</p> : <OrganizerCapacityEstimate document={document} played={current?.played} />}
    {current?.legacy ? <p>Este torneo anterior conserva su acceso. No se reasigna ni modifica retroactivamente y no utiliza esta reserva.</p> :
      selected ? <p>{snapshot?.free.consumedAt ? 'Este es el torneo que utiliza tu oportunidad gratuita.' : 'La oportunidad está reservada para este torneo.'}</p> :
        snapshot?.free.consumedAt ? <p>Este torneo requiere capacidad adicional; tener otros torneos no vuelve a habilitar el gratuito.</p> : null}
    <div className="managerButtonRow">
      <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Actualizar capacidad</button>
      {snapshot && !snapshot.free.consumedAt && !current?.legacy ? selected ?
        <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => { void change(null); }}>Liberar reserva sin consumir</button> :
        <button type="button" className="managerButtonSolid" disabled={busy || dirty || !saved || !eligible} onClick={() => { void change(document.id); }}>
          {snapshot.free.tournamentId ? 'Cambiar reserva a este torneo' : 'Reservar mi único torneo gratuito'}</button> : null}
      <Link className="managerButtonOutline" href="/account/organizer-capacity/example">Comparar capacidades y reservas</Link>
    </div>
    {!saved || dirty ? <p>Guarda el borrador y completa su capacidad antes de reservar o cambiar la oportunidad.</p> : null}
    <OrganizerCommercialPanel key={document.id} accountId={accountId} document={document} saved={saved} dirty={dirty} current={current}
      onChanged={value => { if (mounted.current) { generation.current++; setSnapshot(value); } }} />
    {current?.restarts?.length ? <details className="managerStepCard"><summary>Constancias de fuerza mayor · {current.restarts.length}</summary>
      <ul>{current.restarts.map(audit => <li key={audit.replacementAttemptId}>{new Date(audit.at).toLocaleString('es-VE')} · {audit.reason}.
        Intento anulado: {audit.cancelledAttemptId}. Reemplazo: {audit.replacementAttemptId}. Sin datos deportivos archivados.</li>)}</ul>
    </details> : null}
    <p>Precios, compras y cobros reales todavía pendientes. Puedes guardar selecciones y ampliaciones; no habilitan partidos por sí solas.
      Solo una cuenta administradora puede autorizar capacidad de prueba por torneo. No hay suscripción mensual ni cargos automáticos.</p>
  </section>;
}
