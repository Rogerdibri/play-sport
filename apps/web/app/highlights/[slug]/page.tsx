import Link from 'next/link';
import { notFound } from 'next/navigation';
import { privateInningRuns, type Side } from '@playsport/shared';
import {
  homeEditorialExamples,
  homeExampleGames,
  homeExampleNotice,
  homeGameState,
} from '../../sports-home-examples';

export default async function HighlightPage({
  params,
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = homeExampleGames.find((item) => item.id === slug);
  const editorial = homeEditorialExamples.find((item) => item.id === slug);
  if (!game && !editorial) notFound();
  const state = game ? homeGameState(game) : null;
  const innings = Array.from({ length: 9 }, (_, index) => index + 1);
  return (
    <main className="landing sportsHomeDetail">
      <Link href="/" className="managerButtonOutline">Volver al inicio de mi rol</Link>
      <section className="sportsHomeFeature">
        <p className="eyebrow">{game ? `COPA DE LA COMUNIDAD · ${game.phase}` : editorial?.category}</p>
        <h1>{game ? `${game.away} vs. ${game.home}` : editorial?.title}</h1>
        {game ? (
          <p><time dateTime={game.date}>{game.date.slice(8)} de noviembre de 2026</time> · {game.time} · Béisbol · Venezuela</p>
        ) : <p>{editorial?.summary}</p>}
      </section>
      <p className="sportsHomeDetailNotice">{homeExampleNotice}</p>
      {game && state ? (
        <section className="managerCard">
          <h2>{game.status === 'live' ? 'Pizarra del encuentro' : 'Próximo encuentro'}</h2>
          <p>{game.status === 'live' ? 'Consulta de solo lectura. Este marcador no se actualiza desde un partido real.' : 'El encuentro todavía no ha comenzado. No hay resultado ni carreras anotadas.'}</p>
          {game.status === 'live' ? (
            <>
              <div className="sportsHomeScoreSummary" aria-label="Conteo del encuentro">
                <strong>Inning {state.inning} · {state.side === 'away' ? 'Alta' : 'Baja'}</strong>
                <span>Bolas: {state.balls}</span><span>Strikes: {state.strikes}</span><span>Outs: {state.outs}</span>
              </div>
              <p className="sportsHomeTableHint">Desliza la pizarra para ver los nueve innings y las carreras.</p>
              <div className="sportsHomeScoreTable" tabIndex={0} role="region" aria-label="Pizarra por innings">
                <table>
                  <caption>Marcador general · 9 innings</caption>
                  <thead><tr><th scope="col">Equipo</th>{innings.map((inning) => <th scope="col" key={inning}>{inning}</th>)}<th scope="col" aria-label="Carreras">C</th></tr></thead>
                  <tbody>{(['away', 'home'] as const).map((side: Side) => (
                    <tr key={side}><th scope="row">{game[side]}</th>
                      {innings.map((inning) => <td key={inning}>{privateInningRuns(state, side, inning) ?? '—'}</td>)}
                      <td><strong>{state.scores[side]}</strong></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          ) : <p><strong>{game.away}</strong> vs. <strong>{game.home}</strong> · {game.phase}</p>}
        </section>
      ) : editorial ? (
        <article className="managerCard sportsHomeArticle"><h2>{editorial.category}</h2><p>{editorial.body}</p></article>
      ) : null}
    </main>
  );
}
