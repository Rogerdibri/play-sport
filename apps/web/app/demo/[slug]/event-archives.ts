import { applyPrivateCommand, privateInningRuns, replayPrivate, type PrivateCommand, type PrivatePlayer, type PrivateSeed, type PrivateState, type Side } from '@playsport/shared';
import type { CalendarExampleGame } from './event-examples';

type ArchiveFixture = { away: number[]; home: Array<number | null> };

// Fixed fictional inning records, independent of the official scoring service.
const fixtures: Record<string, ArchiveFixture> = {
  'ejemplo-caracas-1': { away: [1, 0, 0, 1, 0, 0, 0, 0, 0], home: [0, 2, 0, 0, 3, 0, 0, 0, null] },
  'ejemplo-caracas-2': { away: [1, 0, 0, 2, 0, 0, 0], home: [0, 1, 0, 0, 0, 0, 0] },
  'ejemplo-valencia-1': { away: [1, 0, 2, 0, 0, 0, 1, 0, 0], home: [2, 0, 2, 0, 3, 0, 0, 0, null] },
  'ejemplo-ayer': { away: [0, 1, 0, 0, 1, 0, 0, 0, 0], home: [2, 0, 0, 1, 0, 3, 0, 0, null] },
  'ejemplo-historico-1952': { away: [0, 0, 1, 0, 0, 0, 0, 0, 0], home: [1, 0, 0, 2, 0, 0, 0, 0, null] },
  'ejemplo-historico-2000': { away: [1, 0, 0, 2, 0, 0, 1, 0, 0], home: [0, 1, 0, 0, 2, 0, 0, 1, 0] },
  'ejemplo-historico-maracay': { away: [2, 0, 0, 0, 3, 0, 0, 0, 0], home: [0, 1, 0, 0, 0, 1, 0, 0, 0] },
  'ejemplo-historico-maracaibo': { away: [1, 0, 0, 0, 2, 0, 0, 0, 0], home: [0, 2, 0, 0, 0, 3, 0, 0, null] },
  'ejemplo-historico-valencia': { away: [2, 0, 1, 0, 0, 3, 0, 1, 0], home: [3, 0, 0, 2, 0, 0, 5, 0, null] },
  'ejemplo-caracas-finalizado-5': { away: [1, 0, 0, 2, 0, 0, 1, 0, 0], home: [2, 0, 2, 0, 3, 0, 0, 0, null] },
  'ejemplo-caracas-en-juego-5': { away: [1, 0, 0, 0, 0, 0, 0, 0, 0], home: [0, 2, 1, 0, 0, 0, 0, 0, null] }
};

const liveFixtures: Record<string, { completed: ArchiveFixture; commands: PrivateCommand[]; side: Side; outs: number }> = {
  'ejemplo-caracas-en-juego-5': {
    completed: { away: [1, 0, 0], home: [0, 2, 1] }, side: 'away', outs: 1,
    commands: [
      { kind: 'play', result: 'double' }, { kind: 'play', result: 'single' },
      { kind: 'play', result: 'groundOut' },
      { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'ball' }
    ]
  },
  'ejemplo-maracaibo-1': {
    completed: { away: [0, 1, 0, 1, 0, 0], home: [1, 0, 2, 0, 0, null] }, side: 'home', outs: 2,
    commands: [
      { kind: 'play', result: 'groundOut' }, { kind: 'play', result: 'groundOut' },
      { kind: 'play', result: 'single' }, { kind: 'pitch', value: 'strike' }
    ]
  }
};

export type CalendarAwards = { winner: string | null; loser: string | null; saver: string | null; mvp: string | null };
export function calendarGameAwards(game: CalendarExampleGame): CalendarAwards | null {
  if (game.status !== 'finished') return null;
  if (game.id === 'ejemplo-caracas-finalizado-5') {
    return { winner: 'Carlos Medina', loser: 'José Rivas', saver: null, mvp: 'Luis Romero' };
  }
  return null;
}

function calendarSeed(game: CalendarExampleGame): PrivateSeed {
  const names = {
    home: ['Carlos Medina', 'Luis Romero', 'Pedro Salas', 'Andrés Gil', 'Miguel León', 'Diego Vera', 'Rafael Soto', 'Daniel Rojas', 'Ángel Mora'],
    away: ['José Rivas', 'Juan Pérez', 'Mario Díaz', 'Pablo Ruiz', 'David Silva', 'Jorge Peña', 'César Lara', 'Óscar Torres', 'Iván Suárez']
  };
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const lineup = (side: Side): PrivatePlayer[] => names[side].map((name, index) => ({
    id: `${game.id}:${side}:${index}`, name, position: positions[index], jersey: String(index + 1), order: index + 1
  }));
  const lineups = { home: lineup('home'), away: lineup('away') };
  return {
    names: { home: game.homeTeam, away: game.awayTeam }, lineups, rosters: lineups,
    courtesyRunnerSource: 'BENCH', regulationInnings: game.sport === 'softball' ? 7 : 9
  };
}

function inningCommands(fixture: ArchiveFixture): PrivateCommand[] {
  const commands: PrivateCommand[] = [];
  for (let inning = 0; inning < fixture.away.length; inning += 1) {
    for (const side of ['away', 'home'] as const) {
      const runs = fixture[side][inning];
      if (runs === null) continue;
      if (!Number.isInteger(runs) || runs < 0) throw new Error('El archivo contiene una entrada inválida.');
      for (let run = 0; run < runs; run += 1) commands.push({ kind: 'play', result: 'homeRun' });
      for (let out = 0; out < 3; out += 1) commands.push({ kind: 'play', result: 'groundOut' });
    }
  }
  return commands;
}

export function calendarGameArchive(game: CalendarExampleGame) {
  if (game.status !== 'finished') throw new Error('Solo se pueden consultar archivos de juegos finalizados.');
  const fixture = fixtures[game.id];
  if (!fixture) return null;
  const seed = calendarSeed(game);
  const live = liveFixtures[game.id];
  const commands = live ? [...inningCommands(live.completed), ...live.commands] : inningCommands(fixture);
  if (live) {
    // Preserve the plays already shown before closing this fictional live example.
    let current = replayPrivate(seed, commands);
    const lastHomePlayed = fixture.home.at(-1) !== null;
    while (current.inning < fixture.away.length ||
        current.inning === fixture.away.length && (lastHomePlayed || current.side === 'away')) {
      const out: PrivateCommand = { kind: 'play', result: 'ruleOut' };
      commands.push(out);
      current = applyPrivateCommand(current, out);
    }
  }
  commands.push({ kind: 'finish' });
  const state = replayPrivate(seed, commands);
  if (!game.score || fixture.away.length !== game.score.innings || fixture.home.length !== game.score.innings ||
      state.scores.home !== game.score.home || state.scores.away !== game.score.away) {
    throw new Error('Las hojas archivadas no coinciden con el resultado del juego.');
  }
  return { state, innings: fixture };
}

export function calendarLiveProgress(state: PrivateState): string {
  return `${state.side === 'away' ? 'Alta' : 'Baja'} de la ${state.inning}.ª · ${state.outs} ${state.outs === 1 ? 'out' : 'outs'}`;
}

export function calendarGameLive(game: CalendarExampleGame) {
  if (game.status !== 'live') throw new Error('Solo se puede consultar el seguimiento de juegos en curso.');
  const fixture = liveFixtures[game.id];
  if (!fixture) return null;
  const state = replayPrivate(calendarSeed(game), [...inningCommands(fixture.completed), ...fixture.commands]);
  if (!game.score || state.inning !== game.score.innings || state.side !== fixture.side || state.outs !== fixture.outs ||
      state.scores.home !== game.score.home || state.scores.away !== game.score.away || state.finished) {
    throw new Error('El seguimiento no coincide con el marcador o la entrada del juego.');
  }
  const innings = Array.from({ length: Math.max(state.seed.regulationInnings ?? 9, state.inning) }, (_, index) => index + 1);
  return { state, innings: {
    away: innings.map(inning => privateInningRuns(state, 'away', inning)),
    home: innings.map(inning => privateInningRuns(state, 'home', inning))
  } };
}
