'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fieldPositionLabels, scorecardPracticeCommands, scorecardPracticeScenarios as scenarios } from './private-scorecard';
import { createPrivateScorecardExample } from './private-scorecard-example-data';
import PrivateScorecardView from './private-scorecard-view';

export default function PrivateScorecardExample() {
  const router = useRouter();
  const [scenario, setScenario] = useState('third');
  const example = createPrivateScorecardExample();
  example.commands = scorecardPracticeCommands(example.seed, scenario);
  return (
    <section className="managerWorkspace" aria-label="Planilla privada de ejemplo">
      <article className="managerCard managerStepCard">
        <h1>Práctica del anotador</h1>
        <p>Ejercicios ficticios guardados aparte. No modifican partidos ni estadísticas oficiales.</p>
        <label className="managerField"><span>Ejercicio</span>
          <select value={scenario} onChange={event => {
            if (Object.hasOwn(scenarios, event.currentTarget.value)) setScenario(event.currentTarget.value);
          }}>{Object.entries(scenarios).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}</select>
        </label>
      </article>
      <PrivateScorecardView
        key={scenario} apiBase="" tournamentId="scoring-practice-v1" gameId={`practice-${scenario}`} managerId="example-manager"
        homeId="example-home" awayId="example-away" ownSide="home"
        homeName={example.seed.names.home} awayName={example.seed.names.away}
        initialLineup={example.seed.lineups.home} positionLabels={fieldPositionLabels}
        example={scenario === 'contextualChanges' ? { ...example, presentSubstitutes: {
          home: example.seed.rosters.home.filter(player => !example.seed.lineups.home.some(active => active.id === player.id)).slice(0, 2).map(player => player.id),
          away: example.seed.rosters.away.filter(player => !example.seed.lineups.away.some(active => active.id === player.id)).slice(0, 1).map(player => player.id),
        } } : example} onBack={() => router.push('/demo/live-scoring')}
      />
    </section>
  );
}
