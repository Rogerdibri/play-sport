'use client';

import Link from 'next/link';
import {
  calculateOfficialStandings,
  playerScopeStandings,
  playerDemoGames,
  playerDemoTournaments,
  favoritesFirst,
} from '@playsport/shared';
import { usePlayerSports } from '../../player-sports-context';
import usePublicOfficialGames from './use-public-official-games';
import { InstitutionName } from '../../institutional-logos';
import { useState } from 'react';
import { useFavorites, FavoritesOnly, FavoriteInstitutionName } from '../../favorites';

export default function OfficialStandings() {
  const { games, error, refresh } = usePublicOfficialGames();
  const sports = usePlayerSports();
  const favorites = useFavorites();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const exampleTournamentIds = new Set(
    sports?.demo
      ? playerDemoTournaments.map((tournament) => tournament.id)
      : [],
  );
  const sourceGames = games
    ? [...games, ...(sports?.demo ? playerDemoGames : [])]
    : null;
  const classification = sourceGames
    ? calculateOfficialStandings(
        sports
          ? playerScopeStandings(
              sourceGames,
              sports.tournaments,
              sports.preference.filter,
            )
          : sourceGames,
      )
    : null;
  const tournaments = classification ? favoritesFirst(
    classification.filter(tournament => !onlyFavorites || favorites?.matchesTournament(tournament.id)),
    tournament => Boolean(favorites?.matchesTournament(tournament.id)),
  ) : null;
  return (
    <section
      className="managerCard managerStepCard"
      aria-label={
        sports?.demo
          ? `Clasificación del ${sports.role === 'manager' ? 'manager' : 'jugador'}`
          : 'Clasificación oficial'
      }
    >
      <h2>
        Torneos
      </h2>
      <button className="managerButtonOutline" type="button" onClick={refresh}>
        {sports?.demo
          ? 'Actualizar clasificación'
          : 'Actualizar clasificación oficial'}
      </button>
      <FavoritesOnly checked={onlyFavorites} onChange={setOnlyFavorites} />
      {error ? (
        <p role="alert">{error}</p>
      ) : tournaments === null ? (
        <p role="status">Consultando clasificación oficial…</p>
      ) : !tournaments.length ? (
        <p>
          {sports
            ? 'No hay partidos registrados para los torneos de esta selección.'
            : 'No hay torneos oficiales configurados.'}
        </p>
      ) : (
        tournaments.map((tournament) => (
          <section key={tournament.id}>
            <h3>
              <InstitutionName kind="tournament" id={tournament.id}>
                {tournament.name}
              </InstitutionName>
            </h3>
            {exampleTournamentIds.has(tournament.id) ? (
              <p>
                Los juegos en curso y programados no suman victorias ni
                derrotas. Esta tabla usa solamente los resultados finalizados
                registrados.
              </p>
            ) : (
              <>
                <p>
                  {tournament.pendingProtests} juegos bajo protesta pendientes:
                  no suman victorias ni derrotas.
                </p>
                <p>
                  Las decisiones de mesa técnica determinan ganador y perdedor;
                  las carreras registradas se conservan.
                </p>
              </>
            )}
            <div
              className="scorecardTableScroll"
              tabIndex={0}
              role="region"
              aria-label={`Clasificación de ${tournament.name}`}
            >
              <table className="scorecardTable standingsTable">
                <thead>
                  <tr>
                    {['Pos.', 'Equipo', 'JJ', 'JG', 'JP', 'JE', 'CF', 'CC'].map(
                      (label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {tournament.rows.map((row) => (
                    <tr key={row.team}>
                      <td>{row.rank ?? '—'}</td>
                      <th scope="row">
                        <FavoriteInstitutionName id={row.team}>
                          {tournament.teamNames[row.team]}
                        </FavoriteInstitutionName>
                      </th>
                      {[
                        row.played,
                        row.wins,
                        row.losses,
                        row.ties,
                        row.runsFor,
                        row.runsAgainst,
                      ].map((value, index) => (
                        <td key={index}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tournament.rows.flatMap((row) =>
              row.results
                .filter(
                  (result) =>
                    result.technicalDecision && result.outcome === 'G',
                )
                .map((result) => (
                  <p key={result.gameId}>
                    Resultado por mesa técnica:{' '}
                    <strong>
                      <InstitutionName id={row.team}>
                        {tournament.teamNames[row.team]}
                      </InstitutionName>
                    </strong>{' '}
                    ganador ·{' '}
                    <InstitutionName id={result.opponent}>
                      {tournament.teamNames[result.opponent]}
                    </InstitutionName>{' '}
                    perdedor. Carreras anotadas: {result.runsFor}–
                    {result.runsAgainst}.{' '}
                    <Link
                      href={`/demo/events-map?official=${encodeURIComponent(result.gameId)}`}
                    >
                      Ver partido y acta
                    </Link>
                  </p>
                )),
            )}
          </section>
        ))
      )}
    </section>
  );
}
