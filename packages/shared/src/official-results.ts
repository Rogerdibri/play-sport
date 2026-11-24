import { isGameProtest, type GameProtest } from './game-protest.js';
import { isOfficialGameStatus, type OfficialGameSummary, type OfficialGameStatus } from './official-games.js';
import { isScorecardState, type PrivateState } from './scorecard.js';
import { isGameSuspension, type GameSuspension } from './game-suspension.js';

export type OfficialResultGame = Pick<OfficialGameSummary, 'homeTeamId' | 'awayTeamId' | 'homeScore' | 'awayScore' | 'status' | 'protest' | 'details'>;
export function officialGameResult(game: OfficialResultGame): {
  label: string; source: 'pending' | 'score' | 'technical'; winnerTeamId: string | null; loserTeamId: string | null;
} {
  if (game.status !== 'final') return {
    label: game.status === 'suspended' ? 'Suspendido · Nueva fecha pendiente' :
      game.status === 'protested' ? 'Bajo protesta · Pendiente de mesa técnica' : 'Resultado pendiente',
    source: 'pending', winnerTeamId: null, loserTeamId: null
  };
  const resolution = game.protest?.resolution;
  if (resolution) return {
    label: 'Resultado determinado por mesa técnica', source: 'technical',
    winnerTeamId: resolution.winnerTeamId, loserTeamId: resolution.loserTeamId
  };
  if (game.protest) throw new Error('Un juego finalizado bajo protesta requiere la resolución de mesa técnica.');
  const winnerTeamId = game.homeScore === game.awayScore ? null : game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
  return {
    label: winnerTeamId ? 'Resultado por marcador' : 'Empate', source: 'score', winnerTeamId,
    loserTeamId: winnerTeamId === null ? null : winnerTeamId === game.homeTeamId ? game.awayTeamId : game.homeTeamId
  };
}
export function officialGameNames(game: Pick<OfficialResultGame, 'homeTeamId' | 'awayTeamId' | 'details'>): Record<string, string> {
  return { [game.homeTeamId]: game.details?.homeTeamName ?? game.homeTeamId, [game.awayTeamId]: game.details?.awayTeamName ?? game.awayTeamId };
}
export type OfficialObservation = {
  status: OfficialGameStatus; officialVersion: number; protest?: GameProtest; suspension?: GameSuspension; scorecard: PrivateState;
  inning: number; outs: number; balls: number; strikes: number; homeScore: number; awayScore: number; lastPlay: string;
};

export function readOfficialInterruptionArchive(value: unknown) {
  if (!value || typeof value !== 'object' || !('suspension' in value) || !isGameSuspension(value.suspension) ||
      !('lineup' in value) || !value.lineup || typeof value.lineup !== 'object' || !('teams' in value.lineup) ||
      !value.lineup.teams || typeof value.lineup.teams !== 'object' || !('homeTeamId' in value.lineup.teams) ||
      !('awayTeamId' in value.lineup.teams) || typeof value.lineup.teams.homeTeamId !== 'string' ||
      typeof value.lineup.teams.awayTeamId !== 'string') throw new Error('La anotación archivada contiene datos inválidos.');
  return { suspension: value.suspension, observation: readOfficialObservation(value),
    homeTeamId: value.lineup.teams.homeTeamId, awayTeamId: value.lineup.teams.awayTeamId };
}
export function readOfficialObservation(value: unknown): OfficialObservation {
  const record = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item);
  if (!record(value) || !record(value.state) || !record(value.playByPlay) || !isScorecardState(value.playByPlay.scorecard) ||
      !isOfficialGameStatus(value.state.status) || typeof value.state.lastPlay !== 'string' ||
      !(value.state.protest === undefined || isGameProtest(value.state.protest)) ||
      !(value.state.suspension === undefined || isGameSuspension(value.state.suspension)) ||
      (value.state.status === 'suspended' && (!isGameSuspension(value.state.suspension) || value.state.suspension.rescheduled !== null)) ||
      (value.state.status === 'protested' && (!value.state.protest || value.state.protest.resolution !== null)) ||
      (value.state.protest && value.state.status !== 'protested' && (value.state.status !== 'final' || !value.state.protest.resolution))) {
    throw new Error('El resultado oficial contiene datos inválidos. Actualiza el partido.');
  }
  const state = value.state;
  const number = (key: string) => {
    const item = state[key];
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) throw new Error('El marcador oficial contiene datos inválidos.');
    return item;
  };
  return {
    status: value.state.status, officialVersion: number('officialVersion'), scorecard: value.playByPlay.scorecard,
    inning: number('inning'), outs: number('outs'), balls: number('balls'), strikes: number('strikes'),
    homeScore: number('homeScore'), awayScore: number('awayScore'), lastPlay: value.state.lastPlay,
    ...(value.state.protest ? { protest: value.state.protest } : {}),
    ...(value.state.suspension ? { suspension: value.state.suspension } : {})
  };
}
