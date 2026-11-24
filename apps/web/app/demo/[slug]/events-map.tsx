'use client';
import { ExampleTeamName } from '../../institutional-logos';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  calendarDateLabel, calendarDirectionsUrl, calendarGames, calendarOfficialGames, calendarScoreLabel, isCalendarDate, isCalendarFilters,
  isProfileLocation, isTeamSportsRole, profileLocationLabel, shiftCalendarDate, venezuelaStates, venezuelaToday, demoProfileLocation, favoritesFirst, playerDemoGames, playerDemoSource, type CalendarFilters
} from '@playsport/shared';
import { useNavigationDraft } from '../../navigation-hooks';
import { usePlatformSession } from '../../platform-session';
import { demoSessionLocation } from '../../platform-navigation';
import { calendarExampleGames, calendarExampleVenues } from './event-examples';
import CalendarGameDetails, { CalendarGameHonors } from './calendar-game-details';
import { calendarGameLive, calendarLiveProgress } from './event-archives';
import OfficialCalendarGame from './official-calendar';
import OfficialGameDetails from './official-game-details';
import usePublicOfficialGames from './use-public-official-games';
import { bettingPreviewHref, bettingPreviewOpen } from '../betting-preview/game-context';
import PlayerGameBrowser from './player-game-browser';
import { useFavorites, FavoritesOnly } from '../../favorites';
import CalendarDateShortcuts from './calendar-date-shortcuts';

const statusLabels = { scheduled: 'Por jugar', live: 'En juego', finished: 'Finalizado', cancelled: 'Cancelado' };
const officialCalendarStatuses = { scheduled: 'scheduled', in_progress: 'live', suspended: 'suspended', protested: 'protested', final: 'finished' } as const;

export default function Cartelera({ gameId, officialGameId }: { gameId?: string; officialGameId?: string }) {
  const { session } = usePlatformSession();
  if (isTeamSportsRole(session?.role) && gameId === undefined && officialGameId === undefined) return <PlayerGameBrowser />;
  return <GeneralCartelera gameId={gameId} officialGameId={officialGameId} />;
}

function GeneralCartelera({ gameId, officialGameId }: { gameId?: string; officialGameId?: string }) {
  const { session, enter } = usePlatformSession();
  const favorites = useFavorites();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const profileLocation = demoSessionLocation(session);
  const today = venezuelaToday();
  const [filters, setFilters, loaded] = useNavigationDraft<CalendarFilters>('events-map:filters',
    { date: today, ...profileLocation }, isCalendarFilters);
  const state = venezuelaStates.find(item => item.id === filters.stateId);
  const validDate = isCalendarDate(filters.date);
  const catalog = usePublicOfficialGames();
  const examples = useMemo(() => validDate ? calendarGames(calendarExampleGames, calendarExampleVenues, filters).map(game => {
    const example = calendarExampleGames.find(item => item.id === game.id);
    if (!example) throw new Error('No se encontraron los datos del juego de la cartelera.');
    return example;
  }) : [],
    [filters, validDate]);
  const chronologicalGames = useMemo(() => validDate ? [
    ...examples.map(game => ({ source: 'example', game, status: game.status, time: game.time, id: game.id } as const)),
    ...calendarOfficialGames(catalog.games ?? [], filters).map(game => ({
      source: 'official', game, status: officialCalendarStatuses[game.status], time: game.details?.time ?? '', id: game.gameId
    } as const))
  ].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id) || a.source.localeCompare(b.source)) : [],
  [examples, catalog.games, filters, validDate]);
  const preferred = (entry: (typeof chronologicalGames)[number]) => {
    const game = entry.source === 'official' ? entry.game :
      playerDemoGames.find(game => playerDemoSource(game.gameId)?.id === entry.id);
    return Boolean(game && favorites?.matchesGame(game));
  };
  const games = favoritesFirst(chronologicalGames.filter(entry => !onlyFavorites || preferred(entry)), preferred);
  const unlocated = catalog.games?.filter(game => game.details?.date === filters.date && game.details.stateId === undefined).length ?? 0;
  const historical = validDate && filters.date < today;
  const heading = historical ? 'Resultados de la fecha seleccionada' : 'Partidos de la fecha seleccionada';
  if (officialGameId !== undefined) return <OfficialGameDetails gameId={officialGameId} />;
  if (gameId !== undefined) return <CalendarGameDetails gameId={gameId} />;
  if (!loaded) return <p role="status">Recuperando los filtros de la cartelera…</p>;
  return <section className="calendarBrowser" aria-label="Cartelera general">
    <header className="moduleHeader">
      <p className="eyebrow">CARTELERA DE VENEZUELA</p>
      <h1>Cartelera</h1>
      <p>Consulta por fecha y por la ubicación de la sede del partido, no por la procedencia de los equipos.</p>
    </header>
    <section className="managerCard eventsFilters" aria-labelledby="events-filters-title">
      <h2 id="events-filters-title">Dónde y cuándo quieres ver juegos</h2>
      <p>{session ? 'Ubicación de mi perfil' : 'Ubicación inicial'}:
        {' '}<strong>{profileLocationLabel(profileLocation)}</strong>.</p>
      <p>Cambiar estos filtros no modifica tu perfil. Se conservan al volver atrás o recargar esta pestaña.</p>
      <div className="eventsFilterGrid">
        <div className="calendarDateField">
        <label className="managerField"><span>Fecha de los partidos</span>
          <input type="date" value={filters.date} onChange={(event) => setFilters(previous => ({ ...previous, date: event.target.value }))} />
        </label>
        <CalendarDateShortcuts date={filters.date} onChange={date => setFilters(previous => ({ ...previous, date }))} />
        </div>
        <label className="managerField"><span>Estado o entidad federal</span>
          <select value={filters.stateId} onChange={(event) => {
            const stateId = event.target.value;
            const next = venezuelaStates.find(item => item.id === stateId);
            setFilters(previous => ({ ...previous, stateId, municipalityId: next?.municipalities[0]?.id ?? '' }));
          }}>
            <option value="">Todos los estados</option>
            {venezuelaStates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="managerField"><span>Municipio de la sede</span>
          <select value={filters.municipalityId} disabled={!state?.municipalities.length}
            onChange={(event) => setFilters(previous => ({ ...previous, municipalityId: event.target.value }))}>
            {state?.municipalities.length ? state.municipalities.map(item => <option key={item.id} value={item.id}>{item.name}</option>) :
              <option value="">{filters.stateId ? 'Sin división municipal catalogada' : 'Todos los municipios'}</option>}
          </select>
        </label>
      </div>
      <div className="managerButtonRow">
        <button className="managerButtonOutline" type="button" disabled={!validDate || filters.date === '0001-01-01'}
          onClick={() => setFilters(previous => ({ ...previous, date: shiftCalendarDate(previous.date, -1) }))}>Día anterior</button>
        <button className="managerButtonOutline" type="button" disabled={!validDate || filters.date === '9999-12-31'}
          onClick={() => setFilters(previous => ({ ...previous, date: shiftCalendarDate(previous.date, 1) }))}>Día siguiente</button>
        <button className="managerButtonOutline" type="button" onClick={() => setFilters(previous => ({ ...previous, ...profileLocation }))}>Usar ubicación de mi perfil</button>
        <button className="managerButtonOutline" type="button" onClick={() => setFilters({ date: '2026-11-05', ...demoProfileLocation })}>Ver partidos del 5 de noviembre</button>
      </div>
      {session ? <button className="managerButtonOutline" type="button" disabled={!isProfileLocation(filters)}
        onClick={() => enter({ ...session, location: { stateId: filters.stateId, municipalityId: filters.municipalityId } })}>
        Guardar esta ubicación en mi perfil
      </button> : <Link href="/">Elegir rol</Link>}
      {state?.note ? <p className="managerWarning" role="status">{state.note}</p> : null}
      {!validDate ? <p className="managerWarning" role="alert">Selecciona una fecha válida para consultar los partidos.</p> : null}
      <p className="eventsTimezone">Fecha y hora local de Venezuela · America/Caracas. Sin límite de antigüedad.</p>
      <FavoritesOnly checked={onlyFavorites} onChange={setOnlyFavorites} />
    </section>
    {validDate ? <>
      <section className="eventsResults" aria-labelledby="events-results-title">
        <h2 id="events-results-title">{heading}</h2>
        <button className="managerButtonOutline" type="button" onClick={catalog.refresh}>Actualizar cartelera</button>
        <p role="status" aria-live="polite">{games.length} partido{games.length === 1 ? '' : 's'} · {calendarDateLabel(filters.date)} ·
          {' '}{filters.stateId ?
            `${state?.municipalities.find(item => item.id === filters.municipalityId)?.name ?? 'Sin municipio'} · ${state?.name}` :
            'Todos los estados'}</p>
        <p className="eventsStatusCounts" aria-label="Estados de los partidos">
          En juego: {games.filter(game => game.status === 'live').length} ·
          {' '}Por jugar: {games.filter(game => game.status === 'scheduled').length} ·
          {' '}Finalizados: {games.filter(game => game.status === 'finished').length}
          {games.some(game => game.status === 'suspended') ? ` · Suspendidos: ${games.filter(game => game.status === 'suspended').length}` : null}
          {games.some(game => game.status === 'protested') ? ` · Bajo protesta: ${games.filter(game => game.status === 'protested').length}` : null}
          {games.some(game => game.status === 'cancelled') ? ` · Cancelados: ${games.filter(game => game.status === 'cancelled').length}` : null}
        </p>
        {catalog.error ? <p className="managerWarning" role="alert">{catalog.error} Los resultados del sistema no pudieron actualizarse.</p> :
          !catalog.games ? <p role="status">Consultando partidos…</p> : null}
        {unlocated > 0 ? <p className="eventsTimezone">{unlocated} partido{unlocated === 1 ? ' tiene' : 's tienen'} la ubicación de su sede pendiente{filters.stateId ? ` y no se incluye${unlocated === 1 ? '' : 'n'} en esta búsqueda.` : '; se muestran sin atribuirles un estado o municipio.'}</p> : null}
        {historical ? <p>Se muestran los resultados guardados de esa fecha, aunque hayan pasado años. Un juego sin resultado no se convierte automáticamente en finalizado.</p> : null}
        {!games.length ? catalog.games && !catalog.error ? <p className="managerCard eventsEmpty">No hay partidos registrados para esta fecha y ubicación. Puedes cambiar el día, el estado o el municipio.</p> : null :
          <div className="eventsGameGrid">{games.map(entry => {
            if (entry.source === 'official') return <OfficialCalendarGame key={`official:${entry.id}`} game={entry.game} />;
            const game = entry.game;
            const venue = calendarExampleVenues.find(item => item.id === game.venueId);
            if (!venue) throw new Error('El partido no tiene una sede registrada.');
            const live = game.status === 'live' ? calendarGameLive(game) : null;
            return <article className="managerCard eventsGame" key={`example:${game.id}`} data-game-id={game.id} data-game-status={game.status}>
              <div className="eventsGameMeta">
                <p className="eyebrow">{game.sport === 'baseball' ? 'BÉISBOL' : 'SOFTBOL'}</p>
                <p><time dateTime={`${game.date}T${game.time}`}>{game.time}</time> · <span className="eventsGameStatus" data-status={game.status}>{statusLabels[game.status]}</span></p>
              </div>
              {game.status === 'finished' || game.status === 'live' ? <h3 className="eventsMatchup" aria-label={calendarScoreLabel(game)}>
                <span className="eventsTeam"><span><ExampleTeamName>{game.awayTeam}</ExampleTeamName></span><strong>{game.score?.away}</strong></span>
                <span className="eventsTeam"><span><ExampleTeamName>{game.homeTeam}</ExampleTeamName></span><strong>{game.score?.home}</strong></span>
              </h3> : <h3><ExampleTeamName>{game.awayTeam}</ExampleTeamName> <span>vs.</span> <ExampleTeamName>{game.homeTeam}</ExampleTeamName></h3>}
              <p><strong>Torneo: </strong>{game.tournament}</p>
              <p><strong>{venue.name}</strong></p>
              {game.status === 'scheduled' || game.status === 'live' ? <>
                <address className="eventsAddress"><strong>Dirección: </strong>{venue.address}</address>
              <p><a className="managerButtonOutline eventsDirectionsLink" href={calendarDirectionsUrl(venue)} target="_blank" rel="noopener noreferrer"
                aria-label={`Cómo llegar en Google Maps a ${venue.name}`}>Cómo llegar en Google Maps ↗</a></p>
              </> : null}
              {game.status === 'cancelled' ? <p>{calendarScoreLabel(game)}</p> : null}
              {game.status === 'finished' ? <>
                <CalendarGameHonors game={game} />
                <Link className="managerButtonOutline eventsDirectionsLink" href={`/demo/events-map?game=${encodeURIComponent(game.id)}`}>Ver detalles del juego</Link>
              </> : null}
              {game.status === 'live' ? <>
                <p className="eventsLiveProgress">{live ? calendarLiveProgress(live.state) : 'Detalle de entrada y outs no disponible.'}</p>
                <Link className="managerButtonOutline eventsDirectionsLink" href={`/demo/events-map?game=${encodeURIComponent(game.id)}`}>Ver juego en vivo</Link>
              </> : null}
              {bettingPreviewOpen(game.status) ? <Link className="managerButtonSolid eventsDirectionsLink"
                href={bettingPreviewHref('example', game.id)}
                aria-label={`Apostar: ${game.awayTeam} contra ${game.homeTeam}`}>Apostar</Link> : null}
              {historical && game.status === 'scheduled' ? <p role="status">Sin resultado registrado para este juego. No se supone un ganador.</p> : null}
            </article>;
          })}</div>}
      </section>
    </> : null}
    <details className="managerCard eventsSources">
      <summary>Datos reales, fuentes y fechas de ejemplo</summary>
      <p>Catálogo permanente de 335 municipios, con nombres contrastados y correcciones documentadas.
        Las Dependencias Federales y el territorio en disputa de Guayana Esequiba se indican sin inventar municipios.</p>
      <p><a href="https://github.com/zokeber/venezuela-json" target="_blank" rel="noreferrer">Venezuela-JSON · CC BY 4.0</a>
        {' · '}<a href="https://es.wikipedia.org/wiki/Anexo:Municipios_de_Venezuela" target="_blank" rel="noreferrer">Referencia territorial</a></p>
      <ul>{calendarExampleVenues.map(venue => <li key={venue.id}><a href={venue.source} target="_blank" rel="noreferrer">{venue.name}: fuente de ubicación</a></li>)}</ul>
      <p>Para ver juegos finalizados, en juego y por jugar juntos, selecciona Distrito Capital / Libertador el 5 de noviembre de 2026.
        Otros ejemplos en Caracas: 4 y 3 de noviembre de 2026, 29 de febrero de 2000 y 29 de febrero de 1952.
        También hay juegos en Girardot (Aragua), Maracaibo (Zulia) y Valencia (Carabobo).
        Puedes consultar otra fecha o municipio.</p>
      <p>No se cargan mapas en esta página. Para juegos pendientes o en curso, «Cómo llegar» abre Google Maps en otra pestaña con las coordenadas de la sede;
        puedes elegir allí tu punto de salida. La plataforma no solicita tu ubicación ni utiliza una clave de Google Maps.</p>
      <p>La sugerencia y publicación de eventos reales sigue pendiente; no se muestran botones que simulen guardar esos eventos.</p>
    </details>
  </section>;
}
