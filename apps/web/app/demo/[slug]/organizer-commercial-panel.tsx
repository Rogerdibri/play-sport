'use client';

import { useEffect, useRef, useState, type Dispatch } from 'react';
import { organizerPackages, organizerPlanQuote, readOrganizerCapacity, readOrganizerPlanSelection,
  type OrganizerCapacitySnapshot, type OrganizerPlanAccess, type OrganizerPlanSelection, type OrganizerPlayedGame, type TournamentDocument } from '@playsport/shared';
import { useNavigationBusy } from '../../navigation-hooks';
import { usePlatformSession } from '../../platform-session';

export function OrganizerPackageCatalog() {
  return <div className="adminUserGrid organizerPackageGrid">{organizerPackages.map(plan => <article className="adminUserCard" key={plan.id}>
    <h3>{plan.name}</h3><p>Hasta {plan.teams} equipos · {plan.games} partidos ordinarios.</p>
    <p>Hasta 3 desempates adicionales incluidos. Vigente hasta cerrar este torneo.</p>
  </article>)}</div>;
}
export function OrganizerPlanEstimate({ document, selection, previous, played = [] }: { document: TournamentDocument;
  selection: OrganizerPlanSelection; previous?: OrganizerPlanAccess | null; played?: OrganizerPlayedGame[] }) {
  const quote = organizerPlanQuote(document, selection, previous, played);
  return <div>
    <p><strong>{quote.capacity.name}:</strong> {quote.capacity.teams} equipos y {quote.capacity.games} partidos ordinarios.</p>
    <p>{quote.activationUnits ? 'Una activación por este torneo' : 'Sin repetir la activación'} · {quote.additionalGames} partidos por contratar o ampliar.</p>
    <p>{quote.fits ? 'La planificación cabe en esta capacidad.' : 'La planificación no cabe o está pendiente de completar.'}</p>
    <p>Fórmula: activación única + capacidad de partidos. Equipos, grupos y fases recalculan el volumen, sin cargos separados.
      Monto pendiente de definir: no es cero ni una compra confirmada.</p>
  </div>;
}
export default function OrganizerCommercialPanel({ accountId, document, saved, dirty, current, onChanged }: {
  accountId: string; document: TournamentDocument; saved: boolean; dirty: boolean;
  current?: OrganizerCapacitySnapshot['tournaments'][number]; onChanged: Dispatch<OrganizerCapacitySnapshot>;
}) {
  const [planId, setPlanId] = useState('small'), [teams, setTeams] = useState('8'), [games, setGames] = useState('40');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  useNavigationBusy(busy);
  const mounted = useRef(false), sending = useRef(false), applied = useRef(-1);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!current || applied.current === current.planRevision) return;
    applied.current = current.planRevision ?? 0;
    if (current.plan) {
      setPlanId(current.plan.selection.planId);
      setTeams(String(current.plan.teamCapacity)); setGames(String(current.plan.gameCapacity));
    }
  }, [current]);
  let selection: OrganizerPlanSelection | null = null, validation = '', fits = false;
  try {
    selection = readOrganizerPlanSelection({ planId, teams: planId === 'custom' ? Number(teams) : null, games: planId === 'custom' ? Number(games) : null });
    fits = organizerPlanQuote(document, selection, current?.plan, current?.played).fits;
  } catch (failure) { if (!(failure instanceof Error)) throw failure; validation = failure.message; }
  const save = async (value: OrganizerPlanSelection | null) => {
    if (sending.current || !current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/tournaments/plan-selection', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedAccountId: accountId,
          tournamentId: document.id, expectedRevision: current.planRevision ?? 0, requestId: crypto.randomUUID(), selection: value }) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo guardar la selección del plan.');
      const snapshot = readOrganizerCapacity(body.capacity, accountId);
      if (mounted.current) { onChanged(snapshot); setNotice(value ? 'Selección guardada. No se realizó ninguna compra ni cobro.' : 'Selección retirada. Tu oportunidad gratuita no cambió.'); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo guardar el plan.'); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <details className="managerStepCard">
    <summary>Paquetes, personalizado y ampliaciones</summary>
    <p>Puedes elegir un torneo pago desde el principio y guardar tu oportunidad gratuita para otro.
      Contratación por torneo, sin mensualidad ni traslado a otra edición. Precios y cobros deshabilitados.</p>
    <label className="managerField"><span>Identificador del torneo para autorización administrativa</span><input readOnly value={document.id} /></label>
    <OrganizerPackageCatalog />
    <fieldset className="privateControls profileFieldGrid" disabled={busy || document.status === 'finished' || document.status === 'cancelled'}>
      <label className="managerField"><span>Plan de este torneo</span><select value={planId} onChange={event => setPlanId(event.target.value)}>
        {organizerPackages.map(plan => <option key={plan.id} value={plan.id}>{plan.name} · {plan.teams} equipos / {plan.games} partidos</option>)}
        <option value="custom">Personalizado</option>
      </select></label>
      {planId === 'custom' ? <>
        <label className="managerField"><span>Equipos del personalizado</span><input type="number" min={2} step={1} value={teams} onChange={event => setTeams(event.target.value)} /></label>
        <label className="managerField"><span>Partidos ordinarios del personalizado</span><input type="number" min={1} step={1} value={games} onChange={event => setGames(event.target.value)} /></label>
      </> : null}
    </fieldset>
    {selection ? <OrganizerPlanEstimate document={document} selection={selection} previous={current?.plan} played={current?.played} /> : <p role="alert">{validation}</p>}
    {current?.plan ? <p><strong>Estado:</strong> {document.status === 'finished' || document.status === 'cancelled' ? 'Contratación cerrada; solo consulta.' :
      current.plan.status === 'authorized-test' ? 'Capacidad autorizada de prueba, no una compra.' :
      current.plan.status === 'revoked-test' ? 'Autorización de prueba revocada.' : 'Selección pendiente de precios y habilitación.'}</p> : null}
    <div className="managerButtonRow">
      <button type="button" className="managerButtonOutline" disabled={busy || dirty || !saved || !current || current.legacy || !selection || !fits ||
        document.status === 'finished' || document.status === 'cancelled'}
        onClick={() => { void save(selection); }}>Guardar selección del plan</button>
      {current?.plan ? <button type="button" className="managerButtonOutline" disabled={busy || document.status === 'finished' || document.status === 'cancelled'}
        onClick={() => { void save(null); }}>Quitar selección de pago</button> : null}
    </div>
    <p>Guardar una selección no habilita partidos. Mientras no exista checkout, solo una cuenta administradora puede autorizar capacidad de prueba de este torneo.</p>
    {error ? <p role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}
  </details>;
}

export function OrganizerCommercialExample({ document }: { document: TournamentDocument }) {
  const { ready } = usePlatformSession();
  const [planId, setPlanId] = useState('small'), [teams, setTeams] = useState('8'), [games, setGames] = useState('40');
  let selection: OrganizerPlanSelection | null = null, error = '';
  try { selection = readOrganizerPlanSelection({ planId, teams: planId === 'custom' ? Number(teams) : null, games: planId === 'custom' ? Number(games) : null }); }
  catch (failure) { if (!(failure instanceof Error)) throw failure; error = failure.message; }
  return <details className="managerCard managerStepCard"><summary>Comparar paquetes y personalizado</summary>
    <OrganizerPackageCatalog />
    <fieldset className="privateControls profileFieldGrid" disabled={!ready}>
      <label className="managerField"><span>Paquete a comparar</span><select value={planId} onChange={event => setPlanId(event.target.value)}>
        {organizerPackages.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}<option value="custom">Personalizado</option>
      </select></label>
      {planId === 'custom' ? <>
        <label className="managerField"><span>Equipos del ejemplo personalizado</span><input type="number" min={2} value={teams} onChange={event => setTeams(event.target.value)} /></label>
        <label className="managerField"><span>Partidos del ejemplo personalizado</span><input type="number" min={1} value={games} onChange={event => setGames(event.target.value)} /></label>
      </> : null}
    </fieldset>
    {selection ? <OrganizerPlanEstimate document={document} selection={selection} /> : <p role="alert">{error}</p>}
    <p>Desempates: hasta 3 adicionales incluidos, también para el gratuito por encima de sus 13 partidos ordinarios.</p>
    <p>Fuerza mayor: el organizador puede anular un partido en curso o suspendido con motivo obligatorio.
      Se descarta su anotación completa y se repite desde cero, sin otro cupo ni cobro; solo queda la constancia administrativa.</p>
  </details>;
}
