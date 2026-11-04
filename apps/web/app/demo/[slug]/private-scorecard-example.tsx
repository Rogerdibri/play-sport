'use client';

import { useRouter } from 'next/navigation';
import { fieldPositionLabels } from './private-scorecard';
import { createPrivateScorecardExample } from './private-scorecard-example-data';
import PrivateScorecardView from './private-scorecard-view';

export default function PrivateScorecardExample() {
  const router = useRouter();
  const example = createPrivateScorecardExample();
  return (
    <section className="managerWorkspace" aria-label="Planilla privada de ejemplo">
      <PrivateScorecardView
        apiBase="" tournamentId="private-example" gameId="example-game" managerId="example-manager"
        homeId="example-home" awayId="example-away" ownSide="home"
        homeName={example.seed.names.home} awayName={example.seed.names.away}
        initialLineup={example.seed.lineups.home} positionLabels={fieldPositionLabels}
        example={example} onBack={() => router.push('/demo/live-scoring')}
      />
    </section>
  );
}
