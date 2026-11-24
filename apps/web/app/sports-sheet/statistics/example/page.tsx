'use client';

import { useState } from 'react';
import { exampleStatisticsGames, playerPlanLevels, trialPlans, type AccountProfile, type PlayerPlanLevel } from '@playsport/shared';
import Link from 'next/link';
import AccountStatistics from '../statistics-view';

export default function PlayerLevelsExamplePage() {
  const [level, setLevel] = useState<PlayerPlanLevel>(2);
  const plan = trialPlans.find(value => value.id === (level === 3 ? 'player' : 'player-numbers'));
  const account: AccountProfile = { id: '00000000-0000-4000-8000-000000000020', displayName: 'Álex Pelotero',
    email: 'jugador@example.test', createdAt: '2026-01-01T00:00:00.000Z', emailVerified: false,
    identityVerification: 'unavailable', financialAccess: false, features: level === 1 ? [] : [...plan!.features] };
  const officialGames = exampleStatisticsGames('player');
  const games = [...officialGames, ...officialGames.slice(0, 2).map((game, index) => ({
    ...game, kind: index === 0 ? 'friendly' as const : 'private' as const,
    tournamentId: index === 0 ? 'example-friendly' : 'example-private',
    tournamentName: index === 0 ? 'Amistoso de ejemplo' : 'Planilla privada de ejemplo',
    qualification: 'recorded' as const, public: false,
  }))];
  return <>
    <section className="moduleView playerLevelsExample"><header className="moduleHeader"><h1>Jugador · Comparar los tres niveles</h1>
      <p>Ejemplo ficticio de Álex Pelotero, separado de tu cuenta y de los partidos existentes. Solo lectura, sin activar accesos.</p>
      <Link href="/account/access" className="managerButtonOutline">Volver a mis accesos</Link></header>
      <nav className="managerButtonRow" aria-label="Nivel de Jugador del ejemplo">{playerPlanLevels.map(plan =>
        <button key={plan.level} type="button" aria-pressed={level === plan.level}
          className={level === plan.level ? 'managerButtonSolid' : 'managerButtonOutline'}
          onClick={() => setLevel(plan.level)}>Nivel {plan.level} · {plan.name}</button>)}</nav>
    </section>
    <AccountStatistics key={level} account={account} example={{ accountId: account.id, mode: 'player', source: 'example',
      identityVerified: false, analysisAllowed: level === 3, games: level === 1 ? [] : games }} />
  </>;
}
