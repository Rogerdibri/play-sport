'use client';
import { type AccountProfile, type AdministrationSnapshot } from '@playsport/shared';
import AdministrationDashboard from '../administration-dashboard';

const owner: AccountProfile = { id: '00000000-0000-4000-8000-000000000001', email: 'administracion@example.test',
  displayName: 'Administración de ejemplo', createdAt: '2026-01-01T00:00:00.000Z', emailVerified: false,
  identityVerification: 'unavailable', financialAccess: false };
const example: AdministrationSnapshot = {
  accountId: owner.id, now: '2026-11-22T12:00:00.000Z', page: 0, total: 4, auditPage: 0, auditTotal: 1,
  users: [
    { id: '00000000-0000-4000-8000-000000000002', displayName: 'Jugador de ejemplo', email: 'jugador@example.test', identityVerified: true,
      trials: [{ planId: 'player', active: true, expiresAt: '2026-12-01T23:00:00.000Z', updatedAt: '2026-11-22T11:00:00.000Z', revision: 1 }] },
    { id: '00000000-0000-4000-8000-000000000003', displayName: 'Manager de ejemplo', email: 'manager@example.test', identityVerified: true,
      trials: [{ planId: 'manager', active: true, expiresAt: '2026-11-01T23:00:00.000Z', updatedAt: '2026-10-22T11:00:00.000Z', revision: 1 }] },
    { id: '00000000-0000-4000-8000-000000000004', displayName: 'Anotador de ejemplo', email: 'anotador@example.test', identityVerified: false,
      trials: [{ planId: 'scorekeeper', active: false, expiresAt: '2026-12-01T23:00:00.000Z', updatedAt: '2026-11-22T11:00:00.000Z', revision: 2 }] },
    { id: '00000000-0000-4000-8000-000000000005', displayName: 'Organizador de ejemplo', email: 'organizador@example.test', identityVerified: true, trials: [] },
  ],
  audit: [{ id: 1, actorName: owner.displayName, targetName: 'Jugador de ejemplo', planId: 'player', action: 'grant',
    reason: 'Participación en el piloto de nueve entradas', at: '2026-11-22T11:00:00.000Z', previousExpiresAt: null, expiresAt: '2026-12-01T23:00:00.000Z' }],
};
export default function AdministrationExamplePage() {
  return <AdministrationDashboard account={owner} example={example} />;
}
