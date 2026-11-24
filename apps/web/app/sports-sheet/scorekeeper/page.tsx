'use client';

import Link from 'next/link';
import { usePlatformSession } from '../../platform-session';
import ScorekeeperStatisticsView from './scorekeeper-statistics-view';

export default function ScorekeeperStatisticsPage() {
  const { account, ready } = usePlatformSession();
  if (!ready) return <p role="status">Comprobando tu cuenta…</p>;
  if (!account) return <main className="moduleView"><section className="managerCard"><h1>Estadísticas de Anotador</h1>
    <Link href="/account">Iniciar sesión</Link></section></main>;
  return <ScorekeeperStatisticsView key={account.id} account={account} />;
}
