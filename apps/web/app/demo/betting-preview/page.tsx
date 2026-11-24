import { calendarExampleGames } from '@playsport/shared';
import { bettingPreviewOpen, examplePreviewGame } from './game-context';
import BettingPreview from './preview';
import SelectedOfficialGame, { PreviewUnavailable } from './selected-game';

export default async function BettingPreviewPage({ searchParams }: {
  searchParams: Promise<{ game?: string | string[]; official?: string | string[] }>;
}) {
  const { game, official } = await searchParams;
  if (Array.isArray(game) || Array.isArray(official) || (game !== undefined && official !== undefined) ||
      game === '' || official === '') {
    return <PreviewUnavailable message="Selecciona un único partido válido desde la cartelera." />;
  }
  if (official !== undefined) return <SelectedOfficialGame key={official} gameId={official} />;
  if (game !== undefined) {
    const selected = calendarExampleGames.find(item => item.id === game);
    if (!selected) return <PreviewUnavailable message="No se encontró el partido elegido. No se sustituirá por otro juego." />;
    if (!bettingPreviewOpen(selected.status)) return <PreviewUnavailable message="Este partido no está por iniciar ni en curso." />;
    return <BettingPreview key={game} selectedGame={examplePreviewGame(selected)} />;
  }
  return <BettingPreview />;
}
