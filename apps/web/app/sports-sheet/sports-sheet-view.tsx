'use client';

import { platformRoles, type PublicSportsSheet } from '@playsport/shared';
import { useEffect, useState } from 'react';

export const roleAvailability = {
  fan: 'Disponible para participar', player: 'Busco equipo', manager: 'Disponible para dirigir',
  organizer: 'Disponible para organizar', scorekeeper: 'Disponible para anotar', scout: 'Disponible para scouting',
};
const hand = { right: 'Derecha', left: 'Izquierda', switch: 'Ambas' };
export default function SportsSheetView({ sheet }: { sheet: PublicSportsSheet }) {
  const [photoError, setPhotoError] = useState(false);
  useEffect(() => setPhotoError(false), [sheet.photo]);
  return <div className="sportsSheetContent">
    <header className="managerCard sportsSheetIdentity">
      {sheet.photo && !photoError ? <img className="sportsSheetPhoto" src={sheet.photo} alt={`Foto de ${sheet.name}`}
        width={80} height={80} onError={() => setPhotoError(true)} /> : null}
      <div><h2>{sheet.name}</h2>
        {photoError ? <p role="status">No se pudo mostrar la foto.</p> : null}
        {sheet.verifiedIdentity ? <p>Identidad verificada</p> : null}
        {sheet.city ? <p>{sheet.city}</p> : null}
        <p>{sheet.sports.length ? sheet.sports.join(' · ') : 'Sin deportes indicados'}</p>
      </div>
    </header>
    <section className="managerCard managerStepCard">
      <h2>Fichas deportivas</h2>
      <p>Las especialidades y la disponibilidad son declaradas por su titular; no acreditan permisos ni certificaciones.</p>
      {sheet.cards.length ? <div className="sportsSheetGrid">{sheet.cards.map(card => <article className="sportsSheetRole" key={card.role}>
        <h3>{platformRoles.find(role => role.id === card.role)?.label}</h3>
        <dl className="sportsSheetFacts">
          {card.specialty ? <><dt>Especialidad</dt><dd>{card.specialty}</dd></> : null}
          {card.category ? <><dt>Categoría</dt><dd>{card.category}</dd></> : null}
          {card.role === 'player' && card.positions ? <><dt>Posiciones</dt><dd>{card.positions}</dd></> : null}
          {card.role === 'player' && card.number ? <><dt>Dorsal</dt><dd>{card.number}</dd></> : null}
          {card.role === 'player' && card.bats ? <><dt>Batea</dt><dd>{hand[card.bats]}</dd></> : null}
          {card.role === 'player' && card.throws ? <><dt>Lanza</dt><dd>{hand[card.throws]}</dd></> : null}
        </dl>
        {card.available ? <p className="sportsSheetAvailability">{roleAvailability[card.role]}</p> : null}
        {!card.specialty && !card.category && !card.positions && !card.number && !card.bats && !card.throws && !card.available ?
          <p>Sin información complementaria.</p> : null}
      </article>)}</div> : <p>Aún no hay fichas deportivas.</p>}
    </section>
    {sheet.teams.length ? <section className="managerCard managerStepCard"><h2>Equipos y ligas actuales</h2>
      <div className="sportsSheetGrid">{sheet.teams.map((team, index) => <article className="sportsSheetRole" key={index}>
        <h3>{team.teamName}</h3><p>{team.tournamentName}</p>{team.leagueName ? <p>{team.leagueName}</p> : null}
        <p>{team.role === 'player' ? 'Jugador' : 'Manager'} · Pertenencia registrada en PlaySport</p>
      </article>)}</div>
    </section> : null}
  </div>;
}
