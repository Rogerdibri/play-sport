import { isCalendarDate } from './events-calendar.js';
import { isProfileLocation } from './venezuela.js';
import { registrationIdentification } from './registration.js';

export const tournamentStates = {
  draft: 'Borrador',
  registration: 'Inscripciones abiertas',
  running: 'En desarrollo',
  suspended: 'Suspendido',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
} as const;
export const tournamentPhaseKinds = {
  'round-robin': 'Todos contra todos',
  knockout: 'Eliminación directa',
  'double-elimination': 'Doble eliminación',
  swiss: 'Sistema suizo',
  repechage: 'Repechaje',
  custom: 'Formato personalizado',
} as const;
export const softballModalities = ['Lento', 'Rápido', 'Modificado'] as const;
export function isSoftballSport(sport: string) {
  return ['softball', 'softbol'].includes(
    sport
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim(),
  );
}
export function tournamentPhaseUsesSeries(
  kind: keyof typeof tournamentPhaseKinds,
) {
  return (
    kind === 'knockout' || kind === 'double-elimination' || kind === 'repechage'
  );
}
export type TournamentLocation = {
  stateId: string;
  municipalityId: string;
  address: string;
  mapUrl: string;
};
export type TournamentVenue = TournamentLocation & { id: string; name: string };
export type TournamentTeam = {
  id: string;
  name: string;
  managerId: string;
  managerIdentification: string;
  status: 'pending' | 'accepted' | 'withdrawn';
  rosterStatus: 'pending' | 'approved' | 'rejected';
  rosterSignature: string;
  blocked: boolean;
  blockReason: string;
  blockScopes: Array<'registration' | 'lineup' | 'participation'>;
  withdrawalReason: string;
  enrollment?: {
    status: 'invited' | 'draft' | 'submitted' | 'changes-requested';
    contact: string;
    notes: string;
    submittedAt: string;
    reviewNotes: string;
  };
};
export type TournamentPhase = {
  id: string;
  name: string;
  kind: keyof typeof tournamentPhaseKinds;
  status: 'draft' | 'running' | 'finished';
  sourcePhaseId: string;
  teamIds: string[];
  groups: Array<{
    id: string;
    name: string;
    teamIds: string[];
    teamLimit?: number | null;
    qualifiers?: number | null;
  }>;
  teamLimit?: number | null;
  turns: number;
  bestOf: number;
  maxGames?: number | null;
  purpose?: 'regular' | 'tie-breaker';
  tieBreakReason?: string;
  qualifiers: number | null;
  pairing: 'seeded' | 'draw' | 'manual';
  rules: string;
};
export type TournamentFixture = {
  id: string;
  phaseId: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  homeSource: string;
  awaySource: string;
  date: string;
  time: string;
  venueId: string;
  durationMinutes: number;
  scorekeeperIds: string[];
  series: string;
};
export type TournamentSanction = {
  id: string;
  target: 'team' | 'player';
  targetId: string;
  reason: string;
  phaseId: string;
  from: string;
  until: string;
  gamesRemaining: number | null;
  active: boolean;
};
export type TournamentDocument = {
  id: string;
  name: string;
  leagueName: string;
  leagueId?: string;
  description: string;
  season: string;
  sport: string;
  modality: string;
  category: string;
  branch: string;
  status: keyof typeof tournamentStates;
  location: TournamentLocation;
  startsOn: string;
  endsOn: string;
  contact: string;
  socialLinks: string[];
  teamLimit: number | null;
  registrationDeadline: string;
  feeCents: number;
  rules: string;
  customRules: Array<{ name: string; value: string }>;
  venues: TournamentVenue[];
  teams: TournamentTeam[];
  phases: TournamentPhase[];
  fixtures: TournamentFixture[];
  sanctions: TournamentSanction[];
  notices: Array<{ id: string; title: string; text: string; public: boolean }>;
};
export type TournamentRecord = {
  document: TournamentDocument;
  revision: number;
  updatedAt: string;
  public: boolean;
  officialFixtureIds?: string[];
};
export function supportsOfficialTournamentScoring(sport: string) {
  return ['baseball', 'beisbol', 'softball', 'softbol'].includes(
    sport
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim(),
  );
}
export function newTournament(id: string): TournamentDocument {
  return {
    id,
    name: '',
    leagueName: '',
    description: '',
    season: '',
    sport: 'baseball',
    modality: '',
    category: '',
    branch: '',
    status: 'draft',
    location: { stateId: '', municipalityId: '', address: '', mapUrl: '' },
    startsOn: '',
    endsOn: '',
    contact: '',
    socialLinks: [],
    teamLimit: null,
    registrationDeadline: '',
    feeCents: 0,
    rules: '',
    customRules: [],
    venues: [],
    teams: [],
    phases: [],
    fixtures: [],
    sanctions: [],
    notices: [],
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Se esperaba un objeto del torneo.');
  return value as Record<string, unknown>;
}
function fields(value: unknown, keys: string[]) {
  const row = object(value);
  if (Object.keys(row).some((key) => !keys.includes(key)))
    throw new Error('El torneo contiene campos desconocidos.');
  return row;
}
function text(
  value: unknown,
  label: string,
  maximum = 200,
  required = false,
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    (required && !value.trim())
  )
    throw new Error(`Revisa ${label}.`);
  return value.trim();
}
function id(value: unknown) {
  const result = text(value, 'el identificador', 160, true);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(result))
    throw new Error('El identificador contiene caracteres no permitidos.');
  return result;
}
function choice<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !values.some((item) => item === value))
    throw new Error(`Revisa ${label}.`);
  return value as T;
}
function integer(value: unknown, minimum: number, label: string) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new Error(`Revisa ${label}.`);
  return value;
}
function nullableInteger(value: unknown, minimum: number, label: string) {
  return value === null ? null : integer(value, minimum, label);
}
function bool(value: unknown) {
  if (typeof value !== 'boolean')
    throw new Error('El indicador del torneo no es válido.');
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 20000)
    throw new Error('La lista del torneo es inválida o demasiado grande.');
  return value.map(parse);
}
function unique<T extends { id: string }>(rows: T[], label: string): T[] {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error(`Hay identificadores duplicados en ${label}.`);
  return rows;
}
function ids(value: unknown) {
  const result = list(value, id);
  if (new Set(result).size !== result.length)
    throw new Error('Hay participantes duplicados.');
  return result;
}
function date(value: unknown) {
  const result = text(value, 'la fecha', 10);
  if (result && !isCalendarDate(result))
    throw new Error('La fecha no existe en el calendario.');
  return result;
}
function link(value: unknown) {
  const result = text(value, 'el enlace', 2000);
  if (result) {
    let url: URL;
    try {
      url = new URL(result);
    } catch {
      throw new Error('Indica un enlace completo http:// o https://.');
    }
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Solo se permiten enlaces web sin credenciales.');
  }
  return result;
}
function location(value: unknown): TournamentLocation {
  const row = fields(value, ['stateId', 'municipalityId', 'address', 'mapUrl']);
  const result = {
    stateId: text(row.stateId, 'el estado', 100),
    municipalityId: text(row.municipalityId, 'el municipio', 160),
    address: text(row.address, 'la dirección', 1000),
    mapUrl: link(row.mapUrl),
  };
  if ((result.stateId || result.municipalityId) && !isProfileLocation(result))
    throw new Error('Selecciona estado y municipio del catálogo territorial.');
  return result;
}
export function readTournament(value: unknown): TournamentDocument {
  const row = fields(value, [
    ...Object.keys(newTournament('template')),
    'leagueId',
  ]);
  const result: TournamentDocument = {
    id: id(row.id),
    name: text(row.name, 'el nombre del torneo'),
    leagueName: text(row.leagueName, 'la liga'),
    ...(row.leagueId !== undefined ? { leagueId: id(row.leagueId) } : {}),
    description: text(row.description, 'la descripción', 5000),
    season: text(row.season, 'la temporada'),
    sport: text(row.sport, 'el deporte', 100, true),
    modality: text(row.modality, 'la modalidad'),
    category: text(row.category, 'la categoría'),
    branch: text(row.branch, 'la rama'),
    status: choice(
      row.status,
      Object.keys(tournamentStates) as Array<keyof typeof tournamentStates>,
      'el estado del torneo',
    ),
    location: location(row.location),
    startsOn: date(row.startsOn),
    endsOn: date(row.endsOn),
    contact: text(row.contact, 'el contacto público', 500),
    socialLinks: list(row.socialLinks, link),
    teamLimit: nullableInteger(row.teamLimit, 1, 'el cupo de equipos'),
    registrationDeadline: date(row.registrationDeadline),
    feeCents: integer(row.feeCents, 0, 'la inscripción en centavos'),
    rules: text(row.rules, 'el reglamento', 30000),
    customRules: list(row.customRules, (item) => {
      const r = fields(item, ['name', 'value']);
      return {
        name: text(r.name, 'la regla', 200, true),
        value: text(r.value, 'el contenido de la regla', 5000),
      };
    }),
    venues: unique(
      list(row.venues, (item) => {
        const r = fields(item, [
          'id',
          'name',
          'stateId',
          'municipalityId',
          'address',
          'mapUrl',
        ]);
        return {
          id: id(r.id),
          name: text(r.name, 'la sede', 200, true),
          ...location({
            stateId: r.stateId,
            municipalityId: r.municipalityId,
            address: r.address,
            mapUrl: r.mapUrl,
          }),
        };
      }),
      'sedes',
    ),
    teams: unique(
      list(row.teams, (item) => {
        const r = fields(item, [
          'id',
          'name',
          'managerId',
          'managerIdentification',
          'status',
          'rosterStatus',
          'rosterSignature',
          'blocked',
          'blockReason',
          'blockScopes',
          'withdrawalReason',
          'enrollment',
        ]);
        let enrollment: TournamentTeam['enrollment'];
        if (r.enrollment !== undefined) {
          const entry = fields(r.enrollment, [
            'status',
            'contact',
            'notes',
            'submittedAt',
            'reviewNotes',
          ]);
          enrollment = {
            status: choice(
              entry.status,
              ['invited', 'draft', 'submitted', 'changes-requested'],
              'el envío de la inscripción',
            ),
            contact: text(entry.contact, 'el contacto del equipo', 500),
            notes: text(entry.notes, 'los detalles del equipo', 5000),
            submittedAt: text(entry.submittedAt, 'la fecha del envío', 40),
            reviewNotes: text(
              entry.reviewNotes,
              'las correcciones solicitadas',
              2000,
            ),
          };
          if (
            enrollment.submittedAt &&
            !Number.isFinite(Date.parse(enrollment.submittedAt))
          )
            throw new Error('La fecha de envío de inscripción no es válida.');
          if (r.managerIdentification)
            registrationIdentification(String(r.managerIdentification));
        }
        return {
          id: id(r.id),
          name: text(r.name, 'el equipo', 200, true),
          managerId: text(r.managerId, 'el manager', 160),
          managerIdentification: text(
            r.managerIdentification,
            'la identidad del manager',
            100,
          ),
          status: choice(
            r.status,
            ['pending', 'accepted', 'withdrawn'],
            'la inscripción del equipo',
          ),
          rosterStatus: choice(
            r.rosterStatus,
            ['pending', 'approved', 'rejected'],
            'la aprobación del roster',
          ),
          rosterSignature: text(
            r.rosterSignature,
            'la revisión del roster',
            100,
          ),
          blocked: bool(r.blocked),
          blockReason: text(r.blockReason, 'el motivo del bloqueo', 2000),
          blockScopes: list(r.blockScopes, (scope) =>
            choice(
              scope,
              ['registration', 'lineup', 'participation'],
              'el alcance del bloqueo',
            ),
          ),
          withdrawalReason: text(
            r.withdrawalReason,
            'el motivo del retiro',
            2000,
          ),
          ...(enrollment ? { enrollment } : {}),
        };
      }),
      'equipos',
    ),
    phases: unique(
      list(row.phases, (item) => {
        const r = fields(item, [
          'id',
          'name',
          'kind',
          'status',
          'sourcePhaseId',
          'teamIds',
          'groups',
          'teamLimit',
          'turns',
          'bestOf',
          'maxGames',
          'purpose',
          'tieBreakReason',
          'qualifiers',
          'pairing',
          'rules',
        ]);
        return {
          id: id(r.id),
          name: text(r.name, 'la fase', 200, true),
          kind: choice(
            r.kind,
            Object.keys(tournamentPhaseKinds) as Array<
              keyof typeof tournamentPhaseKinds
            >,
            'el formato',
          ),
          status: choice(
            r.status,
            ['draft', 'running', 'finished'],
            'el estado de fase',
          ),
          sourcePhaseId: text(r.sourcePhaseId, 'la fase de origen', 160),
          ...('purpose' in r ? { purpose: choice(r.purpose, ['regular', 'tie-breaker'] as const, 'la finalidad de fase') } : {}),
          ...('tieBreakReason' in r ? { tieBreakReason: text(r.tieBreakReason, 'la justificación del desempate', 1000) } : {}),
          teamIds: ids(r.teamIds),
          groups: unique(
            list(r.groups, (item) => {
              const g = fields(item, [
                'id',
                'name',
                'teamIds',
                'teamLimit',
                'qualifiers',
              ]);
              return {
                id: id(g.id),
                name: text(g.name, 'el grupo', 200, true),
                teamIds: ids(g.teamIds),
                ...('teamLimit' in g
                  ? {
                      teamLimit: nullableInteger(
                        g.teamLimit,
                        2,
                        'el cupo del grupo',
                      ),
                    }
                  : {}),
                ...('qualifiers' in g
                  ? {
                      qualifiers: nullableInteger(
                        g.qualifiers,
                        1,
                        'los clasificados del grupo',
                      ),
                    }
                  : {}),
              };
            }),
            'grupos',
          ),
          ...('teamLimit' in r
            ? {
                teamLimit: nullableInteger(
                  r.teamLimit,
                  2,
                  'el cupo del grupo único',
                ),
              }
            : {}),
          turns: integer(r.turns, 1, 'las vueltas'),
          bestOf: integer(r.bestOf, 1, 'los partidos de la serie'),
          ...('maxGames' in r ? { maxGames: nullableInteger(r.maxGames, 1, 'el máximo de partidos de la fase') } : {}),
          qualifiers: nullableInteger(r.qualifiers, 1, 'los clasificados'),
          pairing: choice(
            r.pairing,
            ['seeded', 'draw', 'manual'],
            'los cruces',
          ),
          rules: text(r.rules, 'las reglas de fase', 10000),
        };
      }),
      'fases',
    ),
    fixtures: unique(
      list(row.fixtures, (item) => {
        const r = fields(item, [
          'id',
          'phaseId',
          'round',
          'homeTeamId',
          'awayTeamId',
          'homeSource',
          'awaySource',
          'date',
          'time',
          'venueId',
          'durationMinutes',
          'scorekeeperIds',
          'series',
        ]);
        const time = text(r.time, 'la hora', 5);
        if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
          throw new Error('La hora debe tener formato HH:mm.');
        return {
          id: id(r.id),
          phaseId: id(r.phaseId),
          round: integer(r.round, 1, 'la jornada'),
          homeTeamId: text(r.homeTeamId, 'el local', 160),
          awayTeamId: text(r.awayTeamId, 'el visitante', 160),
          homeSource: text(r.homeSource, 'la plaza local', 500),
          awaySource: text(r.awaySource, 'la plaza visitante', 500),
          date: date(r.date),
          time,
          venueId: text(r.venueId, 'la sede', 160),
          durationMinutes: integer(
            r.durationMinutes,
            1,
            'la duración prevista',
          ),
          scorekeeperIds: ids(r.scorekeeperIds),
          series: text(r.series, 'la serie', 200),
        };
      }),
      'partidos',
    ),
    sanctions: unique(
      list(row.sanctions, (item) => {
        const r = fields(item, [
          'id',
          'target',
          'targetId',
          'reason',
          'phaseId',
          'from',
          'until',
          'gamesRemaining',
          'active',
        ]);
        return {
          id: id(r.id),
          target: choice(r.target, ['team', 'player'], 'la sanción'),
          targetId: id(r.targetId),
          reason: text(r.reason, 'el motivo de sanción', 2000, true),
          phaseId: text(r.phaseId, 'la fase sancionada', 160),
          from: date(r.from),
          until: date(r.until),
          gamesRemaining: nullableInteger(
            r.gamesRemaining,
            0,
            'los partidos de sanción',
          ),
          active: bool(r.active),
        };
      }),
      'sanciones',
    ),
    notices: unique(
      list(row.notices, (item) => {
        const r = fields(item, ['id', 'title', 'text', 'public']);
        return {
          id: id(r.id),
          title: text(r.title, 'el aviso', 200, true),
          text: text(r.text, 'el comunicado', 10000, true),
          public: bool(r.public),
        };
      }),
      'avisos',
    ),
  };
  validateTournament(result);
  return result;
}
export function validateTournament(doc: TournamentDocument) {
  if (!doc.name && !doc.leagueName)
    throw new Error('Indica al menos el nombre de la liga o del torneo.');
  if (doc.startsOn && doc.endsOn && doc.endsOn < doc.startsOn)
    throw new Error('La fecha de cierre no puede preceder al inicio.');
  const teams = new Set(doc.teams.map((team) => team.id)),
    phases = new Map(doc.phases.map((phase) => [phase.id, phase]));
  const venues = new Set(doc.venues.map((venue) => venue.id));
  if (
    doc.teamLimit !== null &&
    doc.teams.filter((team) => team.status === 'accepted').length >
      doc.teamLimit
  )
    throw new Error('Los equipos aceptados superan el cupo configurado.');
  for (const team of doc.teams) {
    if (team.blocked && (!team.blockReason || !team.blockScopes.length))
      throw new Error('El bloqueo requiere motivo y alcance.');
    if (team.status === 'withdrawn' && !team.withdrawalReason)
      throw new Error(
        'Indica el motivo del retiro; no se borrará el historial.',
      );
  }
  for (const phase of doc.phases) {
    if (phase.sourcePhaseId && !phases.has(phase.sourcePhaseId))
      throw new Error('La fase de origen no existe.');
    const visited = new Set([phase.id]);
    let previous = phase.sourcePhaseId;
    while (previous) {
      if (visited.has(previous))
        throw new Error(
          'Las fases no pueden depender circularmente unas de otras.',
        );
      visited.add(previous);
      previous = phases.get(previous)?.sourcePhaseId ?? '';
    }
    if (phase.teamIds.some((team) => !teams.has(team)))
      throw new Error('La fase contiene equipos no inscritos.');
    const grouped = phase.groups.flatMap((group) => group.teamIds);
    if (
      grouped.some((team) => !phase.teamIds.includes(team)) ||
      new Set(grouped).size !== grouped.length
    )
      throw new Error(
        'Un equipo no puede repetirse en grupos de la misma fase ni pertenecer a un grupo sin participar en ella.',
      );
    validateTournamentGroups(phase);
    if (tournamentPhaseUsesSeries(phase.kind) && phase.bestOf % 2 !== 1)
      throw new Error(
        'Una serie al mejor de N requiere un número impar de partidos.',
      );
  }
  for (const fixture of doc.fixtures) {
    const phase = phases.get(fixture.phaseId);
    if (!phase) throw new Error('El partido no pertenece a una fase.');
    if (
      (fixture.homeTeamId && !phase.teamIds.includes(fixture.homeTeamId)) ||
      (fixture.awayTeamId && !phase.teamIds.includes(fixture.awayTeamId))
    )
      throw new Error(
        'Los participantes del partido deben pertenecer a su fase.',
      );
    if (fixture.homeTeamId && fixture.homeTeamId === fixture.awayTeamId)
      throw new Error('Un equipo no puede enfrentarse consigo mismo.');
    if (
      (!fixture.homeTeamId && !fixture.homeSource) ||
      (!fixture.awayTeamId && !fixture.awaySource)
    )
      throw new Error(
        'Define cada equipo o una plaza pendiente de clasificación.',
      );
    if (fixture.time && !fixture.date)
      throw new Error('Asigna la fecha antes de la hora.');
    if (fixture.venueId && !venues.has(fixture.venueId))
      throw new Error('La sede del partido no existe.');
  }
  for (const sanction of doc.sanctions) {
    if (sanction.target === 'team' && !teams.has(sanction.targetId))
      throw new Error('La sanción de equipo debe corresponder a un inscrito.');
    if (sanction.phaseId && !phases.has(sanction.phaseId))
      throw new Error('La fase de la sanción no existe.');
    if (sanction.from && sanction.until && sanction.until < sanction.from)
      throw new Error('La sanción termina antes de comenzar.');
  }
  const conflicts = tournamentScheduleConflicts(doc);
  if (conflicts.length) throw new Error(conflicts.join(' '));
}
export function tournamentScheduleConflicts(doc: TournamentDocument): string[] {
  const messages: string[] = [];
  const start = (g: TournamentFixture) =>
    Date.parse(`${g.date}T${g.time}:00-04:00`);
  const scheduled = doc.fixtures
    .filter((game) => game.date && game.time)
    .sort((a, b) => start(a) - start(b));
  const reserved = new Map<string, { end: number; game: TournamentFixture }>();
  const reported = new Set<string>();
  for (const game of scheduled) {
    const begins = start(game),
      end = begins + game.durationMinutes * 60000;
    const resources = new Set([
      ...(game.venueId ? [`venue:${game.venueId}`] : []),
      ...[game.homeTeamId, game.awayTeamId]
        .filter(Boolean)
        .map((id) => `team:${id}`),
      ...game.scorekeeperIds.map((id) => `scorer:${id}`),
    ]);
    for (const resource of resources) {
      const previous = reserved.get(resource),
        pair = previous ? `${previous.game.id}:${game.id}` : '';
      if (previous && previous.end > begins && !reported.has(pair)) {
        reported.add(pair);
        messages.push(
          `Choque de horario entre jornada ${previous.game.round} y ${game.round}: equipo, sede o anotador ocupado.`,
        );
      }
      if (!previous || previous.end <= end)
        reserved.set(resource, { end, game });
    }
  }
  return messages;
}
export function validateTournamentGroups(
  phase: TournamentPhase,
  complete = false,
) {
  const groups = phase.groups.length
    ? phase.groups
    : [
        {
          name: 'Grupo único',
          teamIds: phase.teamIds,
          teamLimit: phase.teamLimit,
          qualifiers: phase.qualifiers,
        },
      ];
  for (const group of groups) {
    const limit = group.teamLimit;
    if (limit !== undefined && limit !== null) {
      integer(limit, 2, 'el cupo del grupo');
      if (group.teamIds.length > limit)
        throw new Error(
          `${group.name}: los equipos asignados superan el cupo de ${limit}.`,
        );
    }
    if (group.qualifiers !== undefined && group.qualifiers !== null) {
      integer(group.qualifiers, 1, 'los clasificados del grupo');
      if (limit !== undefined && limit !== null && group.qualifiers > limit)
        throw new Error(
          `${group.name}: los clasificados no pueden superar el cupo del grupo.`,
        );
    }
    if (complete) {
      if (limit === undefined || limit === null)
        throw new Error(
          `${group.name}: indica cuántos equipos van a participar antes de generar los cruces.`,
        );
      if (group.teamIds.length !== limit)
        throw new Error(
          `${group.name}: faltan equipos por asignar (${group.teamIds.length} de ${limit}).`,
        );
    }
  }
}

export function newTournamentFixture(
  id: string,
  phaseId: string,
): TournamentFixture {
  return {
    id,
    phaseId,
    round: 1,
    homeTeamId: '',
    awayTeamId: '',
    homeSource: 'Por definir',
    awaySource: 'Por definir',
    date: '',
    time: '',
    venueId: '',
    durationMinutes: 120,
    scorekeeperIds: [],
    series: '',
  };
}
export function generateTournamentFixtures(
  doc: TournamentDocument,
  phaseId: string,
  nextId: () => string,
  random: () => number = Math.random,
): TournamentFixture[] {
  const phase = doc.phases.find((row) => row.id === phaseId);
  if (!phase) throw new Error('Selecciona una fase.');
  if (doc.fixtures.some((game) => game.phaseId === phaseId))
    throw new Error(
      'La fase ya tiene cruces. Edítalos o crea otra fase; no se borró ningún partido.',
    );
  const participants = phase.teamIds;
  if (participants.length < 2)
    throw new Error('Selecciona al menos dos equipos.');
  if (
    participants.some(
      (id) => doc.teams.find((team) => team.id === id)?.status !== 'accepted',
    )
  )
    throw new Error(
      'Acepta las inscripciones de los participantes antes de generar sus cruces.',
    );
  validateTournamentGroups(phase, true);
  const make = (home: string, away: string, round: number, series = '') => ({
    ...newTournamentFixture(nextId(), phase.id),
    homeTeamId: home,
    awayTeamId: away,
    round,
    series,
  });
  if (phase.kind === 'round-robin') {
    const groups = phase.groups.length
      ? phase.groups.map((group) => group.teamIds)
      : [participants];
    if (
      phase.groups.length &&
      new Set(groups.flat()).size !== participants.length
    )
      throw new Error('Asigna a un grupo cada equipo de la fase.');
    const games: TournamentFixture[] = [];
    for (const group of groups) {
      if (group.length < 2)
        throw new Error(
          'Cada grupo necesita al menos dos equipos para generar sus cruces.',
        );
      const rotation: Array<string | null> = [...group];
      if (rotation.length % 2) rotation.push(null);
      for (let round = 0; round < rotation.length - 1; round++) {
        for (let pair = 0; pair < rotation.length / 2; pair++) {
          const a = rotation[pair],
            b = rotation[rotation.length - 1 - pair];
          if (!a || !b) continue;
          for (let turn = 0; turn < phase.turns; turn++) {
            games.push(
              make(
                (round + turn) % 2 ? b : a,
                (round + turn) % 2 ? a : b,
                round + 1 + turn * (rotation.length - 1),
              ),
            );
          }
        }
        rotation.splice(1, 0, rotation.pop() ?? null);
      }
    }
    return games;
  }
  if (phase.kind === 'knockout') {
    if (phase.pairing === 'manual')
      throw new Error(
        'Los cruces manuales se agregan en Calendario, con equipos o plazas pendientes.',
      );
    if (participants.length & (participants.length - 1))
      throw new Error(
        'Para generar esta ronda selecciona 2, 4, 8, 16, 32… equipos. Para pases libres usa cruces personalizados.',
      );
    const ordered = [...participants];
    if (phase.pairing === 'draw')
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    const games: TournamentFixture[] = [];
    for (let pair = 0; pair < ordered.length / 2; pair++) {
      const home = ordered[pair],
        away = ordered[ordered.length - 1 - pair];
      // Only guaranteed games are created; deciding games are added when needed.
      for (let game = 0; game < (phase.bestOf + 1) / 2; game++)
        games.push(
          make(
            game % 2 ? away : home,
            game % 2 ? home : away,
            game + 1,
            `Llave ${pair + 1} · Mejor de ${phase.bestOf}`,
          ),
        );
    }
    return games;
  }
  throw new Error(
    'Este formato se configura con cruces personalizados por ronda. No se inventan emparejamientos ni resultados.',
  );
}
export function tournamentParticipationBlock(
  doc: TournamentDocument,
  teamId: string,
  phaseId: string,
  day: string,
  playerIds: string[] = [],
  kind: 'lineup' | 'play' = 'lineup',
) {
  const team = doc.teams.find((team) => team.id === teamId);
  if (!team) return 'El equipo no está inscrito en este torneo.';
  if (team.status !== 'accepted')
    return team.status === 'withdrawn'
      ? 'El equipo fue retirado del torneo.'
      : 'La inscripción del equipo está pendiente.';
  if (
    team.blocked &&
    (team.blockScopes.includes('participation') ||
      (kind === 'lineup' && team.blockScopes.includes('lineup')))
  )
    return `Equipo bloqueado: ${team.blockReason}`;
  const sanction = doc.sanctions.find(
    (item) =>
      item.active &&
      item.gamesRemaining !== 0 &&
      (!item.phaseId || item.phaseId === phaseId) &&
      (!item.from || item.from <= day) &&
      (!item.until || item.until >= day) &&
      (item.target === 'team'
        ? item.targetId === teamId
        : playerIds.includes(item.targetId)),
  );
  return sanction
    ? 'Hay una sanción vigente que impide esta participación. Consulta al organizador.'
    : null;
}
