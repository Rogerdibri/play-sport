import { playerPlanLevels, type PlayerPlanLevel } from '@playsport/shared';
import Link from 'next/link';

export default function PlayerPlanLevels({ currentLevel }: { currentLevel?: PlayerPlanLevel }) {
  return <section className="managerCard managerStepCard playerPlanLevels">
    <h2>Jugador · Tres niveles</h2>
    <p>Jugador básico gratuito sin vencimiento. Los niveles 2 y 3 contemplan vigencias mensual, trimestral, semestral y anual.
      Sin precios ni cobros habilitados. El nivel controla la consulta, no el registro de tus participaciones.</p>
    <div className="adminUserGrid">{playerPlanLevels.map(plan => <article className="adminUserCard" key={plan.level}
      aria-current={currentLevel === plan.level ? 'true' : undefined}>
      <h3>Nivel {plan.level} · {plan.name}</h3>
      {currentLevel === plan.level ? <p className="managerStatus success">Tu nivel actual</p> : null}
      <p>{plan.description}</p><ul>{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
    </article>)}</div>
    <p>El nivel 2 consulta cada partido por separado. El nivel 3 permite acumulados sin mezclar origen, modalidades, categorías o bases del PCL.
      Vencer un acceso no borra tu historia.</p>
    <Link href="/sports-sheet/statistics/example" className="managerButtonOutline">Comparar niveles con ejemplos</Link>
  </section>;
}
