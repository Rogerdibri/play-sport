import { demoProfileLocation, isProfileLocation, isPlatformRoleId, platformModuleIds, platformRoles, type ProfileLocation, type PlatformModuleId, type PlatformRoleId } from '@playsport/shared';
import type { AccountProfile } from '@playsport/shared';

export function officialAccountActor(account: AccountProfile | null | undefined, role: 'organizer' | 'scorekeeper') {
  if (!account || account.localTestAccess) return role === 'organizer' ? 'org-demo' : 'scorer-demo';
  return account.identity?.status === 'verified' ? account.identity.actorId ?? null : null;
}

export type DemoSession = { version: 1; role: PlatformRoleId; team: 'team-A' | 'team-B'; location?: ProfileLocation;
  workTeamId?: string; workTournamentId?: string; workTeamName?: string; workManagerId?: string };
export type DemoModule = {
  id: PlatformModuleId; slug: string; title: string; summary: string;
  status: 'working' | 'partial' | 'planned'; actions: string[];
};
export const demoSessionKey = 'playsport:demo-session:v1';
export const localTestProfileKey = 'playsport:local-test-profile:v1';
export function readLocalTestProfile(value: unknown, accountId: string): DemoSession {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('accountId' in value) || value.accountId !== accountId || !('session' in value)) {
    throw new Error('El perfil guardado no corresponde a esta cuenta. Elige nuevamente tu rol.');
  }
  const session = readDemoSession(value.session);
  if (!session) throw new Error('El rol guardado no es válido. Elige nuevamente tu rol.');
  return session;
}
export const demoModules: DemoModule[] = [
  { id: 'tournaments', slug: 'tournaments', title: 'Crear torneo', summary: 'Crea y administra tu liga o torneo: fases flexibles, equipos, rosters, reglamento, sedes, sanciones y programación semanal.', status: 'working', actions: [] },
  { id: 'friendly-games', slug: 'friendly-games', title: 'Partidos amistosos', summary: 'Crea tus equipos y lineups solo con nombres. Anota y guarda tus amistosos privados, sin afectar torneos.', status: 'working', actions: [] },
  { id: 'live-scoring', slug: 'live-scoring', title: 'Pizarra en vivo', summary: 'Consulta el partido en vivo. Solo el anotador y el organizador registran jugadas y cambios.', status: 'working', actions: [] },
  { id: 'events-map', slug: 'events-map', title: 'Cartelera', summary: 'Partidos y resultados por fecha, estado y municipio, con direcciones y enlaces para llegar a cada sede.', status: 'working', actions: ['Sugerir un evento'] },
  { id: 'standings', slug: 'standings', title: 'Tabla de posiciones', summary: 'Consulta tu liga y torneo: posiciones, ganados, perdidos, desempates y resultados de cada equipo.', status: 'working', actions: [] },
  { id: 'marketplace', slug: 'marketplace', title: 'Marketplace deportivo', summary: 'Publica, compra y subasta artículos deportivos con tu cuenta. Sin dinero real.', status: 'partial', actions: ['Pagos y verificación comercial', 'Entregas y protección comercial reales'] },
  { id: 'player-career', slug: 'player-career', title: 'Hoja deportiva', summary: 'Tu ficha deportiva por rol, equipos actuales, disponibilidad y privacidad en una sola cuenta.', status: 'working', actions: [] },
  { id: 'team-hq', slug: 'roster', title: 'ROSTER', summary: 'Consulta la plantilla y sus cargos. Busca personas del ecosistema o preinscríbelas sin duplicar su identidad.', status: 'working', actions: [] },
  { id: 'manager-games', slug: 'manager-games', title: 'Mis partidos asignados', summary: 'Consulta los partidos de tu equipo, prepara su lineup y gestiona solicitudes de personal.', status: 'working', actions: [] },
  { id: 'organizer-center', slug: 'organizer-center', title: 'Centro del organizador', summary: 'Configura cupos y cierre simultáneo del roster; conserva las herramientas oficiales.', status: 'partial', actions: ['Crear torneos desde la web', 'Administrar calendario y sedes'] },
  { id: 'sponsors', slug: 'sponsors', title: 'Sponsors y partners', summary: 'Patrocinios, campañas y acuerdos comerciales.', status: 'planned', actions: ['Gestionar campañas', 'Consultar resultados comerciales', 'Administrar beneficios'] },
  { id: 'scouting', slug: 'scouting-watchlists', title: 'Scouting y talento', summary: 'Búsqueda de atletas, seguimiento y listas de prospectos.', status: 'planned', actions: ['Buscar atletas', 'Guardar watchlists', 'Consultar highlights'] }
];
export const moduleStatusLabels = { working: 'Disponible', partial: 'Parcialmente integrado', planned: 'Pendiente de implementar' };

export function sessionIdentityLabel(session: DemoSession, account?: AccountProfile | null, profileName = '') {
  const name = account?.identity?.fullName?.trim() || account?.displayName?.trim() || profileName.trim();
  const role = platformRoles.find(item => item.id === session.role)?.label;
  return name ? `${name} · ${role}` : `Mi perfil · ${role}`;
}

export function readDemoSession(value: unknown): DemoSession | null {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('role' in value) || !isPlatformRoleId(value.role) ||
      !('team' in value) || value.team !== 'team-A' && value.team !== 'team-B') return null;
  const location = 'location' in value ? value.location : undefined;
  if (location !== undefined && !isProfileLocation(location)) return null;
  let work: Pick<DemoSession, 'workTeamId' | 'workTournamentId' | 'workTeamName' | 'workManagerId'> = {};
  if (value.role === 'manager' && ['workTeamId','workTournamentId','workTeamName'].some(key => key in value)) {
    if (!('workTeamId' in value) || typeof value.workTeamId !== 'string' || !value.workTeamId.trim() || value.workTeamId.length > 160 ||
        !('workTournamentId' in value) || typeof value.workTournamentId !== 'string' || !value.workTournamentId.trim() || value.workTournamentId.length > 160 ||
        !('workTeamName' in value) || typeof value.workTeamName !== 'string' || !value.workTeamName.trim() || value.workTeamName.length > 200) return null;
    if ('workManagerId' in value && (typeof value.workManagerId !== 'string' || !/^person:[a-f0-9-]{36}$/.test(value.workManagerId))) return null;
    work = { workTeamId: value.workTeamId, workTournamentId: value.workTournamentId, workTeamName: value.workTeamName,
      ...('workManagerId' in value && typeof value.workManagerId === 'string' ? { workManagerId: value.workManagerId } : {}) };
  }
  return { version: 1, role: value.role, team: value.team, ...(location ? { location } : {}), ...work };
}
export function demoSessionLocation(session: DemoSession | null): ProfileLocation {
  return session?.location ?? demoProfileLocation;
}
export function demoIdentity(session: DemoSession, account?: AccountProfile | null) {
  if (session.role === 'manager' && account && !account.localTestAccess) return {
    id: account.identity?.actorId ?? account.id,
    name: session.workTeamName ? `Dirigente de ${session.workTeamName}` : account.displayName
  };
  if (session.role === 'manager') return {
    id: session.team === 'team-A' ? 'mgr-A' : 'mgr-B',
    name: `Dirigente de ${session.workTeamName ?? (session.team === 'team-A' ? 'Tigres del Valle' : 'Leones del Norte')}`
  };
  const identities = {
    fan: { id: 'fan-demo', name: 'Fanático' },
    player: { id: 'player-demo', name: 'Jugador' },
    organizer: { id: 'org-demo', name: 'Organizador' },
    scorekeeper: { id: 'scorer-demo', name: 'Anotador' },
    scout: { id: 'scout-demo', name: 'Scout' }
  };
  return identities[session.role];
}
export function liveScoringHref(session: DemoSession) {
  if (session.role === 'fan') return '/demo/events-map';
  if (session.role === 'organizer' || session.role === 'scorekeeper') return `/demo/live-scoring?view=${session.role}`;
  if (session.role === 'manager' && session.workTournamentId && session.workTournamentId !== 'tour-global-1') return '/demo/manager-games';
  if (session.role === 'manager') return session.team === 'team-B' ? '/demo/live-scoring?view=rival' : '/demo/live-scoring';
  return '/demo/live-scoring?view=public';
}
export function managerWorkContext(session: DemoSession) {
  return { managerId: session.workManagerId ?? demoIdentity(session).id, teamId: session.workTeamId ?? session.team, tournamentId: session.workTournamentId ?? 'tour-global-1' };
}
export function demoModuleHref(module: DemoModule, session: DemoSession): string | null {
  if (!platformModuleIds(session.role).includes(module.id)) return null;
  if (module.id === 'player-career') return '/sports-sheet';
  if (session.role === 'fan' && module.id === 'live-scoring') return null;
  if (session.role === 'scorekeeper' && module.id === 'live-scoring') return `${liveScoringHref(session)}&entry=live`;
  if (session.role === 'manager' && module.id === 'live-scoring') return '/demo/live-scoring?view=public';
  return module.id === 'live-scoring' ? liveScoringHref(session) : `/demo/${module.slug}`;
}
export function legacyDemoSession(view?: string): DemoSession | null {
  if (view === 'public') return null;
  return { version: 1, role: view === 'organizer' || view === 'scorekeeper' ? view : 'manager', team: view === 'rival' ? 'team-B' : 'team-A' };
}

export function demoProfileRedirect(session: DemoSession | null, requested: DemoSession | null): string | null {
  if (!session || !requested) return null;
  return session.role !== requested.role || session.role === 'manager' && session.team !== requested.team
    ? liveScoringHref(session) : null;
}
