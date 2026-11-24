import Link from 'next/link';
import { scorekeeperPlanLevels, type ScorekeeperPlanLevel } from '@playsport/shared';

export default function ScorekeeperPlanLevels({ currentLevel }: { currentLevel?: ScorekeeperPlanLevel }) {
  return <section className="managerCard managerStepCard playerPlanLevels scorekeeperPlanLevels">
    <h2>Anotador · Tres niveles</h2>
    <p>Seis meses gratuitos desde la activación de Anotador. Vigencias mensual, trimestral, semestral y anual,
      sin precios ni cobros habilitados. Puedes conservar el básico sin subir de nivel; las suplencias autorizadas siguen siendo gratuitas.
      Solo tus torneos autorizados. Ningún nivel abre perfiles ajenos ni acumulados globales del jugador.</p>
    <div className="adminUserGrid">{scorekeeperPlanLevels.map(plan => <article className="adminUserCard" key={plan.level}
      aria-current={currentLevel === plan.level ? 'true' : undefined}>
      <h3>Nivel {plan.level} · {plan.name}</h3>
      {currentLevel === plan.level ? <p className="managerStatus success">Tu nivel actual</p> : null}
      <p><strong>{plan.limit === null ? 'Torneos ilimitados' : `${plan.limit} ${plan.limit === 1 ? 'torneo' : 'torneos'}`}</strong></p>
      <ul>{plan.benefits.map(benefit => <li key={benefit}>{benefit}</li>)}</ul>
    </article>)}</div>
    <p>Los accesos puntuales de niveles 1 y 2 conservan tus cupos y solo habilitan el partido autorizado,
      nunca el torneo completo. Sin precios ni cobros habilitados; las solicitudes requieren autorización separada.
      La asignación deportiva del organizador sigue siendo obligatoria.</p>
    <div className="managerButtonRow">
      <Link href="/account/scorekeeper-tournaments" className="managerButtonOutline">Mis cupos de Anotador</Link>
      <Link href="/sports-sheet/scorekeeper" className="managerButtonOutline">Box score y torneos</Link>
      <Link href="/sports-sheet/scorekeeper/example" className="managerButtonOutline">Comparar niveles de Anotador</Link>
    </div>
  </section>;
}
