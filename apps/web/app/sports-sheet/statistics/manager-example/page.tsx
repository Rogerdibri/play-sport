'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { calculateStatisticsRates, exampleStatisticsGames, managerPlanLevels, scorecardStatistics,
  statisticsExampleObservation, trialPlans, type AccountProfile, type ManagerStatisticsPlayer, type ManagerPlanLevel } from '@playsport/shared';
import AccountStatistics from '../statistics-view';

export default function ManagerLevelsExamplePage() {
  const [level, setLevel] = useState<ManagerPlanLevel>(2);
  const [finished, setFinished] = useState(false);
  const games = useMemo(() => exampleStatisticsGames('team'), []);
  const players: ManagerStatisticsPlayer[] = games.flatMap(game => {
    const state = statisticsExampleObservation(game.gameId);
    return state.seed.lineups.away.map((player, index) => ({ id: `player-${index.toString(16).padStart(64, '0')}`,
      name: player.name, activeTournament: game.tournamentId === 'example-stats-baseball' && !finished,
      game: { ...game, positions: [player.position], line: calculateStatisticsRates(scorecardStatistics(state, 'away', [player.id], {
        team: false, positions: [player.position], caughtStealing: 0, errors: 0, offenseId: 'away',
        startingPitcherIds: [state.seed.lineups.away[0].id], pitchingComplete: true,
      }), game.eraBase) } }));
  });
  const plan = trialPlans.find(value => value.id === (level === 3 ? 'manager' : 'manager-numbers'));
  const account: AccountProfile = { id: '00000000-0000-4000-8000-000000000030', displayName: 'Manager del Lago',
    email: 'manager@example.test', createdAt: '2026-01-01T00:00:00.000Z', emailVerified: false,
    identityVerification: 'unavailable', financialAccess: false, features: level === 1 ? [] : [...plan!.features] };
  return <>
    <section className="moduleView playerLevelsExample"><header className="moduleHeader"><h1>Manager · Comparar los tres niveles</h1>
      <p>Ejemplo de solo lectura, separado de tu cuenta: Relámpagos participa en dos torneos. Cada inscripción activa consume un cupo;
        el torneo de softbol está cerrado y conserva sus partidos. Nivel 3 permite inscripciones ilimitadas;
        las estadísticas de cada jugador se consultan solo por juego, nunca acumuladas.</p>
      <Link href="/account/access" className="managerButtonOutline">Volver a mis accesos</Link></header>
      <nav className="managerButtonRow" aria-label="Nivel de Manager del ejemplo">{managerPlanLevels.map(plan =>
        <button key={plan.level} type="button" aria-pressed={level === plan.level}
          className={level === plan.level ? 'managerButtonSolid' : 'managerButtonOutline'}
          onClick={() => setLevel(plan.level)}>Nivel {plan.level} · {plan.name} · {plan.limit === null ? 'Inscripciones ilimitadas' :
            `${plan.limit} ${plan.limit === 1 ? 'cupo' : 'cupos'}`}</button>)}</nav>
      <button className="managerButtonOutline" type="button" aria-pressed={finished} onClick={() => setFinished(value => !value)}>
        {finished ? 'Reabrir el torneo del ejemplo' : 'Finalizar el torneo del ejemplo'}</button>
    </section>
    <AccountStatistics key={`${level}:${finished}`} account={account} example={{ accountId: account.id, mode: 'team', source: 'example',
      identityVerified: false, analysisAllowed: level === 3, games: level === 1 ? [] : games, players: level === 1 ? [] : players }} />
  </>;
}
