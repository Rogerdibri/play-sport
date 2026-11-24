import { Text, View } from 'react-native';
import { officialGameNames, officialGameResult, type OfficialResultGame } from '@playsport/shared';

export default function OfficialResult({ game }: { game: OfficialResultGame }) {
  const result = officialGameResult(game);
  const names = officialGameNames(game);
  return <View style={{ gap: 6 }} accessibilityLabel="Resultado oficial">
    <Text>{result.label}</Text>
    {result.winnerTeamId && result.loserTeamId ? <Text>Ganador: {names[result.winnerTeamId]} · Perdedor: {names[result.loserTeamId]}</Text> : null}
    {result.source === 'technical' ? <Text>Marcador anotado conservado: {game.details?.awayTeamName ?? game.awayTeamId} {game.awayScore}–{
      game.homeScore} {game.details?.homeTeamName ?? game.homeTeamId}. El ganador se determina por el acta, no por estas carreras.</Text> : null}
  </View>;
}
