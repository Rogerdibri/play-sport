'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { membershipDurations, readOwnAccountAccess, roleValidityAllowsOperation, type OwnAccountAccess, type RoleValidity } from '@playsport/shared';
import { accessRequest } from './access-request';

const names = { player: 'Jugador', manager: 'Manager', scorekeeper: 'Anotador' };
const statusNames = { permanent: 'Básico gratuito permanente', not_activated: 'Pendiente de activación',
  active: 'Seis meses gratuitos vigentes', expired: 'Acceso operativo vencido', plan: 'Acceso temporal vigente' };
export function RoleValidityNotice({ validity }: { validity?: RoleValidity }) {
  if (!validity) return null;
  const remaining = validity.expiresAt ? Date.parse(validity.expiresAt) - Date.parse(validity.now) : null;
  return <div className="roleValidityNotice">
    <p><strong>{names[validity.role]} · {statusNames[validity.status]}</strong>
      {validity.expiresAt ? ` · Hasta ${new Date(validity.expiresAt).toLocaleString('es-VE')}` : ''}</p>
    {remaining !== null && remaining > 0 && remaining <= 30 * 86400000 ?
      <p role="status" className="managerWarning">Tu acceso vence en los próximos 30 días. Revisa su vigencia antes de iniciar nuevos partidos.</p> : null}
    {!roleValidityAllowsOperation(validity) ? <p>Conservas tu cuenta, datos y consultas básicas.
      <Link href="/account/access"> Activar o renovar en Mis planes.</Link> Los partidos ya iniciados antes del vencimiento pueden terminarse; la suplencia autorizada sigue siendo gratuita.</p> : null}
  </div>;
}
export default function RoleValidityPanel({ snapshot, verified, onActivated, example = false }: {
  snapshot: OwnAccountAccess; verified: boolean; onActivated?: (_value: OwnAccountAccess) => void; example?: boolean; // eslint-disable-line no-unused-vars
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), sending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const activate = async (role: 'manager' | 'scorekeeper') => {
    if (example || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const next = readOwnAccountAccess(await accessRequest('/api/accounts/activate-role', { expectedAccountId: snapshot.accountId, role }), snapshot.accountId);
      if (alive.current) onActivated?.(next);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'No se pudo activar el rol.'); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  return <section className="managerCard managerStepCard roleValidityPanel">
    <h2>Vigencia de mis roles</h2>
    <p>Jugador básico permanece gratuito. Manager y Anotador tienen seis meses gratuitos desde la activación de cada rol, una sola vez por cuenta.
      Crear la cuenta, consultar una pantalla o cambiar de rol no inicia ni reinicia ese plazo.</p>
    {error ? <p role="alert" className="managerWarning">{error}</p> : null}
    <div className="adminUserGrid">{snapshot.roles?.map(validity => <article className="adminUserCard" key={validity.role}>
      <h3>{names[validity.role]}</h3><RoleValidityNotice validity={validity} />
      {validity.activatedAt ? <p>Activado: {new Date(validity.activatedAt).toLocaleString('es-VE')}<br />
        Fin de gratuidad: {validity.freeExpiresAt ? new Date(validity.freeExpiresAt).toLocaleString('es-VE') : ''}</p> : null}
      {validity.role !== 'player' && !validity.activatedAt ? <button className="managerButtonOutline" disabled={busy || !verified || example}
        onClick={() => void activate(validity.role as 'manager' | 'scorekeeper')}>Activar {names[validity.role]} · 6 meses gratuitos</button> : null}
    </article>)}</div>
    {!verified && !example ? <p>Verifica tu identidad en Mi cuenta antes de activar Manager o Anotador.</p> : null}
    <p>La duración no cambia funciones ni cupos. Las vigencias previstas son {membershipDurations.map(duration => duration.name.toLowerCase()).join(', ')}.
      Después de la gratuidad puede mantenerse el nivel 1, sin obligación de subir a los niveles 2 o 3.</p>
    <p>Precios, pagos y renovaciones automáticas todavía deshabilitados. La administración solo concede pruebas temporales, sin cobros.
      Activar o vencer un plan no borra resultados ni asigna permisos sobre equipos o partidos ajenos.</p>
  </section>;
}
