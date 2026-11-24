import type { PrivateSeed, PrivateState, Side } from './scorecard.js';

export type FinalPitchingEvidence = {
  pitches: number | null;
  strikes: number | null;
  wildPitches: number | null;
  balks: number | null;
};
export type FinalFieldingEvidence = {
  putouts: number | null;
  assists: number | null;
  doublePlays: number | null;
  triplePlays: number | null;
  passedBalls: number | null;
};
export type GameFinalReview = {
  confirmed: true;
  rulesReference: string;
  note: string;
  winner: string | null;
  loser: string | null;
  saver: string | null;
  bestBatter: string | null;
  mvp: string | null;
  pitching: Record<string, FinalPitchingEvidence>;
  fielding: Record<string, FinalFieldingEvidence>;
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => value === null ||
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1000000;
const playerKey = (value: unknown) => value === null ||
  typeof value === 'string' && /^(home|away):\d+$/.test(value);
export function isGameFinalReview(value: unknown): value is GameFinalReview {
  if (!record(value) || value.confirmed !== true ||
      typeof value.rulesReference !== 'string' || !value.rulesReference.trim() || value.rulesReference.length > 500 ||
      typeof value.note !== 'string' || value.note.length > 2000 ||
      !['winner', 'loser', 'saver', 'bestBatter', 'mvp'].every(key => playerKey(value[key])) ||
      !record(value.pitching) || !record(value.fielding) ||
      Object.keys(value).some(key => !['confirmed', 'rulesReference', 'note', 'winner', 'loser', 'saver', 'bestBatter', 'mvp', 'pitching', 'fielding'].includes(key))) return false;
  return Object.entries(value.pitching).every(([key, evidence]) =>
    playerKey(key) && record(evidence) &&
    ['pitches', 'strikes', 'wildPitches', 'balks'].every(metric => count(evidence[metric])) &&
    (evidence.strikes === null || evidence.pitches !== null && Number(evidence.strikes) <= Number(evidence.pitches))) &&
    Object.entries(value.fielding).every(([key, evidence]) => playerKey(key) && record(evidence) &&
      ['putouts', 'assists', 'doublePlays', 'triplePlays', 'passedBalls'].every(metric => count(evidence[metric])));
}
export function gameReportPlayerKey(seed: PrivateSeed, side: Side, id: string): string {
  const index = seed.rosters[side].findIndex(player => player.id === id);
  if (index < 0) throw new Error('El jugador del resumen no pertenece al roster del partido.');
  return `${side}:${index}`;
}
export function gameReportPlayer(seed: PrivateSeed, key: string) {
  const match = /^(home|away):(\d+)$/.exec(key);
  if (!match) return null;
  const side: Side = match[1] === 'home' ? 'home' : 'away';
  const player = seed.rosters[side][Number(match[2])];
  return player ? { side, player } : null;
}
export function gameReportPitcherAppeared(state: PrivateState, key: string): boolean {
  const member = gameReportPlayer(state.seed, key);
  return member !== null && state.log.some(entry => entry.side !== member.side && entry.pitcherId === member.player.id &&
    (entry.pitch !== null || entry.result !== null || entry.outs > 0));
}
export function finalReviewIssue(state: PrivateState, review: GameFinalReview): string | null {
  if (!isGameFinalReview(review)) return 'Completa el reglamento y confirma la revisión del cierre.';
  const participant = (key: string) => {
    const member = gameReportPlayer(state.seed, key);
    if (!member || member.player.id.startsWith('unknown:')) return null;
    const { side, player } = member;
    const appeared = state.seed.lineups[side].some(entry => entry.id === player.id) ||
      state.participants?.[side].some(entry => entry.id === player.id) ||
      state.lineups[side].some(entry => entry.id === player.id) ||
      state.log.some(entry => [entry.batterId, entry.runnerId, entry.pitcherId, ...entry.runs].includes(player.id) ||
        Object.values(entry.defenders ?? {}).includes(player.id));
    return appeared ? member : null;
  };
  for (const key of [review.winner, review.loser, review.saver, review.bestBatter, review.mvp,
    ...Object.keys(review.pitching), ...Object.keys(review.fielding)]) {
    if (key !== null && !participant(key)) return 'Solo pueden figurar jugadores con participación registrada en este partido.';
  }
  const pitcher = (key: string) => {
    return participant(key) && gameReportPitcherAppeared(state, key);
  };
  for (const key of [review.winner, review.loser, review.saver, ...Object.keys(review.pitching)])
    if (key !== null && !pitcher(key)) return 'Las decisiones y los registros de pitcheo requieren una actuación de pitcher registrada.';
  const tie = state.scores.home === state.scores.away;
  if (tie && (review.winner || review.loser || review.saver)) return 'Un empate no adjudica victoria, derrota ni salvamento a pitchers.';
  if (!tie) {
    const winnerSide: Side = state.scores.home > state.scores.away ? 'home' : 'away';
    const missing = [review.winner, review.loser].some(key => !key);
    if (missing && (!review.note.trim() || state.seed.rosters[winnerSide].some(player =>
        pitcher(gameReportPlayerKey(state.seed, winnerSide, player.id))) && !review.winner ||
        state.seed.rosters[winnerSide === 'home' ? 'away' : 'home'].some(player =>
          pitcher(gameReportPlayerKey(state.seed, winnerSide === 'home' ? 'away' : 'home', player.id))) && !review.loser))
      return 'Confirma el pitcher ganador y el perdedor. Si faltan sus actuaciones, explica la ausencia sin inventar decisiones.';
    if (review.winner && participant(review.winner)?.side !== winnerSide ||
        review.loser && participant(review.loser)?.side === winnerSide)
      return 'El pitcher ganador y el perdedor deben corresponder al resultado de sus equipos.';
    if (review.saver && (review.saver === review.winner || participant(review.saver)?.side !== winnerSide))
      return 'El salvamento corresponde a otro pitcher del equipo ganador.';
    if (review.saver) {
      const id = participant(review.saver)!.player.id;
      const appearance = state.log.filter(entry => entry.side !== winnerSide &&
        (entry.pitch !== null || entry.result !== null || entry.outs > 0));
      if (appearance.at(-1)?.pitcherId !== id ||
          appearance.filter(entry => entry.pitcherId === id).reduce((sum, entry) => sum + entry.outs, 0) === 0)
        return 'El salvador debe terminar el trabajo de pitcheo del equipo ganador y registrar al menos un out.';
    }
  }
  if (review.bestBatter) {
    const member = participant(review.bestBatter)!;
    if (!state.log.some(entry => entry.side === member.side && entry.batterId === member.player.id && entry.result !== null))
      return 'El mejor bate debe tener una aparición al plato registrada.';
  }
  if (state.log.some(entry => entry.result !== null) && (!review.bestBatter || !review.mvp) && !review.note.trim())
    return 'Confirma mejor bate y MVP, o explica por qué el reglamento no adjudica esos reconocimientos.';
  for (const [key, evidence] of Object.entries(review.pitching)) {
    const id = participant(key)!.player.id;
    const recorded = state.log.filter(entry => entry.pitcherId === id && entry.pitch !== null);
    if (evidence.pitches !== null && evidence.pitches < recorded.length ||
        evidence.strikes !== null && evidence.strikes < recorded.filter(entry => entry.pitch !== 'ball').length)
      return 'El conteo confirmado no puede ser menor que los lanzamientos ya registrados.';
    const entries = state.log.filter(entry => entry.pitcherId === id);
    const wildMinimum = Math.max(entries.filter(entry => entry.thirdStrikeCause === 'wild').length,
      entries.some(entry => entry.runnerAction === 'wild') ? 1 : 0);
    if (evidence.wildPitches !== null && evidence.wildPitches < wildMinimum ||
        evidence.balks === 0 && entries.some(entry => entry.runnerAction === 'balk'))
      return 'Los wild pitches o balks confirmados no pueden contradecir las incidencias registradas.';
    if ((state.seed.sport === 'softball' || state.seed.scoringRules?.startsWith('softball')) &&
        evidence.balks !== null && evidence.balks > 0)
      return 'El balk de béisbol no se aplica al softbol; las infracciones se registran según su modalidad.';
  }
  for (const side of ['home', 'away'] as const) {
    const members = state.seed.rosters[side].map(player => ({ player, key: gameReportPlayerKey(state.seed, side, player.id) }))
      .filter(member => participant(member.key));
    if (members.length && members.every(member => review.fielding[member.key]?.putouts !== null &&
        review.fielding[member.key]?.putouts !== undefined)) {
      const assigned = members.reduce((sum, member) => sum + review.fielding[member.key].putouts!, 0);
      const outs = state.log.filter(entry => entry.side !== side).reduce((sum, entry) => sum + entry.outs, 0);
      if (assigned !== outs) return 'Los outs realizados confirmados deben sumar los outs defensivos del equipo.';
    }
    const entries = state.log.filter(entry => entry.side !== side);
    for (const member of members) {
      const evidence = review.fielding[member.key];
      if (!evidence) continue;
      const defendedOuts = entries.reduce((sum, entry) => sum + entry.outs, 0);
      if (evidence.putouts !== null && evidence.putouts > defendedOuts)
        return 'Un jugador no puede realizar más outs que los registrados por su equipo.';
      const caught = entries.filter(entry => entry.defenders?.C === member.player.id);
      if (evidence.passedBalls !== null && evidence.passedBalls > 0 && !caught.length &&
          ![...state.seed.lineups[side], ...state.lineups[side], ...(state.participants?.[side] ?? [])]
            .some(player => player.id === member.player.id && player.position === 'C'))
        return 'Las pelotas pasadas corresponden a un jugador con participación registrada como receptor.';
      const passedMinimum = Math.max(caught.filter(entry => entry.thirdStrikeCause === 'passed').length,
        caught.some(entry => entry.runnerAction === 'passed') ? 1 : 0);
      if (evidence.passedBalls !== null && evidence.passedBalls < passedMinimum)
        return 'Las pelotas pasadas confirmadas no pueden ser menores que las incidencias registradas del receptor.';
      const knownOuts = entries.filter(entry => entry.outs > 0).every(entry => entry.fieldingCredit !== undefined);
      const knownAssists = knownOuts && entries.every(entry =>
        !(entry.errors?.length || entry.legacyError || entry.result === 'error') || entry.fieldingCredit !== undefined);
      for (const [field, source, complete] of [
        ['putouts', 'putouts', knownOuts], ['assists', 'assists', knownAssists]
      ] as const) {
        const recorded = entries.reduce((sum, entry) =>
          sum + (entry.fieldingCredit?.[source].filter(id => id === member.player.id).length ?? 0), 0);
        if (evidence[field] !== null && (evidence[field]! < recorded || complete && evidence[field] !== recorded))
          return 'Los créditos confirmados no coinciden con los outs y asistencias registrados; corrige primero la jugada.';
      }
      if (evidence.doublePlays !== null && evidence.doublePlays > entries.filter(entry => entry.outs === 2).length ||
          evidence.triplePlays !== null && evidence.triplePlays > entries.filter(entry => entry.outs === 3).length)
        return 'La participación en dobles o triples jugadas no puede superar las jugadas registradas del equipo.';
      for (const [metric, outs] of [['doublePlays', 2], ['triplePlays', 3]] as const) {
        const recorded = entries.filter(entry => entry.outs === outs &&
          [...(entry.fieldingCredit?.putouts ?? []), ...(entry.fieldingCredit?.assists ?? [])].includes(member.player.id)).length;
        if (evidence[metric] !== null && (evidence[metric]! < recorded || knownOuts && evidence[metric] !== recorded))
          return 'La participación confirmada en dobles o triples jugadas no coincide con los créditos registrados.';
      }
    }
  }
  return null;
}
