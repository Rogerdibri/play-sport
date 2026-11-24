'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Dispatch,
} from 'react';
import {
  newTournament,
  newTournamentFixture,
  readTournament,
  generateTournamentFixtures,
  tournamentStates,
  tournamentPhaseKinds,
  tournamentPhaseUsesSeries,
  validateTournamentGroups,
  softballModalities,
  isSoftballSport,
  venezuelaStates,
  rosterRoleLabels,
  supportsOfficialTournamentScoring,
  isRosterPerson,
  isRosterRole,
  type TournamentDocument,
  type TournamentRecord,
  type TournamentLocation,
  type TournamentTeam,
  type TournamentPhase,
  type TournamentFixture,
  type TournamentSanction,
  type RosterMember,
} from '@playsport/shared';
import { usePlatformSession } from '../../platform-session';
import { useNavigationBusy } from '../../navigation-hooks';
import { InstitutionName } from '../../institutional-logos';
import { EditableInstitutionName } from '../../institution-logo-editor';
import { resizeTournamentGroups } from '../../tournament-groups';
import PublicShare from '../../public-share';
import OrganizerCapacityPanel from './organizer-capacity-panel';
import { officialAccountActor } from '../../platform-navigation';

const failure = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'No se pudo completar la operación del torneo.';
async function request(
  path: string,
  init?: globalThis.RequestInit,
): Promise<unknown> {
  const response = await fetch(`/api/tournaments${path}`, {
    ...init,
    cache: 'no-store',
  });
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      body && typeof body === 'object' && 'message' in body
        ? Array.isArray(body.message)
          ? body.message.join(' ')
          : String(body.message)
        : 'No se pudo consultar el torneo.',
    );
  return body;
}
function record(value: unknown): TournamentRecord {
  if (
    !value ||
    typeof value !== 'object' ||
    !('document' in value) ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !('public' in value) ||
    typeof value.public !== 'boolean' ||
    !('updatedAt' in value) ||
    typeof value.updatedAt !== 'string'
  )
    throw new Error('La respuesta del torneo no es válida.');
  const document = readTournament(value.document);
  const officialFixtureIds =
    'officialFixtureIds' in value ? value.officialFixtureIds : undefined;
  if (
    officialFixtureIds !== undefined &&
    (!Array.isArray(officialFixtureIds) ||
      !officialFixtureIds.every(
        (id) =>
          typeof id === 'string' &&
          document.fixtures.some((fixture) => fixture.id === id),
      ) ||
      new Set(officialFixtureIds).size !== officialFixtureIds.length)
  )
    throw new Error('Los enlaces a partidos oficiales no son válidos.');
  return {
    document,
    revision: value.revision,
    public: value.public,
    updatedAt: value.updatedAt,
    officialFixtureIds,
  };
}
function records(value: unknown): TournamentRecord[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('tournaments' in value) ||
    !Array.isArray(value.tournaments)
  )
    throw new Error('No se pudo interpretar la lista de torneos.');
  return value.tournaments.map(record);
}
function leagueOptions(value: unknown): Array<{ id: string; name: string }> {
  if (
    !value ||
    typeof value !== 'object' ||
    !('leagues' in value) ||
    !Array.isArray(value.leagues)
  )
    throw new Error('No se pudo interpretar la lista de ligas.');
  const found = new Set<string>();
  return value.leagues.map((row) => {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.id !== 'string' ||
      !row.id ||
      typeof row.name !== 'string' ||
      !row.name ||
      found.has(row.id)
    )
      throw new Error(
        'La lista de ligas contiene una identidad inválida o duplicada.',
      );
    found.add(row.id);
    return { id: row.id, name: row.name };
  });
}
const freshId = () => globalThis.crypto.randomUUID();
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="managerField">
      <span>{label}</span>
      {children}
    </label>
  );
}
function LocationFields({
  value,
  onChange,
}: {
  value: TournamentLocation;
  onChange: Dispatch<TournamentLocation>;
}) {
  const states = venezuelaStates.filter((state) => state.municipalities.length);
  return (
    <div className="profileFieldGrid">
      <Field label="Estado">
        <select
          value={value.stateId}
          onChange={(event) => {
            const state = states.find(
              (state) => state.id === event.target.value,
            );
            onChange({
              ...value,
              stateId: state?.id ?? '',
              municipalityId: state?.municipalities[0]?.id ?? '',
            });
          }}
        >
          <option value="">Por definir</option>
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Municipio">
        <select
          value={value.municipalityId}
          onChange={(event) =>
            onChange({ ...value, municipalityId: event.target.value })
          }
        >
          <option value="">Por definir</option>
          {states
            .find((state) => state.id === value.stateId)
            ?.municipalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Dirección">
        <input
          maxLength={1000}
          value={value.address}
          onChange={(event) =>
            onChange({ ...value, address: event.target.value })
          }
        />
      </Field>
      <Field label="Enlace de ubicación">
        <input
          type="url"
          maxLength={2000}
          placeholder="https://maps.google.com/..."
          value={value.mapUrl}
          onChange={(event) =>
            onChange({ ...value, mapUrl: event.target.value })
          }
        />
      </Field>
    </div>
  );
}

export default function TournamentWorkspace({
  publicId,
}: {
  publicId?: string;
}) {
  const { account, session, ready } = usePlatformSession();
  if (publicId) return <PublicTournament id={publicId} />;
  if (!ready) return <p role="status">Preparando tus torneos…</p>;
  if (!account)
    return (
      <section className="managerCard">
        <h1>Crear torneo</h1>
        <p>
          Inicia sesión con tu cuenta para guardar y administrar tus torneos.
        </p>
        <Link href="/account">Ir a mi cuenta</Link>
      </section>
    );
  if (session?.role !== 'organizer')
    return (
      <p role="alert">
        Crear y administrar torneos corresponde al perfil Organizador. Las
        fichas publicadas pueden consultarse desde cualquier rol.
      </p>
    );
  const actorId = officialAccountActor(account, 'organizer');
  if (!actorId)
    return (
      <p role="alert">
        Verifica tu identidad en <Link href="/account">Mi cuenta</Link> antes de
        crear un torneo.
      </p>
    );
  return (
    <OrganizerTournaments
      key={`${account.id}:${actorId}`}
      accountId={account.id}
      actorId={actorId}
    />
  );
}

type Pending = {
  requestId: string;
  expectedAccountId: string;
  expectedRevision: number;
  role: 'organizer';
  actorId: string;
  action: 'save' | 'publish' | 'approve-roster' | 'reject-roster';
  document: TournamentDocument;
  teamId: string;
  reviewNote?: string;
};
const tabs = [
  'Ficha',
  'Equipos y rosters',
  'Fases',
  'Sedes',
  'Calendario',
  'Reglamento',
  'Sanciones',
  'Comunicados',
  'Historial',
] as const;
export function OrganizerTournaments({
  accountId,
  actorId = 'org-demo',
}: {
  accountId: string;
  actorId?: string;
}) {
  const query = new URLSearchParams({ role: 'organizer', actorId }).toString();
  const [list, setList] = useState<TournamentRecord[] | null>(null);
  const [saved, setSaved] = useState<TournamentRecord | null>(null);
  const [draft, setDraft] = useState<TournamentDocument | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Ficha');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending | null>(null),
    [recovering, setRecovering] = useState(true);
  const [roster, setRoster] = useState<{
    teamId: string;
    members: RosterMember[];
  } | null>(null);
  const [history, setHistory] = useState<
    Array<{ revision: number; action: string; at: string }>
  >([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [leagues, setLeagues] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const sending = useRef(false),
    generation = useRef(0);
  const storageKey = `playsport:tournaments:pending:v1:${accountId}`;
  const dirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(saved?.document),
  );
  useNavigationBusy(busy);
  useEffect(() => {
    let active = true;
    void request(`?${query}`)
      .then((body) => {
        if (
          !body ||
          typeof body !== 'object' ||
          !('accountId' in body) ||
          body.accountId !== accountId
        )
          throw new Error('La cuenta cambió. Vuelve a abrir tus torneos.');
        const next = records(body);
        const nextLeagues = leagueOptions(body);
        if (active) {
          setList(next);
          setLeagues(nextLeagues);
        }
      })
      .catch((error) => {
        if (active) setError(failure(error));
      });
    try {
      const raw = globalThis.sessionStorage.getItem(storageKey);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (
          !value ||
          typeof value !== 'object' ||
          !('expectedAccountId' in value) ||
          value.expectedAccountId !== accountId ||
          !('document' in value) ||
          !('requestId' in value) ||
          typeof value.requestId !== 'string' ||
          !('expectedRevision' in value) ||
          typeof value.expectedRevision !== 'number' ||
          !('action' in value) ||
          !['save', 'publish', 'approve-roster', 'reject-roster'].includes(
            String(value.action),
          ) ||
          !('teamId' in value) ||
          typeof value.teamId !== 'string'
        )
          throw new Error(
            'La operación pendiente del torneo no es válida. No se envió.',
          );
        const restored: Pending = {
          requestId: value.requestId,
          expectedAccountId: accountId,
          expectedRevision: value.expectedRevision,
          role: 'organizer',
          actorId,
          action: value.action as Pending['action'],
          document: readTournament(value.document),
          teamId: value.teamId,
        };
        setPending(restored);
        setDraft(restored.document);
        setNotice(
          'Hay una operación pendiente. Reintenta la misma operación para confirmar si se guardó; no se duplicará.',
        );
      }
    } catch (error) {
      setError(failure(error));
    }
    setRecovering(false);
    return () => {
      active = false;
      generation.current++;
    };
  }, [accountId, storageKey, actorId, query]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: globalThis.BeforeUnloadEvent) => {
      event.preventDefault();
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, [dirty, pending]);
  const change = <K extends keyof TournamentDocument>(
    key: K,
    value: TournamentDocument[K],
  ) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice('');
  };
  const open = (value: TournamentRecord | null) => {
    if (pending) {
      setError('Confirma la operación pendiente antes de cambiar de torneo.');
      return;
    }
    if (
      dirty &&
      !globalThis.confirm('Hay cambios sin guardar. ¿Deseas descartarlos?')
    )
      return;
    generation.current++;
    setSaved(value);
    setDraft(
      value
        ? structuredClone(value.document)
        : { ...newTournament(freshId()), branch: 'Masculino' },
    );
    setTab('Ficha');
    setRoster(null);
    setHistory([]);
    setError('');
    setNotice('');
  };
  const execute = async (command: Pending) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    try {
      globalThis.sessionStorage.setItem(storageKey, JSON.stringify(command));
      setPending(command);
      const body = await request('', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (!body || typeof body !== 'object' || !('record' in body))
        throw new Error(
          'No se pudo confirmar el guardado. Reintenta la misma operación.',
        );
      const next = record(body.record);
      if (current !== generation.current) return;
      globalThis.sessionStorage.removeItem(storageKey);
      setPending(null);
      setSaved(next);
      setDraft(structuredClone(next.document));
      setList((values) => [
        next,
        ...(values ?? []).filter(
          (value) => value.document.id !== next.document.id,
        ),
      ]);
      if (next.document.leagueId) {
        const id = next.document.leagueId,
          name = next.document.leagueName;
        setLeagues((values) => [
          ...values.filter((value) => value.id !== id),
          { id, name },
        ]);
      }
      setNotice(
        command.action === 'publish'
          ? 'Torneo publicado. Los cruces de béisbol/sóftbol con equipos y managers asignados se conectan a los partidos oficiales; los demás conservan su planificación pendiente.'
          : command.action === 'approve-roster'
            ? 'Roster aprobado en su versión actual. Cualquier incorporación posterior requerirá nueva revisión.'
            : 'Cambios guardados y registrados en el historial.',
      );
      globalThis.dispatchEvent(new Event('playsport:tournaments-changed'));
      globalThis.localStorage.setItem(
        'playsport:tournaments-changed',
        freshId(),
      );
    } catch (error) {
      if (current === generation.current)
        setError(
          `${failure(error)} La operación permanece pendiente: reintenta o recarga los datos guardados.`,
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const save = (
    action: Pending['action'] = 'save',
    teamId = '',
    reviewNote = '',
  ) => {
    if (!draft || busy || pending) return;
    try {
      const document = readTournament(draft);
      void execute({
        requestId: freshId(),
        expectedAccountId: accountId,
        expectedRevision: saved?.revision ?? 0,
        role: 'organizer',
        actorId,
        action,
        document,
        teamId,
        ...(reviewNote ? { reviewNote } : {}),
      });
    } catch (error) {
      setError(failure(error));
    }
  };
  const reload = async () => {
    if (
      (dirty || pending) &&
      !globalThis.confirm(
        'Se descartarán los cambios locales. Una operación ya recibida por el servidor no se deshace. ¿Recargar lo guardado?',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const body = await request(`?${query}`);
      const values = records(body);
      setLeagues(leagueOptions(body));
      const next = values.find((value) => value.document.id === draft?.id);
      globalThis.sessionStorage.removeItem(storageKey);
      setPending(null);
      setList(values);
      if (next) {
        setSaved(next);
        setDraft(structuredClone(next.document));
      } else {
        setSaved(null);
        setDraft(null);
      }
      setNotice('Datos recargados desde el servidor.');
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  };
  const loadRoster = async (teamId: string) => {
    if (
      !saved ||
      (!saved.public &&
        !saved.document.teams.find((team) => team.id === teamId)?.enrollment) ||
      dirty ||
      !draft
    ) {
      setError(
        'Guarda la inscripción antes de revisar su roster. Los registros anteriores requieren publicar el torneo para habilitar sus equipos.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = await request(
        `/${draft.id}/roster?${query}&teamId=${encodeURIComponent(teamId)}`,
      );
      if (
        !body ||
        typeof body !== 'object' ||
        !('members' in body) ||
        !Array.isArray(body.members)
      )
        throw new Error('La respuesta del roster no es válida.');
      const members: RosterMember[] = body.members.map((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('person' in value) ||
          !value.person ||
          !isRosterPerson(value.person) ||
          !('role' in value) ||
          !isRosterRole(value.role)
        )
          throw new Error('El roster contiene una persona inválida.');
        return {
          person: value.person,
          role: value.role,
          approvalStatus: 'approved',
        };
      });
      setRoster({ teamId, members });
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async () => {
    if (!saved) return;
    setBusy(true);
    setError('');
    try {
      const body = await request(`/${saved.document.id}/history?${query}`);
      if (
        !body ||
        typeof body !== 'object' ||
        !('events' in body) ||
        !Array.isArray(body.events)
      )
        throw new Error('El historial no es válido.');
      setHistory(
        body.events.map((value) => {
          if (
            !value ||
            typeof value !== 'object' ||
            !('revision' in value) ||
            typeof value.revision !== 'number' ||
            !('action' in value) ||
            typeof value.action !== 'string' ||
            !('at' in value) ||
            typeof value.at !== 'string'
          )
            throw new Error('El historial contiene un cambio inválido.');
          return {
            revision: value.revision,
            action: value.action,
            at: value.at,
          };
        }),
      );
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  };
  const teamChange = (id: string, patch: Partial<TournamentTeam>) =>
    draft &&
    change(
      'teams',
      draft.teams.map((team) =>
        team.id === id ? { ...team, ...patch } : team,
      ),
    );
  const phaseChange = (id: string, patch: Partial<TournamentPhase>) => {
    if (!draft) return;
    try {
      const phases = draft.phases.map((phase) =>
        phase.id === id ? { ...phase, ...patch } : phase,
      );
      change('phases', phases);
      const updated = phases.find((phase) => phase.id === id);
      if (updated) validateTournamentGroups(updated);
      setError('');
    } catch (error) {
      setError(failure(error));
    }
  };
  const fixtureChange = (id: string, patch: Partial<TournamentFixture>) =>
    draft &&
    change(
      'fixtures',
      draft.fixtures.map((game) =>
        game.id === id ? { ...game, ...patch } : game,
      ),
    );
  const sanctionChange = (id: string, patch: Partial<TournamentSanction>) =>
    draft &&
    change(
      'sanctions',
      draft.sanctions.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    );

  return (
    <section
      className="tournamentWorkspace"
      onClickCapture={(event) => {
        if (
          dirty &&
          event.target instanceof globalThis.Element &&
          event.target.closest('a') &&
          !globalThis.confirm('Hay cambios sin guardar. ¿Salir y descartarlos?')
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <header className="moduleHeader">
        <p className="eyebrow">ORGANIZADOR · PLANIFICACIÓN PROGRESIVA</p>
        <h1>Crear torneo</h1>
        <p>
          Adapta el torneo a tu reglamento. Puedes guardar solo el nombre,
          añadir fases más adelante y programar cada semana.
        </p>
      </header>
      {error ? (
        <p className="managerWarning" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="managerCard" role="status">
          {notice}
        </p>
      ) : null}
      <section className="managerCard tournamentSelector">
        <div className="tournamentSectionHeading">
          <div>
            <h2>Mis ligas y torneos</h2>
            <p>Selecciona un torneo guardado o comienza uno nuevo.</p>
          </div>
          <div className="tournamentActions">
            <button
              className="managerButtonSolid"
              disabled={busy || recovering || !!pending}
              onClick={() => open(null)}
            >
              Crear un torneo nuevo
            </button>
            <button
              className="managerButtonOutline"
              disabled={busy || recovering}
              onClick={() => void reload()}
            >
              Recargar lo guardado
            </button>
          </div>
        </div>
        {!list && !error ? <p role="status">Consultando tus torneos…</p> : null}
        {list?.length === 0 ? <p>Aún no has creado torneos.</p> : null}
        <div className="tournamentList">
          {list?.map((value) => (
            <button
              key={value.document.id}
              className="tournamentListItem"
              aria-pressed={draft?.id === value.document.id}
              disabled={busy || !!pending}
              onClick={() => open(value)}
            >
              <strong>
                {value.document.name || value.document.leagueName}
              </strong>
              <span>
                {value.document.season || 'Sin temporada'} ·{' '}
                {value.public
                  ? tournamentStates[value.document.status]
                  : 'Borrador privado'}
              </span>
            </button>
          ))}
        </div>
        <Link className="tournamentUtilityLink" href="/demo/organizer-center">
          Administrar cupos y cierre del roster
        </Link>
      </section>
      {pending ? (
        <div className="managerCard">
          <p>
            Hay una operación pendiente de confirmación. No cambies sus datos al
            reintentar.
          </p>
          <button
            className="managerButtonSolid"
            disabled={busy}
            onClick={() => void execute(pending)}
          >
            Reintentar la misma operación
          </button>
        </div>
      ) : null}
      {draft ? (
        <div className="tournamentEditor">
          <section className="managerCard tournamentToolbar">
            <div>
              <h2>
                <EditableInstitutionName
                  kind="tournament"
                  id={saved?.document.id}
                  editable={!dirty}
                >
                  {draft.name || draft.leagueName || 'Nuevo torneo'}
                </EditableInstitutionName>
              </h2>
              <p>
                {saved ? `Revisión ${saved.revision}` : 'Todavía no guardado'} ·{' '}
                {saved?.public ? 'Publicado' : 'Borrador privado'}
                {dirty ? ' · Cambios sin guardar' : ''}
              </p>
            </div>
            <div className="tournamentActions">
              <button
                className="managerButtonSolid"
                disabled={busy || !!pending}
                onClick={() => save()}
              >
                Guardar {saved?.public ? 'cambios' : 'borrador'}
              </button>
              {!saved?.public ? (
                <button
                  className="managerButtonOutline"
                  disabled={busy || !!pending}
                  onClick={() => {
                    if (
                      globalThis.confirm(
                        'La ficha, el reglamento y los comunicados públicos serán visibles para los demás usuarios. ¿Publicar?',
                      )
                    )
                      save('publish');
                  }}
                >
                  Publicar torneo
                </button>
              ) : (
                <Link
                  className="managerButtonOutline"
                  href={`/demo/tournaments?tournament=${draft.id}`}
                >
                  Ver ficha pública
                </Link>
              )}
            </div>
          </section>
          <OrganizerCapacityPanel key={accountId} accountId={accountId} document={draft} saved={Boolean(saved)} dirty={dirty} />
          <div className="tournamentEditorBody">
            <nav className="tournamentTabs" aria-label="Secciones del torneo">
              {tabs.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="managerButtonOutline"
                  aria-current={tab === name ? 'page' : undefined}
                  onClick={() => {
                    setTab(name);
                    if (name === 'Historial') void loadHistory();
                  }}
                >
                  {name}
                </button>
              ))}
            </nav>
            <fieldset className="tournamentFields" disabled={busy || !!pending}>
              {tab === 'Ficha' ? (
                <section className="managerCard">
                  <h2>Ficha de la liga y torneo</h2>
                  {saved?.document.leagueId ? (
                    <h3>
                      <EditableInstitutionName
                        kind="league"
                        id={saved.document.leagueId}
                      >
                        {saved.document.leagueName}
                      </EditableInstitutionName>
                    </h3>
                  ) : null}
                  <p className="rosterHelp">
                    Guarda el torneo y su liga para colocar sus logos tocando el
                    recuadro de cada imagen.
                  </p>
                  <div className="profileFieldGrid tournamentSheetFields">
                    <Field label="Liga existente (opcional)">
                      <select
                        value={draft.leagueId ?? ''}
                        onChange={(event) => {
                          const league = leagues.find(
                            (value) => value.id === event.target.value,
                          );
                          setDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  leagueId: league?.id,
                                  leagueName: league?.name ?? '',
                                }
                              : current,
                          );
                          setNotice('');
                        }}
                      >
                        <option value="">Crear liga nueva / sin liga</option>
                        {draft.leagueId &&
                        !leagues.some(
                          (value) => value.id === draft.leagueId,
                        ) ? (
                          <option value={draft.leagueId}>
                            {draft.leagueName}
                          </option>
                        ) : null}
                        {leagues.map((league) => (
                          <option key={league.id} value={league.id}>
                            {league.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(
                      [
                        ['name', 'Nombre del torneo'],
                        ['leagueName', 'Nombre de la liga'],
                        ['season', 'Temporada / edición'],
                        ['sport', 'Deporte'],
                        ['modality', 'Modalidad deportiva (opcional)'],
                        ['category', 'Categoría'],
                        ['branch', 'Sexo'],
                      ] as const
                    ).map(([key, label]) => (
                      <Field label={label} key={key}>
                        {key === 'sport' ? (
                          <>
                            <select
                              required
                              value={
                                supportsOfficialTournamentScoring(draft.sport)
                                  ? draft.sport
                                      .trim()
                                      .toLowerCase()
                                      .startsWith('s')
                                    ? 'softball'
                                    : 'baseball'
                                  : ''
                              }
                              onChange={(event) => {
                                const sport = event.target.value;
                                setDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        sport,
                                        modality:
                                          isSoftballSport(current.sport) ===
                                          isSoftballSport(sport)
                                            ? current.modality
                                            : '',
                                      }
                                    : current,
                                );
                                setNotice('');
                              }}
                            >
                              {!supportsOfficialTournamentScoring(
                                draft.sport,
                              ) ? (
                                <option value="" disabled>
                                  Selecciona un deporte
                                </option>
                              ) : null}
                              <option value="baseball">Béisbol</option>
                              <option value="softball">Sóftbol</option>
                            </select>
                            {!supportsOfficialTournamentScoring(draft.sport) ? (
                              <p role="alert">
                                El deporte guardado no está disponible.
                                Selecciona béisbol o sóftbol.
                              </p>
                            ) : null}
                          </>
                        ) : key === 'modality' &&
                          isSoftballSport(draft.sport) ? (
                          <>
                            <select
                              value={draft.modality}
                              onChange={(event) =>
                                change('modality', event.target.value)
                              }
                            >
                              <option value="">Selecciona una modalidad</option>
                              {softballModalities.map((modality) => (
                                <option key={modality} value={modality}>
                                  {modality}
                                </option>
                              ))}
                              {draft.modality &&
                              !softballModalities.some(
                                (modality) => modality === draft.modality,
                              ) ? (
                                <option value={draft.modality}>
                                  {draft.modality} (guardada)
                                </option>
                              ) : null}
                            </select>
                            {draft.modality &&
                            !softballModalities.some(
                              (modality) => modality === draft.modality,
                            ) ? (
                              <p>
                                Se conserva la modalidad guardada. Puedes elegir
                                Lento, Rápido o Modificado para actualizarla.
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <input
                            maxLength={200}
                            value={draft[key]}
                            readOnly={key === 'leagueName' && !!draft.leagueId}
                            onChange={(event) =>
                              change(key, event.target.value)
                            }
                          />
                        )}
                      </Field>
                    ))}
                    <Field label="Estado del torneo">
                      <select
                        value={draft.status}
                        onChange={(event) =>
                          change(
                            'status',
                            event.target.value as TournamentDocument['status'],
                          )
                        }
                      >
                        {Object.entries(tournamentStates)
                          .filter(([key]) => !saved?.public || key !== 'draft')
                          .map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Inicio estimado (opcional)">
                      <input
                        type="date"
                        value={draft.startsOn}
                        onChange={(event) =>
                          change('startsOn', event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Cierre estimado (opcional)">
                      <input
                        type="date"
                        value={draft.endsOn}
                        onChange={(event) =>
                          change('endsOn', event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Cupo de equipos (vacío: por definir)">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={draft.teamLimit ?? ''}
                        onChange={(event) =>
                          change(
                            'teamLimit',
                            event.target.value
                              ? Number(event.target.value)
                              : null,
                          )
                        }
                      />
                    </Field>
                    <Field label="Cierre de inscripciones (opcional)">
                      <input
                        type="date"
                        value={draft.registrationDeadline}
                        onChange={(event) =>
                          change('registrationDeadline', event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Inscripción en créditos">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="0"
                        value={draft.feeCents === 0 ? '' : draft.feeCents / 100}
                        onChange={(event) =>
                          change(
                            'feeCents',
                            Math.round(Number(event.target.value) * 100),
                          )
                        }
                      />
                    </Field>
                  </div>
                  <p>
                    Si dejas la inscripción vacía, es gratuita (0 créditos).
                  </p>
                  <p>
                    No se realiza ningún cobro automático. La billetera sigue
                    siendo única; los bloqueos se deciden expresamente por
                    equipo.
                  </p>
                  <p>
                    La planificación admite deportes personalizados. La conexión
                    a la anotación oficial actual está disponible para béisbol y
                    sóftbol; otros deportes no se presentan como compatibles con
                    ese motor.
                  </p>
                  <Field label="Descripción pública">
                    <textarea
                      maxLength={5000}
                      value={draft.description}
                      onChange={(event) =>
                        change('description', event.target.value)
                      }
                    />
                  </Field>
                  <h3>Ubicación de referencia</h3>
                  <LocationFields
                    value={draft.location}
                    onChange={(value) => change('location', value)}
                  />
                  <Field label="Contacto oficial que deseas publicar (opcional)">
                    <input
                      maxLength={500}
                      value={draft.contact}
                      onChange={(event) =>
                        change('contact', event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Redes sociales / web (un enlace completo por línea)">
                    <textarea
                      value={draft.socialLinks.join('\n')}
                      onChange={(event) =>
                        change('socialLinks', event.target.value.split('\n'))
                      }
                    />
                  </Field>
                </section>
              ) : null}
              {tab === 'Equipos y rosters' ? (
                <section className="managerCard">
                  <h2>Equipos, inscripciones y rosters</h2>
                  <p>
                    El manager prepara el roster desde su módulo ROSTER. Aquí
                    revisas y apruebas esa versión; el lineup de cada partido
                    sigue siendo independiente.
                  </p>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('teams', [
                        ...draft.teams,
                        {
                          id: `inscription:${draft.id}:${freshId()}`,
                          name: 'Inscripción pendiente',
                          managerId: '',
                          managerIdentification: '',
                          status: 'pending',
                          rosterStatus: 'pending',
                          rosterSignature: '',
                          blocked: false,
                          blockReason: '',
                          blockScopes: [],
                          withdrawalReason: '',
                          enrollment: {
                            status: 'invited',
                            contact: '',
                            notes: '',
                            submittedAt: '',
                            reviewNotes: '',
                          },
                        },
                      ])
                    }
                  >
                    Asignar inscripción a un manager
                  </button>
                  <p>
                    Cada inscripción pertenece solo a este torneo. Indica la
                    cédula del manager: aparecerá en su cuenta cuando su
                    identidad global esté verificada. Él prepara el nombre, logo
                    y roster; no se reutilizan equipos por coincidencia de
                    nombre o jugadores.
                  </p>
                  {draft.teams.map((team) => (
                    <article className="tournamentSubcard" key={team.id}>
                      <h3>
                        <EditableInstitutionName
                          id={team.id}
                          editable={!team.enrollment}
                        >
                          {team.name}
                        </EditableInstitutionName>
                      </h3>
                      <div className="profileFieldGrid">
                        {team.enrollment ? (
                          <>
                            <Field label="Cédula privada del manager">
                              <input
                                maxLength={14}
                                placeholder="V-12345678"
                                value={team.managerIdentification}
                                readOnly={
                                  !!saved?.document.teams.some(
                                    (row) => row.id === team.id,
                                  )
                                }
                                onChange={(event) =>
                                  teamChange(team.id, {
                                    managerIdentification: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <p>
                              Nombre y detalles: los completa el manager desde
                              Mis inscripciones.
                            </p>
                            <p>
                              Envío:{' '}
                              {team.enrollment.status === 'submitted'
                                ? 'Enviado a revisión'
                                : team.enrollment.status === 'changes-requested'
                                  ? 'Correcciones solicitadas'
                                  : team.enrollment.status === 'draft'
                                    ? 'En preparación por el manager'
                                    : 'Pendiente del manager y su identidad verificada'}
                            </p>
                            {team.enrollment.contact ? (
                              <p>
                                Contacto del equipo: {team.enrollment.contact}
                              </p>
                            ) : null}
                            {team.enrollment.notes ? (
                              <p>
                                Detalles del manager: {team.enrollment.notes}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <Field label="Nombre del equipo (registro anterior)">
                              <input
                                maxLength={200}
                                value={team.name}
                                onChange={(event) =>
                                  teamChange(team.id, {
                                    name: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Cuenta deportiva del manager">
                              <input
                                maxLength={160}
                                placeholder="mgr-A / mgr-B / ID vinculado"
                                value={team.managerId}
                                onChange={(event) =>
                                  teamChange(team.id, {
                                    managerId: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="Identificación del manager (si aún no está vinculada)">
                              <input
                                maxLength={100}
                                value={team.managerIdentification}
                                onChange={(event) =>
                                  teamChange(team.id, {
                                    managerIdentification: event.target.value,
                                  })
                                }
                              />
                            </Field>
                          </>
                        )}
                        <Field label="Inscripción del equipo">
                          <select
                            value={team.status}
                            onChange={(event) =>
                              teamChange(team.id, {
                                status: event.target
                                  .value as TournamentTeam['status'],
                              })
                            }
                          >
                            <option value="pending">Pendiente</option>
                            <option value="accepted">Aceptado</option>
                            <option value="withdrawn">
                              Retirado (conserva historial)
                            </option>
                          </select>
                        </Field>
                      </div>
                      {team.status === 'withdrawn' ? (
                        <Field label="Motivo del retiro y tratamiento acordado para partidos pendientes">
                          <textarea
                            value={team.withdrawalReason}
                            onChange={(event) =>
                              teamChange(team.id, {
                                withdrawalReason: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <label>
                        <input
                          type="checkbox"
                          checked={team.blocked}
                          onChange={(event) =>
                            teamChange(team.id, {
                              blocked: event.target.checked,
                            })
                          }
                        />{' '}
                        Bloquear por impago u otra condición administrativa
                      </label>
                      {team.blocked ? (
                        <>
                          <Field label="Motivo privado del bloqueo">
                            <textarea
                              value={team.blockReason}
                              onChange={(event) =>
                                teamChange(team.id, {
                                  blockReason: event.target.value,
                                })
                              }
                            />
                          </Field>
                          <div className="managerButtonRow">
                            {(
                              [
                                ['registration', 'Incorporaciones al roster'],
                                ['lineup', 'Entrega de alineaciones'],
                                ['participation', 'Participación en juegos'],
                              ] as const
                            ).map(([scope, label]) => (
                              <label key={scope}>
                                <input
                                  type="checkbox"
                                  checked={team.blockScopes.includes(scope)}
                                  onChange={(event) =>
                                    teamChange(team.id, {
                                      blockScopes: event.target.checked
                                        ? [...team.blockScopes, scope]
                                        : team.blockScopes.filter(
                                            (value) => value !== scope,
                                          ),
                                    })
                                  }
                                />{' '}
                                {label}
                              </label>
                            ))}
                          </div>
                        </>
                      ) : null}
                      <p>
                        Roster:{' '}
                        {team.rosterStatus === 'approved'
                          ? 'Versión aprobada; se comprueba de nuevo al entregar el lineup'
                          : team.rosterStatus === 'rejected'
                            ? 'Rechazado · requiere corrección'
                            : 'Pendiente de revisión'}
                      </p>
                      {team.enrollment ? (
                        <Field label="Correcciones que debe realizar el manager">
                          <textarea
                            maxLength={1000}
                            value={reviewNotes[team.id] || ''}
                            onChange={(event) =>
                              setReviewNotes((current) => ({
                                ...current,
                                [team.id]: event.target.value,
                              }))
                            }
                          />
                        </Field>
                      ) : null}
                      <div className="managerButtonRow">
                        <button
                          className="managerButtonOutline"
                          onClick={() => void loadRoster(team.id)}
                        >
                          Consultar roster actual
                        </button>
                        <button
                          className="managerButtonOutline"
                          disabled={
                            !saved ||
                            dirty ||
                            (!!team.enrollment &&
                              team.enrollment.status !== 'submitted')
                          }
                          onClick={() => save('approve-roster', team.id)}
                        >
                          Aprobar roster actual
                        </button>
                        <button
                          className="managerButtonOutline"
                          disabled={
                            !saved ||
                            dirty ||
                            (!!team.enrollment &&
                              (team.enrollment.status !== 'submitted' ||
                                !reviewNotes[team.id]?.trim()))
                          }
                          onClick={() =>
                            save(
                              'reject-roster',
                              team.id,
                              reviewNotes[team.id]?.trim(),
                            )
                          }
                        >
                          Devolver para corregir
                        </button>
                      </div>
                      {roster?.teamId === team.id ? (
                        <ul>
                          {roster.members.length ? (
                            roster.members.map((member) => (
                              <li key={`${member.person.id}:${member.role}`}>
                                {member.person.fullName} ·{' '}
                                {rosterRoleLabels[member.role]} ·{' '}
                                {member.person.id}
                              </li>
                            ))
                          ) : (
                            <li>
                              El manager todavía no ha incorporado personas al
                              roster.
                            </li>
                          )}
                        </ul>
                      ) : null}
                      {!saved?.document.teams.some(
                        (row) => row.id === team.id,
                      ) &&
                      !draft.phases.some(
                        (phase) =>
                          phase.teamIds.includes(team.id) ||
                          phase.groups.some((group) =>
                            group.teamIds.includes(team.id),
                          ),
                      ) &&
                      !draft.fixtures.some((game) =>
                        [game.homeTeamId, game.awayTeamId].includes(team.id),
                      ) &&
                      !draft.sanctions.some(
                        (sanction) =>
                          sanction.target === 'team' &&
                          sanction.targetId === team.id,
                      ) ? (
                        <button
                          className="managerButtonOutline"
                          onClick={() =>
                            change(
                              'teams',
                              draft.teams.filter((row) => row.id !== team.id),
                            )
                          }
                        >
                          Descartar equipo sin guardar
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Fases' ? (
                <section className="managerCard">
                  <h2>Fases y modalidades</h2>
                  <p>
                    No necesitas crear una segunda fase ahora. Añádela cuando
                    corresponda, incluso con la primera en curso.
                  </p>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('phases', [
                        ...draft.phases,
                        {
                          id: freshId(),
                          name: `Fase ${draft.phases.length + 1}`,
                          kind: 'round-robin',
                          status: 'draft',
                          sourcePhaseId: '',
                          teamIds: [],
                          groups: [],
                          teamLimit: null,
                          turns: 1,
                          bestOf: 1,
                          qualifiers: null,
                          pairing: 'seeded',
                          rules: '',
                        },
                      ])
                    }
                  >
                    Agregar fase
                  </button>
                  {draft.phases.map((phase) => (
                    <article className="tournamentSubcard" key={phase.id}>
                      <div className="tournamentPhaseHeading">
                        <div>
                          <h3>{phase.name}</h3>
                          <p>
                            Todos los grupos comparten el formato, las vueltas y
                            las reglas de esta fase.
                          </p>
                        </div>
                        <Field label="Cantidad de grupos">
                          <select
                            value={Math.max(1, phase.groups.length)}
                            onChange={(event) => {
                              const count = Number(event.target.value);
                              if (
                                count < Math.max(1, phase.groups.length) &&
                                !globalThis.confirm(
                                  'Al reducir los grupos se conservan todos los equipos de la fase. Los grupos retirados pierden sus cupos y clasificados, y sus equipos quedarán pendientes de asignación. Con un grupo todos juegan juntos y debes definir su cupo. ¿Continuar?',
                                )
                              )
                                return;
                              try {
                                phaseChange(phase.id, {
                                  groups: resizeTournamentGroups(
                                    phase,
                                    count,
                                    freshId,
                                  ),
                                  ...(count === 1 ? { teamLimit: null } : {}),
                                });
                              } catch (error) {
                                setError(failure(error));
                              }
                            }}
                          >
                            {Array.from(
                              { length: 8 },
                              (_, index) => index + 1,
                            ).map((count) => (
                              <option key={count} value={count}>
                                {count}
                              </option>
                            ))}
                            {phase.groups.length > 8 ? (
                              <option value={phase.groups.length}>
                                {phase.groups.length} (actual)
                              </option>
                            ) : null}
                          </select>
                        </Field>
                      </div>
                      <div className="profileFieldGrid">
                        <Field label="Nombre de la fase">
                          <input
                            value={phase.name}
                            onChange={(event) =>
                              phaseChange(phase.id, {
                                name: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Finalidad de la fase">
                          <select value={phase.purpose ?? 'regular'} onChange={event => phaseChange(phase.id, {
                            purpose: event.target.value === 'tie-breaker' ? 'tie-breaker' : 'regular',
                          })}>
                            <option value="regular">Partidos ordinarios</option>
                            <option value="tie-breaker">Desempate de clasificación incluido</option>
                          </select>
                        </Field>
                        {phase.purpose === 'tie-breaker' ? <Field label="Justificación del empate de clasificación">
                          <textarea value={phase.tieBreakReason ?? ''} maxLength={1000}
                            onChange={event => phaseChange(phase.id, { tieBreakReason: event.target.value })} />
                        </Field> : null}
                        <Field label="Formato">
                          <select
                            value={phase.kind}
                            onChange={(event) =>
                              phaseChange(phase.id, {
                                kind: event.target
                                  .value as TournamentPhase['kind'],
                                maxGames: null,
                                ...(!tournamentPhaseUsesSeries(
                                  event.target.value as TournamentPhase['kind'],
                                )
                                  ? { bestOf: 1 }
                                  : {}),
                              })
                            }
                          >
                            {Object.entries(tournamentPhaseKinds).map(
                              ([key, label]) => (
                                <option key={key} value={key}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                        <Field label="Fase de origen (opcional)">
                          <select
                            value={phase.sourcePhaseId}
                            onChange={(event) =>
                              phaseChange(phase.id, {
                                sourcePhaseId: event.target.value,
                              })
                            }
                          >
                            <option value="">
                              Primera fase / independiente
                            </option>
                            {draft.phases
                              .filter((row) => row.id !== phase.id)
                              .map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.name}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field label="Estado de la fase">
                          <select
                            value={phase.status}
                            onChange={(event) =>
                              phaseChange(phase.id, {
                                status: event.target
                                  .value as TournamentPhase['status'],
                              })
                            }
                          >
                            <option value="draft">Por comenzar</option>
                            <option value="running">En curso</option>
                            <option value="finished">Finalizada</option>
                          </select>
                        </Field>
                        {phase.kind === 'round-robin' || phase.kind === 'swiss' ? (
                          <Field label={phase.kind === 'swiss' ? 'Rondas del sistema suizo' : 'Vueltas por grupo'}>
                            <input
                              type="number"
                              min={1}
                              value={phase.turns}
                              onChange={(event) =>
                                phaseChange(phase.id, {
                                  turns: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        {['double-elimination', 'repechage', 'custom'].includes(phase.kind) || phase.kind === 'knockout' && phase.pairing === 'manual' ? (
                          <Field label="Máximo de partidos de esta fase manual (incluye juegos decisivos)">
                            <input type="number" min={1} step={1} value={phase.maxGames ?? ''} placeholder="Define el presupuesto de juegos"
                              onChange={event => phaseChange(phase.id, { maxGames: event.target.value ? Number(event.target.value) : null })} />
                          </Field>
                        ) : null}
                        {tournamentPhaseUsesSeries(phase.kind) ? (
                          <Field label="Serie al mejor de (1 = partido único)">
                            <input
                              type="number"
                              min={1}
                              step={2}
                              value={phase.bestOf}
                              onChange={(event) =>
                                phaseChange(phase.id, {
                                  bestOf: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        {!phase.groups.length ? (
                          <Field label="Equipos del grupo único">
                            <input
                              type="number"
                              min={2}
                              step={1}
                              value={phase.teamLimit ?? ''}
                              placeholder="Indica el cupo"
                              onChange={(event) =>
                                phaseChange(phase.id, {
                                  teamLimit: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        {!phase.groups.length ? (
                          <Field label="Clasificados del grupo único (opcional)">
                            <input
                              type="number"
                              min={1}
                              value={phase.qualifiers ?? ''}
                              onChange={(event) =>
                                phaseChange(phase.id, {
                                  qualifiers: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        <Field label="Emparejamiento">
                          <select
                            value={phase.pairing}
                            onChange={(event) =>
                              phaseChange(phase.id, {
                                pairing: event.target
                                  .value as TournamentPhase['pairing'],
                              })
                            }
                          >
                            <option value="seeded">
                              Por orden de clasificación: primero contra último
                            </option>
                            <option value="draw">Sorteo aleatorio</option>
                            <option value="manual">
                              Cruces elegidos manualmente
                            </option>
                          </select>
                        </Field>
                      </div>
                      {phase.kind === 'round-robin' ? (
                        <p>
                          Los partidos se definen por las vueltas y los grupos;
                          no se aplica una serie al mejor de.
                        </p>
                      ) : null}
                      {phase.groups.length && phase.qualifiers !== null ? (
                        <p>
                          Clasificados totales guardados anteriormente:{' '}
                          {phase.qualifiers}. Configura los clasificados de cada
                          grupo; no se reparten automáticamente.
                        </p>
                      ) : null}
                      <h3>
                        Participantes (el orden de selección define la siembra)
                      </h3>
                      <p>
                        Seleccionados: {phase.teamIds.length}
                        {!phase.groups.length
                          ? ` de ${phase.teamLimit ?? 'cupo por definir'}`
                          : ''}
                        .
                        {!phase.groups.length &&
                        phase.teamLimit != null &&
                        phase.teamIds.length < phase.teamLimit
                          ? ` Faltan ${phase.teamLimit - phase.teamIds.length} equipos.`
                          : ''}
                      </p>
                      <div className="tournamentChecks">
                        {draft.teams.map((team) => (
                          <label key={team.id}>
                            <input
                              type="checkbox"
                              checked={phase.teamIds.includes(team.id)}
                              disabled={
                                !phase.groups.length &&
                                phase.teamLimit != null &&
                                phase.teamIds.length >= phase.teamLimit &&
                                !phase.teamIds.includes(team.id)
                              }
                              onChange={(event) =>
                                phaseChange(phase.id, {
                                  teamIds: event.target.checked
                                    ? [...phase.teamIds, team.id]
                                    : phase.teamIds.filter(
                                        (id) => id !== team.id,
                                      ),
                                  groups: phase.groups.map((group) => ({
                                    ...group,
                                    teamIds: group.teamIds.filter(
                                      (id) => id !== team.id,
                                    ),
                                  })),
                                })
                              }
                            />
                            {phase.teamIds.includes(team.id)
                              ? `${phase.teamIds.indexOf(team.id) + 1}. `
                              : ''}
                            {team.name}
                          </label>
                        ))}
                      </div>
                      <h3>Distribución de equipos</h3>
                      {!phase.groups.length ? (
                        <p>
                          Grupo único: todos los participantes de la fase juegan
                          juntos, con las mismas reglas.
                        </p>
                      ) : (
                        <p>
                          Asigna los participantes a sus grupos. Cada equipo
                          solo puede estar en uno.
                        </p>
                      )}
                      {phase.groups.length > 0 &&
                      phase.teamIds.some(
                        (id) =>
                          !phase.groups.some((group) =>
                            group.teamIds.includes(id),
                          ),
                      ) ? (
                        <p className="managerWarning" role="status">
                          Hay participantes sin grupo. Completa su asignación
                          antes de generar los cruces.
                        </p>
                      ) : null}
                      <div className="tournamentGroupGrid">
                        {phase.groups.map((group) => (
                          <div className="tournamentSubcard" key={group.id}>
                            <Field label="Nombre del grupo">
                              <input
                                value={group.name}
                                onChange={(event) =>
                                  phaseChange(phase.id, {
                                    groups: phase.groups.map((row) =>
                                      row.id === group.id
                                        ? { ...row, name: event.target.value }
                                        : row,
                                    ),
                                  })
                                }
                              />
                            </Field>
                            <Field
                              label={`Equipos que participarán en ${group.name}`}
                            >
                              <input
                                type="number"
                                min={2}
                                step={1}
                                placeholder="Indica el cupo"
                                value={group.teamLimit ?? ''}
                                onChange={(event) =>
                                  phaseChange(phase.id, {
                                    groups: phase.groups.map((row) =>
                                      row.id === group.id
                                        ? {
                                            ...row,
                                            teamLimit: event.target.value
                                              ? Number(event.target.value)
                                              : null,
                                          }
                                        : row,
                                    ),
                                  })
                                }
                              />
                            </Field>
                            <Field
                              label={`Clasificados de ${group.name} (opcional)`}
                            >
                              <input
                                type="number"
                                min={1}
                                step={1}
                                max={group.teamLimit ?? undefined}
                                value={group.qualifiers ?? ''}
                                onChange={(event) =>
                                  phaseChange(phase.id, {
                                    groups: phase.groups.map((row) =>
                                      row.id === group.id
                                        ? {
                                            ...row,
                                            qualifiers: event.target.value
                                              ? Number(event.target.value)
                                              : null,
                                          }
                                        : row,
                                    ),
                                  })
                                }
                              />
                            </Field>
                            <p>
                              Asignados: {group.teamIds.length} de{' '}
                              {group.teamLimit ?? 'cupo por definir'}.
                              {group.teamLimit != null &&
                              group.teamIds.length < group.teamLimit
                                ? ` Faltan ${group.teamLimit - group.teamIds.length} equipos.`
                                : ''}
                            </p>
                            <div className="tournamentChecks">
                              {phase.teamIds.map((id) => (
                                <label key={id}>
                                  <input
                                    type="checkbox"
                                    checked={group.teamIds.includes(id)}
                                    disabled={
                                      group.teamLimit != null &&
                                      group.teamIds.length >= group.teamLimit &&
                                      !group.teamIds.includes(id)
                                    }
                                    onChange={(event) =>
                                      phaseChange(phase.id, {
                                        groups: phase.groups.map((row) => ({
                                          ...row,
                                          teamIds:
                                            row.id === group.id &&
                                            event.target.checked
                                              ? [
                                                  ...row.teamIds.filter(
                                                    (team) => team !== id,
                                                  ),
                                                  id,
                                                ]
                                              : row.teamIds.filter(
                                                  (team) => team !== id,
                                                ),
                                        })),
                                      })
                                    }
                                  />
                                  {
                                    draft.teams.find((team) => team.id === id)
                                      ?.name
                                  }
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <Field label="Reglas comunes de la fase (todos los grupos)">
                        <textarea
                          value={phase.rules}
                          onChange={(event) =>
                            phaseChange(phase.id, { rules: event.target.value })
                          }
                        />
                      </Field>
                      <p>
                        El reglamento del torneo y estas reglas se aplican por
                        igual a todos los grupos.
                      </p>
                      {phase.kind !== 'round-robin' &&
                      phase.groups.length > 1 ? (
                        <p>
                          En este formato, configura los cruces de cada grupo
                          manualmente desde Calendario. La generación automática
                          por grupos corresponde a todos contra todos.
                        </p>
                      ) : null}
                      <p>
                        Se generan automáticamente las vueltas de todos contra
                        todos y la ronda de eliminación directa. Doble
                        eliminación, suizo, repechajes y otras variantes se
                        arman por ronda con cruces personalizados. No se deciden
                        clasificados ni ganadores sin resultados oficiales y
                        confirmación.
                      </p>
                      <button
                        className="managerButtonSolid"
                        onClick={() => {
                          try {
                            if (
                              phase.kind !== 'round-robin' &&
                              phase.groups.length > 1
                            )
                              throw new Error(
                                'Configura los cruces de estos grupos manualmente desde Calendario; no se mezclaron los equipos de los grupos.',
                              );
                            const valid = readTournament(draft);
                            change('fixtures', [
                              ...draft.fixtures,
                              ...generateTournamentFixtures(
                                valid,
                                phase.id,
                                freshId,
                              ),
                            ]);
                            setNotice(
                              'Cruces preparados sin fecha ni hora. Revisa Calendario y guarda los cambios.',
                            );
                          } catch (error) {
                            setError(failure(error));
                          }
                        }}
                      >
                        Generar cruces sugeridos
                      </button>
                      {!draft.fixtures.some(
                        (game) => game.phaseId === phase.id,
                      ) &&
                      !draft.phases.some(
                        (row) => row.sourcePhaseId === phase.id,
                      ) &&
                      !draft.sanctions.some(
                        (sanction) => sanction.phaseId === phase.id,
                      ) ? (
                        <button
                          className="managerButtonOutline"
                          onClick={() =>
                            change(
                              'phases',
                              draft.phases.filter((row) => row.id !== phase.id),
                            )
                          }
                        >
                          Quitar fase sin cruces
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Sedes' ? (
                <section className="managerCard">
                  <h2>Sedes y estadios</h2>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('venues', [
                        ...draft.venues,
                        {
                          id: freshId(),
                          name: `Sede ${draft.venues.length + 1}`,
                          ...draft.location,
                        },
                      ])
                    }
                  >
                    Agregar sede
                  </button>
                  {draft.venues.map((venue) => (
                    <article className="tournamentSubcard" key={venue.id}>
                      <Field label="Nombre del estadio / sede">
                        <input
                          value={venue.name}
                          onChange={(event) =>
                            change(
                              'venues',
                              draft.venues.map((row) =>
                                row.id === venue.id
                                  ? { ...row, name: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <LocationFields
                        value={venue}
                        onChange={(value) =>
                          change(
                            'venues',
                            draft.venues.map((row) =>
                              row.id === venue.id ? { ...row, ...value } : row,
                            ),
                          )
                        }
                      />
                      {!draft.fixtures.some(
                        (game) => game.venueId === venue.id,
                      ) ? (
                        <button
                          className="managerButtonOutline"
                          onClick={() =>
                            change(
                              'venues',
                              draft.venues.filter((row) => row.id !== venue.id),
                            )
                          }
                        >
                          Quitar sede sin partidos
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Calendario' ? (
                <section className="managerCard">
                  <h2>Calendario y programación semanal</h2>
                  <p>
                    Hora de Venezuela (UTC−4). Fechas, horas y sedes son
                    opcionales hasta programar cada jornada. Se comprueban
                    superposiciones por duración, equipo, sede y anotador.
                  </p>
                  <button
                    className="managerButtonOutline"
                    disabled={!draft.phases.length}
                    onClick={() =>
                      change('fixtures', [
                        ...draft.fixtures,
                        newTournamentFixture(freshId(), draft.phases[0].id),
                      ])
                    }
                  >
                    Agregar cruce personalizado
                  </button>
                  {!draft.phases.length ? (
                    <p>
                      Crea primero una fase; no necesitas definir las
                      siguientes.
                    </p>
                  ) : null}
                  {draft.fixtures.map((game, index) => (
                    <article className="tournamentSubcard" key={game.id}>
                      <h3>Partido {index + 1}</h3>
                      <div className="profileFieldGrid">
                        <Field label="Fase">
                          <select
                            value={game.phaseId}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                phaseId: event.target.value,
                                homeTeamId: '',
                                awayTeamId: '',
                              })
                            }
                          >
                            {draft.phases.map((phase) => (
                              <option key={phase.id} value={phase.id}>
                                {phase.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Jornada / ronda">
                          <input
                            type="number"
                            min={1}
                            value={game.round}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                round: Number(event.target.value),
                              })
                            }
                          />
                        </Field>
                        {(['home', 'away'] as const).map((side) => (
                          <Field
                            label={
                              side === 'home'
                                ? 'Equipo local'
                                : 'Equipo visitante'
                            }
                            key={side}
                          >
                            <select
                              value={game[`${side}TeamId`]}
                              onChange={(event) =>
                                fixtureChange(game.id, {
                                  [`${side}TeamId`]: event.target.value,
                                })
                              }
                            >
                              <option value="">
                                Plaza pendiente de clasificación
                              </option>
                              {draft.phases
                                .find((phase) => phase.id === game.phaseId)
                                ?.teamIds.map((id) => (
                                  <option value={id} key={id}>
                                    {
                                      draft.teams.find((team) => team.id === id)
                                        ?.name
                                    }
                                  </option>
                                ))}
                            </select>
                          </Field>
                        ))}
                        {!game.homeTeamId ? (
                          <Field label="Origen de la plaza local">
                            <input
                              placeholder="1.º del Grupo A / Ganador semifinal 1"
                              value={game.homeSource}
                              onChange={(event) =>
                                fixtureChange(game.id, {
                                  homeSource: event.target.value,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        {!game.awayTeamId ? (
                          <Field label="Origen de la plaza visitante">
                            <input
                              placeholder="2.º del Grupo B / Ganador semifinal 2"
                              value={game.awaySource}
                              onChange={(event) =>
                                fixtureChange(game.id, {
                                  awaySource: event.target.value,
                                })
                              }
                            />
                          </Field>
                        ) : null}
                        <Field label="Fecha (puede quedar pendiente)">
                          <input
                            type="date"
                            value={game.date}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                date: event.target.value,
                                ...(!event.target.value ? { time: '' } : {}),
                              })
                            }
                          />
                        </Field>
                        <Field label="Hora">
                          <input
                            type="time"
                            value={game.time}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                time: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Sede">
                          <select
                            value={game.venueId}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                venueId: event.target.value,
                              })
                            }
                          >
                            <option value="">Por definir</option>
                            {draft.venues.map((venue) => (
                              <option key={venue.id} value={venue.id}>
                                {venue.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Duración y reserva de cancha (minutos)">
                          <input
                            type="number"
                            min={1}
                            value={game.durationMinutes}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                durationMinutes: Number(event.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Serie / llave">
                          <input
                            value={game.series}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                series: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field
                          label={
                            actorId === 'org-demo'
                              ? 'Cuentas de anotadores autorizados (separadas por coma)'
                              : 'Cédulas verificadas de anotadores (separadas por coma)'
                          }
                        >
                          <input
                            placeholder={
                              actorId === 'org-demo'
                                ? 'scorer-demo'
                                : 'V-12345678, V-23456789'
                            }
                            value={game.scorekeeperIds.join(', ')}
                            onChange={(event) =>
                              fixtureChange(game.id, {
                                scorekeeperIds: event.target.value
                                  .split(',')
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                          {actorId !== 'org-demo' ? (
                            <small>
                              Al guardar se vinculan a sus cuentas. Las
                              identidades ya vinculadas también se conservan.
                            </small>
                          ) : null}
                        </Field>
                      </div>
                      <p>
                        {!supportsOfficialTournamentScoring(draft.sport)
                          ? 'Planificación de otro deporte: no se activa en el motor actual de anotación de béisbol/sóftbol.'
                          : !game.homeTeamId || !game.awayTeamId
                            ? 'Plazas pendientes: no se crea todavía un partido oficial.'
                            : !draft.teams.find(
                                  (team) => team.id === game.homeTeamId,
                                )?.managerId ||
                                !draft.teams.find(
                                  (team) => team.id === game.awayTeamId,
                                )?.managerId
                              ? 'Asigna los managers para activar el encuentro oficial.'
                              : !saved?.public
                                ? 'Se conectará a los partidos oficiales al publicar.'
                                : 'Vinculado a los partidos oficiales al guardar. Sin fecha, hora y ubicación válida aún no aparece en la cartelera territorial.'}
                      </p>
                      {!saved?.document.fixtures.some(
                        (row) => row.id === game.id,
                      ) || !saved.public ? (
                        <button
                          className="managerButtonOutline"
                          onClick={() =>
                            change(
                              'fixtures',
                              draft.fixtures.filter(
                                (row) => row.id !== game.id,
                              ),
                            )
                          }
                        >
                          Quitar cruce no publicado
                        </button>
                      ) : null}
                      {saved?.public &&
                      !dirty &&
                      game.date &&
                      game.time &&
                      draft.venues.some(
                        (venue) =>
                          venue.id === game.venueId &&
                          venue.stateId &&
                          venue.municipalityId,
                      ) &&
                      supportsOfficialTournamentScoring(draft.sport) &&
                      game.homeTeamId &&
                      game.awayTeamId &&
                      draft.teams.find((team) => team.id === game.homeTeamId)
                        ?.managerId &&
                      draft.teams.find((team) => team.id === game.awayTeamId)
                        ?.managerId ? (
                        <Link
                          className="managerButtonOutline"
                          href={`/demo/events-map?official=${encodeURIComponent(`plan:${draft.id}:${game.id}`)}`}
                        >
                          Consultar partido oficial
                        </Link>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Reglamento' ? (
                <section className="managerCard">
                  <h2>Reglamento del torneo</h2>
                  <Field label="Reglamento general, clasificación, desempates, incorporaciones y tratamiento de retiros">
                    <textarea
                      rows={12}
                      maxLength={30000}
                      value={draft.rules}
                      onChange={(event) => change('rules', event.target.value)}
                    />
                  </Field>
                  <p>
                    Las reglas escritas se publican como reglamento. No cambian
                    por sí solas el motor de anotación ni adjudican resultados:
                    las decisiones se registran en las herramientas oficiales.
                  </p>
                  <Link
                    className="managerButtonOutline"
                    href="/demo/organizer-center"
                  >
                    Configurar cupos y cierre simultáneo del roster
                  </Link>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('customRules', [
                        ...draft.customRules,
                        {
                          name: `Regla ${draft.customRules.length + 1}`,
                          value: '',
                        },
                      ])
                    }
                  >
                    Agregar condición personalizada
                  </button>
                  {draft.customRules.map((rule, index) => (
                    <div className="tournamentSubcard" key={index}>
                      <Field label="Condición">
                        <input
                          value={rule.name}
                          onChange={(event) =>
                            change(
                              'customRules',
                              draft.customRules.map((row, i) =>
                                i === index
                                  ? { ...row, name: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Contenido">
                        <textarea
                          value={rule.value}
                          onChange={(event) =>
                            change(
                              'customRules',
                              draft.customRules.map((row, i) =>
                                i === index
                                  ? { ...row, value: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <button
                        className="managerButtonOutline"
                        onClick={() =>
                          change(
                            'customRules',
                            draft.customRules.filter((_, i) => i !== index),
                          )
                        }
                      >
                        Quitar regla
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}
              {tab === 'Sanciones' ? (
                <section className="managerCard">
                  <h2>Equipos y jugadores sancionados</h2>
                  <p>
                    Registro privado del organizador. Se comprueba antes de
                    entregar alineaciones e iniciar encuentros; no suspende
                    automáticamente uno ya iniciado ni cambia resultados.
                  </p>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('sanctions', [
                        ...draft.sanctions,
                        {
                          id: freshId(),
                          target: 'team',
                          targetId: draft.teams[0]?.id ?? '',
                          reason: '',
                          phaseId: '',
                          from: '',
                          until: '',
                          gamesRemaining: null,
                          active: true,
                        },
                      ])
                    }
                  >
                    Registrar sanción
                  </button>
                  {draft.sanctions.map((item) => (
                    <article className="tournamentSubcard" key={item.id}>
                      <div className="profileFieldGrid">
                        <Field label="Tipo">
                          <select
                            value={item.target}
                            onChange={(event) =>
                              sanctionChange(item.id, {
                                target: event.target
                                  .value as TournamentSanction['target'],
                                targetId: '',
                              })
                            }
                          >
                            <option value="team">Equipo</option>
                            <option value="player">Jugador</option>
                          </select>
                        </Field>
                        <Field
                          label={
                            item.target === 'team'
                              ? 'Equipo sancionado'
                              : 'ID / identificación del jugador existente'
                          }
                        >
                          {item.target === 'team' ? (
                            <select
                              value={item.targetId}
                              onChange={(event) =>
                                sanctionChange(item.id, {
                                  targetId: event.target.value,
                                })
                              }
                            >
                              <option value="">Selecciona equipo</option>
                              {draft.teams.map((team) => (
                                <option key={team.id} value={team.id}>
                                  {team.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              value={item.targetId}
                              onChange={(event) =>
                                sanctionChange(item.id, {
                                  targetId: event.target.value,
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field label="Alcance">
                          <select
                            value={item.phaseId}
                            onChange={(event) =>
                              sanctionChange(item.id, {
                                phaseId: event.target.value,
                              })
                            }
                          >
                            <option value="">Todo este torneo</option>
                            {draft.phases.map((phase) => (
                              <option key={phase.id} value={phase.id}>
                                {phase.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Desde (opcional)">
                          <input
                            type="date"
                            value={item.from}
                            onChange={(event) =>
                              sanctionChange(item.id, {
                                from: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Hasta (opcional)">
                          <input
                            type="date"
                            value={item.until}
                            onChange={(event) =>
                              sanctionChange(item.id, {
                                until: event.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Partidos pendientes de cumplir (vacío: por fechas / indefinida)">
                          <input
                            type="number"
                            min={0}
                            value={item.gamesRemaining ?? ''}
                            onChange={(event) =>
                              sanctionChange(item.id, {
                                gamesRemaining: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                          />
                        </Field>
                      </div>
                      <Field label="Motivo y condiciones de cumplimiento">
                        <textarea
                          value={item.reason}
                          onChange={(event) =>
                            sanctionChange(item.id, {
                              reason: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.active}
                          onChange={(event) =>
                            sanctionChange(item.id, {
                              active: event.target.checked,
                            })
                          }
                        />{' '}
                        Sanción vigente
                      </label>
                      <p>
                        El organizador registra el cumplimiento de partidos y
                        levanta la sanción expresamente. No se descuenta por
                        juegos cancelados o suspendidos.
                      </p>
                      {!saved?.document.sanctions.some(
                        (row) => row.id === item.id,
                      ) ? (
                        <button
                          className="managerButtonOutline"
                          onClick={() =>
                            change(
                              'sanctions',
                              draft.sanctions.filter(
                                (row) => row.id !== item.id,
                              ),
                            )
                          }
                        >
                          Descartar sanción sin guardar
                        </button>
                      ) : null}
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Comunicados' ? (
                <section className="managerCard">
                  <h2>Comunicados y avisos</h2>
                  <button
                    className="managerButtonOutline"
                    onClick={() =>
                      change('notices', [
                        ...draft.notices,
                        {
                          id: freshId(),
                          title: `Comunicado ${draft.notices.length + 1}`,
                          text: '',
                          public: false,
                        },
                      ])
                    }
                  >
                    Agregar comunicado
                  </button>
                  {draft.notices.map((item) => (
                    <article className="tournamentSubcard" key={item.id}>
                      <Field label="Título">
                        <input
                          value={item.title}
                          onChange={(event) =>
                            change(
                              'notices',
                              draft.notices.map((row) =>
                                row.id === item.id
                                  ? { ...row, title: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <Field label="Contenido">
                        <textarea
                          value={item.text}
                          onChange={(event) =>
                            change(
                              'notices',
                              draft.notices.map((row) =>
                                row.id === item.id
                                  ? { ...row, text: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </Field>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.public}
                          onChange={(event) =>
                            change(
                              'notices',
                              draft.notices.map((row) =>
                                row.id === item.id
                                  ? { ...row, public: event.target.checked }
                                  : row,
                              ),
                            )
                          }
                        />{' '}
                        Publicar para los demás roles y usuarios
                      </label>
                      <button
                        className="managerButtonOutline"
                        onClick={() =>
                          change(
                            'notices',
                            draft.notices.filter((row) => row.id !== item.id),
                          )
                        }
                      >
                        Quitar comunicado
                      </button>
                    </article>
                  ))}
                </section>
              ) : null}
              {tab === 'Historial' ? (
                <section className="managerCard">
                  <h2>Historial de cambios</h2>
                  <p>
                    Cambios efectuados por tu cuenta autenticada como
                    organizador. Se conservan las versiones, sin reescribir los
                    resultados deportivos.
                  </p>
                  <button
                    className="managerButtonOutline"
                    onClick={() => void loadHistory()}
                  >
                    Actualizar historial
                  </button>
                  <ul>
                    {history.map((event) => (
                      <li key={event.revision}>
                        Revisión {event.revision} · {event.action} ·{' '}
                        {new Date(event.at).toLocaleString('es-VE')}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </fieldset>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PublicTournament({ id }: { id: string }) {
  const [value, setValue] = useState<TournamentRecord | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      void request(`/public/${encodeURIComponent(id)}`)
        .then((body) => {
          const next = record(body);
          if (active) {
            setValue(next);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(failure(error));
        });
    };
    load();
    const timer = setInterval(load, 30000);
    globalThis.addEventListener('focus', load);
    return () => {
      active = false;
      clearInterval(timer);
      globalThis.removeEventListener('focus', load);
    };
  }, [id, retry]);
  if (error)
    return (
      <section className="managerCard">
        <p role="alert">{error}</p>
        <button onClick={() => setRetry((value) => value + 1)}>
          Reintentar
        </button>
      </section>
    );
  if (!value) return <p role="status">Consultando la ficha pública…</p>;
  const doc = value.document,
    state = venezuelaStates.find((state) => state.id === doc.location.stateId);
  return (
    <section className="tournamentWorkspace">
      <header className="moduleHeader">
        <p className="eyebrow">
          FICHA COMPARTIDA · {tournamentStates[doc.status]}
        </p>
        <h1>
          <InstitutionName kind="tournament" id={doc.id}>
            {doc.name || doc.leagueName}
          </InstitutionName>
        </h1>
        <p>
          {[
            doc.leagueName,
            doc.season || 'Temporada por definir',
            doc.sport,
            doc.modality,
            doc.category,
            doc.branch,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {doc.description ? <p>{doc.description}</p> : null}
        <p>
          {[
            state?.name ?? 'Ubicación por definir',
            state?.municipalities.find(
              (m) => m.id === doc.location.municipalityId,
            )?.name,
            doc.location.address,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {doc.location.mapUrl ? (
          <a
            href={doc.location.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver ubicación
          </a>
        ) : null}
        {doc.contact ? <p>Contacto oficial: {doc.contact}</p> : null}
        <ul>
          {doc.socialLinks.filter(Boolean).map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            </li>
          ))}
        </ul>
        <p>
          Inscripción: {doc.feeCents / 100} CR · Cierre:{' '}
          {doc.registrationDeadline || 'Por definir'} · Cupos:{' '}
          {doc.teamLimit ?? 'Por definir'}
        </p>
      </header>
      <PublicShare
        key={doc.id}
        path={`/demo/tournaments?tournament=${encodeURIComponent(doc.id)}`}
        title={`${doc.name || doc.leagueName} · PlaySport`}
      />
      <section className="managerCard">
        <h2>Comunicados</h2>
        {doc.notices.length ? (
          doc.notices.map((notice) => (
            <article key={notice.id}>
              <h3>{notice.title}</h3>
              <p className="tournamentText">{notice.text}</p>
            </article>
          ))
        ) : (
          <p>No hay comunicados publicados.</p>
        )}
      </section>
      <section className="managerCard">
        <h2>Equipos</h2>
        <ul>
          {doc.teams.map((team) => (
            <li key={team.id}>
              <InstitutionName id={team.id}>{team.name}</InstitutionName> ·{' '}
              {team.status === 'accepted'
                ? 'Aceptado'
                : team.status === 'withdrawn'
                  ? 'Retirado'
                  : 'Inscripción pendiente'}
            </li>
          ))}
        </ul>
      </section>
      <section className="managerCard">
        <h2>Fases y calendario</h2>
        {doc.phases.map((phase) => (
          <article className="tournamentSubcard" key={phase.id}>
            <h3>
              {phase.name} · {tournamentPhaseKinds[phase.kind]}
            </h3>
            <p>
              {phase.kind === 'round-robin'
                ? `${phase.turns} vuelta(s)`
                : tournamentPhaseUsesSeries(phase.kind)
                  ? phase.bestOf === 1
                    ? 'Partido único'
                    : `Serie al mejor de ${phase.bestOf}`
                  : 'Cruces personalizados'}
              {!phase.groups.length
                ? ` · Equipos: ${phase.teamIds.length} de ${phase.teamLimit ?? 'cupo por definir'} · Clasifican: ${phase.qualifiers ?? 'Por definir'}`
                : ''}
            </p>
            {phase.groups.map((group) => (
              <p key={group.id}>
                {group.name}: {group.teamIds.length} de{' '}
                {group.teamLimit ?? 'cupo por definir'} equipos · Clasifican:{' '}
                {group.qualifiers ?? 'Por definir'}
              </p>
            ))}
            <p className="tournamentText">{phase.rules}</p>
            {doc.fixtures
              .filter((game) => game.phaseId === phase.id)
              .map((game) => {
                const venue = doc.venues.find(
                  (venue) => venue.id === game.venueId,
                );
                return (
                  <div className="tournamentPublicGame" key={game.id}>
                    <p>
                      Jornada {game.round} ·{' '}
                      <InstitutionName id={game.awayTeamId || undefined}>
                        {doc.teams.find((team) => team.id === game.awayTeamId)
                          ?.name || game.awaySource}
                      </InstitutionName>{' '}
                      vs.{' '}
                      <InstitutionName id={game.homeTeamId || undefined}>
                        {doc.teams.find((team) => team.id === game.homeTeamId)
                          ?.name || game.homeSource}
                      </InstitutionName>
                    </p>
                    <p>
                      {game.date || 'Fecha pendiente'} ·{' '}
                      {game.time || 'Hora pendiente'} ·{' '}
                      {venue?.name || 'Sede pendiente'} · Hora de Venezuela
                    </p>
                    {venue?.mapUrl ? (
                      <a
                        href={venue.mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ubicación del estadio
                      </a>
                    ) : null}
                    {value.officialFixtureIds?.includes(game.id) ? (
                      <Link
                        href={`/demo/events-map?official=${encodeURIComponent(`plan:${doc.id}:${game.id}`)}`}
                      >
                        Consultar partido
                      </Link>
                    ) : null}
                  </div>
                );
              })}
          </article>
        ))}
        {!doc.phases.length ? (
          <p>El organizador todavía no ha publicado las fases.</p>
        ) : null}
      </section>
      <section className="managerCard">
        <h2>Reglamento</h2>
        <p className="tournamentText">
          {doc.rules || 'Reglamento pendiente de publicación.'}
        </p>
        {doc.customRules.map((rule, index) => (
          <div key={index}>
            <h3>{rule.name}</h3>
            <p className="tournamentText">{rule.value}</p>
          </div>
        ))}
      </section>
      <p>
        Ficha actualizada: {new Date(value.updatedAt).toLocaleString('es-VE')} ·
        Revisión {value.revision}. Se consulta la misma identidad desde todos
        los roles.
      </p>
    </section>
  );
}

export function PublishedTournaments() {
  const [values, setValues] = useState<TournamentRecord[]>([]),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => {
      void request('/public')
        .then((body) => {
          const next = records(body);
          if (active) {
            setValues(next);
            setError('');
          }
        })
        .catch((error) => {
          if (active) setError(failure(error));
        });
    };
    load();
    const timer = setInterval(load, 30000);
    globalThis.addEventListener('focus', load);
    globalThis.addEventListener('playsport:tournaments-changed', load);
    const storage = (event: globalThis.StorageEvent) => {
      if (event.key === 'playsport:tournaments-changed') load();
    };
    globalThis.addEventListener('storage', storage);
    return () => {
      active = false;
      clearInterval(timer);
      globalThis.removeEventListener('focus', load);
      globalThis.removeEventListener('playsport:tournaments-changed', load);
      globalThis.removeEventListener('storage', storage);
    };
  }, [retry]);
  if (error)
    return (
      <section className="managerCard">
        <p role="alert">{error}</p>
        <button onClick={() => setRetry((value) => value + 1)}>
          Recargar torneos publicados
        </button>
      </section>
    );
  if (!values.length) return null;
  return (
    <section className="managerCard">
      <h2>Ligas, torneos y avisos publicados</h2>
      <p>
        Fichas compartidas con todos los roles. Se actualizan al volver a la
        pantalla y cada 30 segundos; no se envían correos ni notificaciones
        externas.
      </p>
      {values.map((value) => (
        <article className="tournamentSubcard" key={value.document.id}>
          <h3>
            <Link href={`/demo/tournaments?tournament=${value.document.id}`}>
              <InstitutionName kind="tournament" id={value.document.id}>
                {value.document.name || value.document.leagueName}
              </InstitutionName>
            </Link>
          </h3>
          <p>
            {value.document.season} · {tournamentStates[value.document.status]}{' '}
            · Revisión {value.revision}
          </p>
          {value.document.notices.map((notice) => (
            <p key={notice.id}>
              <strong>{notice.title}:</strong> {notice.text}
            </p>
          ))}
        </article>
      ))}
    </section>
  );
}
