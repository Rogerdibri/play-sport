'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { InstitutionName, ExampleTeamName } from '../../institutional-logos';
import { useRouter } from 'next/navigation';
import { activeAssignedGame, currentAssignedGame, assignedGameExamples, assignedGameSections, calendarDateLabel, officialGameStatusLabels, preservesStartedGame, readOfficialGames,
  type AssignedGameExample, type OfficialGameSummary, type OfficialGamesSnapshot } from '@playsport/shared';
import type { ScorekeeperAccess } from '@playsport/shared';
import { useScorekeeperAccess } from '../../account/scorekeeper-tournaments/use-scorekeeper-access';
import { isTextDraft } from '../../navigation-drafts';
import { useNavigationBusy, useNavigationDraft, useScreenBack } from '../../navigation-hooks';
import OfficialGameWorkspace from './official-game-workspace';
import CalendarGameDetails from './calendar-game-details';
import OfficialResult from './official-result';
import LiveScoringManagerDemo from './live-scoring-manager-demo';
import OfficialGameDetails from './official-game-details';
import { usePlatformSession } from '../../platform-session';
import { officialAccountActor } from '../../platform-navigation';

const apiBase = process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring';
export function AccountOfficialInbox(props: Omit<Parameters<typeof TeamSheetInbox>[0], 'officialActorId'>) {
  const { account, ready } = usePlatformSession();
  const actor = officialAccountActor(account, props.view === 'organizer' ? 'organizer' : 'scorekeeper');
  const scorer = useScorekeeperAccess(props.view === 'scorekeeper' && actor?.startsWith('person:') ? account?.id : undefined);
  if (!ready) return <p role="status">Comprobando tu cuenta y asignaciones…</p>;
  if (!actor) return <p role="alert">Verifica tu identidad en <Link href="/account">Mi cuenta</Link> para acceder a tus partidos oficiales.</p>;
  return <TeamSheetInbox key={`${account?.id ?? 'demo'}:${actor}`} {...props} officialActorId={actor}
    scorekeeperAccess={scorer.access} scorekeeperError={scorer.error} />;
}
export default function TeamSheetInbox({ view, liveEntry = false, managerId, managerTeam, officialActorId, managementAllowed = true, managementError, scorekeeperAccess, scorekeeperError }: {
  view: 'organizer' | 'scorekeeper' | 'manager'; liveEntry?: boolean; managerId?: string; managerTeam?: { teamId: string; tournamentId: string }; officialActorId?: string;
  managementAllowed?: boolean;
  managementError?: string;
  scorekeeperAccess?: ScorekeeperAccess | null; scorekeeperError?: string;
}) {
  const router = useRouter();
  const singleLive = liveEntry && view === 'scorekeeper';
  const assignedHref = '/demo/live-scoring?view=scorekeeper';
  const userId = view === 'manager' ? managerId ?? '' : officialActorId ?? (view === 'organizer' ? 'org-demo' : 'scorer-demo');
  const scorerAllowed = (game: OfficialGameSummary) => !(game.organizerCapacityBlocked && game.status !== 'final') && (view !== 'scorekeeper' || !userId.startsWith('person:') ||
    Boolean((game.status === 'final' || game.canOperate !== false) && (game.status === 'in_progress' && game.canOperate === true ||
      scorekeeperAccess?.tournaments.some(team => team.tournamentId === game.tournamentId && team.enabled) ||
      scorekeeperAccess?.substitutions?.some(item => item.tournamentId === game.tournamentId && item.gameId === game.gameId) ||
      scorekeeperAccess?.extras.some(extra => extra.tournamentId === game.tournamentId && extra.gameId === game.gameId && extra.status === 'granted'))));
  const [catalog, setCatalog] = useState<OfficialGamesSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  const [lastGameId, setLastGameId, draftReady] = useNavigationDraft(
    view === 'manager' ? `official-active-game:${view}:${userId}:${managerTeam?.tournamentId}:${managerTeam?.teamId}` : `official-active-game:${view}:${userId}`, '', isTextDraft);
  const [entryHandled, setEntryHandled] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`${apiBase}/games?${new URLSearchParams({ userId, role: view })}`, { credentials: 'include', signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudieron consultar tus partidos.');
        const next = readOfficialGames(body, userId, view);
        if (view === 'manager') {
          if (!managerTeam) throw new Error('Selecciona tu equipo desde el inicio del manager.');
          next.games = next.games.filter(game => game.managerTeamId === managerTeam.teamId && game.tournamentId === managerTeam.tournamentId);
        }
        if (active && request === revision) { setCatalog(next); setError(''); }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar tus partidos.'); }
    };
    void load();
    const interval = globalThis.setInterval(() => { if (!globalThis.document.hidden) void load(); }, 5000);
    return () => { active = false; controller.abort(); globalThis.clearInterval(interval); };
  }, [userId, view, retry, managerTeam?.teamId, managerTeam?.tournamentId]);
  const openGame = (game: OfficialGameSummary) => {
    if (game.status !== 'final') setLastGameId(game.gameId);
    setSelectedId(game.gameId);
    setNotice('');
  };
  useEffect(() => {
    if (view !== 'manager' || !catalog || error || !draftReady || entryHandled) return;
    const gameId = new URLSearchParams(globalThis.location.search).get('game');
    if (!gameId) return;
    setEntryHandled(true);
    const game = catalog.games.find(item => item.gameId === gameId);
    if (!game) {
      setNotice('El partido del enlace no está asignado al equipo y torneo con los que estás trabajando.');
      return;
    }
    setSelectedId(game.gameId);
    if (game.status !== 'final') setLastGameId(game.gameId);
  }, [view, catalog, error, draftReady, entryHandled, setLastGameId]);
  useEffect(() => {
    if (singleLive || !liveEntry || entryHandled || !catalog || error || !draftReady) return;
    setEntryHandled(true);
    const game = activeAssignedGame(catalog.games, lastGameId);
    if (game) setSelectedId(game.gameId);
    else setNotice('No hay un único partido activo para abrir. Selecciona uno de tus partidos asignados.');
  }, [singleLive, liveEntry, entryHandled, catalog, error, draftReady, lastGameId]);
  const current = singleLive && catalog && !error ? currentAssignedGame(catalog.games) : null;
  const currentGame = current?.game;
  const selected = singleLive ? currentGame && (currentGame.status === 'in_progress' || currentGame.gameId === selectedId) ? currentGame : undefined :
    !error ? catalog?.games.find(game => game.gameId === selectedId) : undefined;
  const backToGames = () => {
    if (singleLive) router.push(assignedHref);
    else { setSelectedId(null); setSelectedExample(null); }
  };
  useScreenBack(backToGames, Boolean(selected) || selectedExample !== null);
  if (selectedExample) return <CalendarGameDetails gameId={selectedExample} onBack={() => setSelectedExample(null)} backLabel="Volver a mis partidos" />;
  if (selected && view === 'manager') return <section className="managerWorkspace">
    <button type="button" className="managerButtonOutline" onClick={backToGames}>Volver a mis partidos asignados</button>
    {managementError ? <p role="alert">{managementError}</p> : null}
    {!managementAllowed || selected.canOperate === false ? <p role="status">Solo consulta. Revisa <Link href="/account/access">Mis planes</Link> y
      <Link href="/account/manager-teams"> Mis cupos de Manager.</Link></p> : null}
    {(managementAllowed || selected.status === 'in_progress' && selected.canOperate === true) && selected.canOperate !== false && ['scheduled', 'in_progress'].includes(selected.status) ? <LiveScoringManagerDemo
      key={`${selected.tournamentId}:${selected.gameId}:${selected.managerTeamId}`} assignment={selected} managerId={userId} /> :
      <OfficialGameDetails gameId={selected.gameId} onBack={backToGames} />}
  </section>;
  if (selected && view !== 'manager') return scorerAllowed(selected) ?
    <OfficialGameWorkspace key={`${selected.tournamentId}:${selected.gameId}`} view={view} game={selected} actorId={userId} onBack={backToGames} /> :
    <section className={`managerCard${selected.organizerCapacityBlocked ? ' organizerCapacityNotice' : ''}`}><h1>{selected.organizerCapacityBlocked ? 'Capacidad del torneo pendiente' :
      selected.canOperate === false ? 'Revisa tu acceso operativo de Anotador' : 'Partido fuera de tus cupos de Anotador'}</h1>
      <p role="alert">{selected.organizerCapacityBlocked ?
        'El organizador debe reservar la oportunidad gratuita o habilitar la capacidad de este torneo antes de iniciar el partido. Tu plan de Anotador no cambia; pagar un acceso puntual personal no resuelve este bloqueo.' :
        scorekeeperError || (selected.canOperate === false ?
        'Revisa la vigencia de tu rol en Mis planes y la autorización del partido en Mis cupos. Un acceso puntual no renueva una vigencia vencida; las suplencias autorizadas siguen siendo gratuitas.' :
        'Selecciona este torneo o solicita acceso puntual a este partido. No se habilita el torneo completo.')}</p>
      <div className="managerButtonRow">
        {selected.organizerCapacityBlocked ? <Link href={view === 'organizer' ? '/demo/tournaments' : `/demo/tournaments?tournament=${encodeURIComponent(selected.tournamentId)}`}
          className="managerButtonOutline">{view === 'organizer' ? 'Gestionar capacidad de mis torneos' : 'Consultar ficha del torneo'}</Link> : <>
          <Link href="/account/scorekeeper-tournaments" className="managerButtonOutline">Gestionar mis cupos y accesos puntuales</Link>
          <Link href="/account/access" className="managerButtonOutline">Activar o renovar en Mis planes</Link>
        </>}
        <button className="managerButtonOutline" onClick={backToGames}>Volver a mis partidos</button>
      </div></section>;
  if (singleLive) return <section className="assignedGames" aria-label="Entrada a la pizarra en vivo">
    <header className="assignedGamesHeader">
      <div><p className="eyebrow">TU PARTIDO · ANOTADOR</p><h1>Pizarra en vivo</h1></div>
      <div className="assignedGamesActions">
        <button type="button" className="managerButtonOutline" onClick={() => setRetry(value => value + 1)}>Actualizar</button>
        <Link className="managerButtonOutline" href={assignedHref}>Mis partidos asignados</Link>
      </div>
    </header>
    {error ? <p className="managerWarning" role="alert">{error} Puedes volver a actualizar.</p> : null}
    {!catalog && !error ? <p role="status">Consultando tu partido actual…</p> : null}
    {current ? currentGame ? <GameCard game={currentGame}>
      <button type="button" className="managerButtonSolid" onClick={() => openGame(currentGame)}>{currentGame.canOperate === false ? 'Revisar acceso' : preservesStartedGame(currentGame.suspension) ? 'Retomar anotación' : 'Comenzar anotación'}</button>
    </GameCard> : <p role="status">{current.message}</p> : null}
  </section>;
  return <section className="assignedGames">
    <header className="assignedGamesHeader">
      <div>
        <p className="eyebrow">TU JORNADA · {view === 'manager' ? 'MANAGER' : view === 'scorekeeper' ? 'ANOTADOR' : 'ORGANIZADOR'}</p>
        <h1>{view !== 'organizer' ? 'Mis partidos asignados' : 'Partidos y anotadores'}</h1>
        <p>{view === 'manager' ? 'Los encuentros de tu equipo: prepara el lineup, gestiona solicitudes de personal y consulta el partido sin anotar jugadas.' :
          view === 'scorekeeper' ? 'Cada encuentro, en su lugar. Elige tu partido y lleva la anotación desde la pizarra en vivo.' :
          'Organiza las asignaciones de tu jornada y abre la pizarra de cada encuentro.'}</p>
      </div>
      <div className="assignedGamesActions">
        <button type="button" className="managerButtonOutline" onClick={() => setRetry(value => value + 1)}>Actualizar partidos</button>
        {view === 'scorekeeper' ? <Link className="managerButtonSolid" href={`${assignedHref}&entry=live`}>Pizarra en vivo</Link> : null}
      </div>
    </header>
    {error ? <p className="managerWarning" role="alert">{error} Puedes volver a actualizar la lista.</p> : null}
    {managementError ? <p className="managerWarning" role="alert">{managementError}</p> : null}
    {view === 'scorekeeper' ? <div className="managerButtonRow">
      <Link href="/account/scorekeeper-tournaments" className="managerButtonOutline">Mis cupos y accesos puntuales</Link>
      <Link href="/sports-sheet/scorekeeper" className="managerButtonOutline">Box score y torneos</Link>
      <Link href="/account/access" className="managerButtonOutline">Mis planes de Anotador</Link>
      {scorekeeperError ? <p role="alert">{scorekeeperError}</p> : null}
    </div> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {!catalog && !error ? <p role="status">Consultando partidos…</p> : null}
    {selectedId && !selected && catalog && !error ? <p className="managerWarning" role="alert">Este partido ya no está disponible para tu cuenta. La anotación quedó bloqueada.</p> : null}
      {catalog && !error ? <section className="assignedOfficial" aria-labelledby="assigned-official-title">
        <div className="assignedSectionHeading"><div><p className="assignedSource">DESDE EL ORGANIZADOR</p><h2 id="assigned-official-title">Partidos oficiales</h2></div>
          <span className="assignedCount">{catalog.games.length} {catalog.games.length === 1 ? 'partido' : 'partidos'}</span></div>
        <div className="assignedMetrics">{assignedGameSections.map(section => <div key={section.status}>
          <strong>{catalog.games.filter(game => game.status === section.status).length}</strong><span>{section.title}</span>
        </div>)}</div>
        {!catalog.games.length ? <div className="assignedEmpty" role="status"><h3>{view === 'manager' ? 'No hay partidos asignados a tu equipo.' :
          view === 'scorekeeper' ? 'No tienes partidos asignados.' : 'No hay partidos configurados para tus torneos.'}</h3>
          <p>Cuando el organizador configure tu jornada, los encuentros aparecerán aquí.</p></div> : null}
        {assignedGameSections.map(section => {
          const games = catalog.games.filter(game => game.status === section.status);
          return games.length ? <section className="assignedGroup" key={section.status} aria-label={`${section.title} oficiales`}>
            <h3>{view === 'organizer' && section.status === 'protested' ? 'Mesa técnica · Protestas pendientes' : section.title}</h3><div className="assignedCardGrid">{games.map(game => <GameCard key={game.gameId} game={game}>
              <button className="managerButtonSolid" type="button" onClick={() => openGame(game)}>
                {view === 'manager' ? (managementAllowed || game.status === 'in_progress' && game.canOperate === true) && game.canOperate !== false && ['scheduled', 'in_progress'].includes(game.status) ? 'Preparar lineup y gestionar equipo' : 'Consultar partido y resultado' :
                  game.status === 'suspended' ? view === 'organizer' ? 'Reprogramar partido' : 'Consultar suspensión' :
                  game.status === 'final' ? 'Ver resumen' : game.status === 'protested' ? view === 'organizer' ? 'Registrar decisión de mesa técnica' : 'Consultar protesta' :
                  game.canOperate === false && view === 'scorekeeper' ? 'Revisar acceso' :
                  game.scoringBlockReason ? 'Consultar partido' : game.status === 'in_progress' ? 'Continuar anotación' :
                    preservesStartedGame(game.suspension) ? 'Retomar anotación' : 'Iniciar anotación'}
              </button>
              {game.scoringBlockReason ? <p className="managerWarning">{game.scoringBlockReason}</p> : null}
              {view === 'organizer' ? <AssignmentForm key={`${game.gameId}:${game.assignedScorekeeperIds.join(',')}`} game={game} organizerId={userId}
                onSaved={() => { setNotice('Asignación guardada.'); setRetry(value => value + 1); }} /> : null}
            </GameCard>)}</div>
          </section> : null;
        })}
      </section> : null}
      {view === 'organizer' ? <section className="assignedExamples" aria-labelledby="assigned-examples-title">
        <div className="assignedSectionHeading"><h2 id="assigned-examples-title">Otros partidos</h2></div>
        {assignedGameSections.filter(section => assignedGameExamples.some(game => game.status === section.status)).map(section => <section className="assignedGroup" key={section.status} aria-label={section.title}>
          <div><h3>{section.title}</h3><p>{section.description}</p></div>
          <div className="assignedCardGrid">{assignedGameExamples.filter(game => game.status === section.status).map(game => <GameCard key={game.exampleId} game={game}>
            {game.status === 'scheduled' ? <ExampleSchedule game={game} /> :
              <button type="button" className="managerButtonOutline" onClick={() => setSelectedExample(game.exampleId)}>
                {game.status === 'in_progress' ? 'Ver pizarra' : 'Ver resumen'}
              </button>}
          </GameCard>)}</div>
        </section>)}
      </section> : null}
  </section>;
}

function GameCard({ game, children }: { game: OfficialGameSummary | AssignedGameExample; children: ReactNode }) {
  const example = 'exampleId' in game;
  const away = example ? game.details.awayTeamName : game.details?.awayTeamName ?? game.awayTeamId;
  const home = example ? game.details.homeTeamName : game.details?.homeTeamName ?? game.homeTeamId;
  const showsScore = game.status !== 'scheduled' || !example && preservesStartedGame(game.suspension);
  return <article className="assignedGameCard" data-state={game.status} aria-label={`${away} vs. ${home}${example ? ' · Ejemplo' : ''}`}>
    <div className="assignedCardTop"><span className="assignedBadge" data-state={game.status}>{officialGameStatusLabels[game.status]}</span>
      <span className="assignedSource">{example ? 'EJEMPLO · SOLO LECTURA' : 'ASIGNACIÓN OFICIAL'}</span></div>
    <h4><InstitutionName kind="tournament" id={example ? undefined : game.tournamentId}>{example ? game.details.tournamentName : game.details?.tournamentName ?? game.tournamentId}</InstitutionName></h4>
    {!example ? <OfficialResult game={game} /> : null}
    <div className="assignedTeams">
      {([{ name: away, id: example ? undefined : game.awayTeamId, side: 'Visitante', score: game.awayScore }, { name: home, id: example ? undefined : game.homeTeamId, side: 'Local', score: game.homeScore }]).map(team =>
        <div className="assignedTeam" key={team.side}><span className="assignedTeamMark" aria-hidden="true">{team.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span>
          <div><strong><InstitutionName id={team.id} example={example}>{team.name}</InstitutionName></strong><small>{team.side}</small></div>
          <span className="assignedTeamScore" aria-label={showsScore ? `${team.score} carreras` : 'Marcador pendiente'}>{showsScore ? team.score : '—'}</span>
        </div>)}
    </div>
    {example && game.innings ? <p className="assignedProgress">{game.status === 'in_progress' ? `Entrada ${game.innings}` : `Final · ${game.innings} entradas`}</p> : null}
    {game.details ? <dl className="assignedGameMeta">
      <div><dt>Fecha</dt><dd>{game.status === 'suspended' ? 'Nueva fecha pendiente' : calendarDateLabel(game.details.date)}</dd></div>
      <div><dt>Hora</dt><dd>{game.status === 'suspended' ? 'Por definir' : game.details.time}</dd></div>
      <div><dt>Estadio</dt><dd>{game.details.venue}</dd></div>
    </dl> : <p>Fecha, hora y estadio pendientes de configurar por el organizador.</p>}
    {game.status === 'suspended' && game.details ? <p>Fecha original: {calendarDateLabel(game.details.date)} · {game.details.time}</p> : null}
    <div className="assignedCardActions">{children}</div>
  </article>;
}

function ExampleSchedule({ game }: { game: AssignedGameExample }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <button className="managerButtonOutline" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Cerrar ficha' : 'Ver ficha'}
    </button>
    {expanded ? <p>Partido pendiente: <ExampleTeamName>{game.details.awayTeamName}</ExampleTeamName> visita a <ExampleTeamName>{game.details.homeTeamName}</ExampleTeamName>. La anotación oficial solo se habilita en un partido asignado y con los dos lineups entregados.</p> : null}
  </>;
}

function AssignmentForm({ game, organizerId, onSaved }: { game: OfficialGameSummary; organizerId: string; onSaved: () => void }) {
  const [ids, setIds] = useState(game.assignedScorekeeperIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useNavigationBusy(busy);
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiBase}/games/${encodeURIComponent(game.gameId)}/authorization`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: game.tournamentId, organizerId, scorekeeperIds: ids })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo guardar la asignación.');
      setNotice('Asignación guardada.'); onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar la asignación.'); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy || game.status === 'final'}>
      <legend>Anotadores asignados</legend>
      {!game.availableScorekeeperIds.length ? <p>No hay anotadores autorizados en este torneo.</p> : game.availableScorekeeperIds.map(id => <label key={id} className="assignmentChoice">
        <input type="checkbox" checked={ids.includes(id)} onChange={event => {
          setIds(previous => event.target.checked ? [...previous, id] : previous.filter(value => value !== id)); setNotice('');
        }} /> {id === 'scorer-demo' ? 'Anotador' : id}
      </label>)}
      <p>Dejar la selección vacía retira las asignaciones del partido, no sus anotaciones.</p>
      <button className="managerButtonOutline" type="submit" disabled={!game.availableScorekeeperIds.length}>Guardar asignación</button>
    </fieldset>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </form>;
}
