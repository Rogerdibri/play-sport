'use client';

import Link from 'next/link';
import { useState } from 'react';
import { calendarDateLabel, calendarExampleVenues, demoStandings, isTeamSportsRole, standingsLeagues, standingsLegend, standingsRule, favoritesFirst, playerDemoTournaments } from '@playsport/shared';
import { useScreenBack } from '../../navigation-hooks';
import OfficialStandings from './official-standings';
import { ExampleTeamName, ExampleTeamText } from '../../institutional-logos';
import { usePlatformSession } from '../../platform-session';
import { usePlayerSports } from '../../player-sports-context';
import { PlayerSportsFilters } from '../../player-sports-controls';
import { FavoriteButton, useFavorites } from '../../favorites';

export default function Standings() {
  const { session } = usePlatformSession();
  const sports = usePlayerSports();
  if (isTeamSportsRole(session?.role)) return <section className="standingsView">
    <header className="moduleHeader"><h1>Tabla de posiciones</h1>
      <p>Consulta la clasificación completa de tu torneo o explora otras ligas.</p></header>
    <PlayerSportsFilters />
    {sports?.ready ? <><p>La clasificación siempre incluye todos los partidos del torneo, aunque selecciones un equipo o una zona.</p><OfficialStandings /></> : null}
  </section>;
  return <GeneralStandings />;
}

function GeneralStandings() {
  const favorites = useFavorites();
  const [leagueId, setLeagueId] = useState<string>(standingsLeagues[0].id);
  const [tournament, setTournament] = useState<string>(standingsLeagues[0].tournaments[0]);
  const [team, setTeam] = useState<string | null>(null);
  const { league, rows, completed } = demoStandings(leagueId, tournament);
  const showDraws = rows.some(row => row.ties > 0);
  const selected = rows.find(row => row.team === team);
  const leagues = favoritesFirst(standingsLeagues, item => Boolean(favorites?.isFavorite({ kind: 'league', id: `example-player-league:${item.id}` })));
  const exampleTournament = playerDemoTournaments.find(item => item.leagueId === `example-player-league:${leagueId}` && item.name === tournament);
  useScreenBack(() => setTeam(null), Boolean(selected));
  return <section className="standingsView">
    <header className="moduleHeader">
      <h1>Tabla de posiciones</h1>
      <p>Selecciona la liga y el torneo para consultar la clasificación y los resultados de cada equipo.</p>
    </header>
    <OfficialStandings />
    <section className="managerCard managerStepCard">
      <h2>Tablas de posiciones</h2>
      <div className="favoriteName"><strong>{league.name}</strong><FavoriteButton kind="league" id={`example-player-league:${leagueId}`} name={league.name} /></div>
      <div className="profileFieldGrid">
        <label className="managerField"><span>Liga</span><select value={leagueId} onChange={event => {
          const next = standingsLeagues.find(item => item.id === event.target.value);
          if (!next) throw new Error('La liga seleccionada no está disponible.');
          setLeagueId(next.id); setTournament(next.tournaments[0]); setTeam(null);
        }}>{leagues.map(item => <option key={item.id} value={item.id}>{favorites?.isFavorite({ kind: 'league', id: `example-player-league:${item.id}` }) ? 'Favorito · ' : ''}{item.name}</option>)}</select></label>
        <label className="managerField"><span>Torneo / temporada</span><select value={tournament} onChange={event => {
          setTournament(event.target.value); setTeam(null);
        }}>{league.tournaments.map(name => <option key={name}>{name}</option>)}</select></label>
      </div>
      <p>{standingsRule}</p>
      <p className="eventsTimezone">{completed} juegos finalizados computados · Ronda eliminatoria</p>
      {!completed ? <p role="status">Este torneo todavía no tiene juegos finalizados. Los equipos aparecen sin posición.</p> : null}
      <p className="eventsTimezone">En pantallas pequeñas, desliza la tabla horizontalmente para ver todos los datos.</p>
      <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label="Tabla de posiciones, desplazamiento horizontal">
        <table className="scorecardTable standingsTable">
          <caption>{tournament}</caption>
          <thead><tr><th scope="col">Pos.</th><th scope="col">Equipo</th>
            {['JJ', 'JG', 'JP', ...(showDraws ? ['JE'] : []), 'PCT', 'CF', 'CC', 'DIF', 'Racha'].map(label => <th key={label} scope="col">{label}</th>)}
          </tr></thead>
          <tbody>{rows.map((row, index) => {
            const favoriteTeam = exampleTournament?.teams.find(item => item.name === row.team);
            return <tr key={row.team} aria-selected={row.team === team}>
            <td>{row.rank ?? '—'}</td>
            <th scope="row"><button type="button" className="standingsTeam" aria-label={`Ver detalle de ${row.team}`}
              aria-expanded={row.team === team} aria-controls="standing-team-details"
              aria-describedby={row.direct ? `standing-direct-${index}` : undefined} onClick={() => setTeam(row.team)}><ExampleTeamName>{row.team}</ExampleTeamName></button>
              {favoriteTeam ? <FavoriteButton kind="team" id={favoriteTeam.id} name={row.team} /> : null}
              {row.direct ? <small id={`standing-direct-${index}`} className="standingsDirect">
                {row.direct.wins === row.direct.losses ? 'Desempate pendiente' : <>Directo {row.direct.wins}–{row.direct.losses} vs. <ExampleTeamName>{row.direct.opponent}</ExampleTeamName></>}
              </small> : null}</th>
            <td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td>{showDraws ? <td>{row.ties}</td> : null}
            <td>{row.percentage === null ? '—' : row.percentage.toFixed(3)}</td>
            <td>{row.runsFor}</td><td>{row.runsAgainst}</td><td>{row.differential > 0 ? '+' : ''}{row.differential}</td><td>{row.streak}</td>
          </tr>;
          })}</tbody>
        </table>
      </div>
      <p className="eventsTimezone">{showDraws ? 'JE: juegos empatados · ' : ''}{standingsLegend} Racha: {showDraws ? 'G/P/E' : 'G/P'} y cantidad consecutiva. Pulsa un equipo para ver su detalle.</p>
    </section>
    {selected ? <section id="standing-team-details" className="managerCard managerStepCard" aria-labelledby="standing-team-title">
      <div className="managerButtonRow"><h2 id="standing-team-title"><ExampleTeamName>{selected.team}</ExampleTeamName></h2>
        <button className="managerButtonOutline" type="button" onClick={() => setTeam(null)}>Cerrar detalle</button></div>
      <p><strong>{selected.rank ? `Posición ${selected.rank}` : 'Sin posición'}</strong> · {selected.played} jugados · {selected.wins} ganados · {selected.losses} perdidos{selected.ties > 0 ? ` · ${selected.ties} empatados` : ''}</p>
      <p><ExampleTeamText teams={rows.map(row => row.team)}>{selected.explanation}</ExampleTeamText></p>
      <p>{selected.runsFor} carreras a favor · {selected.runsAgainst} en contra · Diferencial {selected.differential > 0 ? '+' : ''}{selected.differential}</p>
      <h3>Partidos que sustentan su posición</h3>
      {!selected.results.length ? <p>No tiene juegos finalizados en este torneo. Los juegos en curso, programados y cancelados no suman resultados.</p> :
        <ul className="standingsResults">{[...selected.results].reverse().map(result => {
          const venue = calendarExampleVenues.find(item => item.id === result.venueId);
          if (!venue) throw new Error('Un resultado de la tabla no tiene una sede registrada.');
          return <li key={result.gameId}>
            <div><strong>{result.outcome === 'G' ? 'Ganó' : result.outcome === 'P' ? 'Perdió' : 'Empató'} {result.runsFor}–{result.runsAgainst}</strong> vs. <ExampleTeamName>{result.opponent}</ExampleTeamName>
              {selected.direct?.opponent === result.opponent ? <small className="standingsDirect">Enfrentamiento directo</small> : null}
              <p>{calendarDateLabel(result.date)} · {result.time} · {venue.name}</p></div>
            <Link className="managerButtonOutline" href={`/demo/events-map?game=${encodeURIComponent(result.gameId)}`}>Ver juego</Link>
          </li>;
        })}</ul>}
    </section> : <p className="eventsTimezone">Selecciona un equipo para consultar por qué ocupa esa posición.</p>}
  </section>;
}
