'use client';

import { useState } from 'react';
import { favoritesFirst, favoriteKey, type FavoriteKind } from '@playsport/shared';
import { useFavorites, FavoriteButton, FavoritesAccountNotice, FavoritesOnly } from '../favorites';

const labels = { team: 'Equipo', player: 'Jugador', league: 'Liga' } as const;
export default function FavoritesPage() {
  const favorites = useFavorites();
  const [kind, setKind] = useState<FavoriteKind | ''>('');
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState(false);
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const catalog = favorites?.catalog ?? [];
  const unavailable = favorites?.items.filter(ref => !catalog.some(row => favoriteKey(row) === favoriteKey(ref)))
    .map(ref => ({ ...ref, name: `${labels[ref.kind]} no disponible`, memberships: [] })) ?? [];
  const rows = favoritesFirst([...catalog, ...unavailable].filter(row =>
    (!kind || row.kind === kind) && (!only || favorites?.isFavorite(row)) && normalize(row.name).includes(normalize(query))),
  row => Boolean(favorites?.isFavorite(row)));
  return <main className="moduleView favoritesPage">
    <header className="moduleHeader">
      <h1>Mis favoritos</h1>
      <p>Toca la pelota para guardar equipos, jugadores y ligas. Se comparten entre todos tus roles.</p>
      <p>Se muestran primero en tus consultas, sin cambiar las clasificaciones, tus inscripciones ni activar notificaciones.</p>
    </header>
    {!favorites ? <FavoritesAccountNotice /> : <>
      <section className="managerCard managerStepCard">
        <div className="profileFieldGrid">
          <label className="managerField"><span>Buscar por nombre</span>
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <label className="managerField"><span>Qué quieres seguir</span>
            <select value={kind} onChange={event => {
              const value = event.target.value;
              if (value === '' || value === 'team' || value === 'player' || value === 'league') setKind(value);
            }}>
              <option value="">Equipos, jugadores y ligas</option>
              <option value="team">Equipos</option><option value="player">Jugadores</option><option value="league">Ligas</option>
            </select>
          </label>
        </div>
        <FavoritesOnly checked={only} onChange={setOnly} />
      </section>
      {!favorites.ready ? favorites.error ? null : <p role="status">Consultando favoritos…</p> :
        rows.length ? <ul className="favoritesGrid">{rows.map(row => {
          const teams = [...new Set(row.memberships.map(link => catalog.find(target => target.kind === 'team' && target.id === link.teamId)?.name).filter(Boolean))];
          return <li className="managerCard" key={favoriteKey(row)}>
            <div className="favoriteDirectoryName"><strong>{row.name}</strong><FavoriteButton {...row} /></div>
            <p>{labels[row.kind]}{'example' in row && row.example ? ' · Ejemplo' : ''}</p>
            {row.kind === 'player' && teams.length ? <p>{teams.join(' · ')}</p> : null}
          </li>;
        })}</ul> : <p role="status">No hay coincidencias para esta selección.</p>}
    </>}
  </main>;
}
