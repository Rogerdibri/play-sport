export * from './accounts.js';
export * from './account-access.js';
export * from './role-validity.js';
export * from './organizer-capacity.js';
export * from './organizer-plans.js';
export * from './organizer-capacity-examples.js';
export * from './manager-access.js';
export * from './scorekeeper-access.js';
export * from './sports-sheet.js';
export * from './sports-statistics.js';
export * from './game-final-review.js';
export * from './game-report.js';
export * from './sports-statistics-examples.js';
export * from './sports-career.js';
export * from './favorites.js';
export * from './person-identity.js';
export * from './wallet.js';
export * from './marketplace.js';
export * from './game-chat.js';
export * from './game-clock.js';
export * from './visual-theme.js';
export * from './game-personnel.js';
export * from './roster.js';
export * from './roster-rules.js';
export * from './earned-runs.js';
export * from './scorecard.js';
export * from './platform.js';
export * from './venezuela.js';
export * from './events-calendar.js';

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
export * from './demo-profile.js';
export * from './registration.js';
export * from './registration-client.js';
export * from './demo-calendar.js';
export * from './standings.js';
export * from './demo-standings.js';
export * from './official-games.js';
export * from './assigned-game-dashboard.js';
export * from './game-protest.js';
export * from './official-standings.js';
export * from './official-results.js';
export * from './friendly-games.js';
export * from './game-suspension.js';
export * from './team-sheet-reader.js';
export * from './institutional-logos.js';
export * from './tournaments.js';
export * from './player-context.js';
export * from './player-demo-context.js';
export * from './account-scorecards.js';
