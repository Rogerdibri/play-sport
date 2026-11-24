import { applyPrivateCommand, createPrivateState, minimumDestinations, type PrivateCommand, type PrivateSeed, type Side } from './scorecard.js';
import { calculateStatisticsRates, scorecardStatistics, type StatisticsGame, type StatisticsSnapshot } from './sports-statistics.js';

const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const exampleIds = ['example-stats-baseball-1', 'example-stats-baseball-2', 'example-stats-softball-1', 'example-stats-softball-live'];
export function statisticsExampleObservation(id: string) {
  const index = exampleIds.indexOf(id);
  if (index < 0) throw new Error('El juego de ejemplo no existe.');
  const lineup = (side: Side) => positions.map((position, order) => ({
    id: `example-statistics:${side}:${order}`, name: order === 0 && side === 'away' ? 'Álex Pelotero' :
      `${side === 'home' ? 'Guardianes' : 'Relámpagos'} · Jugador ${order + 1}`,
    position, jersey: String(order + 1), order: order + 1,
  }));
  const lineups = { home: lineup('home'), away: lineup('away') };
  const seed: PrivateSeed = { names: { home: 'Guardianes del Lago', away: 'Relámpagos del Sur' },
    lineups, rosters: lineups, courtesyRunnerSource: 'BENCH', regulationInnings: index < 2 ? 9 : 7 };
  let state = createPrivateState(seed);
  const send = (command: PrivateCommand) => {
    state = applyPrivateCommand(state, command.kind === 'play' ?
      { ...command, destinations: minimumDestinations(state, command.result) } : command);
  };
  const innings = index === 3 ? 2 : 3;
  for (let inning = 0; inning < innings; inning++) {
    for (const side of ['away', 'home'] as const) {
      if (state.side !== side) throw new Error('La secuencia del ejemplo no coincide con su entrada.');
      send({ kind: 'pitch', value: 'ball' });
      send({ kind: 'pitch', value: 'strike' });
      send({ kind: 'play', result: inning % 2 === 0 ? 'double' : 'single' });
      send({ kind: 'play', result: 'homeRun' });
      send({ kind: 'play', result: 'walk' });
      send({ kind: 'play', result: 'sacrificeBunt' });
      send({ kind: 'play', result: 'strikeout' });
      send({ kind: 'play', result: 'groundOut' });
    }
  }
  if (index !== 3) send({ kind: 'finish' });
  return state;
}
export function exampleStatisticsGames(mode: StatisticsSnapshot['mode']): StatisticsGame[] {
  return exampleIds.map((id, index) => {
    const state = statisticsExampleObservation(id), side = 'away';
    const ids = mode === 'team' ? state.seed.lineups.away.map(player => player.id) : [state.seed.lineups.away[0].id];
    const line = calculateStatisticsRates(scorecardStatistics(state, side, ids, {
      team: mode === 'team', positions: mode === 'team' ? positions : ['P'], caughtStealing: 0, errors: 0,
      startingPitcherIds: [state.seed.lineups.away[0].id], pitchingComplete: true, offenseId: side,
    }), index < 2 ? 9 : 7);
    return {
      gameId: id, tournamentId: index < 2 ? 'example-stats-baseball' : 'example-stats-softball',
      tournamentName: index < 2 ? 'Copa de Béisbol del Lago' : 'Copa de Softbol del Lago',
      teamId: 'example-stats-relampagos', teamName: state.seed.names.away, opponentName: state.seed.names.home,
      leagueId: 'example-stats-liga', leagueName: 'Liga del Lago', date: `2026-10-${String(10 + index).padStart(2, '0')}`,
      season: '2026', sport: index < 2 ? 'baseball' : 'softball', modality: index < 2 ? 'Béisbol' : 'Lanzamiento lento',
      category: 'Adultos', eraBase: index < 2 ? 9 : 7, version: state.log.length,
      status: index === 3 ? 'in_progress' : 'final', qualification: index === 3 ? 'provisional' : 'official',
      reason: index === 3 ? 'En curso: cifras provisionales, fuera del acumulado oficial.' : '',
      public: false, positions: mode === 'team' ? positions : ['P'], line,
      result: index === 3 ? null : 'tie',
    };
  });
}
