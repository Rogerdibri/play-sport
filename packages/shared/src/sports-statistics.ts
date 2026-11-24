import { isCalendarDate } from './events-calendar.js';
import { isOfficialGameStatus, type OfficialGameStatus } from './official-games.js';
import type { PrivateState, PrivatePlayer, Side } from './scorecard.js';
import { hitResults, walkResults, privateStats, privateDefensiveCredits, privateFieldingStats, scorecardParticipants,
  scorecardSourceComplete, battedBallTypeForLog } from './scorecard.js';
import { normalizeProfileIdentification } from './registration.js';
import { gameReportPlayerKey } from './game-final-review.js';
import { runTotals } from './earned-runs.js';
import { hasAccountAccessControls } from './account-access.js';

export type BattingStatistics = {
  G: number | null; PA: number | null; AB: number | null; H: number | null; singles: number | null;
  doubles: number | null; triples: number | null; HR: number | null; R: number | null; RBI: number | null;
  BB: number | null; HBP: number | null; K: number | null; SB: number | null; CS: number | null;
  SF: number | null; SH: number | null; TB: number | null; AVG: number | null; OBP: number | null;
  SLG: number | null; OPS: number | null;
  GO: number | null; LO: number | null; FO: number | null; BO: number | null; GIDP: number | null;
};
export type PitchingStatistics = {
  G: number | null; GS: number | null; W: number | null; L: number | null; SV: number | null;
  outs: number | null; BF: number | null; H: number | null; R: number | null; ER: number | null;
  pending: number | null; BB: number | null; K: number | null; HBP: number | null; HR: number | null;
  pitches: number | null; strikes: number | null; ERA: number | null; WHIP: number | null;
  CG: number | null; SHO: number | null;
};
export type FieldingStatistics = {
  G: number | null; E: number | null; PO: number | null; A: number | null; FLD: number | null;
  DP: number | null; TP: number | null; outs: number | null; CS: number | null; PB: number | null;
};
export type StatisticsLine = { batting: BattingStatistics; pitching: PitchingStatistics; fielding: FieldingStatistics };
type Metric = { key: string; label: string; description: string; precision: number };
export const statisticsMetrics = {
  batting: [
    { key: 'G', label: 'JJ', description: 'Juegos con participación', precision: 0 },
    { key: 'PA', label: 'AP', description: 'Apariciones al plato', precision: 0 },
    { key: 'AB', label: 'VB', description: 'Veces oficiales al bate', precision: 0 },
    { key: 'H', label: 'H', description: 'Hits', precision: 0 },
    { key: 'singles', label: '1B', description: 'Sencillos', precision: 0 },
    { key: 'doubles', label: '2B', description: 'Dobles', precision: 0 },
    { key: 'triples', label: '3B', description: 'Triples', precision: 0 },
    { key: 'HR', label: 'HR', description: 'Jonrones', precision: 0 },
    { key: 'R', label: 'CA', description: 'Carreras anotadas', precision: 0 },
    { key: 'RBI', label: 'CI', description: 'Carreras impulsadas', precision: 0 },
    { key: 'BB', label: 'BB', description: 'Bases por bolas', precision: 0 },
    { key: 'HBP', label: 'GP', description: 'Golpeados por lanzamiento', precision: 0 },
    { key: 'K', label: 'K', description: 'Ponches', precision: 0 },
    { key: 'SB', label: 'BR', description: 'Bases robadas', precision: 0 },
    { key: 'CS', label: 'AR', description: 'Atrapado robando; no incluye pickoffs', precision: 0 },
    { key: 'SF', label: 'SF', description: 'Elevados de sacrificio', precision: 0 },
    { key: 'SH', label: 'SH', description: 'Toques de sacrificio', precision: 0 },
    { key: 'GO', label: 'GO', description: 'Turnos terminados con el bateador out por rodado', precision: 0 },
    { key: 'LO', label: 'LO', description: 'Turnos terminados con el bateador out por línea', precision: 0 },
    { key: 'FO', label: 'FO', description: 'Turnos terminados con el bateador out por elevado', precision: 0 },
    { key: 'BO', label: 'TO', description: 'Turnos terminados con el bateador out en toque', precision: 0 },
    { key: 'GIDP', label: 'GIDP', description: 'Rodados bateados para doble jugada con el bateador eliminado', precision: 0 },
    { key: 'TB', label: 'BT', description: 'Bases totales obtenidas por hits', precision: 0 },
    { key: 'AVG', label: 'AVG', description: 'Hits / veces al bate', precision: 3 },
    { key: 'OBP', label: 'OBP', description: '(H + BB + GP) / (VB + BB + GP + SF)', precision: 3 },
    { key: 'SLG', label: 'SLG', description: 'Bases totales / veces al bate', precision: 3 },
    { key: 'OPS', label: 'OPS', description: 'OBP + SLG', precision: 3 },
  ] satisfies Array<Metric & { key: keyof BattingStatistics }>,
  pitching: [
    { key: 'G', label: 'JL', description: 'Juegos con actuación de pitcheo', precision: 0 },
    { key: 'GS', label: 'JA', description: 'Aperturas', precision: 0 },
    { key: 'W', label: 'G', description: 'Victorias adjudicadas oficialmente al pitcher', precision: 0 },
    { key: 'L', label: 'P', description: 'Derrotas adjudicadas oficialmente al pitcher', precision: 0 },
    { key: 'SV', label: 'SV', description: 'Salvados adjudicados oficialmente', precision: 0 },
    { key: 'outs', label: 'IP', description: 'Entradas y outs; 5.1 significa cinco entradas y un out', precision: 0 },
    { key: 'BF', label: 'BE', description: 'Bateadores enfrentados', precision: 0 },
    { key: 'H', label: 'H', description: 'Hits permitidos', precision: 0 },
    { key: 'R', label: 'CP', description: 'Carreras permitidas, incluidos corredores heredados a su responsable', precision: 0 },
    { key: 'ER', label: 'CL', description: 'Carreras limpias clasificadas', precision: 0 },
    { key: 'pending', label: 'Pend.', description: 'Carreras pendientes de clasificación', precision: 0 },
    { key: 'BB', label: 'BB', description: 'Bases por bolas permitidas', precision: 0 },
    { key: 'K', label: 'K', description: 'Ponches propinados', precision: 0 },
    { key: 'HBP', label: 'GP', description: 'Bateadores golpeados', precision: 0 },
    { key: 'HR', label: 'HR', description: 'Jonrones permitidos', precision: 0 },
    { key: 'pitches', label: 'LR', description: 'Lanzamientos registrados con los controles de conteo; no se estima el total', precision: 0 },
    { key: 'strikes', label: 'SR', description: 'Strikes y fouls registrados con los controles de conteo', precision: 0 },
    { key: 'ERA', label: 'PCL', description: 'Carreras limpias por la base reglamentaria de entradas', precision: 2 },
    { key: 'WHIP', label: 'WHIP', description: '(Hits + bases por bolas) / entradas lanzadas', precision: 2 },
    { key: 'CG', label: 'JC', description: 'Juegos completos oficialmente registrados', precision: 0 },
    { key: 'SHO', label: 'BL', description: 'Blanqueos oficialmente registrados', precision: 0 },
  ] satisfies Array<Metric & { key: keyof PitchingStatistics }>,
  fielding: [
    { key: 'G', label: 'JD', description: 'Juegos con posición defensiva en la alineación', precision: 0 },
    { key: 'E', label: 'E', description: 'Errores atribuidos; no se reparten errores sin defensor identificado', precision: 0 },
    { key: 'PO', label: 'PO', description: 'Outs realizados individualmente', precision: 0 },
    { key: 'A', label: 'A', description: 'Asistencias defensivas', precision: 0 },
    { key: 'FLD', label: 'FLD', description: '(PO + A) / (PO + A + E)', precision: 3 },
    { key: 'DP', label: 'DP', description: 'Participación individual en dobles plays', precision: 0 },
    { key: 'TP', label: 'TP', description: 'Participación individual en triples plays', precision: 0 },
    { key: 'outs', label: 'ID', description: 'Entradas defendidas por posición', precision: 0 },
    { key: 'CS', label: 'AR', description: 'Corredores atrapados por el receptor', precision: 0 },
    { key: 'PB', label: 'PB', description: 'Bolas pasadas atribuidas al receptor', precision: 0 },
  ] satisfies Array<Metric & { key: keyof FieldingStatistics }>,
};
export type StatisticsGame = {
  gameId: string; tournamentId: string; tournamentName: string; teamId: string; teamName: string;
  opponentName: string; leagueId: string; leagueName: string; date: string | null; season: string;
  sport: 'baseball' | 'softball' | null; modality: string; category: string; eraBase: 7 | 9 | null;
  kind?: 'official' | 'friendly' | 'private';
  version: number; status: OfficialGameStatus; qualification: 'official' | 'recorded' | 'provisional' | 'excluded';
  reason: string; public: boolean; positions: string[]; line: StatisticsLine | null;
  result: 'win' | 'loss' | 'tie' | null;
};
export const statisticsGameKindLabels = { official: 'Oficial', friendly: 'Amistoso', private: 'Planilla privada' } as const;
export const statisticsGameKind = (game: StatisticsGame) => game.kind ?? 'official';
export type StatisticsSnapshot = {
  accountId: string; mode: 'player' | 'team'; source: 'official' | 'example';
  identityVerified: boolean; analysisAllowed: boolean; games: StatisticsGame[];
  players?: ManagerStatisticsPlayer[];
};
export type ManagerStatisticsPlayer = { id: string; name: string | null; activeTournament: boolean; game: StatisticsGame };
export type StatisticsFilters = { group: string; season: string; league: string; tournament: string; team: string; game: string; from: string; to: string };
export const statisticsFilterKeys = ['group', 'season', 'league', 'tournament', 'team', 'game', 'from', 'to'] as const;
export function readStatisticsFilters(query: Record<string, unknown>): StatisticsFilters {
  const filters: StatisticsFilters = { group: '', season: '', league: '', tournament: '', team: '', game: '', from: '', to: '' };
  for (const key of statisticsFilterKeys) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > 1000 || hasAccountAccessControls(value))
      throw new Error('Los filtros estadísticos no son válidos.');
    if ((key === 'from' || key === 'to') && value !== '' && !isCalendarDate(value))
      throw new Error('Las fechas de las estadísticas no son válidas.');
    filters[key] = value;
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw new Error('La fecha inicial no puede ser posterior a la fecha final.');
  return filters;
}
export const statisticsTeamKey = (game: StatisticsGame) => JSON.stringify([game.tournamentId, game.teamId]);
export const statisticsLeagueKey = (game: StatisticsGame) => JSON.stringify([game.leagueId, game.leagueName]);
export function filterStatisticsGames(games: readonly StatisticsGame[], filters: StatisticsFilters): StatisticsGame[] {
  return games.filter(game => (!filters.group || statisticsGroupKey(game) === filters.group) &&
    (!filters.season || JSON.stringify(game.season) === filters.season) &&
    (!filters.league || statisticsLeagueKey(game) === filters.league) &&
    (!filters.tournament || game.tournamentId === filters.tournament) && (!filters.team || statisticsTeamKey(game) === filters.team) &&
    (!filters.game || JSON.stringify([game.tournamentId, game.gameId, game.teamId]) === filters.game) &&
    (!filters.from || game.date !== null && game.date >= filters.from) &&
    (!filters.to || game.date !== null && game.date <= filters.to));
}
const ratio = (numerator: number | null, denominator: number | null) =>
  numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
export function statisticsInnings(outs: number | null): string {
  if (outs !== null && (!Number.isSafeInteger(outs) || outs < 0)) throw new Error('Las entradas requieren una cantidad entera y no negativa de outs.');
  return outs === null ? 'No disponible' : `${Math.floor(outs / 3)}.${outs % 3}`;
}
export function calculateStatisticsRates(line: StatisticsLine, eraBase: 7 | 9 | null): StatisticsLine {
  const b = { ...line.batting }, p = { ...line.pitching };
  b.TB = [b.singles, b.doubles, b.triples, b.HR].some(value => value === null) ? null :
    b.singles! + 2 * b.doubles! + 3 * b.triples! + 4 * b.HR!;
  b.AVG = ratio(b.H, b.AB); b.SLG = ratio(b.TB, b.AB);
  b.OBP = [b.H, b.BB, b.HBP, b.AB, b.SF].some(value => value === null) ? null :
    ratio(b.H! + b.BB! + b.HBP!, b.AB! + b.BB! + b.HBP! + b.SF!);
  b.OPS = b.OBP === null || b.SLG === null ? null : b.OBP + b.SLG;
  p.ERA = p.pending !== 0 || p.ER === null || p.outs === null || eraBase === null ? null : ratio(p.ER * eraBase * 3, p.outs);
  p.WHIP = p.H === null || p.BB === null || p.outs === null ? null : ratio((p.H + p.BB) * 3, p.outs);
  const f = { ...line.fielding };
  f.FLD = f.PO === null || f.A === null || f.E === null ? null : ratio(f.PO + f.A, f.PO + f.A + f.E);
  return { batting: b, pitching: p, fielding: f };
}
export function scorecardStatistics(state: PrivateState, side: Side, ids: readonly string[], options: {
  team: boolean; startingPitcherIds: readonly string[] | null; positions: readonly string[];
  caughtStealing: number | null; errors: number | null; battingAtBats?: number;
  pitchingWalks?: number; pitchingComplete: boolean; offenseId: string;
}): StatisticsLine {
  const own = (id: string | null) => id !== null && ids.includes(id);
  const offense = state.log.filter(entry => entry.side === side);
  const turns = offense.filter(entry => own(entry.batterId) && entry.result !== null);
  const stats = ids.map(id => privateStats(state, side, id));
  const battedOuts = turns.filter(entry => entry.batterRuleOut?.reason === 'intentionalDrop' ||
    entry.result && ['groundOut', 'lineOut', 'flyOut', 'buntOut',
      'battedOut', 'doublePlay', 'triplePlay', 'sacrificeFly', 'sacrificeBunt'].includes(entry.result));
  const classifiedOuts = battedOuts.every(entry => battedBallTypeForLog(entry) !== null);
  const outCount = (type: 'ground' | 'line' | 'fly' | 'bunt') =>
    classifiedOuts ? battedOuts.filter(entry => battedBallTypeForLog(entry) === type).length : null;
  const sum = (key: 'pa' | 'atBats' | 'hits' | 'runs' | 'rbis' | 'walks' | 'strikeouts' | 'homeRuns' | 'steals') =>
    stats.reduce((total, row) => total + row[key], 0);
  const batting: BattingStatistics = {
    G: 1, PA: sum('pa'), AB: options.battingAtBats ?? sum('atBats'), H: sum('hits'),
    singles: turns.filter(entry => entry.result === 'single' || entry.result === 'buntHit').length,
    doubles: turns.filter(entry => entry.result === 'double' || entry.result === 'groundRuleDouble').length,
    triples: turns.filter(entry => entry.result === 'triple').length,
    HR: sum('homeRuns'), R: sum('runs'), RBI: sum('rbis'), BB: sum('walks'),
    HBP: turns.filter(entry => entry.result === 'hitByPitch').length, K: sum('strikeouts'),
    SB: sum('steals'), CS: options.caughtStealing,
    SF: turns.filter(entry => entry.result === 'sacrificeFly' || entry.result === 'sacrificeFlyError').length, SH: 0, TB: null, AVG: null, OBP: null, SLG: null, OPS: null,
    GO: outCount('ground'), LO: outCount('line'), FO: outCount('fly'), BO: outCount('bunt'),
    GIDP: turns.some(entry => entry.result === 'doublePlay' && !entry.battedBallType) ? null :
      turns.filter(entry => entry.result === 'doublePlay' && entry.battedBallType === 'ground').length,
  };
  batting.SH = batting.PA! - batting.AB! - batting.BB! - batting.HBP! - batting.SF! -
    turns.filter(entry => entry.result === 'catcherInterference').length;
  if (batting.SH < 0) throw new Error('Las apariciones y sacrificios no coinciden con la anotación oficial.');
  const defense = state.log.filter(entry => entry.side !== side);
  const pitching = defense.filter(entry => options.team || own(entry.pitcherId));
  const pitched = pitching.some(entry => entry.pitch || entry.result || entry.outs || entry.runs.length);
  const pitchingTurns = pitching.filter(entry => entry.result !== null);
  const runs = state.runAccounting.runs.filter(run => options.team ? run.offenseId !== options.offenseId : own(run.pitcherId));
  const earned = runTotals(runs, options.team ? 'team' : 'pitcher');
  const recorded = pitching.filter(entry => entry.pitch !== null);
  const p: PitchingStatistics = {
    G: pitched ? 1 : 0, GS: !pitched ? 0 : options.startingPitcherIds === null ? null : options.startingPitcherIds.some(own) ? 1 : 0,
    W: null, L: null, SV: null, outs: pitching.reduce((total, entry) => total + entry.outs, 0),
    BF: pitchingTurns.length, H: pitchingTurns.filter(entry => hitResults.includes(entry.result!)).length,
    R: earned.total, ER: earned.earned, pending: earned.pending,
    BB: options.pitchingWalks ?? (defense.some(entry => entry.result !== null &&
      walkResults.includes(entry.result) && entry.walkPitcherId === null) ? null :
      defense.filter(entry => entry.result !== null && walkResults.includes(entry.result) &&
        (options.team || own(entry.walkPitcherId === undefined ? entry.pitcherId : entry.walkPitcherId))).length),
    K: pitchingTurns.filter(entry => entry.result === 'strikeout' || entry.result === 'droppedThirdStrike').length,
    HBP: pitchingTurns.filter(entry => entry.result === 'hitByPitch').length,
    HR: pitchingTurns.filter(entry => entry.result === 'homeRun' || entry.result === 'insideParkHomeRun').length,
    pitches: recorded.length ? recorded.length : null,
    strikes: recorded.length ? recorded.filter(entry => entry.pitch !== 'ball').length : null,
    ERA: null, WHIP: null, CG: null, SHO: null,
  };
  if (!options.pitchingComplete) for (const key of statisticsMetrics.pitching.map(metric => metric.key)) p[key] = null;
  const fielding: FieldingStatistics = {
    G: options.positions.some(position => !['NA', 'DH'].includes(position)) ? 1 : 0, E: options.errors,
    PO: null, A: null, FLD: null, DP: null, TP: null, outs: null, CS: null, PB: null,
  };
  const credits = privateDefensiveCredits(state, side, options.team ? undefined : ids[0]);
  fielding.PO = credits.putouts; fielding.A = credits.assists;
  fielding.DP = credits.doublePlays; fielding.TP = credits.triplePlays; fielding.outs = credits.defendedOuts;
  if (!options.team && ![...options.positions, ...credits.positions].includes('C')) {
    fielding.PB = 0; fielding.CS = 0;
  }
  const caught = defense.filter(entry => entry.runnerAction === 'caught');
  if (!state.fieldingIncomplete && !defense.some(entry => entry.runnerId && entry.outs > 0 && entry.runnerAction === undefined) &&
      caught.every(entry => entry.defenders?.C && entry.fieldingCredit)) {
    fielding.CS = caught.filter(entry => {
      const catcher = entry.defenders!.C;
      return (options.team || own(catcher)) &&
        [...entry.fieldingCredit!.putouts, ...entry.fieldingCredit!.assists].includes(catcher);
    }).length;
  }
  if (!options.team && ids.length === 1 && state.finalReview) {
    const key = gameReportPlayerKey(state.seed, side, ids[0]);
    const evidence = state.finalReview.fielding[key];
    if (evidence) {
      if (evidence.putouts !== null) fielding.PO = evidence.putouts;
      if (evidence.assists !== null) fielding.A = evidence.assists;
      if (evidence.doublePlays !== null) fielding.DP = evidence.doublePlays;
      if (evidence.triplePlays !== null) fielding.TP = evidence.triplePlays;
      if (evidence.passedBalls !== null) fielding.PB = evidence.passedBalls;
    }
    if (p.G === 1) {
      p.W = state.finalReview.winner === key ? 1 : 0; p.L = state.finalReview.loser === key ? 1 : 0;
      p.SV = state.finalReview.saver === key ? 1 : 0;
      const pitchers = [...new Set(defense.filter(entry => entry.pitch !== null || entry.result !== null || entry.outs > 0).map(entry => entry.pitcherId))];
      p.CG = state.finished && p.GS === 1 && pitchers.length === 1 && pitchers[0] === ids[0] ? 1 : 0;
      p.SHO = p.CG === 1 && state.scores[side === 'home' ? 'away' : 'home'] === 0 ? 1 : 0;
    }
  }
  if (options.team && state.finalReview) {
    const review = state.finalReview;
    const other = side === 'home' ? 'away' : 'home';
    for (const [metric, decision] of [['W', review.winner], ['L', review.loser], ['SV', review.saver]] as const)
      p[metric] = decision ? ids.some(id => gameReportPlayerKey(state.seed, side, id) === decision) ? 1 : 0 :
        metric === 'W' && state.scores[side] > state.scores[other] ||
        metric === 'L' && state.scores[side] < state.scores[other] ? null : 0;
    const pitchers = [...new Set(defense.filter(entry => entry.pitch !== null || entry.result !== null || entry.outs > 0)
      .map(entry => entry.pitcherId))];
    p.CG = state.finished && pitchers.length === 1 && pitchers[0] !== null &&
      options.startingPitcherIds?.includes(pitchers[0]) ? 1 : 0;
    p.SHO = p.CG === 1 && state.scores[other] === 0 ? 1 : 0;
    for (const [metric, evidenceKey] of [['PO', 'putouts'], ['A', 'assists']] as const) {
      const values = ids.map(id => review.fielding[gameReportPlayerKey(state.seed, side, id)]?.[evidenceKey] ??
        privateDefensiveCredits(state, side, id)[evidenceKey]);
      fielding[metric] = values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    }
    const passed = ids.map(id => {
      const catcher = [...state.seed.lineups[side], ...state.lineups[side], ...(state.participants?.[side] ?? [])]
        .some(player => player.id === id && player.position === 'C') ||
        privateDefensiveCredits(state, side, id).positions.includes('C');
      return catcher ? review.fielding[gameReportPlayerKey(state.seed, side, id)]?.passedBalls ?? null : 0;
    });
    fielding.PB = passed.every(value => value !== null) ? passed.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  }
  return { batting, pitching: p, fielding };
}
export function statisticsGroupKey(game: StatisticsGame): string {
  const group: Array<string | number | null> = [game.sport, game.modality, game.category, game.eraBase];
  if (statisticsGameKind(game) !== 'official') group.push(statisticsGameKind(game));
  return JSON.stringify(group);
}
export function personalScorecardStatistics(state: PrivateState, identification: string,
  metadata: { kind: 'friendly' | 'private'; gameId: string; tournamentId: string; tournamentName: string; version: number }): StatisticsGame[] {
  const person = normalizeProfileIdentification(identification);
  const rules = state.seed.scoringRules;
  const sport = state.seed.sport ?? (rules === 'baseball' ? 'baseball' : rules?.startsWith('softball-') ? 'softball' : null);
  const modality = rules === 'baseball' ? 'Béisbol' : rules === 'softball-slowpitch' ? 'Lanzamiento lento' :
    rules === 'softball-fastpitch' ? 'Lanzamiento rápido' : rules === 'softball-modified' ? 'Lanzamiento modificado' : '';
  const eraBase = sport === 'baseball' ? 9 : sport === 'softball' ? 7 : null;
  const complete = scorecardSourceComplete(state);
  const participants = { home: scorecardParticipants(state, 'home'), away: scorecardParticipants(state, 'away') };
  const belongsToPerson = (player: PrivatePlayer) => normalizeProfileIdentification(player.identification ?? player.id) === person;
  const ambiguous = participants.home.filter(belongsToPerson).length + participants.away.filter(belongsToPerson).length > 1;
  return (['home', 'away'] as const).flatMap((side): StatisticsGame[] => {
    const ids = participants[side].filter(belongsToPerson).map(player => player.id);
    if (!ids.length) return [];
    if (ambiguous && side === 'away' && participants.home.some(belongsToPerson)) return [];
    const players = [...state.seed.lineups[side], ...state.lineups[side], ...(state.participants?.[side] ?? [])];
    const positions = [...new Set([...players.filter(player => ids.includes(player.id)).map(player => player.position),
      ...ids.flatMap(id => privateDefensiveCredits(state, side, id).positions)])];
    const defense = state.log.filter(entry => entry.side !== side);
    const unknownPitching = defense.some(entry => (entry.pitch || entry.result || entry.outs || entry.runs.length) && !entry.pitcherId) ||
      state.runAccounting.runs.some(run => run.offenseId !== side && run.pitcherId === null);
    const errorCounts = ids.map(id => privateFieldingStats(state, side, id).errors);
    const errors = errorCounts.some(value => value === null) ? null : errorCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const line = !complete || ambiguous ? null : calculateStatisticsRates(scorecardStatistics(state, side, ids, {
      team: false, positions, offenseId: side, pitchingComplete: !unknownPitching,
      startingPitcherIds: state.seed.lineups[side].filter(player => player.position === 'P').map(player => player.id),
      caughtStealing: state.log.some(entry => entry.side === side && entry.runnerId && entry.outs > 0 && entry.runnerAction === undefined) ? null :
        state.log.filter(entry => entry.side === side && entry.runnerAction === 'caught' && entry.runnerId && ids.includes(entry.runnerId)).length,
      errors,
    }), eraBase);
    const reason = ambiguous ? 'La cédula identifica a varios participantes; el creador debe corregir los vínculos antes de consultar las cifras.' :
      !sport || !modality ? 'Falta definir deporte o modalidad; este registro no se suma a los acumulados.' :
      !complete ? 'Anotación incompleta o sin jugadas respaldadas; no se suma a los acumulados.' :
      !state.finished ? 'En curso: cifras provisionales, fuera de los acumulados.' : '';
    const qualified = state.finished && reason === '';
    return [{ ...metadata, teamId: ambiguous ? 'unresolved' : side,
      teamName: ambiguous ? 'Vínculo por corregir' : state.seed.names[side],
      opponentName: ambiguous ? '' : state.seed.names[side === 'home' ? 'away' : 'home'],
      leagueId: '', leagueName: '', date: null, season: '', sport, modality, category: '', eraBase, public: false,
      positions: ambiguous ? [] : positions, line,
      status: state.finished ? 'final' : 'in_progress', qualification: qualified ? 'recorded' : state.finished ? 'excluded' : 'provisional',
      reason, result: qualified ? state.scores[side] === state.scores[side === 'home' ? 'away' : 'home'] ? 'tie' :
        state.scores[side] > state.scores[side === 'home' ? 'away' : 'home'] ? 'win' : 'loss' : null }];
  });
}
export function latestStatisticsGames(games: readonly StatisticsGame[]): StatisticsGame[] {
  const latest = new Map<string, StatisticsGame>();
  for (const game of games) {
    const key = JSON.stringify([game.tournamentId, game.gameId, game.teamId]);
    const previous = latest.get(key);
    if (!previous || previous.version < game.version) latest.set(key, game);
    else if (previous.version === game.version && JSON.stringify(previous) !== JSON.stringify(game))
      throw new Error('Hay dos registros distintos con la misma versión oficial.');
  }
  return [...latest.values()];
}
export function aggregateStatistics(games: readonly StatisticsGame[]): StatisticsLine | null {
  const rows = latestStatisticsGames(games).filter(game => ['official', 'recorded'].includes(game.qualification) && game.line !== null);
  if (!rows.length) return null;
  if (new Set(rows.map(statisticsGroupKey)).size !== 1) throw new Error('No se mezclan deportes, modalidades, categorías o bases del PCL.');
  const first = rows[0].line!;
  const result = structuredClone(first);
  for (const group of ['batting', 'pitching', 'fielding'] as const) {
    for (const metric of statisticsMetrics[group]) {
      const values = rows.map(row => {
        const values: Record<string, number | null> = row.line![group];
        return values[metric.key];
      });
      const target: Record<string, number | null> = result[group];
      target[metric.key] = values.some(value => value === null) ? null : values.reduce<number>((total, value) => total + value!, 0);
    }
  }
  return calculateStatisticsRates(result, rows[0].eraBase);
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export function isStatisticsLine(value: unknown): value is StatisticsLine {
  return record(value) && (['batting', 'pitching', 'fielding'] as const).every(group => {
    const values = value[group];
    return record(values) && Object.keys(values).length === statisticsMetrics[group].length &&
      statisticsMetrics[group].every(metric => values[metric.key] === null ||
        typeof values[metric.key] === 'number' && Number.isFinite(values[metric.key]) && Number(values[metric.key]) >= 0 &&
          (metric.precision !== 0 || Number.isSafeInteger(values[metric.key])));
  });
}
function validGame(value: unknown): value is StatisticsGame {
  return record(value) && ['gameId', 'tournamentId', 'tournamentName', 'teamId', 'teamName', 'opponentName',
    'leagueId', 'leagueName', 'season', 'modality', 'category', 'reason'].every(key => typeof value[key] === 'string') &&
    (value.date === null || isCalendarDate(value.date)) && (value.sport === null || value.sport === 'baseball' || value.sport === 'softball') &&
    (value.eraBase === null || value.eraBase === 7 || value.eraBase === 9) && isOfficialGameStatus(value.status) &&
    typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version >= 0 &&
    (value.kind === undefined || ['official', 'friendly', 'private'].includes(String(value.kind))) &&
    (value.kind === undefined || value.kind === 'official' || value.public === false) &&
    ['official', 'recorded', 'provisional', 'excluded'].includes(String(value.qualification)) &&
    typeof value.public === 'boolean' && Array.isArray(value.positions) && value.positions.every(item => typeof item === 'string') &&
    (value.line === null || isStatisticsLine(value.line)) && (value.result === null || ['win', 'loss', 'tie'].includes(String(value.result))) &&
    (!['official', 'recorded'].includes(String(value.qualification)) || value.status === 'final' && value.sport !== null &&
      value.modality !== '' && value.eraBase !== null && isStatisticsLine(value.line)) &&
    (value.qualification !== 'recorded' || value.kind === 'friendly' || value.kind === 'private') &&
    (value.qualification !== 'official' || value.kind === undefined || value.kind === 'official');
}
export function readStatisticsSnapshot(value: unknown, accountId: string, mode: StatisticsSnapshot['mode'],
  source: StatisticsSnapshot['source']): StatisticsSnapshot {
  if (!record(value) || value.accountId !== accountId || value.mode !== mode || value.source !== source ||
      typeof value.identityVerified !== 'boolean' || typeof value.analysisAllowed !== 'boolean' ||
      !Array.isArray(value.games) || !value.games.every(validGame))
    throw new Error('Las estadísticas recibidas no corresponden a esta cuenta o contienen datos inválidos.');
  if (value.players !== undefined && (mode !== 'team' || !Array.isArray(value.players) || !value.players.every(player =>
    record(player) && typeof player.id === 'string' && /^player-[a-f0-9]{64}$/.test(player.id) &&
    (player.name === null || typeof player.name === 'string' && player.name.trim() !== '') &&
    typeof player.activeTournament === 'boolean' && validGame(player.game))))
    throw new Error('Las estadísticas de los jugadores del equipo no son válidas.');
  return { accountId, mode, source, identityVerified: value.identityVerified, analysisAllowed: value.analysisAllowed,
    games: latestStatisticsGames(value.games), ...(Array.isArray(value.players) ? { players: value.players } : {}) };
}
