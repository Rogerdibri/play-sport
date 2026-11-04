export type RunClassification = 'earned' | 'unearned' | 'pending';
export type RunEvidence = { errorOuts?: number };
export type RunReview = {
  eventId: number;
  runnerId: string | null;
  team: 'earned' | 'unearned';
  pitcher: 'earned' | 'unearned';
  note: string;
};
type Responsibility = {
  pitcherId: string | null;
  lostAtEntry: string[];
  unknownAtEntry: number;
  extraLife: boolean;
  extraLifeForPitcher: boolean;
  affectedAdvance: boolean;
  uncertain: boolean;
  virtualOutId: string | null;
};
export type AccountedRun = {
  eventId: number;
  offenseId: string;
  runnerId: string | null;
  pitcherId: string | null;
  count: number;
  team: RunClassification;
  pitcher: RunClassification;
  reviewed: boolean;
  note: string;
};
export type RunAccounting = {
  half: string | null;
  lostOuts: number;
  lostOutIds: string[];
  unknownOuts: number;
  activePitcher: string | null;
  entry: { lostAtEntry: string[]; unknownAtEntry: number };
  runners: Record<string, Responsibility>;
  extraChances: Record<string, string>;
  atBat: { batterId: string; pitcherId: string | null; owner: Responsibility } | null;
  runs: AccountedRun[];
};
export type RunAccountingEvent = {
  eventId: number;
  half: string;
  offenseId: string;
  pitcherId: string | null;
  outsBefore: number;
  batterId: string | null;
  plateCompleted: boolean;
  reachedOnError: boolean;
  basesBefore: ReadonlyArray<string | null>;
  basesAfter: ReadonlyArray<string | null>;
  scored: string[];
  totalRuns: number;
  misplay?: 'error' | 'passedBall';
  errorOuts?: number;
  unknownAdvance?: boolean;
  homeRun?: boolean;
  uncertainPlay?: boolean;
  prolongedBatter?: boolean;
  replacement?: { outgoing: string; incoming: string };
  ballsBefore?: number;
  strikesBefore?: number;
  walk?: boolean;
  eliminated?: string[];
};

export function createRunAccounting(): RunAccounting {
  return {
    half: null, lostOuts: 0, lostOutIds: [], unknownOuts: 0, activePitcher: null,
    entry: { lostAtEntry: [], unknownAtEntry: 0 },
    runners: {}, extraChances: {}, atBat: null, runs: []
  };
}

export function validRunEvidence(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const outs = 'errorOuts' in value ? value.errorOuts : undefined;
  return outs === undefined || typeof outs === 'number' && Number.isInteger(outs) && outs >= 0 && outs <= 3;
}

export function validRunReview(value: unknown): value is RunReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return 'eventId' in value && typeof value.eventId === 'number' && Number.isInteger(value.eventId) && value.eventId >= 1 &&
    'runnerId' in value && (value.runnerId === null || typeof value.runnerId === 'string' && value.runnerId.length > 0) &&
    'team' in value && (value.team === 'earned' || value.team === 'unearned') &&
    'pitcher' in value && (value.pitcher === 'earned' || value.pitcher === 'unearned') &&
    'note' in value && typeof value.note === 'string' && value.note.trim().length > 0;
}

export function reviewAccountedRun(current: RunAccounting, review: RunReview): RunAccounting {
  if (!validRunReview(review)) throw new Error('La revisión de la carrera requiere una clasificación y su justificación.');
  const index = current.runs.findIndex((run) => run.eventId === review.eventId && run.runnerId === review.runnerId);
  if (index < 0) throw new Error('No se encontró la carrera que deseas revisar.');
  const next = structuredClone(current);
  next.runs[index] = {
    ...next.runs[index], team: review.team, pitcher: review.pitcher,
    reviewed: true, note: review.note.trim()
  };
  return next;
}

// Only conclusive cases are classified automatically; ambiguous advances need the scorer's reconstruction.
export function accountRuns(current: RunAccounting, event: RunAccountingEvent): RunAccounting {
  if (!validRunEvidence(event)) throw new Error('Indica entre cero y tres outs evitados por el error.');
  if (event.errorOuts !== undefined && event.misplay !== 'error') {
    throw new Error('Los outs evitados solo corresponden a un error defensivo.');
  }
  if (event.errorOuts !== undefined && event.outsBefore + event.errorOuts > 3) {
    throw new Error('Los outs evitados no pueden superar los outs que faltaban en la entrada.');
  }
  const next = structuredClone(current);
  if (next.half !== event.half) {
    Object.assign(next, createRunAccounting(), { half: event.half, runs: next.runs });
  }
  if (next.activePitcher !== event.pitcherId) {
    next.activePitcher = event.pitcherId;
    next.entry = { lostAtEntry: [...next.lostOutIds], unknownAtEntry: next.unknownOuts };
  }
  const responsibility = (uncertain = false): Responsibility => ({
    pitcherId: event.pitcherId, ...next.entry,
    extraLife: false, extraLifeForPitcher: false, affectedAdvance: false, uncertain, virtualOutId: null
  });
  if (event.batterId) {
    if (!next.atBat || next.atBat.batterId !== event.batterId) {
      next.atBat = { batterId: event.batterId, pitcherId: event.pitcherId, owner: responsibility() };
    } else if (next.atBat.pitcherId !== event.pitcherId) {
      const balls = event.ballsBefore;
      const strikes = event.strikesBefore;
      if (balls === undefined || strikes === undefined) next.atBat.owner = responsibility(true);
      else if (!(balls === 3 || balls === 2 && strikes < 2)) next.atBat.owner = responsibility();
      next.atBat.pitcherId = event.pitcherId;
    }
  }
  for (const id of event.basesBefore) {
    if (id && !next.runners[id]) next.runners[id] = responsibility(true);
  }
  if (event.replacement) {
    const { outgoing, incoming } = event.replacement;
    next.runners[incoming] = next.runners[outgoing] ?? responsibility(true);
    delete next.runners[outgoing];
  }
  const priorChance = event.batterId ? next.extraChances[event.batterId] : undefined;
  let newOutIds: string[] = [];
  if (event.misplay === 'error') {
    if (event.errorOuts === undefined) next.unknownOuts += 1;
    else {
      if (event.errorOuts > 1) next.unknownOuts += 1;
      const alreadyOut = Boolean(priorChance) || !event.plateCompleted && event.basesBefore.some((id, base) =>
        id && event.basesAfter[base] !== id && next.runners[id]?.virtualOutId);
      newOutIds = Array.from({ length: Math.max(0, Math.min(1, event.errorOuts) - (alreadyOut ? 1 : 0)) },
        (_, index) => `${event.eventId}:${index}`);
      next.lostOutIds.push(...newOutIds);
    }
  }
  next.lostOuts = next.lostOutIds.length;
  if (event.prolongedBatter && event.batterId && !priorChance && newOutIds[0]) {
    next.extraChances[event.batterId] = newOutIds[0];
  }
  if (event.unknownAdvance) next.unknownOuts += 1;
  if (event.plateCompleted && event.batterId) {
    const owner = event.walk && next.atBat ? next.atBat.owner : responsibility(Boolean(event.uncertainPlay));
    next.runners[event.batterId] = {
      ...owner,
      pitcherId: event.uncertainPlay ? null : owner.pitcherId,
      extraLife: event.reachedOnError || Boolean(priorChance),
      extraLifeForPitcher: event.reachedOnError || Boolean(priorChance && !owner.lostAtEntry.includes(priorChance)),
      virtualOutId: priorChance ?? (event.reachedOnError ? newOutIds[0] ?? null : null)
    };
    delete next.extraChances[event.batterId];
    next.atBat = null;
  }
  const remaining = new Set([...event.basesAfter, ...event.scored].filter((id): id is string => id !== null));
  if (event.misplay || event.unknownAdvance) {
    event.basesBefore.forEach((id, base) => {
      if (id && remaining.has(id) && event.basesAfter[base] !== id && next.runners[id]) {
        next.runners[id].affectedAdvance = true;
        if (event.misplay === 'error' && !event.plateCompleted && event.errorOuts === 1) {
          next.runners[id].extraLife = true;
          next.runners[id].extraLifeForPitcher = true;
          next.runners[id].virtualOutId ??= newOutIds[0] ?? null;
        }
      }
    });
  }
  if (event.homeRun) {
    for (const id of remaining) {
      if (next.runners[id]) next.runners[id].affectedAdvance = false;
    }
  }
  for (const id of remaining) {
    if (!next.runners[id]) next.runners[id] = responsibility(true);
  }
  const classify = (runner: Responsibility, forPitcher: boolean): RunClassification => {
    const lostOuts = forPitcher ? next.lostOutIds.filter((id) => !runner.lostAtEntry.includes(id)).length : next.lostOuts;
    const unknownOuts = next.unknownOuts - (forPitcher ? runner.unknownAtEntry : 0);
    if (runner.extraLife && (!forPitcher || runner.extraLifeForPitcher)) return 'unearned';
    if (event.outsBefore + lostOuts >= 3) {
      const newLostOuts = newOutIds.length;
      if (newLostOuts > 0 && !event.reachedOnError && event.outsBefore + lostOuts - newLostOuts < 3) return 'pending';
      return 'unearned';
    }
    if (runner.uncertain || runner.affectedAdvance || unknownOuts > 0 || event.uncertainPlay) return 'pending';
    return 'earned';
  };
  for (const id of event.scored) {
    const runner = next.runners[id];
    next.runs.push({
      eventId: event.eventId, offenseId: event.offenseId, runnerId: id, pitcherId: runner.pitcherId,
      count: 1, team: classify(runner, false), pitcher: classify(runner, true),
      reviewed: false, note: ''
    });
  }
  const anonymous = event.totalRuns - event.scored.length;
  if (anonymous > 0) next.runs.push({
    eventId: event.eventId, offenseId: event.offenseId, runnerId: null, pitcherId: null,
    count: anonymous, team: 'pending', pitcher: 'pending', reviewed: false,
    note: 'Carrera sin corredor identificado; falta reconstruir su responsabilidad.'
  });
  for (const id of event.eliminated ?? []) {
    const token = next.runners[id]?.virtualOutId;
    if (token) next.lostOutIds = next.lostOutIds.filter((out) => out !== token);
  }
  next.lostOuts = next.lostOutIds.length;
  for (const id of Object.keys(next.runners)) {
    if (!event.basesAfter.includes(id)) delete next.runners[id];
  }
  return next;
}

export function runTotals(runs: ReadonlyArray<AccountedRun>, scope: 'team' | 'pitcher') {
  return runs.reduce((totals, run) => {
    totals[run[scope]] += run.count;
    totals.total += run.count;
    return totals;
  }, { earned: 0, unearned: 0, pending: 0, total: 0 });
}
