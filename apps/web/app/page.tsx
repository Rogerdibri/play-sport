'use client';

import Link from 'next/link';
import { useState } from 'react';
import { platformModuleIds, platformRoles, type PlatformRoleId } from '@playsport/shared';
import { demoIdentity, demoModules, demoModuleHref, moduleStatusLabels, type DemoSession } from './platform-navigation';
import { usePlatformSession } from './platform-session';

export default function HomePage() {
  const { session, ready, enter } = usePlatformSession();
  const [role, setRole] = useState<PlatformRoleId | null>(null);
  const [team, setTeam] = useState<DemoSession['team']>('team-A');
  if (!ready) return <main className="landing"><p role="status">Preparando el inicio de PlaySport…</p></main>;
  if (!session) return <main className="landing">
    <section className="hero">
      <p className="eyebrow">COMUNIDAD · COMPETENCIA · DEPORTE</p>
      <h1>Bienvenido a PlaySport</h1>
      <p className="heroLead">Un solo inicio para elegir quién eres en el demo y con qué perfil quieres trabajar.</p>
    </section>
    <form className="platformWelcome managerCard" onSubmit={(event) => {
      event.preventDefault();
      if (role) enter({ version: 1, role, team });
    }}>
      <h2>1. ¿Quién eres?</h2>
      <p>En esta demostración usarás una cuenta ficticia. No necesitas introducir datos personales ni una contraseña.</p>
      <p><strong>Identidad:</strong> {role ? demoIdentity({ version: 1, role, team }).name : 'Usuario de demostración'}</p>
      <fieldset className="platformProfiles">
        <legend>2. ¿Con qué perfil vas a usar PlaySport?</legend>
        {platformRoles.map((item) => <label className="platformProfile" data-selected={role === item.id} key={item.id}>
          <input type="radio" name="profile" value={item.id} checked={role === item.id} onChange={() => setRole(item.id)} required />
          <span><strong>{item.label}</strong><span>{item.summary}</span></span>
        </label>)}
      </fieldset>
      {role === 'manager' ? <label className="managerField"><span>Equipo asignado en el demo</span>
        <select value={team} onChange={(event) => setTeam(event.target.value === 'team-B' ? 'team-B' : 'team-A')}>
          <option value="team-A">Tigres del Valle · Local</option>
          <option value="team-B">Leones del Norte · Visitante</option>
        </select>
      </label> : null}
      <p className="managerWarning">Modo demo: elegir un perfil no es iniciar sesión ni concede permisos reales. El registro de usuarios y la autenticación están pendientes.</p>
      <button className="managerButtonSolid" type="submit" disabled={!role}>
        {role ? `Entrar como ${platformRoles.find((item) => item.id === role)?.label}` : 'Selecciona un perfil para continuar'}
      </button>
    </form>
  </main>;
  const available = platformModuleIds(session.role);
  const activeRole = platformRoles.find((item) => item.id === session.role);
  return <main className="landing">
    <section className="hero">
      <p className="eyebrow">INICIO DE TRABAJO · DEMOSTRACIÓN</p>
      <h1>Hola, {activeRole?.label}</h1>
      <p className="heroLead">{demoIdentity(session).name} · Cuenta ficticia: {demoIdentity(session).id}</p>
      <p className="heroLead">Tus módulos están reunidos aquí. Puedes cambiar de perfil desde la barra superior sin borrar el partido.</p>
    </section>
    <section className="moduleGrid" aria-label="Módulos de tu perfil">
      {demoModules.filter((module) => available.includes(module.id)).map((module) => {
        const href = demoModuleHref(module, session);
        return <article className="moduleCard" key={module.id}>
          <span className="platformModuleStatus" data-status={module.status}>{moduleStatusLabels[module.status]}</span>
          <h2>{module.title}</h2><p>{module.summary}</p>
          {href ? <Link className="moduleLink" href={href}>{module.status === 'working' ? 'Abrir módulo' : 'Ver alcance y pendientes'}</Link> : null}
        </article>;
      })}
    </section>
    <details className="platformRoadmap managerCard">
      <summary>Qué está integrado y qué falta en la plataforma</summary>
      <p>Web y app móvil comparten los seis perfiles y sus módulos. Esta tabla muestra el estado funcional de la web; las pantallas de presentación no se consideran funciones terminadas.</p>
      <ul>{demoModules.map((module) => <li key={module.id}><strong>{module.title}:</strong> {moduleStatusLabels[module.status]}</li>)}</ul>
      <p><strong>Pendiente:</strong> registro e inicio de sesión reales, permisos vinculados a cuentas y almacenamiento duradero del partido. El API del demo todavía guarda el juego en memoria.</p>
    </details>
  </main>;
}
