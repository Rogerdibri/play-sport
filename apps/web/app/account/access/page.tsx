'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { accessFeatureLabels, playerPlanLevel, managerPlanLevel, scorekeeperPlanLevel, readOwnAccountAccess, trialPlans, trialStatus, type OwnAccountAccess } from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { accessRequest } from './access-request';
import PlayerPlanLevels from './player-plan-levels';
import ManagerPlanLevels from './manager-plan-levels';
import ScorekeeperPlanLevels from './scorekeeper-plan-levels';
import RoleValidityPanel from './role-validity-panel';

export default function AccountAccessPage() {
  const { account, ready } = usePlatformSession();
  const [snapshot, setSnapshot] = useState<OwnAccountAccess | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const accountId = account?.id;
  const currentAccount = useRef(accountId);
  const requests = useRef(0);
  currentAccount.current = accountId;
  useEffect(() => {
    let active = true;
    setSnapshot(null); setError('');
    if (!accountId) return;
    const load = async () => {
      const request = ++requests.current;
      try {
        const value = readOwnAccountAccess(await accessRequest('/api/accounts/access'), accountId);
        if (active && requests.current === request) { setSnapshot(value); setError(''); }
      } catch (failure) {
        if (active && requests.current === request) { setSnapshot(null); setError(failure instanceof Error ? failure.message : 'No se pudieron recuperar tus accesos.'); }
      }
    };
    void load();
    globalThis.addEventListener('focus', load);
    const interval = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(interval); };
  }, [accountId, attempt]);
  if (!ready) return <main className="moduleView"><p role="status">Consultando tu cuenta…</p></main>;
  if (!account) return <main className="moduleView"><section className="managerCard"><h1>Mis accesos</h1>
    <p>Inicia sesión para consultar tus propios planes y vencimientos.</p><Link href="/account">Ir a Mi cuenta</Link></section></main>;
  return <main className="moduleView administrationPage">
    <header className="moduleHeader"><h1>Mis planes y accesos</h1>
      <p>Vigencias por rol, sin renovación automática ni cobros habilitados. Vencer o revocar un acceso no borra tus partidos ni tu historial.</p>
      <Link className="managerButtonOutline" href="/account">Volver a Mi cuenta</Link></header>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    <button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Actualizar mis accesos</button>
    {!snapshot && !error ? <p role="status">Comprobando accesos vigentes…</p> : null}
    {snapshot?.accountId === account.id ? <>
      <RoleValidityPanel key={account.id} snapshot={snapshot} verified={account.identity?.status === 'verified'}
        onActivated={value => { if (currentAccount.current === value.accountId) { ++requests.current; setSnapshot(value); } }} />
      <Link href="/account/access/example" className="managerButtonOutline">Comparar vigencias y vencimientos</Link>
      <PlayerPlanLevels currentLevel={playerPlanLevel({ features: snapshot.features, localTestAccess: account.localTestAccess })} />
      <ManagerPlanLevels currentLevel={managerPlanLevel({ features: snapshot.features, localTestAccess: account.localTestAccess })} />
      <ScorekeeperPlanLevels currentLevel={scorekeeperPlanLevel({ features: snapshot.features, localTestAccess: account.localTestAccess })} />
      <section className="managerCard"><h2>Organizador · Por torneo</h2>
        <p>Sin niveles ni límite global de torneos. Una única oportunidad gratuita: 2 a 5 equipos y hasta 13 partidos ordinarios, más hasta 3 desempates incluidos.
          Se consume al iniciar el primer partido, no al publicar ni preparar alineaciones. La reserva puede cambiarse antes de jugar.</p>
        <p>Las ampliaciones se definen por capacidad de partidos de cada torneo, no por jugadores ni por una membresía mensual.
          Precios y cobros todavía deshabilitados.</p>
        <p>Paquetes: Pequeño 8 equipos / 40 partidos; Mediano 16 / 150; Grande 32 / 550. También personalizado.
          La contratación termina al cerrar el torneo y no se traslada a otra edición.</p>
        <div className="managerButtonRow"><Link href="/demo/tournaments" className="managerButtonOutline">Gestionar capacidad de mis torneos</Link>
          <Link href="/account/organizer-capacity/example" className="managerButtonOutline">Comparar capacidades y reservas</Link></div>
      </section>
      <section className="managerCard"><h2>Funciones disponibles</h2>
        {snapshot.features.length ? <ul>{snapshot.features.map(feature => <li key={feature}>{accessFeatureLabels[feature]}</li>)}</ul> : <p>Conservas el acceso básico. No hay funciones detalladas habilitadas.</p>}
        {account.localTestAccess ? <p>Esta cuenta conserva la excepción local de pruebas; no es un plan de pago.</p> : null}
        <div className="managerButtonRow"><Link href="/sports-sheet/statistics" className="managerButtonOutline">Mis estadísticas</Link>
          {snapshot.features.includes('career') || account.localTestAccess ?
            <Link href="/sports-sheet/career" className="managerButtonOutline">Mi trayectoria</Link> : null}</div>
      </section>
      <section className="managerCard"><h2>Pruebas asignadas</h2>
        {!snapshot.trials.length ? <p>No tienes pruebas asignadas. Un administrador autorizado puede activarlas.</p> : <div className="adminUserGrid">
          {snapshot.trials.map(trial => <article className="adminUserCard" key={trial.planId}>
            <h3>{trialPlans.find(plan => plan.id === trial.planId)?.name}</h3>
            <p><strong>Estado:</strong> {{ active: 'Vigente', expired: 'Vencido', revoked: 'Revocado' }[trialStatus(trial, Date.parse(snapshot.now))]}</p>
            <p><strong>Vence:</strong> {new Date(trial.expiresAt).toLocaleString('es-VE')}</p>
          </article>)}</div>}
      </section>
      <p>Los planes no verifican tu identidad ni conceden permisos para administrar equipos o anotar partidos ajenos.</p>
    </> : null}
  </main>;
}
