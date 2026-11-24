export type FavoriteKind = 'team' | 'player' | 'league';
export type FavoriteRef = { kind: FavoriteKind; id: string };
export type FavoriteTarget = FavoriteRef & {
  name: string;
  example?: boolean;
  memberships: Array<{ tournamentId: string; teamId: string }>;
};
export type FavoritesSnapshot = { accountId: string; items: FavoriteRef[]; catalog: FavoriteTarget[] };
export type FavoriteChange = FavoriteRef & { requestId: string; expectedAccountId: string; favorite: boolean };
export const favoritesChangedEvent = 'playsport:favorites-changed';
export const favoritesChangedKey = 'playsport:favorites-changed:v1';
export const favoriteKey = (ref: FavoriteRef) => JSON.stringify([ref.kind, ref.id]);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200 &&
  !/[\u0000-\u001f\u007f]/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
export function readFavoriteRef(value: unknown): FavoriteRef {
  if (!record(value) || !['team', 'player', 'league'].includes(String(value.kind)) || !text(value.id) ||
      value.kind === 'player' && !/^player:[a-f0-9]{64}$/.test(value.id))
    throw new Error('La referencia de favorito no es válida.');
  return { kind: value.kind as FavoriteKind, id: value.id };
}
export function readFavoriteChange(value: unknown): FavoriteChange {
  const ref = readFavoriteRef(value);
  if (!record(value) || Object.keys(value).some(key => !['kind', 'id', 'favorite', 'requestId', 'expectedAccountId'].includes(key)) ||
      !uuid(value.requestId) || !uuid(value.expectedAccountId) || typeof value.favorite !== 'boolean')
    throw new Error('El cambio de favorito no es válido.');
  return { ...ref, requestId: value.requestId, expectedAccountId: value.expectedAccountId, favorite: value.favorite };
}
export function readFavoritesSnapshot(value: unknown, accountId: string): FavoritesSnapshot {
  if (!record(value) || value.accountId !== accountId || !Array.isArray(value.items) || !Array.isArray(value.catalog))
    throw new Error('Los favoritos no corresponden a esta cuenta.');
  const items = value.items.map(readFavoriteRef);
  const catalog = value.catalog.map((row): FavoriteTarget => {
    const ref = readFavoriteRef(row);
    if (!record(row) || !text(row.name) || row.example !== undefined && typeof row.example !== 'boolean' || !Array.isArray(row.memberships) ||
        !row.memberships.every(link => record(link) && text(link.tournamentId) &&
          typeof link.teamId === 'string' && (link.teamId === '' || text(link.teamId))))
      throw new Error('El catálogo de favoritos contiene datos inválidos.');
    return { ...ref, name: row.name, ...(row.example === true ? { example: true } : {}), memberships: row.memberships.map(link => ({
      tournamentId: String(link.tournamentId), teamId: String(link.teamId),
    })) };
  });
  if ([items, catalog].some(rows => new Set(rows.map(favoriteKey)).size !== rows.length))
    throw new Error('Los favoritos contienen identidades duplicadas.');
  return { accountId, items, catalog };
}
// eslint-disable-next-line no-unused-vars
export function favoritesFirst<T>(rows: readonly T[], preferred: (row: T) => boolean): T[] {
  const first: T[] = [], rest: T[] = [];
  for (const row of rows) (preferred(row) ? first : rest).push(row);
  return [...first, ...rest];
}
export function favoriteMatchesGame(items: FavoriteRef[], catalog: FavoriteTarget[],
  game: { tournamentId: string; homeTeamId: string; awayTeamId: string }): boolean {
  const keys = new Set(items.map(favoriteKey));
  return catalog.some(target => keys.has(favoriteKey(target)) &&
    (target.kind === 'team'
      ? [game.homeTeamId, game.awayTeamId].includes(target.id)
      : target.memberships.some(link => link.tournamentId === game.tournamentId &&
          (target.kind === 'league' || [game.homeTeamId, game.awayTeamId].includes(link.teamId)))));
}
export function favoriteMatchesTournament(items: FavoriteRef[], catalog: FavoriteTarget[], tournamentId: string): boolean {
  const keys = new Set(items.map(favoriteKey));
  return catalog.some(target => keys.has(favoriteKey(target)) && target.memberships.some(link => link.tournamentId === tournamentId));
}
