'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accessFeatureLabels, isTrialPlanId, membershipDurations, readAccountTrial, readAdministrationSnapshot, readTrialChange, trialPlans, trialStatus,
  type AccountProfile, type AdministrationSnapshot, type TrialChange, type TrialPlanId } from '@playsport/shared';
import { IdentityReview } from '../account/person-identity';
import { AccessRequestError, accessRequest } from '../account/access/access-request';
import { useNavigationBusy } from '../navigation-hooks';
import PlayerPlanLevels from '../account/access/player-plan-levels';
import ManagerPlanLevels from '../account/access/manager-plan-levels';
import ScorekeeperPlanLevels from '../account/access/scorekeeper-plan-levels';
import ScorekeeperExtras from './scorekeeper-extras';
import DraftPrices from './draft-prices';

const statusLabels = { active: 'Vigente', expired: 'Vencido', revoked: 'Revocado' };
export default function AdministrationDashboard({ account, example }: { account: AccountProfile; example?: AdministrationSnapshot }) {
  const [tab, setTab] = useState<'users' | 'plans' | 'prices' | 'audit' | 'identity'>('users');
  const [snapshot, setSnapshot] = useState<AdministrationSnapshot | null>(example ?? null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0), [auditPage, setAuditPage] = useState(0);
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(!example), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null), [planId, setPlanId] = useState<TrialPlanId>('player');
  const [expires, setExpires] = useState(''), [reason, setReason] = useState(''), [pending, setPending] = useState<TrialChange | null>(null);
  const [duration, setDuration] = useState('custom');
  const sending = useRef(false), formRef = useRef<globalThis.HTMLElement | null>(null);
  useNavigationBusy(busy);
  useEffect(() => {
    if (example) return;
    let active = true, generation = 0;
    const load = async () => {
      const request = ++generation; setLoading(true);
      try {
        const params = new URLSearchParams({ q: query, page: String(page), auditPage: String(auditPage) });
        const value = readAdministrationSnapshot(await accessRequest(`/api/accounts/administration?${params}`), account.id);
        if (active && generation === request) { setSnapshot(value); setLoadError(''); }
      } catch (failure) {
        if (active && generation === request) { setSnapshot(null); setLoadError(failure instanceof Error ? failure.message : 'No se pudo consultar la administración.'); }
      } finally { if (active && generation === request) setLoading(false); }
    };
    void load();
    globalThis.addEventListener('focus', load);
    return () => { active = false; globalThis.removeEventListener('focus', load); };
  }, [account.id, query, page, auditPage, attempt, example]);
  useEffect(() => { if (selectedId) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selectedId]);
  const user = snapshot?.users.find(value => value.id === selectedId);
  const trial = user?.trials.find(value => value.planId === planId);
  const select = (id: string) => {
    setSelectedId(id); setExpires(''); setDuration('custom'); setReason(''); setNotice(''); setError(''); setPending(null);
  };
  const send = async (command: TrialChange) => {
    if (example) { setError('La vista de ejemplo es de solo lectura.'); return; }
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice(''); setPending(command);
    try {
      const response = await accessRequest('/api/accounts/administration', command);
      if (!response || typeof response !== 'object' || !('trial' in response)) throw new Error('No se recibió una confirmación válida. Reintenta la misma solicitud.');
      const confirmed = readAccountTrial(response.trial);
      if (confirmed.planId !== command.planId || confirmed.revision !== command.expectedRevision + 1) throw new Error('La confirmación no corresponde al cambio solicitado. Reintenta la misma solicitud.');
      setPending(null); setSelectedId(null); setReason(''); setExpires(''); setAttempt(value => value + 1);
      setNotice(command.action === 'grant' ? 'Acceso activado con vencimiento. No se concedieron roles deportivos ni se realizó un cobro.' : 'Prueba revocada. Los datos deportivos se conservan.');
    } catch (failure) {
      if (failure instanceof AccessRequestError && failure.status < 500) { setPending(null); setAttempt(value => value + 1); }
      setError(failure instanceof Error ? failure.message : 'No se pudo confirmar el acceso. Reintenta la misma solicitud.');
    } finally { sending.current = false; setBusy(false); }
  };
  const change = (action: 'grant' | 'revoke', event?: FormEvent) => {
    event?.preventDefault();
    if (!user || pending) return;
    try {
      const command = readTrialChange({ requestId: globalThis.crypto.randomUUID(), expectedAdminId: account.id,
        accountId: user.id, planId, expectedRevision: trial?.revision ?? 0, action, reason,
        ...(action === 'grant' ? duration === 'custom' ? { expiresAt: new Date(expires).toISOString() } : { months: Number(duration) } : {}) });
      void send(command);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Completa los datos de la prueba.'); }
  };
  const navigationBlocked = busy || pending !== null;
  return <main className="moduleView administrationPage">
    <header className="moduleHeader"><p className="eyebrow">ADMINISTRACIÓN PRIVADA</p>
      <h1>{example ? 'Administración · ejemplo de solo lectura' : 'Administración de PlaySport'}</h1>
      <p>Usuarios y accesos de prueba gratuitos. Sin cobros, sin cambios en resultados y sin permisos deportivos automáticos.</p>
      <div className="managerButtonRow"><Link href="/account" className="managerButtonOutline">Mi cuenta</Link>
        {!example ? <Link href="/admin/organizer-capacity" className="managerButtonOutline">Capacidad de prueba por torneo</Link> : null}
        {!example ? <Link href="/admin/example" className="managerButtonOutline">Ver ejemplo separado</Link> : <Link href="/admin" className="managerButtonOutline">Ir al panel privado</Link>}</div>
    </header>
    <nav className="managerButtonRow adminTabs" aria-label="Administración">
      {([['users', 'Usuarios y pruebas'], ['plans', 'Planes y funciones'], ...(!example ? [['prices', 'Precios']] as const : []), ['audit', 'Auditoría'], ['identity', 'Identidades']] as const).map(([id, label]) =>
        <button type="button" key={id} disabled={navigationBlocked} aria-pressed={tab === id}
          className={tab === id ? 'managerButtonSolid' : 'managerButtonOutline'} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {loadError ? <p className="managerWarning" role="alert">{loadError}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
    {pending ? <section className="managerCard"><h2>Confirmación pendiente</h2>
      <p>No cambies los datos ni crees otra solicitud. Reintentar recupera la misma operación sin duplicarla.</p>
      <button className="managerButtonSolid" disabled={busy} onClick={() => void send(pending)}>Reintentar misma solicitud</button></section> : null}
    {!example ? <button className="managerButtonOutline" disabled={navigationBlocked || loading} onClick={() => setAttempt(value => value + 1)}>
      {loading ? 'Actualizando…' : 'Actualizar panel'}</button> : null}
    {tab === 'prices' && !example ? <DraftPrices accountId={account.id} /> : null}
    {tab === 'users' ? <>
      <section className="managerCard managerStepCard"><h2>Usuarios registrados</h2>
        <form className="adminSearch" onSubmit={event => { event.preventDefault(); setPage(0); setQuery(search); setSelectedId(null); }}>
          <label className="managerField"><span>Buscar por nombre o correo</span>
            <input value={search} maxLength={100} disabled={navigationBlocked || Boolean(example)} onChange={event => setSearch(event.target.value)} /></label>
          <button className="managerButtonOutline" disabled={navigationBlocked || Boolean(example)}>Buscar</button>
        </form>
        {loading && !snapshot ? <p role="status">Consultando usuarios…</p> : null}
        {snapshot ? <><p>{snapshot.total} cuentas encontradas.</p>
          <div className="adminUserGrid">{snapshot.users.map(value => <article className="adminUserCard" key={value.id}>
            <h3>{value.displayName}</h3><p>{value.email}</p>
            <p>Identidad {value.identityVerified ? 'verificada' : 'sin verificar'}.</p>
            {!value.trials.length ? <p>Sin pruebas asignadas.</p> : <ul>{value.trials.map(item => <li key={item.planId}>
              <strong>{trialPlans.find(plan => plan.id === item.planId)?.name}:</strong> {statusLabels[trialStatus(item, Date.parse(snapshot.now))]}
              {' · '}{new Date(item.expiresAt).toLocaleString('es-VE')}
            </li>)}</ul>}
            <button className="managerButtonOutline" disabled={navigationBlocked} onClick={() => select(value.id)}>Gestionar accesos de {value.displayName}</button>
          </article>)}</div>
          {!snapshot.users.length ? <p>No hay cuentas que coincidan con la búsqueda.</p> : null}
          {!example ? <div className="managerButtonRow"><button className="managerButtonOutline" disabled={navigationBlocked || page === 0}
            onClick={() => { setSelectedId(null); setPage(value => value - 1); }}>Usuarios anteriores</button>
            <span>Página {snapshot.page + 1}</span><button className="managerButtonOutline" disabled={navigationBlocked || (page + 1) * 25 >= snapshot.total}
              onClick={() => { setSelectedId(null); setPage(value => value + 1); }}>Más usuarios</button></div> : null}
        </> : null}
      </section>
      {user ? <section className="managerCard managerStepCard" ref={formRef} aria-label="Gestionar acceso de prueba">
        <h2>Accesos de {user.displayName}</h2>
        <form onSubmit={event => change('grant', event)}><fieldset className="adminTrialFields" disabled={navigationBlocked}>
          <label className="managerField"><span>Plan de prueba</span><select value={planId} onChange={event => {
            if (isTrialPlanId(event.target.value)) { setPlanId(event.target.value); setExpires(''); setDuration('custom'); }
          }}>{trialPlans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
          <p>{trial && snapshot ? `Estado: ${statusLabels[trialStatus(trial, Date.parse(snapshot.now))]} · Revisión ${trial.revision}` : 'Sin prueba previa para este plan.'}</p>
          {planId !== 'organizer' ? <label className="managerField"><span>Duración de la prueba</span>
            <select aria-label="Duración de la prueba" value={duration} onChange={event => setDuration(event.target.value)}>
              <option value="custom">Vencimiento personalizado</option>
              {membershipDurations.map(value => <option key={value.months} value={value.months}>{value.name} · {value.months} {value.months === 1 ? 'mes' : 'meses'}</option>)}
            </select></label> : null}
          {duration === 'custom' ? <label className="managerField"><span>Vencimiento en tu hora local</span>
            <input type="datetime-local" required value={expires} onChange={event => setExpires(event.target.value)} /></label> : null}
          {duration !== 'custom' ? <p>El servidor calcula meses calendario. Ampliar una prueba vigente suma tiempo desde su vencimiento, sin perder los días restantes.</p> : null}
          <label className="managerField"><span>Motivo del cambio</span>
            <textarea required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <p>La prueba habilita funciones, no cargos. No aprueba identidades ni asigna equipos o partidos.</p>
          <div className="managerButtonRow"><button className="managerButtonSolid" type="submit" disabled={Boolean(example)} aria-busy={busy}>Activar o ampliar prueba</button>
            <button className="managerButtonOutline" type="button" disabled={Boolean(example) || !trial?.active || !reason.trim()}
              onClick={() => change('revoke')}>Revocar prueba</button>
            <button className="managerButtonOutline" type="button" onClick={() => setSelectedId(null)}>Cancelar</button></div>
        </fieldset></form>
      </section> : null}
    </> : null}
    {tab === 'plans' ? <><PlayerPlanLevels /><ManagerPlanLevels /><ScorekeeperPlanLevels />
      {!example ? <ScorekeeperExtras key={account.id} accountId={account.id} /> : null}
      <section className="managerCard managerStepCard"><h2>Catálogo inicial del piloto</h2>
      <p>Estos planes no tienen precios publicados ni renovación automática. Su catálogo es fijo en esta primera entrega; las pruebas se administran por cuenta.</p>
      <div className="adminUserGrid">{trialPlans.map(plan => <article className="adminUserCard" key={plan.id}><h3>{plan.name}</h3>
        {plan.features.length ? <ul>{plan.features.map(feature => <li key={feature}>{accessFeatureLabels[feature]}</li>)}</ul> :
          <p>Continuidad del nivel 1 operativo, sin estadísticas premium ni ampliación de cupos.</p>}</article>)}</div>
      <p>Jugador básico no requiere activar una prueba. Si están vigentes los niveles 2 y 3, se aplica el mayor; al vencer o revocar el nivel 3, se conserva el nivel 2 si sigue vigente.</p>
      <p>Los niveles de Manager y Anotador controlan sus propios cupos. No habilitan dinero, apuestas o privilegios administrativos.</p>
      <p>Las pruebas personales de Organizador son para consultas deportivas. No amplían cupos de torneo:
        sus paquetes y ampliaciones requieren autorización de capacidad por torneo en el apartado correspondiente.</p>
    </section></> : null}
    {tab === 'audit' ? <section className="managerCard managerStepCard"><h2>Auditoría de accesos</h2>
      {snapshot ? <><p>{snapshot.auditTotal} cambios confirmados.</p>
        <div className="adminUserGrid">{snapshot.audit.map(event => <article className="adminUserCard" key={event.id}>
          <h3>{event.action === 'grant' ? 'Activación o ampliación' : 'Revocación'} · {trialPlans.find(plan => plan.id === event.planId)?.name}</h3>
          <p><strong>Usuario:</strong> {event.targetName}</p><p><strong>Administrador:</strong> {event.actorName}</p>
          <p><strong>Fecha:</strong> {new Date(event.at).toLocaleString('es-VE')}</p><p><strong>Motivo:</strong> {event.reason}</p>
          <p><strong>Vencimiento anterior:</strong> {event.previousExpiresAt ? new Date(event.previousExpiresAt).toLocaleString('es-VE') : 'Sin prueba previa'}</p>
          <p><strong>Vencimiento registrado:</strong> {new Date(event.expiresAt).toLocaleString('es-VE')}</p>
        </article>)}</div>
        {!snapshot.audit.length ? <p>Todavía no hay cambios de acceso confirmados.</p> : null}
        {!example ? <div className="managerButtonRow"><button className="managerButtonOutline" disabled={navigationBlocked || auditPage === 0}
          onClick={() => setAuditPage(value => value - 1)}>Auditoría anterior</button><span>Página {snapshot.auditPage + 1}</span>
          <button className="managerButtonOutline" disabled={navigationBlocked || (auditPage + 1) * 25 >= snapshot.auditTotal}
            onClick={() => setAuditPage(value => value + 1)}>Más auditoría</button></div> : null}
      </> : <p>Actualiza el panel para recuperar la auditoría.</p>}
    </section> : null}
    {tab === 'identity' ? <section className="managerCard managerStepCard"><h2>Verificación de identidades</h2>
      {!example && account.identityReviewer ? <IdentityReview key={account.id} accountId={account.id} /> :
        <p>La consulta de documentos requiere autorización separada como revisor de identidad. No se conceden estos permisos mediante una suscripción.</p>}
    </section> : null}
  </main>;
}
