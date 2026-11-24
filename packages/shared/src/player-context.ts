import {
  isProfileLocation,
  venezuelaStates,
  type ProfileLocation,
} from './venezuela.js';
import type { OfficialStandingGame } from './official-standings.js';

export type TeamSportsRole = 'player' | 'manager';
export function isTeamSportsRole(role: unknown): role is TeamSportsRole {
  return role === 'player' || role === 'manager';
}

export type SportsTournament = {
  id: string;
  name: string;
  leagueId: string;
  leagueName: string;
  location: ProfileLocation | null;
  teams: Array<{ id: string; name: string }>;
};
export type PlayerTeamMembership = {
  tournamentId: string;
  tournamentName: string;
  teamId: string;
  teamName: string;
  leagueId: string;
  leagueName: string;
  location: ProfileLocation | null;
};
export type PlayerSportsFilter = {
  scope: 'tournament' | 'team' | 'league' | 'municipality' | 'state' | 'all';
  tournamentId: string;
  teamId: string;
  leagueId: string;
  location: ProfileLocation;
};
export type PlayerSportsPreference = {
  selectedTeam: { tournamentId: string; teamId: string } | null;
  filter: PlayerSportsFilter;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const optionalText = (value: unknown): value is string =>
  value === '' || text(value);
const location = (value: unknown): value is ProfileLocation | null =>
  value === null || isProfileLocation(value);
function isSportsTournament(value: unknown): value is SportsTournament {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    optionalText(value.leagueId) &&
    optionalText(value.leagueName) &&
    location(value.location) &&
    Array.isArray(value.teams) &&
    value.teams.every(
      (team) => record(team) && text(team.id) && text(team.name),
    ) &&
    new Set(value.teams.map((team) => team.id)).size === value.teams.length
  );
}
export function readSportsTournaments(value: unknown): SportsTournament[] {
  if (
    !record(value) ||
    !Array.isArray(value.tournaments) ||
    !value.tournaments.every(isSportsTournament) ||
    new Set(value.tournaments.map((tournament) => tournament.id)).size !==
      value.tournaments.length
  ) {
    throw new Error(
      'El catálogo de ligas, torneos y equipos contiene datos inválidos.',
    );
  }
  return value.tournaments;
}
export function readPlayerTeams(
  value: unknown,
  accountId: string,
): PlayerTeamMembership[] {
  if (
    !record(value) ||
    value.accountId !== accountId ||
    !Array.isArray(value.teams) ||
    !value.teams.every(
      (team) =>
        record(team) &&
        text(team.tournamentId) &&
        text(team.tournamentName) &&
        text(team.teamId) &&
        text(team.teamName) &&
        optionalText(team.leagueId) &&
        optionalText(team.leagueName) &&
        location(team.location),
    ) ||
    new Set(value.teams.map((team) => playerTeamKey(team))).size !==
      value.teams.length
  ) {
    throw new Error('No se pudieron comprobar los equipos de esta cuenta.');
  }
  return value.teams;
}
export function playerTeamKey(team: {
  tournamentId: string;
  teamId: string;
}): string {
  return JSON.stringify([team.tournamentId, team.teamId]);
}
export function playerLiveGames(
  games: readonly OfficialStandingGame[],
  teams: readonly PlayerTeamMembership[],
): OfficialStandingGame[] {
  const memberships = new Set(teams.map(playerTeamKey));
  return games.filter(game => game.status === 'in_progress' &&
    [game.homeTeamId, game.awayTeamId].some(teamId =>
      memberships.has(playerTeamKey({ tournamentId: game.tournamentId, teamId }))));
}
export function isPlayerSportsPreference(
  value: unknown,
): value is PlayerSportsPreference | null {
  if (value === null) return true;
  if (
    !record(value) ||
    !record(value.filter) ||
    !(
      value.selectedTeam === null ||
      (record(value.selectedTeam) &&
        text(value.selectedTeam.tournamentId) &&
        text(value.selectedTeam.teamId))
    )
  )
    return false;
  const filter = value.filter;
  const place = filter.location;
  return (
    ['tournament', 'team', 'league', 'municipality', 'state', 'all'].includes(
      String(filter.scope),
    ) &&
    optionalText(filter.tournamentId) &&
    optionalText(filter.teamId) &&
    optionalText(filter.leagueId) &&
    (isProfileLocation(place) ||
      ((filter.scope === 'state' || filter.scope === 'all') &&
        record(place) &&
        place.municipalityId === '' &&
        venezuelaStates.some(
          (state) => state.id === place.stateId && !state.municipalities.length,
        ))) &&
    (!['tournament', 'team'].includes(String(filter.scope)) ||
      text(filter.tournamentId)) &&
    (filter.scope !== 'team' || text(filter.teamId)) &&
    (filter.scope !== 'league' || text(filter.leagueId))
  );
}
export function playerTeamPreference(
  team: PlayerTeamMembership | null,
  profile: ProfileLocation,
): PlayerSportsPreference {
  return {
    selectedTeam: team
      ? { tournamentId: team.tournamentId, teamId: team.teamId }
      : null,
    filter: {
      scope: team ? 'tournament' : 'municipality',
      tournamentId: team?.tournamentId ?? '',
      teamId: team?.teamId ?? '',
      leagueId: team?.leagueId ?? '',
      location: { ...profile },
    },
  };
}
function matchesLocation(
  value: { stateId?: string; municipalityId?: string } | null | undefined,
  filter: PlayerSportsFilter,
) {
  return (
    value?.stateId === filter.location.stateId &&
    (filter.scope === 'state' ||
      value.municipalityId === filter.location.municipalityId)
  );
}
export function playerScopeGames(
  games: readonly OfficialStandingGame[],
  tournaments: readonly SportsTournament[],
  filter: PlayerSportsFilter,
): OfficialStandingGame[] {
  return games.filter((game) => {
    switch (filter.scope) {
      case 'all':
        return true;
      case 'tournament':
        return game.tournamentId === filter.tournamentId;
      case 'team':
        return (
          game.tournamentId === filter.tournamentId &&
          [game.homeTeamId, game.awayTeamId].includes(filter.teamId)
        );
      case 'league':
        return tournaments.some(
          (tournament) =>
            tournament.id === game.tournamentId &&
            tournament.leagueId === filter.leagueId,
        );
      default:
        return matchesLocation(game.details, filter);
    }
  });
}
export function playerScopeStandings(
  games: readonly OfficialStandingGame[],
  tournaments: readonly SportsTournament[],
  filter: PlayerSportsFilter,
): OfficialStandingGame[] {
  if (filter.scope === 'all') return [...games];
  if (filter.scope === 'team' || filter.scope === 'tournament')
    return games.filter((game) => game.tournamentId === filter.tournamentId);
  const ids = new Set(
    playerScopeGames(games, tournaments, filter).map(
      (game) => game.tournamentId,
    ),
  );
  if (filter.scope === 'state' || filter.scope === 'municipality') {
    for (const tournament of tournaments)
      if (matchesLocation(tournament.location, filter)) ids.add(tournament.id);
  }
  return games.filter((game) => ids.has(game.tournamentId));
}
