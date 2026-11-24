import { StyleSheet, Text, View } from 'react-native';
import { playerName, privateFieldingStats, sportsTheme, type PrivateState, type Side } from '@playsport/shared';

export default function DefensiveErrorsSheet({ state, side }: { state: PrivateState; side: Side }) {
  const fielding = privateFieldingStats(state, side);
  const players = [...new Set(fielding.entries.flatMap(entry => entry.playerId ? [entry.playerId] : []))];
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.heading}>Errores defensivos · {state.seed.names[side]}</Text>
    <Text>E: {fielding.errors ?? '—'} · total del equipo</Text>
    {fielding.incomplete ? <Text>Historial defensivo incompleto: no hay un total definitivo.</Text> : null}
    {fielding.unattributed ? <Text>{fielding.unattributed} sin atribuir. Los totales individuales quedan pendientes.</Text> : null}
    {players.map(id => <Text key={id}>{playerName(state, id)} · E: {privateFieldingStats(state, side, id).errors ?? '—'}</Text>)}
    {fielding.entries.map(entry => <View key={`${entry.logIndex}-${entry.errorIndex}`} style={styles.entry}>
      <Text style={styles.heading}>Entrada {entry.inning} · {entry.playerId ? playerName(state, entry.playerId) : 'Sin atribuir'}</Text>
      <Text>{entry.position ?? 'Sin posición registrada'} · {entry.type === 'obstruction' ? 'Error por obstrucción defensiva' : entry.type === 'throwing' ? 'Error de tiro' :
        entry.type === 'fielding' ? 'Error de fildeo / recepción' : 'Tipo no registrado'}</Text>
      <Text>{entry.text}</Text>
    </View>)}
    {!fielding.entries.length ? <Text>{fielding.incomplete ? 'Sin detalle defensivo disponible.' : 'Sin errores defensivos registrados.'}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 12, backgroundColor: sportsTheme.surface },
  heading: { fontWeight: '700' },
  entry: { paddingTop: 10, gap: 6, borderTopWidth: 1, borderColor: sportsTheme.border }
});
