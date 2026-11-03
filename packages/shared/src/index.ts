export enum UserRole { Athlete = 'athlete', Organizer = 'organizer', Coach = 'coach', Admin = 'admin', Fan = 'fan' }
export enum SportType { Football = 'football', Basketball = 'basketball', Baseball = 'baseball', Volleyball = 'volleyball', Other = 'other' }
export interface League { id: string; name: string; sport: SportType; country?: string; }
export interface Team { id: string; name: string; leagueId?: string; }
export interface PlayerProfile { id: string; userId: string; displayName: string; position?: string; teamId?: string; }
export interface Game { id: string; homeTeamId: string; awayTeamId: string; startsAt: string; status: 'scheduled' | 'live' | 'finished'; }
export interface LiveScoreState { gameId: string; homeScore: number; awayScore: number; period?: string; updatedAt: string; }
