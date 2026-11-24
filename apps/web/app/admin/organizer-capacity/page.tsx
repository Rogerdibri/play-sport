'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { organizerPlanCapacity, readOrganizerPlanAccess, type OrganizerPlanAccess } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy } from '../../navigation-hooks';

export default function OrganizerCapacityAdministration() {
  const { account, ready } = usePlatformSession();
  const [tournamentId, setTournamentId] = useState(''), [plan, setPlan] = useState<OrganizerPlanAccess | null>(null);
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const currentAccountId = useRef(account?.id); currentAccountId.current = account?.id;
  useEffect(() => { setPlan(null); setReason(''); setError(''); setNotice(''); }, [account?.id]);
  useNavigationBusy(busy);
  const load = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice(''); setPlan(null);
    const requester = account?.id;
    try {
      const response = await fetch(`/api/tournaments/admin-capacity?${new URLSearchParams({ tournamentId })}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo consultar la capacidad.');
      if (body.tournamentId !== tournamentId || typeof body.accountId !== 'string') throw new Error('La capacidad recibida pertenece a otro torneo.');
      if (body.closed) throw new Error('El torneo está cerrado; no se reabre la contratación.');
      if (!body.plan) throw new Error('El organizador debe guardar primero su selección de paquete o personalizado.');
      const value = readOrganizerPlanAccess(body.plan, body.accountId, tournamentId);
      if (currentAccountId.current === requester) setPlan(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo consultar el plan.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const change = async (action: 'authorize-test' | 'revoke-test') => {
    if (!account || !plan || sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/tournaments/plan-authorization', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedAdminId: account.id,
          tournamentId: plan.tournamentId, expectedRevision: plan.revision, requestId: crypto.randomUUID(), action, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo autorizar la capacidad.');
      const value = readOrganizerPlanAccess(body.plan, plan.accountId, plan.tournamentId);
      if (currentAccountId.current === account.id) {
        setPlan(value);
        setNotice(action === 'authorize-test' ? 'Capacidad de prueba autorizada solo para este torneo. No hubo compra ni cobro.' : 'Autorización de prueba revocada.');
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo modificar la autorización.'); }
    finally { sending.current = false; setBusy(false); }
  };
  if (!ready) return <main className="moduleView"><p role="status">Comprobando administración…</p></main>;
  if (!account?.administrationAccess) return <main className="moduleView"><p role="alert">Esta sección requiere una cuenta administradora autorizada.</p></main>;
  return <main className="moduleView administrationPage organizerCapacityExample">
    <header className="moduleHeader"><h1>Capacidad de Organizador · Pruebas por torneo</h1>
      <p>Autorizaciones auditadas de prueba, sin precios ni cobros. No son planes personales ni permisos para torneos ajenos.</p></header>
    <section className="managerCard">
      <label className="managerField"><span>ID del torneo</span><input value={tournamentId} disabled={busy} onChange={event => { setTournamentId(event.target.value); setPlan(null); }} /></label>
      <button className="managerButtonOutline" disabled={busy || !tournamentId.trim()} onClick={() => { void load(); }}>Consultar selección del torneo</button>
      {plan ? <>
        <p>{organizerPlanCapacity(plan.selection).name} · {plan.teamCapacity} equipos / {plan.gameCapacity} partidos ·
          {plan.status === 'authorized-test' ? ' Prueba autorizada' : plan.status === 'revoked-test' ? ' Prueba revocada' : ' Pendiente de habilitación'} · Revisión {plan.revision}</p>
        <label className="managerField"><span>Motivo de la autorización administrativa</span><textarea maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <div className="managerButtonRow"><button className="managerButtonOutline" disabled={busy || !reason.trim()} onClick={() => { void change('authorize-test'); }}>Autorizar capacidad de prueba</button>
          <button className="managerButtonOutline" disabled={busy || !reason.trim()} onClick={() => { void change('revoke-test'); }}>Revocar capacidad de prueba</button></div>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
    </section>
    <Link href="/admin" className="managerButtonOutline">Volver a Administración</Link>
  </main>;
}
