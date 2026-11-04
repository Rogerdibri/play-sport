'use client';

import type { PersonnelRole } from '@playsport/shared';
import { TeamSheetPanel, useTeamSheets } from './team-sheets';
import { fieldPositionLabels } from './private-scorecard';
import OfficialRunScoring from './official-run-scoring';
export default function TeamSheetInbox({ view }: { view: 'organizer' | 'scorekeeper' | 'rival' }) {
  const role: PersonnelRole = view === 'rival' ? 'manager' : view;
  const userId = view === 'rival' ? 'mgr-B' : view === 'organizer' ? 'org-demo' : 'scorer-demo';
  const connection = useTeamSheets({
    apiBase: process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? 'http://localhost:4000/api/official-scoring',
    gameId: 'game-global-1', tournamentId: 'tour-global-1', userId, role
  });
  return <section className="managerWorkspace">
    <article className="managerCard managerStepCard">
      <h2>Bandeja del {view === 'rival' ? 'dirigente rival' : view === 'organizer' ? 'organizador' : 'anotador'}</h2>
      <p>Perfil ficticio de demostración: {userId}. {view === 'rival' ? 'Consulta el partido oficial y las alineaciones en vivo, sin registrar jugadas.' : 'Registra las jugadas y los cambios comunicados en el campo. Ambos managers reciben el resultado en vivo.'}</p>
      <a href="/demo/live-scoring" className="managerButtonOutline">Volver a la demo del dirigente</a>
    </article>
    <OfficialRunScoring
      apiBase={process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ?? 'http://localhost:4000/api/official-scoring'}
      actorId={userId} actorRole={role} connection={connection} ownTeamId={view === 'rival' ? 'team-B' : undefined} />
    <details className="managerStepCard"><summary>Entregas de lineup y registro de movimientos</summary>
      <TeamSheetPanel connection={connection} names={{ 'team-A': 'Tigres del Valle', 'team-B': 'Leones del Norte' }} positionLabels={fieldPositionLabels} />
    </details>
  </section>;
}
