import Link from 'next/link';
import { newSportsRoleCard, sportsSheetDiscipline, type PublicSportsSheet } from '@playsport/shared';
import SportsSheetView from '../sports-sheet-view';

const exampleSportsSheet: PublicSportsSheet = {
  name: 'Álex Pelotero', photo: '', verifiedIdentity: false, city: 'Valencia', sports: ['Béisbol', 'Softbol'],
  cards: [{ ...newSportsRoleCard('player'), specialty: 'Softbol de lanzamiento lento', category: 'Adultos',
    positions: 'Campocorto · Segunda base', number: '12', bats: 'right', throws: 'right', available: true },
  { ...newSportsRoleCard('manager'), specialty: 'Formación y dirección de equipos', category: 'Adultos', available: false }],
  teams: [{ role: 'player', teamName: 'Guardianes del Lago', tournamentName: 'Copa del Lago 2026', leagueName: 'Liga del Lago' }],
};
export default function SportsSheetExample() {
  return <main className="moduleView sportsSheet"><header className="moduleHeader"><h1>Hoja deportiva · Ejemplo</h1>
    <p><strong>Disciplina:</strong> {sportsSheetDiscipline.label}</p>
    <p>Ejemplo de consulta separado de tu cuenta y de los registros oficiales.</p>
    <Link href="/sports-sheet" className="managerButtonOutline">Volver a mi hoja</Link></header>
    <SportsSheetView sheet={exampleSportsSheet} />
  </main>;
}
