'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  favoritesFirst, fieldPositionLabels, officialGameNames, playerDemoGames,
  playerDemoSource, playerLiveGames, type OfficialStandingGame,
} from '@playsport/shared';
import { usePlayerSports } from '../../player-sports-context';
import { usePlatformSession } from '../../platform-session';
import { FavoriteInstitutionName, useFavorites } from '../../favorites';
import usePublicOfficialGames from './use-public-official-games';
import OfficialRunScoring from './official-run-scoring';
import PrivateScorecardView from './private-scorecard-view';
import { calendarGameLive } from './event-archives';

const gameKey = (game: OfficialStandingGame) => JSON.stringify([game.tournamentId, game.gameId]);

export default function TeamLiveGames({ gameId }: { gameId?: string }) {
  const sports = usePlayerSports();
  const { account, ready: accountReady } = usePlatformSession();
  const favorites = useFavorites();
  const catalog = usePublicOfficialGames();
  const router = useRouter();
  const [selection, setSelection] = useState<string | null>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const games = useMemo(() => [
    ...(catalog.games ?? []), ...(sports?.demo ? playerDemoGames : []),
  ], [catalog.games, sports?.demo]);
  useEffect(() => {
    setClosed(previous => {
      const next = previous.filter(key => games.some(game => gameKey(game) === key && game.status === 'in_progress'));
      return next.length === previous.length ? previous : next;
    });
  }, [games]);
  const eligible = favoritesFirst(
    playerLiveGames(games, account && sports?.ready ? sports.teams : []).filter(game => !closed.includes(gameKey(game))),
    game => Boolean(favorites?.matchesGame(game)),
  );
  const selected = gameId
    ? eligible.find(game => game.gameId === gameId)
    : eligible.find(game => gameKey(game) === selection) ??
      eligible.find(game => sports?.selectedTeam?.tournamentId === game.tournamentId &&
        [game.homeTeamId, game.awayTeamId].includes(sports.selectedTeam.teamId)) ?? eligible[0];
  const error = sports?.error || catalog.error;
  const back = () => router.push('/');
  const example = selected && sports?.demo ? playerDemoSource(selected.gameId) : undefined;
  const observation = example ? calendarGameLive(example) : undefined;
  return <section className="calendarBrowser" aria-label={`Pizarras del ${sports?.role === 'manager' ? 'manager' : 'jugador'}`}>
    <header className="moduleHeader">
      <h1>Pizarra en vivo</h1>
      <p>Tablas de anotación y pizarra resumen de los juegos en curso de tus equipos. Solo lectura.</p>
    </header>
    {!accountReady ? <p role="status">Comprobando tu cuenta…</p> : !account ? <p className="managerCard managerStepCard">
      <Link href="/account">Inicia sesión en Mi cuenta</Link> para consultar los juegos en curso de tus equipos.
    </p> : error ? <div className="managerCard managerStepCard" role="alert">
      <p>{error}</p>
      <button type="button" className="managerButtonOutline" onClick={sports?.error ? sports.refresh : catalog.refresh}>Volver a cargar mis juegos en curso</button>
    </div> : !sports?.ready || catalog.games === null ? <p role="status">Consultando los juegos en curso de tus equipos…</p> :
      gameId && !selected ? <p className="managerCard managerStepCard" role="alert">
        Este juego no está en curso o no pertenece a tus equipos.
      </p> : !selected ? <div className="managerCard managerStepCard">
        <p role="status">No tienes juegos en curso con tus equipos.</p>
        <button type="button" className="managerButtonOutline" onClick={catalog.refresh}>Actualizar juegos en curso</button>
      </div> : <>
        {eligible.length > 1 ? <section className="managerCard managerStepCard" aria-label="Elegir juego en curso">
          <h2>Juegos en curso de mis equipos</h2>
          <div className="managerButtonRow">{eligible.map(game => <button type="button"
            className={gameKey(game) === gameKey(selected) ? 'managerButtonSolid' : 'managerButtonOutline'}
            key={gameKey(game)} aria-pressed={gameKey(game) === gameKey(selected)} onClick={() => {
              if (gameId) router.push(`/demo/live-scoring?view=public&game=${encodeURIComponent(game.gameId)}`);
              else setSelection(gameKey(game));
            }}>
            {game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}
            {' · '}{game.details?.tournamentName ?? game.tournamentId}
          </button>)}</div>
        </section> : null}
        <header className="managerCard managerStepCard">
          <h2><FavoriteInstitutionName id={selected.awayTeamId}>{selected.details?.awayTeamName ?? selected.awayTeamId}</FavoriteInstitutionName>
            {' vs. '}<FavoriteInstitutionName id={selected.homeTeamId}>{selected.details?.homeTeamName ?? selected.homeTeamId}</FavoriteInstitutionName></h2>
          <p>{selected.details?.tournamentName ?? selected.tournamentId}{example ? ' · Ejemplo' : ''}</p>
        </header>
        {example ? observation ? <PrivateScorecardView key={gameKey(selected)}
          apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring'}
          tournamentId={selected.tournamentId} gameId={selected.gameId} managerId=""
          homeId={`${example.id}:home`} awayId={`${example.id}:away`} ownSide="home"
          homeName={example.homeTeam} awayName={example.awayTeam} initialLineup={observation.state.lineups.home}
          positionLabels={fieldPositionLabels} observation={observation.state} onBack={back} /> :
          <p role="alert">Las tablas del juego de ejemplo no están disponibles.</p> :
          <OfficialRunScoring key={gameKey(selected)} publicView
            apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring'}
            gameId={selected.gameId} tournamentId={selected.tournamentId} teamNames={officialGameNames(selected)}
            onBack={back} backLabel="Volver a mi inicio" onState={state => {
              if (state.status !== 'in_progress') setClosed(previous =>
                previous.includes(gameKey(selected)) ? previous : [...previous, gameKey(selected)]);
            }} />}
      </>}
  </section>;
}
