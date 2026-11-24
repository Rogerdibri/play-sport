'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  favoriteKey, favoriteMatchesGame, favoriteMatchesTournament, favoritesChangedEvent, favoritesChangedKey,
  readFavoritesSnapshot, type FavoriteChange, type FavoriteRef, type FavoritesSnapshot,
} from '@playsport/shared';
import { usePlatformSession } from './platform-session';
import { useNavigationBusy } from './navigation-hooks';
import { InstitutionName } from './institutional-logos';

type FavoritesContext = FavoritesSnapshot & {
  ready: boolean;
  busy: boolean;
  error: string;
  isFavorite: (_ref: FavoriteRef) => boolean; // eslint-disable-line no-unused-vars
  matchesGame: (_game: { tournamentId: string; homeTeamId: string; awayTeamId: string }) => boolean; // eslint-disable-line no-unused-vars
  matchesTournament: (_id: string) => boolean; // eslint-disable-line no-unused-vars
  change: (_ref: FavoriteRef, _favorite: boolean) => void; // eslint-disable-line no-unused-vars
};
const Context = createContext<FavoritesContext | null>(null);
export const useFavorites = () => useContext(Context);

export default function FavoritesProvider({ children }: { children: ReactNode }) {
  const { account } = usePlatformSession();
  return account
    ? <ActiveFavorites key={account.id} accountId={account.id}>{children}</ActiveFavorites>
    : <Context.Provider value={null}>{children}</Context.Provider>;
}
function ActiveFavorites({ accountId, children }: { accountId: string; children: ReactNode }) {
  const [data, setData] = useState<FavoritesSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<FavoriteChange | null>(null);
  const pendingRequest = useRef<FavoriteChange | null>(null);
  const mounted = useRef(false), sending = useRef(false), revision = useRef(0);
  useNavigationBusy(busy);
  const load = useCallback(async () => {
    const request = ++revision.current;
    try {
      const response = await fetch('/api/favorites', { cache: 'no-store', credentials: 'include' });
      if (!response.ok) throw new Error('No se pudieron cargar tus favoritos. Comprueba tu cuenta y vuelve a intentar.');
      const next = readFavoritesSnapshot(await response.json(), accountId);
      if (mounted.current && request === revision.current) { setData(next); setError(''); return true; }
    } catch (failure) {
      if (mounted.current && request === revision.current)
        setError(failure instanceof Error ? failure.message : 'No se pudieron cargar tus favoritos.');
    }
    return false;
  }, [accountId]);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (!sending.current && !pendingRequest.current) void load(); };
    const storage = (event: globalThis.StorageEvent) => { if (event.key === favoritesChangedKey) refresh(); };
    refresh();
    globalThis.addEventListener('focus', refresh);
    globalThis.addEventListener(favoritesChangedEvent, refresh);
    globalThis.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      revision.current++;
      globalThis.removeEventListener('focus', refresh);
      globalThis.removeEventListener(favoritesChangedEvent, refresh);
      globalThis.removeEventListener('storage', storage);
    };
  }, [load]);
  const send = async (command: FavoriteChange) => {
    if (sending.current) return;
    sending.current = true;
    pendingRequest.current = command;
    const request = ++revision.current;
    setBusy(true); setPending(command); setError('');
    try {
      const response = await fetch('/api/favorites', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
        ? body.message : 'No se pudo confirmar el cambio de favorito.');
      const next = readFavoritesSnapshot(body, accountId);
      if (mounted.current && request === revision.current) {
        setData(next); setPending(null); pendingRequest.current = null;
        try { globalThis.localStorage.setItem(favoritesChangedKey, globalThis.crypto.randomUUID()); }
        catch {
          setError('El favorito quedó guardado, pero no se pudo avisar a otras pestañas. Se actualizarán al enfocarlas.');
        }
        globalThis.dispatchEvent(new globalThis.Event(favoritesChangedEvent));
      }
    } catch (failure) {
      if (mounted.current && request === revision.current)
        setError(failure instanceof Error ? failure.message : 'No se pudo confirmar el favorito.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const keys = useMemo(() => new Set(data?.items.map(favoriteKey)), [data]);
  return <Context.Provider value={{
    accountId, items: data?.items ?? [], catalog: data?.catalog ?? [], ready: Boolean(data),
    busy: busy || Boolean(pending), error,
    isFavorite: ref => keys.has(favoriteKey(ref)),
    matchesGame: game => Boolean(data && favoriteMatchesGame(data.items, data.catalog, game)),
    matchesTournament: id => Boolean(data && favoriteMatchesTournament(data.items, data.catalog, id)),
    change: (ref, favorite) => {
      if (pendingRequest.current) return;
      void send({ kind: ref.kind, id: ref.id, favorite, expectedAccountId: accountId, requestId: globalThis.crypto.randomUUID() });
    },
  }}>
    {error ? <div className="favoritesWarning managerWarning" role="alert">
      {error}{' '}
      {pending ? <>
        <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => void send(pending)}>Reintentar cambio</button>
        <button type="button" className="managerButtonOutline" disabled={busy}
          onClick={async () => { if (await load()) { setPending(null); pendingRequest.current = null; } }}>Consultar estado guardado</button>
      </> : <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => void load()}>Volver a cargar favoritos</button>}
    </div> : null}
    {children}
  </Context.Provider>;
}
export function BaseballFavoriteIcon() {
  return <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden="true" focusable="false">
    <circle className="favoriteBall" cx="16" cy="16" r="13" strokeWidth="1.8" />
    <g className="favoriteStitches" fill="none" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 6c8 5 8 15 0 20M25 6c-8 5-8 15 0 20" />
      <path d="m9 8-3 2m6 2-4 1m5 3-4 1m3 3-4-1m1 4-3-1m17-14 3 2m-6 2 4 1m-5 3 4 1m-3 3 4-1m-1 4 3-1" />
    </g>
  </svg>;
}
export function FavoriteButton({ kind, id, name }: FavoriteRef & { name?: string }) {
  const favorites = useFavorites();
  if (!favorites) return null;
  const target = favorites.catalog.find(row => row.kind === kind && row.id === id);
  const selected = favorites.isFavorite({ kind, id });
  if (!target && !selected) return null;
  const label = `${selected ? 'Quitar' : 'Añadir'} ${target?.name ?? name ?? 'elemento'} ${selected ? 'de' : 'a'} favoritos`;
  return <button type="button" className="favoriteButton" aria-pressed={selected} aria-label={label} title={label}
    disabled={!favorites.ready || favorites.busy || Boolean(favorites.error)}
    onClick={event => {
      event.preventDefault(); event.stopPropagation();
      favorites.change({ kind, id }, !selected);
    }}>
    <BaseballFavoriteIcon />
  </button>;
}
export function FavoriteInstitutionName({ kind = 'team', id, children, example = false }: {
  kind?: 'team' | 'league'; id?: string; children: string; example?: boolean;
}) {
  return <span className="favoriteName">
    <InstitutionName kind={kind} id={id} example={example}>{children}</InstitutionName>
    {id ? <FavoriteButton kind={kind} id={id} name={children} /> : null}
  </span>;
}
export function FavoritesOnly({ checked, onChange }: { checked: boolean; onChange: (_checked: boolean) => void }) { // eslint-disable-line no-unused-vars
  const favorites = useFavorites();
  return favorites ? <label className="favoritesOnly">
    <input type="checkbox" checked={checked} disabled={!favorites.ready} onChange={event => onChange(event.target.checked)} />
    <BaseballFavoriteIcon /><span>Solo mis favoritos</span>
  </label> : null;
}
export function FavoritesAccountNotice() {
  return <p>Inicia sesión en <Link href="/account">Mi cuenta</Link> para guardar tus favoritos y usarlos en todos tus roles.</p>;
}
