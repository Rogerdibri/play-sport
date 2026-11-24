'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  demoProfilesKey,
  isPlayerSportsPreference,
  isTeamSportsRole,
  playerTeamKey,
  playerTeamPreference,
  readDemoProfiles,
  readPlayerTeams,
  readSportsTournaments,
  type AccountProfile,
  type PlayerSportsPreference,
  type PlayerTeamMembership,
  type ProfileLocation,
  type SportsTournament,
  type TeamSportsRole,
  playerDemoMemberships,
  playerDemoTournaments,
} from '@playsport/shared';
import { usePlatformSession } from './platform-session';
import {
  demoIdentity,
  demoSessionLocation,
  managerWorkContext,
} from './platform-navigation';
import { useNavigationDraft } from './navigation-hooks';

type PlayerSportsContext = {
  role: TeamSportsRole;
  ready: boolean;
  error: string;
  notice: string;
  demo: boolean;
  teams: PlayerTeamMembership[];
  tournaments: SportsTournament[];
  profile: ProfileLocation;
  preference: PlayerSportsPreference;
  selectedTeam: PlayerTeamMembership | null;
  chooseTeam: (_key: string) => void; // eslint-disable-line no-unused-vars
  updateFilter: (_filter: PlayerSportsPreference['filter']) => void; // eslint-disable-line no-unused-vars
  refresh: () => void;
};
const Context = createContext<PlayerSportsContext | null>(null);
export const usePlayerSports = () => useContext(Context);

export default function PlayerSportsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { session, account, ready } = usePlatformSession();
  if (!ready || !session || !isTeamSportsRole(session.role))
    return <Context.Provider value={null}>{children}</Context.Provider>;
  return (
    <ActivePlayerSports
      key={`${session.role}:${account?.id ?? demoIdentity(session).id}`}
      account={account}
      role={session.role}
      demoProfileId={demoIdentity(session).id}
      demoManagerTeam={session.team}
      workTeamKey={
        session.role === 'manager'
          ? playerTeamKey(managerWorkContext(session))
          : ''
      }
      initialLocation={demoSessionLocation(session)}
    >
      {children}
    </ActivePlayerSports>
  );
}

async function json(url: string, signal: AbortSignal, resource: string): Promise<unknown> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    signal,
  });
  if (response.status === 401)
    throw new Error(
      'No se pudo validar tu sesión para cargar tus equipos y torneos. Revisa Mi cuenta.',
    );
  if (!response.ok) throw new Error(`No se pudo cargar ${resource}. Vuelve a intentarlo.`);
  return response.json();
}
function mergeTournaments(
  catalog: SportsTournament[],
  teams: PlayerTeamMembership[],
) {
  const merged = new Map(
    catalog.map((tournament) => [tournament.id, tournament]),
  );
  for (const team of teams) {
    const tournament = merged.get(team.tournamentId);
    if (!tournament)
      merged.set(team.tournamentId, {
        id: team.tournamentId,
        name: team.tournamentName,
        leagueId: team.leagueId,
        leagueName: team.leagueName,
        location: team.location,
        teams: [{ id: team.teamId, name: team.teamName }],
      });
    else if (!tournament.teams.some((item) => item.id === team.teamId)) {
      merged.set(tournament.id, {
        ...tournament,
        teams: [...tournament.teams, { id: team.teamId, name: team.teamName }],
      });
    }
  }
  return [...merged.values()];
}
function ActivePlayerSports({
  children,
  account,
  initialLocation,
  role,
  demoProfileId,
  demoManagerTeam,
  workTeamKey,
}: {
  children: ReactNode;
  account: AccountProfile | null;
  initialLocation: ProfileLocation;
  role: TeamSportsRole;
  demoProfileId: string;
  demoManagerTeam: 'team-A' | 'team-B';
  workTeamKey: string;
}) {
  const demo = !account || Boolean(account.localTestAccess);
  const needsMembership = role === 'manager' ? Boolean(account) : !demo;
  const hasPersonalProfile = account?.identity?.status === 'verified';
  const owner = account?.id ?? demoProfileId;
  const previousWorkTeam = useRef(workTeamKey);
  const [stored, setStored, restored] =
    useNavigationDraft<PlayerSportsPreference | null>(
      `${role}-sports:context`,
      null,
      isPlayerSportsPreference,
      owner,
    );
  const [data, setData] = useState<{
    teams: PlayerTeamMembership[];
    tournaments: SportsTournament[];
    profile: ProfileLocation;
  } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const base =
          process.env.NEXT_PUBLIC_OFFICIAL_SCORING_API_BASE ??
          '/api/official-scoring';
        const [catalogValue, memberValue, profileValue] = await Promise.all([
          json(`${base}/discovery`, controller.signal, 'el catálogo de torneos'),
          needsMembership
            ? json(
                `/api/sporting/registration/roster/${role}-teams`,
                controller.signal,
                'tus equipos',
              )
            : null,
          hasPersonalProfile ? json('/api/accounts/profile', controller.signal, 'tu perfil deportivo') : null,
        ]);
        const tournaments = [
          ...readSportsTournaments(catalogValue),
          ...(demo ? playerDemoTournaments : []),
        ];
        const assignedTeams = needsMembership
          ? readPlayerTeams(memberValue, owner)
          : [];
        const candidates: PlayerTeamMembership[] = demo
          ? [
              ...playerDemoMemberships,
              ...tournaments
                .filter((tournament) => tournament.id === 'tour-global-1')
                .flatMap((tournament) =>
                  tournament.teams
                    .filter((team) =>
                      role === 'manager'
                        ? team.id === demoManagerTeam
                        : ['team-A', 'team-B'].includes(team.id),
                    )
                    .map((team) => ({
                      tournamentId: tournament.id,
                      tournamentName: tournament.name,
                      teamId: team.id,
                      teamName: team.name,
                      leagueId: tournament.leagueId,
                      leagueName: tournament.leagueName,
                      location: tournament.location,
                    })),
                ),
              ...assignedTeams,
            ]
          : assignedTeams;
        const teams = [
          ...new Map(
            candidates.map((team) => [playerTeamKey(team), team]),
          ).values(),
        ];
        let profile = initialLocation;
        if (hasPersonalProfile) {
          if (
            !profileValue ||
            typeof profileValue !== 'object' ||
            !('accountId' in profileValue) ||
            profileValue.accountId !== owner ||
            !('document' in profileValue)
          )
            throw new Error('El perfil no corresponde a esta cuenta.');
          profile =
            readDemoProfiles(JSON.stringify(profileValue.document)).saved.find(
              (item) => item.accountId === owner,
            )?.location ?? initialLocation;
        } else if (!account) {
          profile =
            readDemoProfiles(
              globalThis.localStorage.getItem(demoProfilesKey),
            ).saved.find((item) => item.accountId === demoProfileId)
              ?.location ?? initialLocation;
        }
        if (active && request === revision) {
          setData({
            teams,
            tournaments: mergeTournaments(tournaments, teams),
            profile,
          });
          setError('');
        }
      } catch (failure) {
        if (active && request === revision)
          setError(
            failure instanceof Error
              ? failure.message
              : 'No se pudieron cargar tus equipos y torneos.',
          );
      }
    };
    void load();
    globalThis.addEventListener('focus', load);
    const interval = setInterval(() => {
      if (!globalThis.document.hidden) void load();
    }, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      globalThis.removeEventListener('focus', load);
    };
  }, [
    demo,
    owner,
    Boolean(account),
    hasPersonalProfile,
    initialLocation.stateId,
    initialLocation.municipalityId,
    retry,
    role,
    demoProfileId,
    demoManagerTeam,
    needsMembership,
  ]);
  const defaultTeam =
    data?.teams.find((team) => playerTeamKey(team) === workTeamKey) ??
    data?.teams[0] ??
    null;
  useEffect(() => {
    if (!data || !restored) return;
    if (stored === null)
      setStored(playerTeamPreference(defaultTeam, data.profile));
    else if (
      stored.selectedTeam &&
      !data.teams.some(
        (team) => playerTeamKey(team) === playerTeamKey(stored.selectedTeam!),
      )
    ) {
      setNotice(
        'El equipo seleccionado ya no figura entre tus equipos disponibles. Revisa tu equipo activo.',
      );
      setStored(playerTeamPreference(defaultTeam, data.profile));
    }
  }, [data, defaultTeam, restored, stored, setStored]);
  useEffect(() => {
    if (!data || !restored || previousWorkTeam.current === workTeamKey) return;
    const team = data.teams.find((team) => playerTeamKey(team) === workTeamKey);
    if (!team) return;
    previousWorkTeam.current = workTeamKey;
    setStored(playerTeamPreference(team, data.profile));
    setNotice('');
  }, [data, restored, workTeamKey, setStored]);
  const preference =
    stored ??
    playerTeamPreference(defaultTeam, data?.profile ?? initialLocation);
  const selectedTeam =
    data?.teams.find(
      (team) =>
        preference.selectedTeam &&
        playerTeamKey(team) === playerTeamKey(preference.selectedTeam),
    ) ?? null;
  const chooseTeam = (key: string) => {
    const team = data?.teams.find((item) => playerTeamKey(item) === key);
    if (!team || !data) {
      setError('Selecciona uno de tus equipos disponibles.');
      return;
    }
    setStored(playerTeamPreference(team, data.profile));
    setNotice('');
  };
  return (
    <Context.Provider
      value={{
        role,
        ready: Boolean(data && restored && !error),
        error,
        notice,
        demo,
        teams: data?.teams ?? [],
        tournaments: data?.tournaments ?? [],
        profile: data?.profile ?? initialLocation,
        preference,
        selectedTeam,
        chooseTeam,
        updateFilter: (filter) => setStored({ ...preference, filter }),
        refresh: () => setRetry((value) => value + 1),
      }}
    >
      {children}
    </Context.Provider>
  );
}
