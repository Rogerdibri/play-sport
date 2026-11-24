'use client';
import { useEffect, useMemo, useState, type Dispatch } from 'react';
import { RosterClient, type ManagerRosterTeam } from '@playsport/shared';
import {
  demoIdentity,
  managerWorkContext,
  type DemoSession,
} from './platform-navigation';
import { usePlatformSession } from './platform-session';
const key = (team: { tournamentId: string; teamId: string }) =>
  JSON.stringify([team.tournamentId, team.teamId]);
export default function ManagerTournamentPicker({
  session,
  onSelect,
}: {
  session: DemoSession;
  onSelect: Dispatch<DemoSession>;
}) {
  const { account } = usePlatformSession();
  const managerId =
    account && !account.localTestAccess
      ? account.identity?.status === 'verified'
        ? (account.identity.actorId ?? '')
        : ''
      : (session.workManagerId ?? demoIdentity(session).id);
  const api = (
    process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ??
    '/api/official-scoring'
  ).replace(/\/official-scoring\/?$/, '');
  const client = useMemo(
    () =>
      managerId
        ? new RosterClient(
            managerId.startsWith('person:') ? '/api/sporting' : api,
            managerId,
          )
        : null,
    [api, managerId],
  );
  const [teams, setTeams] = useState<ManagerRosterTeam[] | null>(null);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client
      .teams()
      .then((value) => {
        if (active) {
          setTeams(value);
          setError('');
        }
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : 'No se pudieron consultar tus torneos.',
          );
      });
    return () => {
      active = false;
    };
  }, [client, retry]);
  if (!client)
    return <p>Verifica tu identidad para consultar tus equipos de trabajo.</p>;
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button onClick={() => setRetry((value) => value + 1)}>
          Recargar mis equipos y torneos
        </button>
      </div>
    );
  if (!teams || !teams.length) return null;
  const selected = key(managerWorkContext(session));
  const value = teams.some((team) => key(team) === selected) ? selected : '';
  if (teams.length === 1 && value) return null;
  return (
    <label className="managerField">
      <span>Equipo y torneo de trabajo</span>
      <select
        value={value}
        onChange={(event) => {
          const team = teams.find((team) => key(team) === event.target.value);
          if (team)
            onSelect({
              ...session,
              workTeamId: team.teamId,
              workTournamentId: team.tournamentId,
              workTeamName: team.teamName,
              ...(managerId.startsWith('person:')
                ? { workManagerId: managerId }
                : {}),
            });
        }}
      >
        <option value="" disabled>
          Selecciona equipo y torneo
        </option>
        {teams.map((team) => (
          <option key={key(team)} value={key(team)}>
            {team.teamName} · {team.tournamentName}
          </option>
        ))}
      </select>
    </label>
  );
}
