'use client';

import { useEffect, useRef, useState } from 'react';
import { readScorekeeperSubstitutions, type ScorekeeperSubstitutions } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { accessRequest } from '../../account/access/access-request';

export default function ScorekeeperSubstitutionsPanel({ tournamentId, gameId, status, example }: {
  tournamentId: string; gameId: string; status: string; example?: ScorekeeperSubstitutions;
}) {
  const { account } = usePlatformSession();
  const accountId = example?.accountId ?? account?.id;
  const key = JSON.stringify([accountId, tournamentId, gameId]);
  const current = useRef(key), sending = useRef(false);
  current.current = key;
  const [stored, setStored] = useState<{ key: string; value: ScorekeeperSubstitutions } | null>(example ? { key, value: example } : null);
  const [draft, setDraft] = useState<{ key: string; revision: number; identification: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [retry, setRetry] = useState(0);
  const [loadError, setLoadError] = useState('');
  const state = stored?.key === key ? stored.value : null;
  const fields = draft?.key === key ? draft : null;
  const verified = account?.identity?.status === 'verified';
  useEffect(() => {
    if (example || !accountId || !verified) return;
    let active = true, request = 0;
    const load = async () => {
      const version = ++request;
      try {
        const query = new URLSearchParams({ tournamentId, gameId });
        const value = readScorekeeperSubstitutions(await accessRequest(`/api/sports-sheet/scorekeeper-substitutions?${query}`), accountId, tournamentId, gameId);
        if (active && version === request) { setStored(previous => previous?.key === key && previous.value.revision > value.revision ? previous : { key, value }); setLoadError(''); }
      } catch (failure) {
        if (active && version === request) { setStored(null); setLoadError(failure instanceof Error ? failure.message : 'No se pudieron consultar las suplencias.'); }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [accountId, verified, tournamentId, gameId, key, retry, example]);
  const update = (field: 'identification' | 'reason', value: string) => {
    if (state) setDraft({ key, revision: fields?.revision ?? state.revision, identification: fields?.identification ?? '', reason: fields?.reason ?? '', [field]: value });
  };
  const save = async (substituteActorId?: string) => {
    if (!accountId || !state || example || sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const value = readScorekeeperSubstitutions(await accessRequest('/api/sports-sheet/scorekeeper-substitutions', {
        expectedAccountId: accountId, tournamentId, gameId, expectedRevision: fields?.revision ?? state.revision,
        action: substituteActorId ? 'revoke' : 'grant', reason: fields?.reason ?? '',
        ...(substituteActorId ? { substituteActorId } : { identification: fields?.identification ?? '' }),
      }), accountId, tournamentId, gameId);
      if (current.current === key) { setStored(previous => previous?.key === key && previous.value.revision > value.revision ? previous : { key, value }); setDraft(null);
        setNotice(substituteActorId ? 'Suplencia revocada. Se conservan las anotaciones y su autoría.' :
          'Suplencia gratuita autorizada únicamente para este partido. No consume cupos ni cambia el nivel de la cuenta.'); }
    } catch (failure) { if (current.current === key) setError(failure instanceof Error ? failure.message : 'No se pudo guardar la suplencia.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <details className="managerCard managerStepCard scorekeeperSubstitutions">
    <summary>Suplencia gratuita de Anotador · Este partido</summary>
    <p>Autoriza una cuenta existente por su cédula verificada. Sin pagos ni consumo de cupos; conserva su propio nivel.
      No abre otros partidos, perfiles ni acumulados del torneo. El titular conserva sus consultas y los resultados se integran en el mismo torneo.</p>
    {!verified && !example ? <p role="alert">Verifica tu identidad como organizador para autorizar suplentes.</p> : <>
      {error || loadError ? <p role="alert" className="managerWarning">{error || loadError}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!example ? <button className="managerButtonOutline" disabled={busy} onClick={() => { setDraft(null); setError(''); setNotice(''); setRetry(value => value + 1); }}>
        Actualizar suplencias y descartar borrador</button> : null}
      {!state && !error && !loadError ? <p role="status">Consultando suplencias…</p> : null}
      {state ? <>
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="managerTeamChoices sportsSheetGrid" disabled={busy || Boolean(example)}>
            <label className="managerField"><span>Cédula del suplente</span><input aria-label="Cédula del suplente" autoComplete="off"
              maxLength={20} placeholder="V-12345678" value={fields?.identification ?? ''} onChange={event => update('identification', event.target.value)}
              disabled={!['scheduled', 'in_progress'].includes(status)} /></label>
            <label className="managerField"><span>Motivo de la suplencia o revocación</span><textarea aria-label="Motivo de la suplencia o revocación"
              maxLength={500} required value={fields?.reason ?? ''} onChange={event => update('reason', event.target.value)} /></label>
            <button type="submit" className="managerButtonOutline" disabled={!fields?.identification.trim() || !fields.reason.trim() ||
              !['scheduled', 'in_progress'].includes(status)}>Autorizar suplencia gratuita para este partido</button>
          </fieldset>
        </form>
        {!['scheduled', 'in_progress'].includes(status) ? <p>No se autorizan nuevas suplencias de partidos cerrados, suspendidos o bajo protesta.</p> : null}
        {!state.members.length ? <p>No hay suplentes autorizados para este partido.</p> : state.members.map(member =>
          <article className="adminUserCard" key={member.actorId}><h3>{member.name}</h3>
            <p>{member.status === 'granted' ? 'Suplencia autorizada · Solo este partido' : 'Suplencia revocada'}</p>
            {member.status === 'granted' && !example ? <button className="managerButtonOutline" disabled={busy || !fields?.reason.trim()}
              onClick={() => void save(member.actorId)}>Revocar suplencia de {member.name}</button> : null}
          </article>)}
        <details><summary>Registro de autorizaciones · Revisión {state.revision}</summary>
          <ul>{[...state.audit].reverse().map(entry => <li key={entry.revision}>
            {state.members.find(member => member.actorId === entry.actorId)?.name} · {entry.action === 'grant' ? 'Autorización' : 'Revocación'} · {entry.reason} · {new Date(entry.at).toLocaleString('es-VE')}
          </li>)}</ul></details>
        <details><summary>Autoría de anotaciones desde la primera suplencia</summary>
          <p>Las correcciones y los movimientos deshechos conservan su autoría. No se inventan registros de acciones anteriores a la primera autorización.</p>
          {!state.movements?.length ? <p>No hay movimientos registrados desde la autorización.</p> : <ul>{[...state.movements].reverse().map(movement =>
            <li key={movement.version}>{state.members.find(member => member.actorId === movement.actorId)?.name ??
              `${movement.role === 'organizer' ? 'Organizador' : 'Anotador autorizado'} (${movement.actorId})`} · Versión {movement.version} · {movement.action} · {new Date(movement.at).toLocaleString('es-VE')}</li>)}</ul>}
        </details>
      </> : null}
    </>}
  </details>;
}
