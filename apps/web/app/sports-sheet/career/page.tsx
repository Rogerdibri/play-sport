'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { careerCounts, careerDisposition, careerExampleObservation, careerGameKey, careerLeagueKey, careerPeriods,
  careerTeamKey, emptyCareerFilters, fieldPositionLabels, filterCareerGames, platformRoles, readCareerSnapshot,
  type AccountProfile, type CareerFilters, type CareerGame, type CareerSnapshot } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import SportsSheetExampleScorecard from '../example-scorecard';

const roleLabel = (game: CareerGame) => platformRoles.find(role => role.id === game.role)!.label;
const statusLabel = (game: CareerGame) => careerDisposition(game) === 'completed' ? 'Finalizado' :
  careerDisposition(game) === 'ongoing' ? 'En curso' : game.status === 'suspended' ? 'Suspendido' :
    game.status === 'protested' ? 'Bajo protesta' : 'Resultado técnico · En revisión';
const sportLabel = (sport: string) => /^(baseball|b[eé]isbol)$/i.test(sport) ? 'Béisbol' :
  /^(softball|softbol)$/i.test(sport) ? 'Softbol' : sport || 'Sin deporte indicado';
function CareerCount({ games }: { games: CareerGame[] }) {
  const counts = careerCounts(games);
  return <p>{counts.completed} {counts.completed === 1 ? 'juego finalizado' : 'juegos finalizados'} ·
    {' '}{counts.ongoing} en curso · {counts.review} en revisión.</p>;
}
export default function SportsCareerPage() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <main className="moduleView"><p role="status">Abriendo tu trayectoria…</p></main>;
  if (!account) return <main className="moduleView sportsSheet"><header className="moduleHeader"><h1>Mi trayectoria deportiva</h1>
    <p>Tu recorrido a partir de participaciones oficiales.</p></header><section className="managerCard managerStepCard">
    <p>Inicia sesión para consultar la trayectoria privada de tu cuenta.</p><Link href="/account" className="managerButtonOutline">Mi cuenta</Link>
  </section></main>;
  return <AccountCareer key={account.id} account={account} />;
}
function AccountCareer({ account }: { account: AccountProfile }) {
  const [source, setSource] = useState<CareerSnapshot['source']>(account.localTestAccess ? 'example' : 'official');
  const [snapshot, setSnapshot] = useState<CareerSnapshot | null>(null);
  const [filters, setFilters] = useState<CareerFilters>(emptyCareerFilters);
  const [detail, setDetail] = useState<string | null>(null);
  const [showScorecard, setShowScorecard] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const detailRef = useRef<globalThis.HTMLElement | null>(null);
  useEffect(() => { if (detail) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [detail]);
  useEffect(() => {
    let active = true, generation = 0;
    setSnapshot(null); setLocked(false); setError('');
    const load = async () => {
      const request = ++generation;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/sports-sheet/career?source=${source}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const body: unknown = await response.json();
        if (response.status === 403 && body && typeof body === 'object' && 'code' in body && body.code === 'CAREER_PLAN_REQUIRED' &&
            'accountId' in body && body.accountId === account.id) {
          if (active && request === generation) { setLocked(true); setSnapshot(null); setError(''); }
          return;
        }
        if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ?
          body.message : 'No se pudo consultar tu trayectoria.');
        const value = readCareerSnapshot(body, account.id, source);
        if (active && request === generation) { setSnapshot(value); setLocked(false); setError(''); }
      } catch (failure) {
        if (active && request === generation) { setSnapshot(null); setLocked(false); setError(failure instanceof Error ? failure.message : 'No se pudo consultar tu trayectoria.'); }
      } finally { if (active && request === generation) setRefreshing(false); }
    };
    void load();
    globalThis.addEventListener('focus', load);
    const interval = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(interval); };
  }, [account.id, source, attempt]);
  const data = snapshot?.source === source ? snapshot : null;
  const invalidDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const games = invalidDates ? [] : filterCareerGames(data?.games ?? [], filters);
  const periods = careerPeriods(games);
  const selectedGame = games.find(game => careerGameKey(game) === detail);
  const update = (patch: Partial<CareerFilters>) => {
    setFilters(value => ({ ...value, ...patch })); setDetail(null); setShowScorecard(false);
  };
  const choice = (field: keyof CareerFilters, label: string, key: (_game: CareerGame) => string, name: (_game: CareerGame) => string) => { // eslint-disable-line no-unused-vars
    const choices = [...new Map((data?.games ?? []).map(game => [key(game), { key: key(game), name: name(game) }])).values()];
    return <label className="managerField"><span>{label}</span><select value={filters[field]} onChange={event => update({ [field]: event.target.value })}>
      <option value="">Todos</option>{choices.map(value => <option key={value.key} value={value.key}>{value.name}</option>)}
    </select></label>;
  };
  return <main className="moduleView sportsSheet sportsCareer">
    <header className="moduleHeader"><h1>Mi trayectoria deportiva</h1>
      <p>Temporadas, equipos y roles respaldados por los registros del ecosistema.</p>
      <div className="managerButtonRow"><Link href="/sports-sheet" className="managerButtonOutline">Volver a mi hoja deportiva</Link>
        <Link href="/sports-sheet/statistics" className="managerButtonOutline">Mis estadísticas</Link></div>
    </header>
    {locked ? <section className="managerCard managerStepCard"><h2>Trayectoria con plan</h2>
      <p>La trayectoria detallada de Jugador requiere Nivel 3 · Análisis completo. Los demás roles conservan sus accesos de trayectoria. El vencimiento no borra tus participaciones.</p>
      <Link href="/account/access" className="managerButtonOutline">Consultar mis accesos</Link>
      <p>Tu ficha básica y sus equipos actuales siguen disponibles.</p></section> : <>
      <section className="managerCard managerStepCard">
        {account.localTestAccess ? <label className="managerField"><span>Registros a consultar</span><select value={source} onChange={event => {
          if (event.target.value === 'official' || event.target.value === 'example') {
            setSource(event.target.value); setFilters(emptyCareerFilters()); setDetail(null); setShowScorecard(false);
          }
        }}><option value="official">Mi trayectoria oficial</option><option value="example">Ejemplo de trayectoria</option></select></label> : null}
        <button type="button" className="managerButtonOutline" disabled={refreshing} onClick={() => setAttempt(value => value + 1)}>
          {refreshing ? 'Actualizando…' : 'Actualizar trayectoria'}</button>
      </section>
      {error ? <section className="managerCard managerStepCard"><p role="alert" className="managerWarning">{error}</p></section> : null}
      {!data && !error ? <p role="status">Consultando acceso y participaciones oficiales…</p> : null}
      {data && !data.games.length ? <section className="managerCard managerStepCard"><h2>Sin participaciones registradas</h2>
        <p>{data.identityVerified ? 'Todavía no hay participaciones vinculadas a tu identidad en juegos con acciones registradas.' :
          'Verifica tu identidad en Mi cuenta para vincular tus participaciones reales.'}</p>
        <p>Los equipos actuales y las fichas declaradas no se convierten automáticamente en historial de juegos.</p></section> : null}
      {data && data.games.length ? <>
        <details className="managerCard managerStepCard sportsCareerFilters"><summary>Filtrar mi trayectoria</summary>
          <div className="sportsSheetGrid">
            {choice('season', 'Temporada', game => JSON.stringify(game.season), game => game.season || 'Sin temporada indicada')}
            {choice('sport', 'Deporte', game => JSON.stringify(game.sport), game => sportLabel(game.sport))}
            {choice('modality', 'Modalidad', game => JSON.stringify(game.modality), game => game.modality || 'Sin modalidad indicada')}
            {choice('role', 'Rol registrado', game => game.role, roleLabel)}
            {choice('league', 'Liga', careerLeagueKey, game => game.leagueName || 'Sin liga indicada')}
            {choice('tournament', 'Torneo', game => game.tournamentId, game => game.tournamentName)}
            {choice('team', 'Equipo o intervención', careerTeamKey, game => game.teamName ? `${game.teamName} · ${game.tournamentName}` :
              `Intervención oficial · ${game.tournamentName}`)}
            <label className="managerField"><span>Desde</span><input type="date" value={filters.from} onChange={event => update({ from: event.target.value })} /></label>
            <label className="managerField"><span>Hasta</span><input type="date" value={filters.to} onChange={event => update({ to: event.target.value })} /></label>
          </div><button type="button" className="managerButtonOutline" onClick={() => update(emptyCareerFilters())}>Limpiar filtros</button>
        </details>
        {invalidDates ? <p role="alert" className="managerWarning">La fecha inicial no puede ser posterior a la fecha final.</p> : null}
        <section className="managerCard managerStepCard"><h2>Recorrido registrado</h2>
          <CareerCount games={games} />
          <p>Un mismo juego no se cuenta dos veces por tener más de un rol. Los juegos en curso y en revisión no cuentan como finalizados.</p>
        </section>
        {periods.length ? periods.map((period, index) => {
          const game = period.games[0];
          return <details className="managerCard managerStepCard sportsCareerPeriod" key={period.key} open={index === 0}>
            <summary><span>{game.season || 'Sin temporada indicada'} · {game.teamName ?? game.tournamentName} · {roleLabel(game)}</span>
              <small>{sportLabel(game.sport)}{game.modality && game.modality !== sportLabel(game.sport) ? ` · ${game.modality}` : ''}
                {' · '}{game.category || 'Sin categoría indicada'} · {game.tournamentName}</small></summary>
            <dl className="sportsSheetFacts"><dt>Deporte y modalidad</dt><dd>{sportLabel(game.sport)} · {game.modality || 'Sin modalidad indicada'}</dd>
              <dt>Competencia</dt><dd>{game.tournamentName} · {game.leagueName || 'Sin liga indicada'}</dd>
              <dt>Categoría</dt><dd>{game.category || 'Sin categoría indicada'}</dd>
              <dt>Participaciones con fecha</dt><dd>{period.firstDate ? `${period.firstDate} — ${period.lastDate}` : 'Sin fechas registradas'}
                {period.missingDates ? ` · ${period.missingDates} sin fecha` : ''}</dd></dl>
            <CareerCount games={period.games} />
            <div className="sportsCareerGames">{period.games.map(row => <article className="sportsSheetRole" key={careerGameKey(row)}>
              <h3>{row.awayTeamName} vs. {row.homeTeamName}</h3>
              <p>{row.date ?? 'Fecha no registrada'} · {statusLabel(row)} · Versión {row.version}</p>
              <button type="button" className="managerButtonOutline" aria-expanded={detail === careerGameKey(row)} onClick={() => {
                setDetail(value => value === careerGameKey(row) ? null : careerGameKey(row)); setShowScorecard(false);
              }}>{detail === careerGameKey(row) ? 'Cerrar participación' : 'Ver participación'}</button>
            </article>)}</div>
          </details>;
        }) : <section className="managerCard managerStepCard"><p>No hay participaciones que coincidan con estos filtros.</p></section>}
        {selectedGame ? <section className="managerCard managerStepCard sportsCareerDetail" ref={detailRef}>
          <h2>Participación: {selectedGame.awayTeamName} vs. {selectedGame.homeTeamName}</h2>
          <button type="button" className="managerButtonOutline" onClick={() => { setDetail(null); setShowScorecard(false); }}>Cerrar participación</button>
          <dl className="sportsSheetFacts"><dt>Rol acreditado</dt><dd>{roleLabel(selectedGame)}</dd><dt>Fecha y estado</dt>
            <dd>{selectedGame.date ?? 'Fecha no registrada'} · {statusLabel(selectedGame)}</dd>
            <dt>Respaldo</dt><dd>{selectedGame.evidence === 'lineup' ? 'Alineación del juego, cambios aprobados y jugadas registradas.' :
              selectedGame.evidence === 'scoring' ? 'Intervención firmada en la anotación oficial del juego.' :
                'Intervención firmada como organizador en el estado oficial del juego.'}</dd>
            <dt>Versión oficial</dt><dd>{selectedGame.version}</dd>
            {selectedGame.role === 'player' ? <><dt>Posiciones registradas</dt><dd>{selectedGame.positions.map(position =>
              fieldPositionLabels[position] ?? position).join(' · ') || 'No disponibles'}</dd></> : null}</dl>
          {source === 'example' ? <button type="button" className="managerButtonOutline" onClick={() => setShowScorecard(value => !value)}>
            {showScorecard ? 'Cerrar planilla' : 'Ver planilla de respaldo'}</button> : selectedGame.public ?
            <Link className="managerButtonOutline" href={`/demo/events-map?official=${encodeURIComponent(selectedGame.gameId)}`}>Ver planilla oficial</Link> :
              <p>La planilla de este juego no está publicada.</p>}
          {source === 'example' && showScorecard ? <SportsSheetExampleScorecard key={selectedGame.gameId}
            observation={careerExampleObservation(selectedGame.gameId)} gameId={selectedGame.gameId}
            tournamentId={selectedGame.tournamentId} onBack={() => setShowScorecard(false)} /> : null}
        </section> : null}
      </> : null}
      <section className="managerCard managerStepCard"><h2>Qué acredita esta trayectoria</h2>
        <p>Jugador y manager se vinculan a las alineaciones y cambios oficiales de juegos con acciones registradas; estar en el banco o inscrito no acredita una actuación.
          Anotador y organizador requieren intervenciones firmadas conservadas en el juego. No basta con tener permisos o seleccionar un rol.</p>
        <p>Las fechas corresponden a partidos, no a altas, bajas, transferencias o antigüedad en un equipo. Temporada, liga y modalidad proceden de la
          clasificación guardada del torneo; los datos ausentes se indican, no se estiman.</p>
        <p>Fanático y scout todavía no cuentan con registros de participación acreditables en esta trayectoria. No se añaden logros manualmente.
          Este historial permanece privado aunque publiques tu ficha deportiva.</p>
      </section>
    </>}
  </main>;
}
