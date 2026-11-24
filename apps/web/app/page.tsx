'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  demoProfileLocation,
  isTeamSportsRole,
  profileLocationLabel,
  venezuelaStates,
  platformRoles,
  type ProfileLocation,
  type PlatformRoleId,
} from '@playsport/shared';
import {
  demoModules,
  demoModuleHref,
  demoSessionLocation,
  liveScoringHref,
  moduleStatusLabels,
  type DemoSession,
} from './platform-navigation';
import { usePlatformSession } from './platform-session';
import { useScreenBack } from './navigation-hooks';
import AccountAvatar from './account-avatar';
import { EditableInstitutionName } from './institution-logo-editor';
import { InstitutionName } from './institutional-logos';
import { PublishedTournaments } from './demo/[slug]/tournaments';
import ManagerTournamentPicker from './manager-tournament-picker';
import ManagerInscriptions from './manager-inscriptions';
import { PlayerTeamCard } from './player-sports-controls';
import SessionIdentity from './session-identity';
import SportsHomeHighlights from './sports-home-highlights';

export default function HomePage() {
  const { session, ready, account, enter, homeRevision, reportNavigationError } =
    usePlatformSession();
  const [choosingManagerTeam, setChoosingManagerTeam] = useState(false);
  const [location, setLocation] =
    useState<ProfileLocation>(demoProfileLocation);
  useEffect(() => { setChoosingManagerTeam(false); }, [homeRevision]);
  useScreenBack(() => setChoosingManagerTeam(false), choosingManagerTeam);
  const enterRole = (
    role: PlatformRoleId,
    team: DemoSession['team'] = 'team-A',
  ) => {
    setChoosingManagerTeam(false);
    enter({ version: 1, role, team, location });
  };
  if (!ready)
    return (
      <main className="landing">
        <p role="status">Preparando el inicio de PlaySport…</p>
      </main>
    );
  if (!session || choosingManagerTeam)
    return (
      <main className="landing">
        <section className="hero">
          <p className="eyebrow">COMUNIDAD · COMPETENCIA · DEPORTE</p>
          <h1>Bienvenido a PlaySport</h1>
          {account ? (
            <div className="accountIdentity">
              <AccountAvatar account={account} size={80} />
              <span>
                <strong>{account.displayName}</strong>
                <p>
                  Elige cómo quieres participar. Tu foto y tu cuenta son las
                  mismas en todos los roles.
                </p>
              </span>
            </div>
          ) : null}
          <p className="heroLead">
            Un solo inicio para elegir con qué rol
            quieres participar.
          </p>
          <div className="ctaRow">
            <Link className="cta managerButtonSolid" href="/account">
              Crear mi cuenta o iniciar sesión
            </Link>
            <Link className="cta managerButtonOutline" href="/demo/events-map">
              Ver cartelera
            </Link>
          </div>
        </section>
        <section
          className="platformWelcome managerCard"
          aria-label="Entrada por rol"
        >
          <h2>
            {choosingManagerTeam ? 'Elige tu equipo' : 'Entra con tu rol'}
          </h2>
          {choosingManagerTeam ? (
            <p>
              Elige el equipo y torneo donde vas a trabajar.
            </p>
          ) : (
            <p>
              Pulsa un rol para entrar directamente. No necesitas confirmar
              después.
            </p>
          )}
          <details>
            <summary>Ubicación: {profileLocationLabel(location)}</summary>
            <fieldset className="eventsProfileLocation">
              <legend>Ubicación de la cuenta</legend>
              <label className="managerField">
                <span>Estado o Distrito Capital</span>
                <select
                  value={location.stateId}
                  onChange={(event) => {
                    const state = venezuelaStates.find(
                      (item) => item.id === event.target.value,
                    );
                    const municipality = state?.municipalities[0];
                    if (!state || !municipality) {
                      reportNavigationError(
                        'Selecciona una ubicación del catálogo territorial.',
                      );
                      return;
                    }
                    setLocation({
                      stateId: state.id,
                      municipalityId: municipality.id,
                    });
                  }}
                >
                  {venezuelaStates
                    .filter((state) => state.municipalities.length > 0)
                    .map((state) => (
                      <option key={state.id} value={state.id}>
                        {state.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="managerField">
                <span>Municipio del perfil</span>
                <select
                  value={location.municipalityId}
                  onChange={(event) =>
                    setLocation({
                      ...location,
                      municipalityId: event.target.value,
                    })
                  }
                >
                  {venezuelaStates
                    .find((state) => state.id === location.stateId)
                    ?.municipalities.map((municipality) => (
                      <option key={municipality.id} value={municipality.id}>
                        {municipality.name}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                Se usará al abrir la cartelera por primera vez. Consultar otro
                lugar no cambia tu perfil.
              </p>
            </fieldset>
          </details>
          {choosingManagerTeam ? (
            <>
              <div
                className="platformProfiles"
                role="group"
                aria-label="Equipos disponibles para Manager"
              >
                <button
                  type="button"
                  className="platformProfile"
                  onClick={() => enterRole('manager', 'team-A')}
                >
                  <span>
                    <strong>
                      <InstitutionName id="team-A">
                        Tigres del Valle
                      </InstitutionName>
                    </strong>
                    <span>Torneo de demostración 2026</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="platformProfile"
                  onClick={() => enterRole('manager', 'team-B')}
                >
                  <span>
                    <strong>
                      <InstitutionName id="team-B">
                        Leones del Norte
                      </InstitutionName>
                    </strong>
                    <span>Torneo de demostración 2026</span>
                  </span>
                </button>
              </div>
              <button
                type="button"
                className="managerButtonOutline"
                onClick={() => setChoosingManagerTeam(false)}
              >
                {session ? 'Volver a mi inicio' : 'Volver a los roles'}
              </button>
            </>
          ) : (
            <div
              className="platformProfiles"
              role="group"
              aria-label="Roles de PlaySport"
            >
              {platformRoles.map((item) => (
                <button
                  type="button"
                  className="platformProfile"
                  aria-label={`Entrar como ${item.label}`}
                  key={item.id}
                  onClick={() =>
                    item.id === 'manager' &&
                    account?.identity?.status !== 'verified'
                      ? setChoosingManagerTeam(true)
                      : enterRole(item.id)
                  }
                >
                  <span>
                    <strong>{item.label}</strong>
                    <span>{item.summary}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p>
            Mi perfil reúne tus datos personales. Tu rol define cómo participas
            y qué herramientas puedes utilizar.
          </p>
          <p className="managerWarning">
            Elegir un rol no es iniciar sesión ni concede permisos.
            Tu
            cuenta autenticada y su foto se mantienen al cambiar de rol.
          </p>
        </section>
      </main>
    );
  const activeRole = platformRoles.find((item) => item.id === session.role);
  return (
    <main className="landing">
      <section
        className="hero playerHero roleHomeHero"
        aria-label={
          isTeamSportsRole(session.role)
            ? 'Mi equipo y torneo'
            : 'Inicio de mi rol'
        }
      >
        {isTeamSportsRole(session.role) ? (
          <PlayerTeamCard />
        ) : (
          <>
            <p className="eyebrow"><SessionIdentity /></p>
            <h1>Hola, {activeRole?.label}</h1>
            {account ? (
              <div className="accountIdentity">
                <AccountAvatar account={account} size={80} />
                <strong>{account.displayName}</strong>
              </div>
            ) : null}
            <p>
              Ubicación de mi perfil:{' '}
              {profileLocationLabel(demoSessionLocation(session))}
            </p>
          </>
        )}
        <nav
          className="ctaRow roleModuleNavigation"
          aria-label="Módulos de tu rol"
        >
          {session.role === 'scorekeeper' ? (
            <Link
              className="cta managerButtonOutline"
              href="/demo/live-scoring?view=scorekeeper"
              title="Consulta próximos encuentros, continúa uno en juego o revisa sus resultados."
            >
              Mis partidos asignados
            </Link>
          ) : null}
          {demoModules.map((module) => {
            if (module.id === 'player-career') return null;
            const href = demoModuleHref(module, session);
            if (href === null) return null;
            return (
              <Link
                className="cta managerButtonOutline"
                key={module.id}
                href={href}
                aria-label={module.title}
                title={`${module.summary} ${moduleStatusLabels[module.status]}`}
                data-module-id={module.id}
                data-status={module.status}
              >
                {module.title}
                {module.status !== 'working' ? (
                  <small className="roleModuleHint">
                    {' '}
                    · {module.status === 'planned' ? 'Próximamente' : 'Parcial'}
                  </small>
                ) : null}
              </Link>
            );
          })}
          {session.role === 'manager' &&
          (!account || account.localTestAccess || session.workManagerId) ? (
            <Link
              className="cta managerButtonOutline"
              href={liveScoringHref(session)}
            >
              Panel de mi equipo
            </Link>
          ) : null}
        </nav>
        {session.role === 'manager' ? (
          <details className="managerWorkDetails">
            <summary>Equipo de trabajo y herramientas del manager</summary>
            <p>
              La selección de consulta de arriba no modifica este equipo ni sus
              permisos. Para preparar roster o lineup, utiliza tu equipo de
              trabajo.
            </p>
            {account ? (
              <div className="accountIdentity">
                <AccountAvatar account={account} size={48} />
                <strong>{account.displayName}</strong>
              </div>
            ) : null}
            <p>
              Equipo de trabajo:{' '}
              {!account || account.localTestAccess || session.workManagerId ? (
                <EditableInstitutionName
                  id={session.workTeamId ?? session.team}
                  editable={
                    Boolean(session.workManagerId) ||
                    Boolean(account?.localTestAccess)
                  }
                >
                  {session.workTeamName ??
                    (session.team === 'team-A'
                      ? 'Tigres del Valle'
                      : 'Leones del Norte')}
                </EditableInstitutionName>
              ) : (
                'Selecciona uno de tus equipos asignados.'
              )}
            </p>
            {account ? (
              <ManagerTournamentPicker session={session} onSelect={enter} />
            ) : (
              <p>
                Inicia sesión con tu identidad verificada para trabajar con tus
                inscripciones reales.
              </p>
            )}
            {!account || account.localTestAccess ? (
              <button
                type="button"
                className="managerButtonOutline"
                onClick={() => {
                  setLocation(demoSessionLocation(session));
                  setChoosingManagerTeam(true);
                }}
              >
                Cambiar equipo de trabajo
              </button>
            ) : null}
          </details>
        ) : null}
        {session.role === 'manager' ? <ManagerInscriptions /> : null}
      </section>
      <SportsHomeHighlights role={session.role} />
      <PublishedTournaments />
      <details className="platformRoadmap managerCard">
        <summary>Qué está integrado y qué falta en la plataforma</summary>
        <p>
          Web y app móvil comparten los seis roles y sus módulos. Esta tabla
          muestra el estado funcional de la web; las pantallas de presentación
          no se consideran funciones terminadas.
        </p>
        <ul>
          {demoModules.map((module) => (
            <li key={module.id}>
              <strong>{module.title}:</strong>{' '}
              {moduleStatusLabels[module.status]}
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}
