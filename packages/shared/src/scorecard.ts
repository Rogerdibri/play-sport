import {
  accountRuns, createRunAccounting, reviewAccountedRun, validRunEvidence, validRunReview,
  runTotals, type RunAccounting, type RunReview
} from './earned-runs.js';
import { isGameClock, type GameClock } from './game-clock.js';
import { finalReviewIssue, isGameFinalReview, type GameFinalReview } from './game-final-review.js';
import { normalizeProfileIdentification } from './registration.js';

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
export const scoringRuleLabels = {
  baseball: 'Béisbol', 'softball-fastpitch': 'Sóftbol rápido',
  'softball-modified': 'Sóftbol modificado', 'softball-slowpitch': 'Sóftbol lento'
} as const;
export type ScoringRules = keyof typeof scoringRuleLabels;
export function declaredScoringRules(sport: string, modality: string): ScoringRules | undefined {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const normalized = normalize(sport);
  if (['baseball', 'beisbol'].includes(normalized)) return 'baseball';
  if (!['softball', 'softbol'].includes(normalized)) return undefined;
  const rules: Record<string, ScoringRules> = { lento: 'softball-slowpitch', rapido: 'softball-fastpitch', modificado: 'softball-modified' };
  return rules[normalize(modality)];
}
export type DefensiveError = { playerId: string; position: string; type: 'fielding' | 'throwing' | 'obstruction' };
export type PrivatePlayer = {
  id: string;
  name: string;
  position: string;
  jersey: string;
  order: number | null;
  identification?: string;
};
export function scorecardParticipants(state: PrivateState, side: Side): PrivatePlayer[] {
  const ids = new Set([...state.seed.lineups[side], ...state.lineups[side], ...(state.participants?.[side] ?? [])].map(player => player.id));
  for (const entry of state.log) {
    if (entry.side === side) {
      for (const id of [entry.batterId, entry.runnerId, entry.stolenBy, ...entry.runs]) if (id) ids.add(id);
    } else {
      if (entry.pitcherId && (entry.result !== null || entry.pitch !== null || entry.runnerId !== null || entry.outs > 0 || entry.runs.length > 0))
        ids.add(entry.pitcherId);
      for (const id of Object.values(entry.defenders ?? {})) ids.add(id);
    }
  }
  return state.seed.rosters[side].filter(player => ids.has(player.id)).map(player => {
    const active = state.lineups[side].find(entry => entry.id === player.id);
    const initial = state.seed.lineups[side].find(entry => entry.id === player.id);
    const historical = state.participants?.[side].find(entry => entry.id === player.id);
    return { ...player, position: active?.position ?? historical?.position ?? initial?.position ?? player.position,
      jersey: active?.jersey ?? historical?.jersey ?? initial?.jersey ?? player.jersey,
      order: initial?.order ?? active?.order ?? historical?.order ?? player.order };
  }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) ||
    Number(!state.seed.lineups[side].some(player => player.id === a.id)) -
      Number(!state.seed.lineups[side].some(player => player.id === b.id)));
}
export function scorecardSourceComplete(state: PrivateState, offenseIds?: Record<Side, string>): boolean {
  return !state.fieldingIncomplete && state.log.some(entry =>
    entry.result !== null || entry.pitch !== null || entry.runnerId !== null || entry.outs > 0 || entry.runs.length > 0) &&
    (['home', 'away'] as const).every(side =>
      state.log.filter(entry => entry.side === side).reduce((sum, entry) => sum + entry.runs.length, 0) === state.scores[side] &&
      runTotals(state.runAccounting.runs.filter(run => run.offenseId === (offenseIds?.[side] ?? side)), 'team').total === state.scores[side]);
}
export type ParticipantIdentity = { side: Side; playerId: string; identification: string };
export function isParticipantIdentity(value: unknown): value is ParticipantIdentity {
  return isRecord(value) && Object.keys(value).every(key => ['side', 'playerId', 'identification'].includes(key)) &&
    (value.side === 'home' || value.side === 'away') && typeof value.playerId === 'string' && value.playerId.length > 0 &&
    typeof value.identification === 'string' && value.identification.length <= 40 &&
    (value.identification.trim() === '' || /^[VE]-[1-9]\d{0,9}$/.test(normalizeProfileIdentification(value.identification)));
}
export function linkScorecardParticipant(seed: PrivateSeed, input: ParticipantIdentity): PrivateSeed {
  if (!isParticipantIdentity(input)) throw new Error('Selecciona el participante y una cédula V o E válida, o deja la cédula vacía para quitar el vínculo.');
  if (!seed.rosters[input.side].some(player => player.id === input.playerId))
    throw new Error('El participante no pertenece a esta planilla.');
  const identification = normalizeProfileIdentification(input.identification);
  if (identification && sides.some(side => seed.rosters[side].some(player =>
    (side !== input.side || player.id !== input.playerId) &&
    normalizeProfileIdentification(player.identification ?? player.id) === identification)))
    throw new Error('Esta cédula ya está vinculada a otro participante del partido.');
  const update = (player: PrivatePlayer): PrivatePlayer => {
    if (player.id !== input.playerId) return player;
    const next = { ...player };
    next.identification = identification;
    return next;
  };
  return { ...seed, rosters: { ...seed.rosters, [input.side]: seed.rosters[input.side].map(update) },
    lineups: { ...seed.lineups, [input.side]: seed.lineups[input.side].map(update) } };
}
export type PrivateSeed = {
  friendly?: true;
  names: Record<Side, string>;
  lineups: Record<Side, PrivatePlayer[]>;
  rosters: Record<Side, PrivatePlayer[]>;
  courtesyRunnerSource: 'BENCH' | 'ROSTER';
  regulationInnings?: 7 | 9;
  softballTieBreakerFromInning?: number;
  scoringRules?: ScoringRules;
  sport?: 'baseball' | 'softball';
  teamSheetRevisions?: Record<Side, number>;
};
export const playLabels = {
  single: 'Sencillo', double: 'Doble', triple: 'Triple', homeRun: 'Jonrón',
  walk: 'Base por bolas', hitByPitch: 'Golpeado por lanzamiento',
  intentionalWalk: 'Base intencional', insideParkHomeRun: 'Jonrón dentro del campo',
  groundRuleDouble: 'Doble por regla', buntHit: 'Toque de bola', buntOut: 'Out en toque',
  droppedThirdStrike: 'Tercer strike caído', sacrificeBuntError: 'Toque de sacrificio con error',
  sacrificeFlyError: 'Elevado de sacrificio con error', catcherInterference: 'Interferencia / obstrucción del receptor',
  strikeout: 'Ponche', groundOut: 'Eliminado por rodado', flyOut: 'Eliminado por elevado',
  lineOut: 'Eliminado por línea', battedOut: 'Out al batear', ruleOut: 'Out por regla', sacrificeFly: 'Elevado de sacrificio',
  sacrificeBunt: 'Toque de sacrificio', error: 'Se embasa por error',
  fieldersChoice: 'Jugada de selección', doublePlay: 'Doble jugada', triplePlay: 'Triple jugada'
} as const;
export type PlayResult = keyof typeof playLabels;
export const battedBallLabels = { ground: 'Rolling / rodado', line: 'Línea', fly: 'Elevado', bunt: 'Toque' } as const;
export type BattedBallType = keyof typeof battedBallLabels;
export const battedOutResults = { ground: 'groundOut', line: 'lineOut', fly: 'flyOut', bunt: 'buntOut' } as const;
export const defensivePositionNumbers = [
  { number: 1, label: 'Pitcher' }, { number: 2, label: 'Receptor' }, { number: 3, label: 'Primera base' },
  { number: 4, label: 'Segunda base' }, { number: 5, label: 'Tercera base' }, { number: 6, label: 'Campocorto' },
  { number: 7, label: 'Jardinero izquierdo' }, { number: 8, label: 'Jardinero central' }, { number: 9, label: 'Jardinero derecho' }
] as const;
export function battedBallTypeForLog(entry: Pick<PrivateLog, 'result' | 'battedBallType'>): BattedBallType | null {
  if (entry.battedBallType) return entry.battedBallType;
  return entry.result === 'groundOut' ? 'ground' : entry.result === 'lineOut' ? 'line' :
    entry.result === 'flyOut' || entry.result === 'sacrificeFly' ? 'fly' :
      entry.result === 'buntOut' || entry.result === 'sacrificeBunt' ? 'bunt' : null;
}
function validBattedOutDetails(value: Record<string, unknown>): boolean {
  if (value.battedBallType === undefined && value.fieldingSequence === undefined) return true;
  const ruleContact = value.result === 'ruleOut' && isRecord(value.batterRuleOut) &&
    value.batterRuleOut.reason === 'intentionalDrop' && ['fly', 'line'].includes(String(value.battedBallType));
  if (ruleContact && value.fieldingSequence === undefined) return true;
  if (!Array.isArray(value.fieldingSequence) ||
      value.fieldingSequence.length < 1 || value.fieldingSequence.length > 20 ||
      ![...value.fieldingSequence].every(position => Number.isInteger(position) && position >= 1 && position <= 10)) return false;
  if (value.battedBallType === undefined) return value.kind === 'runner' && ['caught', 'pickoff', 'advanceOut'].includes(String(value.action)) ||
    value.result === 'droppedThirdStrike' ||
    value.result === null && typeof value.runnerId === 'string' && value.outs === 1 && value.ruleOut === undefined;
  if (!hasKey(battedBallLabels, value.battedBallType)) return false;
  const type = value.battedBallType;
  return ruleContact || value.result === battedOutResults[type] || value.result === 'doublePlay' || value.result === 'triplePlay' ||
    ['fieldersChoice', 'single', 'double', 'triple', 'homeRun', 'insideParkHomeRun', 'groundRuleDouble', 'error'].includes(String(value.result)) ||
    type === 'fly' && ['sacrificeFly', 'sacrificeFlyError'].includes(String(value.result)) ||
    type === 'bunt' && ['buntHit', 'sacrificeBunt', 'sacrificeBuntError'].includes(String(value.result));
}
export function defensivePlayContext(state: PrivateState): string {
  return JSON.stringify([state.inning, state.side, state.log.length, currentBatter(state), state.outs, state.bases]);
}
export function defensivePositions(state: PrivateState): readonly { number: number; label: string }[] {
  return isSoftballScorecard(state.seed) && state.lineups[state.side === 'away' ? 'home' : 'away']
    .some(player => ['OF4', 'SF'].includes(player.position)) ?
    [...defensivePositionNumbers, { number: 10, label: 'Jardinero adicional / SF' }] : defensivePositionNumbers;
}
export function defensivePlayerAt(state: PrivateState, number: number): PrivatePlayer | undefined {
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  return state.lineups[state.side === 'away' ? 'home' : 'away'].find(player =>
    number === 10 ? isSoftballScorecard(state.seed) && ['OF4', 'SF'].includes(player.position) :
      player.position === positions[number - 1]);
}
export type CaughtBallFielder = { playerId: string; position: number };
function validCaughtBallDetails(value: Record<string, unknown>): boolean {
  if (value.caughtBy === undefined) return true;
  return isRecord(value.caughtBy) && typeof value.caughtBy.playerId === 'string' && value.caughtBy.playerId.length > 0 &&
    Number.isInteger(value.caughtBy.position) && Number(value.caughtBy.position) >= 1 && Number(value.caughtBy.position) <= 10 &&
    ['lineOut', 'flyOut', 'sacrificeFly'].includes(String(value.result)) &&
    Array.isArray(value.fieldingSequence) && value.fieldingSequence.length === 1 && value.fieldingSequence[0] === value.caughtBy.position &&
    value.errors === undefined && value.selectionOuts === undefined && value.infieldFly === undefined && value.batterRuleOut === undefined;
}
export const strikeoutLabels = { swinging: 'Abanicando (K)', looking: 'Cantado (ꓘ)' } as const;
export type StrikeoutType = keyof typeof strikeoutLabels;
export const scorecardPlayGroups: readonly { title: string; tone: 'onBase' | 'out'; results: readonly PlayResult[] }[] = [
  { title: 'Batazos y embasados', tone: 'onBase', results: [
    'single', 'double', 'triple', 'homeRun', 'error', 'fieldersChoice',
    'intentionalWalk', 'insideParkHomeRun', 'groundRuleDouble', 'buntHit',
    'hitByPitch', 'droppedThirdStrike', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference'
  ] },
  { title: 'Outs y sacrificios', tone: 'out', results: ['battedOut', 'groundOut', 'flyOut', 'lineOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt', 'doublePlay', 'triplePlay'] }
];
export const runnerLabels = {
  steal: 'Robo de base', caught: 'Atrapado robando', pickoff: 'Sorprendido fuera de base',
  wild: 'Lanzamiento descontrolado', passed: 'Bola pasada', balk: 'Movimiento ilegal del lanzador',
  advance: 'Avance de corredor', error: 'Avance por error', run: 'Carrera anotada', ruleOut: 'Out por regla',
  advanceOut: 'Out al avanzar', obstruction: 'Avance por obstrucción defensiva'
} as const;
export type RunnerAction = keyof typeof runnerLabels;
export const runnerRuleOutReasons = ['runnerInterference', 'missedBase', 'leftEarly', 'missedRetouch', 'hitByBattedBall', 'offensiveInterference', 'outOfBasePath', 'other'] as const;
export type RunnerRuleOutReason = typeof runnerRuleOutReasons[number];
export type RunnerRuleOut = { reason: RunnerRuleOutReason; appealBase?: 1 | 2 | 3 | 4 };
export const runnerRuleOutLabels: Record<RunnerRuleOutReason, string> = {
  runnerInterference: 'Interferencia del corredor',
  missedBase: 'Se saltó una base (apelación)',
  leftEarly: 'Salió antes de lo permitido (softbol)',
  missedRetouch: 'No retocó tras un elevado (apelación)',
  hitByBattedBall: 'Corredor golpeado por un batazo',
  offensiveInterference: 'Interferencia ofensiva',
  outOfBasePath: 'Salió del sendero para evitar el toque',
  other: 'Otro out por regla'
};
export const runnerRuleOutHelp: Record<RunnerRuleOutReason, string> = {
  runnerInterference: 'El corredor impidió una acción defensiva y el árbitro lo declaró out.',
  missedBase: 'Selecciona la base omitida. Registra el out solo después de la decisión sobre la apelación.',
  leftEarly: 'Solo en softbol: salida antes del momento permitido por la modalidad, declarada out por el árbitro.',
  missedRetouch: 'Selecciona la base que debía retocar después de la atrapada y confirma la decisión sobre la apelación.',
  hitByBattedBall: 'Solo si el árbitro declaró out por un batazo. Una pelota tirada que golpea al corredor no basta.',
  offensiveInterference: 'Registra esta causa únicamente si la decisión arbitral elimina a este corredor, no a otro atacante.',
  outOfBasePath: 'No basta alejarse de la línea entre bases: registra el out por evitar el toque señalado por el árbitro.',
  other: 'Describe el motivo de la eliminación señalado por el árbitro.'
};
export function runnerRuleOutOptions(state: PrivateState): RunnerRuleOutReason[] {
  return runnerRuleOutReasons.filter(reason => reason !== 'leftEarly' || isSoftballScorecard(state.seed));
}
export function isRunnerRuleOut(value: unknown): value is RunnerRuleOut {
  return isRecord(value) && runnerRuleOutReasons.some(reason => reason === value.reason) &&
    (value.reason === 'missedBase' || value.reason === 'missedRetouch' ?
      isDestination(value.appealBase) && value.appealBase > 0 && (value.reason !== 'missedRetouch' || value.appealBase < 4) :
      value.appealBase === undefined);
}
export function runnerRuleOutIssue(state: PrivateState, detail: RunnerRuleOut | undefined, note?: string): string | null {
  if (!detail) return 'Selecciona la causa del out por regla.';
  if (!runnerRuleOutOptions(state).includes(detail.reason)) return 'La causa seleccionada no corresponde a la modalidad del partido.';
  if (!isRunnerRuleOut(detail)) return 'Selecciona la base de la apelación.';
  if (detail.reason === 'other' && !note?.trim()) return 'Describe el motivo del out por regla.';
  return null;
}
export function runnerRuleOutDescription(detail: RunnerRuleOut): string {
  return `${runnerRuleOutLabels[detail.reason]}${detail.appealBase ? ` · base apelada: ${detail.appealBase === 4 ? 'home' : `${detail.appealBase}.ª`}` : ''}`;
}
export const batterRuleOutLabels = {
  batterInterference: 'Interferencia del bateador',
  battingOutOfTurn: 'Bateo fuera de turno (apelación)',
  outsideBox: 'Bateo fuera del cajón',
  secondContact: 'Segundo contacto ilegal con la pelota',
  illegalBat: 'Bate ilegal o alterado',
  intentionalDrop: 'Caída intencional de la pelota',
  other: 'Otro out del bateador por regla'
} as const;
export type BatterRuleOutReason = keyof typeof batterRuleOutLabels;
export type BatterRuleOut = { umpireConfirmed: true } & (
  | { reason: 'battingOutOfTurn'; appealConfirmed: true }
  | { reason: Exclude<BatterRuleOutReason, 'battingOutOfTurn'>; appealConfirmed?: never }
);
export const batterRuleOutHelp: Record<BatterRuleOutReason, string> = {
  batterInterference: 'Solo si la decisión arbitral elimina al bateador. No toda interferencia elimina a la misma persona.',
  battingOutOfTurn: 'La apelación debe ser aceptada después del turno indebido y antes del siguiente lanzamiento o intento de jugada. Se elimina a quien debía batear. Si guardaste el turno indebido, primero cancela este formulario y deshaz esa anotación; conserva robos, WP, PB y balks previos. Si se detectó antes de terminar el turno, no corresponde un out.',
  outsideBox: 'Un pie completamente fuera del cajón, apoyado en el suelo al golpear la pelota, según la decisión arbitral. No basta pisar la línea.',
  secondContact: 'Segundo contacto sancionado por el árbitro; un contacto accidental dentro del cajón o una pelota foul no bastan por sí solos.',
  illegalBat: 'Solo si el reglamento aplicado y la decisión arbitral declaran out al bateador. No toda revisión o retiro de un bate produce un out.',
  intentionalDrop: 'Elevado o línea fair dejado caer intencionalmente por un infielder, con primera ocupada y menos de dos outs. Dejar caer la pelota sin tocarla no basta. Si el árbitro declaró infield fly, usa esa opción.',
  other: 'Describe la causa exacta indicada por el árbitro. Un toque foul con dos strikes se registra como ponche, no aquí.'
};
export function isBatterRuleOut(value: unknown): value is BatterRuleOut {
  return isRecord(value) && hasKey(batterRuleOutLabels, value.reason) && value.umpireConfirmed === true &&
    (value.reason === 'battingOutOfTurn' ? value.appealConfirmed === true : value.appealConfirmed === undefined);
}
export function batterRuleOutRestriction(state: PrivateState, reason: BatterRuleOutReason): string | null {
  if (reason === 'intentionalDrop' && (state.outs >= 2 || !state.bases[0]))
    return 'La pelota dejada caer intencionalmente requiere primera ocupada y menos de dos outs.';
  return null;
}
export function batterRuleOutIssue(state: PrivateState, detail: BatterRuleOut | undefined, type?: BattedBallType, note?: string): string | null {
  if (!detail) return 'Selecciona la causa del out del bateador y confirma la decisión arbitral.';
  if (!isBatterRuleOut(detail)) return 'Confirma la decisión arbitral y, si corresponde, la apelación y el turno correcto.';
  const restriction = batterRuleOutRestriction(state, detail.reason);
  if (restriction) return restriction;
  if (detail.reason === 'intentionalDrop' && type !== 'fly' && type !== 'line')
    return 'Indica si la pelota dejada caer fue un elevado o una línea fair.';
  if (detail.reason === 'other' && !note?.trim()) return 'Describe la causa del out del bateador por regla.';
  return null;
}
export type FieldersChoiceOut = { runnerId: string; base: Exclude<Destination, 0> };
export type PrivateCommand = {
  sharedRequestId?: string;
  teamSheetRevision?: number;
  teamSheetSide?: Side;
} & (
  | { kind: 'pitch'; value: 'ball' | 'strike' | 'foul'; strikeoutType?: StrikeoutType }
  | { kind: 'play'; result: PlayResult; destinations?: Record<string, Destination>; validThirdOutRuns?: boolean; note?: string; errorOuts?: number;
      errors?: DefensiveError[]; errorSavedRunnerId?: string; selectionOuts?: FieldersChoiceOut[]; thirdStrikeCause?: 'wild' | 'passed'; strikeoutType?: StrikeoutType; rbis?: number;
      battedBallType?: BattedBallType; fieldingSequence?: number[]; outAt?: number[]; caughtBy?: CaughtBallFielder; infieldFly?: true; batterRuleOut?: BatterRuleOut }
  | { kind: 'runner'; action: RunnerAction; from: number; to: Destination; attemptedBase?: Destination; note?: string; errorOuts?: number; cleanAdvance?: boolean; errors?: DefensiveError[]; ruleOut?: RunnerRuleOut; fieldingSequence?: number[]; outAt?: number[] }
  | { kind: 'misplay'; errorOuts: number; errors?: DefensiveError[] }
  | { kind: 'rules'; rules: ScoringRules }
  | { kind: 'run-review'; review: RunReview }
  | { kind: 'courtesy'; from: number; playerId: string; sourceRule?: 'BENCH' | 'ROSTER' }
  | { kind: 'substitution'; side: Side; outId: string; inId: string; position: string; jersey: string; arrival?: true }
  | { kind: 'position'; side: Side; playerId: string; position: string; swapWith?: string }
  | { kind: 'note'; note: string }
  | { kind: 'received-lineup'; side: Side; players: PrivatePlayer[] }
  | { kind: 'finish'; review?: GameFinalReview }
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
  walkPitcherId?: string | null;
  runnerAction?: RunnerAction;
  defenders?: Record<string, string>;
  fieldingCredit?: { putouts: string[]; assists: string[] };
  leftOnBase?: string[];
  errors?: DefensiveError[];
  errorSavedRunnerId?: string;
  selectionOuts?: FieldersChoiceOut[];
  legacyError?: { playerId: string | null; position: string | null };
  thirdStrikeCause?: 'wild' | 'passed';
  strikeoutType?: StrikeoutType;
  battedBallType?: BattedBallType;
  fieldingSequence?: number[];
  caughtBy?: CaughtBallFielder;
  infieldFly?: true;
  batterRuleOut?: BatterRuleOut;
  scoringRules?: ScoringRules;
  tieBreakerRunner?: { inning: number; side: Side; runnerId: string };
  ruleOut?: RunnerRuleOut;
};
export const scorecardPracticeScenarios: Record<string, { label: string; commands: PrivateCommand[] }> = {
  finalSummary: { label: 'Resumen final · nueve entradas para revisar', commands: [
    { kind: 'rules', rules: 'baseball' },
    ...Array.from({ length: 48 }, (): PrivateCommand => ({ kind: 'play', result: 'strikeout' })),
    { kind: 'play', result: 'single' }, { kind: 'play', result: 'double' }, { kind: 'play', result: 'homeRun' },
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'sacrificeBunt', battedBallType: 'bunt', fieldingSequence: [1, 3] },
    { kind: 'play', result: 'strikeout' }, { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] },
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'homeRun' }, { kind: 'play', result: 'strikeout' },
    { kind: 'play', result: 'lineOut', battedBallType: 'line', fieldingSequence: [6] },
    { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] }
  ] },
  contextualChanges: { label: 'Cambios rápidos · tocar jugador, banca y llegadas', commands: [] },
  third: { label: 'Corredor en tercera · 0 outs · 2 strikes', commands: [
    { kind: 'play', result: 'triple' }, { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ] },
  loaded: { label: 'Bases llenas · 2 outs · 2 strikes', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' },
    { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ] },
  fresh: { label: 'Partido nuevo · elegir modalidad', commands: [] },
  fieldingSingleRunner: { label: 'Vías defensivas · doble jugada con un corredor', commands: [
    { kind: 'play', result: 'walk' }
  ] },
  selectionRoutePractice: { label: 'Jugada de selección · practicar el recorrido', commands: [
    { kind: 'play', result: 'walk' }
  ] },
  flyAdvanceOnly: { label: 'Elevado · avance sin sacrificio desde primera', commands: [
    { kind: 'play', result: 'walk' }
  ] },
  infieldFly: { label: 'Infield fly · primera y segunda · 0 outs', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }
  ] },
  batterRuleOut: { label: 'Out del bateador por regla · elegir causa', commands: [
    { kind: 'play', result: 'walk' }
  ] },
  caughtBall: { label: 'Línea y elevado · elegir quién atrapó la pelota', commands: [
    { kind: 'play', result: 'walk' }
  ] },
  batterRuleOutExamples: { label: 'Outs del bateador por regla · causas anotadas', commands: [
    { kind: 'play', result: 'ruleOut', batterRuleOut: { reason: 'batterInterference', umpireConfirmed: true } },
    { kind: 'play', result: 'ruleOut', batterRuleOut: { reason: 'outsideBox', umpireConfirmed: true } }
  ] },
  selectionRoutes: { label: 'Recorridos defensivos · selección y outs del corredor', commands: [
    { kind: 'play', result: 'walk' },
    { kind: 'play', result: 'fieldersChoice', battedBallType: 'ground', fieldingSequence: [6, 4] },
    { kind: 'runner', action: 'caught', from: 1, to: 0, fieldingSequence: [2, 6] },
    { kind: 'play', result: 'walk' },
    { kind: 'runner', action: 'pickoff', from: 1, to: 0, fieldingSequence: [1, 3] }
  ] },
  fieldingSequence: { label: 'Vías defensivas · practicar doble y triple jugada', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }
  ] },
  fieldingExamples: { label: 'Vías defensivas · ejemplos anotados', commands: [
    { kind: 'play', result: 'groundOut', battedBallType: 'ground', fieldingSequence: [6, 3] },
    { kind: 'play', result: 'lineOut', battedBallType: 'line', fieldingSequence: [6] },
    { kind: 'play', result: 'flyOut', battedBallType: 'fly', fieldingSequence: [8] },
    { kind: 'play', result: 'walk' },
    { kind: 'play', result: 'doublePlay', battedBallType: 'ground', fieldingSequence: [4, 6, 3] }
  ] },
  walkCount: { label: 'Cuenta 2 bolas y 2 strikes', commands: [
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ] },
  runnerRuleOut: { label: 'Outs por regla · corredores en base', commands: [
    { kind: 'rules', rules: 'softball-fastpitch' },
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' },
    { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ] },
  softballExtraInning: { label: 'Softbol · desempate en el 8.º inning', commands: [
    { kind: 'rules', rules: 'softball-fastpitch' },
    ...Array.from({ length: 42 }, (): PrivateCommand => ({ kind: 'play', result: 'groundOut' }))
  ] },
  fieldersChoice: { label: 'Jugada de selección · corredor en primera', commands: [
    { kind: 'play', result: 'single' }, { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }
  ] },
  fieldersChoiceSecond: { label: 'Jugada de selección · corredor en segunda', commands: [
    { kind: 'play', result: 'double' }
  ] },
  fieldersChoiceThird: { label: 'Jugada de selección · corredor en tercera', commands: [
    { kind: 'play', result: 'triple' }
  ] },
  fieldersChoiceFirstSecond: { label: 'Jugada de selección · primera y segunda', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }
  ] },
  fieldersChoiceFirstThird: { label: 'Jugada de selección · primera y tercera', commands: [
    { kind: 'play', result: 'triple' }, { kind: 'play', result: 'walk' }
  ] },
  fieldersChoiceSecondThird: { label: 'Jugada de selección · segunda y tercera', commands: [
    { kind: 'play', result: 'double' }, { kind: 'runner', action: 'advance', from: 2, to: 3 },
    { kind: 'play', result: 'walk' }, { kind: 'runner', action: 'advance', from: 1, to: 2 }
  ] },
  fieldersChoiceLoaded: { label: 'Jugada de selección · bases llenas', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }
  ] },
  selectionError: { label: 'Selección + error · corredor en primera', commands: [
    { kind: 'play', result: 'single' }, { kind: 'pitch', value: 'ball' }, { kind: 'pitch', value: 'strike' }
  ] },
  selectionErrorRecorded: { label: 'Selección + error · dos errores anotados', commands: [] },
  selectionTwoOuts: { label: 'Selección · 2 outs · bases llenas', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }
  ] },
  selectionTwoOutsThird: { label: 'Selección · 2 outs · un out previo', commands: [
    { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' }, { kind: 'play', result: 'walk' },
    { kind: 'play', result: 'battedOut' }
  ] },
  selectionTwoOutsRecorded: { label: 'Selección · 2 outs · home y tercera anotados', commands: [] },
  errors: { label: 'Errores por defensor · hit + error y varios errores', commands: [] },
  obstruction: { label: 'Obstrucción defensiva · base concedida al corredor', commands: [] },
  strikeouts: { label: 'Ponches · abanicando, cantado y tercer strike caído', commands: [
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' },
    { kind: 'pitch', value: 'strike', strikeoutType: 'swinging' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' },
    { kind: 'pitch', value: 'strike', strikeoutType: 'looking' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' },
    { kind: 'play', result: 'droppedThirdStrike', strikeoutType: 'swinging', thirdStrikeCause: 'passed' },
    { kind: 'pitch', value: 'strike' }, { kind: 'pitch', value: 'strike' }
  ] }
};

export function scorecardPracticeCommands(seed: PrivateSeed, scenario: string): PrivateCommand[] {
  if (!Object.hasOwn(scorecardPracticeScenarios, scenario)) throw new Error('El ejercicio de anotación no existe.');
  if (scenario === 'selectionRoutes') {
    const commands = structuredClone(scorecardPracticeScenarios.selectionRoutes.commands);
    const state = applyPrivateCommand(createPrivateState(seed), commands[0]);
    const runner = state.bases[0], selection = commands[1];
    if (!runner || selection.kind !== 'play' || selection.result !== 'fieldersChoice')
      throw new Error('El ejercicio requiere un corredor en primera y una jugada de selección.');
    commands[1] = { ...selection, destinations: { [runner]: 0, [currentBatter(state)]: 1 } };
    return commands;
  }
  if (!['errors', 'obstruction', 'selectionErrorRecorded', 'selectionTwoOutsRecorded'].includes(scenario)) return structuredClone(scorecardPracticeScenarios[scenario].commands);
  if (scenario === 'selectionTwoOutsRecorded') {
    const opening = structuredClone(scorecardPracticeScenarios.selectionTwoOuts.commands);
    const state = replayPrivate(seed, opening);
    const option = fieldersChoiceTwoOutOptions(state).find(entry => entry.selectionOuts?.[0].base === 4 && entry.selectionOuts[1].base === 3);
    if (!option) throw new Error('El ejercicio requiere los outs en home y tercera.');
    return [...opening, { kind: 'play', result: 'fieldersChoice', destinations: option.destinations,
      selectionOuts: option.selectionOuts, note: option.label }];
  }
  const defender = (side: Side, position: string, type: DefensiveError['type']): DefensiveError => {
    const player = seed.lineups[side].find(entry => entry.position === position);
    if (!player) throw new Error(`El ejercicio requiere un defensor en ${position}.`);
    return { playerId: player.id, position, type };
  };
  const batter = (side: Side) => {
    const player = seed.lineups[side].find(entry => entry.order === 1);
    if (!player) throw new Error('El ejercicio requiere el primer bateador de cada equipo.');
    return player.id;
  };
  if (scenario === 'selectionErrorRecorded') {
    const opening: PrivateCommand = { kind: 'play', result: 'single' };
    const state = applyPrivateCommand(createPrivateState(seed), opening);
    const runner = state.bases[0];
    if (!runner) throw new Error('El ejercicio requiere un corredor en primera.');
    return [opening, { kind: 'play', result: 'fieldersChoice', errorSavedRunnerId: runner,
      destinations: { [runner]: 3, [currentBatter(state)]: 2 }, errorOuts: 1, rbis: 0,
      errors: [defender('home', 'SS', 'throwing'), defender('home', '2B', 'fielding')],
      note: 'Error al buscar el out en segunda; otro error permite llegar a tercera y segunda.' }];
  }
  if (scenario === 'obstruction') return [
    { kind: 'play', result: 'single' }, { kind: 'pitch', value: 'ball' },
    { kind: 'runner', action: 'obstruction', from: 1, to: 2, errorOuts: 0,
      errors: [defender('home', 'SS', 'obstruction')] },
    { kind: 'pitch', value: 'strike' }
  ];
  return [
    { kind: 'play', result: 'single', destinations: { [batter('away')]: 3 }, rbis: 0, errorOuts: 0,
      errors: [defender('home', 'SS', 'fielding'), defender('home', '1B', 'throwing')] },
    { kind: 'play', result: 'error', rbis: 0, errorOuts: 0, errors: [defender('home', 'SS', 'throwing')] },
    { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' }, { kind: 'play', result: 'battedOut' },
    { kind: 'play', result: 'single', destinations: { [batter('home')]: 2 }, rbis: 0, errorOuts: 0,
      errors: [defender('away', 'CF', 'fielding')] }
  ];
}
const playAbbreviations: Record<PlayResult, string> = {
  single: '1B', double: '2B', triple: '3B', homeRun: 'HR',
  walk: 'BB', hitByPitch: 'GP', strikeout: 'K',
  intentionalWalk: 'BBI', insideParkHomeRun: 'HR·DC', groundRuleDouble: '2B·R',
  buntHit: '1B·T', buntOut: 'OUT·T', droppedThirdStrike: 'K·NC',
  sacrificeBuntError: 'SH+E', sacrificeFlyError: 'SF+E', catcherInterference: 'INT·C',
  groundOut: 'OUT', flyOut: 'OUT', lineOut: 'OUT', battedOut: 'OUT', ruleOut: 'OR',
  sacrificeFly: 'SF', sacrificeBunt: 'SH', error: 'E',
  fieldersChoice: 'FC', doublePlay: 'DP', triplePlay: 'TP'
};

export function privateInningSummary(entries: PrivateLog[], playerId: string): Array<{ code: string; label: string }> {
  return entries.flatMap((entry) => {
    const summary: Array<{ code: string; label: string }> = [];
    if (entry.tieBreakerRunner?.runnerId === playerId)
      summary.push({ code: 'TB', label: 'Desempate de softbol: colocado en segunda sin consumir turno al bate' });
    if (entry.batterId === playerId && entry.result) {
      const abbreviation = entry.infieldFly ? 'IFF' : entry.strikeoutType === 'looking' ? entry.result === 'droppedThirdStrike' ? 'ꓘ·NC' : 'ꓘ' : playAbbreviations[entry.result];
      const route = entry.fieldingSequence?.join('-');
      const code = route ? `${!entry.infieldFly && ['groundOut', 'lineOut', 'flyOut', 'buntOut'].includes(entry.result) ? '' : `${abbreviation}·`}${route}` : abbreviation;
      summary.push({ code: `${code}${entry.selectionOuts ? '·DP' : ''}${entry.errors?.length && (hitResults.includes(entry.result) || entry.result === 'fieldersChoice') ? '+E' : ''}`, label: entry.caughtBy ? entry.text : `${entry.infieldFly ? 'Infield fly declarado por el árbitro' : entry.batterRuleOut ? `${batterRuleOutLabels[entry.batterRuleOut.reason]}${entry.batterRuleOut.reason === 'other' ? ` · ${entry.text}` : ''}` : playLabels[entry.result]}${entry.battedBallType ? ` · ${battedBallLabels[entry.battedBallType]}` : ''}${route ? ` · vía ${route}` : ''}${entry.selectionOuts ? ` · 2 outs · ${entry.text}` : ''}${entry.strikeoutType ? ` · ${strikeoutLabels[entry.strikeoutType]}` : ''}${entry.thirdStrikeCause ? ` · ${runnerLabels[entry.thirdStrikeCause]}` : ''}${entry.errors?.length ? ` · ${entry.text}` : ''}` });
    } else if (entry.runnerId === playerId && entry.outs > 0 || entry.selectionOuts?.some(out => out.runnerId === playerId)) {
      summary.push({ code: `${entry.ruleOut ? 'OR' : 'OUT'}${entry.fieldingSequence ? `·${entry.fieldingSequence.join('-')}` : ''}`,
        label: entry.ruleOut ? runnerRuleOutDescription(entry.ruleOut) : `Out del corredor${entry.fieldingSequence ? ` · vía ${entry.fieldingSequence.join('-')}` : ''}` });
    }
    if (entry.stolenBy === playerId) summary.push({ code: 'BR', label: 'Base robada' });
    if (entry.errorSavedRunnerId === playerId) summary.push({ code: 'E', label: `Corredor a salvo por error · ${entry.text}` });
    if (entry.runnerId === playerId && entry.outs === 0 && (entry.errors?.length || entry.legacyError)) {
      const obstruction = entry.errors?.some(error => error.type === 'obstruction');
      summary.push({ code: obstruction ? 'AV·OBS' : 'AV·E',
        label: `${obstruction ? runnerLabels.obstruction : 'Avance por error defensivo'} · ${entry.text}` });
    }
    if (entry.runs.includes(playerId)) summary.push({ code: 'C', label: 'Carrera anotada' });
    return summary;
  });
}

export function privateInningEntries(log: PrivateLog[], side: Side, inning: number, playerId: string): PrivateLog[] {
  return log.flatMap(entry => {
    const entries = entry.side === side && entry.inning === inning &&
      (entry.batterId === playerId || entry.runnerId === playerId || entry.runs.includes(playerId) || entry.stolenBy === playerId) ? [entry] : [];
    if (entry.tieBreakerRunner?.side === side && entry.tieBreakerRunner.inning === inning && entry.tieBreakerRunner.runnerId === playerId)
      entries.push({ inning, side, batterId: null, runnerId: null, result: null, pitch: null,
        text: 'Desempate de softbol: colocado en segunda sin consumir turno al bate',
        runs: [], outs: 0, stolenBy: null, rbis: 0, pitcherId: null, tieBreakerRunner: entry.tieBreakerRunner });
    return entries;
  });
}

export type PrivateState = {
  clock?: GameClock;
  seed: PrivateSeed;
  lineups: Record<Side, PrivatePlayer[]>;
  participants?: Record<Side, PrivatePlayer[]>;
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
  finalReview?: GameFinalReview;
  runAccounting: RunAccounting;
  fieldingIncomplete?: true;
  tieBreakerRunner?: NonNullable<PrivateLog['tieBreakerRunner']>;
};
function validFieldingCredit(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.putouts) && Array.isArray(value.assists) &&
    [...value.putouts, ...value.assists].every(id => typeof id === 'string');
}
export function isScorecardState(value: unknown): value is PrivateState {
  if (!isRecord(value) || !isSeed(value.seed) || !isRecord(value.lineups) ||
      !sides.every((side) => isRecord(value.lineups) && Array.isArray(value.lineups[side]) && value.lineups[side].every(isPlayer)) ||
      value.participants !== undefined && (!isRecord(value.participants) || !sides.every(side =>
        isRecord(value.participants) && Array.isArray(value.participants[side]) && value.participants[side].every(isPlayer))) ||
      !isSide(value.side) || typeof value.finished !== 'boolean' ||
      value.finalReview !== undefined && !isGameFinalReview(value.finalReview) ||
      value.clock !== undefined && !isGameClock(value.clock) ||
      value.fieldingIncomplete !== undefined && value.fieldingIncomplete !== true ||
      value.tieBreakerRunner !== undefined && !validTieBreakerRunner(value.tieBreakerRunner) ||
      !['inning', 'balls', 'strikes', 'outs'].every((key) => typeof value[key] === 'number' && Number.isInteger(value[key]) && Number(value[key]) >= 0) ||
      !isRecord(value.scores) || !isRecord(value.indexes) ||
      !sides.every((side) => isRecord(value.scores) && typeof value.scores[side] === 'number' &&
        isRecord(value.indexes) && typeof value.indexes[side] === 'number') ||
      !Array.isArray(value.bases) || value.bases.length !== 3 || !value.bases.every((id) => id === null || typeof id === 'string') ||
      !isRecord(value.courtesyFor) || !Object.values(value.courtesyFor).every((id) => typeof id === 'string') ||
      !Array.isArray(value.log) || !value.log.every((entry) => isRecord(entry) && isSide(entry.side) &&
        validBattedOutDetails(entry) && validCaughtBallDetails(entry) &&
        (entry.runnerAction === undefined || hasKey(runnerLabels, entry.runnerAction)) &&
        (entry.walkPitcherId === undefined || entry.walkPitcherId === null || typeof entry.walkPitcherId === 'string') &&
        (entry.defenders === undefined || isRecord(entry.defenders) && Object.values(entry.defenders).every(id => typeof id === 'string')) &&
        (entry.fieldingCredit === undefined || validFieldingCredit(entry.fieldingCredit)) &&
        (entry.leftOnBase === undefined || Array.isArray(entry.leftOnBase) && entry.leftOnBase.every((id: unknown) => typeof id === 'string')) &&
        (entry.caughtBy === undefined || entry.outs === 1 && typeof entry.batterId === 'string') &&
        (entry.infieldFly === undefined || entry.infieldFly === true && entry.result === 'flyOut' && entry.outs === 1 && typeof entry.batterId === 'string') &&
        (entry.batterRuleOut === undefined || isBatterRuleOut(entry.batterRuleOut) && entry.result === 'ruleOut' &&
          entry.outs === 1 && typeof entry.batterId === 'string' && entry.runnerId === null &&
          Array.isArray(entry.runs) && entry.runs.length === 0 && entry.rbis === 0 &&
          (entry.batterRuleOut.reason === 'intentionalDrop' ? ['fly', 'line'].includes(String(entry.battedBallType)) : entry.battedBallType === undefined) &&
          entry.errors === undefined && entry.selectionOuts === undefined && entry.infieldFly === undefined) &&
        (entry.errors === undefined || validDefensiveErrors(entry.errors)) &&
        (entry.errorSavedRunnerId === undefined || typeof entry.errorSavedRunnerId === 'string') &&
        (entry.selectionOuts === undefined || validSelectionOuts(entry.selectionOuts)) &&
        (entry.legacyError === undefined || isRecord(entry.legacyError) &&
          (entry.legacyError.playerId === null || typeof entry.legacyError.playerId === 'string') &&
          (entry.legacyError.position === null || typeof entry.legacyError.position === 'string')) &&
        (entry.scoringRules === undefined || hasKey(scoringRuleLabels, entry.scoringRules)) &&
        (entry.tieBreakerRunner === undefined || validTieBreakerRunner(entry.tieBreakerRunner)) &&
        (entry.ruleOut === undefined || isRunnerRuleOut(entry.ruleOut) && entry.outs === 1 && typeof entry.runnerId === 'string' && entry.result === null) &&
        (entry.thirdStrikeCause === undefined || ['wild', 'passed'].includes(String(entry.thirdStrikeCause))) &&
        (entry.strikeoutType === undefined || ['strikeout', 'droppedThirdStrike'].includes(String(entry.result)) && hasKey(strikeoutLabels, entry.strikeoutType)) &&
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
const validTieBreakerRunner = (value: unknown): value is NonNullable<PrivateLog['tieBreakerRunner']> =>
  isRecord(value) && Number.isSafeInteger(value.inning) && Number(value.inning) >= 8 &&
  isSide(value.side) && typeof value.runnerId === 'string' && value.runnerId.length > 0;
const hasKey = <T extends object>(object: T, key: unknown): key is keyof T =>
  typeof key === 'string' && Object.hasOwn(object, key);
const validPosition = (value: unknown): value is string =>
  typeof value === 'string' && privatePositions.includes(value);
const validJersey = (value: unknown): value is string => typeof value === 'string' && /^\d{1,2}$/.test(value);
const optionalNote = (value: unknown) => value === undefined || typeof value === 'string';

function isPlayer(value: unknown): value is PrivatePlayer {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.name === 'string' && typeof value.jersey === 'string' &&
    (value.identification === undefined || value.identification === '' ||
      typeof value.identification === 'string' && /^[VE]-[1-9]\d{0,9}$/.test(value.identification)) &&
    validPosition(value.position) && (value.order === null ||
      typeof value.order === 'number' && Number.isInteger(value.order) && value.order >= 1 && value.order <= 13);
}

function isSeed(value: unknown): value is PrivateSeed {
  if (!isRecord(value) || !isRecord(value.names) || !isRecord(value.lineups) || !isRecord(value.rosters) ||
      !(value.courtesyRunnerSource === 'BENCH' || value.courtesyRunnerSource === 'ROSTER')) return false;
  if (value.friendly !== undefined && value.friendly !== true) return false;
  if (value.scoringRules !== undefined && !hasKey(scoringRuleLabels, value.scoringRules)) return false;
  if (value.sport !== undefined && value.sport !== 'baseball' && value.sport !== 'softball') return false;
  if (value.sport && value.scoringRules && (value.sport === 'baseball') !== (value.scoringRules === 'baseball')) return false;
  if (value.regulationInnings !== undefined && value.regulationInnings !== 7 && value.regulationInnings !== 9) return false;
  if (value.softballTieBreakerFromInning !== undefined &&
      (!Number.isSafeInteger(value.softballTieBreakerFromInning) || Number(value.softballTieBreakerFromInning) < 8)) return false;
  if (value.teamSheetRevisions !== undefined && (!isRecord(value.teamSheetRevisions) ||
      !sides.every((side) => isRecord(value.teamSheetRevisions) && typeof value.teamSheetRevisions[side] === 'number' &&
        Number.isInteger(value.teamSheetRevisions[side]) && Number(value.teamSheetRevisions[side]) >= 0))) return false;
  const valid = sides.every((side) => {
    const names = value.names;
    const lineups = value.lineups;
    const rosters = value.rosters;
    return isRecord(names) && typeof names[side] === 'string' &&
      isRecord(lineups) && Array.isArray(lineups[side]) && lineups[side].every(isPlayer) &&
      isRecord(rosters) && Array.isArray(rosters[side]) && rosters[side].every(isPlayer);
  });
  if (!valid) return false;
  const seed = value as PrivateSeed;
  const identities = new Map<string, string>();
  const bindings = new Map<string, string>();
  const hasBindings = sides.some(side => [...seed.rosters[side], ...seed.lineups[side]]
    .some(player => player.identification !== undefined));
  if (!hasBindings) return true;
  for (const side of sides) for (const player of [...seed.rosters[side], ...seed.lineups[side]]) {
    const key = JSON.stringify([side, player.id]);
    const identification = normalizeProfileIdentification(player.identification ?? player.id);
    if (bindings.has(key) && bindings.get(key) !== identification) return false;
    bindings.set(key, identification);
    if (!/^[VE]-[1-9]\d{0,9}$/.test(identification)) continue;
    if (identities.has(identification) && identities.get(identification) !== key) return false;
    identities.set(identification, key);
  }
  return true;
}

export function isScorecardCommand(value: unknown): value is PrivateCommand {
  if (!isRecord(value)) return false;
  if (!validBattedOutDetails(value) || !validCaughtBallDetails(value) ||
      value.caughtBy !== undefined && value.kind !== 'play' ||
      value.battedBallType !== undefined && value.kind !== 'play' ||
      value.fieldingSequence !== undefined && value.kind !== 'play' && value.kind !== 'runner') return false;
  if (value.strikeoutType !== undefined && (!hasKey(strikeoutLabels, value.strikeoutType) ||
      !(value.kind === 'pitch' && value.value === 'strike' ||
        value.kind === 'play' && ['strikeout', 'droppedThirdStrike'].includes(String(value.result))))) return false;
  if (value.errors !== undefined && (!['play', 'runner', 'misplay'].includes(String(value.kind)) || !validDefensiveErrors(value.errors))) return false;
  if (value.errorSavedRunnerId !== undefined && !(value.kind === 'play' && value.result === 'fieldersChoice' &&
      typeof value.errorSavedRunnerId === 'string' && value.errorSavedRunnerId.length > 0 &&
      Array.isArray(value.errors) && value.errors.length > 0)) return false;
  if (value.selectionOuts !== undefined && !(value.kind === 'play' && value.result === 'fieldersChoice' && validSelectionOuts(value.selectionOuts))) return false;
  if (value.ruleOut !== undefined && !(value.kind === 'runner' && value.action === 'ruleOut' && value.to === 0 && isRunnerRuleOut(value.ruleOut))) return false;
  if (value.infieldFly !== undefined && !(value.infieldFly === true && value.kind === 'play' && value.result === 'flyOut' &&
      value.errors === undefined && value.selectionOuts === undefined)) return false;
  if (value.batterRuleOut !== undefined && !(value.kind === 'play' && value.result === 'ruleOut' && isBatterRuleOut(value.batterRuleOut) &&
      value.errors === undefined && value.errorOuts === undefined && value.selectionOuts === undefined &&
      value.infieldFly === undefined && value.strikeoutType === undefined && value.validThirdOutRuns === undefined &&
      (value.batterRuleOut.reason === 'intentionalDrop' ? ['fly', 'line'].includes(String(value.battedBallType)) :
        value.battedBallType === undefined && value.fieldingSequence === undefined))) return false;
  if ((value.kind === 'substitution' || value.kind === 'position') && ('order' in value || 'battingOrder' in value)) return false;
  if (value.arrival !== undefined && (value.kind !== 'substitution' || value.arrival !== true)) return false;
  if (value.swapWith !== undefined && value.kind !== 'position') return false;
  if (value.review !== undefined && (!['finish', 'run-review'].includes(String(value.kind)) ||
      value.kind === 'finish' && !isGameFinalReview(value.review))) return false;
  if (value.outAt !== undefined && (!['play', 'runner'].includes(String(value.kind)) ||
      !Array.isArray(value.outAt) || !Array.isArray(value.fieldingSequence) ||
      !value.outAt.length || value.outAt.length > 3 ||
      !value.outAt.every((index: unknown) => typeof index === 'number' && Number.isInteger(index) &&
        index >= 0 && Array.isArray(value.fieldingSequence) && index < value.fieldingSequence.length) ||
      !value.outAt.every((index: number, position: number, indices: number[]) => position === 0 || index >= indices[position - 1]))) return false;
  if (value.sharedRequestId !== undefined && (typeof value.sharedRequestId !== 'string' || !value.sharedRequestId ||
      !isSide(value.teamSheetSide) || typeof value.teamSheetRevision !== 'number' ||
      !Number.isInteger(value.teamSheetRevision) || value.teamSheetRevision < 1)) return false;
  switch (value.kind) {
    case 'pitch': return value.value === 'ball' || value.value === 'strike' || value.value === 'foul';
    case 'play': return hasKey(playLabels, value.result) && optionalNote(value.note) && validRunEvidence(value) &&
      (value.errorOuts === undefined || ['error', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference'].includes(String(value.result)) ||
        Array.isArray(value.errors) && value.errors.length > 0) &&
      (value.thirdStrikeCause === undefined || value.result === 'droppedThirdStrike' && ['wild', 'passed'].includes(String(value.thirdStrikeCause))) &&
      (value.rbis === undefined || typeof value.rbis === 'number' && Number.isInteger(value.rbis) && value.rbis >= 0 && value.rbis <= 4) &&
      (value.validThirdOutRuns === undefined || typeof value.validThirdOutRuns === 'boolean') &&
      (value.destinations === undefined || isRecord(value.destinations) && Object.values(value.destinations).every(isDestination));
    case 'runner': return hasKey(runnerLabels, value.action) && isBase(value.from) && isDestination(value.to) && optionalNote(value.note) &&
      validRunEvidence(value) && (value.errorOuts === undefined || ['error', 'obstruction'].includes(String(value.action)) && Number(value.errorOuts) <= 1) &&
      (value.cleanAdvance === undefined || typeof value.cleanAdvance === 'boolean' && ['advance', 'run'].includes(String(value.action))) &&
      (value.action !== 'advanceOut' || isDestination(value.attemptedBase) && value.attemptedBase > value.from);
    case 'misplay': return value.errorOuts === 1;
    case 'rules': return hasKey(scoringRuleLabels, value.rules);
    case 'run-review': return validRunReview(value.review);
    case 'courtesy': return isBase(value.from) && typeof value.playerId === 'string' &&
      (value.sourceRule === undefined || value.sourceRule === 'BENCH' || value.sourceRule === 'ROSTER');
    case 'substitution': return isSide(value.side) && typeof value.outId === 'string' && typeof value.inId === 'string' &&
      validPosition(value.position) && (validJersey(value.jersey) || value.jersey === '') && (value.arrival === undefined || value.arrival === true);
    case 'position': return isSide(value.side) && typeof value.playerId === 'string' && validPosition(value.position) &&
      (value.swapWith === undefined || typeof value.swapWith === 'string' && value.swapWith.length > 0 && value.swapWith !== value.playerId);
    case 'note': return typeof value.note === 'string' && value.note.trim().length > 0;
    case 'received-lineup': return isSide(value.side) && Array.isArray(value.players) && value.players.every(isPlayer);
    case 'finish': return value.review === undefined || isGameFinalReview(value.review);
    default: return false;
  }
}

function validDefensiveErrors(value: unknown): value is DefensiveError[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 9 && value.every(error =>
    isRecord(error) && typeof error.playerId === 'string' && error.playerId.length > 0 &&
    validPosition(error.position) && !['DH', 'NA'].includes(error.position) &&
    (error.type === 'fielding' || error.type === 'throwing' || error.type === 'obstruction'));
}
function validSelectionOuts(value: unknown): value is FieldersChoiceOut[] {
  return Array.isArray(value) && value.length === 2 && value.every(out => isRecord(out) &&
    typeof out.runnerId === 'string' && out.runnerId.length > 0 && isDestination(out.base) && out.base > 0) &&
    value[0].runnerId !== value[1].runnerId;
}
export const hitResults: readonly PlayResult[] = ['single', 'double', 'triple', 'homeRun', 'insideParkHomeRun', 'groundRuleDouble', 'buntHit'];
export const walkResults: readonly PlayResult[] = ['walk', 'intentionalWalk'];
export const noAtBatResults: readonly PlayResult[] = ['walk', 'intentionalWalk', 'hitByPitch', 'sacrificeFly', 'sacrificeBunt', 'sacrificeFlyError', 'sacrificeBuntError', 'catcherInterference'];
export const reachedOnErrorResults: readonly PlayResult[] = ['error', 'sacrificeBuntError', 'sacrificeFlyError', 'catcherInterference'];
export function scoringPlayRestriction(state: PrivateState, result: PlayResult): string | null {
  const slow = state.seed.scoringRules === 'softball-slowpitch';
  if (slow && ['buntHit', 'buntOut', 'sacrificeBunt', 'sacrificeBuntError', 'hitByPitch', 'droppedThirdStrike'].includes(result))
    return 'Esta concesión o toque no corresponde al reglamento de sóftbol lento.';
  if (result === 'droppedThirdStrike' && (state.strikes !== 2 || state.outs < 2 && state.bases[0] !== null))
    return 'Requiere dos strikes y primera libre, o dos outs aunque primera esté ocupada.';
  return null;
}
export function scoringSacrificeRestriction(state: PrivateState, result: PlayResult, destinations: Record<string, Destination>): string | null {
  if (result === 'sacrificeFly' || result === 'sacrificeFlyError') {
    if (state.outs >= 2) return 'El elevado de sacrificio requiere menos de dos outs.';
    if (!Object.values(destinations).includes(4))
      return 'El elevado de sacrificio requiere una carrera anotada. Avanzar de base no basta.';
  }
  if (result === 'sacrificeBunt' || result === 'sacrificeBuntError') {
    if (state.outs >= 2) return 'El toque de sacrificio requiere menos de dos outs.';
    if (!state.bases.some((runner, index) => runner && destinations[runner] > index + 1))
      return 'El toque de sacrificio requiere que un corredor avance.';
  }
  return null;
}
export function scoringInfieldFlyRestriction(state: PrivateState): string | null {
  if (state.outs >= 2) return 'Infield fly requiere menos de dos outs.';
  if (!state.bases[0] || !state.bases[1]) return 'Infield fly requiere primera y segunda ocupadas, o bases llenas.';
  return null;
}
export function assertScoringSubmission(state: PrivateState, command: PrivateCommand): void {
  if (command.kind === 'play' && command.batterRuleOut) {
    const issue = batterRuleOutIssue(state, command.batterRuleOut, command.battedBallType, command.note);
    if (issue) throw new Error(issue);
  }
  if (command.kind === 'runner' && command.ruleOut) {
    const issue = runnerRuleOutIssue(state, command.ruleOut, command.note);
    if (issue) throw new Error(issue);
  }
  const needsError = command.kind === 'misplay' || command.kind === 'runner' && ['error', 'obstruction'].includes(command.action) ||
    command.kind === 'play' && reachedOnErrorResults.includes(command.result);
  if (needsError && !('errors' in command && command.errors?.length))
    throw new Error('Identifica la posición y el defensor responsable del error.');
  if (command.kind === 'play' && command.result === 'fieldersChoice' &&
      (!state.bases.some(Boolean) || !command.destinations ||
        [currentBatter(state), ...state.bases.filter((id): id is string => id !== null)]
          .some(id => command.destinations?.[id] === undefined)))
    throw new Error('La jugada de selección requiere corredores en base y el resultado de cada participante.');
  if (command.kind === 'play' && command.selectionOuts) {
    const option = fieldersChoiceTwoOutOptions(state).find(entry => entry.selectionOuts?.every((out, index) =>
      out.runnerId === command.selectionOuts?.[index]?.runnerId && out.base === command.selectionOuts[index].base));
    const moves = command.destinations;
    if (!option || !moves || [currentBatter(state), ...state.bases.filter((id): id is string => id !== null)].some(id =>
      !fieldersChoiceDestinationOptions(state, option, moves, id).includes(moves[id])))
      throw new Error('La selección de dos outs requiere dos corredores presentes, cero o un out previo y destinos compatibles con la secuencia elegida.');
  }
  if (command.kind === 'play' && command.result === 'fieldersChoice' && command.validThirdOutRuns) {
    const moves = command.destinations ?? {};
    if (fieldersChoiceThirdOut(state, moves, command.selectionOuts) !== 'timing' ||
        !Object.values(moves).includes(4))
      throw new Error('Las carreras antes del tercer out requieren un out no forzado y corredores que anotaron.');
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
        lineup.length > 14 || (lineup.length > 0 && (batters.length < (seed.friendly ? 1 : 9) || batters.length > 13)) ||
        batters.some((p, index) => p.order !== index + 1)) {
      throw new Error('La alineación privada debe conservar los jugadores inscritos y el orden de bateo válido.');
    }
  }
  return {
    seed: structuredClone({ ...seed, ...(isSoftballScorecard(seed) && seed.softballTieBreakerFromInning === undefined ?
      { softballTieBreakerFromInning: (seed.regulationInnings ?? 7) + 1 } : {}) }), lineups: structuredClone(seed.lineups),
    participants: structuredClone(seed.lineups),
    inning: 1, side: 'away', balls: 0, strikes: 0, outs: 0,
    scores: { home: 0, away: 0 }, indexes: { home: 0, away: 0 },
    bases: [null, null, null], courtesyFor: {}, log: [], finished: false, runAccounting: createRunAccounting()
  };
}

export function currentBatter(state: PrivateState): string {
  const batters = state.lineups[state.side].filter((p) => p.order !== null).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return batters[state.indexes[state.side] % batters.length]?.id ?? `unknown:${state.side}:${state.indexes[state.side] + 1}`;
}

export function isSoftballScorecard(seed: PrivateSeed): boolean {
  return seed.scoringRules ? seed.scoringRules !== 'baseball' : seed.sport === 'softball';
}

export function scorecardRegulationInnings(seed: PrivateSeed): 7 | 9 | undefined {
  return seed.regulationInnings ?? (isSoftballScorecard(seed) ? 7 : undefined);
}

export function placeSoftballTieBreakerRunner(state: PrivateState, offenseId: string = state.side): void {
  delete state.tieBreakerRunner;
  const limit = scorecardRegulationInnings(state.seed);
  if (!isSoftballScorecard(state.seed) || !limit || state.finished || state.outs !== 0 ||
      state.inning <= limit || state.inning < (state.seed.softballTieBreakerFromInning ?? limit + 1) ||
      state.side === 'away' && state.scores.home !== state.scores.away ||
      state.side === 'home' && state.scores.home > state.scores.away) return;
  const batters = state.lineups[state.side].filter(player => player.order !== null).sort((a, b) => a.order! - b.order!);
  if (batters.length < 2) throw new Error('El desempate de softbol requiere al menos dos bateadores distintos por equipo.');
  if (state.bases.some(Boolean)) throw new Error('El corredor de desempate solo se coloca al comenzar la media entrada con las bases vacías.');
  const runner = batters[(state.indexes[state.side] - 1 + batters.length) % batters.length];
  state.bases[1] = runner.id;
  state.tieBreakerRunner = { inning: state.inning, side: state.side, runnerId: runner.id };
  state.runAccounting = accountRuns(state.runAccounting, {
    eventId: state.log.length, half: `${state.inning}:${offenseId}`, offenseId,
    pitcherId: state.lineups[state.side === 'away' ? 'home' : 'away'].find(player => player.position === 'P')?.id ?? null,
    outsBefore: 0, batterId: null, plateCompleted: false, reachedOnError: false, basesBefore: state.bases,
    basesAfter: state.bases, scored: [], totalRuns: 0, tieBreakerRunnerId: runner.id
  });
}

export function softballTieBreakerNotice(state: PrivateState): string | null {
  const placed = state.tieBreakerRunner;
  return placed ? `Desempate de softbol · ${placed.inning}.ª ${placed.side === 'away' ? 'alta' : 'baja'}: ${playerName(state, placed.runnerId)} comenzó en segunda, sin consumir turno al bate.` : null;
}

export function playerName(state: PrivateState, id: string): string {
  const player = [...state.seed.rosters.home, ...state.seed.rosters.away].find((p) => p.id === id);
  if (player) return player.name;
  if (id.startsWith('unknown:')) return `Bateador sin identificar · turno ${id.split(':')[2]}`;
  return id;
}

export function suggestedDestinations(state: PrivateState, result: PlayResult): Record<string, Destination> {
  const moves: Record<string, Destination> = {};
  const distance = ['double', 'groundRuleDouble'].includes(result) ? 2 : result === 'triple' ? 3 :
    ['homeRun', 'insideParkHomeRun'].includes(result) ? 4 : 1;
  const isHit = hitResults.includes(result) || ['error', 'sacrificeBuntError', 'fieldersChoice'].includes(result);
  const isWalk = walkResults.includes(result) || ['hitByPitch', 'catcherInterference', 'sacrificeFlyError', 'droppedThirdStrike'].includes(result);
  state.bases.forEach((runner, index) => {
    if (!runner) return;
    let target = index + 1;
    if (isHit) target = Math.min(4, target + distance);
    if (isWalk && state.bases.slice(0, index).every(Boolean)) target += 1;
    if (['sacrificeFly', 'sacrificeFlyError'].includes(result) && index === 2) target = 4;
    if (['sacrificeBunt', 'sacrificeBuntError'].includes(result)) target = Math.min(4, index + 2);
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
  if ((!hitResults.includes(result) && result !== 'error' && result !== 'fieldersChoice') ||
      ['groundRuleDouble', 'homeRun', 'insideParkHomeRun'].includes(result)) return moves;
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

export type FieldersChoiceOption = {
  id: string;
  label: string;
  outRunnerId: string | null;
  forced: boolean;
  destinations: Record<string, Destination>;
  errorSavedRunnerId?: string;
  outBase?: Exclude<Destination, 0>;
  selectionOuts?: FieldersChoiceOut[];
};

export function fieldersChoiceOptions(state: PrivateState, withError = false): FieldersChoiceOption[] {
  if (state.finished || state.outs >= 3 || !state.bases.some(Boolean)) return [];
  if (withError) return fieldersChoiceOptions(state).filter(option => option.outRunnerId !== null).map(option => ({
    ...option, id: `error-${option.id}`, label: `Error: ${option.label.replace(/^Out /, 'se evita el out ')}`,
    errorSavedRunnerId: option.outRunnerId ?? undefined, outRunnerId: null,
    destinations: minimumDestinations(state, 'fieldersChoice')
  }));
  const bases = ['primera', 'segunda', 'tercera', 'home'];
  const options: FieldersChoiceOption[] = [];
  state.bases.forEach((runner, index) => {
    if (!runner) return;
    const forced = state.bases.slice(0, index + 1).every(Boolean);
    const destinations = minimumDestinations({
      ...state, bases: state.bases.map(id => id === runner ? null : id)
    }, 'fieldersChoice');
    destinations[runner] = 0;
    options.push({
      id: `out-${index + 1}-${index + 2}`,
      label: `Out ${forced ? 'forzado ' : 'por toque '}en ${bases[index + 1]} · corredor de ${bases[index]}`,
      outRunnerId: runner, outBase: ([2, 3, 4] as const)[index], forced, destinations
    });
    if (!forced) options.push({
      id: `return-${index + 1}`,
      label: `Out por toque al regresar a ${bases[index]} · corredor de ${bases[index]}`,
      outRunnerId: runner, outBase: ([1, 2, 3] as const)[index], forced: false, destinations: { ...destinations }
    });
  });
  options.push({
    id: 'safe', label: 'Intento de out a otro corredor: todos quietos',
    outRunnerId: null, forced: false, destinations: minimumDestinations(state, 'fieldersChoice')
  });
  return options;
}

export function fieldersChoiceTwoOutOptions(state: PrivateState): FieldersChoiceOption[] {
  if (state.finished || state.outs > 1 || state.bases.filter(Boolean).length < 2) return [];
  const options: FieldersChoiceOption[] = [];
  for (const first of fieldersChoiceOptions(state)) {
    if (!first.outRunnerId || !first.outBase) continue;
    const afterFirst = { ...state, bases: state.bases.map(id => id === first.outRunnerId ? null : id) };
    for (const second of fieldersChoiceOptions(afterFirst)) {
      if (!second.outRunnerId || !second.outBase) continue;
      const afterBoth = { ...afterFirst, bases: afterFirst.bases.map(id => id === second.outRunnerId ? null : id) };
      options.push({
        id: `two-${first.id}-${second.id}`,
        label: `1.º ${first.label} → 2.º ${second.label}`,
        outRunnerId: null, forced: second.forced,
        selectionOuts: [{ runnerId: first.outRunnerId, base: first.outBase }, { runnerId: second.outRunnerId, base: second.outBase }],
        destinations: { ...minimumDestinations(afterBoth, 'fieldersChoice'), [first.outRunnerId]: 0, [second.outRunnerId]: 0 }
      });
    }
  }
  return options;
}

export const fieldersChoiceBaseLabels = { 1: '1.ª base', 2: '2.ª base', 3: '3.ª base', 4: 'Home' } as const;

export type FieldersChoiceOutStepOption = FieldersChoiceOut & { label: string };

export function fieldersChoiceTwoOutStepOptions(state: PrivateState, first?: FieldersChoiceOut): FieldersChoiceOutStepOption[] {
  const pairs = fieldersChoiceTwoOutOptions(state);
  const remaining = first ? { ...state, bases: state.bases.map(id => id === first.runnerId ? null : id) } : state;
  return fieldersChoiceOptions(remaining).flatMap(option => {
    const runnerId = option.outRunnerId, base = option.outBase;
    if (!runnerId || !base || !pairs.some(pair => {
      const outs = pair.selectionOuts;
      return outs && (!first || outs[0].runnerId === first.runnerId && outs[0].base === first.base) &&
        outs[first ? 1 : 0].runnerId === runnerId && outs[first ? 1 : 0].base === base;
    })) return [];
    const origin = state.bases.indexOf(runnerId) + 1;
    const kind = option.forced ? 'Forzado' : base === origin ? 'Toque al regresar' : 'Toque al avanzar';
    return [{ runnerId, base, label: `${kind} · corredor de ${origin}.ª` }];
  });
}

export function fieldersChoiceDestinationOptions(
  state: PrivateState, option: FieldersChoiceOption, moves: Record<string, Destination>, playerId: string
): Destination[] {
  const batter = currentBatter(state);
  const origin = playerId === batter ? 0 : state.bases.indexOf(playerId) + 1;
  if (playerId !== batter && origin === 0) throw new Error('El corredor no pertenece a esta jugada.');
  if (playerId === option.outRunnerId || option.selectionOuts?.some(out => out.runnerId === playerId)) return [0];
  return ([0, 1, 2, 3, 4] as const).filter(destination => {
    if (destination === 0) return Boolean(option.errorSavedRunnerId && playerId !== option.errorSavedRunnerId &&
      state.outs + Object.entries(moves).filter(([id, target]) => id !== playerId && target === 0).length < 3);
    if (destination < Math.max(1, origin)) return false;
    if (destination === 4 && state.outs === 2 && option.outRunnerId &&
        (option.forced || origin < state.bases.indexOf(option.outRunnerId) + 1)) return false;
    const lastOut = option.selectionOuts?.[1];
    if (destination === 4 && lastOut && fieldersChoiceThirdOut(state, moves, option.selectionOuts) === 'timing' &&
        origin < state.bases.indexOf(lastOut.runnerId) + 1) return false;
    return Object.entries(moves).every(([otherId, otherDestination]) => {
      if (otherId === playerId || otherDestination === 0) return true;
      if (destination < 4 && destination === otherDestination) return false;
      const otherOrigin = otherId === batter ? 0 : state.bases.indexOf(otherId) + 1;
      return otherOrigin > origin ? destination <= otherDestination : destination >= otherDestination;
    });
  });
}

export function fieldersChoiceThirdOut(state: PrivateState, moves: Record<string, Destination>, selectionOuts?: FieldersChoiceOut[]): 'noRuns' | 'timing' | null {
  if (state.outs + Object.values(moves).filter(destination => destination === 0).length !== 3) return null;
  const last = selectionOuts?.[1];
  if (last) {
    const origin = state.bases.indexOf(last.runnerId);
    const beforeLast = state.bases.map(id => id === selectionOuts[0].runnerId ? null : id);
    return last.base === origin + 2 && beforeLast.slice(0, origin + 1).every(Boolean) ? 'noRuns' : 'timing';
  }
  return moves[currentBatter(state)] === 0 || state.bases.some((id, index) => id !== null && moves[id] === 0 &&
    state.bases.slice(0, index + 1).every(Boolean)) ? 'noRuns' : 'timing';
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
  placeSoftballTieBreakerRunner(state);
}

export function applyPrivateCommand(current: PrivateState, command: PrivateCommand): PrivateState {
  if (!isScorecardCommand(command)) throw new Error('La anotación contiene datos inválidos.');
  if (command.kind === 'play' && command.caughtBy &&
      defensivePlayerAt(current, command.caughtBy.position)?.id !== command.caughtBy.playerId)
    throw new Error('Quien atrapó la pelota debe ocupar esa posición en la defensa activa. Revisa la alineación.');
  if (command.kind === 'play' && command.batterRuleOut) {
    const issue = batterRuleOutIssue(current, command.batterRuleOut, command.battedBallType, command.note);
    if (issue) throw new Error(issue);
  }
  if (command.kind === 'play' && command.infieldFly) {
    const issue = scoringInfieldFlyRestriction(current);
    if (issue) throw new Error(issue);
  }
  if (command.kind === 'play' || command.kind === 'runner') {
    if (command.fieldingSequence?.includes(10) && !defensivePositions(current).some(position => position.number === 10))
      throw new Error('La posición 10 requiere un jardinero adicional en la defensa activa de softbol.');
    const restriction = command.kind === 'play' && command.battedBallType ? scoringPlayRestriction(current, battedOutResults[command.battedBallType]) : null;
    if (restriction) throw new Error(restriction);
  }
  if (command.kind === 'play' && command.selectionOuts) assertScoringSubmission(current, command);
  if (command.kind === 'finish' && command.review) {
    const issue = finalReviewIssue(current, command.review);
    if (issue) throw new Error(issue);
  }
  if (command.kind === 'play' && command.errorSavedRunnerId &&
      (!current.bases.includes(command.errorSavedRunnerId) || !command.destinations?.[command.errorSavedRunnerId] || command.errorOuts === 0))
    throw new Error('Identifica al corredor que se salvó por el error y conserva su destino a salvo; el error evitó al menos un out.');
  if (command.kind === 'runner' && command.action === 'obstruction' &&
      (command.errors?.length !== 1 || command.errors[0].type !== 'obstruction'))
    throw new Error('Identifica un único defensor responsable de la obstrucción.');
  if ('errors' in command && command.errors?.some(error => error.type === 'obstruction') &&
      !(command.kind === 'runner' && command.action === 'obstruction'))
    throw new Error('La obstrucción corresponde al avance concedido a un corredor.');
  if (current.finished && !command.sharedRequestId) throw new Error('El seguimiento privado está cerrado. Deshaz el cierre para continuar.');
  const state = structuredClone(current);
  const batter = currentBatter(state);
  const log: PrivateLog = {
    inning: state.inning, side: state.side, batterId: null, runnerId: null, result: null, pitch: null, text: '',
    runs: [], outs: 0, stolenBy: null, rbis: 0,
    pitcherId: state.lineups[state.side === 'away' ? 'home' : 'away'].find((p) => p.position === 'P')?.id ?? null
  };
  if (command.kind === 'play' && command.errorSavedRunnerId) log.errorSavedRunnerId = command.errorSavedRunnerId;
  if (command.kind === 'play' && command.selectionOuts) log.selectionOuts = structuredClone(command.selectionOuts);
  if (command.kind === 'play' && command.infieldFly) log.infieldFly = true;
  if (command.kind === 'play' && command.caughtBy) log.caughtBy = { ...command.caughtBy };
  if (command.kind === 'play' && command.batterRuleOut) log.batterRuleOut = structuredClone(command.batterRuleOut);
  if ('errors' in command && command.errors) {
    const defense = state.lineups[state.side === 'away' ? 'home' : 'away'];
    for (const error of command.errors) {
      if (!defense.some(player => player.id === error.playerId && player.position === error.position))
        throw new Error('El responsable debe ocupar esa posición en la defensa activa.');
    }
    if (command.kind === 'play' && ['homeRun', 'insideParkHomeRun', 'intentionalWalk', 'walk', 'hitByPitch', 'droppedThirdStrike'].includes(command.result))
      throw new Error('Registra los errores de avance por separado; esta concesión no admite un error añadido.');
    if (command.kind === 'runner' && !['error', 'obstruction'].includes(command.action))
      throw new Error('La atribución defensiva corresponde a un avance por error.');
    if (command.kind === 'play' && command.result === 'catcherInterference' &&
        (command.errors.length !== 1 || command.errors[0].position !== 'C'))
      throw new Error('La interferencia corresponde al receptor activo.');
    log.errors = structuredClone(command.errors);
  }
  const describeErrors = () => log.errors?.map(error =>
    `E·${error.position} ${playerName(state, error.playerId)} (${error.type === 'obstruction' ? 'obstrucción' : error.type === 'throwing' ? 'tiro' : 'fildeo'})`).join('; ');
  const finishTurn = (result: PlayResult, destinations?: Record<string, Destination>, validThirdOutRuns = false) => {
    const restriction = scoringPlayRestriction(state, result);
    if (restriction) throw new Error(restriction);
    if (result === 'droppedThirdStrike' && (command.kind !== 'play' || !command.thirdStrikeCause))
      throw new Error('Indica si el tercer strike fue lanzamiento descontrolado o bola pasada.');
    if (state.bases.includes(batter)) throw new Error('El bateador actual ya está en base. Revisa los corredores o registra un corredor temporal válido.');
    const suggested = suggestedDestinations(state, result);
    const moves = destinations ?? suggested;
    const ids = [...state.bases.filter((id): id is string => id !== null), batter];
    if (Object.keys(moves).length !== ids.length || ids.some((id) => !Object.hasOwn(moves, id))) {
      throw new Error('Indica el destino del bateador y de todos los corredores de esta jugada.');
    }
    if ((walkResults.includes(result) || ['hitByPitch', 'homeRun', 'insideParkHomeRun', 'groundRuleDouble', 'catcherInterference'].includes(result)) &&
        ids.some((id) => moves[id] !== suggested[id])) throw new Error('Esta jugada exige los avances reglamentarios indicados.');
    const outResult = ['strikeout', 'buntOut', 'groundOut', 'flyOut', 'lineOut', 'battedOut', 'ruleOut', 'sacrificeFly', 'sacrificeBunt', 'doublePlay', 'triplePlay'].includes(result);
    if (outResult && moves[batter] !== 0) throw new Error('En este resultado el bateador debe quedar eliminado.');
    if (log.batterRuleOut && state.bases.some((id, index) => id !== null && moves[id] !== index + 1))
      throw new Error('Este out por regla conserva los corredores en sus bases. Anula el turno indebido antes de registrar una apelación y registra aparte otras decisiones arbitrales.');
    log.outs = ids.filter((id) => moves[id] === 0).length;
    if (log.caughtBy && log.outs !== 1)
      throw new Error('La atrapada sencilla elimina solo al bateador. Para varios outs registra la doble o triple jugada.');
    if (log.infieldFly && log.outs !== 1)
      throw new Error('Infield fly solo elimina al bateador. Registra aparte los outs reales de los corredores.');
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
    const sacrificeIssue = scoringSacrificeRestriction(state, result, moves);
    if (sacrificeIssue) throw new Error(sacrificeIssue);
    if (state.outs + log.outs === 3) {
      const batterIsThirdOutBeforeFirst = log.outs === 1 && moves[batter] === 0 && (outResult || result === 'droppedThirdStrike');
      if (batterIsThirdOutBeforeFirst || !validThirdOutRuns) log.runs = [];
    }
    state.bases = nextBases;
    delete state.courtesyFor[batter];
    log.batterId = batter;
    log.result = result;
    log.text = `${playerName(state, batter)}: ${playLabels[result]}`;
    if (log.infieldFly) log.text += ' · Infield fly declarado por el árbitro';
    if (log.caughtBy) log.text += ` · Atrapada: ${playerName(state, log.caughtBy.playerId)} (posición ${log.caughtBy.position})`;
    if (log.batterRuleOut) log.text += ` · ${batterRuleOutLabels[log.batterRuleOut.reason]}`;
    if (command.kind === 'play' && command.battedBallType) {
      log.battedBallType = command.battedBallType;
      if (command.fieldingSequence) log.fieldingSequence = [...command.fieldingSequence];
      log.text += ` · ${battedBallLabels[command.battedBallType]}${command.fieldingSequence ? ` · vía ${command.fieldingSequence.join('-')}` : ''}`;
    }
    if ((command.kind === 'pitch' || command.kind === 'play') && command.strikeoutType) {
      log.strikeoutType = command.strikeoutType;
      log.text += ` · ${strikeoutLabels[command.strikeoutType]}`;
    }
    // Includes reverse-force double plays after the first out removes the force.
    const forceSelection = command.kind === 'play' && command.selectionOuts?.every(out =>
      current.bases.slice(0, current.bases.indexOf(out.runnerId) + 1).every(Boolean));
    if (!forceSelection && !['error', 'doublePlay', 'triplePlay', 'droppedThirdStrike', 'sacrificeBuntError'].includes(result)) log.rbis = log.runs.length;
    if (command.kind === 'play' && command.rbis !== undefined) {
      if (command.rbis > log.runs.length || (forceSelection || ['error', 'doublePlay', 'triplePlay', 'droppedThirdStrike'].includes(result)) && command.rbis !== 0)
        throw new Error('Las impulsadas no corresponden a las carreras válidas de esta jugada.');
      log.rbis = command.rbis;
    } else if (command.kind === 'play' && command.errors?.length && hitResults.includes(result)) {
      throw new Error('Confirma las carreras impulsadas del hit sin atribuir al bateador avances por error.');
    }
    state.indexes[state.side] += 1;
    state.balls = 0;
    state.strikes = 0;
  };
  switch (command.kind) {
    case 'pitch':
      if (command.strikeoutType && state.strikes !== 2)
        throw new Error('El tipo de ponche solo se registra en el tercer strike.');
      log.batterId = batter;
      log.pitch = command.value;
      log.text = `${playerName(state, batter)}: ${command.value === 'ball' ? 'Bola' : command.value === 'foul' ? 'Batazo de falta' : 'Strike'}`;
      if (command.value === 'ball') {
        state.balls += 1;
        if (state.balls === 4) finishTurn('walk');
      } else if (command.value === 'strike') {
        state.strikes += 1;
        if (state.strikes === 3) finishTurn('strikeout');
      } else if (state.strikes === 2 && state.seed.scoringRules === 'softball-slowpitch') finishTurn('strikeout');
      else state.strikes = Math.min(2, state.strikes + 1);
      break;
    case 'play':
      finishTurn(command.result, command.destinations, command.validThirdOutRuns);
      if (command.thirdStrikeCause) {
        log.thirdStrikeCause = command.thirdStrikeCause;
        log.text += ` · ${runnerLabels[command.thirdStrikeCause]}`;
      }
      if (command.note?.trim()) log.text += ` · ${command.note.trim()}`;
      break;
    case 'runner': {
      if (command.ruleOut) {
        const issue = runnerRuleOutIssue(state, command.ruleOut, command.note);
        if (issue) throw new Error(issue);
        log.ruleOut = structuredClone(command.ruleOut);
      }
      if (state.seed.scoringRules === 'softball-slowpitch' && ['steal', 'caught', 'wild', 'passed', 'balk'].includes(command.action))
        throw new Error('El reglamento de sóftbol lento no permite este avance sobre un lanzamiento.');
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
      if (command.ruleOut) log.text += ` · ${runnerRuleOutDescription(command.ruleOut)}`;
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
      if (state.seed.friendly ? command.jersey !== '' : !validJersey(command.jersey))
        throw new Error(state.seed.friendly ? 'Los amistosos no usan números de camiseta.' : 'Indica una camiseta válida del 0 al 99.');
      const lineup = state.lineups[command.side];
      const outgoing = lineup.find((p) => p.id === command.outId);
      const incoming = state.seed.rosters[command.side].find((p) => p.id === command.inId);
      if (!outgoing || !incoming || lineup.some((p) => p.id === incoming.id)) throw new Error('Selecciona un jugador activo y un sustituto de la plantilla que no esté en la alineación.');
      if (!state.seed.friendly && lineup.some((p) => p.id !== outgoing.id && Number(p.jersey) === Number(command.jersey))) throw new Error('El número de camiseta ya pertenece a un jugador activo.');
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
      log.text = `${command.arrival ? 'Llegada y cambio' : 'Cambio'} en ${state.seed.names[command.side]}: entra ${incoming.name} por ${outgoing.name}; conserva su turno de bateo`;
      break;
    }
    case 'position': {
      const lineup = state.lineups[command.side];
      const player = lineup.find((p) => p.id === command.playerId);
      if (!player) throw new Error('El jugador no está en la alineación activa.');
      if (!command.swapWith && command.position === 'DH' && lineup.some((p) => p.id !== player.id && p.position === 'DH')) {
        throw new Error('El puesto de bateador designado ya está ocupado.');
      }
      const swap = command.swapWith ? lineup.find(p => p.id === command.swapWith && p.id !== player.id) :
        ['DH', 'NA'].includes(command.position) ? undefined : lineup.find((p) => p.position === command.position && p.id !== player.id);
      if (command.swapWith && (!swap || swap.position !== command.position))
        throw new Error('El otro jugador debe seguir activo en la posición seleccionada. Revisa la hoja antes del intercambio.');
      state.lineups[command.side] = lineup.map((p) => p.id === player.id ? { ...p, position: command.position } :
        p.id === swap?.id ? { ...p, position: player.position } : p);
      log.text = `Cambio defensivo: ${player.name} a ${command.position}${swap ? `; intercambia con ${swap.name}` : ''}`;
      break;
    }
    case 'received-lineup': {
      createPrivateState({ ...state.seed, lineups: { ...state.seed.lineups, [command.side]: command.players } });
      const previous = state.lineups[command.side];
      if (previous.length && (previous.filter(player => player.order !== null).length !== command.players.filter(player => player.order !== null).length ||
          previous.some(player => {
            const retained = command.players.find(entry => entry.id === player.id);
            return retained && retained.order !== player.order;
          }))) {
        throw new Error('La alineación recibida no puede cambiar los turnos de bateo ya establecidos.');
      }
      state.lineups[command.side] = structuredClone(command.players);
      log.text = `Alineación compartida recibida de ${state.seed.names[command.side]}; los turnos privados anteriores se conservan`;
      break;
    }
    case 'misplay':
      log.batterId = batter;
      log.text = `Error en foul que prolonga el turno de ${playerName(state, batter)}`;
      break;
    case 'rules':
      if (state.seed.sport && (state.seed.sport === 'baseball') !== (command.rules === 'baseball'))
        throw new Error('La modalidad debe pertenecer al deporte del partido.');
      if (state.log.some(entry => entry.pitch || entry.result || entry.runnerId || entry.errors))
        throw new Error('El reglamento se elige antes de la primera anotación deportiva.');
      state.seed.scoringRules = command.rules;
      if (isSoftballScorecard(state.seed)) state.seed.softballTieBreakerFromInning ??= (state.seed.regulationInnings ?? 7) + 1;
      log.scoringRules = command.rules;
      log.text = `Reglamento: ${scoringRuleLabels[command.rules]}`;
      break;
    case 'run-review':
      state.runAccounting = reviewAccountedRun(state.runAccounting, command.review);
      log.text = `Revisión de carrera: ${command.review.note.trim()}`;
      break;
    case 'note': log.text = `Nota: ${command.note.trim()}`; break;
    case 'finish':
      state.finished = true;
      if (command.review) state.finalReview = structuredClone(command.review);
      log.text = 'Seguimiento privado cerrado; no es un resultado oficial';
      break;
  }
  if (log.errors?.length) log.text += ` · ${describeErrors()}`;
  if (command.kind !== 'run-review') {
    const misplay = command.kind === 'misplay' || log.errors?.length || log.result && reachedOnErrorResults.includes(log.result) ||
      command.kind === 'runner' && command.action === 'error' ? 'error' :
      command.kind === 'runner' && command.action === 'passed' || log.thirdStrikeCause === 'passed' ? 'passedBall' : undefined;
    if (misplay === 'error' && !log.errors?.length) log.legacyError = { playerId: null, position: null };
    const replacement = command.kind === 'courtesy' && log.runnerId ?
      { outgoing: log.runnerId, incoming: command.playerId } :
      command.kind === 'substitution' && command.side === current.side && current.bases.includes(command.outId) ?
        { outgoing: command.outId, incoming: command.inId } : undefined;
    state.runAccounting = accountRuns(state.runAccounting, {
      eventId: state.log.length + 1, half: `${log.inning}:${log.side}`, offenseId: log.side,
      pitcherId: log.pitcherId, outsBefore: current.outs, batterId: log.batterId,
      plateCompleted: log.result !== null, reachedOnError: Boolean(log.result && reachedOnErrorResults.includes(log.result)) ||
        log.thirdStrikeCause === 'passed' && state.bases.includes(batter),
      basesBefore: current.bases, basesAfter: state.bases, scored: log.runs, totalRuns: log.runs.length,
      misplay, errorOuts: log.result === 'catcherInterference' ? 0 : 'errorOuts' in command ? command.errorOuts : undefined,
      errorSavedRunnerId: log.errorSavedRunnerId,
      tieBreakerRunnerId: current.tieBreakerRunner?.runnerId,
      passedThirdStrike: log.thirdStrikeCause === 'passed' && state.bases.includes(batter),
      unknownAdvance: command.kind === 'runner' && ['advance', 'run'].includes(command.action) && !command.cleanAdvance,
      homeRun: log.result === 'homeRun' || log.result === 'insideParkHomeRun', uncertainPlay: log.result === 'fieldersChoice',
      prolongedBatter: command.kind === 'misplay', replacement,
      ballsBefore: current.balls, strikesBefore: current.strikes, walk: log.result !== null && walkResults.includes(log.result),
      eliminated: log.outs ? [...current.bases, ...(log.result ? [batter] : [])].filter((id): id is string =>
        id !== null && !state.bases.includes(id) && !log.runs.includes(id)) : []
    });
    if (log.result !== null && walkResults.includes(log.result))
      log.walkPitcherId = log.batterId ? state.runAccounting.runners[log.batterId]?.pitcherId ?? null : null;
  }
  if (command.kind === 'substitution' || command.kind === 'position' || command.kind === 'received-lineup' || command.kind === 'courtesy') {
    const side = command.kind === 'courtesy' ? current.side : command.side;
    state.participants ??= structuredClone(current.lineups);
    for (const player of state.lineups[side]) {
      const index = state.participants[side].findIndex(member => member.id === player.id);
      if (index < 0) state.participants[side].push({ ...player });
      else state.participants[side][index] = { ...player };
    }
    if (command.kind === 'courtesy') {
      const player = state.seed.rosters[side].find(member => member.id === command.playerId);
      if (player && !state.participants[side].some(member => member.id === player.id))
        state.participants[side].push({ ...player });
    }
  }
  state.scores[log.side] += log.runs.length;
  state.outs += log.outs;
  Object.keys(state.courtesyFor).forEach((id) => {
    if (!state.bases.includes(id)) delete state.courtesyFor[id];
  });
  if ((command.kind === 'play' || command.kind === 'runner') && command.fieldingSequence && !log.fieldingSequence) {
    log.fieldingSequence = [...command.fieldingSequence];
    log.text += ` · vía ${command.fieldingSequence.join('-')}`;
  }
  if (command.kind === 'runner') log.runnerAction = command.action;
  if (command.kind === 'pitch' || command.kind === 'play' || command.kind === 'runner' || command.kind === 'misplay') {
    log.defenders = Object.fromEntries(defensivePositions(current).flatMap(position => {
      const player = defensivePlayerAt(current, position.number);
      return player ? [[player.position, player.id]] : [];
    }));
    const route = (command.kind === 'play' || command.kind === 'runner') ? command.fieldingSequence :
      log.result === 'strikeout' ? [2] : undefined;
    const sequence = route ?? (log.result === 'strikeout' ? [2] : undefined);
    const marked = (command.kind === 'play' || command.kind === 'runner') ? command.outAt : undefined;
    if (marked && (marked.length !== log.outs || marked.at(-1) !== sequence!.length - 1))
      throw new Error('Marca cada out en el punto correcto del recorrido, incluido el último defensor.');
    const boundaries = marked ?? (log.outs === 1 && sequence?.length ? [sequence.length - 1] : undefined);
    if (log.outs === 0 && !log.errors?.length && !log.legacyError) log.fieldingCredit = { putouts: [], assists: [] };
    else if (boundaries && sequence && sequence.every(number => defensivePlayerAt(current, number))) {
      const putouts: string[] = [], assists: string[] = [];
      let start = 0;
      for (const end of boundaries) {
        const path = sequence.slice(start, end + 1).map(number => defensivePlayerAt(current, number)!.id);
        putouts.push(path.at(-1)!);
        assists.push(...new Set(path.slice(0, -1)));
        start = end;
      }
      log.fieldingCredit = { putouts, assists };
    }
  }
  state.log.push(log);
  if (state.outs >= 3 || command.kind === 'finish') log.leftOnBase = state.bases.filter((id): id is string => id !== null);
  if (command.sharedRequestId && command.teamSheetSide && command.teamSheetRevision !== undefined) {
    state.seed.teamSheetRevisions = {
      home: state.seed.teamSheetRevisions?.home ?? 0,
      away: state.seed.teamSheetRevisions?.away ?? 0,
      [command.teamSheetSide]: command.teamSheetRevision
    };
  }
  changeHalf(state);
  if (state.tieBreakerRunner && (state.inning !== current.inning || state.side !== current.side)) {
    log.tieBreakerRunner = { ...state.tieBreakerRunner };
    log.text += ` · ${softballTieBreakerNotice(state)}`;
  }
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

export function readPrivateSave(raw: string): { version: 1; seed: PrivateSeed; commands: PrivateCommand[]; clock?: GameClock } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('La planilla privada guardada no se puede leer. No se sobrescribió.');
  }
  if (!isRecord(data) || data.version !== 1 || !isSeed(data.seed) || !Array.isArray(data.commands) || !data.commands.every(isScorecardCommand) ||
      data.clock !== undefined && !isGameClock(data.clock)) {
    throw new Error('La planilla privada guardada no tiene un formato válido. No se sobrescribió.');
  }
  let seed = data.seed;
  if (seed.softballTieBreakerFromInning === undefined) {
    const historical = replayPrivate({ ...seed, softballTieBreakerFromInning: Number.MAX_SAFE_INTEGER }, data.commands);
    if (isSoftballScorecard(historical.seed)) seed = { ...seed,
      softballTieBreakerFromInning: Math.max((scorecardRegulationInnings(historical.seed) ?? 7) + 1, historical.inning + 1) };
  }
  replayPrivate(seed, data.commands);
  return { version: 1, seed, commands: data.commands, ...(isGameClock(data.clock) ? { clock: data.clock } : {}) };
}

export function privateFinishSuggestion(state: PrivateState): {
  winner: Side; inning: number; eventIndex: number;
  reason: 'homeAheadAfterTop' | 'walkOff' | 'completedInning';
} | null {
  const limit = scorecardRegulationInnings(state.seed);
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
  const hits = turns.filter((e) => e.result && hitResults.includes(e.result)).length;
  const atBats = turns.filter((e) => e.result && !noAtBatResults.includes(e.result)).length;
  return {
    pa: turns.length, hits, atBats,
    average: atBats ? (hits / atBats).toFixed(3).replace(/^0/, '') : '—',
    runs: state.log.filter((e) => e.side === side).reduce((sum, e) => sum + e.runs.filter((runner) => runner === id).length, 0),
    rbis: turns.reduce((sum, e) => sum + e.rbis, 0),
    walks: turns.filter((e) => e.result && walkResults.includes(e.result)).length,
    strikeouts: turns.filter((e) => e.result === 'strikeout' || e.result === 'droppedThirdStrike').length,
    homeRuns: turns.filter((e) => e.result === 'homeRun' || e.result === 'insideParkHomeRun').length,
    steals: state.log.filter((e) => e.side === side && e.stolenBy === id).length
  };
}

export function privateFieldingStats(state: PrivateState, side: Side, playerId?: string) {
  const entries = state.log.flatMap((entry, logIndex) => {
    if (entry.side === side) return [];
    const errors: Array<{ playerId: string | null; position: string | null; type: DefensiveError['type'] | null }> =
      entry.errors?.length ? entry.errors : entry.legacyError ? [{ ...entry.legacyError, type: null }] :
        entry.result && reachedOnErrorResults.includes(entry.result) ? [{ playerId: null, position: null, type: null }] : [];
    return errors.map((error, errorIndex) => ({ ...error, inning: entry.inning, text: entry.text, logIndex, errorIndex }));
  });
  const unattributed = entries.filter(entry => entry.playerId === null).length;
  const selected = playerId === undefined ? entries : entries.filter(entry => entry.playerId === playerId);
  return {
    entries: selected,
    errors: state.fieldingIncomplete || playerId !== undefined && unattributed > 0 ? null : selected.length,
    unattributed,
    incomplete: Boolean(state.fieldingIncomplete)
  };
}

export function privateDefensiveCredits(state: PrivateState, side: Side, id?: string) {
  const entries = state.log.filter(entry => entry.side !== side &&
    (entry.result !== null || entry.pitch !== null || entry.runnerId !== null || entry.outs > 0 || entry.runs.length > 0));
  const outs = entries.filter(entry => entry.outs > 0);
  const complete = !state.fieldingIncomplete && outs.every(entry => entry.fieldingCredit !== undefined);
  const assistsComplete = complete && entries.every(entry =>
    !(entry.errors?.length || entry.legacyError || entry.result === 'error') || entry.fieldingCredit !== undefined);
  const sum = (key: 'putouts' | 'assists') => entries.reduce((total, entry) => total +
    (entry.fieldingCredit?.[key].filter(player => id === undefined || player === id).length ?? 0), 0);
  const multiple = (count: number) => entries.filter(entry => entry.outs === count &&
    (id === undefined || [...(entry.fieldingCredit?.putouts ?? []), ...(entry.fieldingCredit?.assists ?? [])].includes(id))).length;
  const positions = new Set<string>();
  for (const entry of entries)
    for (const [position, player] of Object.entries(entry.defenders ?? {}))
      if (id === undefined || player === id) positions.add(position);
  const inningsComplete = outs.every(entry => entry.defenders !== undefined);
  const defended = outs.reduce((sum, entry) => {
    const found = Object.entries(entry.defenders ?? {}).find(([, player]) => player === id);
    return sum + (id === undefined || found ? entry.outs : 0);
  }, 0);
  return {
    putouts: complete ? sum('putouts') : null, assists: assistsComplete ? sum('assists') : null,
    doublePlays: complete ? multiple(2) : null, triplePlays: complete ? multiple(3) : null,
    defendedOuts: inningsComplete ? defended : null, positions: [...positions]
  };
}
