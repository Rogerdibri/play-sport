'use client';

import Link from 'next/link';
import AccountAvatar from '../account-avatar';
import { accountSections } from '../account-navigation';
import { usePlatformSession } from '../platform-session';
import AccountAccess from './account-access';

export default function AccountPage() {
  const { account, ready } = usePlatformSession();
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
    <p className="accountHubNote">Elegir un rol no cambia tu cuenta ni concede permisos adicionales.
      Las operaciones con dinero real siguen deshabilitadas.</p>
  </main>;
}
