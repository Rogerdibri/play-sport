import {
  accountRuns, createRunAccounting, reviewAccountedRun, validRunEvidence, validRunReview,
  type RunAccounting, type RunReview
} from './earned-runs.js';

export function findDuplicateFieldPosition(entries: ReadonlyArray<{ fieldPosition: string }>): string | null {
  const occupied = new Set<string>();
  for (const { fieldPosition } of entries) {
    if (fieldPosition === 'NA') continue;
    if (occupied.has(fieldPosition)) return fieldPosition;
    occupied.add(fieldPosition);
  }
  return null;
}

export type Side = 'home' | 'away';
export type Destination = 0 | 1 | 2 | 3 | 4;
export type PrivatePlayer = {
  id: string;
  name: string;
  position: string;
  jersey: string;
  order: number | null;
};
export type PrivateSeed = {
  names: Record<Side, string>;
  lineups: Record<Side, PrivatePlayer[]>;
  rosters: Record<Side, PrivatePlayer[]>;
  courtesyRunnerSource: 'BENCH' | 'ROSTER';
  regulationInnings?: 7 | 9;
  teamSheetRevisions?: Record<Side, number>;
};
export const playLabels = {
  single: 'Sencillo', double: 'Doble', triple: 'Triple', homeRun: 'Jonrón',
  walk: 'Base por bolas', hitByPitch: 'Golpeado por lanzamiento',
  strikeout: 'Ponche', groundOut: 'Eliminado por rodado', flyOut: 'Eliminado por elevado',
  lineOut: 'Eliminado por línea', battedOut: 'Out al batear', ruleOut: 'Out por regla', sacrificeFly: 'Elevado de sacrificio',
  sacrificeBunt: 'Toque de sacrificio', error: 'Se embasa por error',
  fieldersChoice: 'Jugada de selección', doublePlay: 'Doble jugada', triplePlay: 'Triple jugada'
} as const;
export type PlayResult = keyof typeof playLabels;
export const runnerLabels = {
  steal: 'Robo de base', caught: 'Atrapado robando', pickoff: 'Sorprendido fuera de base',
  wild: 'Lanzamiento descontrolado', passed: 'Bola pasada', balk: 'Movimiento ilegal del lanzador',
  advance: 'Avance de corredor', error: 'Avance por error', run: 'Carrera anotada', ruleOut: 'Out por regla',
  advanceOut: 'Out al avanzar'
} as const;
export type RunnerAction = keyof typeof runnerLabels;
export type PrivateCommand = {
  sharedRequestId?: string;
  teamSheetRevision?: number;
  teamSheetSide?: Side;
} & (
  | { kind: 'pitch'; value: 'ball' | 'strike' | 'foul' }
  | { kind: 'play'; result: PlayResult; destinations?: Record<string, Destination>; validThirdOutRuns?: boolean; note?: string; errorOuts?: number }
  | { kind: 'runner'; action: RunnerAction; from: number; to: Destination; attemptedBase?: Destination; note?: string; errorOuts?: number; cleanAdvance?: boolean }
  | { kind: 'misplay'; errorOuts: number }
  | { kind: 'run-review'; review: RunReview }
  | { kind: 'courtesy'; from: number; playerId: string; sourceRule?: 'BENCH' | 'ROSTER' }
  | { kind: 'substitution'; side: Side; outId: string; inId: string; position: string; jersey: string }
  | { kind: 'position'; side: Side; playerId: string; position: string }
  | { kind: 'note'; note: string }
  | { kind: 'received-lineup'; side: Side; players: PrivatePlayer[] }
  | { kind: 'finish' }
);
export type PrivateLog = {
  inning: number;
  side: Side;
  batterId: string | null;
  runnerId: string | null;
  result: PlayResult | null;
  pitch: 'ball' | 'strike' | 'foul' | null;
  text: string;
  runs: string[];
  outs: number;
  stolenBy: string | null;
  rbis: number;
  pitcherId: string | null;
};
const playAbbreviations: Record<PlayResult, string> = {
  single: '1B', double: '2B', triple: '3B', homeRun: 'HR',
  walk: 'BB', hitByPitch: 'GP', strikeout: 'K',
  groundOut: 'OUT', flyOut: 'OUT', lineOut: 'OUT', battedOut: 'OUT', ruleOut: 'OR',
  sacrificeFly: 'SF', sacrificeBunt: 'SH', error: 'E',
  fieldersChoice: 'FC', doublePlay: 'DP', triplePlay: 'TP'
};

export function privateInningSummary(entries: PrivateLog[], playerId: string): Array<{ code: string; label: string }> {
  return entries.flatMap((entry) => {
    const summary: Array<{ code: string; label: string }> = [];
    if (entry.batterId === playerId && entry.result) {
      summary.push({ code: playAbbreviations[entry.result], label: playLabels[entry.result] });
    } else if (entry.runnerId === playerId && entry.outs > 0) {
      summary.push({ code: 'OUT', label: 'Out del corredor' });
    }
    if (entry.stolenBy === playerId) summary.push({ code: 'BR', label: 'Base robada' });
    if (entry.runs.includes(playerId)) summary.push({ code: 'C', label: 'Carrera anotada' });
    return summary;
  });
}

export type PrivateState = {
  seed: PrivateSeed;
  lineups: Record<Side, PrivatePlayer[]>;
  inning: number;
  side: Side;
  balls: number;
  strikes: number;
  outs: number;
  scores: Record<Side, number>;
  indexes: Record<Side, number>;
  bases: Array<string | null>;
  courtesyFor: Record<string, string>;
  log: PrivateLog[];
  finished: boolean;
  runAccounting: RunAccounting;
};
export function isScorecardState(value: unknown): value is PrivateState {
  if (!isRecord(value) || !isSeed(value.seed) || !isRecord(value.lineups) ||
      !sides.every((side) => isRecord(value.lineups) && Array.isArray(value.lineups[side]) && value.lineups[side].every(isPlayer)) ||
      !isSide(value.side) || typeof value.finished !== 'boolean' ||
      !['inning', 'balls', 'strikes', 'outs'].every((key) => typeof value[key] === 'number' && Number.isInteger(value[key]) && Number(value[key]) >= 0) ||
      !isRecord(value.scores) || !isRecord(value.indexes) ||
      !sides.every((side) => isRecord(value.scores) && typeof value.scores[side] === 'number' &&
        isRecord(value.indexes) && typeof value.indexes[side] === 'number') ||
      !Array.isArray(value.bases) || value.bases.length !== 3 || !value.bases.every((id) => id === null || typeof id === 'string') ||
      !isRecord(value.courtesyFor) || !Object.values(value.courtesyFor).every((id) => typeof id === 'string') ||
      !Array.isArray(value.log) || !value.log.every((entry) => isRecord(entry) && isSide(entry.side) &&
        typeof entry.inning === 'number' && typeof entry.text === 'string' && typeof entry.outs === 'number' &&
        typeof entry.rbis === 'number' && (entry.result === null || hasKey(playLabels, entry.result)) &&
        [entry.batterId, entry.runnerId, entry.stolenBy, entry.pitcherId].every((id) => id === null || typeof id === 'string') &&
        (entry.pitch === null || entry.pitch === 'ball' || entry.pitch === 'strike' || entry.pitch === 'foul') &&
        Array.isArray(entry.runs) && entry.runs.every((id) => typeof id === 'string')) ||
      !isRecord(value.runAccounting) || !Array.isArray(value.runAccounting.runs) ||
      !value.runAccounting.runs.every((run) => isRecord(run) && typeof run.eventId === 'number' &&
        typeof run.offenseId === 'string' && (run.runnerId === null || typeof run.runnerId === 'string') &&
        (run.pitcherId === null || typeof run.pitcherId === 'string') && typeof run.count === 'number' &&
        ['earned', 'unearned', 'pending'].includes(String(run.team)) && ['earned', 'unearned', 'pending'].includes(String(run.pitcher)) &&
        typeof run.note === 'string' && typeof run.reviewed === 'boolean')) return false;
  return true;
}
export const fieldPositionLabels: Record<string, string> = {
  P: 'Lanzador', C: 'Receptor', '1B': 'Primera base', '2B': 'Segunda base', '3B': 'Tercera base',
  SS: 'Campocorto', LF: 'Jardinero izquierdo', CF: 'Jardinero central', RF: 'Jardinero derecho',
  OF4: 'Cuarto jardinero', SF: 'Jardinero corto', DH: 'Bateador designado', NA: 'Sin posición defensiva'
};
export const privatePositions = Object.keys(fieldPositionLabels);
const sides: Side[] = ['home', 'away'];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isDestination = (value: unknown): value is Destination =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4;
const isBase = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3;
const isSide = (value: unknown): value is Side => value === 'home' || value === 'away';
const hasKey = <T extends object>(object: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.hasOwn(object, key);
const validPosition = (value: unknown): value is string =>
  typeof value === 'string' && privatePositions.includes(value);
const validJersey = (value: unknown): value is string => typeof value === 'string' && /^\d{1,2}$/.test(value);
const optionalNote = (value: unknown) => value === undefined || typeof value === 'string';

function isPlayer(value: unknown): value is PrivatePlayer {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.name === 'string' && typeof value.jersey === 'string' &&
    validPosition(value.position) && (value.order === null ||
      typeof value.order === 'number' && Number.isInteger(value.order) && value.order >= 1 && value.order <= 13);
}

function isSeed(value: unknown): value is PrivateSeed {
  if (!isRecord(value) || !isRecord(value.names) || !isRecord(value.lineups) || !isRecord(value.rosters) ||
      !(value.courtesyRunnerSource === 'BENCH' || value.courtesyRunnerSource === 'ROSTER')) return false;
  if (value.regulationInnings !== undefined && value.regulationInnings !== 7 && value.regulationInnings !== 9) return false;
  if (value.teamSheetRevisions !== undefined && (!isRecord(value.teamSheetRevisions) ||
      !sides.every((side) => isRecord(value.teamSheetRevisions) && typeof value.teamSheetRevisions[side] === 'number' &&
        Number.isInteger(value.teamSheetRevisions[side]) && Number(value.teamSheetRevisions[side]) >= 0))) return false;
  return sides.every((side) => {
    const names = value.names;
    const lineups = value.lineups;
    const rosters = value.rosters;
    return isRecord(names) && typeof names[side] === 'string' &&
      isRecord(lineups) && Array.isArray(lineups[side]) && lineups[side].every(isPlayer) &&
      isRecord(rosters) && Array.isArray(rosters[side]) && rosters[side].every(isPlayer);
  });
}

export function isScorecardCommand(value: unknown): value is PrivateCommand {
  if (!isRecord(value)) return false;
  if (value.sharedRequestId !== undefined && (typeof value.sharedRequestId !== 'string' || !value.sharedRequestId ||
      !isSide(value.teamSheetSide) || typeof value.teamSheetRevision !== 'number' ||
      !Number.isInteger(value.teamSheetRevision) || value.teamSheetRevision < 1)) return false;
  switch (value.kind) {
    case 'pitch': return value.value === 'ball' || value.value === 'strike' || value.value === 'foul';
    case 'play': return hasKey(playLabels, value.result) && optionalNote(value.note) && validRunEvidence(value) &&
      (value.errorOuts === undefined || value.result === 'error') &&
      (value.validThirdOutRuns === undefined || typeof value.validThirdOutRuns === 'boolean') &&
      (value.destinations === undefined || isRecord(value.destinations) && Object.values(value.destinations).every(isDestination));
    case 'runner': return hasKey(runnerLabels, value.action) && isBase(value.from) && isDestination(value.to) && optionalNote(value.note) &&
      validRunEvidence(value) && (value.errorOuts === undefined || value.action === 'error' && Number(value.errorOuts) <= 1) &&
      (value.cleanAdvance === undefined || typeof value.cleanAdvance === 'boolean' && ['advance', 'run'].includes(String(value.action))) &&
      (value.action !== 'advanceOut' || isDestination(value.attemptedBase) && value.attemptedBase > value.from);
    case 'misplay': return value.errorOuts === 1;
    case 'run-review': return validRunReview(value.review);
    case 'courtesy': return isBase(value.from) && typeof value.playerId === 'string' &&
      (value.sourceRule === undefined || value.sourceRule === 'BENCH' || value.sourceRule === 'ROSTER');
    case 'substitution': return isSide(value.side) && typeof value.outId === 'string' && typeof value.inId === 'string' &&
      validPosition(value.position) && validJersey(value.jersey);
    case 'position': return isSide(value.side) && typeof value.playerId === 'string' && validPosition(value.position);
    case 'note': return typeof value.note === 'string' && value.note.trim().length > 0;
    case 'received-lineup': return isSide(value.side) && Array.isArray(value.players) && value.players.every(isPlayer);
    case 'finish': return true;
    default: return false;
  }
}

export function createPrivateState(seed: PrivateSeed): PrivateState {
  if (!isSeed(seed)) throw new Error('Los datos iniciales de la planilla no son válidos.');
  for (const side of sides) {
    const lineup = seed.lineups[side];
    if (findDuplicateFieldPosition(lineup.map((player) => ({ fieldPosition: player.position })))) {
      throw new Error('La alineación privada no puede tener posiciones repetidas.');
    }
    const batters = lineup.filter((p) => p.order !== null).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (new Set(lineup.map((p) => p.id)).size !== lineup.length ||
        lineup.some((p) => !seed.rosters[side].some((r) => r.id === p.id)) ||
        lineup.length > 14 || (lineup.length > 0 && (batters.length < 9 || batters.length > 13)) ||
        batters.some((p, index) => p.order !== index + 1)) {
      throw new Error('La alineación privada debe conservar los jugadores inscritos y el orden de bateo válido.');
    }
  }
  return {
    seed: structuredClone(seed), lineups: structuredClone(seed.lineups),
    inning: 1, side: 'away', balls: 0, strikes: 0, outs: 0,
    scores: { home: 0, away: 0 }, indexes: { home: 0, away: 0 },
    bases: [null, null, null], courtesyFor: {}, log: [], finished: false, runAccounting: createRunAccounting()
  };
}

export function currentBatter(state: PrivateState): string {
  const batters = state.lineups[state.side].filter((p) => p.order !== null).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return batters[state.indexes[state.side] % batters.length]?.id ?? `unknown:${state.side}:${state.indexes[state.side] + 1}`;
}

export function playerName(state: PrivateState, id: string): string {
  const player = [...state.seed.rosters.home, ...state.seed.rosters.away].find((p) => p.id === id);
  if (player) return player.name;
  if (id.startsWith('unknown:')) return `Bateador sin identificar · turno ${id.split(':')[2]}`;
  return id;
}

export function suggestedDestinations(state: PrivateState, result: PlayResult): Record<string, Destination> {
  const moves: Record<string, Destination> = {};
  const distance = result === 'double' ? 2 : result === 'triple' ? 3 : result === 'homeRun' ? 4 : 1;
  const isHit = ['single', 'double', 'triple', 'homeRun', 'error', 'fieldersChoice'].includes(result);
  const isWalk = result === 'walk' || result === 'hitByPitch';
  state.bases.forEach((runner, index) => {
    if (!runner) return;
    let target = index + 1;
    if (isHit) target = Math.min(4, target + distance);
    if (isWalk && state.bases.slice(0, index).every(Boolean)) target += 1;
    if (result === 'sacrificeFly' && index === 2) target = 4;
    if (result === 'sacrificeBunt') target = Math.min(4, target + 1);
    if (!isDestination(target)) throw new Error('Avance de corredor inválido.');
    moves[runner] = target;
  });
  if (result === 'doublePlay' || result === 'triplePlay') {
    const runners = state.bases.filter((id): id is string => id !== null);
    const required = result === 'doublePlay' ? 1 : 2;
    runners.slice(0, required).forEach((id) => { moves[id] = 0; });
  }
  moves[currentBatter(state)] = isHit || isWalk ? distance : 0;
  return moves;
}

export function minimumDestinations(state: PrivateState, result: PlayResult): Record<string, Destination> {
  const moves = suggestedDestinations(state, result);
  if (!['single', 'double', 'triple', 'homeRun', 'error', 'fieldersChoice'].includes(result)) return moves;
  let occupiedThrough = moves[currentBatter(state)];
  state.bases.forEach((runner, index) => {
    if (!runner) return;
    const target = Math.min(4, Math.max(index + 1, occupiedThrough + 1));
    if (!isDestination(target)) throw new Error('Avance de corredor inválido.');
    moves[runner] = target;
    occupiedThrough = target;
  });
  return moves;
}

function changeHalf(state: PrivateState) {
  if (state.outs < 3) return;
  if (state.side === 'home') state.inning += 1;
  state.side = state.side === 'away' ? 'home' : 'away';
  state.balls = 0;
  state.strikes = 0;
  state.outs = 0;
  state.bases = [null, null, null];
  state.courtesyFor = {};
}

export function applyPrivateCommand(current: PrivateState, command: PrivateCommand): PrivateState {
  if (!isScorecardCommand(command)) throw new Error('La anotación contiene datos inválidos.');
  if (current.finished && !command.sharedRequestId) throw new Error('El seguimiento privado está cerrado. Deshaz el cierre para continuar.');
  const state = structuredClone(current);
  const batter = currentBatter(state);
  const log: PrivateLog = {
    inning: state.inning, side: state.side, batterId: null, runnerId: null, result: null, pitch: null, text: '',
    runs: [], outs: 0, stolenBy: null, rbis: 0,
    pitcherId: state.lineups[state.side === 'away' ? 'home' : 'away'].find((p) => p.position === 'P')?.id ?? null
  };
  const finishTurn = (result: PlayResult, destinations?: Record<string, Destination>, validThirdOutRuns = false) => {
    if (state.bases.includes(batter)) throw new Error('El bateador actual ya está en base. Revisa los corredores o registra un corredor temporal válido.');
    const suggested = suggestedDestinations(state, result);
    const moves = destinations ?? suggested;
    const ids = [...state.bases.filter((id): id is string => id !== null), batter];
    if (Object.keys(moves).length !== ids.length || ids.some((id) => !Object.hasOwn(moves, id))) {
      throw new Error('Indica el destino del bateador y de todos los corredores de esta jugada.');
    }
    if ((result === 'walk' || result === 'hitByPitch' || result === 'homeRun') &&
        ids.some((id) => moves[id] !== suggested[id])) throw new Error('Esta jugada exige los avances reglamentarios indicados.');
    const outResult = ['strikeout', 'groundOut', 'flyOut', 'lineOut', 'battedOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt', 'doublePlay', 'triplePlay'].includes(result);
    if (outResult && moves[batter] !== 0) throw new Error('En este resultado el bateador debe quedar eliminado.');
    log.outs = ids.filter((id) => moves[id] === 0).length;
    const expected = result === 'doublePlay' ? 2 : result === 'triplePlay' ? 3 : outResult ? 1 : 0;
    if (log.outs < expected || (['doublePlay', 'triplePlay'].includes(result) && log.outs !== expected) ||
        state.outs + log.outs > 3) throw new Error('La cantidad de eliminados no corresponde a la jugada o supera los tres de la entrada.');
    const nextBases: Array<string | null> = [null, null, null];
    ids.forEach((id) => {
      const target = moves[id];
      if (target === 4) log.runs.push(id);
      if (target > 0 && target < 4) {
        if (nextBases[target - 1]) throw new Error('Dos jugadores no pueden ocupar la misma base. Ajusta los destinos.');
        nextBases[target - 1] = id;
      }
    });
    if ((result === 'sacrificeFly' && (state.outs >= 2 || !log.runs.length)) ||
        (result === 'sacrificeBunt' && state.outs >= 2)) {
      throw new Error('El sacrificio requiere menos de dos eliminados; el elevado de sacrificio debe impulsar una carrera.');
    }
    if (state.outs + log.outs === 3) {
      const batterIsThirdOutBeforeFirst = log.outs === 1 && moves[batter] === 0 && outResult;
      if (batterIsThirdOutBeforeFirst || !validThirdOutRuns) log.runs = [];
    }
    state.bases = nextBases;
    delete state.courtesyFor[batter];
    log.batterId = batter;
    log.result = result;
    log.text = `${playerName(state, batter)}: ${playLabels[result]}`;
    if (!['error', 'doublePlay', 'triplePlay'].includes(result)) log.rbis = log.runs.length;
    state.indexes[state.side] += 1;
    state.balls = 0;
    state.strikes = 0;
  };
  switch (command.kind) {
    case 'pitch':
      log.batterId = batter;
      log.pitch = command.value;
      log.text = `${playerName(state, batter)}: ${command.value === 'ball' ? 'Bola' : command.value === 'foul' ? 'Batazo de falta' : 'Strike'}`;
      if (command.value === 'ball') {
        state.balls += 1;
        if (state.balls === 4) finishTurn('walk');
      } else if (command.value === 'strike') {
        state.strikes += 1;
        if (state.strikes === 3) finishTurn('strikeout');
      } else state.strikes = Math.min(2, state.strikes + 1);
      break;
    case 'play':
      finishTurn(command.result, command.destinations, command.validThirdOutRuns);
      if (command.note?.trim()) log.text += ` · ${command.note.trim()}`;
      break;
    case 'runner': {
      const runner = state.bases[command.from - 1];
      if (!runner) throw new Error('No hay corredor en la base seleccionada.');
      const eliminated = ['caught', 'pickoff', 'ruleOut', 'advanceOut'].includes(command.action);
      if (eliminated ? command.to !== 0 : command.to <= command.from) throw new Error('Selecciona un avance válido o un corredor eliminado.');
      if (command.action === 'steal' && command.to !== command.from + 1) throw new Error('Registra cada base robada por separado.');
      if (command.action === 'run' && command.to !== 4) throw new Error('Una carrera debe terminar en el plato.');
      if (command.to > 0 && command.to < 4 && state.bases[command.to - 1]) throw new Error('La base de destino está ocupada.');
      state.bases[command.from - 1] = null;
      if (command.to > 0 && command.to < 4) state.bases[command.to - 1] = runner;
      if (command.to === 4) log.runs = [runner];
      if (eliminated) log.outs = 1;
      if (command.action === 'steal') log.stolenBy = runner;
      log.runnerId = runner;
      log.text = `${playerName(state, runner)}: ${runnerLabels[command.action]}`;
      if (command.action === 'advanceOut') log.text += command.attemptedBase === 4 ? ' · intentando llegar a home' : ` · intentando llegar a ${command.attemptedBase}.ª base`;
      if (!eliminated) log.text += command.to === 4 ? ' · al plato' : ` · a base ${command.to}`;
      if (command.note?.trim()) log.text += ` · ${command.note.trim()}`;
      break;
    }
    case 'courtesy': {
      const runner = state.bases[command.from - 1];
      const replaced = state.lineups[state.side].find((p) => p.id === (runner ? state.courtesyFor[runner] ?? runner : null));
      const eligible = state.seed.rosters[state.side].find((p) => p.id === command.playerId);
      const sourceRule = command.sourceRule ?? state.seed.courtesyRunnerSource;
      if (!runner || !replaced || !['P', 'C'].includes(replaced.position)) throw new Error('El corredor temporal solo puede reemplazar al lanzador o receptor que está en base.');
      if (!eligible || runner === eligible.id || state.bases.includes(eligible.id) ||
          sourceRule === 'BENCH' && state.lineups[state.side].some((p) => p.id === eligible.id)) {
        throw new Error('El corredor temporal no cumple la regla del organizador o ya ocupa una base.');
      }
      state.bases[command.from - 1] = eligible.id;
      state.courtesyFor[eligible.id] = replaced.id;
      state.seed.courtesyRunnerSource = sourceRule;
      log.runnerId = runner;
      log.text = `Corredor temporal: ${eligible.name} por ${playerName(state, runner)}`;
      break;
    }
    case 'substitution': {
      const lineup = state.lineups[command.side];
      const outgoing = lineup.find((p) => p.id === command.outId);
      const incoming = state.seed.rosters[command.side].find((p) => p.id === command.inId);
      if (!outgoing || !incoming || lineup.some((p) => p.id === incoming.id)) throw new Error('Selecciona un jugador activo y un sustituto de la plantilla que no esté en la alineación.');
      if (lineup.some((p) => p.id !== outgoing.id && Number(p.jersey) === Number(command.jersey))) throw new Error('El número de camiseta ya pertenece a un jugador activo.');
      if (command.position !== outgoing.position && lineup.some((p) => p.id !== outgoing.id && p.position === command.position && p.position !== 'NA')) {
        throw new Error('La posición está ocupada. Registra primero el cambio defensivo.');
      }
      if (command.side === state.side && state.bases.includes(incoming.id)) throw new Error('El sustituto ya ocupa una base como corredor temporal.');
      state.lineups[command.side] = lineup.map((p) => p.id === outgoing.id ? {
        ...incoming, order: outgoing.order, position: command.position, jersey: command.jersey
      } : p);
      if (command.side === state.side) {
        state.bases = state.bases.map((id) => id === outgoing.id ? incoming.id : id);
        Object.keys(state.courtesyFor).forEach((id) => {
          if (state.courtesyFor[id] === outgoing.id) state.courtesyFor[id] = incoming.id;
        });
      }
      log.text = `Cambio en ${state.seed.names[command.side]}: entra ${incoming.name} por ${outgoing.name}; conserva su turno de bateo`;
      break;
    }
    case 'position': {
      const lineup = state.lineups[command.side];
      const player = lineup.find((p) => p.id === command.playerId);
      if (!player) throw new Error('El jugador no está en la alineación activa.');
      if (command.position === 'DH' && lineup.some((p) => p.id !== player.id && p.position === 'DH')) {
        throw new Error('El puesto de bateador designado ya está ocupado.');
      }
      const swap = ['DH', 'NA'].includes(command.position) ? undefined : lineup.find((p) => p.position === command.position && p.id !== player.id);
      state.lineups[command.side] = lineup.map((p) => p.id === player.id ? { ...p, position: command.position } :
        p.id === swap?.id ? { ...p, position: player.position } : p);
      log.text = `Cambio defensivo: ${player.name} a ${command.position}${swap ? `; intercambia con ${swap.name}` : ''}`;
      break;
    }
    case 'received-lineup':
      createPrivateState({ ...state.seed, lineups: { ...state.seed.lineups, [command.side]: command.players } });
      state.lineups[command.side] = structuredClone(command.players);
      log.text = `Alineación compartida recibida de ${state.seed.names[command.side]}; los turnos privados anteriores se conservan`;
      break;
    case 'misplay':
      log.batterId = batter;
      log.text = `Error en foul que prolonga el turno de ${playerName(state, batter)}`;
      break;
    case 'run-review':
      state.runAccounting = reviewAccountedRun(state.runAccounting, command.review);
      log.text = `Revisión de carrera: ${command.review.note.trim()}`;
      break;
    case 'note': log.text = `Nota: ${command.note.trim()}`; break;
    case 'finish': state.finished = true; log.text = 'Seguimiento privado cerrado; no es un resultado oficial'; break;
  }
  if (command.kind !== 'run-review') {
    const misplay = command.kind === 'misplay' || log.result === 'error' ||
      command.kind === 'runner' && command.action === 'error' ? 'error' :
      command.kind === 'runner' && command.action === 'passed' ? 'passedBall' : undefined;
    const replacement = command.kind === 'courtesy' && log.runnerId ?
      { outgoing: log.runnerId, incoming: command.playerId } :
      command.kind === 'substitution' && command.side === current.side && current.bases.includes(command.outId) ?
        { outgoing: command.outId, incoming: command.inId } : undefined;
    state.runAccounting = accountRuns(state.runAccounting, {
      eventId: state.log.length + 1, half: `${log.inning}:${log.side}`, offenseId: log.side,
      pitcherId: log.pitcherId, outsBefore: current.outs, batterId: log.batterId,
      plateCompleted: log.result !== null, reachedOnError: log.result === 'error',
      basesBefore: current.bases, basesAfter: state.bases, scored: log.runs, totalRuns: log.runs.length,
      misplay, errorOuts: 'errorOuts' in command ? command.errorOuts : undefined,
      unknownAdvance: command.kind === 'runner' && ['advance', 'run'].includes(command.action) && !command.cleanAdvance,
      homeRun: log.result === 'homeRun', uncertainPlay: log.result === 'fieldersChoice',
      prolongedBatter: command.kind === 'misplay', replacement,
      ballsBefore: current.balls, strikesBefore: current.strikes, walk: log.result === 'walk',
      eliminated: log.outs ? [...current.bases, ...(log.result ? [batter] : [])].filter((id): id is string =>
        id !== null && !state.bases.includes(id) && !log.runs.includes(id)) : []
    });
  }
  state.scores[log.side] += log.runs.length;
  state.outs += log.outs;
  Object.keys(state.courtesyFor).forEach((id) => {
    if (!state.bases.includes(id)) delete state.courtesyFor[id];
  });
  state.log.push(log);
  if (command.sharedRequestId && command.teamSheetSide && command.teamSheetRevision !== undefined) {
    state.seed.teamSheetRevisions = {
      home: state.seed.teamSheetRevisions?.home ?? 0,
      away: state.seed.teamSheetRevisions?.away ?? 0,
      [command.teamSheetSide]: command.teamSheetRevision
    };
  }
  changeHalf(state);
  return state;
}

export function replayPrivate(seed: PrivateSeed, commands: PrivateCommand[]): PrivateState {
  return commands.reduce(applyPrivateCommand, createPrivateState(seed));
}

export function setLastPrivateErrorOuts(seed: PrivateSeed, commands: PrivateCommand[], errorOuts?: number) {
  const last = commands.at(-1);
  if (!last || last.kind !== 'play' || last.result !== 'error' || last.sharedRequestId) {
    throw new Error('Solo puedes completar el detalle de la última jugada privada si fue un embasado por error.');
  }
  const updated = { ...last };
  if (errorOuts === undefined) delete updated.errorOuts;
  else updated.errorOuts = errorOuts;
  const next = [...commands.slice(0, -1), updated];
  return { commands: next, state: replayPrivate(seed, next) };
}

export function undoPrivateCommand(seed: PrivateSeed, commands: PrivateCommand[]) {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (commands[index].sharedRequestId) continue;
    const remaining = commands.filter((_, position) => position !== index);
    return { commands: remaining, state: replayPrivate(seed, remaining) };
  }
  throw new Error('No hay jugadas privadas que deshacer. Los movimientos confirmados requieren una nueva solicitud para cambiarse.');
}

export function readPrivateSave(raw: string): { version: 1; seed: PrivateSeed; commands: PrivateCommand[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('La planilla privada guardada no se puede leer. No se sobrescribió.');
  }
  if (!isRecord(data) || data.version !== 1 || !isSeed(data.seed) || !Array.isArray(data.commands) || !data.commands.every(isScorecardCommand)) {
    throw new Error('La planilla privada guardada no tiene un formato válido. No se sobrescribió.');
  }
  replayPrivate(data.seed, data.commands);
  return { version: 1, seed: data.seed, commands: data.commands };
}

export function privateFinishSuggestion(state: PrivateState): {
  winner: Side; inning: number; eventIndex: number;
  reason: 'homeAheadAfterTop' | 'walkOff' | 'completedInning';
} | null {
  const limit = state.seed.regulationInnings;
  if (state.finished || limit === undefined) return null;
  for (let eventIndex = state.log.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const entry = state.log[eventIndex];
    if (!entry.pitch && !entry.result && entry.outs === 0 && entry.runs.length === 0) continue;
    if (entry.inning < limit) return null;
    if (entry.outs > 0 && state.outs === 0) {
      if (entry.side === 'away' && state.side === 'home' && state.inning === entry.inning &&
          state.scores.home > state.scores.away) {
        return { winner: 'home', inning: entry.inning, eventIndex, reason: 'homeAheadAfterTop' };
      }
      if (entry.side === 'home' && state.side === 'away' && state.inning === entry.inning + 1 &&
          state.scores.home !== state.scores.away) {
        return { winner: state.scores.home > state.scores.away ? 'home' : 'away',
          inning: entry.inning, eventIndex, reason: 'completedInning' };
      }
    }
    if (entry.side === 'home' && state.side === 'home' && state.inning === entry.inning &&
        entry.runs.length > 0 && state.scores.home > state.scores.away &&
        state.scores.home - entry.runs.length <= state.scores.away) {
      return { winner: 'home', inning: entry.inning, eventIndex, reason: 'walkOff' };
    }
    return null;
  }
  return null;
}

export function privateInningRuns(state: PrivateState, side: Side, inning: number): number | null {
  if (inning > state.inning || (inning === state.inning && side === 'home' && state.side === 'away')) return null;
  return state.log.reduce((runs, entry) =>
    entry.side === side && entry.inning === inning ? runs + entry.runs.length : runs, 0);
}

export function privateStats(state: PrivateState, side: Side, id: string) {
  const turns = state.log.filter((e) => e.side === side && e.batterId === id && e.result !== null);
  const hits = turns.filter((e) => e.result && ['single', 'double', 'triple', 'homeRun'].includes(e.result)).length;
  const atBats = turns.filter((e) => e.result && !['walk', 'hitByPitch', 'sacrificeFly', 'sacrificeBunt'].includes(e.result)).length;
  return {
    pa: turns.length, hits, atBats,
    average: atBats ? (hits / atBats).toFixed(3).replace(/^0/, '') : '—',
    runs: state.log.filter((e) => e.side === side).reduce((sum, e) => sum + e.runs.filter((runner) => runner === id).length, 0),
    rbis: turns.reduce((sum, e) => sum + e.rbis, 0),
    walks: turns.filter((e) => e.result === 'walk').length,
    strikeouts: turns.filter((e) => e.result === 'strikeout').length,
    homeRuns: turns.filter((e) => e.result === 'homeRun').length,
    steals: state.log.filter((e) => e.side === side && e.stolenBy === id).length
  };
}
