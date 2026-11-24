'use client';
import Link from 'next/link';
import { usePlatformSession } from '../platform-session';
import AdministrationDashboard from './administration-dashboard';

export default function AdministrationPage() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <main className="moduleView"><p role="status">Comprobando acceso administrativo…</p></main>;
  if (!account?.administrationAccess) return <main className="moduleView"><section className="managerCard">
    <h1>Administración privada</h1><p>{account ? 'Tu cuenta no tiene autorización administrativa. Elegir Organizador no concede este acceso.' : 'Inicia sesión con una cuenta autorizada por el servidor.'}</p>
    <Link className="managerButtonOutline" href="/account">Ir a Mi cuenta</Link>
    <Link className="managerButtonOutline" href="/admin/example">Ver ejemplo de solo lectura</Link>
  </section></main>;
  return <AdministrationDashboard key={account.id} account={account} />;
}
