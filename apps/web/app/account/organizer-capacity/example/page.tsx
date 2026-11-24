'use client';

import { useState } from 'react';
import Link from 'next/link';
import { organizerCapacityExamples, estimateTournamentCapacity } from '@playsport/shared';
import { OrganizerCapacityEstimate } from '../../../demo/[slug]/organizer-capacity-panel';
import { usePlatformSession } from '../../../platform-session';
import { OrganizerCommercialExample } from '../../../demo/[slug]/organizer-commercial-panel';

export default function OrganizerCapacityExample() {
  const { ready } = usePlatformSession();
  const [selected, setSelected] = useState(organizerCapacityExamples[0].id), [state, setState] = useState('available');
  const doc = organizerCapacityExamples.find(value => value.id === selected);
  if (!doc) throw new Error('Selecciona una configuración de capacidad disponible.');
  const eligible = estimateTournamentCapacity(doc).freeEligible;
  const played = state === 'consumed' && doc.fixtures[0] ? [{
    gameId: 'organizer-example-first-game', fixtureId: doc.fixtures[0].id, teamIds: doc.teams.slice(0, 2).map(team => team.id),
    at: '2026-11-23T16:00:00.000Z',
  }] : [];
  return <main className="moduleView administrationPage organizerCapacityExample">
    <header className="moduleHeader">
      <h1>Organizador · Capacidad por torneo</h1>
      <p>Ejemplos de configuración y del uso de la oportunidad gratuita. Solo lectura: no cambia cuentas ni torneos existentes.</p>
    </header>
    <section className="managerCard">
      <div className="profileFieldGrid">
        <label className="managerField"><span>Formato a comparar</span>
          <select value={selected} disabled={!ready} onChange={event => { setSelected(event.target.value); setState('available'); }}>
            {organizerCapacityExamples.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
          </select></label>
        <label className="managerField"><span>Estado de la oportunidad gratuita</span>
          <select value={state} disabled={!ready || !eligible} onChange={event => setState(event.target.value)}>
            <option value="available">Disponible · Antes de reservar</option>
            <option value="reserved">Reservada · Sin partidos iniciados</option>
            <option value="consumed">Consumida · Primer partido iniciado</option>
          </select></label>
      </div>
      <h2>{doc.name}</h2>
      <p>{!eligible ? 'Esta configuración requiere capacidad adicional y no puede reservarse como el único torneo gratuito.' :
        state === 'consumed' ? 'La oportunidad no vuelve a estar disponible, aunque termine o se cancele el torneo. Otro torneo requiere capacidad adicional.' :
        state === 'reserved' ? 'Guardar, publicar y preparar alineaciones no consume el beneficio. Puedes cambiar la reserva antes del primer partido.' :
          'Una sola oportunidad gratuita, de 2 a 5 equipos y hasta 13 partidos ordinarios, más hasta 3 desempates incluidos. Organizador no tiene niveles ni un máximo global de torneos.'}</p>
      <OrganizerCapacityEstimate document={doc} played={played} />
      <p>Precios y cobros todavía deshabilitados. La duración y el costo del plan del Anotador no cambian con el tamaño del torneo.</p>
      <div className="managerButtonRow"><Link href="/demo/tournaments" className="managerButtonOutline">Volver a mis torneos</Link>
        <Link href="/account/access" className="managerButtonOutline">Mis planes y accesos</Link></div>
    </section>
    <OrganizerCommercialExample key={doc.id} document={doc} />
  </main>;
}
