export type LineupEntryDraft = {
  identificationNumber: string;
  battingOrder: number | null;
  fieldPosition: string;
  lineupRole: 'PLAYER' | 'DP' | 'FLEX' | 'EH';
  jerseyNumber: string;
  displayName?: string;
};
export type ManagerDraftContext = { tournamentId: string; teamId: string; gameId: string; managerId: string };
export type OfficialDraftContext = { tournamentId: string; gameId: string; actorId: string };
export type OfficialDraftRole = 'organizer' | 'scorekeeper';
export type ManagerGameDraft = {
  cedula: string; position: string; role: LineupEntryDraft['lineupRole']; jersey: string; entries: LineupEntryDraft[];
};
export type OfficialGameDraft = {
  offenseTeam: string; batter: string; runner: string; fielder: string; fromBase: string; toBase: string;
  runs: string; outs: string; errorOuts: string; eventType: string; courtesySource: 'BENCH' | 'ROSTER';
};
export type MobileDrafts = {
  version: 1;
  manager: { context: ManagerDraftContext; games: Record<string, ManagerGameDraft> };
  officials: Record<OfficialDraftRole, { context: OfficialDraftContext; games: Record<string, OfficialGameDraft> }>;
};

export const mobileDraftStorageKey = 'playsport:mobile-drafts:v1';
export const newManagerGameDraft = (): ManagerGameDraft => ({ cedula: '', position: 'P', role: 'PLAYER', jersey: '', entries: [] });
export const newOfficialGameDraft = (): OfficialGameDraft => ({
  offenseTeam: '', batter: '', runner: '', fielder: '', fromBase: '', toBase: '', runs: '', outs: '',
  errorOuts: '', eventType: 'strike', courtesySource: 'BENCH'
});
export function newMobileDrafts(): MobileDrafts {
  return {
    version: 1,
    manager: { context: { tournamentId: 'tour-global-1', teamId: 'team-A', gameId: 'game-global-1', managerId: 'mgr-A' }, games: {} },
    officials: {
      organizer: { context: { tournamentId: 'tour-2026', gameId: 'game-88', actorId: 'score-1' }, games: {} },
      scorekeeper: { context: { tournamentId: 'tour-2026', gameId: 'game-88', actorId: 'score-1' }, games: {} }
    }
  };
}
export function managerDraftKey(context: ManagerDraftContext): string {
  return JSON.stringify([context.tournamentId.trim(), context.gameId.trim(), context.teamId.trim(), context.managerId.trim()]);
}
export function officialDraftKey(context: OfficialDraftContext): string {
  return JSON.stringify([context.tournamentId.trim(), context.gameId.trim(), context.actorId.trim()]);
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const textFields = (value: Record<string, unknown>, fields: readonly string[]) => fields.every((field) => typeof value[field] === 'string');
const lineup = (value: unknown) => record(value) && textFields(value, ['identificationNumber', 'fieldPosition', 'jerseyNumber']) &&
  (value.battingOrder === null || typeof value.battingOrder === 'number' && Number.isInteger(value.battingOrder)) &&
  ['PLAYER', 'DP', 'FLEX', 'EH'].includes(String(value.lineupRole)) &&
  (value.displayName === undefined || typeof value.displayName === 'string');
const managerGame = (value: unknown) => record(value) && textFields(value, ['cedula', 'position', 'jersey']) &&
  ['PLAYER', 'DP', 'FLEX', 'EH'].includes(String(value.role)) && Array.isArray(value.entries) && value.entries.every(lineup);
const officialGame = (value: unknown) => record(value) &&
  textFields(value, ['offenseTeam', 'batter', 'runner', 'fielder', 'fromBase', 'toBase', 'runs', 'outs', 'errorOuts', 'eventType']) &&
  (value.courtesySource === 'BENCH' || value.courtesySource === 'ROSTER');
const officialProfile = (value: unknown) => record(value) && record(value.context) &&
  textFields(value.context, ['tournamentId', 'gameId', 'actorId']) && record(value.games) && Object.values(value.games).every(officialGame);

export function isMobileDrafts(value: unknown): value is MobileDrafts {
  return record(value) && Object.keys(value).every((key) => ['version', 'manager', 'officials'].includes(key)) &&
    value.version === 1 && record(value.manager) && record(value.manager.context) &&
    textFields(value.manager.context, ['tournamentId', 'teamId', 'gameId', 'managerId']) && record(value.manager.games) &&
    Object.values(value.manager.games).every(managerGame) && record(value.officials) &&
    officialProfile(value.officials.organizer) && officialProfile(value.officials.scorekeeper);
}
export function readMobileDrafts(raw: string | null): MobileDrafts {
  if (raw === null) return newMobileDrafts();
  const value: unknown = JSON.parse(raw);
  if (!isMobileDrafts(value)) throw new Error('Los borradores del dispositivo contienen datos inválidos. Se conservaron sin publicarlos ni borrarlos.');
  return value;
}

export type DraftStorage = {
  getItem: (_key: string) => Promise<string | null>; // eslint-disable-line no-unused-vars
  setItem: (_key: string, _value: string) => Promise<void>; // eslint-disable-line no-unused-vars
};
export class MobileDraftStorage {
  private pending: Promise<void> = Promise.resolve();
  private readonly storage: DraftStorage;
  constructor(storage: DraftStorage) { this.storage = storage; }
  async load(): Promise<MobileDrafts> {
    await this.pending;
    return readMobileDrafts(await this.storage.getItem(mobileDraftStorageKey));
  }
  save(value: MobileDrafts): Promise<void> {
    if (!isMobileDrafts(value)) return Promise.reject(new Error('No se puede guardar un borrador con datos inválidos.'));
    const serialized = JSON.stringify(value);
    const write = () => this.storage.setItem(mobileDraftStorageKey, serialized);
    // Serial writes prevent a slower old draft from replacing a newer one.
    this.pending = this.pending.then(write, write);
    return this.pending;
  }
  flush(): Promise<void> { return this.pending; }
}
