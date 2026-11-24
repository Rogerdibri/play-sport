export type GameProtest = {
  teamId: string; reason: string; declaredAt: string; declaredBy: string;
  moment: { inning: number; outs: number; balls: number; strikes: number; homeScore: number; awayScore: number; officialVersion: number; lastPlay: string };
  resolution: null | {
    winnerTeamId: string; loserTeamId: string; reason: string; recordReference: string;
    recordedAt: string; recordedBy: string;
  };
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function isGameProtest(value: unknown): value is GameProtest {
  if (!record(value) || !text(value.teamId) || !text(value.reason, 2000) || !text(value.declaredBy) ||
      !date(value.declaredAt) || !record(value.moment)) return false;
  const moment = value.moment;
  if (!['inning', 'outs', 'balls', 'strikes', 'homeScore', 'awayScore', 'officialVersion'].every(key =>
    typeof moment[key] === 'number' && Number.isSafeInteger(moment[key]) && moment[key] >= 0) || !text(moment.lastPlay, 2000)) return false;
  const resolution = value.resolution;
  return resolution === null || record(resolution) && text(resolution.winnerTeamId) && text(resolution.loserTeamId) &&
    resolution.winnerTeamId !== resolution.loserTeamId && text(resolution.reason, 4000) &&
    text(resolution.recordReference, 500) && text(resolution.recordedBy) && date(resolution.recordedAt);
}
