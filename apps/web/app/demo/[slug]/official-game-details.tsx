'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calendarDateLabel, officialGameNames } from '@playsport/shared';
import { useScreenBack } from '../../navigation-hooks';
import usePublicOfficialGames from './use-public-official-games';
import OfficialRunScoring from './official-run-scoring';
import { InstitutionName } from '../../institutional-logos';
import PublicShare from '../../public-share';
import { FavoriteInstitutionName } from '../../favorites';

export default function OfficialGameDetails({ gameId, onBack }: { gameId: string; onBack?: () => void }) {
  const { games, error, refresh } = usePublicOfficialGames();
  const router = useRouter();
  const goBack = onBack ?? (() => router.push('/demo/events-map'));
  useScreenBack(goBack, true);
  const game = games?.find(item => item.gameId === gameId);
  return <section className="eventsGameDetails">
    {onBack ? <button type="button" className="managerButtonOutline" onClick={goBack}>Volver a mis partidos asignados</button> :
      <Link className="managerButtonOutline" href="/demo/events-map">Volver a la cartelera</Link>}
    <button className="managerButtonOutline" type="button" onClick={refresh}>Actualizar resultado oficial</button>
    {error ? <p role="alert">{error}</p> : !games ? <p role="status">Consultando partido oficial…</p> :
      !game ? <p role="alert">Este partido oficial no está disponible. No se sustituye por un juego de ejemplo.</p> : <>
        <header className="moduleHeader">
          <p className="eyebrow">PARTIDO OFICIAL · SOLO LECTURA</p>
          <h1><FavoriteInstitutionName id={game.awayTeamId}>{game.details?.awayTeamName ?? game.awayTeamId}</FavoriteInstitutionName> vs. <FavoriteInstitutionName id={game.homeTeamId}>{game.details?.homeTeamName ?? game.homeTeamId}</FavoriteInstitutionName></h1>
          <p><InstitutionName kind="tournament" id={game.tournamentId}>{game.details?.tournamentName ?? game.tournamentId}</InstitutionName></p>
          {game.details ? <p>{game.status === 'suspended' ? 'Nueva fecha pendiente · Fecha original: ' : ''}{calendarDateLabel(game.details.date)} · {game.details.time} · {game.details.venue}</p> : <p>Fecha y sede pendientes de configurar.</p>}
        </header>
        <PublicShare key={game.gameId} path={`/demo/events-map?official=${encodeURIComponent(game.gameId)}`}
          title={`${game.details?.awayTeamName ?? game.awayTeamId} vs. ${game.details?.homeTeamName ?? game.homeTeamId} · PlaySport`} />
        <OfficialRunScoring key={`${game.tournamentId}:${game.gameId}`} publicView
          apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring'}
          gameId={game.gameId} tournamentId={game.tournamentId} teamNames={officialGameNames(game)}
          onBack={goBack} backLabel={onBack ? 'Volver a mis partidos asignados' : 'Volver a la cartelera'} />
      </>}
  </section>;
}
