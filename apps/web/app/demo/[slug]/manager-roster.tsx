'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  RosterClient, isCalendarDate, isPreRegistrationDraft, isRosterRole, newPreRegistration, normalizeProfileIdentification,
  registrationAge, rosterRoleLabels, rosterGroups, rosterGroup, type ManagerRoster as RosterSnapshot, type ManagerRosterTeam, type RosterPerson, type RosterRole
} from '@playsport/shared';
import { managerWorkContext } from '../../platform-navigation';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { isTextDraft } from '../../navigation-drafts';
import BirthDateInput from '../../birth-date-input';
import { InstitutionName } from '../../institutional-logos';
import { EditableInstitutionName } from '../../institution-logo-editor';
import { useManagerTeamAccess } from '../../account/manager-teams/use-manager-team-access';

const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación del roster.';
const api = (process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring').replace(/\/official-scoring\/?$/, '');
export default function ManagerRoster() {
  const { session, ready, account } = usePlatformSession();
  if (!ready) return <p role="status">Consultando el perfil del manager…</p>;
  if (session?.role !== 'manager') return <section className="managerCard">
    <p role="alert">ROSTER corresponde al perfil Manager.</p><Link href="/">Volver a mi inicio</Link>
  </section>;
  const context = managerWorkContext(session);
  return <RosterTeams key={JSON.stringify(context)} {...context} accountId={context.managerId.startsWith('person:') ? account?.id : undefined} />;
}

export function RosterTeams({ managerId, teamId, tournamentId, accountId }: { managerId: string; teamId: string; tournamentId: string; accountId?: string }) {
  const client = useMemo(() => new RosterClient(managerId.startsWith('person:') ? '/api/sporting' : api, managerId), [managerId]);
  const [teams, setTeams] = useState<ManagerRosterTeam[] | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const { access, error: accessError } = useManagerTeamAccess(accountId);
  const readOnly = managerId.startsWith('person:') && (!accountId || access?.operational &&
    !['active', 'plan'].includes(access.operational.status) ||
    !access?.teams.some(team => team.teamId === teamId && team.tournamentId === tournamentId && team.managed));
  useEffect(() => {
    let active = true;
    setError(''); setTeams(null);
    void client.teams().then(value => { if (active) setTeams(value); }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [client, attempt]);
  const selected = teams?.find(team => team.teamId === teamId && team.tournamentId === tournamentId);
  return <section className="rosterWorkspace">
    <header className="rosterHeader"><div><p className="eyebrow">MI EQUIPO · PLANTILLA</p><h1>ROSTER</h1>
      {selected ? <><h2>{readOnly ? <InstitutionName id={selected.teamId}>{selected.teamName}</InstitutionName> :
        <EditableInstitutionName id={selected.teamId}>{selected.teamName}</EditableInstitutionName>}</h2><p><InstitutionName kind="tournament" id={selected.tournamentId}>{selected.tournamentName}</InstitutionName></p></> : null}</div>
      <Link className="managerButtonOutline" href="/">Inicio del manager</Link>
      <Link className="managerButtonOutline" href="/account/manager-teams">Mis cupos de Manager</Link>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {accessError ? <p role="alert">{accessError}</p> : null}
    {readOnly ? <p role="status">Solo consulta. Revisa la vigencia en <Link href="/account/access">Mis planes</Link> y
      activa esta inscripción en Mis cupos de Manager para administrarla.</p> : null}
    {!teams && !error ? <p role="status">Consultando tus equipos…</p> : null}
    {error ? <button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button> : null}
    {teams && !selected && !error ? <p role="alert">El equipo elegido al entrar no está asignado a este manager en este torneo. Vuelve al inicio para revisar tu equipo.</p> : null}
    {selected ? <RosterEditor key={JSON.stringify([selected.tournamentId, selected.teamId])} client={client} team={selected} readOnly={readOnly} /> : null}
  </section>;
}

export function RosterEditor({ client, team, onBusy, readOnly = false }: { client: RosterClient; team: ManagerRosterTeam; readOnly?: boolean; onBusy?: (_busy: boolean) => void }) { // eslint-disable-line no-unused-vars
  const scope = `roster:${team.managerId}:${team.tournamentId}:${team.teamId}`;
  const [query, setQuery] = useNavigationDraft(`${scope}:query`, '', isTextDraft);
  const [role, setRole] = useNavigationDraft<RosterRole>(`${scope}:role`, 'PLAYER', isRosterRole);
  const [draft, setDraft] = useNavigationDraft(`${scope}:preinscription`, newPreRegistration(), isPreRegistrationDraft);
  const [roster, setRoster] = useState<RosterSnapshot | null>(null);
  const [person, setPerson] = useState<RosterPerson | null>(null);
  const [missing, setMissing] = useNavigationDraft(`${scope}:missing`, false, (value: unknown): value is boolean => typeof value === 'boolean');
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  const [invitation, setInvitation] = useState('');
  const [refreshError, setRefreshError] = useState('');
  useNavigationBusy(working);
  useEffect(() => { onBusy?.(working); return () => onBusy?.(false); }, [working, onBusy]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.load(team).then(value => { if (active) setRoster(value); }).catch(failure => { if (active) setError(message(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, team, attempt]);
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (working) return;
      void client.load(team).then(value => { if (active) { setRoster(value); setRefreshError(''); } })
        .catch(failure => { if (active) setRefreshError(message(failure)); });
    }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [client, team, working]);
  const perform = async (action: () => Promise<void>) => {
    if (readOnly) { setError('Esta inscripción está disponible solo para consulta. Revisa tus cupos de Manager.'); return; }
    setWorking(true); setError(''); setNotice('');
    try { await action(); } catch (failure) { setError(message(failure)); } finally { setWorking(false); }
  };
  const reset = () => { setPerson(null); setMissing(false); setQuery(''); setDraft(newPreRegistration()); };
  const minor = isCalendarDate(draft.birthDate) && draft.birthDate <= new Date().toISOString().slice(0, 10) && registrationAge(draft.birthDate) < 18;
  const capacity = roster?.admission?.groups[rosterGroup(role)];
  const full = capacity?.limit !== null && capacity?.limit !== undefined && capacity.used >= capacity.limit;
  const admissionBlocked = roster?.admission?.closed || full;
  return <>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {refreshError ? <p className="managerWarning" role="alert">No se pudo actualizar el cierre: {refreshError}</p> : null}
    {notice ? <p className="rosterNotice" role="status">{notice}</p> : null}
    <article className="managerCard rosterSheet">
      <header className="rosterSectionHeading"><div><h2>Plantilla del equipo</h2><p>{roster?.members.length ?? 0} integrantes · No es el lineup de un partido</p></div>
        <div className="rosterActions">{!readOnly ? <a className="managerButtonSolid" href="#roster-incorporation">Incorporar persona</a> : null}
          <button type="button" disabled={working || loading} className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Actualizar roster</button></div>
      </header>
      {loading ? <p role="status">Consultando el roster…</p> : null}
      {roster ? <div className="rosterTableWrap"><table className="rosterTable">
        <caption>Integrantes del roster · <InstitutionName id={team.teamId}>{team.teamName}</InstitutionName></caption>
        <thead><tr><th scope="col">Nombre y apellido</th><th scope="col">Cédula / ID</th><th scope="col">Cargo</th><th scope="col">Registro personal</th><th scope="col">Incorporación</th></tr></thead>
        {rosterGroups.map(group => {
          const members = roster.members.filter(row => group.roles.some(role => role === row.role));
          return <tbody key={group.title} aria-label={group.title}>
            <tr className="rosterGroup"><th scope="rowgroup" colSpan={5}>{group.title}<span>{members.length}{roster.admission?.groups[group.id].limit !== null && roster.admission?.groups[group.id].limit !== undefined ? ` / ${roster.admission.groups[group.id].limit}` : ''}</span></th></tr>
            {members.map(row => <tr key={row.person.id}>
              <td><strong>{row.person.fullName}</strong></td><td className="rosterIdentity">{row.person.identification || row.person.id}</td><td>{rosterRoleLabels[row.role]}</td>
              <td><span className="rosterBadge" data-pending={row.person.registrationStatus === 'preinscribed'}>
                {row.person.registrationStatus === 'preinscribed' ? 'Preinscrito · Pendiente de confirmación' : row.person.registrationStatus === 'registered' ? 'Registrado' : 'Registro deportivo existente'}
              </span>{row.canInvite ? <button type="button" className="rosterInvite" disabled={readOnly || working || loading} onClick={() => { void perform(async () => {
                setInvitation(await client.invite(team, row.person.id));
                setNotice(`Invitación privada para ${row.person.fullName}. Compártela solo con la persona o su representante; no se envió ningún mensaje.`);
              }); }} aria-label={`Generar invitación privada · ${row.person.fullName}`}>Invitación privada</button> : null}</td>
              <td><span className="rosterBadge">{row.addedBy === 'manager' ? 'Incorporado por el manager' : 'En el roster'}</span></td>
            </tr>)}
            {!members.length ? <tr><td className="rosterEmpty" colSpan={5}>Sin integrantes en esta sección.</td></tr> : null}
          </tbody>;
        })}
      </table></div> : null}
      {invitation ? <div className="rosterInvitation"><label className="managerField"><span>Invitación privada de preinscripción</span><input readOnly value={invitation} /></label>
        <p>Caduca en siete días. Se introduce en Mi perfil o, para menores, en Mis hijos o representados.</p></div> : null}
    </article>
    <article className="managerCard rosterIncorporation" id="roster-incorporation" tabIndex={-1}>
      <h2>Incorporar una persona</h2>
      {roster?.admission ? <p role="status">{roster.admission.closed ? 'INCORPORACIONES CERRADAS. ' : 'Incorporaciones abiertas. '}{roster.admission.reason}</p> : null}
      <p>El manager incorpora directamente dentro de los cupos. No requiere aprobación individual del organizador.</p>
      <p>Busca su cédula. Si ya existe, solo elige el cargo.</p>
      <form onSubmit={event => { event.preventDefault(); void perform(async () => {
        const found = await client.lookup(team, query); setPerson(found); setMissing(!found);
        if (!found) setDraft({ ...newPreRegistration(), identification: normalizeProfileIdentification(query) });
      }); }}>
        <fieldset className="profileFields rosterSearch" disabled={readOnly || working || loading || !roster}>
          <label className="managerField"><span>Cédula o ID de la persona</span><input required maxLength={120} value={query} onChange={event => {
            setQuery(event.target.value); setPerson(null); setMissing(false); setNotice('');
          }} placeholder="V-12345678, E-12345678 o ID" /></label>
          <button type="submit" className="managerButtonOutline">Buscar en el ecosistema</button>
          <button type="button" className="managerButtonOutline" onClick={() => {
            setPerson(null); setMissing(true); setDraft(newPreRegistration()); setQuery(''); setNotice('');
          }}>Preinscribir menor sin cédula</button>
        </fieldset>
      </form>
      {person || missing ? <form onSubmit={event => { event.preventDefault(); void perform(async () => {
        if (person) {
          setRoster(await client.add(team, role, person.id)); reset(); setNotice('Persona existente incorporada directamente al roster.');
        } else {
          setRoster(await client.preinscribe(team, role, draft)); reset();
          setNotice('Persona incorporada al roster. La preinscripción quedó guardada en el ecosistema, pendiente solo de confirmación personal.');
        }
      }); }}>
        <fieldset className="profileFields" disabled={readOnly || working || loading || !roster}>
          {person ? <p><strong>{person.fullName}</strong> · {person.registrationStatus === 'preinscribed' ? 'Preinscrito: pendiente de confirmación' : 'Registro existente'} · {person.identification || person.id}</p> : <>
            <h3>Preinscripción mínima</h3>
            <p>Se guardará en el ecosistema, pendiente de confirmación. Para menores, usa el contacto del representante.</p>
            <div className="profileFieldGrid">
              <label className="managerField"><span>Cédula de la preinscripción</span><input required={!minor} maxLength={20} value={draft.identification}
                onChange={event => setDraft({ ...draft, identification: event.target.value })} placeholder="Vacía solo si es menor sin cédula" /></label>
              <label className="managerField"><span>Nombre y apellido</span><input required maxLength={120} value={draft.fullName} onChange={event => setDraft({ ...draft, fullName: event.target.value })} /></label>
              <BirthDateInput label="Fecha de nacimiento de la persona" value={draft.birthDate} onChange={birthDate => setDraft({ ...draft, birthDate })} />
              <label className="managerField"><span>{minor ? 'Correo del representante' : 'Correo de contacto'}</span><input type="email" required={!draft.phone.trim()} maxLength={254} value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /></label>
              <label className="managerField"><span>{minor ? 'Teléfono del representante' : 'Teléfono de contacto'}</span><input type="tel" required={!draft.email.trim()} maxLength={30} value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} /></label>
              {minor ? <label className="managerField"><span>Cédula del representante</span><input required maxLength={20} value={draft.representativeIdentification}
                onChange={event => setDraft({ ...draft, representativeIdentification: event.target.value })} /></label> : null}
            </div>
            <p>Al menos un contacto válido: correo o teléfono. El nacimiento y los contactos no se publican en el roster.</p>
          </>}
          <label className="managerField"><span>Cargo en el equipo</span><select value={role} onChange={event => { if (isRosterRole(event.target.value)) setRole(event.target.value); }}>
            {Object.entries(rosterRoleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          {full ? <p role="status">Este grupo agotó su cupo. Puedes seleccionar otro cargo de un grupo con disponibilidad.</p> : null}
          <button type="submit" disabled={Boolean(admissionBlocked)} className="managerButtonSolid">{person ? 'Añadir al roster' : 'Guardar preinscripción y añadir al roster'}</button>
        </fieldset>
      </form> : null}
    </article>
    <details className="rosterHelp"><summary>Registro, incorporación y privacidad</summary>
      <p>El perfil declarado no verifica identidad, contacto ni tutela. Nacimiento y contactos no se publican en el roster.</p>
      <p>La incorporación al roster es directa; la confirmación de datos personales se realiza desde Mi perfil o el registro del representante. No se modifica ningún lineup.</p>
      <p>Todos son jugadores en el roster. Titulares, suplentes y posiciones defensivas se determinan exclusivamente en el lineup de cada partido.</p>
      <p>El cargo no concede permisos de cuenta. Los cargos admitidos y la categoría dependen del reglamento y de la fecha de corte del torneo.</p>
    </details>
  </>;
}
