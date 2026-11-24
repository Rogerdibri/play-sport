'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { calendarDateLabel, calendarResultSummary, calendarScoreLabel, fieldPositionLabels, privateStats } from '@playsport/shared';
import { useScreenBack } from '../../navigation-hooks';
import { calendarGameArchive, calendarGameAwards, calendarGameLive } from './event-archives';
import { calendarExampleGames, calendarExampleVenues, type CalendarExampleGame } from './event-examples';
import PrivateInningCell from './private-inning-cell';
import PrivateScorecardView from './private-scorecard-view';
import GameChat from './game-chat';
import { ExampleTeamName, ExampleTeamText } from '../../institutional-logos';

export function CalendarGameHonors({ game }: { game: CalendarExampleGame }) {
  const awards = calendarGameAwards(game);
  const tie = game.score?.home === game.score?.away;
  return <dl className="eventsHonors">
    <div><dt>Pitcher ganador</dt><dd>{tie ? 'No aplica (empate)' : awards?.winner ?? 'Pendiente de confirmación'}</dd></div>
    <div><dt>Pitcher perdedor</dt><dd>{tie ? 'No aplica (empate)' : awards?.loser ?? 'Pendiente de confirmación'}</dd></div>
    {awards?.saver ? <div><dt>Pitcher salvador</dt><dd>{awards.saver}</dd></div> : null}
    {!tie && !awards ? <div><dt>Salvamento</dt><dd>Pendiente de confirmación</dd></div> : null}
    <div><dt>MVP</dt><dd>{awards?.mvp ?? 'Pendiente de confirmación'}</dd></div>
  </dl>;
}

export default function CalendarGameDetails({ gameId, onBack, backLabel = 'Volver a la cartelera' }: { gameId: string; onBack?: () => void; backLabel?: string }) {
  const router = useRouter();
  const back = onBack ?? (() => router.push('/demo/events-map'));
  const backControl = onBack ? <button type="button" className="managerButtonOutline" onClick={back}>{backLabel}</button> :
    <Link href="/demo/events-map" className="managerButtonOutline">{backLabel}</Link>;
  useScreenBack(back, true);
  const game = calendarExampleGames.find(item => item.id === gameId && (item.status === 'finished' || item.status === 'live'));
  if (!game) return <section className="managerCard">
    <h1>Juego no disponible</h1>
    <p role="alert">No se encontró un juego en curso o finalizado con ese identificador.</p>
    {backControl}
  </section>;
  const venue = calendarExampleVenues.find(item => item.id === game.venueId);
  if (!venue) throw new Error('El juego archivado no tiene una sede registrada.');
  const live = game.status === 'live';
  const archive = live ? calendarGameLive(game) : calendarGameArchive(game);
  const innings = Array.from({ length: archive?.innings.away.length ?? game.score?.innings ?? 0 }, (_, index) => index + 1);
  if (live && archive) return <section className="eventsGameDetails">
    {backControl}
    <section className="officialScorecard" aria-label="Consulta del juego seleccionado en la cartelera">
      <div className="managerCard">
        <strong>{game.tournament}</strong>
        <p>{calendarDateLabel(game.date)} · <time dateTime={`${game.date}T${game.time}`}>{game.time}</time> · {venue.name}</p>
        <p>Seguimiento del partido · Solo lectura.</p>
      </div>
      <PrivateScorecardView key={game.id}
        matchChat={<GameChat gameId={game.id} example />}
        apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring'}
        tournamentId={game.tournament} gameId={game.id} managerId=""
        homeId={`${game.id}:home`} awayId={`${game.id}:away`} ownSide="home"
        homeName={game.homeTeam} awayName={game.awayTeam}
        initialLineup={archive.state.lineups.home} positionLabels={fieldPositionLabels}
        observation={archive.state} onBack={back} />
    </section>
  </section>;
  return <section className="eventsGameDetails">
    {backControl}
    <header className="moduleHeader">
      <p className="eyebrow">{live ? 'JUEGO EN CURSO' : 'JUEGO FINALIZADO'} · SOLO LECTURA</p>
      <h1><ExampleTeamName>{game.awayTeam}</ExampleTeamName> vs. <ExampleTeamName>{game.homeTeam}</ExampleTeamName></h1>
      <p>{game.tournament} · {calendarDateLabel(game.date)} · <time dateTime={`${game.date}T${game.time}`}>{game.time}</time></p>
      <p>{venue.name}</p>
      <p className="eventsScore"><ExampleTeamText teams={[game.homeTeam, game.awayTeam]}>{calendarScoreLabel(game)}</ExampleTeamText></p>
      {live ? <p>Seguimiento del partido.</p> : <>
        <p><ExampleTeamText teams={[game.homeTeam, game.awayTeam]}>{calendarResultSummary(game)}</ExampleTeamText></p>
        <CalendarGameHonors game={game} />
      </>}
    </header>
    <GameChat gameId={game.id} example />
    {!archive ? <p role="status" className="managerCard">
      {live ? 'El detalle del seguimiento y las hojas de anotación no están disponibles para este juego.' :
        'Las hojas de anotación y la pizarra por entradas todavía no están archivadas para este juego.'}
      {' '}El resultado se conserva sin reconstruir datos faltantes.
    </p> : <>
      <section className="managerCard" aria-labelledby="archive-score-title">
        <h2 id="archive-score-title">Pizarra resumen</h2>
        <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label="Pizarra por entradas, desplazamiento horizontal"><table className="scorecardTable">
          <caption>Marcador por entradas · {live ? 'En curso' : 'Finalizado'}</caption>
          <thead><tr><th scope="col">Equipo</th>{innings.map(inning => <th scope="col" key={inning}>{inning}</th>)}
            <th scope="col">Carreras</th><th scope="col">Imparables</th><th scope="col">Errores</th></tr></thead>
          <tbody>{(['away', 'home'] as const).map(side => <tr key={side}>
            <th scope="row"><ExampleTeamName>{archive.state.seed.names[side]}</ExampleTeamName></th>
            {archive.innings[side].map((runs, index) => <td key={index}
              aria-current={live && archive.state.inning === index + 1 && archive.state.side === side ? 'true' : undefined}>
              {runs === null ? live ? '—' : 'X' : runs}
            </td>)}
            <td>{archive.state.scores[side]}</td>
            <td>{archive.state.seed.lineups[side].reduce((total, player) => total + privateStats(archive.state, side, player.id).hits, 0)}</td>
            <td>0</td>
          </tr>)}</tbody>
        </table></div>
        <p>{live ? '—: media entrada todavía no disputada. La entrada actual muestra su marcador parcial.' : 'X: no se disputó esa media entrada.'}</p>
      </section>
      {(['away', 'home'] as const).map(side => <article className="scorecardPreview" key={side}>
        <header className="scorecardPreviewHeader"><div>
          <p className="eyebrow">HOJA DE ANOTACIÓN {live ? 'DEL JUEGO EN CURSO' : 'ARCHIVADA'} · EJEMPLO · SOLO LECTURA</p>
          <h2><ExampleTeamName>{archive.state.seed.names[side]}</ExampleTeamName></h2>
          <p>Mantén pulsada una actuación para ver el detalle; con teclado, mantén Espacio o Enter.</p>
        </div></header>
        <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label={`Hoja de ${archive.state.seed.names[side]}, desplazamiento horizontal`}><table className="scorecardTable privateScorecardTable">
          <caption>Hoja de anotación · <ExampleTeamName>{archive.state.seed.names[side]}</ExampleTeamName></caption>
          <thead><tr><th scope="col" className="scorecardPlayerHeading">Jugador y turno</th>
            {innings.map(inning => <th scope="col" key={inning}>Entrada {inning}</th>)}
            {['Apariciones', 'Turnos al bate', 'Imparables', 'Promedio', 'Jonrones', 'Bases por bolas', 'Ponches', 'Carreras', 'Impulsadas', 'Robos'].map(label => <th scope="col" key={label}>{label}</th>)}
          </tr></thead>
          <tbody>{archive.state.seed.lineups[side].map(player => {
            const stats = privateStats(archive.state, side, player.id);
            return <tr key={player.id}>
              <th scope="row" className="scorecardPlayer"><span className="scorecardPlayerInfo">
                <strong>{player.order} · {player.name}</strong><small>#{player.jersey} · {fieldPositionLabels[player.position]}</small>
              </span></th>
              {innings.map(inning => <td className="privateInningCell" key={inning}>
                <PrivateInningCell playerId={player.id} playerName={player.name} inning={inning}
                  entries={archive.state.log.filter(entry => entry.side === side && entry.inning === inning &&
                    (entry.batterId === player.id || entry.runnerId === player.id || entry.runs.includes(player.id) || entry.stolenBy === player.id))} />
              </td>)}
              {[stats.pa, stats.atBats, stats.hits, stats.average, stats.homeRuns, stats.walks, stats.strikeouts, stats.runs, stats.rbis, stats.steals].map((value, index) => <td key={index}>{value}</td>)}
            </tr>;
          })}</tbody>
        </table></div>
      </article>)}
    </>}
  </section>;
}
