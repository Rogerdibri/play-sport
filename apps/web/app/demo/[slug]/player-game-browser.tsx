'use client';

import {
  calendarDateLabel,
  isCalendarDate,
  officialGameStatusLabels,
  playerScopeGames,
  playerDemoGames,
  playerDemoSource,
  isTeamSportsRole,
  favoritesFirst,
  type OfficialGameStatus,
} from '@playsport/shared';
import { useState } from 'react';
import { useNavigationDraft } from '../../navigation-hooks';
import { usePlatformSession } from '../../platform-session';
import { demoIdentity } from '../../platform-navigation';
import { usePlayerSports } from '../../player-sports-context';
import { PlayerSportsFilters } from '../../player-sports-controls';
import OfficialCalendarGame from './official-calendar';
import usePublicOfficialGames from './use-public-official-games';
import OfficialGameDetails from './official-game-details';
import { useFavorites, FavoritesOnly } from '../../favorites';
import TeamLiveGames from './team-live-games';
import CalendarDateShortcuts from './calendar-date-shortcuts';

export default function PlayerGameBrowser() {
  const sports = usePlayerSports();
  const favorites = useFavorites();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const { account, session } = usePlatformSession();
  const role = sports?.role ?? 'player';
  const catalog = usePublicOfficialGames();
  const [date, setDate, restored] = useNavigationDraft<string | null>(
    `${role}-calendar:date`,
    null,
    (value): value is string | null => value === null || isCalendarDate(value),
    account?.id ?? (session ? demoIdentity(session).id : `${role}-demo`),
  );
  const [status, setStatus] = useState<OfficialGameStatus | ''>('');
  const games = [
    ...(catalog.games ?? []),
    ...(sports?.demo ? playerDemoGames : []),
  ];
  const scoped = sports?.ready
    ? playerScopeGames(games, sports.tournaments, sports.preference.filter)
        .filter(
          (game) =>
            (!date || game.details?.date === date) &&
            (!status || game.status === status),
        )
        .sort(
          (a, b) =>
            Number(b.status === 'in_progress') -
              Number(a.status === 'in_progress') ||
            (b.details?.date ?? '').localeCompare(a.details?.date ?? '') ||
            (a.details?.time ?? '').localeCompare(b.details?.time ?? ''),
        )
    : [];
  const filtered = favoritesFirst(scoped.filter(game => !onlyFavorites || favorites?.matchesGame(game)),
    game => Boolean(favorites?.matchesGame(game)));
  return (
    <section
      className="calendarBrowser"
      aria-label={`Cartelera del ${role === 'manager' ? 'manager' : 'jugador'}`}
    >
      <header className="moduleHeader">
        <h1>Cartelera</h1>
        <p>
          Los partidos de tu entorno deportivo, con libertad para explorar otros
          equipos, ligas y lugares.
        </p>
      </header>
      <PlayerSportsFilters />
      {sports?.ready && restored ? (
        <>
          <section className="managerCard">
            <div className="profileFieldGrid">
              <div className="calendarDateField">
                <label className="managerField">
                  <span>Fecha de los partidos (opcional)</span>
                  <input
                    type="date"
                    value={date ?? ''}
                    onChange={(event) => setDate(event.target.value || null)}
                  />
                </label>
                <CalendarDateShortcuts date={date} onChange={setDate} />
              </div>
              <details className="calendarGameOptions">
                <summary>Situación del juego (opcional)</summary>
                <label className="managerField">
                  <span>Situación del juego</span>
                  <select
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as OfficialGameStatus | '')
                    }
                  >
                    <option value="">Todas las situaciones</option>
                    {Object.entries(officialGameStatusLabels).map(
                      ([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </details>
            </div>
            <FavoritesOnly checked={onlyFavorites} onChange={setOnlyFavorites} />
            <div className="managerButtonRow">
              {date ? (
                <button
                  className="managerButtonOutline"
                  type="button"
                  onClick={() => setDate(null)}
                >
                  Ver todas las fechas
                </button>
              ) : null}
              <button
                className="managerButtonOutline"
                type="button"
                onClick={catalog.refresh}
              >
                Actualizar partidos
              </button>
            </div>
            {catalog.games && !catalog.error ? (
              <p role="status">
                {filtered.length}{' '}
                {filtered.length === 1 ? 'partido' : 'partidos'} ·{' '}
                {date ? calendarDateLabel(date) : 'Todas las fechas'} ·
                {favorites ? 'Favoritos primero; en cada grupo, juegos en curso' : 'Primero los juegos en curso'}
              </p>
            ) : null}
          </section>
          {catalog.error ? (
            <p role="alert">{catalog.error}</p>
          ) : catalog.games === null ? (
            <p role="status">Consultando partidos…</p>
          ) : filtered.length ? (
            <div className="eventsGameGrid">
              {filtered.map((game) => (
                <OfficialCalendarGame
                  key={game.gameId}
                  game={game}
                  showDate
                  example={Boolean(
                    sports.demo && playerDemoSource(game.gameId),
                  )}
                />
              ))}
            </div>
          ) : (
            <p className="managerCard">
              No hay partidos registrados para esta selección. Puedes cambiar el
              equipo, torneo, liga o ampliar la búsqueda a tu zona. No se
              muestran juegos ajenos para llenar la pantalla.
            </p>
          )}
        </>
      ) : !sports ? (
        <p role="status">Preparando tu contexto de jugador…</p>
      ) : null}
    </section>
  );
}

export function PublicLiveGames({ gameId }: { gameId?: string }) {
  const { session } = usePlatformSession();
  if (isTeamSportsRole(session?.role))
    return <TeamLiveGames gameId={gameId} />;
  return <OfficialGameDetails gameId={gameId ?? 'game-global-1'} />;
}
