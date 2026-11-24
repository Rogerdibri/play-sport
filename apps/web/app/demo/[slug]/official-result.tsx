import { officialGameNames, officialGameResult, type OfficialResultGame } from '@playsport/shared';
import { InstitutionName } from '../../institutional-logos';

export default function OfficialResult({ game, teamNames }: { game: OfficialResultGame; teamNames?: Record<string, string> }) {
  const result = officialGameResult(game);
  const names = teamNames ?? officialGameNames(game);
  return <div className="assignedProgress" role="status" aria-label="Resultado oficial">
    <strong>{result.label}</strong>
    {result.winnerTeamId && result.loserTeamId ? <p>Ganador: <InstitutionName id={result.winnerTeamId}>{names[result.winnerTeamId]}</InstitutionName> · Perdedor: <InstitutionName id={result.loserTeamId}>{names[result.loserTeamId]}</InstitutionName></p> : null}
    {result.source === 'technical' ? <p>Marcador anotado conservado: <InstitutionName id={game.awayTeamId}>{names[game.awayTeamId]}</InstitutionName> {game.awayScore}–{
      game.homeScore} <InstitutionName id={game.homeTeamId}>{names[game.homeTeamId]}</InstitutionName>. El ganador se determina por el acta, no por estas carreras.</p> : null}
  </div>;
}
