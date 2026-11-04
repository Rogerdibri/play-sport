'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { platformRoles } from '@playsport/shared';
import { demoIdentity, demoSessionKey, readDemoSession, type DemoSession } from './platform-navigation';

type SessionContext = {
  session: DemoSession | null; ready: boolean;
  // eslint-disable-next-line no-unused-vars -- Type-only callback parameter.
  enter: (session: DemoSession) => void; clear: () => void;
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
  const [error, setError] = useState('');
  const router = useRouter();
  useEffect(() => {
    try {
      const saved = globalThis.sessionStorage.getItem(demoSessionKey);
      if (saved) {
        const parsed = readDemoSession(JSON.parse(saved));
        if (!parsed) throw new Error('El perfil guardado no es válido. Selecciona de nuevo cómo quieres entrar.');
        setSession(parsed);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo recuperar el perfil del demo.');
    } finally { setReady(true); }
  }, []);
  const enter = useCallback((next: DemoSession) => {
    try {
      globalThis.sessionStorage.setItem(demoSessionKey, JSON.stringify(next));
      setSession(next); setError('');
    } catch {
      setError('No se pudo guardar el perfil en esta pestaña. Permite el almacenamiento del navegador y vuelve a intentarlo.');
    }
  }, []);
  const clear = useCallback(() => {
    try {
      globalThis.sessionStorage.removeItem(demoSessionKey);
      setSession(null); setError(''); router.push('/');
    } catch {
      setError('No se pudo cambiar el perfil. Revisa el almacenamiento del navegador.');
    }
  }, [router]);
  return <Context.Provider value={{ session, ready, enter, clear }}>
    <header className="platformNav">
      <Link href="/" className="platformBrand">PlaySport <small>Demo</small></Link>
      <nav aria-label="Navegación de la plataforma">
        <Link href="/">Inicio</Link>
        {session ? <span>Perfil: {platformRoles.find((role) => role.id === session.role)?.label} · {demoIdentity(session).name}</span> : <span>Sin perfil seleccionado</span>}
        {session ? <button className="managerButtonOutline" type="button" onClick={clear}>Cambiar perfil</button> : <Link href="/">Elegir perfil</Link>}
      </nav>
    </header>
    {error ? <p className="platformError managerWarning" role="alert">{error}</p> : null}
    {children}
  </Context.Provider>;
}

export function DemoProfileRoute({ profile, children }: { profile: DemoSession | null; children: ReactNode }) {
  const { ready, enter } = usePlatformSession();
  const role = profile?.role;
  const team = profile?.team;
  useEffect(() => {
    if (ready && role && team) {
      enter({ version: 1, role, team });
    }
  }, [ready, role, team, enter]);
  return children;
}
