'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { accountChangedEvent, accountChangedKey, accountPhotoChangedEvent, accountPhotoChangedKey, readAccountProfile, type AccountProfile } from '@playsport/shared';
import { demoProfileRedirect, demoSessionKey, localTestProfileKey, readDemoSession, readLocalTestProfile, type DemoSession } from './platform-navigation';
import { normalizeAppRoutes, previousAppRoute } from './navigation-drafts';
import AccountAvatar from './account-avatar';
import SessionIdentity from './session-identity';
import SponsorStrip from './sponsor-strip';
import MobileBottomNavigation from './mobile-bottom-navigation';
import AccountNavigation from './account-navigation';

type SessionContext = {
  session: DemoSession | null; ready: boolean;
  localTester: boolean;
  homeRevision: number;
  account: AccountProfile | null;
  // eslint-disable-next-line no-unused-vars -- Type-only callback parameter.
  enter: (session: DemoSession) => void; clear: () => void;
  reportNavigationError: (_message: string) => void; // eslint-disable-line no-unused-vars
  registerNavigationBusy: () => () => void;
  registerScreenBack: (_action: () => void, _priority: number) => () => void; // eslint-disable-line no-unused-vars
};
const Context = createContext<SessionContext | null>(null);

export function usePlatformSession() {
  const value = useContext(Context);
  if (!value) throw new Error('El inicio de PlaySport requiere el contexto de la plataforma.');
  return value;
}

export default function PlatformSession({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [ready, setReady] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [error, setError] = useState('');
  const [testerAccountId, setTesterAccountId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const currentSession = useRef(session);
  currentSession.current = session;
  const router = useRouter();
  const pathname = usePathname();
  const accountPage = pathname === '/account' || pathname === '/account/security';
  const routes = useRef<string[]>([]);
  const screenBacks = useRef(new Map<symbol, { action: () => void; priority: number }>());
  const busyCount = useRef(0);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [homeRevision, setHomeRevision] = useState(0);
  const [navigationError, reportNavigationError] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const refreshBack = useCallback(() => {
    setCanGoBack(screenBacks.current.size > 0 || routes.current.length > 1 || globalThis.location.pathname !== '/');
  }, []);
  useEffect(() => {
    if (!ready) return;
    let active = true, revision = 0;
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch('/api/accounts/me', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (response.status === 401) { if (active && request === revision) { setTesterAccountId(null); setAccount(null); } return; }
        const body: unknown = await response.json();
        if (!response.ok || !body || typeof body !== 'object' || !('account' in body)) throw new Error('No se pudo comprobar el acceso de la cuenta. Las consultas públicas siguen disponibles.');
        const account = readAccountProfile(body.account);
        if (!active || request !== revision) return;
        setAccount(account);
        setTesterAccountId(account.localTestAccess ? account.id : null);
        if (account.localTestAccess) {
          try {
            const saved = globalThis.localStorage.getItem(localTestProfileKey);
            const tabChoice = globalThis.sessionStorage.getItem(demoSessionKey);
            if (saved && !currentSession.current && tabChoice === null) {
              const restored = readLocalTestProfile(JSON.parse(saved), account.id);
              globalThis.sessionStorage.setItem(demoSessionKey, JSON.stringify(restored));
              setSession(restored);
            }
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'No se pudieron recuperar tus preferencias. Puedes elegir de nuevo el rol.');
          }
        }
      } catch (failure) {
        if (active && request === revision) {
          setTesterAccountId(null);
          setAccount(null);
          setError(failure instanceof Error ? failure.message : 'No se pudo recuperar la cuenta.');
        }
      } finally {
        if (active && request === revision) setAccountReady(true);
      }
    };
    const changed = () => { revision++; setAccount(null); setTesterAccountId(null); setAccountReady(false); void load(); };
    const storage = (event: globalThis.StorageEvent) => {
      if (event.key === accountChangedKey) changed();
      else if (event.key === accountPhotoChangedKey) void load();
    };
    void load();
    globalThis.addEventListener(accountChangedEvent, changed);
    globalThis.addEventListener(accountPhotoChangedEvent, load);
    globalThis.addEventListener('storage', storage);
    globalThis.addEventListener('focus', load);
    return () => { active = false; globalThis.removeEventListener(accountChangedEvent, changed);
      globalThis.removeEventListener(accountPhotoChangedEvent, load); globalThis.removeEventListener('storage', storage); globalThis.removeEventListener('focus', load); };
  }, [pathname, ready]);
  const registerNavigationBusy = useCallback(() => {
    busyCount.current += 1; setNavigationBusy(true);
    return () => { busyCount.current -= 1; setNavigationBusy(busyCount.current > 0); };
  }, []);
  const registerScreenBack = useCallback((action: () => void, priority: number) => {
    const id = Symbol();
    screenBacks.current.set(id, { action, priority }); refreshBack();
    return () => { screenBacks.current.delete(id); refreshBack(); };
  }, [refreshBack]);
  useEffect(() => {
    if (!ready) return;
    const route = globalThis.location.pathname + globalThis.location.search;
    routes.current = normalizeAppRoutes([...routes.current, route]);
    refreshBack();
  }, [pathname, ready, session, refreshBack]);
  useEffect(() => {
    try {
      const saved = globalThis.sessionStorage.getItem(demoSessionKey);
      if (saved) {
        const choice: unknown = JSON.parse(saved);
        const parsed = choice === null ? null : readDemoSession(choice);
        if (choice !== null && !parsed) throw new Error('El rol guardado no es válido. Selecciona de nuevo cómo quieres entrar.');
        setSession(parsed);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo recuperar el rol.');
    } finally { setReady(true); }
  }, []);
  const enter = useCallback((next: DemoSession) => {
    const validated = readDemoSession(next);
    if (!validated) {
      setError('El rol o la ubicación de la cuenta no son válidos. Selecciona un estado y municipio del catálogo.');
      return;
    }
    try {
      globalThis.sessionStorage.setItem(demoSessionKey, JSON.stringify(validated));
      routes.current = ['/'];
      setSession(validated); setError('');
    } catch {
      setError('No se pudo guardar el rol en esta pestaña. Permite el almacenamiento del navegador y vuelve a intentarlo.');
      return;
    }
    if (testerAccountId) {
      try {
        globalThis.localStorage.setItem(localTestProfileKey, JSON.stringify({ version: 1, accountId: testerAccountId, session: validated }));
      } catch { setError('No se pudieron recordar tus preferencias. Permite el almacenamiento local del navegador.'); }
    }
  }, [testerAccountId]);
  const clear = useCallback(() => {
    try {
      // A missing choice restores the remembered role; null keeps this tab on the welcome.
      globalThis.sessionStorage.setItem(demoSessionKey, 'null');
      if (testerAccountId) globalThis.localStorage.removeItem(localTestProfileKey);
      routes.current = ['/'];
      currentSession.current = null;
      setSession(null); setHomeRevision(value => value + 1); setError('');
      if (pathname !== '/') router.push('/');
    } catch {
      setError('No se pudo cambiar el rol. Revisa el almacenamiento del navegador.');
    }
  }, [router, testerAccountId, pathname]);
  const hasHomeBack = pathname === '/' && session !== null;
  const goBack = () => {
    if (!ready || !accountReady || busyCount.current > 0 || navigationError) return;
    const local = [...screenBacks.current.values()].sort((a, b) => b.priority - a.priority)[0];
    if (local) { local.action(); return; }
    if (pathname === '/' && currentSession.current) { clear(); return; }
    routes.current = normalizeAppRoutes(routes.current);
    const destination = previousAppRoute(routes.current);
    if (routes.current.length > 1) routes.current.pop();
    else routes.current = ['/'];
    router.push(destination);
  };
  return <Context.Provider value={{ session, ready: ready && accountReady, account, localTester: Boolean(testerAccountId), homeRevision, enter, clear, reportNavigationError, registerNavigationBusy, registerScreenBack }}>
    <div style={{ display: 'contents' }} onClickCapture={(event) => {
      if (busyCount.current === 0 && !navigationError) return;
      const target = event.target instanceof globalThis.Element ? event.target.closest('a,button') : null;
      if (target && (target.tagName === 'A' || /^(Inicio|Volver|Atrás|Cambiar rol)/.test(target.textContent?.trim() ?? ''))) {
        event.preventDefault(); event.stopPropagation();
      }
    }}>
    <header className="platformNav">
      <div className="platformBack">
        <button className="managerButtonOutline" type="button" onClick={goBack}
          disabled={!ready || !accountReady || (!canGoBack && !hasHomeBack) || navigationBusy || Boolean(navigationError)}>Volver atrás</button>
      </div>
      <Link href="/" className="platformBrand">PlaySport {accountPage ? <small>Cuenta</small> : null}</Link>
      {!accountPage ? <span className="platformSessionIdentity">{session ? <SessionIdentity /> : 'Sin rol seleccionado'}</span> : null}
      <nav aria-label="Navegación de la plataforma">
        <button className="managerButtonOutline" type="button" onClick={clear}
          disabled={!ready || !accountReady || navigationBusy || Boolean(navigationError)}>Inicio</button>
        {account ? <Link href="/favorites">Mis favoritos</Link> : null}
        {session ? <button className="managerButtonOutline" type="button" onClick={clear}
          disabled={navigationBusy || Boolean(navigationError)}>Cambiar rol</button> : <Link href="/">Elegir rol</Link>}
        <Link href="/account" className="platformAccountIdentity" aria-label="Mi cuenta" title={account?.displayName}>
          {account ? <><AccountAvatar account={account} size={32} /><span><strong>{account.displayName}</strong><small>Mi cuenta</small></span></> : 'Mi cuenta'}
        </Link>
      </nav>
      <SponsorStrip />
    </header>
    {error ? <p className="platformError managerWarning" role="alert">{error}</p> : null}
    {navigationError ? <p className="platformError managerWarning" role="alert">{navigationError} El borrador no se ha descartado; resuelve el problema antes de volver.</p> : null}
    {navigationBusy ? <p className="platformError" role="status">Guardando datos. Espera a que termine antes de volver atrás.</p> : null}
    <AccountNavigation pathname={pathname} />
    {children}
    <MobileBottomNavigation pathname={pathname} hasRole={Boolean(session)}
      disabled={!ready || !accountReady || navigationBusy || Boolean(navigationError)} onWelcome={clear} />
    </div>
  </Context.Provider>;
}

export function DemoProfileRoute({ profile, children }: { profile: DemoSession | null; children: ReactNode }) {
  const { ready, enter, session, homeRevision } = usePlatformSession();
  const router = useRouter();
  const initialized = useRef(false);
  const role = profile?.role;
  const team = profile?.team;
  const returningHome = homeRevision > 0 && !session;
  const destination = demoProfileRedirect(session, profile);
  useEffect(() => {
    if (!ready) return;
    if (profile && returningHome) { router.replace('/'); return; }
    if (role && team && !initialized.current) {
      initialized.current = true;
      if (!session) enter({ version: 1, role, team });
    }
    if (destination) router.replace(destination);
  }, [ready, role, team, enter, session, router, destination, returningHome, profile]);
  if (!ready || destination || profile && !session) return <p role="status">Abriendo la vista de tu rol…</p>;
  return children;
}
