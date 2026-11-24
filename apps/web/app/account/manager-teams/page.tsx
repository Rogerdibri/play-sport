'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { managerTeamKey, readManagerTeamAccess, type ManagerTeamAccess } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { accessRequest } from '../access/access-request';
import { RoleValidityNotice } from '../access/role-validity-panel';

export default function ManagerTeamsPage() {
  const { account, ready } = usePlatformSession();
  const [snapshot, setSnapshot] = useState<ManagerTeamAccess | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const pending = useRef(false);
  const requests = useRef(0);
  const dirty = useRef(false);
  const currentAccount = useRef(account?.id);
  currentAccount.current = account?.id;
  const [attempt, setAttempt] = useState(0);
  const accountId = account?.id;
  useEffect(() => {
    let active = true;
    setSnapshot(null); setError(''); setNotice(''); dirty.current = false;
    if (!accountId) return;
    const load = async () => {
      const request = ++requests.current;
      try {
        const value = readManagerTeamAccess(await accessRequest('/api/sports-sheet/manager-teams'), accountId);
        if (active && request === requests.current && !pending.current) {
          if (dirty.current) {
            setSnapshot(previous => previous ? { ...value, revision: previous.revision } : value);
            setNotice('Tienes una selección sin guardar. Se conserva tu borrador; al guardar se comprobará la revisión del servidor.');
          } else {
            setSnapshot(value); setSelected(value.teams.filter(team => team.managed).map(managerTeamKey)); setError('');
          }
        }
      } catch (failure) {
        if (active && request === requests.current && !pending.current) {
          setError(failure instanceof Error ? failure.message : 'No se pudieron recuperar tus equipos.');
        }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [accountId, attempt]);
  const save = async () => {
    if (!snapshot || !account || pending.current) return;
    ++requests.current;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = readManagerTeamAccess(await accessRequest('/api/sports-sheet/manager-teams', {
        expectedAccountId: account.id, expectedRevision: snapshot.revision, selected,
      }), account.id);
      if (currentAccount.current !== account.id) return;
      dirty.current = false; setSnapshot(value); setSelected(value.teams.filter(team => team.managed).map(managerTeamKey));
      setNotice('Cupos guardados. Ninguna inscripción, alineación o estadística fue eliminada.');
    } catch (failure) {
      if (currentAccount.current === account.id) setError(failure instanceof Error ? failure.message : 'No se pudieron guardar tus cupos.');
    }
    finally {
      ++requests.current; pending.current = false; setBusy(false);
      if (currentAccount.current !== account.id) setAttempt(value => value + 1);
    }
  };
  if (!ready) return <p role="status">Consultando tu cuenta…</p>;
  if (!account) return <section className="managerCard"><h1>Mis cupos de Manager</h1><Link href="/account">Iniciar sesión</Link></section>;
  return <main className="moduleView administrationPage managerTeamAccess">
    <header className="moduleHeader"><h1>Mis cupos de Manager</h1><p>Elige qué inscripciones administrar. No retira equipos del torneo ni borra su historia.</p>
      <Link href="/account/access" className="managerButtonOutline">Consultar mis planes</Link></header>
    {error ? <p role="alert" className="managerWarning">{error}</p> : null}
    {error ? <button type="button" className="managerButtonOutline" disabled={busy}
      onClick={() => setAttempt(value => value + 1)}>Actualizar cupos y descartar selección sin guardar</button> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <RoleValidityNotice validity={snapshot?.operational} />
    {!snapshot && !error ? <p role="status">Consultando tus inscripciones…</p> : null}
    {snapshot ? <section className="managerCard managerStepCard"><h2>Nivel {snapshot.level} · {snapshot.limit === null ? 'Inscripciones ilimitadas' :
      `${snapshot.limit} ${snapshot.limit === 1 ? 'cupo activo' : 'cupos activos'}`}</h2>
      {snapshot.selectionRequired ? <p role="alert" className="managerWarning">{snapshot.limit === null ?
        'Elige las inscripciones que deseas administrar, sin límite de cupos.' :
        `Elige hasta ${snapshot.limit} inscripciones para continuar administrando. Las demás quedan para consulta.`}</p> : null}
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="managerTeamChoices" disabled={busy}>
          {snapshot.teams.map(team => <label className="managerTeamChoice" key={managerTeamKey(team)}>
            <input type="checkbox" checked={selected.includes(managerTeamKey(team))} disabled={!team.active && !selected.includes(managerTeamKey(team)) ||
              snapshot.limit !== null && !selected.includes(managerTeamKey(team)) && selected.length >= snapshot.limit}
              onChange={event => { dirty.current = true; setSelected(previous => event.target.checked ? [...previous, managerTeamKey(team)] :
                previous.filter(key => key !== managerTeamKey(team))); setNotice(''); }} />
            <span>{team.teamName} · {team.tournamentName} · {team.active ? team.managed ? 'Gestión activa' : 'Disponible para elegir' : 'Histórico · No consume cupo'}
          </span></label>)}
          {!snapshot.teams.length ? <p>No tienes inscripciones asignadas a tu identidad verificada.</p> : null}
          <button type="submit" className="managerButtonOutline" disabled={!snapshot.teams.some(team => team.active)}>
            {busy ? 'Guardando…' : 'Guardar equipos activos'}</button>
        </fieldset>
      </form>
      <p>Una inscripción en cada torneo cuenta por separado. Al finalizar o cancelar el torneo deja de consumir cupo.</p>
    </section> : null}
  </main>;
}
