'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import AccountAvatar from '../account-avatar';
import { accountSections } from '../account-navigation';
import { notifyAccountChange } from '../account-events';
import { useNavigationBusy } from '../navigation-hooks';
import { usePlatformSession } from '../platform-session';
import AccountAccess, { requestAccount } from './account-access';

export default function AccountPage() {
  const { account, ready } = usePlatformSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sending = useRef(false);
  useNavigationBusy(busy);
  const logout = async () => {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      await requestAccount('logout', {});
      notifyAccountChange();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo cerrar la sesión. Vuelve a intentarlo.');
    } finally { sending.current = false; setBusy(false); }
  };
  if (!ready) return <main className="moduleView"><p role="status">Abriendo Mi cuenta…</p></main>;
  if (!account) return <AccountAccess />;
  return <main className="moduleView accountHub">
    <header className="accountHubHero">
      <p className="eyebrow">TU ESPACIO PERSONAL</p>
      <div className="accountIdentity"><AccountAvatar account={account} size={64} />
        <div><h1>Mi cuenta</h1><p>{account.displayName}</p></div>
      </div>
      <p>Todo lo tuyo en un solo lugar, con la misma cuenta para todos tus roles.</p>
    </header>
    <nav className="accountHubGrid" aria-label="Mi cuenta">
      {accountSections.map(section => <Link key={section.id} href={section.href} className="accountHubCard">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={section.icon} /></svg>
        <div><h2>{section.title}</h2><p>{section.description}</p></div>
        <span aria-hidden="true">→</span>
      </Link>)}
    </nav>
    <Link href="/favorites" className="managerButtonOutline accountHubMobileAccess">Mis favoritos</Link>
    <Link href="/account/saved-games" className="managerButtonOutline">Mis partidos privados y datos anteriores</Link>
    <Link href="/account/access" className="managerButtonOutline">Mis planes y accesos de prueba</Link>
    {account.administrationAccess ? <Link href="/admin" className="managerButtonSolid">Administración de PlaySport</Link> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    <button type="button" className="managerButtonOutline" disabled={busy} aria-busy={busy} onClick={() => void logout()}>
      {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
    </button>
    <p className="accountHubNote">Elegir un rol no cambia tu cuenta ni concede permisos adicionales.
      Las operaciones con dinero real siguen deshabilitadas.</p>
  </main>;
}
