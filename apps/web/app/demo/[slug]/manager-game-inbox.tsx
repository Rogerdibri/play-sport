'use client';

import Link from 'next/link';
import { managerWorkContext } from '../../platform-navigation';
import { usePlatformSession } from '../../platform-session';
import TeamSheetInbox from './team-sheet-inbox';
import { useManagerTeamAccess } from '../../account/manager-teams/use-manager-team-access';

export default function ManagerGameInbox() {
  const { session, ready, account } = usePlatformSession();
  const context = session?.role === 'manager' ? managerWorkContext(session) : null;
  const accountId = context?.managerId.startsWith('person:') ? account?.id : undefined;
  const { access, error: managementError } = useManagerTeamAccess(accountId);
  if (!ready) return <p role="status">Consultando el perfil del manager…</p>;
  if (session?.role !== 'manager') return <section className="managerCard">
    <p role="alert">Mis partidos asignados corresponde al perfil Manager.</p><Link href="/">Volver a mi inicio</Link>
  </section>;
  const selected = context!;
  const managementAllowed = !selected.managerId.startsWith('person:') || Boolean(accountId && access?.teams.some(team =>
    team.managed && team.teamId === selected.teamId && team.tournamentId === selected.tournamentId));
  return <TeamSheetInbox key={JSON.stringify(selected)} view="manager" managerId={selected.managerId} managerTeam={selected}
    managementAllowed={managementAllowed} managementError={managementError} />;
}
