export * from './game-personnel.js';
export * from './earned-runs.js';
export * from './scorecard.js';
export * from './platform.js';

export enum UserRole { Athlete = 'athlete', Organizer = 'organizer', Coach = 'coach', Admin = 'admin', Fan = 'fan' }
export enum SportType { Football = 'football', Basketball = 'basketball', Baseball = 'baseball', Volleyball = 'volleyball', Other = 'other' }
export interface League { id: string; name: string; sport: SportType; country?: string; }
export interface Team { id: string; name: string; leagueId?: string; }
export interface PlayerProfile { id: string; userId: string; displayName: string; position?: string; teamId?: string; }
export interface Game { id: string; homeTeamId: string; awayTeamId: string; startsAt: string; status: 'scheduled' | 'live' | 'finished'; }
export interface LiveScoreState { gameId: string; homeScore: number; awayScore: number; period?: string; updatedAt: string; }

export const lineupFieldPositions: readonly string[] = [
  'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF4', 'SF', 'DH', 'NA'
];

export function availableLineupPositions(
  entries: ReadonlyArray<{ identificationNumber: string; fieldPosition: string }>,
  editingIdentificationNumber: string
): string[] {
  const occupied = new Set(entries
    .filter((entry) => entry.identificationNumber !== editingIdentificationNumber)
    .map((entry) => entry.fieldPosition));
  return lineupFieldPositions.filter((position) => position === 'NA' || !occupied.has(position));
}

export function assignBattingOrder<T extends { lineupRole: string; battingOrder: number | null }>(
  entries: T[]
): T[] {
  const batters = entries.filter((entry) => entry.lineupRole !== 'FLEX');
  const flex = entries.filter((entry) => entry.lineupRole === 'FLEX');
  return [
    ...batters.map((entry, index) => ({ ...entry, battingOrder: index + 1 })),
    ...flex.map((entry) => ({ ...entry, battingOrder: null }))
  ];
}
