'use client';

import Link from 'next/link';
import usePublicOfficialGames from '../[slug]/use-public-official-games';
import { bettingPreviewOpen, officialPreviewGame } from './game-context';
import BettingPreview from './preview';

export function PreviewUnavailable({ message }: { message: string }) {
  return <main className="moduleView bettingPreview">
    <section className="managerCard">
      <h1>Ejemplo de apuestas no disponible</h1>
      <p className="managerWarning" role="alert">{message}</p>
      <p>Solo se muestran ejemplos para partidos por iniciar o en curso. No hay dinero real ni movimientos de fondos.</p>
      <Link className="cta managerButtonOutline" href="/demo/events-map">Volver a la cartelera</Link>
    </section>
  </main>;
}

export default function SelectedOfficialGame({ gameId }: { gameId: string }) {
  const catalog = usePublicOfficialGames();
  if (catalog.error) return <>
    <PreviewUnavailable message={catalog.error} />
    <div className="landing"><button className="managerButtonOutline" type="button" onClick={catalog.refresh}>Reintentar consulta del partido</button></div>
  </>;
  if (!catalog.games) return <main className="moduleView bettingPreview"><p role="status">Consultando el partido elegido en la cartelera…</p></main>;
  const game = catalog.games.find(item => item.gameId === gameId);
  if (!game) return <PreviewUnavailable message="No se encontró el partido elegido. No se sustituirá por otro juego." />;
  if (!bettingPreviewOpen(game.status)) return <PreviewUnavailable message="El partido ya no está por iniciar ni en curso. No se pueden abrir nuevas apuestas." />;
  return <BettingPreview key={gameId} selectedGame={officialPreviewGame(game)} />;
}
