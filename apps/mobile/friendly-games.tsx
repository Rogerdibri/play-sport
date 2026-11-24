import { sportsTheme } from '@playsport/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import GameClockDisplay from './game-clock';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FriendlyClient, currentBatter, playerName, privateStats, privateInningRuns, privateFieldingStats,
  fieldPositionLabels, availableLineupPositions, friendlyDraftLineup, friendlySetupFromDraft, initialFriendlyDraft, isFriendlyDraft,
  type FriendlyDraft, type FriendlyGame, type FriendlyOperation, type Side } from '@playsport/shared';
import ScoringControls from './scoring-controls';
import ScoringPractice from './scoring-practice';
import DefensiveErrorsSheet from './defensive-errors-sheet';
import { mobileApiBase } from './service-origins';
const errorText = (failure: unknown) => failure instanceof Error ? failure.message : 'No se pudo guardar el amistoso.';

export default function FriendlyGames({ accountId, gameId, onSelect, onBusy }: {
  accountId: string; gameId: string | null;
  onSelect: (_id: string | null) => void; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const client = useMemo(() => new FriendlyClient(mobileApiBase), []);
  const [games, setGames] = useState<FriendlyGame[] | null>(null);
  const [draft, setDraft] = useState(initialFriendlyDraft);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writes, setWrites] = useState(0);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [positionPlayer, setPositionPlayer] = useState<{ side: Side; id: string } | null>(null);
  const [draftPosition, setDraftPosition] = useState<{ side: Side; index: number } | null>(null);
  const [practice, setPractice] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const key = `playsport:friendly-draft:v1:${accountId}`;
  const game = games?.find(item => item.id === gameId);
  const current = useRef(game);
  current.current = game;
  useEffect(() => { onBusy(busy || writes > 0 || practiceBusy); return () => onBusy(false); }, [busy, writes, practiceBusy, onBusy]);
  useEffect(() => {
    let active = true;
    const request = ++generation.current;
    void Promise.all([client.list(), AsyncStorage.getItem(key)]).then(([next, raw]) => {
      const saved: unknown = raw === null ? initialFriendlyDraft : JSON.parse(raw);
      if (!isFriendlyDraft(saved)) throw new Error('El borrador del amistoso debe tener hasta 12 filas válidas. No se reemplazó.');
      if (active && request === generation.current) { setGames(next); setDraft(saved); setReady(true); setError(''); }
    }).catch(failure => { if (active && request === generation.current) setError(errorText(failure)); });
    return () => { active = false; };
  }, [client, key, retry]);
  const change = (next: FriendlyDraft) => {
    setDraft(next); setWrites(count => count + 1);
    const write = () => AsyncStorage.setItem(key, JSON.stringify(next));
    const pending = queue.current.then(write, write);
    queue.current = pending;
    void pending.then(() => setError('')).catch(failure => setError(errorText(failure))).finally(() => setWrites(count => count - 1));
  };
  const changeParticipant = (side: Side, index: number, patch: Partial<{ name: string; position: string }>) => {
    const rows = friendlyDraftLineup(draft, side).map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row);
    change({ ...draft, [side === 'home' ? 'homePlayers' : 'awayPlayers']: rows.map(row => row.name).join('\n'),
      [side === 'home' ? 'homePositions' : 'awayPositions']: rows.map(row => row.position) });
  };
  const send = async (operation: FriendlyOperation) => {
    if (sending.current) return false;
    const latest = current.current;
    if (!latest) { setError('Selecciona el amistoso antes de anotar.'); return false; }
    generation.current++; sending.current = true; setBusy(true); setError('');
    try {
      const next = await client.update(latest, operation);
      current.current = next;
      setGames(previous => previous?.map(item => item.id === next.id ? next : item) ?? [next]);
      return true;
    } catch (failure) { setError(errorText(failure)); return false; }
    finally { sending.current = false; setBusy(false); }
  };
  const create = async () => {
    if (sending.current) return;
    generation.current++; sending.current = true; setBusy(true); setError('');
    try {
      await queue.current;
      const next = await client.create(friendlySetupFromDraft(draft));
      setGames(previous => [...(previous ?? []), next]); onSelect(next.id); setCreating(false); change(initialFriendlyDraft);
    } catch (failure) { setError(errorText(failure)); }
    finally { sending.current = false; setBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = false) => <Pressable key={label} accessibilityRole="button"
    style={[styles.button, busy || disabled ? styles.disabled : null]} disabled={busy || disabled} onPress={action}><Text>{label}</Text></Pressable>;
  if (practice) return <ScrollView contentContainerStyle={styles.content}>
    <ScoringPractice onBack={() => setPractice(false)} onBusy={setPracticeBusy} />
  </ScrollView>;
  return <ScrollView contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Partidos amistosos</Text>
    <Text>PRIVADOS · NO OFICIALES. Solo tú puedes consultarlos y anotarlos. Los participantes solo necesitan nombre; no necesitan cuenta.</Text>
    <Text>Se guardan en el servicio local. Conserva el acceso de este dispositivo. No afectan torneos ni sus estadísticas.</Text>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {button('Practicar anotación en una planilla aparte', () => setPractice(true))}
    {button('Actualizar mis amistosos', () => setRetry(value => value + 1))}
    {creating || gameId ? button('Volver a mis amistosos', () => { onSelect(null); setCreating(false); }) :
      button('Crear amistoso', () => setCreating(true), !ready)}
    {!ready ? <Text>{error ? 'Reintenta sin reemplazar el acceso guardado.' : 'Consultando tus amistosos…'}</Text> :
      creating ? <View style={styles.card}>
        <Text>Orden al bate del 1 al 12. Mínimo 9 participantes por equipo. Los turnos 10, 11 y 12 son opcionales, sin huecos. Elige sus posiciones sin repetirlas en el equipo, o déjalas sin asignar.</Text>
        <View style={styles.row}>{button('Béisbol · 9 entradas', () => change({ ...draft, sport: 'baseball' }))}
          {button('Sóftbol · 7 entradas', () => change({ ...draft, sport: 'softball' }))}</View>
        <Text>Deporte elegido: {draft.sport === 'baseball' ? 'Béisbol' : 'Sóftbol'}</Text>
        {(['away', 'home'] as const).map(side => {
          const rows = friendlyDraftLineup(draft, side);
          const label = side === 'home' ? 'local' : 'visitante';
          return <View key={side} style={styles.card}>
          <Text>Equipo {side === 'away' ? 'visitante' : 'local'}</Text>
          <TextInput accessibilityLabel={`Nombre del equipo ${side === 'home' ? 'local' : 'visitante'}`}
            style={styles.input} maxLength={100} editable={!busy} value={draft[side]} onChangeText={value => change({ ...draft, [side]: value })} />
          {rows.map((row, index) => <View key={index} style={styles.lineupRow}>
            <Text accessibilityLabel={`Turno al bate ${index + 1}`} style={styles.order}>{index + 1}</Text>
            <View style={styles.participant}>
              <Text>Nombre {index + 1}{index >= 9 ? ' (opcional)' : ''}</Text>
              <TextInput accessibilityLabel={`Nombre del ${label}, turno ${index + 1}`} maxLength={100} style={styles.input}
                editable={!busy} value={row.name} onChangeText={value => changeParticipant(side, index, { name: value })} />
              {button(`Posición del ${label}, turno ${index + 1}: ${row.position === 'NA' ? 'Sin asignar' : fieldPositionLabels[row.position]}`,
                () => setDraftPosition(previous => previous?.side === side && previous.index === index ? null : { side, index }))}
              {draftPosition?.side === side && draftPosition.index === index ? <View style={styles.row}>
                {availableLineupPositions(rows.map((entry, rowIndex) => ({ identificationNumber: String(rowIndex), fieldPosition: entry.position })), String(index))
                  .map(position => button(position === 'NA' ? 'Sin asignar' : `${position} · ${fieldPositionLabels[position]}`, () => {
                    changeParticipant(side, index, { position }); setDraftPosition(null);
                  }))}
              </View> : null}
            </View>
          </View>)}
        </View>; })}
        {button('Comenzar amistoso', () => { void create(); }, writes > 0)}
      </View> : game ? <>
        <View style={styles.card}>
          <Text accessibilityRole="header">{game.seed.names.away} {game.state.scores.away}–{game.state.scores.home} {game.seed.names.home}</Text>
          <Text>{game.state.finished ? 'Finalizado · Solo lectura' : 'En curso'} · AMISTOSO · {game.seed.regulationInnings} entradas</Text>
          <Text>Entrada {game.state.inning} · {game.state.side === 'away' ? 'Alta' : 'Baja'} · {game.state.outs} outs · B {game.state.balls} / S {game.state.strikes}</Text>
          <GameClockDisplay clock={game.clock} finished={game.state.finished} disabled={busy}
            onAction={game.state.finished ? undefined : clockAction => { void send({ clockAction }); }} />
          <Text>Al bate: {playerName(game.state, currentBatter(game.state))}</Text>
          {(['away', 'home'] as const).map(side => <Text key={side}>{game.seed.names[side]} · {Array.from({ length: Math.max(game.state.inning, game.seed.regulationInnings ?? 7) },
            (_, index) => privateInningRuns(game.state, side, index + 1) ?? '—').join(' | ')} · E: {privateFieldingStats(game.state, side).errors ?? '—'}</Text>)}
        </View>
        {!game.state.finished ? <View style={styles.card}>
          <ScoringControls key={game.id} state={game.state} disabled={busy} canUndo={game.commands.length > 0}
            onCommand={command => send({ command })} onUndo={() => send({ undo: true })} />
          {button('Finalizar amistoso', () => Alert.alert('Finalizar amistoso', 'Quedará guardado para consulta, sin poder seguir anotándolo.',
            [{ text: 'Cancelar', style: 'cancel' }, { text: 'Finalizar', onPress: () => { void send({ command: { kind: 'finish' } }); } }]))}
        </View> : null}
        {(['away', 'home'] as const).map(side => <View key={side} style={styles.card}>
          <Text accessibilityRole="header">Alineación y estadísticas · {game.seed.names[side]}</Text>
          {game.state.lineups[side].map(player => {
            const stats = privateStats(game.state, side, player.id);
            return <View key={player.id}>
              <Text>{player.order}. {player.name} · {fieldPositionLabels[player.position]} · H {stats.hits} de {stats.atBats} · AVG {stats.average} · C {stats.runs} · E: {privateFieldingStats(game.state, side, player.id).errors ?? '—'}</Text>
              {!game.state.finished ? button(`Posición de ${player.order}. ${player.name}`, () => setPositionPlayer({ side, id: player.id })) : null}
              {positionPlayer?.side === side && positionPlayer.id === player.id && !game.state.finished ?
                <View style={styles.row}>{availableLineupPositions(game.state.lineups[side].map(item => ({ identificationNumber: item.id, fieldPosition: item.position })), player.id)
                  .map(position => button(fieldPositionLabels[position], () => {
                    setPositionPlayer(null); void send({ command: { kind: 'position', side, playerId: player.id, position } });
                  }))}</View> : null}
            </View>;
          })}
          <DefensiveErrorsSheet state={game.state} side={side} />
        </View>)}
        <Text accessibilityRole="header">Jugadas registradas</Text>
        {game.state.log.map((entry, index) => <Text key={index}>{entry.inning}.ª · {entry.text}</Text>)}
      </> : gameId ? <Text accessibilityRole="alert">Este amistoso no está disponible en tu cuenta.</Text> :
        games?.length ? [...games].reverse().map(item => <View key={item.id} style={styles.card}>
          <Text>{item.seed.names.away} {item.state.scores.away}–{item.state.scores.home} {item.seed.names.home} · {item.state.finished ? 'Finalizado' : 'En curso'}</Text>
          {button(item.state.finished ? 'Ver resultado y estadísticas' : 'Continuar anotación', () => onSelect(item.id))}
        </View>) : <Text>Aún no has creado amistosos.</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({
  content: { padding: 18, gap: 14 }, title: { fontSize: 24, fontWeight: '700' },
  card: { padding: 14, gap: 12, backgroundColor: sportsTheme.surface, borderRadius: 12, borderWidth: 1, borderColor: sportsTheme.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 },
  disabled: { opacity: 0.45 }, input: { padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 8 },
  lineupRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  order: { minWidth: 28, paddingTop: 12, fontWeight: '700' },
  participant: { flex: 1, minWidth: 0, gap: 8 }
});
