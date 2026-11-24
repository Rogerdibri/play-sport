'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RosterRulesClient, rosterGroups, rosterRulesDraft, rulesFromDraft, type RosterRulesView } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy } from '../../navigation-hooks';
import { officialAccountActor } from '../../platform-navigation';
import { EditableInstitutionName } from '../../institution-logo-editor';

const api = process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring';
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudieron actualizar las reglas del roster.';

export default function OrganizerRosterRules() {
  const { session, ready, account } = usePlatformSession();
  if (!ready) return <p role="status">Consultando el perfil del organizador…</p>;
  if (session?.role !== 'organizer') return <p role="alert">Este panel corresponde al organizador propietario del torneo.</p>;
  const actor = officialAccountActor(account, 'organizer');
  if (!actor) return <p role="alert">Verifica tu identidad en <Link href="/account">Mi cuenta</Link> para administrar tus torneos.</p>;
  return <OrganizerRulesPanel key={actor} organizerId={actor} />;
}

export function OrganizerRulesPanel({ organizerId }: { organizerId: string }) {
  const client = useMemo(() => new RosterRulesClient(api, organizerId), [organizerId]);
  const [tournaments, setTournaments] = useState<{ tournamentId: string; tournamentName: string }[] | null>(null);
  const [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void client.tournaments().then(value => { if (active) setTournaments(value); }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [client, attempt]);
  return <section className="rosterWorkspace organizerRosterWorkspace">
    <header className="rosterHeader"><div><p className="eyebrow">CENTRO DEL ORGANIZADOR</p><h1>Reglas del roster</h1>
      <p>Cupos por equipo y un único cierre simultáneo para todo el torneo.</p></div></header>
    <article className="managerCard">
      <p>Crea y administra las fases, equipos, calendario y reglamento desde Crear torneo. Aquí conservas los cupos y el cierre simultáneo de incorporaciones de tus torneos, incluso sin partidos.</p>
      <nav className="organizerShortcuts" aria-label="Herramientas del organizador">
        <Link className="managerButtonOutline" href="/demo/tournaments">Crear y administrar torneos</Link>
        <Link className="managerButtonOutline" href="/demo/live-scoring?view=organizer">Abrir herramientas oficiales de partidos</Link>
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      {!tournaments && !error ? <p role="status">Consultando tus torneos…</p> : null}
      {error ? <button className="managerButtonOutline" type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button> : null}
      {tournaments?.length === 0 ? <p>No tienes torneos configurados en esta API.</p> : null}
      {tournaments?.length ? <label className="managerField"><span>Torneo que deseas configurar</span><select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Selecciona tu torneo</option>{tournaments.map(row => <option key={row.tournamentId} value={row.tournamentId}>{row.tournamentName}</option>)}
      </select></label> : null}
    </article>
    {selected ? <><h2><EditableInstitutionName kind="tournament" id={selected}>{tournaments?.find(row=>row.tournamentId===selected)?.tournamentName ?? selected}</EditableInstitutionName></h2><RulesEditor key={selected} client={client} tournamentId={selected} /></> : null}
  </section>;
}

export function RulesEditor({ client, tournamentId }: { client: RosterRulesClient; tournamentId: string }) {
  const [view, setView] = useState<RosterRulesView | null>(null);
  const [draft, setDraft] = useState(() => rosterRulesDraft(null));
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(true), [reopen, setReopen] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  useNavigationBusy(working);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.load(tournamentId).then(value => { if (active) { setView(value); setDraft(rosterRulesDraft(value.rules)); setReopen(false); } })
      .catch(failure => { if (active) setError(message(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, tournamentId, attempt]);
  const save = async () => {
    if (!view) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const value = await client.save(tournamentId, rulesFromDraft(draft), view.revision, reopen);
      setView(value); setDraft(rosterRulesDraft(value.rules)); setReopen(false);
      setNotice('Reglas guardadas para todos los equipos. No se modificó ningún partido ni lineup.');
    } catch (failure) { setError(message(failure)); } finally { setWorking(false); }
  };
  return <article className="managerCard">
    <div className="organizerRulesToolbar">
      <h2>Reglamento de incorporaciones</h2>
      <button type="button" className="managerButtonOutline" disabled={working || loading}
        title="Recargar reglas y descartar cambios sin guardar"
        aria-label="Recargar reglas y descartar cambios sin guardar"
        onClick={() => { setNotice(''); setAttempt(value => value + 1); }}>Recargar reglas</button>
    </div>
    {loading ? <p role="status">Consultando reglas…</p> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {view ? <><p role="status">{view.closed ? 'INCORPORACIONES CERRADAS. ' : 'Incorporaciones abiertas. '}{view.reason}</p>
      <p>Revisión {view.revision}. Los límites incluyen a las personas preinscritas; no se eliminará a nadie para reducir un cupo.</p></> : null}
    {view ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="profileFields" disabled={working || loading}>
        <legend>Cupos de personas por equipo</legend>
        <div className="profileFieldGrid">{rosterGroups.map(group => <label className="managerField" key={group.id}><span>{group.title}</span>
          <input type="number" min="0" step="1" required value={draft.caps[group.id]} onChange={event => setDraft({ ...draft, caps: { ...draft.caps, [group.id]: event.target.value } })} />
        </label>)}</div>
        <label className="managerField"><span>Una sola modalidad de cierre</span><select value={draft.kind} onChange={event => {
          const kind = event.target.value; if (kind === 'date' || kind === 'round' || kind === 'games') setDraft({ ...draft, kind });
        }}><option value="date">Fecha tope</option><option value="round">Jornada / ronda tope</option><option value="games">Cantidad de juegos finalizados</option></select></label>
        {draft.kind === 'date' ? <label className="managerField"><span>Último día para incorporar (Venezuela, UTC−4)</span><input type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label> : null}
        {draft.kind === 'games' ? <>
          <label className="managerField"><span>Cantidad de juegos finalizados tope</span><input type="number" required min="1" step="1" value={draft.games} onChange={event => setDraft({ ...draft, games: event.target.value })} /></label>
          <label className="managerField"><span>Cómo se calcula el cierre para todos</span><select value={draft.count} onChange={event => {
            const count = event.target.value; if (count === 'tournament' || count === 'first-team' || count === 'all-teams') setDraft({ ...draft, count });
          }}><option value="tournament">Total de partidos finalizados del torneo</option><option value="first-team">Cuando el primer equipo llegue al tope</option><option value="all-teams">Cuando todos los equipos lleguen al tope</option></select></label>
          <p>Solo cuentan juegos finalizados. Suspendidos y bajo protesta no cuentan como finalizados.</p>
        </> : null}
        {draft.kind === 'round' ? <>
          <label className="managerField"><span>Jornada / ronda tope</span><input type="number" required min="1" step="1" value={draft.round} onChange={event => setDraft({ ...draft, round: event.target.value })} /></label>
          <label className="managerField"><span>Momento del cierre para todos</span><select value={draft.moment} onChange={event => {
            const moment = event.target.value; if (moment === 'start' || moment === 'finish') setDraft({ ...draft, moment });
          }}><option value="start">Al comenzar la ronda tope</option><option value="finish">Al finalizar todos los partidos hasta la ronda tope</option></select></label>
          <p>Asigna ronda a cada partido. Si falta alguna, las incorporaciones quedan bloqueadas hasta completar la asignación. Una ronda posterior iniciada también cierra el plazo de una ronda anterior.</p>
          {view.games.map(game => <label key={game.gameId} className="managerField"><span>Ronda · {game.label} · {game.gameId}</span>
            <input type="number" min="1" step="1" required value={draft.rounds[game.gameId] ?? ''} onChange={event => setDraft({ ...draft, rounds: { ...draft.rounds, [game.gameId]: event.target.value } })} />
          </label>)}
          {!view.games.length ? <p>No hay partidos configurados todavía. Cuando se incorporen, deberás asignarles ronda en este panel.</p> : null}
        </> : null}
        {view.closed ? <label className="organizerReopen"><input type="checkbox" checked={reopen} onChange={event => setReopen(event.target.checked)} /><span>Reabrir explícitamente para todos con estas nuevas reglas</span></label> : null}
        <p>El cierre queda guardado. Deshacer resultados o reprogramar no reabre el roster. Una reapertura solo funciona si el nuevo tope todavía no se alcanzó.</p>
        <div className="organizerSaveActions"><button className="managerButtonSolid" type="submit">Guardar reglas del roster</button></div>
      </fieldset>
    </form> : null}
  </article>;
}
