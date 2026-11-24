'use client';

import Link from 'next/link';
import { useState } from 'react';
import { platformRoles, type PlatformRoleId } from '@playsport/shared';
import {
  homeEditorialExamples,
  homeExampleGames,
  homeExampleNotice,
  homeGamesForFilter,
  homeGameState,
  homeHighlightFilters,
  homeHighlightHref,
  type HomeHighlightFilter,
} from './sports-home-examples';

export default function SportsHomeHighlights({ role }: { role: PlatformRoleId }) {
  const [filter, setFilter] = useState<HomeHighlightFilter>('all');
  const games = homeGamesForFilter(filter);
  const featured = games[0];
  const featuredState = featured ? homeGameState(featured) : null;
  const roleLabel = platformRoles.find((item) => item.id === role)?.label;
  return (
    <section className="sportsHome" aria-label={`Inicio deportivo de ${roleLabel}`}>
      <header className="sportsHomeHeading">
        <div>
          <p className="eyebrow">EL JUEGO NO SE DETIENE</p>
          <h2>Tu jornada deportiva</h2>
          <p>Encuentros, comunidad y oportunidades para seguir conectado al deporte.</p>
        </div>
        <details className="sportsHomeNotice">
          <summary>Sobre esta vista de prueba</summary>
          <p>{homeExampleNotice}</p>
        </details>
      </header>

      <div className="sportsHomeTicker" aria-label="Marcadores de la jornada de referencia">
        {homeExampleGames.map((game) => {
          const state = homeGameState(game);
          return (
            <Link href={homeHighlightHref(game.id)} key={game.id} className="sportsHomeTickerGame">
              <span className="sportsHomeStatus" data-status={game.status}>
                {game.status === 'live' ? 'En juego' : `${game.date.slice(8)} NOV · ${game.time}`}
              </span>
              <span>{game.away}<b>{game.status === 'live' ? state.scores.away : '—'}</b></span>
              <span>{game.home}<b>{game.status === 'live' ? state.scores.home : '—'}</b></span>
            </Link>
          );
        })}
      </div>

      <div className="sportsHomeFilters" role="group" aria-label="Filtrar destacados">
        {homeHighlightFilters.map((item) => (
          <button type="button" key={item.id} aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="sportsHomeMain">
        {featured && featuredState ? (
          <article className="sportsHomeFeature" data-home-game-id={featured.id}>
            <p className="eyebrow">PARTIDO PROTAGONISTA · {featured.phase}</p>
            <h3>{featured.away}<span>vs.</span>{featured.home}</h3>
            <div className="sportsHomeFeatureScore" aria-label="Marcador del partido protagonista">
              {featured.status === 'live'
                ? `${featuredState.scores.away} — ${featuredState.scores.home}`
                : featured.time}
              <small>{featured.status === 'live' ? `En juego · Inning ${featuredState.inning}` : 'Próximo encuentro'}</small>
            </div>
            <p>Copa de la Comunidad · Béisbol</p>
            <p><time dateTime={featured.date}>{featured.date.slice(8)} de noviembre de 2026</time> · {featured.time} · Venezuela</p>
            <Link className="managerButtonSolid" href={homeHighlightHref(featured.id)}>
              {featured.status === 'live' ? 'Ver pizarra' : 'Ver encuentro'}
            </Link>
          </article>
        ) : <p role="status">No hay encuentros en esta selección.</p>}

        <section className="sportsHomeGames" aria-label="Encuentros destacados">
          <h3>{homeHighlightFilters.find((item) => item.id === filter)?.label}</h3>
          <p className="sportsHomeDate">Jornada de referencia · 13 NOV 2026</p>
          {games.map((game) => (
            <article className="sportsHomeGame" key={game.id} data-home-game-id={game.id}>
              <div className="sportsHomeGameMeta">
                <span>{game.phase}</span>
                <span>{game.status === 'live' ? 'En juego' : `${game.date.slice(8)} NOV · ${game.time}`}</span>
              </div>
              <h4>{game.away} <span>vs.</span> {game.home}</h4>
              <Link href={homeHighlightHref(game.id)}>Consultar encuentro <span aria-hidden="true">→</span></Link>
            </article>
          ))}
        </section>
      </div>

      <div className="sportsHomeEditorial">
        {homeEditorialExamples.slice(0, 2).map((item) => (
          <article className={`sportsHomeStory sportsHomeStory-${item.id}`} key={item.id}>
            <p className="eyebrow">{item.category}</p>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            <Link href={homeHighlightHref(item.id)}>{item.action} <span aria-hidden="true">→</span></Link>
          </article>
        ))}
      </div>
    </section>
  );
}
