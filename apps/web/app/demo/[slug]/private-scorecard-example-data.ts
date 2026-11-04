import { demoPlayers } from './demo-players';
import type { PrivateCommand, PrivatePlayer, PrivateSeed } from './private-scorecard';

export function createPrivateScorecardExample(): { seed: PrivateSeed; commands: PrivateCommand[] } {
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const players: PrivatePlayer[] = demoPlayers.map((player) => ({
    id: player.identificationNumber, name: player.displayName,
    jersey: player.jerseyNumber, order: null, position: 'NA'
  }));
  const lineup = (start: number) => players.slice(start, start + 9).map((player, index) => ({
    ...player, order: index + 1, position: positions[index]
  }));
  return {
    seed: {
      names: { home: 'Tigres del Valle', away: 'Leones del Norte' },
      rosters: {
        home: [...players.slice(0, 9), ...players.slice(18, 21)],
        away: [...players.slice(9, 18), ...players.slice(21)]
      },
      lineups: { home: lineup(0), away: lineup(9) },
      courtesyRunnerSource: 'BENCH'
    },
    commands: [
      { kind: 'pitch', value: 'ball' },
      { kind: 'pitch', value: 'strike' },
      { kind: 'play', result: 'single' },
      { kind: 'runner', action: 'steal', from: 1, to: 2 },
      { kind: 'play', result: 'double' },
      { kind: 'pitch', value: 'strike' },
      { kind: 'pitch', value: 'strike' },
      { kind: 'pitch', value: 'strike' },
      { kind: 'play', result: 'flyOut' },
      { kind: 'play', result: 'groundOut' },
      { kind: 'play', result: 'single' },
      { kind: 'play', result: 'double' },
      { kind: 'play', result: 'homeRun' },
      { kind: 'play', result: 'groundOut' },
      { kind: 'play', result: 'single' },
      { kind: 'pitch', value: 'ball' },
      { kind: 'pitch', value: 'strike' }
    ]
  };
}
