'use client';

import Link from 'next/link';
import {
  calendarDateLabel,
  calendarDirectionsUrl,
  calendarExampleVenues,
  officialGameStatusLabels,
  playerDemoSource,
  type OfficialStandingGame,
} from '@playsport/shared';
import { CalendarGameHonors } from './calendar-game-details';
import OfficialResult from './official-result';
import {
  bettingPreviewHref,
  bettingPreviewOpen,
} from '../betting-preview/game-context';
import { InstitutionName } from '../../institutional-logos';
import { FavoriteInstitutionName } from '../../favorites';

export default function OfficialCalendarGame({
  game,
  showDate = false,
  example = false,
}: {
  game: OfficialStandingGame;
  showDate?: boolean;
  example?: boolean;
}) {
  const source = example ? playerDemoSource(game.gameId) : undefined;
  if (example && !source)
    throw new Error(
      'El partido no tiene una consulta asociada.',
    );
  const venue = source
    ? calendarExampleVenues.find((venue) => venue.id === source.venueId)
    : undefined;
  return (
    <article
      className="managerCard eventsGame"
      data-official-game-id={source ? undefined : game.gameId}
      data-player-game-id={game.gameId}
      data-game-id={source?.id}
      data-game-status={game.status}
    >
      <p>
        <InstitutionName kind="tournament" id={game.tournamentId}>
          {game.details?.tournamentName ?? game.tournamentId}
        </InstitutionName>{' '}
        · {officialGameStatusLabels[game.status]}
      </p>
      <h3>
        <FavoriteInstitutionName id={game.awayTeamId} example={Boolean(source)}>
          {game.details?.awayTeamName ?? game.awayTeamId}
        </FavoriteInstitutionName>{' '}
        vs.{' '}
        <FavoriteInstitutionName id={game.homeTeamId} example={Boolean(source)}>
          {game.details?.homeTeamName ?? game.homeTeamId}
        </FavoriteInstitutionName>
      </h3>
      <p>
        {showDate && game.details?.date
          ? `${calendarDateLabel(game.details.date)} · `
          : ''}
        {game.details?.time} · {game.details?.venue}
      </p>
      <p>
        {game.status === 'scheduled'
          ? 'Sin resultado registrado.'
          : `Marcador anotado: ${game.awayScore}–${game.homeScore}`}
      </p>
      {game.status === 'suspended' ? (
        <p>
          Nueva fecha pendiente. Fecha original: {game.details?.date}.{' '}
          {game.suspension?.reason}
        </p>
      ) : null}
      {source ? (
        game.status === 'final' ? (
          <CalendarGameHonors game={source} />
        ) : (
          <p>
            {game.status === 'in_progress'
              ? 'Seguimiento guardado.'
              : 'Programado, todavía sin jugadas.'}
          </p>
        )
      ) : (
        <OfficialResult game={game} />
      )}
      {!source || game.status === 'final' || game.status === 'in_progress' ? (
        <Link
          className="managerButtonOutline eventsDirectionsLink"
          href={`/demo/events-map?${source ? 'game' : 'official'}=${encodeURIComponent(source?.id ?? game.gameId)}`}
        >
          {source
            ? game.status === 'final'
              ? 'Ver resultado'
              : 'Ver pizarra'
            : game.status === 'final'
              ? 'Ver resultado y acta'
              : 'Ver partido oficial'}
        </Link>
      ) : null}
      {source && venue && game.status !== 'final' ? (
        <a
          className="managerButtonOutline eventsDirectionsLink"
          href={calendarDirectionsUrl(venue)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Cómo llegar a la sede
        </a>
      ) : null}
      {bettingPreviewOpen(game.status) ? (
        <div className="ctaRow">
          <Link
            className="cta managerButtonSolid"
            href={bettingPreviewHref(
              source ? 'example' : 'official',
              source?.id ?? game.gameId,
            )}
            aria-label={`Apostar: ${game.details?.awayTeamName ?? game.awayTeamId} contra ${game.details?.homeTeamName ?? game.homeTeamId}`}
          >
            Apostar
          </Link>
        </div>
      ) : null}
    </article>
  );
}
