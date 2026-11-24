import { Pressable, ScrollView, Text, View } from 'react-native';
import { calculateOfficialStandings } from '@playsport/shared';
import usePublicOfficialGames from './use-public-official-games';

export default function OfficialStandings({ apiBase, onOpenGame }: { apiBase: string; onOpenGame: (_id: string) => void }) { // eslint-disable-line no-unused-vars
  const { games, error, refresh } = usePublicOfficialGames(apiBase);
  const tournaments = games ? calculateOfficialStandings(games) : null;
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header">Torneos oficiales</Text>
    <Pressable accessibilityRole="button" onPress={refresh}><Text>Actualizar clasificación oficial</Text></Pressable>
    {error ? <Text accessibilityRole="alert">{error}</Text> : tournaments === null ? <Text>Consultando clasificación oficial…</Text> :
      !tournaments.length ? <Text>No hay torneos oficiales configurados.</Text> : tournaments.map(tournament => <View key={tournament.id} style={{ gap: 10 }}>
        <Text accessibilityRole="header">{tournament.name}</Text>
        <Text>{tournament.pendingProtests} juegos bajo protesta pendientes: no suman victorias ni derrotas.</Text>
        <Text>El acta determina ganador y perdedor. Las carreras registradas se conservan.</Text>
        <ScrollView horizontal accessibilityLabel={`Clasificación oficial de ${tournament.name}`}>
          <View>
            <View style={{ flexDirection: 'row' }}>{['Pos.', 'Equipo', 'JJ', 'JG', 'JP', 'JE', 'CF', 'CC'].map((label, index) =>
              <Text key={label} style={{ width: index === 1 ? 180 : 50, padding: 8 }}>{label}</Text>)}</View>
            {tournament.rows.map(row => <View key={row.team} style={{ flexDirection: 'row' }}>
              {[row.rank ?? '—', tournament.teamNames[row.team], row.played, row.wins, row.losses, row.ties, row.runsFor, row.runsAgainst].map((value, index) =>
                <Text key={index} style={{ width: index === 1 ? 180 : 50, padding: 8 }}>{value}</Text>)}
            </View>)}
          </View>
        </ScrollView>
        {tournament.rows.flatMap(row => row.results.filter(result => result.technicalDecision && result.outcome === 'G').map(result =>
          <View key={result.gameId}><Text>Resultado por mesa técnica: {tournament.teamNames[row.team]} ganador · {tournament.teamNames[result.opponent]} perdedor.
            Carreras anotadas: {result.runsFor}–{result.runsAgainst}.</Text>
            <Pressable accessibilityRole="button" onPress={() => onOpenGame(result.gameId)} style={{ minHeight: 44, padding: 12 }}>
              <Text>Ver partido y acta</Text>
            </Pressable>
          </View>))}
      </View>)}
  </View>;
}
