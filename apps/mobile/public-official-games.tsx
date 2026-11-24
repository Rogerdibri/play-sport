import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { calendarDateLabel, officialGameStatusLabels, privateStats, readOfficialObservation,
  type OfficialObservation, type OfficialStandingGame } from '@playsport/shared';
import usePublicOfficialGames from './use-public-official-games';
import OfficialResult from './official-result';
import { SuspensionNotice } from './game-suspension';
import MatchChatLink from './match-chat-link';
import GameClockDisplay, { readGameClockOffset } from './game-clock';

export default function PublicOfficialGames({ apiBase, gameId, onSelect, onBack }: {
  apiBase: string; gameId: string | null; onSelect: (_id: string) => void; onBack: () => void; // eslint-disable-line no-unused-vars
}) {
  const { games, error, refresh } = usePublicOfficialGames(apiBase);
  const selected = games?.find(game => game.gameId === gameId);
  return <ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Partidos y resultados oficiales</Text>
    <Pressable accessibilityRole="button" style={styles.button} onPress={refresh}><Text>Actualizar resultados oficiales</Text></Pressable>
    {error ? <Text accessibilityRole="alert">{error}</Text> : !games ? <Text>Consultando partidos oficiales…</Text> :
      gameId ? selected ? <PublicGameDetails key={`${selected.tournamentId}:${selected.gameId}`} apiBase={apiBase} game={selected} onBack={onBack} /> :
        <><Text accessibilityRole="alert">Este partido oficial no está disponible. No se sustituye por un ejemplo.</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={onBack}><Text>Volver a partidos oficiales</Text></Pressable></> :
        !games.length ? <Text>No hay partidos oficiales configurados.</Text> : games.map(game => <View key={game.gameId} style={styles.card}>
          <Text>{game.details?.tournamentName ?? game.tournamentId} · {officialGameStatusLabels[game.status]}</Text>
          <Text accessibilityRole="header">{game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}</Text>
          <MatchChatLink gameId={game.gameId} />
          {game.details ? <Text>{game.status === 'suspended' ? 'Nueva fecha pendiente · Fecha original: ' : ''}{calendarDateLabel(game.details.date)} · {game.details.time} · {game.details.venue}</Text> : <Text>Fecha y sede pendientes de configurar.</Text>}
          <Text>Marcador anotado: {game.awayScore}–{game.homeScore}</Text>
          <OfficialResult game={game} />
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => onSelect(game.gameId)}><Text>Ver partido y resolución</Text></Pressable>
        </View>)}
    <Text>Consulta pública de solo lectura. Si falta la ubicación territorial de una sede, no se le atribuye un estado o municipio.</Text>
  </ScrollView>;
}
function PublicGameDetails({ apiBase, game, onBack }: { apiBase: string; game: OfficialStandingGame; onBack: () => void }) {
  const [observation, setObservation] = useState<OfficialObservation | null>(null);
  const latest = useRef(0);
  const clockOffsetMs = useRef(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`${apiBase}/games/${encodeURIComponent(game.gameId)}/state?tournamentId=${encodeURIComponent(game.tournamentId)}`,
          { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar el partido oficial.');
        const value: unknown = await response.json();
        const next = readOfficialObservation(value);
        if (active && request === revision && next.officialVersion >= latest.current) {
          clockOffsetMs.current = readGameClockOffset(value);
          latest.current = next.officialVersion; setObservation(next); setError('');
        }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el partido oficial.'); }
    };
    setObservation(null);
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { active = false; controller.abort(); clearInterval(interval); listener.remove(); };
  }, [apiBase, game.gameId, game.tournamentId, game.status, game.protest?.resolution?.recordedAt, retry]);
  const current = observation ? { ...game, status: observation.status, homeScore: observation.homeScore,
    awayScore: observation.awayScore, protest: observation.protest, suspension: observation.suspension } : game;
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" style={styles.button} onPress={onBack}><Text>Volver a partidos oficiales</Text></Pressable>
    <Pressable accessibilityRole="button" style={styles.button} onPress={() => setRetry(value => value + 1)}><Text>Actualizar partido oficial</Text></Pressable>
    <Text accessibilityRole="header">{game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}</Text>
    <OfficialResult game={current} />
    <SuspensionNotice apiBase={apiBase} game={game} suspension={current.suspension} suspended={current.status === 'suspended'} />
    {current.protest ? <>
      <Text>Equipo reclamante: {current.protest.teamId === game.homeTeamId ? game.details?.homeTeamName ?? game.homeTeamId :
        game.details?.awayTeamName ?? game.awayTeamId}. Motivo: {current.protest.reason}</Text>
      {current.protest.resolution ? <><Text>Fundamento: {current.protest.resolution.reason}</Text>
        <Text>Acta: {current.protest.resolution.recordReference}</Text></> : null}
    </> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : !observation ? <Text>Consultando pizarra y estadísticas…</Text> : <>
      <Text>Marcador anotado: {observation.awayScore}–{observation.homeScore} · {officialGameStatusLabels[observation.status]}</Text>
      <Text>Entrada {observation.inning} · {observation.outs} outs · Cuenta {observation.balls}–{observation.strikes}</Text>
      <GameClockDisplay clock={observation.scorecard.clock} finished={observation.status === 'final'} offsetMs={clockOffsetMs.current} />
      <Text>{observation.lastPlay}</Text>
      {(['away', 'home'] as const).map(side => <View style={styles.card} key={side}>
        <Text accessibilityRole="header">{side === 'home' ? game.details?.homeTeamName ?? game.homeTeamId : game.details?.awayTeamName ?? game.awayTeamId}</Text>
        {observation.scorecard.lineups[side].map(player => {
          const stats = privateStats(observation.scorecard, side, player.id);
          return <Text key={player.id}>#{player.jersey} · {player.name} · AB {stats.atBats} · H {stats.hits} · AVG {stats.average}</Text>;
        })}
      </View>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: 18, gap: 16 },
  title: { fontSize: 22, fontWeight: '700', color: sportsTheme.text },
  card: { padding: 16, gap: 12, backgroundColor: sportsTheme.surface, borderRadius: 12, borderWidth: 1, borderColor: sportsTheme.border },
  button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 }
});
