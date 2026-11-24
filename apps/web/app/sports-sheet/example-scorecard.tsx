'use client';

import { fieldPositionLabels, type PrivateState } from '@playsport/shared';
import PrivateScorecardView from '../demo/[slug]/private-scorecard-view';

export default function SportsSheetExampleScorecard({ observation, tournamentId, gameId, onBack }: {
  observation: PrivateState; tournamentId: string; gameId: string; onBack: () => void;
}) {
  return <PrivateScorecardView observation={observation} onBack={onBack}
    apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? '/api/official-scoring'}
    tournamentId={tournamentId} gameId={gameId} managerId="" homeId="example-stats-guardianes"
    awayId="example-stats-relampagos" ownSide="away" homeName={observation.seed.names.home}
    awayName={observation.seed.names.away} initialLineup={observation.lineups.away} positionLabels={fieldPositionLabels} />;
}
