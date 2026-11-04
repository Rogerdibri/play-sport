type Participant = { teamId: string; name: string } | { winnerOf: string };

type CalendarGame = {
  id: string;
  tournamentId: string;
  phase: 'ELIMINATORIA' | 'CUARTOS' | 'SEMIFINAL' | 'FINAL';
  round: number;
  number: number;
  home: Participant;
  away: Participant;
  result?: { home: number; away: number; official: boolean };
};

const tigres = { teamId: 'team-A', name: 'Tigres del Valle' };
const leones = { teamId: 'team-B', name: 'Leones del Norte' };
const aguilas = { teamId: 'team-C', name: 'Águilas del Sur' };
const toros = { teamId: 'team-D', name: 'Toros del Este' };
const jaguares = { teamId: 'team-E', name: 'Jaguares del Centro' };
const halcones = { teamId: 'team-F', name: 'Halcones de la Sierra' };
const tiburones = { teamId: 'team-G', name: 'Tiburones de la Costa' };
const guaros = { teamId: 'team-H', name: 'Guaros del Oeste' };

export const demoCalendar: CalendarGame[] = [
  {
    id: 'demo-eliminatoria-12', tournamentId: 'tour-global-1',
    phase: 'ELIMINATORIA', round: 3, number: 12, home: tigres, away: leones,
    result: { home: 6, away: 4, official: true }
  },
  {
    id: 'demo-cuartos-1', tournamentId: 'tour-global-1',
    phase: 'CUARTOS', round: 1, number: 1, home: tigres, away: toros,
    result: { home: 7, away: 3, official: true }
  },
  {
    id: 'demo-cuartos-2', tournamentId: 'tour-global-1',
    phase: 'CUARTOS', round: 2, number: 1, home: leones, away: jaguares,
    result: { home: 5, away: 2, official: true }
  },
  {
    id: 'demo-cuartos-3', tournamentId: 'tour-global-1',
    phase: 'CUARTOS', round: 3, number: 1, home: aguilas, away: halcones,
    result: { home: 6, away: 2, official: true }
  },
  {
    id: 'demo-cuartos-4', tournamentId: 'tour-global-1',
    phase: 'CUARTOS', round: 4, number: 1, home: tiburones, away: guaros,
    result: { home: 3, away: 1, official: true }
  },
  {
    id: 'game-global-1', tournamentId: 'tour-global-1',
    phase: 'SEMIFINAL', round: 1, number: 1,
    home: { winnerOf: 'demo-cuartos-1' }, away: { winnerOf: 'demo-cuartos-2' }
  },
  {
    id: 'demo-semifinal-2', tournamentId: 'tour-global-1',
    phase: 'SEMIFINAL', round: 2, number: 1,
    home: { winnerOf: 'demo-cuartos-3' }, away: { winnerOf: 'demo-cuartos-4' },
    result: { home: 4, away: 1, official: true }
  },
  {
    id: 'demo-final-1', tournamentId: 'tour-global-1',
    phase: 'FINAL', round: 1, number: 1,
    home: { winnerOf: 'game-global-1' }, away: { winnerOf: 'demo-semifinal-2' }
  }
];

export function resolveParticipant(
  participant: Participant,
  calendar: CalendarGame[],
  visited = new Set<string>()
): { teamId: string; name: string } | null {
  if ('teamId' in participant) return participant;
  if (visited.has(participant.winnerOf)) return null;
  const game = calendar.find((entry) => entry.id === participant.winnerOf);
  if (!game?.result?.official || game.result.home === game.result.away) return null;
  return resolveParticipant(
    game.result.home > game.result.away ? game.home : game.away,
    calendar,
    new Set([...visited, game.id])
  );
}

export function formatGameName(game: CalendarGame) {
  const phaseNames = {
    ELIMINATORIA: 'Ronda eliminatoria',
    CUARTOS: 'Cuartos de final',
    SEMIFINAL: 'Semifinal',
    FINAL: 'Final'
  };
  const round = game.phase === 'ELIMINATORIA' ? `Jornada ${game.round}` : `Serie ${game.round}`;
  return `${phaseNames[game.phase]} · ${round} · Juego ${game.number}`;
}
