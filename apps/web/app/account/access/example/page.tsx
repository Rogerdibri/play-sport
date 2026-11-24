import Link from 'next/link';
import RoleValidityPanel from '../role-validity-panel';
import { addMembershipMonths, type OwnAccountAccess } from '@playsport/shared';

const now = '2026-11-23T18:00:00.000Z';
const snapshot: OwnAccountAccess = { accountId: 'role-validity-example', now, features: [], trials: [], roles: [
  { role: 'player', status: 'permanent', activatedAt: null, freeExpiresAt: null, expiresAt: null, now },
  { role: 'manager', status: 'expired', activatedAt: '2026-01-15T18:00:00.000Z',
    freeExpiresAt: addMembershipMonths('2026-01-15T18:00:00.000Z', 6), expiresAt: '2026-07-15T18:00:00.000Z', now },
  { role: 'scorekeeper', status: 'active', activatedAt: '2026-05-26T18:00:00.000Z',
    freeExpiresAt: addMembershipMonths('2026-05-26T18:00:00.000Z', 6), expiresAt: '2026-11-26T18:00:00.000Z', now }
] };
export default function RoleValidityExample() {
  return <main className="moduleView administrationPage">
    <header className="moduleHeader"><h1>Vigencias de Jugador, Manager y Anotador</h1>
      <p>Comparador de solo lectura: participación permanente, básico vencido y gratuidad próxima a vencer.
        Las fechas pertenecen a este ejemplo, no a tus accesos.</p>
      <Link href="/account/access" className="managerButtonOutline">Volver a mis planes</Link></header>
    <RoleValidityPanel snapshot={snapshot} verified={false} example />
  </main>;
}
