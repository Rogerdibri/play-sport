'use client';

import Link from 'next/link';
import { sportsSheetDiscipline } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import AccountStatistics from './statistics-view';
import ScorekeeperStatisticsView from '../scorekeeper/scorekeeper-statistics-view';

export default function SportsStatisticsPage() {
  const { account, ready, session } = usePlatformSession();
  if (!ready) return <main className="moduleView"><p role="status">Abriendo estadísticas…</p></main>;
  if (!account) return <main className="moduleView sportsSheet"><header className="moduleHeader"><h1>Estadísticas deportivas</h1>
    <p><strong>Disciplina:</strong> {sportsSheetDiscipline.label}</p>
    <p>Consultas privadas de béisbol y softbol.</p></header><section className="managerCard managerStepCard">
    <p>Inicia sesión para consultar el acceso de tu cuenta.</p><Link className="managerButtonOutline" href="/account">Mi cuenta</Link></section></main>;
  if (session?.role === 'scorekeeper') return <ScorekeeperStatisticsView key={account.id} account={account} />;
  return <AccountStatistics key={`${account.id}:${session?.role}`} account={account} initialMode={session?.role === 'manager' ? 'team' : 'player'} />;
}
