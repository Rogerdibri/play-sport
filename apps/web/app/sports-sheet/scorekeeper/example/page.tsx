'use client';

import { useMemo, useState } from 'react';
import { calculateStatisticsRates, exampleStatisticsGames, scorecardStatistics, scorekeeperPlanLevels, statisticsExampleObservation,
  trialPlans, type AccountProfile, type OfficialGameSummary, type ScorekeeperPlanLevel } from '@playsport/shared';
import ScorekeeperPlanLevels from '../../../account/access/scorekeeper-plan-levels';
import ScorekeeperStatisticsView, { type ScorekeeperStatisticsExample } from '../scorekeeper-statistics-view';
import ScorekeeperSubstitutionsPanel from '../../../demo/[slug]/scorekeeper-substitutions';

export default function ScorekeeperExamplePage() {
  const [level, setLevel] = useState<ScorekeeperPlanLevel>(2);
  const fixture = useMemo(() => {
    const accountId = '00000000-0000-4000-8000-000000000040', statistics = exampleStatisticsGames('team');
    const games: OfficialGameSummary[] = statistics.map(game => ({
      gameId: game.gameId, tournamentId: game.tournamentId, homeTeamId: 'home', awayTeamId: game.teamId,
      status: game.status, homeScore: 0, awayScore: 0, details: {
        tournamentName: game.tournamentName, awayTeamName: game.teamName, homeTeamName: game.opponentName,
        date: game.date ?? '2026-01-01', time: '10:00', venue: 'Campo del Lago',
      }, assignedScorekeeperIds: ['example-scorer'],
      availableScorekeeperIds: ['example-scorer'], scoringBlockReason: null,
    }));
    const tournaments = [...new Map(statistics.map(game => [game.tournamentId, {
      tournamentId: game.tournamentId, tournamentName: game.tournamentName, active: true, enabled: true,
    }])).values()];
    const rows = statistics.map(game => {
      const state = statisticsExampleObservation(game.gameId);
      return { accountId, tournamentId: game.tournamentId, gameId: game.gameId, games: [game], totals: [],
        players: state.seed.lineups.away.map((player, index) => ({ id: `player-${index.toString(16).padStart(64, '0')}`,
          name: player.name, activeTournament: true, game: { ...game, positions: [player.position],
            line: calculateStatisticsRates(scorecardStatistics(state, 'away', [player.id], {
              team: false, positions: [player.position], caughtStealing: 0, errors: 0, offenseId: 'away',
              startingPitcherIds: [state.seed.lineups.away[0].id], pitchingComplete: true,
            }), game.eraBase) } })) };
    });
    return { accountId, games, tournaments, statistics: rows };
  }, []);
  const plan = trialPlans.find(plan => plan.id === (level === 3 ? 'scorekeeper' : 'scorekeeper-numbers'))!;
  const account: AccountProfile = { id: fixture.accountId, email: 'scorer@example.test', displayName: 'Anotador del Lago',
    createdAt: '2026-01-01T00:00:00.000Z', emailVerified: false, identityVerification: 'unavailable', financialAccess: false,
    features: level === 1 ? [] : [...plan.features] };
  const example: ScorekeeperStatisticsExample = { games: fixture.games, statistics: fixture.statistics,
    access: { accountId: account.id, level, limit: scorekeeperPlanLevels[level - 1].limit, revision: 0, selectionRequired: false,
      tournaments: fixture.tournaments.map((team, index) => ({ ...team, enabled: level !== 1 || index === 0 })), extras: [] } };
  return <>
    <section className="moduleView administrationPage"><header className="moduleHeader"><h1>Anotador · Comparar los tres niveles</h1>
      <p>Ejemplo de solo lectura, separado de tu cuenta. Dos torneos y varios partidos para comprobar que los acumulados nunca se mezclan.</p></header>
      <nav className="managerButtonRow" aria-label="Nivel de Anotador del ejemplo">{scorekeeperPlanLevels.map(plan =>
        <button key={plan.level} className={level === plan.level ? 'managerButtonSolid' : 'managerButtonOutline'}
          aria-pressed={level === plan.level} onClick={() => setLevel(plan.level)}>Nivel {plan.level} · {plan.name}</button>)}</nav>
      <ScorekeeperPlanLevels currentLevel={level} />
      <ScorekeeperSubstitutionsPanel tournamentId={fixture.games[0].tournamentId} gameId={fixture.games[0].gameId} status="scheduled"
        example={{ accountId: fixture.accountId, tournamentId: fixture.games[0].tournamentId, gameId: fixture.games[0].gameId, revision: 1,
          members: [{ actorId: 'person:example-substitute', name: 'Suplente del Lago', status: 'granted' }],
          audit: [{ revision: 1, actorId: 'person:example-substitute', organizerId: 'person:example-organizer', action: 'grant',
            reason: 'Ausencia temporal del titular · Solo el partido indicado', at: '2026-01-01T10:00:00.000Z' }] }} />
    </section>
    <ScorekeeperStatisticsView key={level} account={account} example={example} />
  </>;
}
