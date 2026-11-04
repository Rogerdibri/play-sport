import { isPlatformRoleId, platformModuleIds, type PlatformModuleId, type PlatformRoleId } from '@playsport/shared';

export type DemoSession = { version: 1; role: PlatformRoleId; team: 'team-A' | 'team-B' };
export type DemoModule = {
  id: PlatformModuleId; slug: string; title: string; summary: string;
  status: 'working' | 'partial' | 'planned'; actions: string[];
};
export const demoSessionKey = 'playsport:demo-session:v1';
export const demoModules: DemoModule[] = [
  { id: 'live-scoring', slug: 'live-scoring', title: 'Pizarra en vivo', summary: 'Lineups aprobados, anotación oficial y consulta compartida del partido.', status: 'working', actions: [] },
  { id: 'events-map', slug: 'events-map', title: 'Cartelera y mapa', summary: 'Partidos por fecha, ciudad, disciplina y sede.', status: 'planned', actions: ['Filtrar eventos', 'Consultar mapa de sedes', 'Sugerir un evento'] },
  { id: 'standings', slug: 'standings', title: 'Posiciones y honores', summary: 'Clasificación, líderes y reconocimientos por torneo.', status: 'planned', actions: ['Ver clasificación', 'Consultar líderes y MVP', 'Publicar resultados del torneo'] },
  { id: 'news', slug: 'news', title: 'Tribuna y prensa', summary: 'Crónicas, comentarios y moderación de la comunidad.', status: 'planned', actions: ['Publicar crónicas', 'Comentar partidos', 'Moderar reportes'] },
  { id: 'marketplace', slug: 'marketplace', title: 'Marketplace deportivo', summary: 'Tiendas y publicaciones de implementos deportivos.', status: 'planned', actions: ['Publicar artículos', 'Comprar implementos', 'Consultar tiendas'] },
  { id: 'player-career', slug: 'player-career', title: 'Perfil del jugador', summary: 'Hoja deportiva, estadísticas históricas y trayectoria.', status: 'planned', actions: ['Consultar trayectoria', 'Ver estadísticas acumuladas', 'Compartir highlights'] },
  { id: 'team-hq', slug: 'team-hq', title: 'Centro del manager', summary: 'Preparar el lineup del equipo y consultar el partido oficial.', status: 'working', actions: [] },
  { id: 'organizer-center', slug: 'organizer-center', title: 'Centro del organizador', summary: 'La anotación oficial está disponible; la gestión completa de torneos sigue pendiente.', status: 'partial', actions: ['Crear torneos desde la web', 'Administrar calendario y sedes', 'Aprobar rosters desde la web'] },
  { id: 'sponsors', slug: 'sponsors', title: 'Sponsors y partners', summary: 'Patrocinios, campañas y acuerdos comerciales.', status: 'planned', actions: ['Gestionar campañas', 'Consultar resultados comerciales', 'Administrar beneficios'] },
  { id: 'scouting', slug: 'scouting-watchlists', title: 'Scouting y talento', summary: 'Búsqueda de atletas, seguimiento y listas de prospectos.', status: 'planned', actions: ['Buscar atletas', 'Guardar watchlists', 'Consultar highlights'] }
];
export const moduleStatusLabels = { working: 'Disponible en el demo', partial: 'Parcialmente integrado', planned: 'Pendiente de implementar' };

export function readDemoSession(value: unknown): DemoSession | null {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('role' in value) || !isPlatformRoleId(value.role) ||
      !('team' in value) || value.team !== 'team-A' && value.team !== 'team-B') return null;
  return { version: 1, role: value.role, team: value.team };
}
export function demoIdentity(session: DemoSession) {
  if (session.role === 'manager') return {
    id: session.team === 'team-A' ? 'mgr-A' : 'mgr-B',
    name: `Dirigente de ${session.team === 'team-A' ? 'Tigres del Valle' : 'Leones del Norte'}`
  };
  const identities = {
    fan: { id: 'fan-demo', name: 'Fanático de demostración' },
    player: { id: 'player-demo', name: 'Jugador de demostración' },
    organizer: { id: 'org-demo', name: 'Organizador de demostración' },
    scorekeeper: { id: 'scorer-demo', name: 'Anotador de demostración' },
    scout: { id: 'scout-demo', name: 'Scout de demostración' }
  };
  return identities[session.role];
}
export function liveScoringHref(session: DemoSession) {
  if (session.role === 'organizer' || session.role === 'scorekeeper') return `/demo/live-scoring?view=${session.role}`;
  if (session.role === 'manager') return session.team === 'team-B' ? '/demo/live-scoring?view=rival' : '/demo/live-scoring';
  return '/demo/live-scoring?view=public';
}
export function demoModuleHref(module: DemoModule, session: DemoSession): string | null {
  if (!platformModuleIds(session.role).includes(module.id)) return null;
  return module.id === 'live-scoring' || module.id === 'team-hq' ? liveScoringHref(session) : `/demo/${module.slug}`;
}
export function legacyDemoSession(view?: string): DemoSession | null {
  if (view === 'public') return null;
  return { version: 1, role: view === 'organizer' || view === 'scorekeeper' ? view : 'manager', team: view === 'rival' ? 'team-B' : 'team-A' };
}
