import {
  privateDefensiveCredits, privateFieldingStats, privateInningRuns, privateStats, scoringRuleLabels,
  scorecardParticipants as gameReportParticipants, scorecardSourceComplete,
  type PrivatePlayer, type PrivateState, type Side
} from './scorecard.js';
import {
  calculateStatisticsRates, isStatisticsLine, scorecardStatistics, type StatisticsLine
} from './sports-statistics.js';
import { gameReportPlayer, gameReportPlayerKey, type GameFinalReview } from './game-final-review.js';
import { runTotals } from './earned-runs.js';

export type GameReportPlayer = {
  key: string;
  name: string;
  jersey: string;
  order: number | null;
  positions: string[];
  line: StatisticsLine;
  pitching: { pitches: number | null; strikes: number | null; recorded: number; wildPitches: number | null; balks: number | null };
  fielding: { passedBalls: number | null };
};
export type GameReportTeam = {
  name: string; runs: number; hits: number | null; errors: number | null;
  leftOnBase: number | null;
  innings: Array<number | null>;
  players?: GameReportPlayer[];
  totals?: StatisticsLine;
};
export type GameReport = {
  version: 1;
  source: 'official' | 'private' | 'friendly' | 'practice';
  finished: boolean;
  detailed: boolean;
  rules: string | null;
  eraBase: 7 | 9 | null;
  innings: number[];
  teams: Record<Side, GameReportTeam>;
  honors: { winner: string | null; loser: string | null; saver: string | null; bestBatter: string | null; mvp: string | null };
  reviewed: boolean;
  rulesReference: string | null;
  note: string | null;
  warnings: string[];
  homeRuns?: Array<{ inning: number; side: Side; batter: string; pitcher: string | null; rbis: number; insidePark: boolean }>;
  metadata?: { tournament: string | null; date: string | null; time: string | null; venue: string | null; revision: number | null };
};
export type GameReportOptions = {
  source: GameReport['source'];
  detailed: boolean;
  eraBase?: 7 | 9 | null;
  review?: GameFinalReview;
  atBats?: ReadonlyMap<string, number>;
  pitchingWalks?: ReadonlyMap<string, number>;
  offenseIds?: Record<Side, string>;
  sourceComplete?: boolean;
  caughtStealing?: ReadonlyMap<string, number>;
  metadata?: GameReport['metadata'];
};
export type GameReportPrintRequest = { type: 'playsport:print-report'; requestId: number; html: string };
export function readGameReportPrintRequest(value: unknown): GameReportPrintRequest {
  if (!record(value) || value.type !== 'playsport:print-report' ||
      typeof value.requestId !== 'number' || !Number.isSafeInteger(value.requestId) || value.requestId < 1 ||
      typeof value.html !== 'string' || !value.html.startsWith('<!doctype html>') || value.html.length > 2000000 ||
      /<(script|iframe|object|embed|link|img)\b/i.test(value.html))
    throw new Error('La solicitud de impresión del resumen es inválida.');
  return { type: value.type, requestId: value.requestId, html: value.html };
}
const actualPlay = (entry: PrivateState['log'][number]) =>
  entry.result !== null || entry.pitch !== null || entry.runnerId !== null || entry.outs > 0 || entry.runs.length > 0;
const reportName = (player: PrivatePlayer) => player.name === player.id ? 'Nombre no disponible' : player.name;
export { gameReportParticipants };
export const reportFielding = privateDefensiveCredits;
export function createGameReport(state: PrivateState, options: GameReportOptions): GameReport {
  const review = options.review ?? state.finalReview;
  const eraBase = options.eraBase === undefined ?
    state.seed.sport === 'baseball' || state.seed.scoringRules === 'baseball' ? 9 :
      state.seed.sport === 'softball' || state.seed.scoringRules?.startsWith('softball') ? 7 : null : options.eraBase;
  const sporting = state.log.filter(actualPlay);
  const lastInning = Math.max(1, ...sporting.map(entry => entry.inning));
  const innings = Array.from({ length: lastInning }, (_, index) => index + 1);
  const sourceComplete = options.sourceComplete !== false && scorecardSourceComplete(state, options.offenseIds);
  const warnings: string[] = [];
  if (!sourceComplete) warnings.push('La anotación está incompleta; no se reconstruyen cifras individuales que no estén respaldadas.');
  if (eraBase === null) warnings.push('Falta declarar el deporte o la base reglamentaria del PCL.');
  if (!review) warnings.push('Las decisiones de pitchers y los reconocimientos no han sido confirmados.');
  if (state.runAccounting.runs.some(run => run.team === 'pending' || run.pitcher === 'pending'))
    warnings.push('Hay carreras pendientes de clasificación: el PCL correspondiente no está disponible.');
  const name = (id: string) => {
    const player = [...state.seed.rosters.home, ...state.seed.rosters.away].find(player => player.id === id);
    return player ? reportName(player) : null;
  };
  const honored = (key: string | null | undefined) => {
    const member = key ? gameReportPlayer(state.seed, key) : null;
    return member ? reportName(member.player) : null;
  };
  const makeTeam = (side: Side): GameReportTeam => {
    const members = gameReportParticipants(state, side);
    const offense = state.log.filter(entry => entry.side === side);
    const defense = state.log.filter(entry => entry.side !== side);
    const teamErrors = privateFieldingStats(state, side).errors;
    const completed = new Map<number, PrivateState['log']>();
    for (const entry of offense.filter(entry => entry.outs > 0))
      completed.set(entry.inning, [...(completed.get(entry.inning) ?? []), entry]);
    const team: GameReportTeam = {
      name: state.seed.names[side], runs: state.scores[side],
      hits: sourceComplete ? members.reduce((sum, player) => sum + privateStats(state, side, player.id).hits, 0) : null,
      errors: sourceComplete ? teamErrors : null, innings: innings.map(inning => privateInningRuns(state, side, inning)),
      leftOnBase: !options.detailed ? null : [...completed.values()].some(entries => entries.reduce((sum, entry) => sum + entry.outs, 0) >= 3 &&
        entries.at(-1)?.leftOnBase === undefined) ? null :
        state.log.filter(entry => entry.side === side).reduce((sum, entry) => sum + (entry.leftOnBase?.length ?? 0), 0)
    };
    if (!options.detailed) return team;
    const lineFor = (ids: string[], positions: string[], isTeam: boolean) => {
      const caught = options.caughtStealing ? ids.reduce((sum, id) => sum + (options.caughtStealing!.get(id) ?? 0), 0) :
        offense.some(entry => entry.runnerId && entry.outs > 0 && entry.runnerAction === undefined) ? null :
        offense.filter(entry => entry.runnerId && ids.includes(entry.runnerId) && entry.runnerAction === 'caught').length;
      const line = scorecardStatistics(review ? { ...state, finalReview: review } : state, side, ids, {
        team: isTeam, startingPitcherIds: state.seed.lineups[side].filter(player => player.position === 'P').map(player => player.id),
        positions, caughtStealing: caught, errors: isTeam ? teamErrors : privateFieldingStats(state, side, ids[0]).errors,
        pitchingComplete: isTeam || defense.every(entry => !actualPlay(entry) || entry.pitcherId !== null) &&
          !state.runAccounting.runs.some(run => run.offenseId !== (options.offenseIds?.[side] ?? side) && run.pitcherId === null),
        offenseId: options.offenseIds?.[side] ?? side,
        ...(options.atBats ? { battingAtBats: ids.reduce((sum, id) => sum + (options.atBats!.get(id) ?? privateStats(state, side, id).atBats), 0) } : {}),
        ...(options.pitchingWalks ? { pitchingWalks: ids.reduce((sum, id) => sum + (options.pitchingWalks!.get(id) ?? 0), 0) } : {})
      });
      if (!sourceComplete) for (const group of [line.batting, line.pitching, line.fielding])
        for (const key of Object.keys(group)) Object.assign(group, { [key]: null });
      return calculateStatisticsRates(line, eraBase);
    };
    team.players = members.map(player => {
      const key = gameReportPlayerKey(state.seed, side, player.id);
      const fielding = reportFielding(state, side, player.id);
      const positions = [...new Set([player.position, ...fielding.positions])];
      const line = lineFor([player.id], positions, false);
      const pitcherEvidence = review?.pitching[key];
      const fieldingEvidence = review?.fielding[key];
      const recorded = defense.filter(entry => entry.pitcherId === player.id && entry.pitch !== null).length;
      return { key, name: reportName(player), jersey: player.jersey, order: player.order, positions, line,
        pitching: { pitches: pitcherEvidence?.pitches ?? null, strikes: pitcherEvidence?.strikes ?? null,
          recorded, wildPitches: pitcherEvidence?.wildPitches ?? null, balks: pitcherEvidence?.balks ?? null },
        fielding: { passedBalls: fieldingEvidence?.passedBalls ?? null } };
    });
    team.totals = lineFor(members.map(player => player.id), members.map(player => player.position), true);
    for (const metric of ['PO', 'A', 'PB'] as const) {
      team.totals.fielding[metric] = team.players.every(player => player.line.fielding[metric] !== null) ?
        team.players.reduce((sum, player) => sum + player.line.fielding[metric]!, 0) : null;
    }
    team.totals = calculateStatisticsRates(team.totals, eraBase);
    if (team.players.some(player => player.line.fielding.PO === null || player.line.fielding.A === null))
      warnings.push(`Defensa de ${team.name}: faltan créditos de outs o asistencias; no se inventan promedios defensivos.`);
    return team;
  };
  const report: GameReport = {
    version: 1, source: options.source, finished: state.finished, detailed: options.detailed,
    rules: state.seed.scoringRules ? scoringRuleLabels[state.seed.scoringRules] : null, eraBase, innings,
    teams: { home: makeTeam('home'), away: makeTeam('away') },
    honors: { winner: honored(review?.winner), loser: honored(review?.loser), saver: honored(review?.saver),
      bestBatter: honored(review?.bestBatter), mvp: honored(review?.mvp) },
    reviewed: Boolean(review), rulesReference: review?.rulesReference ?? null,
    note: review?.note || null, warnings: [...new Set(warnings)],
    ...(options.metadata ? { metadata: options.metadata } : {})
  };
  if (options.detailed) report.homeRuns = state.log.filter(entry =>
    entry.result === 'homeRun' || entry.result === 'insideParkHomeRun').map(entry => ({
      inning: entry.inning, side: entry.side, batter: entry.batterId ? name(entry.batterId) ?? 'Jugador sin identificar' : 'Jugador sin identificar',
      pitcher: entry.pitcherId ? name(entry.pitcherId) : null, rbis: entry.rbis,
      insidePark: entry.result === 'insideParkHomeRun'
    }));
  return report;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => value === null ||
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
function validReportPlayer(value: unknown): value is GameReportPlayer {
  if (!record(value) || typeof value.key !== 'string' || !/^(home|away):\d+$/.test(value.key) ||
      typeof value.name !== 'string' || typeof value.jersey !== 'string' || !count(value.order) ||
      !strings(value.positions) || !isStatisticsLine(value.line) || !record(value.pitching) || !record(value.fielding)) return false;
  const pitching = value.pitching;
  return ['pitches', 'strikes', 'recorded', 'wildPitches', 'balks'].every(key => count(pitching[key])) &&
    count(value.fielding.passedBalls);
}
function validReportTeam(value: unknown, detailed: boolean): value is GameReportTeam {
  return record(value) && typeof value.name === 'string' && count(value.runs) && value.runs !== null &&
    count(value.hits) && count(value.errors) && count(value.leftOnBase) &&
    Array.isArray(value.innings) && value.innings.every(count) &&
    (detailed ? Array.isArray(value.players) && value.players.every(validReportPlayer) && isStatisticsLine(value.totals) :
      value.players === undefined && value.totals === undefined);
}
function isGameReport(value: unknown): value is GameReport {
  if (!record(value) || value.version !== 1 || !['official', 'private', 'friendly', 'practice'].includes(String(value.source)) ||
      typeof value.finished !== 'boolean' || typeof value.detailed !== 'boolean' || typeof value.reviewed !== 'boolean' ||
      !nullableText(value.rules) || !nullableText(value.rulesReference) || !nullableText(value.note) ||
      !(value.eraBase === null || value.eraBase === 7 || value.eraBase === 9) ||
      !Array.isArray(value.innings) || !value.innings.every(item => typeof item === 'number' && Number.isSafeInteger(item) && item > 0) ||
      !strings(value.warnings) || !record(value.teams) || !record(value.honors) ||
      value.metadata !== undefined && (!record(value.metadata) ||
        !nullableText(value.metadata.tournament) || !nullableText(value.metadata.date) ||
        !nullableText(value.metadata.time) || !nullableText(value.metadata.venue) || !count(value.metadata.revision)))
    return false;
  const detailed = value.detailed, teams = value.teams, honors = value.honors;
  if (!validReportTeam(teams.home, detailed) || !validReportTeam(teams.away, detailed) ||
      !['winner', 'loser', 'saver', 'bestBatter', 'mvp'].every(key => nullableText(honors[key])) ||
      teams.home.innings.length !== value.innings.length || teams.away.innings.length !== value.innings.length ||
      (!detailed && value.homeRuns !== undefined) ||
      detailed && (!Array.isArray(value.homeRuns) || !value.homeRuns.every(entry => record(entry) &&
        typeof entry.inning === 'number' && Number.isSafeInteger(entry.inning) && entry.inning > 0 &&
        (entry.side === 'home' || entry.side === 'away') && typeof entry.batter === 'string' &&
        nullableText(entry.pitcher) && count(entry.rbis) && entry.rbis !== null && typeof entry.insidePark === 'boolean')))
    return false;
  return true;
}
export function readGameReport(value: unknown): GameReport {
  if (!isGameReport(value)) throw new Error('El resumen del partido contiene datos inválidos.');
  return value;
}
