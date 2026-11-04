export type PlatformRoleId = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';
export type PlatformModuleId = 'events-map' | 'live-scoring' | 'standings' | 'news' | 'marketplace' |
  'player-career' | 'team-hq' | 'organizer-center' | 'sponsors' | 'scouting';

export const platformRoles: Array<{
  id: PlatformRoleId; label: string; summary: string; entitlement: string;
}> = [
  { id: 'fan', label: 'Fanatico', summary: 'Sigue partidos, comenta, revisa cartelera y compra en marketplace.', entitlement: 'Solo funciones fanatico' },
  { id: 'player', label: 'Jugador', summary: 'Incluye funciones fanatico + hoja deportiva y seguimiento personal.', entitlement: 'Fanatico + Jugador' },
  { id: 'manager', label: 'Manager', summary: 'Prepara el lineup con el roster aprobado y consulta el partido oficial en vivo.', entitlement: 'Fanatico + Manager' },
  { id: 'organizer', label: 'Organizador', summary: 'Incluye funciones fanatico + torneos y anotacion oficial/legal.', entitlement: 'Fanatico + Organizador' },
  { id: 'scorekeeper', label: 'Anotador', summary: 'Incluye funciones fanatico + anotacion oficial/legal del partido.', entitlement: 'Fanatico + Anotador' },
  { id: 'scout', label: 'Scout', summary: 'Incluye funciones fanatico + busqueda avanzada y watchlists.', entitlement: 'Fanatico + Scout' }
];

export const platformCoreModules: PlatformModuleId[] = ['live-scoring', 'events-map', 'standings', 'news', 'marketplace'];
export const platformRoleExtras: Record<PlatformRoleId, PlatformModuleId[]> = {
  fan: [], player: ['player-career'], manager: ['team-hq'],
  organizer: ['organizer-center', 'sponsors'], scorekeeper: [], scout: ['scouting']
};

export function isPlatformRoleId(value: unknown): value is PlatformRoleId {
  return platformRoles.some((role) => role.id === value);
}

export function platformModuleIds(role: PlatformRoleId): PlatformModuleId[] {
  return [...platformCoreModules, ...platformRoleExtras[role]];
}
