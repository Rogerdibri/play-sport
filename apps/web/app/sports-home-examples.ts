import {
  replayPrivate,
  type PrivateCommand,
  type PrivatePlayer,
  type PrivateSeed,
} from '@playsport/shared';

export const homeExampleDate = '2026-11-13';
export const homeExampleNotice =
  'Vista de prueba con contenido aislado y jornada de referencia del 13 de noviembre de 2026. Los equipos seleccionados no son tus afiliaciones ni favoritos reales; las ofertas y noticias son ejemplos y los logos de BERA, DIKU, BERACARS, RICCIEGROUP, INDUSTRIAS HEDA y XPRESS MOTORS son referencias visuales, sin patrocinio confirmado.';

export const homeExampleGames = [
  {
    id: 'home-preview-semifinal',
    phase: 'Semifinal',
    status: 'live',
    date: homeExampleDate,
    time: '18:00',
    away: 'Cóndores del Ávila',
    home: 'Guardianes del Lago',
    following: true,
    finals: true,
  },
  {
    id: 'home-preview-final',
    phase: 'Final',
    status: 'scheduled',
    date: '2026-11-14',
    time: '19:00',
    away: 'Tigres del Valle',
    home: 'Leones del Norte',
    following: true,
    finals: true,
  },
  {
    id: 'home-preview-jornada',
    phase: 'Ronda inicial',
    status: 'scheduled',
    date: homeExampleDate,
    time: '20:00',
    away: 'Amazonas del Centro',
    home: 'Titanes del Este',
    following: false,
    finals: false,
  },
] as const;

export type HomeExampleGame = (typeof homeExampleGames)[number];
export type HomeHighlightFilter = 'all' | 'following' | 'today' | 'finals';
export const homeHighlightFilters: ReadonlyArray<{
  id: HomeHighlightFilter;
  label: string;
}> = [
  { id: 'all', label: 'Lo más destacado' },
  { id: 'following', label: 'Equipos seleccionados' },
  { id: 'today', label: 'Jornada' },
  { id: 'finals', label: 'Fases finales' },
];

export function homeGamesForFilter(filter: HomeHighlightFilter) {
  return homeExampleGames.filter((game) =>
    filter === 'following' ? game.following :
    filter === 'today' ? game.date === homeExampleDate :
    filter === 'finals' ? game.finals : true,
  );
}

export function homeGameState(game: HomeExampleGame) {
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const players = (side: 'away' | 'home'): PrivatePlayer[] =>
    positions.map((position, index) => ({
      id: `${game.id}:${side}:${index + 1}`,
      name: `Jugador ${index + 1}`,
      position,
      jersey: String(index + 1),
      order: index + 1,
    }));
  const lineups = { away: players('away'), home: players('home') };
  const seed: PrivateSeed = {
    names: { away: game.away, home: game.home },
    lineups,
    rosters: lineups,
    courtesyRunnerSource: 'ROSTER',
    regulationInnings: 9,
  };
  const commands: PrivateCommand[] = game.status === 'live' ? [
    { kind: 'play', result: 'homeRun' },
    { kind: 'play', result: 'strikeout' },
    { kind: 'play', result: 'strikeout' },
    { kind: 'play', result: 'strikeout' },
    { kind: 'play', result: 'homeRun' },
    { kind: 'play', result: 'single' },
    { kind: 'play', result: 'strikeout' },
    { kind: 'pitch', value: 'ball' },
    { kind: 'pitch', value: 'strike' },
  ] : [];
  return replayPrivate(seed, commands);
}

export const homeEditorialExamples = [
  {
    id: 'oferta-deportiva',
    category: 'Marketplace deportivo',
    title: 'Tu próximo entrenamiento empieza aquí',
    summary: 'Guante de béisbol de 12 pulgadas · precio de referencia $24.',
    action: 'Ver oferta',
    body: 'Guante para entrenamientos recreativos, con ajuste de muñeca y bolsillo para béisbol. Precio ilustrativo: $24 frente a $32, un descuento del 25 %. Esta ficha no tiene vendedor, stock ni pedido asociado: no permite comprar, reservar ni mover dinero.',
  },
  {
    id: 'noticia-comunidad',
    category: 'En la comunidad',
    title: 'El deporte une a toda la familia',
    summary: 'Una jornada que combina béisbol, entrenamiento y comunidad.',
    action: 'Leer noticia',
    body: 'Propuesta editorial: una comunidad deportiva organiza actividades para principiantes, entrenamiento de equipos y encuentros recreativos. Este relato sirve para visualizar una sección de noticias; no describe un evento publicado ni una convocatoria real.',
  },
  {
    id: 'publicidad',
    category: 'Publicidad · referencias visuales',
    title: 'Marcas en la cancha',
    summary: 'BERA · DIKU · BERACARS · RICCIEGROUP · INDUSTRIAS HEDA · XPRESS MOTORS',
    action: 'Ver espacio publicitario',
    body: 'Propuesta de franja de marcas debajo de la navegación, con los logos originales de BERA, DIKU, BERACARS, RICCIEGROUP, INDUSTRIAS HEDA y XPRESS MOTORS autorizados para esta prueba. Las imágenes conservan sus colores y proporciones y no se afirma un acuerdo comercial. No hay campañas, seguimiento publicitario ni anuncios contratados activos.',
  },
] as const;

export function homeHighlightHref(id: string) {
  return `/highlights/${id}`;
}
