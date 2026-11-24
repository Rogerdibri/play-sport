import {
  calendarExampleGames,
  calendarExampleVenues,
  type CalendarExampleGame,
} from './demo-calendar.js';
import { standingsLeagues } from './demo-standings.js';
import type {
  SportsTournament,
  PlayerTeamMembership,
} from './player-context.js';
import type { OfficialStandingGame } from './official-standings.js';

const tournamentId = (name: string) =>
  `example-player-tournament:${encodeURIComponent(name)}`;
const teamId = (name: string) =>
  `example-player-team:${encodeURIComponent(name)}`;
const gameId = (id: string) => `example-player-game:${id}`;

export const playerDemoTournaments: SportsTournament[] =
  standingsLeagues.flatMap((league) =>
    league.tournaments.map((name) => {
      const games = calendarExampleGames.filter(
        (game) => game.tournament === name,
      );
      const venue = calendarExampleVenues.find(
        (venue) => venue.id === games[0]?.venueId,
      );
      if (!venue)
        throw new Error(
          `El torneo de ejemplo ${name} no tiene una sede registrada.`,
        );
      return {
        id: tournamentId(name),
        name,
        leagueId: `example-player-league:${league.id}`,
        leagueName: league.name,
        location: {
          stateId: venue.stateId,
          municipalityId: venue.municipalityId,
        },
        teams: [
          ...new Set(games.flatMap((game) => [game.homeTeam, game.awayTeam])),
        ].map((name) => ({ id: teamId(name), name })),
      };
    }),
  );

export const playerDemoMemberships: PlayerTeamMembership[] = [
  ['Copa Metropolitana 2026', 'Cóndores del Ávila'],
  ['Copa del Lago 2026', 'Guardianes del Lago'],
  ['Copa del Centro 2026', 'Toros de Maracay'],
].map(([name, teamName]) => {
  const tournament = playerDemoTournaments.find(
    (tournament) => tournament.name === name,
  );
  const team = tournament?.teams.find((team) => team.name === teamName);
  if (!tournament || !team)
    throw new Error(
      'El equipo del jugador ficticio no pertenece al torneo de ejemplo.',
    );
  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    teamId: team.id,
    teamName: team.name,
    leagueId: tournament.leagueId,
    leagueName: tournament.leagueName,
    location: tournament.location,
  };
});

export const playerDemoFavoritePlayers = [
  { id: 'example-favorite-person:avila', name: 'Álex Pelotero', membership: playerDemoMemberships[0] },
  { id: 'example-favorite-person:lago', name: 'Álex Pelotero', membership: playerDemoMemberships[1] },
  { id: 'example-favorite-person:centro', name: 'Sam Lanzador', membership: playerDemoMemberships[2] },
];

export const playerDemoGames: OfficialStandingGame[] =
  calendarExampleGames.flatMap((game) => {
    if (game.status === 'cancelled') return [];
    const venue = calendarExampleVenues.find(
      (venue) => venue.id === game.venueId,
    );
    if (!venue)
      throw new Error('El partido ficticio no tiene una sede registrada.');
    if (game.status !== 'scheduled' && !game.score)
      throw new Error('El partido ficticio no tiene su marcador registrado.');
    return [
      {
        gameId: gameId(game.id),
        tournamentId: tournamentId(game.tournament),
        homeTeamId: teamId(game.homeTeam),
        awayTeamId: teamId(game.awayTeam),
        status:
          game.status === 'live'
            ? 'in_progress'
            : game.status === 'finished'
              ? 'final'
              : 'scheduled',
        homeScore: game.score?.home ?? 0,
        awayScore: game.score?.away ?? 0,
        details: {
          tournamentName: game.tournament,
          homeTeamName: game.homeTeam,
          awayTeamName: game.awayTeam,
          date: game.date,
          time: game.time,
          venue: venue.name,
          stateId: venue.stateId,
          municipalityId: venue.municipalityId,
        },
      },
    ];
  });

export function playerDemoSource(
  gameIdValue: string,
): CalendarExampleGame | undefined {
  return calendarExampleGames.find(
    (game) => game.status !== 'cancelled' && gameId(game.id) === gameIdValue,
  );
}
