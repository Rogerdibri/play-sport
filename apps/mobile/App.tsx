import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type TabId = 'home' | 'live' | 'events' | 'profile';

type RoleId = 'fan' | 'player' | 'manager' | 'organizer' | 'scorekeeper' | 'scout';

type ModuleId =
  | 'events-map'
  | 'live-scoring'
  | 'standings'
  | 'news'
  | 'marketplace'
  | 'player-career'
  | 'team-hq'
  | 'organizer-center'
  | 'sponsors'
  | 'scouting';

type RoleItem = {
  id: RoleId;
  label: string;
  summary: string;
  entitlement: string;
};

type ModuleItem = {
  id: ModuleId;
  badge: string;
  title: string;
  summary: string;
  actions: string[];
  kpis: Array<{ label: string; value: string }>;
};

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'home', label: 'Inicio' },
  { id: 'live', label: 'En Vivo' },
  { id: 'events', label: 'Cartelera' },
  { id: 'profile', label: 'Perfil' }
];

const roles: RoleItem[] = [
  {
    id: 'fan',
    label: 'Fanatico',
    summary: 'Sigue partidos, comenta, revisa cartelera y compra en marketplace.',
    entitlement: 'Solo funciones fanatico'
  },
  {
    id: 'player',
    label: 'Jugador',
    summary: 'Incluye funciones fanatico + hoja deportiva y seguimiento personal.',
    entitlement: 'Fanatico + Jugador'
  },
  {
    id: 'manager',
    label: 'Manager',
    summary: 'Incluye funciones fanatico + gestion de roster y anotacion individual no oficial.',
    entitlement: 'Fanatico + Manager'
  },
  {
    id: 'organizer',
    label: 'Organizador',
    summary: 'Incluye funciones fanatico + torneos y anotacion oficial/legal.',
    entitlement: 'Fanatico + Organizador'
  },
  {
    id: 'scorekeeper',
    label: 'Anotador',
    summary: 'Incluye funciones fanatico + anotacion oficial/legal del partido.',
    entitlement: 'Fanatico + Anotador'
  },
  {
    id: 'scout',
    label: 'Scout',
    summary: 'Incluye funciones fanatico + busqueda avanzada y watchlists.',
    entitlement: 'Fanatico + Scout'
  }
];

const modules: ModuleItem[] = [
  {
    id: 'live-scoring',
    badge: 'LV',
    title: 'Anotacion en Vivo',
    summary: 'Seguimiento en vivo; carga oficial solo por anotador u organizador.',
    actions: ['Registrar turno al bate', 'Actualizar pizarra', 'Cerrar juego y publicar estadisticas'],
    kpis: [
      { label: 'Juegos activos', value: '12' },
      { label: 'Eventos min', value: '47' },
      { label: 'Sync', value: 'OK' }
    ]
  },
  {
    id: 'events-map',
    badge: 'MP',
    title: 'Cartelera y Mapa',
    summary: 'Jornadas por fecha, ciudad y disciplina.',
    actions: ['Filtrar por ciudad', 'Abrir mapa de sedes', 'Sugerir evento comunitario'],
    kpis: [
      { label: 'Eventos hoy', value: '23' },
      { label: 'Sedes', value: '8' },
      { label: 'Byes resueltos', value: '5' }
    ]
  },
  {
    id: 'standings',
    badge: 'TB',
    title: 'Posiciones y Honores',
    summary: 'Tabla automatica y lideres por torneo.',
    actions: ['Ver tabla general', 'Consultar MVP', 'Compartir resultados'],
    kpis: [
      { label: 'Ligas', value: '6' },
      { label: 'Actualizacion', value: 'Tiempo real' },
      { label: 'Honores', value: '14' }
    ]
  },
  {
    id: 'news',
    badge: 'PR',
    title: 'Tribuna y Prensa',
    summary: 'Cronicas, entrevistas y moderacion social.',
    actions: ['Leer cronica', 'Comentar partido', 'Reportar contenido'],
    kpis: [
      { label: 'Notas semana', value: '34' },
      { label: 'Comentarios', value: '1.2K' },
      { label: 'Moderacion', value: 'Activa' }
    ]
  },
  {
    id: 'marketplace',
    badge: 'MK',
    title: 'Marketplace Deportivo',
    summary: 'Comercio oficial y C2C de implementos.',
    actions: ['Publicar articulo', 'Comprar implemento', 'Ver tienda patrocinada'],
    kpis: [
      { label: 'Publicaciones', value: '246' },
      { label: 'Tiendas aliadas', value: '11' },
      { label: 'Conversion', value: '8.3%' }
    ]
  },
  {
    id: 'player-career',
    badge: 'JR',
    title: 'Perfil de Jugador',
    summary: 'Estadisticas vitalicias y progreso deportivo.',
    actions: ['Ver hoja de vida deportiva', 'Revisar metrics ofensivas', 'Compartir highlights'],
    kpis: [
      { label: 'AVG', value: '.381' },
      { label: 'OBP', value: '.452' },
      { label: 'Temporadas', value: '4' }
    ]
  },
  {
    id: 'team-hq',
    badge: 'MG',
    title: 'Centro del Manager',
    summary: 'Roster, banca, alineacion y estrategia.',
    actions: ['Editar lineup', 'Mover banca', 'Analizar rendimiento colectivo'],
    kpis: [
      { label: 'Jugadores', value: '26' },
      { label: 'Lineups', value: '5' },
      { label: 'Racha', value: 'W4' }
    ]
  },
  {
    id: 'organizer-center',
    badge: 'OG',
    title: 'Centro del Organizador',
    summary: 'Torneos, calendario, sedes y reglas.',
    actions: ['Crear torneo', 'Aprobar calendario', 'Validar evento sugerido'],
    kpis: [
      { label: 'Torneos activos', value: '4' },
      { label: 'Partidos semana', value: '58' },
      { label: 'Sedes validadas', value: '17' }
    ]
  },
  {
    id: 'sponsors',
    badge: 'SP',
    title: 'Sponsors y Partners',
    summary: 'Monetizacion por banners y acuerdos comerciales.',
    actions: ['Activar campana', 'Ver ROI', 'Gestionar beneficios cruzados'],
    kpis: [
      { label: 'Campanas', value: '9' },
      { label: 'Comercios', value: '22' },
      { label: 'ROI', value: '2.4x' }
    ]
  },
  {
    id: 'scouting',
    badge: 'SC',
    title: 'Scouting y Watchlists',
    summary: 'Filtros avanzados para descubrir talento.',
    actions: ['Buscar atleta', 'Guardar en watchlist', 'Abrir highlights de YouTube'],
    kpis: [
      { label: 'Prospectos', value: '182' },
      { label: 'Watchlists', value: '19' },
      { label: 'Cobertura', value: '3 estados' }
    ]
  }
];

const fanCoreModules: ModuleId[] = ['live-scoring', 'events-map', 'standings', 'news', 'marketplace'];

const roleExtras: Record<RoleId, ModuleId[]> = {
  fan: [],
  player: ['player-career'],
  manager: ['team-hq'],
  organizer: ['organizer-center', 'sponsors'],
  scorekeeper: [],
  scout: ['scouting']
};

const moduleGroups: Record<TabId, ModuleId[]> = {
  home: ['live-scoring', 'events-map', 'standings', 'news', 'marketplace', 'player-career', 'team-hq', 'organizer-center'],
  live: ['live-scoring', 'standings', 'news', 'team-hq'],
  events: ['events-map', 'marketplace', 'sponsors', 'organizer-center'],
  profile: ['news', 'marketplace', 'player-career', 'team-hq', 'organizer-center', 'scouting']
};

const officialScoringRoles: RoleId[] = ['organizer', 'scorekeeper'];

const officialScoringApiBase = 'http://localhost:4000/api/official-scoring';

type UiStatus = {
  kind: 'idle' | 'success' | 'error';
  message: string;
};

type ManagerContext = {
  tournamentId: string;
  teamId: string;
  gameId: string;
  managerId: string;
};

type RosterPlayerView = {
  displayName: string;
  identificationNumber: string;
};

type LineupEntryDraft = {
  identificationNumber: string;
  battingOrder: number;
  fieldPosition: string;
};

type OfficialPlayEventOption = {
  value: string;
  label: string;
};

type OfficialPlayByPlaySnapshot = {
  baseRunners: {
    first: string | null;
    second: string | null;
    third: string | null;
  };
  totalEvents: number;
  recentEvents: Array<{
    sequence: number;
    type: string;
    description: string;
    offenseTeamId: string;
    batterIdentificationNumber: string | null;
    pitcherIdentificationNumber: string | null;
    timestamp: string;
  }>;
  batterStats: Array<{
    identificationNumber: string;
    plateAppearances: number;
    atBats: number;
    hits: number;
    runs: number;
    rbis: number;
    strikeouts: number;
    walks: number;
  }>;
  pitcherStats: Array<{
    identificationNumber: string;
    pitches: number;
    battersFaced: number;
    strikes: number;
    balls: number;
    hitsAllowed: number;
    runsAllowed: number;
    walksAllowed: number;
    strikeouts: number;
    outsRecorded: number;
  }>;
};

type TeamLineupView = {
  teamId: string;
  managerId: string;
  entries: LineupEntryDraft[];
  currentBatterIdentificationNumber: string | null;
};

type BaseRunnersState = {
  first: string | null;
  second: string | null;
  third: string | null;
};

type ManagerPlayResult = 'OUT' | 'BB' | 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'HOME_RUN';

type ManagerPlayLogItem = {
  id: string;
  teamId: string;
  batterIdentificationNumber: string;
  result: ManagerPlayResult;
  runsScored: number;
  inning: number;
};

type ManagerTacticalBatterRow = {
  identificationNumber: string;
  displayName: string;
  plateAppearances: number;
  hits: number;
  strikeouts: number;
  walks: number;
  runs: number;
  rbis: number;
  stolenBases: number;
};

type ManagerTacticalPitcherRow = {
  identificationNumber: string;
  displayName: string;
  pitches: number;
  battersFaced: number;
  hitsAllowed: number;
  runsAllowed: number;
  walksAllowed: number;
  strikeouts: number;
  outsRecorded: number;
};

type ManagerTacticalFieldingRow = {
  identificationNumber: string;
  displayName: string;
  errors: number;
  outsRecorded: number;
};

type ManagerTacticalTurnRow = {
  sequence: number;
  offenseTeamId: string;
  type: string;
  description: string;
  batterIdentificationNumber: string | null;
};

type ManagerTacticalSummary = {
  ownTeamId: string;
  rivalTeamId: string | null;
  totalEvents: number;
  ownBatting: ManagerTacticalBatterRow[];
  rivalBatting: ManagerTacticalBatterRow[];
  ownPitching: ManagerTacticalPitcherRow[];
  rivalPitching: ManagerTacticalPitcherRow[];
  ownFielding: ManagerTacticalFieldingRow[];
  rivalFielding: ManagerTacticalFieldingRow[];
  ownRecentTurns: ManagerTacticalTurnRow[];
  rivalRecentTurns: ManagerTacticalTurnRow[];
  alerts: string[];
};

const fieldPositionOptions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const officialPlayEventOptions: OfficialPlayEventOption[] = [
  { value: 'strike', label: 'Strike' },
  { value: 'bola', label: 'Bola' },
  { value: 'foul', label: 'Foul' },
  { value: 'base_por_bolas', label: 'Base por bolas' },
  { value: 'pelotazo', label: 'Pelotazo' },
  { value: 'sencillo', label: 'Sencillo' },
  { value: 'doble', label: 'Doble' },
  { value: 'triple', label: 'Triple' },
  { value: 'jonron', label: 'Jonron' },
  { value: 'ponche', label: 'Ponche' },
  { value: 'out', label: 'Out general' },
  { value: 'out_rolling', label: 'Out por rolling' },
  { value: 'out_elevado', label: 'Out por elevado' },
  { value: 'out_linea', label: 'Out por linea' },
  { value: 'doble_play', label: 'Doble play' },
  { value: 'triple_play', label: 'Triple play' },
  { value: 'out_forzado', label: 'Out forzado' },
  { value: 'toque', label: 'Toque de bola (out)' },
  { value: 'robo_base', label: 'Robo de base' },
  { value: 'atrapado_robando', label: 'Atrapado robando' },
  { value: 'pickoff', label: 'Pickoff' },
  { value: 'lanzamiento_descontrolado', label: 'Lanzamiento descontrolado' },
  { value: 'bola_pasada', label: 'Bola pasada' },
  { value: 'balk', label: 'Balk' },
  { value: 'carrera', label: 'Carrera' },
  { value: 'error', label: 'Error' }
];
const managerPlayResultOptions: Array<{ value: ManagerPlayResult; label: string }> = [
  { value: 'OUT', label: 'Out' },
  { value: 'BB', label: 'Base por bolas' },
  { value: 'SINGLE', label: 'Sencillo' },
  { value: 'DOUBLE', label: 'Doble' },
  { value: 'TRIPLE', label: 'Triple' },
  { value: 'HOME_RUN', label: 'Jonron' }
];

function normalizeCedula(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseApiMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const maybeMessage = (payload as { message?: unknown }).message;

  if (typeof maybeMessage === 'string') {
    return maybeMessage;
  }

  if (Array.isArray(maybeMessage)) {
    const parts = maybeMessage.filter((item) => typeof item === 'string');
    return parts.join(' ');
  }

  return null;
}

function adaptManagerError(message: string) {
  if (message.includes('ya pertenece al roster del equipo')) {
    return 'Esta cedula ya esta en otro equipo dentro de este mismo torneo. Si puede jugar en otro equipo si es en otro torneo.';
  }

  if (message.includes('ya dirige el equipo')) {
    return 'Ese manager ya dirige otro equipo dentro del mismo torneo. Puede dirigir en torneos diferentes.';
  }

  if (message.includes('no existe en el registro global')) {
    return 'Esta cedula no existe en el registro global. Registra al jugador una sola vez y luego vuelve a intentarlo.';
  }

  return message;
}

function getLiveScoringActions(roleId: RoleId): string[] {
  if (officialScoringRoles.includes(roleId)) {
    return [
      'Registrar jugada oficial (strike/bola/hit/out)',
      'Cargar bitacora y estadisticas',
      'Cerrar juego y publicar resultado legal'
    ];
  }

  if (roleId === 'manager') {
    return [
      'Registrar jugada privada de mi equipo',
      'Actualizar pizarra privada de seguimiento',
      'Guardar anotacion individual del manager'
    ];
  }

  return [];
}

function getLiveScoringMode(roleId: RoleId): string {
  if (officialScoringRoles.includes(roleId)) {
    return 'Modo oficial/legal';
  }

  if (roleId === 'manager') {
    return 'Modo individual del manager';
  }

  return 'Modo solo lectura';
}

function getLiveScoringRule(roleId: RoleId): string {
  if (officialScoringRoles.includes(roleId)) {
    return 'Tus anotaciones se consideran oficiales y definen el resultado legal del juego.';
  }

  if (roleId === 'manager') {
    return 'Puedes anotar para analisis interno. Esta anotacion no modifica el resultado oficial.';
  }

  return 'Este perfil solo puede ver la pizarra. La anotacion oficial la realiza un anotador u organizador.';
}

function getAccessPolicy(roleId: RoleId): string {
  if (roleId === 'fan') {
    return 'Como fanatico ves funciones fanatico y el en vivo en solo lectura.';
  }

  if (roleId === 'manager') {
    return 'Tienes funciones fanatico + manager. Tu anotacion en vivo es individual y no oficial.';
  }

  if (officialScoringRoles.includes(roleId)) {
    return 'Tienes funciones fanatico + permisos de anotacion oficial/legal en vivo.';
  }

  return 'Tienes funciones fanatico + herramientas especializadas de tu rol. El en vivo es solo lectura.';
}

const liveFeed = [
  {
    league: 'Liga Norte U23',
    game: 'Leones 6 - 4 Tiburones',
    state: '7mo inning, 1 out, corredor en 2da'
  },
  {
    league: 'Softbol Femenino Capital',
    game: 'Amazonas 2 - 2 Titanes',
    state: '5to inning, cuenta completa'
  }
];

const activityFeed = [
  'Se publico Cuadro de Honor de la semana.',
  'Nuevo evento sugerido: Cuadrangular Comunitario Sabado.',
  'Scout activo agrego 3 jugadoras a watchlist.',
  'Marketplace: 14 publicaciones nuevas hoy.'
];

const profileStats = [
  { label: 'AVG temporada', value: '.381' },
  { label: 'OBP', value: '.452' },
  { label: 'Juegos seguidos', value: '9' }
];

type LiveScoreState = {
  inning: number;
  outs: number;
  balls: number;
  strikes: number;
  homeScore: number;
  awayScore: number;
  status: 'scheduled' | 'in_progress' | 'final';
  lastPlay: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
};

const initialLiveScoreState: LiveScoreState = {
  inning: 1,
  outs: 0,
  balls: 0,
  strikes: 0,
  homeScore: 0,
  awayScore: 0,
  status: 'scheduled',
  lastPlay: 'Sin eventos oficiales',
  version: 0,
  updatedBy: 'Sistema',
  updatedAt: new Date().toISOString()
};

function applyLiveAction(current: LiveScoreState, action: string, actor: string): LiveScoreState {
  const next: LiveScoreState = {
    ...current,
    version: current.version + 1,
    updatedBy: actor,
    updatedAt: new Date().toISOString()
  };

  if (action.includes('turno') || action.includes('jugada')) {
    next.strikes = Math.min(2, current.strikes + 1);
    next.status = current.status === 'scheduled' ? 'in_progress' : current.status;
    next.lastPlay = action;
    return next;
  }

  if (action.includes('pizarra')) {
    next.homeScore = current.homeScore + 1;
    next.balls = 0;
    next.strikes = 0;
    next.status = 'in_progress';
    next.lastPlay = action;
    return next;
  }

  if (action.includes('Cerrar juego') || action.includes('resultado legal')) {
    next.status = 'final';
    next.lastPlay = action;
    return next;
  }

  next.lastPlay = action;
  return next;
}

function resolveManagerPlay(
  bases: BaseRunnersState,
  batterIdentificationNumber: string,
  result: ManagerPlayResult
) {
  if (result === 'OUT') {
    return {
      nextBases: { ...bases },
      runsScored: 0
    };
  }

  if (result === 'BB') {
    if (!bases.first) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.second,
          third: bases.third
        },
        runsScored: 0
      };
    }

    if (!bases.second) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.first,
          third: bases.third
        },
        runsScored: 0
      };
    }

    if (!bases.third) {
      return {
        nextBases: {
          first: batterIdentificationNumber,
          second: bases.first,
          third: bases.second
        },
        runsScored: 0
      };
    }

    return {
      nextBases: {
        first: batterIdentificationNumber,
        second: bases.first,
        third: bases.second
      },
      runsScored: 1
    };
  }

  if (result === 'SINGLE') {
    return {
      nextBases: {
        first: batterIdentificationNumber,
        second: bases.first,
        third: bases.second
      },
      runsScored: bases.third ? 1 : 0
    };
  }

  if (result === 'DOUBLE') {
    return {
      nextBases: {
        first: null,
        second: batterIdentificationNumber,
        third: bases.first
      },
      runsScored: (bases.second ? 1 : 0) + (bases.third ? 1 : 0)
    };
  }

  if (result === 'TRIPLE') {
    return {
      nextBases: {
        first: null,
        second: null,
        third: batterIdentificationNumber
      },
      runsScored: (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0)
    };
  }

  return {
    nextBases: {
      first: null,
      second: null,
      third: null
    },
    runsScored: (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0) + 1
  };
}

export default function App() {
  const [sessionRoleId, setSessionRoleId] = useState<RoleId | null>(null);
  const [roleDraft, setRoleDraft] = useState<RoleId>('fan');
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [activeModuleId, setActiveModuleId] = useState<ModuleId | null>(null);
  const [lastAction, setLastAction] = useState('');
  const [officialLiveState, setOfficialLiveState] = useState<LiveScoreState>(initialLiveScoreState);
  const [managerPrivateLiveState, setManagerPrivateLiveState] = useState<LiveScoreState>({
    ...initialLiveScoreState,
    updatedBy: 'Manager',
    lastPlay: 'Sin anotaciones privadas'
  });
  const [managerTournamentId, setManagerTournamentId] = useState('tour-global-1');
  const [managerTeamId, setManagerTeamId] = useState('team-A');
  const [managerGameId, setManagerGameId] = useState('game-global-1');
  const [managerProfileId, setManagerProfileId] = useState('mgr-A');
  const [managerPlayerNameDraft, setManagerPlayerNameDraft] = useState('');
  const [managerPlayerCedulaDraft, setManagerPlayerCedulaDraft] = useState('');
  const [managerRepresentativeCedulaDraft, setManagerRepresentativeCedulaDraft] = useState('');
  const [managerIsMinorDraft, setManagerIsMinorDraft] = useState(false);
  const [managerRosterCedulaDraft, setManagerRosterCedulaDraft] = useState('');
  const [managerRosterCedulas, setManagerRosterCedulas] = useState<string[]>([]);
  const [managerRosterPlayers, setManagerRosterPlayers] = useState<RosterPlayerView[]>([]);
  const [managerLineupCedulaDraft, setManagerLineupCedulaDraft] = useState('');
  const [managerLineupBattingOrderDraft, setManagerLineupBattingOrderDraft] = useState('1');
  const [managerLineupFieldPositionDraft, setManagerLineupFieldPositionDraft] = useState('P');
  const [managerLineupEntries, setManagerLineupEntries] = useState<LineupEntryDraft[]>([]);
  const [managerOwnLineupView, setManagerOwnLineupView] = useState<TeamLineupView | null>(null);
  const [managerRivalLineupView, setManagerRivalLineupView] = useState<TeamLineupView | null>(null);
  const [managerLiveOffenseTeamId, setManagerLiveOffenseTeamId] = useState('');
  const [managerLiveBatterCedula, setManagerLiveBatterCedula] = useState('');
  const [managerLiveResultDraft, setManagerLiveResultDraft] = useState<ManagerPlayResult>('OUT');
  const [managerBaseRunners, setManagerBaseRunners] = useState<BaseRunnersState>({
    first: null,
    second: null,
    third: null
  });
  const [managerBattingIndexByTeam, setManagerBattingIndexByTeam] = useState<Record<string, number>>({});
  const [managerPlayLog, setManagerPlayLog] = useState<ManagerPlayLogItem[]>([]);
  const [managerTacticalSummary, setManagerTacticalSummary] = useState<ManagerTacticalSummary | null>(null);
  const [managerTacticalLoading, setManagerTacticalLoading] = useState(false);
  const [managerContextReady, setManagerContextReady] = useState(false);
  const [managerUiStatus, setManagerUiStatus] = useState<UiStatus>({ kind: 'idle', message: '' });
  const [managerSubmitting, setManagerSubmitting] = useState(false);
  const [officialTournamentId, setOfficialTournamentId] = useState('tour-2026');
  const [officialGameId, setOfficialGameId] = useState('game-88');
  const [officialActorId, setOfficialActorId] = useState('score-1');
  const [officialOffenseTeamIdDraft, setOfficialOffenseTeamIdDraft] = useState('');
  const [officialBatterCedulaDraft, setOfficialBatterCedulaDraft] = useState('');
  const [officialPitcherCedulaDraft, setOfficialPitcherCedulaDraft] = useState('');
  const [officialRunnerCedulaDraft, setOfficialRunnerCedulaDraft] = useState('');
  const [officialFielderCedulaDraft, setOfficialFielderCedulaDraft] = useState('');
  const [officialFromBaseDraft, setOfficialFromBaseDraft] = useState('');
  const [officialToBaseDraft, setOfficialToBaseDraft] = useState('');
  const [officialRunsScoredDraft, setOfficialRunsScoredDraft] = useState('');
  const [officialOutsRecordedDraft, setOfficialOutsRecordedDraft] = useState('');
  const [officialEventTypeDraft, setOfficialEventTypeDraft] = useState('strike');
  const [officialUiStatus, setOfficialUiStatus] = useState<UiStatus>({ kind: 'idle', message: '' });
  const [officialSubmitting, setOfficialSubmitting] = useState(false);
  const [officialPlayByPlaySnapshot, setOfficialPlayByPlaySnapshot] = useState<OfficialPlayByPlaySnapshot | null>(null);

  const currentRoleId: RoleId = sessionRoleId ?? roleDraft;

  const activeRole = useMemo(
    () => roles.find((role) => role.id === currentRoleId) ?? roles[0],
    [currentRoleId]
  );

  const allowedModuleIds = useMemo(() => {
    if (!sessionRoleId) {
      return [] as ModuleId[];
    }

    const merged = [...fanCoreModules, ...roleExtras[sessionRoleId]];
    return Array.from(new Set(merged));
  }, [sessionRoleId]);

  const visibleModules = useMemo(() => {
    if (!sessionRoleId) {
      return [] as ModuleItem[];
    }

    const groupIds = moduleGroups[activeTab];
    return groupIds
      .filter((id) => allowedModuleIds.includes(id))
      .map((id) => modules.find((module) => module.id === id))
      .filter((module): module is ModuleItem => Boolean(module));
  }, [activeTab, allowedModuleIds, sessionRoleId]);

  const activeModule = useMemo(
    () => modules.find((module) => module.id === activeModuleId) ?? null,
    [activeModuleId]
  );

  const openModule = (moduleId: ModuleId) => {
    if (!allowedModuleIds.includes(moduleId)) {
      return;
    }

    setLastAction('');
    setActiveModuleId(moduleId);
  };

  const handleModuleAction = (action: string) => {
    setLastAction(action);

    if (!activeModule || activeModule.id !== 'live-scoring') {
      return;
    }

    if (officialScoringRoles.includes(currentRoleId)) {
      if (action.includes('bitacora') || action.includes('estadisticas')) {
        void loadOfficialPlayByPlayFromApi();
      }

      setOfficialLiveState((current) => applyLiveAction(current, action, activeRole.label));
      return;
    }

    if (currentRoleId === 'manager') {
      setManagerPrivateLiveState((current) => applyLiveAction(current, action, activeRole.label));
    }
  };

  const confirmRole = () => {
    setSessionRoleId(roleDraft);
    setActiveTab(roleDraft === 'manager' ? 'profile' : 'home');
    setActiveModuleId(null);
    setLastAction('');
    if (roleDraft === 'manager') {
      setManagerContextReady(false);
      setManagerOwnLineupView(null);
      setManagerRivalLineupView(null);
      setManagerLiveOffenseTeamId('');
      setManagerLiveBatterCedula('');
      setManagerBattingIndexByTeam({});
      setManagerBaseRunners({ first: null, second: null, third: null });
      setManagerPlayLog([]);
      setManagerTacticalSummary(null);
      setManagerTacticalLoading(false);
      setManagerUiStatus({
        kind: 'idle',
        message: ''
      });
    }
  };

  const changeRole = () => {
    setRoleDraft(sessionRoleId ?? 'fan');
    setSessionRoleId(null);
    setActiveTab('home');
    setActiveModuleId(null);
    setLastAction('');
    setManagerContextReady(false);
    setManagerOwnLineupView(null);
    setManagerRivalLineupView(null);
    setManagerLiveOffenseTeamId('');
    setManagerLiveBatterCedula('');
    setManagerBattingIndexByTeam({});
    setManagerBaseRunners({ first: null, second: null, third: null });
    setManagerPlayLog([]);
    setManagerTacticalSummary(null);
    setManagerTacticalLoading(false);
  };

  const managerRosterNamesByCedula = useMemo(() => {
    const map = new Map<string, string>();

    for (const player of managerRosterPlayers) {
      map.set(player.identificationNumber, player.displayName);
    }

    return map;
  }, [managerRosterPlayers]);

  const managerLiveOffenseLineup = useMemo(() => {
    if (!managerLiveOffenseTeamId) {
      return [] as LineupEntryDraft[];
    }

    if (managerOwnLineupView && managerOwnLineupView.teamId === managerLiveOffenseTeamId) {
      return managerOwnLineupView.entries;
    }

    if (managerRivalLineupView && managerRivalLineupView.teamId === managerLiveOffenseTeamId) {
      return managerRivalLineupView.entries;
    }

    return [] as LineupEntryDraft[];
  }, [managerLiveOffenseTeamId, managerOwnLineupView, managerRivalLineupView]);

  const managerLiveCurrentBatter = useMemo(() => {
    if (!managerLiveOffenseTeamId || managerLiveOffenseLineup.length === 0) {
      return null;
    }

    const lineupIndex = managerBattingIndexByTeam[managerLiveOffenseTeamId] ?? 0;
    const resolvedIndex = lineupIndex % managerLiveOffenseLineup.length;
    return managerLiveOffenseLineup[resolvedIndex]?.identificationNumber ?? null;
  }, [managerBattingIndexByTeam, managerLiveOffenseLineup, managerLiveOffenseTeamId]);

  const managerLiveResultLabel = useMemo(() => {
    const found = managerPlayResultOptions.find((item) => item.value === managerLiveResultDraft);
    return found?.label ?? managerLiveResultDraft;
  }, [managerLiveResultDraft]);

  const updateManagerTournamentId = (value: string) => {
    setManagerTournamentId(value);
    setManagerContextReady(false);
    setManagerOwnLineupView(null);
    setManagerRivalLineupView(null);
    setManagerLiveOffenseTeamId('');
    setManagerLiveBatterCedula('');
    setManagerBattingIndexByTeam({});
    setManagerBaseRunners({ first: null, second: null, third: null });
    setManagerPlayLog([]);
    setManagerTacticalSummary(null);
    setManagerTacticalLoading(false);
  };

  const updateManagerTeamId = (value: string) => {
    setManagerTeamId(value);
    setManagerContextReady(false);
    setManagerOwnLineupView(null);
    setManagerRivalLineupView(null);
    setManagerLiveOffenseTeamId('');
    setManagerLiveBatterCedula('');
    setManagerBattingIndexByTeam({});
    setManagerBaseRunners({ first: null, second: null, third: null });
    setManagerPlayLog([]);
    setManagerTacticalSummary(null);
    setManagerTacticalLoading(false);
  };

  const updateManagerGameId = (value: string) => {
    setManagerGameId(value);
    setManagerContextReady(false);
    setManagerOwnLineupView(null);
    setManagerRivalLineupView(null);
    setManagerLiveOffenseTeamId('');
    setManagerLiveBatterCedula('');
    setManagerBattingIndexByTeam({});
    setManagerBaseRunners({ first: null, second: null, third: null });
    setManagerPlayLog([]);
    setManagerTacticalSummary(null);
    setManagerTacticalLoading(false);
  };

  const updateManagerProfileId = (value: string) => {
    setManagerProfileId(value);
    setManagerContextReady(false);
    setManagerOwnLineupView(null);
    setManagerRivalLineupView(null);
    setManagerLiveOffenseTeamId('');
    setManagerLiveBatterCedula('');
    setManagerBattingIndexByTeam({});
    setManagerBaseRunners({ first: null, second: null, third: null });
    setManagerPlayLog([]);
    setManagerTacticalSummary(null);
    setManagerTacticalLoading(false);
  };

  const buildManagerContext = (): ManagerContext => ({
    tournamentId: managerTournamentId.trim(),
    teamId: managerTeamId.trim(),
    gameId: managerGameId.trim(),
    managerId: managerProfileId.trim()
  });

  const postOfficialScoring = async (path: string, payload: unknown) => {
    const response = await fetch(`${officialScoringApiBase}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = parseApiMessage(body) ?? `Error ${response.status}`;
      throw new Error(message);
    }

    return body;
  };

  const getOfficialScoring = async (path: string) => {
    const response = await fetch(`${officialScoringApiBase}/${path}`);
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message = parseApiMessage(body) ?? `Error ${response.status}`;
      throw new Error(message);
    }

    return body;
  };

  const parseOptionalBase = (value: string) => {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  };

  const adaptOfficialPlayByPlay = (raw: unknown): OfficialPlayByPlaySnapshot | null => {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const baseRunnersRaw = (raw as { baseRunners?: unknown }).baseRunners;
    const baseRunners =
      baseRunnersRaw && typeof baseRunnersRaw === 'object'
        ? {
            first:
              typeof (baseRunnersRaw as { first?: unknown }).first === 'string'
                ? (baseRunnersRaw as { first: string }).first
                : null,
            second:
              typeof (baseRunnersRaw as { second?: unknown }).second === 'string'
                ? (baseRunnersRaw as { second: string }).second
                : null,
            third:
              typeof (baseRunnersRaw as { third?: unknown }).third === 'string'
                ? (baseRunnersRaw as { third: string }).third
                : null
          }
        : { first: null, second: null, third: null };

    const totalEventsRaw = (raw as { totalEvents?: unknown }).totalEvents;
    const totalEvents = typeof totalEventsRaw === 'number' ? totalEventsRaw : 0;

    const recentEventsRaw = (raw as { recentEvents?: unknown }).recentEvents;
    const recentEvents = Array.isArray(recentEventsRaw)
      ? recentEventsRaw
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const sequence =
              typeof (item as { sequence?: unknown }).sequence === 'number'
                ? (item as { sequence: number }).sequence
                : 0;

            const type =
              typeof (item as { type?: unknown }).type === 'string'
                ? (item as { type: string }).type
                : 'N/A';

            const description =
              typeof (item as { description?: unknown }).description === 'string'
                ? (item as { description: string }).description
                : '';

            const offenseTeamId =
              typeof (item as { offenseTeamId?: unknown }).offenseTeamId === 'string'
                ? (item as { offenseTeamId: string }).offenseTeamId
                : 'N/A';

            const batterIdentificationNumber =
              typeof (item as { batterIdentificationNumber?: unknown }).batterIdentificationNumber === 'string'
                ? (item as { batterIdentificationNumber: string }).batterIdentificationNumber
                : null;

            const pitcherIdentificationNumber =
              typeof (item as { pitcherIdentificationNumber?: unknown }).pitcherIdentificationNumber === 'string'
                ? (item as { pitcherIdentificationNumber: string }).pitcherIdentificationNumber
                : null;

            const timestamp =
              typeof (item as { timestamp?: unknown }).timestamp === 'string'
                ? (item as { timestamp: string }).timestamp
                : new Date().toISOString();

            return {
              sequence,
              type,
              description,
              offenseTeamId,
              batterIdentificationNumber,
              pitcherIdentificationNumber,
              timestamp
            };
          })
          .filter(
            (
              item
            ): item is {
              sequence: number;
              type: string;
              description: string;
              offenseTeamId: string;
              batterIdentificationNumber: string | null;
              pitcherIdentificationNumber: string | null;
              timestamp: string;
            } => Boolean(item)
          )
      : [];

    const batterStatsRaw = (raw as { batterStats?: unknown }).batterStats;
    const batterStats = Array.isArray(batterStatsRaw)
      ? batterStatsRaw
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const identificationNumber =
              typeof (item as { identificationNumber?: unknown }).identificationNumber === 'string'
                ? (item as { identificationNumber: string }).identificationNumber
                : '';

            if (!identificationNumber) {
              return null;
            }

            return {
              identificationNumber,
              plateAppearances: Number((item as { plateAppearances?: unknown }).plateAppearances ?? 0),
              atBats: Number((item as { atBats?: unknown }).atBats ?? 0),
              hits: Number((item as { hits?: unknown }).hits ?? 0),
              runs: Number((item as { runs?: unknown }).runs ?? 0),
              rbis: Number((item as { rbis?: unknown }).rbis ?? 0),
              strikeouts: Number((item as { strikeouts?: unknown }).strikeouts ?? 0),
              walks: Number((item as { walks?: unknown }).walks ?? 0)
            };
          })
          .filter((item): item is OfficialPlayByPlaySnapshot['batterStats'][number] => Boolean(item))
      : [];

    const pitcherStatsRaw = (raw as { pitcherStats?: unknown }).pitcherStats;
    const pitcherStats = Array.isArray(pitcherStatsRaw)
      ? pitcherStatsRaw
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }

            const identificationNumber =
              typeof (item as { identificationNumber?: unknown }).identificationNumber === 'string'
                ? (item as { identificationNumber: string }).identificationNumber
                : '';

            if (!identificationNumber) {
              return null;
            }

            return {
              identificationNumber,
              pitches: Number((item as { pitches?: unknown }).pitches ?? 0),
              battersFaced: Number((item as { battersFaced?: unknown }).battersFaced ?? 0),
              strikes: Number((item as { strikes?: unknown }).strikes ?? 0),
              balls: Number((item as { balls?: unknown }).balls ?? 0),
              hitsAllowed: Number((item as { hitsAllowed?: unknown }).hitsAllowed ?? 0),
              runsAllowed: Number((item as { runsAllowed?: unknown }).runsAllowed ?? 0),
              walksAllowed: Number((item as { walksAllowed?: unknown }).walksAllowed ?? 0),
              strikeouts: Number((item as { strikeouts?: unknown }).strikeouts ?? 0),
              outsRecorded: Number((item as { outsRecorded?: unknown }).outsRecorded ?? 0)
            };
          })
          .filter((item): item is OfficialPlayByPlaySnapshot['pitcherStats'][number] => Boolean(item))
      : [];

    return {
      baseRunners,
      totalEvents,
      recentEvents,
      batterStats,
      pitcherStats
    };
  };

  const loadOfficialPlayByPlayFromApi = async (opts?: { silent?: boolean }) => {
    const tournamentId = officialTournamentId.trim();
    const gameId = officialGameId.trim();

    if (!tournamentId || !gameId) {
      setOfficialUiStatus({
        kind: 'error',
        message: 'Completa tournamentId y gameId para cargar jugada a jugada oficial.'
      });
      return;
    }

    setOfficialSubmitting(true);

    try {
      const stateResponse = await getOfficialScoring(`games/${gameId}/state?tournamentId=${tournamentId}`);
      const playByPlayResponse = await getOfficialScoring(
        `games/${gameId}/play-by-play?tournamentId=${tournamentId}&visibility=free`
      );

      const state = (stateResponse as { state?: unknown }).state;
      if (state && typeof state === 'object') {
        setOfficialLiveState((current) => ({
          ...current,
          inning: Number((state as { inning?: unknown }).inning ?? current.inning),
          outs: Number((state as { outs?: unknown }).outs ?? current.outs),
          balls: Number((state as { balls?: unknown }).balls ?? current.balls),
          strikes: Number((state as { strikes?: unknown }).strikes ?? current.strikes),
          homeScore: Number((state as { homeScore?: unknown }).homeScore ?? current.homeScore),
          awayScore: Number((state as { awayScore?: unknown }).awayScore ?? current.awayScore),
          status:
            (typeof (state as { status?: unknown }).status === 'string'
              ? (state as { status: LiveScoreState['status'] }).status
              : current.status),
          lastPlay:
            (typeof (state as { lastPlay?: unknown }).lastPlay === 'string'
              ? (state as { lastPlay: string }).lastPlay
              : current.lastPlay),
          version: Number((state as { officialVersion?: unknown }).officialVersion ?? current.version),
          updatedBy: (state as { updatedBy?: { id?: unknown } }).updatedBy?.id
            ? String((state as { updatedBy?: { id?: unknown } }).updatedBy?.id)
            : current.updatedBy,
          updatedAt:
            (typeof (state as { updatedAt?: unknown }).updatedAt === 'string'
              ? (state as { updatedAt: string }).updatedAt
              : current.updatedAt)
        }));
      }

      const playByPlayRaw = (playByPlayResponse as { playByPlay?: unknown }).playByPlay;
      setOfficialPlayByPlaySnapshot(adaptOfficialPlayByPlay(playByPlayRaw));

      if (!opts?.silent) {
        setOfficialUiStatus({
          kind: 'success',
          message: `Bitacora oficial cargada para ${gameId}.`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar jugada a jugada oficial.';
      setOfficialUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setOfficialSubmitting(false);
    }
  };

  const submitOfficialPlayEvent = async () => {
    const tournamentId = officialTournamentId.trim();
    const gameId = officialGameId.trim();
    const actorId = officialActorId.trim();

    if (!tournamentId || !gameId || !actorId) {
      setOfficialUiStatus({
        kind: 'error',
        message: 'Debes indicar tournamentId, gameId y actorId para registrar jugada oficial.'
      });
      return;
    }

    setOfficialSubmitting(true);
    setOfficialUiStatus({ kind: 'idle', message: '' });

    try {
      const response = await postOfficialScoring(`games/${gameId}/official-updates`, {
        tournamentId,
        actorId,
        actorRole: currentRoleId === 'organizer' ? 'organizer' : 'scorekeeper',
        patch: {},
        playEvent: {
          type: officialEventTypeDraft,
          teamId: officialOffenseTeamIdDraft.trim() || undefined,
          batterIdentificationNumber: officialBatterCedulaDraft.trim() || undefined,
          pitcherIdentificationNumber: officialPitcherCedulaDraft.trim() || undefined,
          runnerIdentificationNumber: officialRunnerCedulaDraft.trim() || undefined,
          fielderIdentificationNumber: officialFielderCedulaDraft.trim() || undefined,
          fromBase: parseOptionalBase(officialFromBaseDraft),
          toBase: parseOptionalBase(officialToBaseDraft),
          runsScored: parseOptionalBase(officialRunsScoredDraft),
          outsRecorded: parseOptionalBase(officialOutsRecordedDraft)
        }
      });

      const state = (response as { state?: unknown }).state;
      if (state && typeof state === 'object') {
        setOfficialLiveState((current) => ({
          ...current,
          inning: Number((state as { inning?: unknown }).inning ?? current.inning),
          outs: Number((state as { outs?: unknown }).outs ?? current.outs),
          balls: Number((state as { balls?: unknown }).balls ?? current.balls),
          strikes: Number((state as { strikes?: unknown }).strikes ?? current.strikes),
          homeScore: Number((state as { homeScore?: unknown }).homeScore ?? current.homeScore),
          awayScore: Number((state as { awayScore?: unknown }).awayScore ?? current.awayScore),
          status:
            (typeof (state as { status?: unknown }).status === 'string'
              ? (state as { status: LiveScoreState['status'] }).status
              : current.status),
          lastPlay:
            (typeof (state as { lastPlay?: unknown }).lastPlay === 'string'
              ? (state as { lastPlay: string }).lastPlay
              : current.lastPlay),
          version: Number((state as { officialVersion?: unknown }).officialVersion ?? current.version),
          updatedBy: (state as { updatedBy?: { id?: unknown } }).updatedBy?.id
            ? String((state as { updatedBy?: { id?: unknown } }).updatedBy?.id)
            : current.updatedBy,
          updatedAt:
            (typeof (state as { updatedAt?: unknown }).updatedAt === 'string'
              ? (state as { updatedAt: string }).updatedAt
              : current.updatedAt)
        }));
      }

      const playByPlayRaw = (response as { playByPlay?: unknown }).playByPlay;
      setOfficialPlayByPlaySnapshot(adaptOfficialPlayByPlay(playByPlayRaw));

      setOfficialUiStatus({
        kind: 'success',
        message: 'Jugada oficial registrada correctamente.'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar la jugada oficial.';
      setOfficialUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setOfficialSubmitting(false);
    }
  };

  const loadRosterFromContext = async (context: ManagerContext, opts?: { silent?: boolean }) => {
    setManagerSubmitting(true);

    try {
      const roster = await getOfficialScoring(
        `tournaments/${context.tournamentId}/teams/${context.teamId}/roster?visibility=free`
      );

      const rosterIdsRaw =
        (roster as { rosterPlayerIdentificationNumbers?: unknown }).rosterPlayerIdentificationNumbers;
      const rosterIds = Array.isArray(rosterIdsRaw)
        ? Array.from(
            new Set(
              rosterIdsRaw
                .filter((item): item is string => typeof item === 'string')
                .map((item) => normalizeCedula(item))
                .filter((item) => item.length >= 4)
            )
          )
        : [];

      const rosterPlayersRaw = (roster as { rosterPlayers?: unknown }).rosterPlayers;
      const rosterPlayers = Array.isArray(rosterPlayersRaw)
        ? rosterPlayersRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const displayName =
                typeof (item as { displayName?: unknown }).displayName === 'string'
                  ? (item as { displayName: string }).displayName.trim()
                  : '';

              const identificationNumberSource =
                (item as { identificationNumber?: unknown }).identificationNumber ??
                (item as { playerId?: unknown }).playerId;

              const identificationNumber =
                typeof identificationNumberSource === 'string'
                  ? normalizeCedula(identificationNumberSource)
                  : '';

              if (!displayName || identificationNumber.length < 4) {
                return null;
              }

              return {
                displayName,
                identificationNumber
              } as RosterPlayerView;
            })
            .filter((item): item is RosterPlayerView => Boolean(item))
        : [];

      setManagerRosterCedulas(rosterIds);
      setManagerRosterPlayers(rosterPlayers);
      setManagerLineupEntries((current) =>
        current
          .filter((entry) => rosterIds.includes(entry.identificationNumber))
          .sort((a, b) => a.battingOrder - b.battingOrder)
      );

      if (!opts?.silent) {
        setManagerUiStatus({
          kind: 'success',
          message: `Contexto activado. Roster oficial cargado para ${context.teamId} (${rosterIds.length} jugador(es)).`
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo revisar el roster oficial.';

      if (message.includes('No existe roster oficial para el equipo')) {
        setManagerRosterCedulas([]);
        setManagerRosterPlayers([]);
        setManagerLineupEntries([]);

        if (!opts?.silent) {
          setManagerUiStatus({
            kind: 'success',
            message: `Contexto activado para ${context.teamId} en ${context.tournamentId}. Aun no hay roster guardado.`
          });
        }

        return;
      }

      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const activateManagerContext = async () => {
    const context = buildManagerContext();

    if (!context.tournamentId || !context.teamId || !context.gameId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Completa tournamentId, teamId, gameId y managerId para activar el contexto del perfil.'
      });
      return;
    }

    setManagerContextReady(true);
    setManagerUiStatus({ kind: 'idle', message: '' });
    await loadRosterFromContext(context);
  };

  const parseTeamLineupView = (row: unknown): TeamLineupView | null => {
    if (!row || typeof row !== 'object') {
      return null;
    }

    const teamId =
      typeof (row as { teamId?: unknown }).teamId === 'string'
        ? (row as { teamId: string }).teamId.trim()
        : '';

    const managerId =
      typeof (row as { managerId?: unknown }).managerId === 'string'
        ? (row as { managerId: string }).managerId.trim()
        : '';

    if (!teamId || !managerId) {
      return null;
    }

    const lineupEntriesRaw = (row as { lineupEntries?: unknown }).lineupEntries;
    const fallbackIdsRaw =
      (row as { lineupPlayerIdentificationNumbers?: unknown }).lineupPlayerIdentificationNumbers;

    const fallbackEntries = Array.isArray(fallbackIdsRaw)
      ? fallbackIdsRaw
          .filter((item): item is string => typeof item === 'string')
          .map((identificationNumber, index) => ({
            identificationNumber,
            battingOrder: index + 1,
            fieldPosition: 'NA'
          }))
      : [];

    const sourceEntries = Array.isArray(lineupEntriesRaw) && lineupEntriesRaw.length > 0
      ? lineupEntriesRaw
      : fallbackEntries;

    const parsedEntries = sourceEntries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const identificationSource =
          (entry as { identificationNumber?: unknown }).identificationNumber ??
          (entry as { playerId?: unknown }).playerId;

        const identificationNumber =
          typeof identificationSource === 'string' ? normalizeCedula(identificationSource) : '';

        const battingOrderRaw = (entry as { battingOrder?: unknown }).battingOrder;
        const battingOrder =
          typeof battingOrderRaw === 'number'
            ? battingOrderRaw
            : Number.parseInt(String(battingOrderRaw ?? ''), 10);

        const fieldPositionSource = (entry as { fieldPosition?: unknown }).fieldPosition;
        const fieldPosition =
          typeof fieldPositionSource === 'string' ? fieldPositionSource.trim().toUpperCase() : 'NA';

        if (identificationNumber.length < 4 || !Number.isInteger(battingOrder) || battingOrder < 1) {
          return null;
        }

        return {
          identificationNumber,
          battingOrder,
          fieldPosition: fieldPosition || 'NA'
        } as LineupEntryDraft;
      })
      .filter((entry): entry is LineupEntryDraft => Boolean(entry))
      .sort((a, b) => a.battingOrder - b.battingOrder);

    const currentBatterSource =
      (row as { currentBatterIdentificationNumber?: unknown }).currentBatterIdentificationNumber ??
      (row as { currentBatterId?: unknown }).currentBatterId;

    const currentBatterIdentificationNumber =
      typeof currentBatterSource === 'string' ? normalizeCedula(currentBatterSource) : null;

    return {
      teamId,
      managerId,
      entries: parsedEntries,
      currentBatterIdentificationNumber
    };
  };

  const loadGameLineupsFromContext = async (
    context: ManagerContext,
    opts?: { silent?: boolean }
  ): Promise<{ ownLineup: TeamLineupView | null; rivalLineup: TeamLineupView | null } | null> => {
    setManagerSubmitting(true);

    try {
      const response = await getOfficialScoring(
        `games/${context.gameId}/lineups?tournamentId=${context.tournamentId}&visibility=free`
      );

      const rowsRaw =
        (response as { lineup?: { lineups?: unknown } }).lineup?.lineups;

      const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
      const lineupViews = rows
        .map((row) => parseTeamLineupView(row))
        .filter((row): row is TeamLineupView => Boolean(row));

      const ownLineup = lineupViews.find((row) => row.teamId === context.teamId) ?? null;
      const rivalLineup = lineupViews.find((row) => row.teamId !== context.teamId) ?? null;

      setManagerOwnLineupView(ownLineup);
      setManagerRivalLineupView(rivalLineup);

      if (ownLineup && ownLineup.entries.length > 0) {
        setManagerLineupEntries(ownLineup.entries);
      }

      const initialIndexes: Record<string, number> = {};
      for (const lineup of lineupViews) {
        const foundIndex = lineup.currentBatterIdentificationNumber
          ? lineup.entries.findIndex(
              (entry) => entry.identificationNumber === lineup.currentBatterIdentificationNumber
            )
          : -1;

        initialIndexes[lineup.teamId] = foundIndex >= 0 ? foundIndex : 0;
      }

      setManagerBattingIndexByTeam(initialIndexes);

      const keepsCurrentOffense =
        managerLiveOffenseTeamId.length > 0 && Boolean(initialIndexes[managerLiveOffenseTeamId] !== undefined);

      const nextOffenseTeamId = keepsCurrentOffense
        ? managerLiveOffenseTeamId
        : ownLineup?.teamId ?? rivalLineup?.teamId ?? '';

      setManagerLiveOffenseTeamId(nextOffenseTeamId);

      const nextOffenseLineup =
        nextOffenseTeamId === ownLineup?.teamId
          ? ownLineup?.entries ?? []
          : nextOffenseTeamId === rivalLineup?.teamId
            ? rivalLineup?.entries ?? []
            : [];

      const nextOffenseIndex = initialIndexes[nextOffenseTeamId] ?? 0;
      const nextBatter =
        nextOffenseLineup.length > 0
          ? nextOffenseLineup[nextOffenseIndex % nextOffenseLineup.length]?.identificationNumber ?? ''
          : '';

      setManagerLiveBatterCedula(nextBatter);
      setManagerBaseRunners({ first: null, second: null, third: null });

      if (!opts?.silent) {
        setManagerUiStatus({
          kind: 'success',
          message: rivalLineup
            ? `Lineups cargados: propio ${ownLineup?.teamId ?? context.teamId} y rival ${rivalLineup.teamId}.`
            : `Lineup propio cargado para ${context.teamId}. El lineup rival aun no esta registrado.`
        });
      }

      return {
        ownLineup,
        rivalLineup
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron cargar lineups del juego.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
      return null;
    } finally {
      setManagerSubmitting(false);
    }
  };

  const loadManagerTacticalSummary = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto del manager para ver resumen de turnos y errores.'
      });
      return;
    }

    const context = buildManagerContext();
    setManagerTacticalLoading(true);

    try {
      const lineupsResult = await loadGameLineupsFromContext(context, { silent: true });
      const ownLineup = lineupsResult?.ownLineup ?? managerOwnLineupView;
      const rivalLineup = lineupsResult?.rivalLineup ?? managerRivalLineupView;

      if (!ownLineup) {
        setManagerUiStatus({
          kind: 'error',
          message: 'Aun no hay lineup propio disponible para generar resumen tactico.'
        });
        return;
      }

      const playByPlayResponse = await getOfficialScoring(
        `games/${context.gameId}/play-by-play?tournamentId=${context.tournamentId}&visibility=free`
      );

      const playByPlayRaw = (playByPlayResponse as { playByPlay?: unknown }).playByPlay;
      if (!playByPlayRaw || typeof playByPlayRaw !== 'object') {
        setManagerUiStatus({
          kind: 'error',
          message: 'No se pudo leer la bitacora oficial del juego.'
        });
        return;
      }

      const ownPlayerIds = new Set(ownLineup.entries.map((entry) => entry.identificationNumber));
      const rivalPlayerIds = new Set(rivalLineup?.entries.map((entry) => entry.identificationNumber) ?? []);

      const parseNumber = (value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }

        const parsed = Number.parseInt(String(value ?? '0'), 10);
        return Number.isFinite(parsed) ? parsed : 0;
      };

      const getDisplayName = (item: Record<string, unknown>, identificationNumber: string) => {
        const player = item.player;
        if (player && typeof player === 'object') {
          const displayName = (player as { displayName?: unknown }).displayName;
          if (typeof displayName === 'string' && displayName.trim().length > 0) {
            return displayName.trim();
          }
        }

        return identificationNumber;
      };

      const batterStatsRaw = (playByPlayRaw as { batterStats?: unknown }).batterStats;
      const batterRows = Array.isArray(batterStatsRaw)
        ? batterStatsRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const row = item as Record<string, unknown>;
              const identificationNumber =
                typeof row.identificationNumber === 'string'
                  ? normalizeCedula(row.identificationNumber)
                  : '';

              if (identificationNumber.length < 4) {
                return null;
              }

              return {
                identificationNumber,
                displayName: getDisplayName(row, identificationNumber),
                plateAppearances: parseNumber(row.plateAppearances),
                hits: parseNumber(row.hits),
                strikeouts: parseNumber(row.strikeouts),
                walks: parseNumber(row.walks),
                runs: parseNumber(row.runs),
                rbis: parseNumber(row.rbis),
                stolenBases: parseNumber(row.stolenBases)
              } as ManagerTacticalBatterRow;
            })
            .filter((item): item is ManagerTacticalBatterRow => Boolean(item))
        : [];

      const pitcherStatsRaw = (playByPlayRaw as { pitcherStats?: unknown }).pitcherStats;
      const pitcherRows = Array.isArray(pitcherStatsRaw)
        ? pitcherStatsRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const row = item as Record<string, unknown>;
              const identificationNumber =
                typeof row.identificationNumber === 'string'
                  ? normalizeCedula(row.identificationNumber)
                  : '';

              if (identificationNumber.length < 4) {
                return null;
              }

              return {
                identificationNumber,
                displayName: getDisplayName(row, identificationNumber),
                pitches: parseNumber(row.pitches),
                battersFaced: parseNumber(row.battersFaced),
                hitsAllowed: parseNumber(row.hitsAllowed),
                runsAllowed: parseNumber(row.runsAllowed),
                walksAllowed: parseNumber(row.walksAllowed),
                strikeouts: parseNumber(row.strikeouts),
                outsRecorded: parseNumber(row.outsRecorded)
              } as ManagerTacticalPitcherRow;
            })
            .filter((item): item is ManagerTacticalPitcherRow => Boolean(item))
        : [];

      const fieldingStatsRaw = (playByPlayRaw as { fieldingStats?: unknown }).fieldingStats;
      const fieldingRows = Array.isArray(fieldingStatsRaw)
        ? fieldingStatsRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const row = item as Record<string, unknown>;
              const identificationNumber =
                typeof row.identificationNumber === 'string'
                  ? normalizeCedula(row.identificationNumber)
                  : '';

              if (identificationNumber.length < 4) {
                return null;
              }

              return {
                identificationNumber,
                displayName: getDisplayName(row, identificationNumber),
                errors: parseNumber(row.errors),
                outsRecorded: parseNumber(row.outsRecorded)
              } as ManagerTacticalFieldingRow;
            })
            .filter((item): item is ManagerTacticalFieldingRow => Boolean(item))
        : [];

      const recentEventsRaw = (playByPlayRaw as { recentEvents?: unknown }).recentEvents;
      const recentEvents = Array.isArray(recentEventsRaw)
        ? recentEventsRaw
            .map((item) => {
              if (!item || typeof item !== 'object') {
                return null;
              }

              const row = item as Record<string, unknown>;
              const offenseTeamId =
                typeof row.offenseTeamId === 'string' ? row.offenseTeamId.trim() : '';

              if (!offenseTeamId) {
                return null;
              }

              const batterIdentificationNumber =
                typeof row.batterIdentificationNumber === 'string'
                  ? normalizeCedula(row.batterIdentificationNumber)
                  : null;

              return {
                sequence: parseNumber(row.sequence),
                offenseTeamId,
                type: typeof row.type === 'string' ? row.type : 'N/A',
                description: typeof row.description === 'string' ? row.description : 'Jugada registrada',
                batterIdentificationNumber
              } as ManagerTacticalTurnRow;
            })
            .filter((item): item is ManagerTacticalTurnRow => Boolean(item))
        : [];

      const ownBatting = batterRows
        .filter((row) => ownPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.hits - a.hits || b.plateAppearances - a.plateAppearances);

      const rivalBatting = batterRows
        .filter((row) => rivalPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.hits - a.hits || b.plateAppearances - a.plateAppearances);

      const ownPitching = pitcherRows
        .filter((row) => ownPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.runsAllowed - a.runsAllowed || b.hitsAllowed - a.hitsAllowed);

      const rivalPitching = pitcherRows
        .filter((row) => rivalPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.runsAllowed - a.runsAllowed || b.hitsAllowed - a.hitsAllowed);

      const ownFielding = fieldingRows
        .filter((row) => ownPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.errors - a.errors || b.outsRecorded - a.outsRecorded);

      const rivalFielding = fieldingRows
        .filter((row) => rivalPlayerIds.has(row.identificationNumber))
        .sort((a, b) => b.errors - a.errors || b.outsRecorded - a.outsRecorded);

      const ownRecentTurns = recentEvents
        .filter((event) => event.offenseTeamId === ownLineup.teamId)
        .slice(-8)
        .reverse();

      const rivalRecentTurns = rivalLineup
        ? recentEvents
            .filter((event) => event.offenseTeamId === rivalLineup.teamId)
            .slice(-8)
            .reverse()
        : [];

      const alerts: string[] = [];

      const rivalHotBatter = rivalBatting.find((row) => row.hits >= 2);
      if (rivalHotBatter) {
        alerts.push(
          `Atencion: ${rivalHotBatter.displayName} del rival ya tiene ${rivalHotBatter.hits} hits. Considera ajustar el pitcheo o defender mas profundo.`
        );
      }

      const ownPitcherInTrouble = ownPitching.find((row) => row.runsAllowed >= 3 || row.hitsAllowed >= 5);
      if (ownPitcherInTrouble) {
        alerts.push(
          `Tu pitcher ${ownPitcherInTrouble.displayName} ha permitido ${ownPitcherInTrouble.hitsAllowed} hits y ${ownPitcherInTrouble.runsAllowed} carreras. Evalua cambio de pitcher.`
        );
      }

      const ownErrorsTotal = ownFielding.reduce((sum, row) => sum + row.errors, 0);
      if (ownErrorsTotal >= 2) {
        alerts.push(
          `Tu defensa acumula ${ownErrorsTotal} errores. Revisa posicionamiento del cuadro y prioriza jugadas seguras.`
        );
      }

      const rivalRunningThreat = rivalBatting.find((row) => row.stolenBases >= 1);
      if (rivalRunningThreat) {
        alerts.push(
          `Ojo con el corrido de bases: ${rivalRunningThreat.displayName} ya robo ${rivalRunningThreat.stolenBases} base(s).`
        );
      }

      if (alerts.length === 0) {
        alerts.push('Sin alertas criticas por ahora. Mantengan el plan y ajusten segun la siguiente entrada.');
      }

      const totalEventsRaw = (playByPlayRaw as { totalEvents?: unknown }).totalEvents;
      const totalEvents = parseNumber(totalEventsRaw);

      setManagerTacticalSummary({
        ownTeamId: ownLineup.teamId,
        rivalTeamId: rivalLineup?.teamId ?? null,
        totalEvents,
        ownBatting,
        rivalBatting,
        ownPitching,
        rivalPitching,
        ownFielding,
        rivalFielding,
        ownRecentTurns,
        rivalRecentTurns,
        alerts
      });

      setManagerUiStatus({
        kind: 'success',
        message: rivalLineup
          ? `Resumen cargado para ${ownLineup.teamId} y rival ${rivalLineup.teamId}.`
          : `Resumen cargado para ${ownLineup.teamId}. Aun sin lineup rival.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo cargar resumen tactico.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerTacticalLoading(false);
    }
  };

  const openManagerLineupBuilder = () => {
    setActiveTab('profile');
    setActiveModuleId('team-hq');
  };

  const openManagerLineupSummary = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto del manager para ver resumen propio y rival.'
      });
      return;
    }

    setActiveTab('profile');
    setActiveModuleId('team-hq');
    await loadManagerTacticalSummary();
  };

  const openManagerRivalLineupViewer = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto del manager para ver lineup propio y rival.'
      });
      return;
    }

    setActiveTab('profile');
    setActiveModuleId('team-hq');
    await loadGameLineupsFromContext(buildManagerContext());
  };

  const openManagerLiveScoring = async () => {
    if (managerContextReady) {
      await loadGameLineupsFromContext(buildManagerContext(), { silent: true });
    }

    setActiveTab('live');
    setActiveModuleId('live-scoring');
  };

  const selectManagerLiveOffenseTeam = (teamId: string) => {
    const normalized = teamId.trim();
    if (!normalized) {
      return;
    }

    setManagerLiveOffenseTeamId(normalized);

    const lineup =
      normalized === managerOwnLineupView?.teamId
        ? managerOwnLineupView.entries
        : normalized === managerRivalLineupView?.teamId
          ? managerRivalLineupView.entries
          : [];

    const index = managerBattingIndexByTeam[normalized] ?? 0;
    const batter = lineup.length > 0 ? lineup[index % lineup.length]?.identificationNumber ?? '' : '';
    setManagerLiveBatterCedula(batter);
  };

  const recordManagerLivePlay = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto de manager para anotar jugada a jugada.'
      });
      return;
    }

    const context = buildManagerContext();
    const offenseTeamId = managerLiveOffenseTeamId || context.teamId;

    const offenseLineup =
      offenseTeamId === managerOwnLineupView?.teamId
        ? managerOwnLineupView.entries
        : offenseTeamId === managerRivalLineupView?.teamId
          ? managerRivalLineupView.entries
          : [];

    if (offenseLineup.length === 0) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero carga lineups del juego para poder anotar jugada por jugador.'
      });
      return;
    }

    const battingIndex = managerBattingIndexByTeam[offenseTeamId] ?? 0;
    const expectedBatter = offenseLineup[battingIndex % offenseLineup.length]?.identificationNumber ?? '';

    if (!expectedBatter) {
      setManagerUiStatus({ kind: 'error', message: 'No se pudo determinar el bateador actual del lineup.' });
      return;
    }

    const selectedBatter = normalizeCedula(managerLiveBatterCedula);
    const batterIdentificationNumber = selectedBatter || expectedBatter;

    if (batterIdentificationNumber !== expectedBatter) {
      setManagerUiStatus({
        kind: 'error',
        message: `Turno esperado: ${expectedBatter}. Ajusta el orden o registra el bateador correcto.`
      });
      return;
    }

    const playResolution = resolveManagerPlay(managerBaseRunners, batterIdentificationNumber, managerLiveResultDraft);

    let nextOuts = managerPrivateLiveState.outs;
    let nextInning = managerPrivateLiveState.inning;
    let nextOffenseTeamId = offenseTeamId;
    let nextBases = playResolution.nextBases;

    if (managerLiveResultDraft === 'OUT') {
      nextOuts += 1;

      if (nextOuts >= 3) {
        nextOuts = 0;
        nextInning = managerPrivateLiveState.inning + 1;
        nextBases = { first: null, second: null, third: null };

        if (managerOwnLineupView && managerRivalLineupView) {
          nextOffenseTeamId =
            offenseTeamId === managerOwnLineupView.teamId
              ? managerRivalLineupView.teamId
              : managerOwnLineupView.teamId;
        }
      }
    }

    const isOwnOffenseTeam = offenseTeamId === context.teamId;

    setManagerPrivateLiveState((current) => ({
      ...current,
      inning: nextInning,
      outs: nextOuts,
      balls: 0,
      strikes: 0,
      homeScore: current.homeScore + (isOwnOffenseTeam ? playResolution.runsScored : 0),
      awayScore: current.awayScore + (isOwnOffenseTeam ? 0 : playResolution.runsScored),
      status: 'in_progress',
      lastPlay: `${offenseTeamId} ${batterIdentificationNumber} ${managerLiveResultLabel}`,
      version: current.version + 1,
      updatedBy: activeRole.label,
      updatedAt: new Date().toISOString()
    }));

    const nextCurrentIndex = (battingIndex + 1) % offenseLineup.length;
    const nextOffenseIndex = managerBattingIndexByTeam[nextOffenseTeamId] ?? 0;

    setManagerBattingIndexByTeam((current) => {
      const next = {
        ...current,
        [offenseTeamId]: nextCurrentIndex
      };

      if (next[nextOffenseTeamId] === undefined) {
        next[nextOffenseTeamId] = 0;
      }

      return next;
    });

    const nextLineup =
      nextOffenseTeamId === managerOwnLineupView?.teamId
        ? managerOwnLineupView.entries
        : nextOffenseTeamId === managerRivalLineupView?.teamId
          ? managerRivalLineupView.entries
          : [];

    const batterForNextPlay =
      nextLineup.length > 0
        ? nextLineup[(nextOffenseTeamId === offenseTeamId ? nextCurrentIndex : nextOffenseIndex) % nextLineup.length]
            ?.identificationNumber ?? ''
        : '';

    setManagerLiveOffenseTeamId(nextOffenseTeamId);
    setManagerLiveBatterCedula(batterForNextPlay);
    setManagerBaseRunners(nextBases);
    setManagerPlayLog((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
        teamId: offenseTeamId,
        batterIdentificationNumber,
        result: managerLiveResultDraft,
        runsScored: playResolution.runsScored,
        inning: nextInning
      },
      ...current
    ].slice(0, 12));

    setManagerUiStatus({
      kind: 'success',
      message:
        playResolution.runsScored > 0
          ? `Jugada registrada: ${managerLiveResultLabel}. Carreras anotadas: ${playResolution.runsScored}.`
          : `Jugada registrada: ${managerLiveResultLabel}.`
    });
  };

  const pushRosterCedula = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto de torneo/equipo en tu perfil antes de editar roster o lineup.'
      });
      return;
    }

    const normalized = normalizeCedula(managerRosterCedulaDraft);

    if (normalized.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'Ingresa una cedula valida (minimo 4 caracteres).' });
      return;
    }

    if (managerRosterCedulas.includes(normalized)) {
      setManagerUiStatus({ kind: 'error', message: `La cedula ${normalized} ya esta en el draft del roster.` });
      return;
    }

    setManagerRosterCedulas((current) => [...current, normalized]);
    setManagerRosterCedulaDraft('');
    setManagerUiStatus({ kind: 'idle', message: '' });
  };

  const removeRosterCedula = (identificationNumber: string) => {
    setManagerRosterCedulas((current) => current.filter((id) => id !== identificationNumber));
    setManagerLineupEntries((current) =>
      current.filter((entry) => entry.identificationNumber !== identificationNumber)
    );
  };

  const upsertLineupEntry = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto de torneo/equipo en tu perfil.'
      });
      return;
    }

    const identificationNumber = normalizeCedula(managerLineupCedulaDraft);
    const battingOrder = Number.parseInt(managerLineupBattingOrderDraft, 10);
    const fieldPosition = managerLineupFieldPositionDraft.trim().toUpperCase();

    if (identificationNumber.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'Selecciona una cedula valida para el lineup.' });
      return;
    }

    if (!managerRosterCedulas.includes(identificationNumber)) {
      setManagerUiStatus({
        kind: 'error',
        message: 'La cedula del lineup debe existir en el roster oficial de este equipo.'
      });
      return;
    }

    if (!Number.isInteger(battingOrder) || battingOrder < 1 || battingOrder > 99) {
      setManagerUiStatus({ kind: 'error', message: 'La posicion de bateo debe ser un numero entre 1 y 99.' });
      return;
    }

    if (!fieldPositionOptions.includes(fieldPosition)) {
      setManagerUiStatus({
        kind: 'error',
        message: `Posicion de juego invalida. Usa: ${fieldPositionOptions.join(', ')}.`
      });
      return;
    }

    const duplicatedOrder = managerLineupEntries.find(
      (entry) => entry.battingOrder === battingOrder && entry.identificationNumber !== identificationNumber
    );

    if (duplicatedOrder) {
      setManagerUiStatus({
        kind: 'error',
        message: `El orden ${battingOrder} ya esta asignado a ${duplicatedOrder.identificationNumber}.`
      });
      return;
    }

    setManagerLineupEntries((current) => {
      const next = current.filter((entry) => entry.identificationNumber !== identificationNumber);
      next.push({ identificationNumber, battingOrder, fieldPosition });
      return next.sort((a, b) => a.battingOrder - b.battingOrder);
    });

    setManagerLineupCedulaDraft('');
    setManagerLineupBattingOrderDraft(String(managerLineupEntries.length + 1));
    setManagerLineupFieldPositionDraft('P');
    setManagerUiStatus({ kind: 'idle', message: '' });
  };

  const removeLineupEntry = (identificationNumber: string) => {
    setManagerLineupEntries((current) =>
      current.filter((entry) => entry.identificationNumber !== identificationNumber)
    );
  };

  const buildLineupFromRoster = () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero tu contexto de torneo/equipo para crear el lineup.'
      });
      return;
    }

    if (managerRosterCedulas.length === 0) {
      setManagerUiStatus({ kind: 'error', message: 'Primero carga o arma un roster con cedulas.' });
      return;
    }

    const autoPositions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
    const seeded = managerRosterCedulas.map((identificationNumber, index) => ({
      identificationNumber,
      battingOrder: index + 1,
      fieldPosition: autoPositions[Math.min(index, autoPositions.length - 1)]
    }));

    setManagerLineupEntries(seeded);
    setManagerUiStatus({ kind: 'success', message: 'Lineup base generado desde el roster. Ajusta posiciones si quieres.' });
  };

  const registerGlobalPlayerFromManager = async () => {
    const displayName = managerPlayerNameDraft.trim();
    const identificationNumber = normalizeCedula(managerPlayerCedulaDraft);
    const representativeIdentificationNumber = normalizeCedula(managerRepresentativeCedulaDraft);
    const actorId = managerProfileId.trim();

    if (!actorId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Debes indicar managerId en perfil para registrar jugadores globales.'
      });
      return;
    }

    if (!displayName) {
      setManagerUiStatus({ kind: 'error', message: 'El nombre del jugador es obligatorio.' });
      return;
    }

    if (identificationNumber.length < 4) {
      setManagerUiStatus({ kind: 'error', message: 'La cedula del jugador no es valida.' });
      return;
    }

    if (managerIsMinorDraft && representativeIdentificationNumber.length < 4) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Si el jugador es menor, agrega cedula de padre o representante (minimo 4 caracteres).'
      });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });

    try {
      await postOfficialScoring('players', {
        actorId,
        displayName,
        identificationNumber,
        isMinor: managerIsMinorDraft,
        representativeIdentificationNumber: managerIsMinorDraft ? representativeIdentificationNumber : undefined
      });

      setManagerUiStatus({ kind: 'success', message: `Jugador ${displayName} registrado globalmente.` });
      setManagerPlayerNameDraft('');
      setManagerPlayerCedulaDraft('');
      setManagerRepresentativeCedulaDraft('');
      setManagerIsMinorDraft(false);

      if (managerContextReady && !managerRosterCedulas.includes(identificationNumber)) {
        setManagerRosterCedulas((current) => [...current, identificationNumber]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo registrar el jugador.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const submitRosterToTournament = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero activa el contexto en perfil (torneo, equipo, juego y manager).'
      });
      return;
    }

    const context = buildManagerContext();

    if (!context.tournamentId || !context.teamId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Debes indicar tournamentId, teamId y managerId antes de guardar roster.'
      });
      return;
    }

    if (managerRosterCedulas.length === 0) {
      setManagerUiStatus({ kind: 'error', message: 'Agrega al menos una cedula al roster antes de guardar.' });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });

    try {
      await postOfficialScoring(`tournaments/${context.tournamentId}/teams/${context.teamId}/roster`, {
        managerId: context.managerId,
        playerIdentificationNumbers: managerRosterCedulas
      });

      await loadRosterFromContext(context, { silent: true });

      setManagerUiStatus({
        kind: 'success',
        message: `Roster guardado para ${context.teamId} en ${context.tournamentId}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el roster.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  const submitLineupToGame = async () => {
    if (!managerContextReady) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Activa primero el contexto en perfil antes de enviar lineup.'
      });
      return;
    }

    const context = buildManagerContext();

    if (!context.gameId || !context.tournamentId || !context.teamId || !context.managerId) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Debes indicar gameId, tournamentId, teamId y managerId antes de enviar lineup.'
      });
      return;
    }

    if (managerLineupEntries.length === 0) {
      setManagerUiStatus({
        kind: 'error',
        message: 'Primero construye el lineup indicando orden de bateo y posicion de juego.'
      });
      return;
    }

    const sortedEntries = [...managerLineupEntries].sort((a, b) => a.battingOrder - b.battingOrder);

    const missingFromRoster = sortedEntries.find(
      (entry) => !managerRosterCedulas.includes(entry.identificationNumber)
    );

    if (missingFromRoster) {
      setManagerUiStatus({
        kind: 'error',
        message: `La cedula ${missingFromRoster.identificationNumber} no esta en el roster oficial del equipo.`
      });
      return;
    }

    const hasNonConsecutiveOrder = sortedEntries.some((entry, index) => entry.battingOrder !== index + 1);
    if (hasNonConsecutiveOrder) {
      setManagerUiStatus({
        kind: 'error',
        message: 'El lineup debe usar orden de bateo consecutivo iniciando en 1.'
      });
      return;
    }

    setManagerSubmitting(true);
    setManagerUiStatus({ kind: 'idle', message: '' });

    try {
      await postOfficialScoring(`games/${context.gameId}/lineups`, {
        tournamentId: context.tournamentId,
        teamId: context.teamId,
        managerId: context.managerId,
        playerIdentificationNumbers: sortedEntries.map((entry) => entry.identificationNumber),
        lineupEntries: sortedEntries
      });

      await loadGameLineupsFromContext(context, { silent: true });

      setManagerUiStatus({
        kind: 'success',
        message: `Lineup enviado para ${context.teamId} en juego ${context.gameId}.`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo enviar el lineup.';
      setManagerUiStatus({ kind: 'error', message: adaptManagerError(message) });
    } finally {
      setManagerSubmitting(false);
    }
  };

  if (!sessionRoleId) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <ScrollView contentContainerStyle={styles.roleSetupContent}>
          <View style={styles.roleSetupHero}>
            <Text style={styles.eyebrow}>PLAYSPORT LOGIN DE ROL</Text>
            <Text style={styles.roleSetupTitle}>Elige como quieres entrar hoy</Text>
            <Text style={styles.roleSetupBody}>
              Este paso define las funciones visibles. La anotacion en vivo oficial es de anotador u
              organizador; la de manager es solo individual.
            </Text>
          </View>

          {roles.map((role) => {
            const selected = role.id === roleDraft;
            return (
              <Pressable
                key={role.id}
                style={[styles.roleOptionCard, selected ? styles.roleOptionCardSelected : null]}
                onPress={() => setRoleDraft(role.id)}
              >
                <View style={styles.roleOptionTopRow}>
                  <Text style={[styles.roleOptionLabel, selected ? styles.roleOptionLabelSelected : null]}>
                    {role.label}
                  </Text>
                  <Text style={[styles.roleOptionBadge, selected ? styles.roleOptionBadgeSelected : null]}>
                    {role.entitlement}
                  </Text>
                </View>
                <Text style={styles.roleOptionSummary}>{role.summary}</Text>
              </Pressable>
            );
          })}

          <Pressable style={styles.roleConfirmButton} onPress={confirmRole}>
            <Text style={styles.roleConfirmText}>Entrar como {activeRole.label}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (activeModule) {
    const isLiveScoringModule = activeModule.id === 'live-scoring';
    const isManagerTeamModule = activeModule.id === 'team-hq' && currentRoleId === 'manager';
    const moduleMode = isLiveScoringModule ? getLiveScoringMode(currentRoleId) : null;
    const moduleRule = isLiveScoringModule ? getLiveScoringRule(currentRoleId) : null;
    const moduleActions = isLiveScoringModule
      ? getLiveScoringActions(currentRoleId)
      : activeModule.actions;
    const showManagerPrivateBoard = isLiveScoringModule && currentRoleId === 'manager';
    const showOfficialPlayByPlayPanel = isLiveScoringModule && officialScoringRoles.includes(currentRoleId);

    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Pressable style={styles.backButton} onPress={() => setActiveModuleId(null)}>
            <Text style={styles.backButtonText}>Volver</Text>
          </Pressable>

          <View style={styles.moduleHero}>
            <View style={styles.moduleBadgeLarge}>
              <Text style={styles.moduleBadgeTextLarge}>{activeModule.badge}</Text>
            </View>
            <Text style={styles.moduleTitleDetail}>{activeModule.title}</Text>
            <Text style={styles.moduleSummaryDetail}>{activeModule.summary}</Text>
            <Text style={styles.moduleRoleHint}>Perfil activo: {activeRole.label}</Text>
          </View>

          {moduleMode && moduleRule ? (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>{moduleMode}</Text>
              <Text style={styles.permissionBody}>{moduleRule}</Text>
            </View>
          ) : null}

          {isLiveScoringModule ? (
            <>
              <View style={styles.scoreboardCard}>
                <Text style={styles.scoreboardTitle}>Pizarra oficial de liga</Text>
                <Text style={styles.scoreboardScore}>
                  Home {officialLiveState.homeScore} - {officialLiveState.awayScore} Away
                </Text>
                <Text style={styles.scoreboardMeta}>
                  Inning {officialLiveState.inning} | Outs {officialLiveState.outs} | B {officialLiveState.balls} |
                  S {officialLiveState.strikes}
                </Text>
                <Text style={styles.scoreboardMeta}>Estado: {officialLiveState.status}</Text>
                <Text style={styles.scoreboardMeta}>Ultima jugada: {officialLiveState.lastPlay}</Text>
                <Text style={styles.scoreboardMeta}>
                  Version oficial {officialLiveState.version} por {officialLiveState.updatedBy}
                </Text>
              </View>

              {showOfficialPlayByPlayPanel ? (
                <View style={styles.managerLivePlayCard}>
                  <Text style={styles.managerPanelTitle}>Anotacion oficial jugada a jugada</Text>
                  <Text style={styles.managerPanelBody}>
                    Registra cada strike, bola, hit, out, error y robo con terminos simples. Desde aqui se actualiza la pizarra y las estadisticas de bateador y pitcher.
                  </Text>

                  <Text style={styles.managerLabel}>Tournament ID</Text>
                  <TextInput
                    value={officialTournamentId}
                    onChangeText={setOfficialTournamentId}
                    style={styles.managerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Game ID</Text>
                  <TextInput
                    value={officialGameId}
                    onChangeText={setOfficialGameId}
                    style={styles.managerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Actor ID (anotador u organizador)</Text>
                  <TextInput
                    value={officialActorId}
                    onChangeText={setOfficialActorId}
                    style={styles.managerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Pressable
                    style={[styles.managerButtonOutline, officialSubmitting ? styles.managerButtonDisabled : null]}
                    disabled={officialSubmitting}
                    onPress={() => loadOfficialPlayByPlayFromApi()}
                  >
                    <Text style={styles.managerButtonOutlineText}>Cargar estado oficial</Text>
                  </Pressable>

                  <Text style={styles.managerLabel}>Tipo de jugada</Text>
                  <View style={styles.rosterChipWrap}>
                    {officialPlayEventOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        style={[
                          styles.rosterSelectChip,
                          officialEventTypeDraft === option.value ? styles.rosterSelectChipActive : null
                        ]}
                        onPress={() => setOfficialEventTypeDraft(option.value)}
                      >
                        <Text style={styles.rosterSelectChipText}>{option.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.managerLabel}>Equipo ofensivo (teamId)</Text>
                  <TextInput
                    value={officialOffenseTeamIdDraft}
                    onChangeText={setOfficialOffenseTeamIdDraft}
                    style={styles.managerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Bateador (cedula)</Text>
                  <TextInput
                    value={officialBatterCedulaDraft}
                    onChangeText={setOfficialBatterCedulaDraft}
                    style={styles.managerInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Pitcher (cedula)</Text>
                  <TextInput
                    value={officialPitcherCedulaDraft}
                    onChangeText={setOfficialPitcherCedulaDraft}
                    style={styles.managerInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Corredor (cedula, opcional)</Text>
                  <TextInput
                    value={officialRunnerCedulaDraft}
                    onChangeText={setOfficialRunnerCedulaDraft}
                    style={styles.managerInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Fildeador (cedula, para errores/outs)</Text>
                  <TextInput
                    value={officialFielderCedulaDraft}
                    onChangeText={setOfficialFielderCedulaDraft}
                    style={styles.managerInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />

                  <Text style={styles.managerLabel}>Base origen (1-3, opcional)</Text>
                  <TextInput
                    value={officialFromBaseDraft}
                    onChangeText={setOfficialFromBaseDraft}
                    style={styles.managerInput}
                    keyboardType="number-pad"
                  />

                  <Text style={styles.managerLabel}>Base destino (2-4, opcional)</Text>
                  <TextInput
                    value={officialToBaseDraft}
                    onChangeText={setOfficialToBaseDraft}
                    style={styles.managerInput}
                    keyboardType="number-pad"
                  />

                  <Text style={styles.managerLabel}>Carreras anotadas (opcional)</Text>
                  <TextInput
                    value={officialRunsScoredDraft}
                    onChangeText={setOfficialRunsScoredDraft}
                    style={styles.managerInput}
                    keyboardType="number-pad"
                  />

                  <Text style={styles.managerLabel}>Outs de la jugada (opcional)</Text>
                  <TextInput
                    value={officialOutsRecordedDraft}
                    onChangeText={setOfficialOutsRecordedDraft}
                    style={styles.managerInput}
                    keyboardType="number-pad"
                  />

                  <Pressable
                    style={[styles.managerButton, officialSubmitting ? styles.managerButtonDisabled : null]}
                    disabled={officialSubmitting}
                    onPress={submitOfficialPlayEvent}
                  >
                    <Text style={styles.managerButtonText}>Registrar jugada oficial</Text>
                  </Pressable>

                  {officialPlayByPlaySnapshot ? (
                    <View style={styles.lineupEntryListCard}>
                      <Text style={styles.managerRosterListTitle}>
                        Bases: 1B {officialPlayByPlaySnapshot.baseRunners.first ?? '-'} · 2B {officialPlayByPlaySnapshot.baseRunners.second ?? '-'} · 3B {officialPlayByPlaySnapshot.baseRunners.third ?? '-'}
                      </Text>
                      <Text style={styles.managerRosterListRow}>Eventos registrados: {officialPlayByPlaySnapshot.totalEvents}</Text>
                      {officialPlayByPlaySnapshot.recentEvents.slice(-5).map((event) => (
                        <Text key={`official-event-${event.sequence}`} style={styles.managerRosterListRow}>
                          #{event.sequence} · {event.offenseTeamId} · {event.description}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {officialPlayByPlaySnapshot && officialPlayByPlaySnapshot.batterStats.length > 0 ? (
                    <View style={styles.managerRosterListCard}>
                      <Text style={styles.managerRosterListTitle}>Resumen bateadores</Text>
                      {officialPlayByPlaySnapshot.batterStats.slice(0, 8).map((stat) => (
                        <Text key={`bat-${stat.identificationNumber}`} style={styles.managerRosterListRow}>
                          {stat.identificationNumber} · PA {stat.plateAppearances} · H {stat.hits} · R {stat.runs} · RBI {stat.rbis} · BB {stat.walks} · K {stat.strikeouts}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {officialPlayByPlaySnapshot && officialPlayByPlaySnapshot.pitcherStats.length > 0 ? (
                    <View style={styles.managerRosterListCard}>
                      <Text style={styles.managerRosterListTitle}>Resumen pitchers</Text>
                      {officialPlayByPlaySnapshot.pitcherStats.slice(0, 6).map((stat) => (
                        <Text key={`pit-${stat.identificationNumber}`} style={styles.managerRosterListRow}>
                          {stat.identificationNumber} · P {stat.pitches} · BF {stat.battersFaced} · H {stat.hitsAllowed} · R {stat.runsAllowed} · BB {stat.walksAllowed} · K {stat.strikeouts}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {officialUiStatus.kind !== 'idle' ? (
                    <View
                      style={
                        officialUiStatus.kind === 'success'
                          ? styles.managerStatusSuccess
                          : styles.managerStatusError
                      }
                    >
                      <Text
                        style={
                          officialUiStatus.kind === 'success'
                            ? styles.managerStatusSuccessText
                            : styles.managerStatusErrorText
                        }
                      >
                        {officialUiStatus.message}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {showManagerPrivateBoard ? (
                <>
                  <View style={styles.scoreboardPrivateCard}>
                    <Text style={styles.scoreboardTitle}>Pizarra privada del manager</Text>
                    <Text style={styles.scoreboardScore}>
                      {(managerTeamId.trim() || 'Mi equipo')} {managerPrivateLiveState.homeScore} -{' '}
                      {managerPrivateLiveState.awayScore} {(managerRivalLineupView?.teamId ?? 'Rival')}
                    </Text>
                    <Text style={styles.scoreboardMeta}>Estado: {managerPrivateLiveState.status}</Text>
                    <Text style={styles.scoreboardMeta}>Inning {managerPrivateLiveState.inning} · Outs {managerPrivateLiveState.outs}</Text>
                    <Text style={styles.scoreboardMeta}>Ultima jugada: {managerPrivateLiveState.lastPlay}</Text>
                    <Text style={styles.scoreboardMeta}>No impacta el resultado oficial</Text>
                  </View>

                  <View style={styles.managerLivePlayCard}>
                    <Text style={styles.managerPanelTitle}>EV · Anotacion jugada a jugada</Text>
                    <Text style={styles.managerPanelBody}>
                      Selecciona bateador del lineup y resultado. La pizarra privada se actualiza automaticamente.
                    </Text>

                    <Pressable
                      style={[styles.managerButtonOutline, managerSubmitting ? styles.managerButtonDisabled : null]}
                      disabled={managerSubmitting || !managerContextReady}
                      onPress={() => loadGameLineupsFromContext(buildManagerContext())}
                    >
                      <Text style={styles.managerButtonOutlineText}>Cargar lineups del juego</Text>
                    </Pressable>

                    {managerOwnLineupView || managerRivalLineupView ? (
                      <View style={styles.rosterChipWrap}>
                        {managerOwnLineupView ? (
                          <Pressable
                            style={[
                              styles.rosterSelectChip,
                              managerLiveOffenseTeamId === managerOwnLineupView.teamId ? styles.rosterSelectChipActive : null
                            ]}
                            onPress={() => selectManagerLiveOffenseTeam(managerOwnLineupView.teamId)}
                          >
                            <Text style={styles.rosterSelectChipText}>Ofensiva {managerOwnLineupView.teamId}</Text>
                          </Pressable>
                        ) : null}

                        {managerRivalLineupView ? (
                          <Pressable
                            style={[
                              styles.rosterSelectChip,
                              managerLiveOffenseTeamId === managerRivalLineupView.teamId ? styles.rosterSelectChipActive : null
                            ]}
                            onPress={() => selectManagerLiveOffenseTeam(managerRivalLineupView.teamId)}
                          >
                            <Text style={styles.rosterSelectChipText}>Ofensiva {managerRivalLineupView.teamId}</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    ) : null}

                    {managerLiveCurrentBatter ? (
                      <Text style={styles.managerLiveHintText}>Turno actual: {managerLiveCurrentBatter}</Text>
                    ) : (
                      <Text style={styles.managerLiveHintText}>Carga lineups para iniciar jugada a jugada.</Text>
                    )}

                    {managerLiveOffenseLineup.length > 0 ? (
                      <View style={styles.rosterChipWrap}>
                        {managerLiveOffenseLineup.map((entry) => (
                          <Pressable
                            key={`play-${entry.identificationNumber}-${entry.battingOrder}`}
                            style={[
                              styles.rosterSelectChip,
                              managerLiveBatterCedula === entry.identificationNumber ? styles.rosterSelectChipActive : null
                            ]}
                            onPress={() => setManagerLiveBatterCedula(entry.identificationNumber)}
                          >
                            <Text style={styles.rosterSelectChipText}>#{entry.battingOrder} {entry.identificationNumber}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    <View style={styles.rosterChipWrap}>
                      {managerPlayResultOptions.map((option) => (
                        <Pressable
                          key={option.value}
                          style={[
                            styles.rosterSelectChip,
                            managerLiveResultDraft === option.value ? styles.rosterSelectChipActive : null
                          ]}
                          onPress={() => setManagerLiveResultDraft(option.value)}
                        >
                          <Text style={styles.rosterSelectChipText}>{option.label}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <Pressable
                      style={[styles.managerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                      disabled={managerSubmitting}
                      onPress={recordManagerLivePlay}
                    >
                      <Text style={styles.managerButtonText}>Registrar jugada y actualizar marcador</Text>
                    </Pressable>

                    <Text style={styles.managerLiveHintText}>
                      Bases: 1B {managerBaseRunners.first ?? '-'} · 2B {managerBaseRunners.second ?? '-'} · 3B {managerBaseRunners.third ?? '-'}
                    </Text>

                    {managerPlayLog.length > 0 ? (
                      <View style={styles.lineupEntryListCard}>
                        <Text style={styles.managerRosterListTitle}>Bitacora en vivo</Text>
                        {managerPlayLog.map((item) => (
                          <Text key={item.id} style={styles.managerRosterListRow}>
                            Inning {item.inning} · {item.teamId} · {item.batterIdentificationNumber} · {item.result}
                            {item.runsScored > 0 ? ` · +${item.runsScored}` : ''}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {isManagerTeamModule ? (
            <View style={styles.managerPanelCard}>
              <Text style={styles.managerPanelTitle}>Roster y lineup con contexto activo</Text>
              <Text style={styles.managerPanelBody}>
                Regla activa: manager puede dirigir varios equipos en torneos distintos, pero no dos equipos
                dentro del mismo torneo.
              </Text>

              {managerContextReady ? (
                <View style={styles.managerContextCard}>
                  <Text style={styles.managerContextTitle}>Contexto activo</Text>
                  <Text style={styles.managerContextBody}>Torneo: {managerTournamentId.trim()}</Text>
                  <Text style={styles.managerContextBody}>Equipo: {managerTeamId.trim()}</Text>
                  <Text style={styles.managerContextBody}>Juego: {managerGameId.trim()}</Text>
                  <Text style={styles.managerContextBody}>Manager: {managerProfileId.trim()}</Text>
                  <Pressable
                    style={[styles.managerButtonOutline, managerSubmitting ? styles.managerButtonDisabled : null]}
                    disabled={managerSubmitting}
                    onPress={() => loadRosterFromContext(buildManagerContext())}
                  >
                    <Text style={styles.managerButtonOutlineText}>Revisar roster oficial</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.managerContextWarning}>
                  <Text style={styles.managerContextWarningText}>
                    Activa primero tu contexto desde la pestaña Perfil para revisar roster y crear lineup.
                  </Text>
                  <Pressable
                    style={styles.managerButtonOutline}
                    onPress={() => {
                      setActiveModuleId(null);
                      setActiveTab('profile');
                    }}
                  >
                    <Text style={styles.managerButtonOutlineText}>Ir a perfil</Text>
                  </Pressable>
                </View>
              )}

              <View style={styles.managerQuickIconRow}>
                <Pressable style={styles.managerQuickIconButton} onPress={openManagerLineupBuilder}>
                  <Text style={styles.managerQuickIconBadge}>LU</Text>
                  <Text style={styles.managerQuickIconLabel}>Crear lineup</Text>
                </Pressable>

                <Pressable style={styles.managerQuickIconButton} onPress={openManagerLineupSummary}>
                  <Text style={styles.managerQuickIconBadge}>RS</Text>
                  <Text style={styles.managerQuickIconLabel}>Resumen</Text>
                </Pressable>

                <Pressable style={styles.managerQuickIconButton} onPress={openManagerRivalLineupViewer}>
                  <Text style={styles.managerQuickIconBadge}>RV</Text>
                  <Text style={styles.managerQuickIconLabel}>Lineup rival</Text>
                </Pressable>

                <Pressable style={styles.managerQuickIconButton} onPress={openManagerLiveScoring}>
                  <Text style={styles.managerQuickIconBadge}>EV</Text>
                  <Text style={styles.managerQuickIconLabel}>En vivo</Text>
                </Pressable>
              </View>

              <View style={styles.managerDivider} />

              <Text style={styles.managerPanelTitle}>Registrar jugador global</Text>
              <Text style={styles.managerLabel}>Nombre</Text>
              <TextInput
                value={managerPlayerNameDraft}
                onChangeText={setManagerPlayerNameDraft}
                style={styles.managerInput}
                placeholder="Nombre del jugador"
                placeholderTextColor="#8aa0ad"
              />

              <Text style={styles.managerLabel}>Cedula</Text>
              <TextInput
                value={managerPlayerCedulaDraft}
                onChangeText={setManagerPlayerCedulaDraft}
                style={styles.managerInput}
                placeholder="V12345678"
                placeholderTextColor="#8aa0ad"
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.managerToggle, managerIsMinorDraft ? styles.managerToggleActive : null]}
                onPress={() => setManagerIsMinorDraft((current) => !current)}
              >
                <Text style={styles.managerToggleText}>
                  {managerIsMinorDraft ? 'Menor de edad: SI' : 'Menor de edad: NO'}
                </Text>
              </Pressable>

              {managerIsMinorDraft ? (
                <>
                  <Text style={styles.managerLabel}>Cedula de padre/representante</Text>
                  <TextInput
                    value={managerRepresentativeCedulaDraft}
                    onChangeText={setManagerRepresentativeCedulaDraft}
                    style={styles.managerInput}
                    placeholder="V87654321"
                    placeholderTextColor="#8aa0ad"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </>
              ) : null}

              <Pressable
                style={[styles.managerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={registerGlobalPlayerFromManager}
              >
                <Text style={styles.managerButtonText}>
                  {managerSubmitting ? 'Procesando...' : 'Registrar jugador global'}
                </Text>
              </Pressable>

              <View style={styles.managerDivider} />

              <Text style={styles.managerPanelTitle}>Roster oficial del equipo</Text>
              <TextInput
                value={managerRosterCedulaDraft}
                onChangeText={setManagerRosterCedulaDraft}
                style={styles.managerInput}
                placeholder="Agregar cedula al roster"
                placeholderTextColor="#8aa0ad"
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.managerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={pushRosterCedula}
              >
                <Text style={styles.managerButtonText}>Agregar cedula al draft</Text>
              </Pressable>

              {managerRosterCedulas.length > 0 ? (
                <View style={styles.rosterChipWrap}>
                  {managerRosterCedulas.map((id) => (
                    <Pressable key={id} style={styles.rosterChip} onPress={() => removeRosterCedula(id)}>
                      <Text style={styles.rosterChipText}>
                        {managerRosterNamesByCedula.get(id) ? `${managerRosterNamesByCedula.get(id)} · ${id}` : id} ·
                        quitar
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {managerRosterPlayers.length > 0 ? (
                <View style={styles.managerRosterListCard}>
                  <Text style={styles.managerRosterListTitle}>Roster cargado desde API</Text>
                  {managerRosterPlayers.map((player) => (
                    <Text key={player.identificationNumber} style={styles.managerRosterListRow}>
                      {player.displayName} · {player.identificationNumber}
                    </Text>
                  ))}
                </View>
              ) : null}

              <Pressable
                style={[styles.managerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={submitRosterToTournament}
              >
                <Text style={styles.managerButtonText}>
                  {managerSubmitting ? 'Procesando...' : 'Guardar roster en torneo'}
                </Text>
              </Pressable>

              <View style={styles.managerDivider} />

              <Text style={styles.managerPanelTitle}>Builder de lineup</Text>
              <Text style={styles.managerPanelBody}>
                Selecciona cedula, posicion de bateo y posicion de juego. Solo se permiten cedulas que esten en
                el roster del equipo.
              </Text>

              {managerRosterCedulas.length > 0 ? (
                <View style={styles.rosterChipWrap}>
                  {managerRosterCedulas.map((id) => (
                    <Pressable
                      key={`lineup-${id}`}
                      style={styles.rosterSelectChip}
                      onPress={() => setManagerLineupCedulaDraft(id)}
                    >
                      <Text style={styles.rosterSelectChipText}>{id}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Text style={styles.managerLabel}>Cedula para lineup</Text>
              <TextInput
                value={managerLineupCedulaDraft}
                onChangeText={setManagerLineupCedulaDraft}
                style={styles.managerInput}
                placeholder="Cedula del jugador"
                placeholderTextColor="#8aa0ad"
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Text style={styles.managerLabel}>Posicion de bateo</Text>
              <TextInput
                value={managerLineupBattingOrderDraft}
                onChangeText={setManagerLineupBattingOrderDraft}
                style={styles.managerInput}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor="#8aa0ad"
              />

              <Text style={styles.managerLabel}>Posicion de juego (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH)</Text>
              <TextInput
                value={managerLineupFieldPositionDraft}
                onChangeText={setManagerLineupFieldPositionDraft}
                style={styles.managerInput}
                placeholder="P"
                placeholderTextColor="#8aa0ad"
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <Pressable
                style={[styles.managerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={upsertLineupEntry}
              >
                <Text style={styles.managerButtonText}>Agregar o actualizar entrada de lineup</Text>
              </Pressable>

              <Pressable
                style={[styles.managerButtonOutline, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={buildLineupFromRoster}
              >
                <Text style={styles.managerButtonOutlineText}>Generar lineup base desde roster</Text>
              </Pressable>

              {managerLineupEntries.length > 0 ? (
                <View style={styles.lineupEntryListCard}>
                  <Text style={styles.managerRosterListTitle}>Lineup draft</Text>
                  {managerLineupEntries.map((entry) => (
                    <Pressable
                      key={`${entry.identificationNumber}-${entry.battingOrder}`}
                      style={styles.lineupEntryRow}
                      onPress={() => removeLineupEntry(entry.identificationNumber)}
                    >
                      <Text style={styles.lineupEntryText}>
                        #{entry.battingOrder} · {entry.identificationNumber} · {entry.fieldPosition} · quitar
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.managerDivider} />

              <Text style={styles.managerPanelTitle}>Lineups del juego</Text>
              <Text style={styles.managerPanelBody}>
                Revisa tu lineup y el lineup del equipo rival en el mismo juego.
              </Text>

              <Pressable
                style={[styles.managerButtonOutline, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting || !managerContextReady}
                onPress={() => loadGameLineupsFromContext(buildManagerContext())}
              >
                <Text style={styles.managerButtonOutlineText}>Ver lineup propio y rival</Text>
              </Pressable>

              {managerOwnLineupView ? (
                <View style={styles.managerRosterListCard}>
                  <Text style={styles.managerRosterListTitle}>Mi lineup ({managerOwnLineupView.teamId})</Text>
                  {managerOwnLineupView.entries.length > 0 ? (
                    managerOwnLineupView.entries.map((entry) => (
                      <Text key={`own-${entry.identificationNumber}-${entry.battingOrder}`} style={styles.managerRosterListRow}>
                        #{entry.battingOrder} · {entry.identificationNumber} · {entry.fieldPosition}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.managerRosterListRow}>Aun no hay lineup registrado para tu equipo.</Text>
                  )}
                </View>
              ) : null}

              {managerRivalLineupView ? (
                <View style={styles.managerRosterListCard}>
                  <Text style={styles.managerRosterListTitle}>Lineup rival ({managerRivalLineupView.teamId})</Text>
                  {managerRivalLineupView.entries.length > 0 ? (
                    managerRivalLineupView.entries.map((entry) => (
                      <Text key={`rival-${entry.identificationNumber}-${entry.battingOrder}`} style={styles.managerRosterListRow}>
                        #{entry.battingOrder} · {entry.identificationNumber} · {entry.fieldPosition}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.managerRosterListRow}>El rival aun no ha registrado lineup para este juego.</Text>
                  )}
                </View>
              ) : null}

              <View style={styles.managerDivider} />

              <Text style={styles.managerPanelTitle}>Resumen tactico por lineup</Text>
              <Text style={styles.managerPanelBody}>
                Este resumen te muestra turnos recientes, errores y carga de pitcheo de ambos equipos para decidir cambios de pitcher, ajustes del cuadro y jugada siguiente.
              </Text>

              <Pressable
                style={[
                  styles.managerButtonOutline,
                  managerSubmitting || managerTacticalLoading || !managerContextReady
                    ? styles.managerButtonDisabled
                    : null
                ]}
                disabled={managerSubmitting || managerTacticalLoading || !managerContextReady}
                onPress={loadManagerTacticalSummary}
              >
                <Text style={styles.managerButtonOutlineText}>
                  {managerTacticalLoading ? 'Cargando resumen...' : 'Cargar resumen propio y rival'}
                </Text>
              </Pressable>

              {managerTacticalSummary ? (
                <>
                  <View style={styles.managerRosterListCard}>
                    <Text style={styles.managerRosterListTitle}>
                      Turnos de mi equipo ({managerTacticalSummary.ownTeamId})
                    </Text>
                    {managerTacticalSummary.ownBatting.length > 0 ? (
                      managerTacticalSummary.ownBatting.map((row) => (
                        <Text key={`own-bat-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                          {row.displayName} · PA {row.plateAppearances} · H {row.hits} · BB {row.walks} · K {row.strikeouts} · R {row.runs} · RBI {row.rbis}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Sin turnos ofensivos registrados todavia.</Text>
                    )}
                  </View>

                  {managerTacticalSummary.rivalTeamId ? (
                    <View style={styles.managerRosterListCard}>
                      <Text style={styles.managerRosterListTitle}>
                        Turnos del rival ({managerTacticalSummary.rivalTeamId})
                      </Text>
                      {managerTacticalSummary.rivalBatting.length > 0 ? (
                        managerTacticalSummary.rivalBatting.map((row) => (
                          <Text key={`riv-bat-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                            {row.displayName} · PA {row.plateAppearances} · H {row.hits} · BB {row.walks} · K {row.strikeouts} · R {row.runs} · RBI {row.rbis}
                          </Text>
                        ))
                      ) : (
                        <Text style={styles.managerRosterListRow}>El rival aun no tiene turnos ofensivos en la bitacora.</Text>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.managerRosterListCard}>
                    <Text style={styles.managerRosterListTitle}>Errores y outs de fildeo</Text>
                    {managerTacticalSummary.ownFielding.length > 0 ? (
                      managerTacticalSummary.ownFielding.map((row) => (
                        <Text key={`own-def-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                          Tu equipo · {row.displayName} · Errores {row.errors} · Outs {row.outsRecorded}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Tu equipo aun sin jugadas defensivas cargadas.</Text>
                    )}

                    {managerTacticalSummary.rivalFielding.length > 0 ? (
                      managerTacticalSummary.rivalFielding.map((row) => (
                        <Text key={`riv-def-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                          Rival · {row.displayName} · Errores {row.errors} · Outs {row.outsRecorded}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Rival sin jugadas defensivas registradas por ahora.</Text>
                    )}
                  </View>

                  <View style={styles.managerRosterListCard}>
                    <Text style={styles.managerRosterListTitle}>Carga de pitchers</Text>
                    {managerTacticalSummary.ownPitching.length > 0 ? (
                      managerTacticalSummary.ownPitching.map((row) => (
                        <Text key={`own-pit-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                          Tu equipo · {row.displayName} · P {row.pitches} · H {row.hitsAllowed} · R {row.runsAllowed} · BB {row.walksAllowed} · K {row.strikeouts}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Sin datos de pitcheo propio aun.</Text>
                    )}

                    {managerTacticalSummary.rivalPitching.length > 0 ? (
                      managerTacticalSummary.rivalPitching.map((row) => (
                        <Text key={`riv-pit-${row.identificationNumber}`} style={styles.managerRosterListRow}>
                          Rival · {row.displayName} · P {row.pitches} · H {row.hitsAllowed} · R {row.runsAllowed} · BB {row.walksAllowed} · K {row.strikeouts}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Sin datos de pitcheo rival aun.</Text>
                    )}
                  </View>

                  <View style={styles.managerRosterListCard}>
                    <Text style={styles.managerRosterListTitle}>Ultimos turnos del juego</Text>
                    {managerTacticalSummary.ownRecentTurns.length > 0 ? (
                      managerTacticalSummary.ownRecentTurns.map((turn) => (
                        <Text key={`own-turn-${turn.sequence}`} style={styles.managerRosterListRow}>
                          Tu equipo · #{turn.sequence} · {turn.description}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Sin turnos recientes de tu equipo.</Text>
                    )}

                    {managerTacticalSummary.rivalRecentTurns.length > 0 ? (
                      managerTacticalSummary.rivalRecentTurns.map((turn) => (
                        <Text key={`riv-turn-${turn.sequence}`} style={styles.managerRosterListRow}>
                          Rival · #{turn.sequence} · {turn.description}
                        </Text>
                      ))
                    ) : (
                      <Text style={styles.managerRosterListRow}>Sin turnos recientes del rival.</Text>
                    )}
                  </View>

                  <View style={styles.managerTacticalAlertCard}>
                    <Text style={styles.managerTacticalAlertTitle}>Sugerencias para decidir jugada</Text>
                    {managerTacticalSummary.alerts.map((alert) => (
                      <Text key={alert} style={styles.managerTacticalAlertText}>
                        - {alert}
                      </Text>
                    ))}
                  </View>
                </>
              ) : null}

              <Pressable
                style={[styles.managerButtonOutline, managerSubmitting ? styles.managerButtonDisabled : null]}
                disabled={managerSubmitting}
                onPress={submitLineupToGame}
              >
                <Text style={styles.managerButtonOutlineText}>Enviar lineup con posiciones</Text>
              </Pressable>

              {managerUiStatus.kind !== 'idle' ? (
                <View
                  style={
                    managerUiStatus.kind === 'success' ? styles.managerStatusSuccess : styles.managerStatusError
                  }
                >
                  <Text
                    style={
                      managerUiStatus.kind === 'success'
                        ? styles.managerStatusSuccessText
                        : styles.managerStatusErrorText
                    }
                  >
                    {managerUiStatus.message}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.kpiRow}>
            {activeModule.kpis.map((kpi) => (
              <View key={kpi.label} style={styles.kpiCard}>
                <Text style={styles.kpiValue}>{kpi.value}</Text>
                <Text style={styles.kpiLabel}>{kpi.label}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Acciones del modulo</Text>
          {moduleActions.length > 0 ? (
            moduleActions.map((action) => (
              <Pressable key={action} style={styles.actionButton} onPress={() => handleModuleAction(action)}>
                <Text style={styles.actionText}>{action}</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.readOnlyCard}>
              <Text style={styles.readOnlyText}>
                Este modulo esta en modo solo lectura para tu perfil.
              </Text>
            </View>
          )}

          {lastAction ? (
            <View style={styles.feedbackCard}>
              <Text style={styles.feedbackEyebrow}>EJECUCION SIMULADA</Text>
              <Text style={styles.feedbackAction}>{lastAction}</Text>
              <Text style={styles.feedbackBody}>
                Flujo procesado para el perfil {activeRole.label.toLowerCase()}.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const canManageLiveScoring =
    currentRoleId === 'manager' || officialScoringRoles.includes(currentRoleId);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={[styles.scrollContent, styles.scrollBottomPad]}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>PLAYSPORT APP</Text>
          <Text style={styles.heroTitle}>Jornada Activa</Text>
          <Text style={styles.heroBody}>18 juegos hoy entre beisbol y softbol. 6 sedes con cobertura en vivo.</Text>
          <View style={styles.profileModePill}>
            <Text style={styles.profileModeText}>Modo: {activeRole.label}</Text>
          </View>
          <Pressable style={styles.heroButton} onPress={() => openModule('live-scoring')}>
            <Text style={styles.heroButtonText}>
              {canManageLiveScoring ? 'Gestionar anotacion en vivo' : 'Ver marcador en vivo'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.policyCard}>
          <Text style={styles.policyTitle}>Regla de acceso</Text>
          <Text style={styles.policyBody}>{getAccessPolicy(currentRoleId)}</Text>
        </View>

        {activeTab === 'home' ? (
          <>
            <Text style={styles.sectionTitle}>Funciones disponibles</Text>
            {visibleModules.map((module) => (
              <Pressable key={module.id} style={styles.moduleCard} onPress={() => openModule(module.id)}>
                <View style={styles.moduleBadgeSmall}>
                  <Text style={styles.moduleBadgeTextSmall}>{module.badge}</Text>
                </View>
                <View style={styles.moduleBodyWrap}>
                  <Text style={styles.moduleCardTitle}>{module.title}</Text>
                  <Text style={styles.moduleCardSummary}>{module.summary}</Text>
                </View>
                <View style={styles.moduleGoPill}>
                  <Text style={styles.moduleGoText}>Entrar</Text>
                </View>
              </Pressable>
            ))}

            <Text style={styles.sectionTitle}>Actividad</Text>
            <View style={styles.activityCard}>
              {activityFeed.map((item) => (
                <View key={item} style={styles.activityRow}>
                  <View style={styles.activityDot} />
                  <Text style={styles.activityText}>{item}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {activeTab === 'live' ? (
          <>
            <Text style={styles.sectionTitle}>Partidos en vivo</Text>
            {liveFeed.map((feed) => (
              <View key={feed.game} style={styles.liveCard}>
                <Text style={styles.liveLeague}>{feed.league}</Text>
                <Text style={styles.liveGame}>{feed.game}</Text>
                <Text style={styles.liveState}>{feed.state}</Text>
                <Pressable style={styles.liveButton} onPress={() => openModule('live-scoring')}>
                  <Text style={styles.liveButtonText}>
                    {canManageLiveScoring ? 'Gestionar pizarra' : 'Ver pizarra'}
                  </Text>
                </Pressable>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Herramientas relacionadas</Text>
            {visibleModules.map((module) => (
              <Pressable key={module.id} style={styles.moduleCard} onPress={() => openModule(module.id)}>
                <View style={styles.moduleBadgeSmall}>
                  <Text style={styles.moduleBadgeTextSmall}>{module.badge}</Text>
                </View>
                <View style={styles.moduleBodyWrap}>
                  <Text style={styles.moduleCardTitle}>{module.title}</Text>
                  <Text style={styles.moduleCardSummary}>{module.summary}</Text>
                </View>
                <View style={styles.moduleGoPill}>
                  <Text style={styles.moduleGoText}>Abrir</Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}

        {activeTab === 'events' ? (
          <>
            <Text style={styles.sectionTitle}>Cartelera del fin de semana</Text>
            <View style={styles.activityCard}>
              <View style={styles.eventHeaderRow}>
                <Text style={styles.eventTitle}>Sabado 7 Nov</Text>
                <Text style={styles.eventCount}>9 eventos</Text>
              </View>
              <Text style={styles.eventBody}>Valencia, Maracay, Caracas, Barquisimeto</Text>
              <Pressable style={styles.heroButton} onPress={() => openModule('events-map')}>
                <Text style={styles.heroButtonText}>Abrir mapa interactivo</Text>
              </Pressable>
            </View>

            {visibleModules.map((module) => (
              <Pressable key={module.id} style={styles.moduleCard} onPress={() => openModule(module.id)}>
                <View style={styles.moduleBadgeSmall}>
                  <Text style={styles.moduleBadgeTextSmall}>{module.badge}</Text>
                </View>
                <View style={styles.moduleBodyWrap}>
                  <Text style={styles.moduleCardTitle}>{module.title}</Text>
                  <Text style={styles.moduleCardSummary}>{module.summary}</Text>
                </View>
                <View style={styles.moduleGoPill}>
                  <Text style={styles.moduleGoText}>Abrir</Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}

        {activeTab === 'profile' ? (
          <>
            <Text style={styles.sectionTitle}>Perfil deportivo</Text>
            <View style={styles.profileCard}>
              <Text style={styles.profileName}>Roger Diaz</Text>
              <Text style={styles.profileMeta}>Perfil activo: {activeRole.label}</Text>
              <View style={styles.profileStatRow}>
                {profileStats.map((stat) => (
                  <View key={stat.label} style={styles.profileStatCard}>
                    <Text style={styles.profileStatValue}>{stat.value}</Text>
                    <Text style={styles.profileStatLabel}>{stat.label}</Text>
                  </View>
                ))}
              </View>

              {currentRoleId === 'manager' ? (
                <View style={styles.profileManagerContextCard}>
                  <Text style={styles.profileManagerContextTitle}>Contexto de manager</Text>
                  <Text style={styles.profileManagerContextBody}>
                    Antes de revisar roster o crear lineup, selecciona torneo y equipo de trabajo.
                  </Text>

                  <Text style={styles.profileManagerLabel}>Tournament ID</Text>
                  <TextInput
                    value={managerTournamentId}
                    onChangeText={updateManagerTournamentId}
                    style={styles.profileManagerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.profileManagerLabel}>Team ID</Text>
                  <TextInput
                    value={managerTeamId}
                    onChangeText={updateManagerTeamId}
                    style={styles.profileManagerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.profileManagerLabel}>Game ID</Text>
                  <TextInput
                    value={managerGameId}
                    onChangeText={updateManagerGameId}
                    style={styles.profileManagerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Text style={styles.profileManagerLabel}>Manager ID</Text>
                  <TextInput
                    value={managerProfileId}
                    onChangeText={updateManagerProfileId}
                    style={styles.profileManagerInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <Pressable
                    style={[styles.profileManagerButton, managerSubmitting ? styles.managerButtonDisabled : null]}
                    disabled={managerSubmitting}
                    onPress={activateManagerContext}
                  >
                    <Text style={styles.profileManagerButtonText}>
                      {managerContextReady ? 'Actualizar contexto activo' : 'Activar contexto de manager'}
                    </Text>
                  </Pressable>

                  <Text style={styles.profileManagerContextState}>
                    Estado: {managerContextReady ? 'Contexto activo' : 'Contexto pendiente'}
                  </Text>

                  <View style={styles.profileManagerIconRow}>
                    <Pressable style={styles.profileManagerIconButton} onPress={openManagerLineupBuilder}>
                      <Text style={styles.profileManagerIconBadge}>LU</Text>
                      <Text style={styles.profileManagerIconLabel}>Crear lineup</Text>
                    </Pressable>

                    <Pressable style={styles.profileManagerIconButton} onPress={openManagerLineupSummary}>
                      <Text style={styles.profileManagerIconBadge}>RS</Text>
                      <Text style={styles.profileManagerIconLabel}>Resumen tactico</Text>
                    </Pressable>

                    <Pressable style={styles.profileManagerIconButton} onPress={openManagerRivalLineupViewer}>
                      <Text style={styles.profileManagerIconBadge}>RV</Text>
                      <Text style={styles.profileManagerIconLabel}>Ver lineup rival</Text>
                    </Pressable>

                    <Pressable style={styles.profileManagerIconButton} onPress={openManagerLiveScoring}>
                      <Text style={styles.profileManagerIconBadge}>EV</Text>
                      <Text style={styles.profileManagerIconLabel}>En vivo jugada</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <Pressable style={styles.changeRoleButton} onPress={changeRole}>
                <Text style={styles.changeRoleText}>Cambiar rol de entrada</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>Herramientas de tu rol</Text>
            {visibleModules.map((module) => (
              <Pressable key={module.id} style={styles.moduleCard} onPress={() => openModule(module.id)}>
                <View style={styles.moduleBadgeSmall}>
                  <Text style={styles.moduleBadgeTextSmall}>{module.badge}</Text>
                </View>
                <View style={styles.moduleBodyWrap}>
                  <Text style={styles.moduleCardTitle}>{module.title}</Text>
                  <Text style={styles.moduleCardSummary}>{module.summary}</Text>
                </View>
                <View style={styles.moduleGoPill}>
                  <Text style={styles.moduleGoText}>Entrar</Text>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}

        {lastAction ? (
          <View style={styles.inlineFeedback}>
            <Text style={styles.inlineFeedbackText}>Ultima accion: {lastAction}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.tabWrap}>
        <View style={styles.tabBar}>
          {tabs.map((tab) => {
            const selected = tab.id === activeTab;
            return (
              <Pressable
                key={tab.id}
                style={[styles.tabButton, selected ? styles.tabButtonActive : null]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text style={[styles.tabText, selected ? styles.tabTextActive : null]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4efe6'
  },
  roleSetupContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28
  },
  roleSetupHero: {
    backgroundColor: '#17374a',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2d5f78',
    padding: 15,
    marginBottom: 12
  },
  roleSetupTitle: {
    color: '#f7fbfe',
    fontSize: 28,
    lineHeight: 31,
    fontWeight: '800'
  },
  roleSetupBody: {
    color: '#d7e9ef',
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21
  },
  roleOptionCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d6e1e8',
    borderRadius: 16,
    padding: 12,
    marginBottom: 9
  },
  roleOptionCardSelected: {
    borderColor: '#1ea0bb',
    borderWidth: 2
  },
  roleOptionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6
  },
  roleOptionLabel: {
    color: '#1c3a4d',
    fontSize: 18,
    fontWeight: '800'
  },
  roleOptionLabelSelected: {
    color: '#0f6f83'
  },
  roleOptionBadge: {
    color: '#4f6a7a',
    fontSize: 11,
    fontWeight: '700'
  },
  roleOptionBadgeSelected: {
    color: '#0f6f83'
  },
  roleOptionSummary: {
    color: '#4f6a7a',
    fontSize: 13,
    lineHeight: 18
  },
  roleConfirmButton: {
    marginTop: 8,
    backgroundColor: '#f1723a',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center'
  },
  roleConfirmText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12
  },
  scrollBottomPad: {
    paddingBottom: 110
  },
  eyebrow: {
    color: '#bde9f4',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8
  },
  heroCard: {
    backgroundColor: '#17374a',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2d5f78',
    marginBottom: 10
  },
  heroTitle: {
    color: '#f7fbfe',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800'
  },
  heroBody: {
    color: '#d8e8ef',
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21
  },
  profileModePill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  profileModeText: {
    color: '#dff2f8',
    fontWeight: '700',
    fontSize: 12
  },
  heroButton: {
    marginTop: 12,
    backgroundColor: '#f1723a',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-start'
  },
  heroButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14
  },
  policyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10
  },
  policyTitle: {
    color: '#1c3a4d',
    fontWeight: '800',
    fontSize: 14
  },
  policyBody: {
    color: '#4f6a7a',
    marginTop: 6,
    lineHeight: 19,
    fontSize: 13
  },
  sectionTitle: {
    marginTop: 6,
    marginBottom: 8,
    color: '#1c3a4d',
    fontWeight: '800',
    fontSize: 19
  },
  moduleCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10
  },
  moduleBadgeSmall: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#163749',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  moduleBadgeTextSmall: {
    color: '#e7f8ff',
    fontWeight: '800',
    fontSize: 12
  },
  moduleBodyWrap: {
    flex: 1,
    marginRight: 8
  },
  moduleCardTitle: {
    color: '#1c3a4d',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 2
  },
  moduleCardSummary: {
    color: '#557081',
    fontSize: 13,
    lineHeight: 18
  },
  moduleGoPill: {
    backgroundColor: '#1ea0bb',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  moduleGoText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12
  },
  activityCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 9
  },
  activityDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: '#1ea0bb',
    marginTop: 7,
    marginRight: 8
  },
  activityText: {
    flex: 1,
    color: '#4b6779',
    lineHeight: 19,
    fontSize: 13
  },
  liveCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10
  },
  liveLeague: {
    color: '#668397',
    fontWeight: '700',
    fontSize: 12
  },
  liveGame: {
    color: '#1c3a4d',
    fontWeight: '800',
    marginTop: 6,
    fontSize: 18
  },
  liveState: {
    color: '#4f6a7a',
    marginTop: 5,
    fontSize: 13
  },
  liveButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: '#f1723a',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  liveButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  eventTitle: {
    color: '#1c3a4d',
    fontSize: 17,
    fontWeight: '800'
  },
  eventCount: {
    color: '#1ea0bb',
    fontWeight: '800'
  },
  eventBody: {
    marginTop: 6,
    color: '#4f6a7a',
    marginBottom: 2
  },
  profileCard: {
    backgroundColor: '#17374a',
    borderColor: '#2d5f78',
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    marginBottom: 10
  },
  profileName: {
    color: '#f7fbfe',
    fontSize: 23,
    fontWeight: '800'
  },
  profileMeta: {
    color: '#bfd8e3',
    marginTop: 4,
    marginBottom: 10
  },
  profileStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  profileStatCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flex: 1,
    marginRight: 8
  },
  profileStatValue: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 18
  },
  profileStatLabel: {
    color: '#c9e0e9',
    fontSize: 12,
    marginTop: 3
  },
  profileManagerContextCard: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 10
  },
  profileManagerContextTitle: {
    color: '#f7fbfe',
    fontWeight: '800',
    fontSize: 14
  },
  profileManagerContextBody: {
    color: '#d5e8f0',
    marginTop: 5,
    marginBottom: 6,
    fontSize: 12,
    lineHeight: 17
  },
  profileManagerLabel: {
    color: '#d7ebf3',
    marginTop: 7,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: '700'
  },
  profileManagerInput: {
    backgroundColor: '#f9fcfe',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 10,
    color: '#1c3a4d',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13
  },
  profileManagerButton: {
    marginTop: 10,
    backgroundColor: '#f1723a',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center'
  },
  profileManagerButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13
  },
  profileManagerContextState: {
    marginTop: 7,
    color: '#d8ecf4',
    fontWeight: '700',
    fontSize: 12
  },
  profileManagerIconRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  profileManagerIconButton: {
    flex: 1,
    marginRight: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    paddingVertical: 8,
    alignItems: 'center'
  },
  profileManagerIconBadge: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12
  },
  profileManagerIconLabel: {
    marginTop: 2,
    color: '#ddf0f7',
    fontSize: 10,
    fontWeight: '700'
  },
  changeRoleButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#1ea0bb',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  changeRoleText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12
  },
  inlineFeedback: {
    backgroundColor: '#1f4c64',
    borderRadius: 14,
    padding: 11,
    marginBottom: 10
  },
  inlineFeedbackText: {
    color: '#e8f8ff',
    fontWeight: '700',
    fontSize: 13
  },
  tabWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10
  },
  tabBar: {
    backgroundColor: '#132f40',
    borderRadius: 16,
    padding: 6,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  tabButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center'
  },
  tabButtonActive: {
    backgroundColor: '#1ea0bb'
  },
  tabText: {
    color: '#9ec0d0',
    fontSize: 12,
    fontWeight: '700'
  },
  tabTextActive: {
    color: '#ffffff'
  },
  backButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#c7d6df',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 13,
    marginBottom: 10
  },
  backButtonText: {
    color: '#355a6f',
    fontWeight: '700'
  },
  moduleHero: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 10
  },
  moduleBadgeLarge: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: '#163749',
    alignItems: 'center',
    justifyContent: 'center'
  },
  moduleBadgeTextLarge: {
    color: '#f0faff',
    fontWeight: '800',
    fontSize: 16
  },
  moduleTitleDetail: {
    color: '#1c3a4d',
    marginTop: 10,
    fontWeight: '800',
    fontSize: 28,
    lineHeight: 31
  },
  moduleSummaryDetail: {
    color: '#4f6a7a',
    marginTop: 7,
    lineHeight: 22,
    fontSize: 15
  },
  moduleRoleHint: {
    marginTop: 8,
    color: '#1ea0bb',
    fontWeight: '700',
    fontSize: 12
  },
  permissionCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  permissionTitle: {
    color: '#1c3a4d',
    fontSize: 14,
    fontWeight: '800'
  },
  permissionBody: {
    color: '#4f6a7a',
    marginTop: 5,
    lineHeight: 18,
    fontSize: 12
  },
  scoreboardCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  scoreboardPrivateCard: {
    backgroundColor: '#f6fbff',
    borderColor: '#cfe3ee',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  scoreboardTitle: {
    color: '#1c3a4d',
    fontSize: 14,
    fontWeight: '800'
  },
  scoreboardScore: {
    color: '#17374a',
    fontSize: 20,
    marginTop: 6,
    fontWeight: '800'
  },
  scoreboardMeta: {
    color: '#4f6a7a',
    marginTop: 4,
    lineHeight: 18,
    fontSize: 12
  },
  kpiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  kpiCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 8,
    flex: 1,
    marginRight: 8
  },
  kpiValue: {
    color: '#1c3a4d',
    fontWeight: '800',
    fontSize: 16
  },
  kpiLabel: {
    color: '#4f6a7a',
    marginTop: 3,
    fontSize: 11,
    lineHeight: 14
  },
  actionButton: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  actionText: {
    color: '#1c3a4d',
    fontSize: 14,
    fontWeight: '700'
  },
  readOnlyCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  readOnlyText: {
    color: '#4f6a7a',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600'
  },
  managerPanelCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10
  },
  managerPanelTitle: {
    color: '#1c3a4d',
    fontSize: 15,
    fontWeight: '800'
  },
  managerPanelBody: {
    color: '#4f6a7a',
    marginTop: 5,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18
  },
  managerContextCard: {
    marginTop: 2,
    backgroundColor: '#f4fafc',
    borderColor: '#cfe0e8',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10
  },
  managerContextTitle: {
    color: '#1c3a4d',
    fontSize: 13,
    fontWeight: '800'
  },
  managerContextBody: {
    color: '#4f6a7a',
    marginTop: 3,
    fontSize: 12
  },
  managerContextWarning: {
    marginTop: 4,
    backgroundColor: '#fff7ed',
    borderColor: '#f5c9a3',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10
  },
  managerContextWarningText: {
    color: '#9b4f1e',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700'
  },
  managerQuickIconRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  managerQuickIconButton: {
    flex: 1,
    marginRight: 6,
    borderColor: '#c5ddea',
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#eef7fb',
    paddingVertical: 8,
    alignItems: 'center'
  },
  managerQuickIconBadge: {
    color: '#17374a',
    fontWeight: '800',
    fontSize: 12
  },
  managerQuickIconLabel: {
    marginTop: 2,
    color: '#2d5367',
    fontSize: 10,
    fontWeight: '700'
  },
  managerLivePlayCard: {
    backgroundColor: '#ffffff',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10
  },
  managerLiveHintText: {
    marginTop: 8,
    color: '#355a6f',
    fontSize: 12,
    fontWeight: '700'
  },
  managerLabel: {
    color: '#355a6f',
    marginTop: 8,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: '700'
  },
  managerInput: {
    backgroundColor: '#f9fcfe',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 10,
    color: '#1c3a4d',
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 13
  },
  managerToggle: {
    marginTop: 8,
    borderRadius: 10,
    borderColor: '#d6e1e8',
    borderWidth: 1,
    backgroundColor: '#f9fcfe',
    paddingVertical: 9,
    paddingHorizontal: 10
  },
  managerToggleActive: {
    borderColor: '#1ea0bb',
    backgroundColor: '#eef9fc'
  },
  managerToggleText: {
    color: '#1c3a4d',
    fontSize: 13,
    fontWeight: '700'
  },
  managerButton: {
    backgroundColor: '#17374a',
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 10
  },
  managerButtonDisabled: {
    opacity: 0.55
  },
  managerButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13
  },
  managerButtonOutline: {
    borderColor: '#17374a',
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 8
  },
  managerButtonOutlineText: {
    color: '#17374a',
    fontWeight: '700',
    fontSize: 13
  },
  managerDivider: {
    height: 1,
    backgroundColor: '#dde8ee',
    marginTop: 12,
    marginBottom: 4
  },
  rosterChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8
  },
  rosterChip: {
    backgroundColor: '#eef7fb',
    borderColor: '#c5ddea',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 6,
    marginBottom: 6
  },
  rosterChipText: {
    color: '#1c3a4d',
    fontSize: 12,
    fontWeight: '700'
  },
  rosterSelectChip: {
    backgroundColor: '#e7f2f7',
    borderColor: '#b9d2df',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginRight: 6,
    marginBottom: 6
  },
  rosterSelectChipText: {
    color: '#24485d',
    fontSize: 11,
    fontWeight: '700'
  },
  rosterSelectChipActive: {
    backgroundColor: '#d5ecf5',
    borderColor: '#7fb9d1'
  },
  managerRosterListCard: {
    marginTop: 8,
    backgroundColor: '#f7fbfd',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 10,
    padding: 9
  },
  managerRosterListTitle: {
    color: '#1c3a4d',
    fontWeight: '800',
    fontSize: 12,
    marginBottom: 5
  },
  managerRosterListRow: {
    color: '#446073',
    fontSize: 12,
    marginBottom: 4
  },
  lineupEntryListCard: {
    marginTop: 8,
    backgroundColor: '#f7fbfd',
    borderColor: '#d6e1e8',
    borderWidth: 1,
    borderRadius: 10,
    padding: 9
  },
  lineupEntryRow: {
    backgroundColor: '#edf5f9',
    borderColor: '#d2e3ec',
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6
  },
  lineupEntryText: {
    color: '#1c3a4d',
    fontSize: 12,
    fontWeight: '700'
  },
  managerStatusSuccess: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3d9f5e',
    backgroundColor: '#edf9f1',
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  managerStatusSuccessText: {
    color: '#216f3a',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  managerStatusError: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d77b7b',
    backgroundColor: '#fff3f3',
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  managerStatusErrorText: {
    color: '#8a2f2f',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  feedbackCard: {
    backgroundColor: '#17374a',
    borderRadius: 16,
    padding: 14,
    marginTop: 4,
    marginBottom: 14
  },
  feedbackEyebrow: {
    color: '#bde9f4',
    fontSize: 11,
    letterSpacing: 1,
    fontWeight: '800'
  },
  feedbackAction: {
    color: '#ffffff',
    marginTop: 7,
    fontSize: 16,
    fontWeight: '800'
  },
  feedbackBody: {
    color: '#d8e8ef',
    marginTop: 5,
    lineHeight: 20
  }
});
