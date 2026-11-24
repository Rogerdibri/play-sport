'use client';

import Link from 'next/link';
import {
  isProfileLocation,
  playerTeamKey,
  playerDemoMemberships,
  profileLocationLabel,
  venezuelaStates,
  favoritesFirst,
  type PlayerSportsFilter,
} from '@playsport/shared';
import { usePlayerSports } from './player-sports-context';
import { InstitutionName } from './institutional-logos';
import { EditableInstitutionName } from './institution-logo-editor';
import { usePlatformSession } from './platform-session';
import SessionIdentity from './session-identity';
import { useFavorites, FavoriteButton, FavoriteInstitutionName } from './favorites';

function ContextStatus() {
  const sports = usePlayerSports();
  if (!sports) return null;
  return (
    <>
      {sports.error ? (
        <p role="alert">
          {sports.error}{' '}
          <button
            type="button"
            className="managerButtonOutline"
            onClick={sports.refresh}
          >
            Volver a cargar mis equipos y torneos
          </button>
        </p>
      ) : !sports.ready ? (
        <p role="status">Consultando tus equipos y torneos…</p>
      ) : null}
      {sports.notice ? <p role="status">{sports.notice}</p> : null}
    </>
  );
}
export function PlayerTeamCard() {
  const sports = usePlayerSports();
  const { session, account } = usePlatformSession();
  const favorites = useFavorites();
  if (!sports) return <p role="status">Preparando tu inicio deportivo…</p>;
  const teams = favoritesFirst(sports.teams, item => Boolean(favorites?.isFavorite({ kind: 'team', id: item.teamId })));
  const manager = sports.role === 'manager';
  const team = sports.selectedTeam;
  const example =
    team &&
    playerDemoMemberships.some(
      (item) => playerTeamKey(item) === playerTeamKey(team),
    );
  const heading = (
    <h1>
      {team ? (
        manager && !example ? (
          <EditableInstitutionName
            id={team.teamId}
            editable={
              Boolean(session?.workManagerId) ||
              Boolean(account?.localTestAccess)
            }
          >
            {team.teamName}
          </EditableInstitutionName>
        ) : (
          <InstitutionName id={team.teamId} example={sports.demo}>
            {team.teamName}
          </InstitutionName>
        )
      ) : (
        'Mi equipo'
      )}
    </h1>
  );
  return (
    <>
      <p className="eyebrow">
        <SessionIdentity />
      </p>
      <div className="favoritesTeamHeading">
      {!manager && sports.ready && team && sports.teams.length > 1 ? (
        <details
          className="playerTeamPicker"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
              event.stopPropagation();
            }
          }}
        >
          <summary aria-label={`Cambiar equipo: ${team.teamName}`}>
            {heading}
          </summary>
          <div className="playerTeamChoices" role="group" aria-label="Mis equipos">
            {teams.map((item) => (
              <button
                type="button"
                className="playerTeamChoice"
                key={playerTeamKey(item)}
                aria-current={playerTeamKey(item) === playerTeamKey(team) ? 'true' : undefined}
                onClick={(event) => {
                  if (playerTeamKey(item) !== playerTeamKey(team))
                    sports.chooseTeam(playerTeamKey(item));
                  const picker = event.currentTarget.closest('details');
                  if (picker) {
                    picker.open = false;
                    picker.querySelector('summary')?.focus();
                  }
                }}
              >
                <strong>
                  <InstitutionName id={item.teamId} example={sports.demo}>
                    {item.teamName}
                  </InstitutionName>
                </strong>
                <small>
                  {favorites?.isFavorite({ kind: 'team', id: item.teamId }) ? 'Favorito · ' : ''}
                  {item.tournamentName}
                  {item.leagueName ? ` · ${item.leagueName}` : ''}
                </small>
              </button>
            ))}
          </div>
        </details>
      ) : heading}
      {sports.ready && team ? <FavoriteButton kind="team" id={team.teamId} name={team.teamName} /> : null}
      </div>
      <ContextStatus />
      {sports.ready ? (
        <>
          {sports.teams.length ? (manager ? (
            <label className="managerField playerTeamSelector">
              <span>
                {manager
                  ? 'Equipo activo para consultas'
                  : 'Equipo activo'}
              </span>
              <select
                value={team ? playerTeamKey(team) : ''}
                onChange={(event) => sports.chooseTeam(event.target.value)}
              >
                {teams.map((item) => (
                  <option key={playerTeamKey(item)} value={playerTeamKey(item)}>
                    {favorites?.isFavorite({ kind: 'team', id: item.teamId }) ? 'Favorito · ' : ''}{item.teamName} · {item.tournamentName}
                  </option>
                ))}
              </select>
            </label>
          ) : null) : (
            <p>
              {manager
                ? 'Aún no tienes equipos asignados como manager. Puedes explorar tu zona o '
                : 'Aún no tienes un equipo con roster aprobado vinculado a tu identidad. Puedes explorar tu zona o '}
              <Link href="/profile">revisar tu perfil</Link>.
            </p>
          )}
          {team ? (
            <p className="heroLead">
              <InstitutionName kind="tournament" id={team.tournamentId}>
                {team.tournamentName}
              </InstitutionName>
              {team.leagueName ? (
                <>
                  {' '}
                  ·{' '}
                  <FavoriteInstitutionName
                    kind="league"
                    id={team.leagueId || undefined}
                  >
                    {team.leagueName}
                  </FavoriteInstitutionName>
                </>
              ) : null}
            </p>
          ) : null}
          {manager ? (
            <p>
              Este equipo orienta tus consultas de cartelera, pizarra y
              posiciones, sin cambiar tu equipo de trabajo, roster ni lineup.
            </p>
          ) : (
            <p>
              Tu equipo orienta la cartelera, la pizarra y las posiciones. En
              cada sección puedes cambiar el alcance sin modificar tu
              inscripción.
            </p>
          )}
          <p>Mi zona: {profileLocationLabel(sports.profile)}</p>
        </>
      ) : null}
    </>
  );
}

export function PlayerSportsFilters() {
  const sports = usePlayerSports();
  const { reportNavigationError } = usePlatformSession();
  const favorites = useFavorites();
  if (!sports) return null;
  const filter = sports.preference.filter;
  const tournaments = favoritesFirst(sports.tournaments, item => Boolean(favorites?.matchesTournament(item.id)));
  const teams = favoritesFirst(sports.teams, item => Boolean(favorites?.isFavorite({ kind: 'team', id: item.teamId })));
  const tournament = tournaments.find(
    (item) => item.id === filter.tournamentId,
  );
  const leagues = favoritesFirst([
    ...new Map(
      tournaments
        .filter((item) => item.leagueId)
        .map((item) => [item.leagueId, item.leagueName]),
    ).entries(),
  ], ([id]) => Boolean(favorites?.isFavorite({ kind: 'league', id })));
  const state = venezuelaStates.find(
    (item) => item.id === filter.location.stateId,
  );
  const competition = ['tournament', 'team', 'league'].includes(filter.scope);
  const territorial =
    filter.scope === 'municipality' || filter.scope === 'state';
  const caption =
    filter.scope === 'all'
      ? 'Todos los estados · Todos los torneos'
      : filter.scope === 'state'
        ? `Estado: ${state?.name ?? filter.location.stateId}`
        : filter.scope === 'municipality'
          ? `Municipio: ${profileLocationLabel(filter.location)}`
          : filter.scope === 'league'
            ? `Liga: ${leagues.find(([id]) => id === filter.leagueId)?.[1] ?? filter.leagueId}`
            : filter.scope === 'team'
              ? `${tournament?.teams.find((team) => team.id === filter.teamId)?.name ?? filter.teamId} · ${tournament?.name ?? filter.tournamentId}`
              : `Torneo completo: ${tournament?.name ?? filter.tournamentId}`;
  const update = (patch: Partial<PlayerSportsFilter>) =>
    sports.updateFilter({ ...filter, ...patch });
  const chooseTournament = (id: string) => {
    const next = tournaments.find((item) => item.id === id);
    if (!next) {
      reportNavigationError('El torneo seleccionado no está disponible.');
      return;
    }
    update({
      tournamentId: next.id,
      leagueId: next.leagueId,
      teamId: next.teams[0]?.id ?? '',
    });
  };
  return (
    <section
      className="managerCard playerSportsFilters"
      aria-label="Mi contexto deportivo"
    >
      <h2>Qué quieres consultar</h2>
      <ContextStatus />
      {sports.ready ? (
        <>
          <p aria-live="polite">
            <strong>{caption}</strong>
            {filter.scope === 'league' && filter.leagueId ? <FavoriteButton kind="league" id={filter.leagueId} /> :
              filter.scope === 'team' && filter.teamId ? <FavoriteButton kind="team" id={filter.teamId} /> : null}
          </p>
          <div
            className="profileFieldGrid sportsLocationFilters"
            role="group"
            aria-label="Ubicación geográfica de la consulta"
          >
            <label className="managerField">
              <span>Estado / entidad federal</span>
              <select
                value={territorial ? filter.location.stateId : filter.scope === 'all' ? 'all' : ''}
                onChange={(event) => {
                  if (event.target.value === 'all') {
                    update({ scope: 'all' });
                    return;
                  }
                  const next = venezuelaStates.find(
                    (item) => item.id === event.target.value,
                  );
                  if (!next) {
                    reportNavigationError(
                      'Selecciona un estado del catálogo territorial.',
                    );
                    return;
                  }
                  update({
                    scope: 'state',
                    location: {
                      stateId: next.id,
                      municipalityId: next.municipalities[0]?.id ?? '',
                    },
                  });
                }}
              >
                <option value="" disabled>
                  Buscar por estado geográfico
                </option>
                <option value="all">Todos los estados</option>
                {venezuelaStates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {territorial ? (
              <label className="managerField">
                <span>Municipio de la consulta</span>
                <select
                  value={
                    filter.scope === 'municipality'
                      ? filter.location.municipalityId
                      : ''
                  }
                  onChange={(event) =>
                    update({
                      scope: event.target.value ? 'municipality' : 'state',
                      location: {
                        ...filter.location,
                        municipalityId:
                          event.target.value ||
                          state?.municipalities[0]?.id ||
                          '',
                      },
                    })
                  }
                >
                  <option value="">Todo el estado</option>
                  {state?.municipalities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="eventsTimezone">
            Ubicación de la sede: estados como Trujillo, Mérida, Barinas o
            Apure. Elegir uno amplía la consulta a esa zona; no cambia tu perfil
            ni tu equipo. «Todos los estados» permite una consulta general sin
            limitarla a una entidad.
          </p>
          <details>
            <summary>Cambiar equipo, liga o zona</summary>
            <p>
              {sports.selectedTeam ? (
                <>
                  Mi equipo:{' '}
                  <strong>
                    <InstitutionName id={sports.selectedTeam.teamId}>
                      {sports.selectedTeam.teamName}
                    </InstitutionName>
                  </strong>
                  .{' '}
                </>
              ) : null}
              Estos filtros se comparten entre cartelera, pizarra y posiciones.
              No cambian tu roster ni tu perfil
              {sports.role === 'manager'
                ? ', ni tu equipo de trabajo o lineup'
                : ''}
              .
            </p>
            <div className="profileFieldGrid">
              {sports.teams.length ? (
                <label className="managerField">
                  <span>Mi equipo activo</span>
                  <select
                    value={
                      sports.selectedTeam
                        ? playerTeamKey(sports.selectedTeam)
                        : ''
                    }
                    onChange={(event) => sports.chooseTeam(event.target.value)}
                  >
                    {teams.map((team) => (
                      <option
                        key={playerTeamKey(team)}
                        value={playerTeamKey(team)}
                      >
                        {favorites?.isFavorite({ kind: 'team', id: team.teamId }) ? 'Favorito · ' : ''}{team.teamName} · {team.tournamentName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="managerField">
                <span>Alcance de la consulta</span>
                <select
                  value={filter.scope}
                  onChange={(event) => {
                    const scope = (
                      [
                        'tournament',
                        'team',
                        'league',
                        'municipality',
                        'state',
                        'all',
                      ] as const
                    ).find((item) => item === event.target.value);
                    if (!scope) {
                      reportNavigationError(
                        'Selecciona un alcance disponible.',
                      );
                      return;
                    }
                    const next =
                      scope === 'team' && !tournament?.teams.length
                        ? tournaments.find((item) => item.teams.length)
                        : (tournament ?? tournaments[0]);
                    const league = filter.leagueId || leagues[0]?.[0] || '';
                    const leagueTournament = tournaments.find(
                      (item) => item.leagueId === league,
                    );
                    update({
                      scope,
                      tournamentId:
                        scope === 'league'
                          ? (leagueTournament?.id ?? '')
                          : (next?.id ?? ''),
                      teamId: next?.teams.some(
                        (team) => team.id === filter.teamId,
                      )
                        ? filter.teamId
                        : (next?.teams[0]?.id ?? ''),
                      leagueId:
                        scope === 'league' ? league : (next?.leagueId ?? ''),
                    });
                  }}
                >
                  <option value="tournament" disabled={!tournaments.length}>
                    Torneo completo
                  </option>
                  <option
                    value="team"
                    disabled={!tournaments.some((item) => item.teams.length)}
                  >
                    Solo un equipo
                  </option>
                  <option value="league" disabled={!leagues.length}>
                    Liga completa
                  </option>
                  <option
                    value="municipality"
                    disabled={!isProfileLocation(filter.location)}
                  >
                    Municipio
                  </option>
                  <option value="state">
                    Estado completo (entidad federal)
                  </option>
                  <option value="all">Todos los torneos</option>
                </select>
              </label>
              {competition ? (
                <>
                  <label className="managerField">
                    <span>Liga a consultar</span>
                    <select
                      value={filter.leagueId}
                      onChange={(event) => {
                        const next = tournaments.find(
                          (item) => item.leagueId === event.target.value,
                        );
                        if (next)
                          update({
                            leagueId: next.leagueId,
                            tournamentId: next.id,
                            teamId: next.teams[0]?.id ?? '',
                          });
                        else
                          reportNavigationError(
                            'La liga seleccionada no tiene torneos disponibles.',
                          );
                      }}
                    >
                      <option
                        value=""
                        disabled={
                          filter.scope === 'league' ||
                          !tournaments.some((item) => !item.leagueId)
                        }
                      >
                        Sin liga asociada
                      </option>
                      {leagues.map(([id, name]) => (
                        <option key={id} value={id}>
                          {favorites?.isFavorite({ kind: 'league', id }) ? 'Favorito · ' : ''}{name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {filter.scope !== 'league' ? (
                    <label className="managerField">
                      <span>Torneo a consultar</span>
                      <select
                        value={filter.tournamentId}
                        onChange={(event) =>
                          chooseTournament(event.target.value)
                        }
                      >
                        {!tournament ? (
                          <option value={filter.tournamentId}>
                            Selecciona un torneo disponible
                          </option>
                        ) : null}
                        {tournaments
                          .filter((item) => item.leagueId === filter.leagueId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : null}
                  {filter.scope === 'team' ? (
                    <label className="managerField">
                      <span>Equipo a consultar</span>
                      <select
                        value={filter.teamId}
                        onChange={(event) =>
                          update({ teamId: event.target.value })
                        }
                      >
                        {favoritesFirst(tournament?.teams ?? [], team => Boolean(favorites?.isFavorite({ kind: 'team', id: team.id }))).map((team) => (
                          <option key={team.id} value={team.id}>
                            {favorites?.isFavorite({ kind: 'team', id: team.id }) ? 'Favorito · ' : ''}{team.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="managerButtonRow">
              {sports.selectedTeam ? (
                <button
                  className="managerButtonOutline"
                  type="button"
                  onClick={() =>
                    sports.chooseTeam(playerTeamKey(sports.selectedTeam!))
                  }
                >
                  Volver al torneo de mi equipo
                </button>
              ) : null}
              <button
                className="managerButtonOutline"
                type="button"
                onClick={() =>
                  update({
                    scope: 'municipality',
                    location: { ...sports.profile },
                  })
                }
              >
                Ver municipio de mi perfil
              </button>
              <button
                className="managerButtonOutline"
                type="button"
                onClick={() =>
                  update({ scope: 'state', location: { ...sports.profile } })
                }
              >
                Ver estado de mi perfil
              </button>
            </div>
            <p className="eventsTimezone">
              La búsqueda territorial de partidos usa la sede del juego. En
              posiciones se muestran torneos de esa zona, con todos sus
              resultados.
            </p>
          </details>
        </>
      ) : null}
    </section>
  );
}
