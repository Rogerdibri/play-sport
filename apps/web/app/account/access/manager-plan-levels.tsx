import Link from 'next/link';
import { managerPlanLevels, type ManagerPlanLevel } from '@playsport/shared';

export default function ManagerPlanLevels({ currentLevel }: { currentLevel?: ManagerPlanLevel }) {
  return <section className="managerCard managerStepCard playerPlanLevels managerPlanLevels">
    <h2>Manager · Tres niveles</h2>
    <p>Seis meses gratuitos desde la activación de Manager. Después puedes conservar el básico operativo sin subir de nivel.
      Vigencias mensual, trimestral, semestral y anual; sin precios ni cobros habilitados.
      Cada inscripción en un torneo activo consume un cupo; los históricos no cuentan.</p>
    <div className="adminUserGrid">{managerPlanLevels.map(plan => <article className="adminUserCard" key={plan.level}
      aria-current={currentLevel === plan.level ? 'true' : undefined}>
      <h3>Nivel {plan.level} · {plan.name}</h3>
      {currentLevel === plan.level ? <p className="managerStatus success">Tu nivel actual</p> : null}
      <p><strong>{plan.limit === null ? 'Inscripciones activas ilimitadas' :
        `${plan.limit} ${plan.limit === 1 ? 'inscripción activa' : 'inscripciones activas'}`}</strong></p>
      <p>{plan.description}</p><ul>{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
    </article>)}</div>
    <p>Al bajar de nivel, eliges qué equipo continuar administrando. Las demás inscripciones conservan sus datos para consulta.
      Este plan no desbloquea el historial personal global de tus jugadores.</p>
    <div className="managerButtonRow"><Link href="/account/manager-teams" className="managerButtonOutline">Gestionar mis cupos de Manager</Link>
      <Link href="/sports-sheet/statistics/manager-example" className="managerButtonOutline">Comparar niveles de Manager</Link></div>
  </section>;
}
