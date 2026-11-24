'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { readOfficialGames, readScorekeeperAccess, type OfficialGameSummary } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { accessRequest } from '../access/access-request';
import { useScorekeeperAccess } from './use-scorekeeper-access';
import { RoleValidityNotice } from '../access/role-validity-panel';

export default function ScorekeeperTournamentsPage() {
  const { account, ready } = usePlatformSession();
  const { access, error: loadError, refresh } = useScorekeeperAccess(account?.id);
  const [draft, setDraft] = useState<{ accountId: string; revision: number; selected: string[] } | null>(null);
  const [games, setGames] = useState<OfficialGameSummary[]>([]);
  const [gamesError, setGamesError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const current = useRef(account?.id), sending = useRef(false);
  current.current = account?.id;
  const actorId = account?.identity?.actorId;
  const substitutionScope = JSON.stringify(access?.substitutions?.map(item => [item.tournamentId, item.gameId]) ?? []);
  useEffect(() => {
    setGames([]); setDraft(null); setError(''); setNotice('');
  }, [account?.id, actorId]);
  useEffect(() => {
    let active = true, request = 0;
    setGamesError('');
    if (!account?.id || !actorId) return;
    const load = async () => {
      const version = ++request;
      try {
        const value = await accessRequest('/api/sports-sheet/scorekeeper-games');
        if (!value || typeof value !== 'object' || !('accountId' in value) || value.accountId !== account.id)
          throw new Error('Los partidos no corresponden a tu cuenta.');
        const next = readOfficialGames(value, actorId, 'scorekeeper', false);
        if (active && version === request) { setGames(next.games); setGamesError(''); }
      } catch (failure) {
        if (active && version === request) { setGames([]); setGamesError(failure instanceof Error ? failure.message : 'No se pudieron recuperar los partidos.'); }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [account?.id, actorId, substitutionScope]);
  const selected = draft && draft.accountId === account?.id ? draft.selected : access?.tournaments.filter(team => team.active && team.enabled).map(team => team.tournamentId) ?? [];
  const perform = async (operation: 'selection' | 'extra', game?: OfficialGameSummary) => {
    if (!account || !access || sending.current) return;
    const id = account.id;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (operation === 'selection') {
        readScorekeeperAccess(await accessRequest('/api/sports-sheet/scorekeeper-tournaments', {
          expectedAccountId: id, expectedRevision: draft?.accountId === id ? draft.revision : access.revision, selected,
        }), id);
      } else if (game) {
        await accessRequest('/api/sports-sheet/scorekeeper-extra', { expectedAccountId: id, tournamentId: game.tournamentId,
          gameId: game.gameId, expectedRevision: access.extras.find(extra => extra.tournamentId === game.tournamentId && extra.gameId === game.gameId)?.revision ?? 0 });
      }
      if (current.current === id) {
        setDraft(null); refresh();
        setNotice(operation === 'selection' ? 'Cupos guardados. Los datos deportivos se conservan.' :
          'Solicitud registrada, pendiente de autorización. No se realizó ningún cobro ni se habilitó el partido todavía.');
      }
    } catch (failure) { if (current.current === id) setError(failure instanceof Error ? failure.message : 'No se pudo completar la solicitud.'); }
    finally { sending.current = false; setBusy(false); }
  };
  if (!ready) return <p role="status">Comprobando tu cuenta…</p>;
  if (!account) return <main className="moduleView"><section className="managerCard"><h1>Mis cupos de Anotador</h1><Link href="/account">Iniciar sesión</Link></section></main>;
  return <main className="moduleView administrationPage scorekeeperAccess">
    <header className="moduleHeader"><h1>Mis cupos de Anotador</h1>
      <p>Un cupo corresponde a un torneo, no a una liga. Elegir cupos nunca asigna partidos ni borra resultados.</p>
      <div className="managerButtonRow"><Link href="/account/access" className="managerButtonOutline">Mis planes</Link>
        <Link href="/sports-sheet/scorekeeper" className="managerButtonOutline">Box score y torneos</Link></div></header>
    {loadError || error || gamesError ? <p role="alert" className="managerWarning">{loadError || error || gamesError}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <RoleValidityNotice validity={access?.operational} />
    <button className="managerButtonOutline" disabled={busy} onClick={() => { setDraft(null); refresh(); }}>Actualizar cupos y descartar borrador</button>
    {access ? <section className="managerCard managerStepCard"><h2>Nivel {access.level} · {access.limit === null ? 'Torneos ilimitados' : `${access.limit} ${access.limit === 1 ? 'torneo' : 'torneos'}`}</h2>
      {access.selectionRequired ? <p role="alert">Selecciona tus torneos para continuar anotando.</p> : null}
      {draft ? <p role="status">Hay una selección sin guardar; los refrescos no descartan tu borrador. El servidor comprobará su revisión.</p> : null}
      <form onSubmit={event => { event.preventDefault(); void perform('selection'); }}><fieldset className="managerTeamChoices" disabled={busy}>
        {access.tournaments.map(team => <label className="managerTeamChoice" key={team.tournamentId}>
          <input type="checkbox" checked={team.active ? selected.includes(team.tournamentId) : team.enabled}
            disabled={!team.active || access.limit !== null && !selected.includes(team.tournamentId) && selected.length >= access.limit}
            onChange={event => setDraft({ accountId: account.id, revision: draft?.accountId === account.id ? draft.revision : access.revision,
              selected: event.target.checked ? [...selected, team.tournamentId] : selected.filter(id => id !== team.tournamentId) })} />
          <span>{team.tournamentName} · {team.active ? team.enabled ? 'Habilitado' : 'Disponible para elegir' : 'Cerrado · Solo consulta'}</span>
        </label>)}
        {!access.tournaments.length ? <p>No tienes torneos asignados por un organizador.</p> : null}
        <button className="managerButtonOutline" type="submit" disabled={!access.tournaments.some(team => team.active)}>Guardar torneos</button>
      </fieldset></form>
      <p>Al bajar de nivel se conservan los datos y debes ajustar la selección si excede el cupo. Los torneos cerrados seleccionados conservan su consulta y no consumen cupos activos.</p>
    </section> : !loadError ? <p role="status">Consultando tus torneos…</p> : null}
    {access ? <section className="managerCard managerStepCard"><h2>Mis suplencias gratuitas</h2>
      <p>Autorizadas por el organizador para partidos específicos. No consumen cupos, no tienen pagos y mantienen los permisos de tu propio nivel.</p>
      {!access.substitutions?.length ? <p>No tienes suplencias activas.</p> : access.substitutions.map(item => {
        const game = games.find(game => game.gameId === item.gameId && game.tournamentId === item.tournamentId);
        return <article className="adminUserCard" key={JSON.stringify([item.tournamentId, item.gameId])}><h3>{item.tournamentName}</h3>
          <p>{game?.details ? `${game.details.awayTeamName} vs. ${game.details.homeTeamName} · ${game.details.date} · ${game.details.time}` : 'Partido autorizado por el organizador'}</p>
          <Link href="/demo/live-scoring?view=scorekeeper" className="managerButtonOutline">Ver mis partidos asignados</Link></article>;
      })}</section> : null}
    {access ? <section className="managerCard managerStepCard"><h2>Acceso puntual fuera de tus cupos</h2>
      <p>Solo un partido asignado. Conservas tus torneos, sin abrir el torneo adicional ni sus acumulados.
        Pagos todavía no habilitados: solicitar no cobra ni concede acceso. Una autorización administrativa de prueba se registra por separado.</p>
      {games.filter(game => !access.tournaments.some(team => team.tournamentId === game.tournamentId && team.enabled) &&
        !access.substitutions?.some(item => item.tournamentId === game.tournamentId && item.gameId === game.gameId) &&
        actorId && game.assignedScorekeeperIds.includes(actorId)).map(game => {
        const extra = access.extras.find(extra => extra.tournamentId === game.tournamentId && extra.gameId === game.gameId);
        return <article className="adminUserCard" key={game.gameId}><h3>{game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}</h3>
          <p>{game.details?.tournamentName ?? game.tournamentId}</p>
          <p>{game.details?.date ?? 'Sin fecha'} · {game.details?.time ?? 'Sin hora'}{game.details?.venue ? ` · ${game.details.venue}` : ''}</p>
          <p>{extra?.status === 'granted' ? 'Acceso autorizado únicamente a este partido' : extra?.status === 'requested' ? 'Solicitud pendiente, sin acceso' :
            extra?.status === 'revoked' ? 'Acceso revocado' : 'Sin acceso puntual'}</p>
          <button className="managerButtonOutline" disabled={busy || extra?.status === 'requested' || extra?.status === 'granted'}
            onClick={() => void perform('extra', game)}>Solicitar acceso puntual sin cobro</button>
        </article>;
      })}
    </section> : null}
  </main>;
}
