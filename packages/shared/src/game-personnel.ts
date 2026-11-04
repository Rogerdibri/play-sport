export type PersonnelRole = 'manager' | 'organizer' | 'scorekeeper';
export type PresentOfficial = {
  role: 'DIRIGENTE' | 'MANAGER' | 'DELEGADO';
  identificationNumber: string;
  displayName: string;
};
export type PersonnelAction =
  | { kind: 'arrival'; identificationNumber: string }
  | { kind: 'substitution'; outgoingIdentificationNumber: string; incomingIdentificationNumber: string; fieldPosition: string; jerseyNumber: string }
  | { kind: 'defense'; identificationNumber: string; fieldPosition: string }
  | { kind: 'courtesy'; fromBase: number; outgoingIdentificationNumber: string; incomingIdentificationNumber: string }
  | { kind: 'staff-arrival'; official: PresentOfficial }
  | { kind: 'staff-departure'; identificationNumber: string; role: PresentOfficial['role'] };
export type TeamSheetPlayer = {
  identificationNumber: string;
  displayName: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string | null;
};
export type PersonnelRequest = {
  id: string;
  teamId: string;
  managerId: string;
  action: PersonnelAction;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: { id: string; role: 'organizer' | 'scorekeeper' } | null;
  decisionNote: string | null;
  appliedRevision: number | null;
  courtesyRunnerSource: 'BENCH' | 'ROSTER' | null;
};
export type TeamSheet = {
  teamId: string;
  managerId: string;
  revision: number;
  lineup: TeamSheetPlayer[];
  initialLineup: TeamSheetPlayer[];
  presentSubstitutes: Array<{ identificationNumber: string; displayName: string }>;
  presentOfficials: PresentOfficial[];
  representative: { identificationNumber: string; displayName: string } | null;
  submittedAt: string;
  updatedAt: string;
  recipients: Array<{ userId: string; role: PersonnelRole }>;
};
export type TeamSheetsSnapshot = {
  gameId: string;
  tournamentId: string;
  version: number;
  canDecide: boolean;
  ownTeamId: string | null;
  sheets: TeamSheet[];
  requests: PersonnelRequest[];
};
