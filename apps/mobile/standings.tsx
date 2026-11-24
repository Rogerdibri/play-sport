import { sportsTheme } from '@playsport/shared';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { calendarDateLabel, calendarExampleVenues, demoStandings, standingsLeagues, standingsLegend, standingsRule } from '@playsport/shared';
import OfficialStandings from './official-standings';

export default function Standings({ apiBase, onOpenGame }: { apiBase: string; onOpenGame: (_id: string) => void }) { // eslint-disable-line no-unused-vars
  const [leagueId, setLeagueId] = useState<string>(standingsLeagues[0].id);
  const [tournament, setTournament] = useState<string>(standingsLeagues[0].tournaments[0]);
  const [team, setTeam] = useState<string | null>(null);
  const [chooser, setChooser] = useState<'league' | 'tournament' | null>(null);
  const { league, rows, completed } = demoStandings(leagueId, tournament);
  const showDraws = rows.some(row => row.ties > 0);
  const selected = rows.find(row => row.team === team);
  return <ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Tabla de posiciones</Text>
    <OfficialStandings apiBase={apiBase} onOpenGame={onOpenGame} />
    <Text accessibilityRole="header">Tablas de posiciones</Text>
    <Text>Liga</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: chooser === 'league' }}
      onPress={() => setChooser(chooser === 'league' ? null : 'league')} style={styles.button}><Text>{league.name}</Text></Pressable>
    {chooser === 'league' ? standingsLeagues.map(item => <Pressable key={item.id} accessibilityRole="button" style={styles.button}
      onPress={() => { setLeagueId(item.id); setTournament(item.tournaments[0]); setTeam(null); setChooser(null); }}><Text>{item.name}</Text></Pressable>) : null}
    <Text>Torneo / temporada</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: chooser === 'tournament' }}
      onPress={() => setChooser(chooser === 'tournament' ? null : 'tournament')} style={styles.button}><Text>{tournament}</Text></Pressable>
    {chooser === 'tournament' ? league.tournaments.map(name => <Pressable key={name} accessibilityRole="button" style={styles.button}
      onPress={() => { setTournament(name); setTeam(null); setChooser(null); }}><Text>{name}</Text></Pressable>) : null}
    <Text>{standingsRule}</Text>
    <Text>{completed} juegos finalizados computados · Ronda eliminatoria</Text>
    {!completed ? <Text>Este torneo todavía no tiene juegos finalizados. Los equipos aparecen sin posición.</Text> : null}
    <Text>Desliza la tabla horizontalmente. Pulsa un equipo para consultar su detalle.</Text>
    <ScrollView horizontal accessibilityLabel="Tabla de posiciones, desplazamiento horizontal">
      <View>
        <View style={styles.row}><Text style={styles.cell}>Pos.</Text><Text style={styles.team}>Equipo</Text>
          {['JJ', 'JG', 'JP', ...(showDraws ? ['JE'] : []), 'PCT', 'CF', 'CC', 'DIF', 'Racha'].map(label => <Text key={label} style={styles.cell}>{label}</Text>)}</View>
        {rows.map(row => <View key={row.team} style={[styles.row, row.team === team && styles.selected]}>
          <Text style={styles.cell}>{row.rank ?? '—'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Ver detalle de ${row.team}`}
            accessibilityHint={row.direct ? row.explanation : undefined} style={styles.team} onPress={() => setTeam(row.team)}>
            <Text style={styles.link}>{row.team}</Text>
            {row.direct ? <Text style={styles.direct}>
              {row.direct.wins === row.direct.losses ? 'Desempate pendiente' : `Directo ${row.direct.wins}–${row.direct.losses} vs. ${row.direct.opponent}`}
            </Text> : null}
          </Pressable>
          {[row.played, row.wins, row.losses, ...(showDraws ? [row.ties] : []), row.percentage === null ? '—' : row.percentage.toFixed(3),
            row.runsFor, row.runsAgainst, row.differential > 0 ? `+${row.differential}` : row.differential, row.streak].map((value, index) => <Text key={index} style={styles.cell}>{value}</Text>)}
        </View>)}
      </View>
    </ScrollView>
    <Text>{showDraws ? 'JE: juegos empatados · ' : ''}{standingsLegend} Racha: {showDraws ? 'G/P/E' : 'G/P'} y cantidad consecutiva.</Text>
    {selected ? <View style={styles.details}>
      <Text accessibilityRole="header" style={styles.title}>{selected.team}</Text>
      <Pressable accessibilityRole="button" style={styles.button} onPress={() => setTeam(null)}><Text>Cerrar detalle</Text></Pressable>
      <Text>{selected.rank ? `Posición ${selected.rank}` : 'Sin posición'} · {selected.played} jugados · {selected.wins} ganados · {selected.losses} perdidos{selected.ties > 0 ? ` · ${selected.ties} empatados` : ''}</Text>
      <Text>{selected.explanation}</Text>
      <Text>{selected.runsFor} carreras a favor · {selected.runsAgainst} en contra · Diferencial {selected.differential > 0 ? '+' : ''}{selected.differential}</Text>
      <Text accessibilityRole="header">Partidos que sustentan su posición</Text>
      {!selected.results.length ? <Text>No tiene juegos finalizados en este torneo. Los juegos en curso, programados y cancelados no suman resultados.</Text> :
        [...selected.results].reverse().map(result => {
          const venue = calendarExampleVenues.find(item => item.id === result.venueId);
          if (!venue) throw new Error('Un resultado de la tabla no tiene una sede registrada.');
          return <View style={styles.result} key={result.gameId}>
            <Text>{result.outcome === 'G' ? 'Ganó' : result.outcome === 'P' ? 'Perdió' : 'Empató'} {result.runsFor}–{result.runsAgainst} vs. {result.opponent}</Text>
            {selected.direct?.opponent === result.opponent ? <Text style={styles.direct}>Enfrentamiento directo</Text> : null}
            <Text>{calendarDateLabel(result.date)} · {result.time} · {venue.name}</Text>
          </View>;
        })}
    </View> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: sportsTheme.text },
  button: { borderWidth: 1, borderColor: sportsTheme.border, padding: 12, borderRadius: 10, backgroundColor: sportsTheme.surface },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: sportsTheme.border, minHeight: 52 },
  cell: { width: 62, padding: 8, textAlign: 'center' },
  team: { width: 180, padding: 8 },
  selected: { backgroundColor: '#e7f4ed' },
  link: { color: '#075c47', textDecorationLine: 'underline' },
  direct: { color: sportsTheme.muted, fontSize: 12, marginTop: 4 },
  details: { gap: 12, padding: 14, borderRadius: 12, backgroundColor: sportsTheme.surface },
  result: { gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: sportsTheme.border }
});
