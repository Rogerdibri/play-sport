import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  applyPrivateCommand, changeGameClock, isTimedScoringCommand, pauseGameClock, playerName, privateFieldingStats, readPrivateSave, replayPrivate, scorecardPracticeCommands, scorecardPracticeScenarios as scenarios, sportsTheme, startOrResumeGameClock, undoPrivateCommand,
  type GameClockAction, type PrivateCommand, type PrivateSeed, type PrivateState
} from '@playsport/shared';
import ScoringControls from './scoring-controls';
import DefensiveErrorsSheet from './defensive-errors-sheet';
import GameClockDisplay from './game-clock';

export function nativeScoringPracticeSeed(): PrivateSeed {
  const positions = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const lineup = (side: string, start: number) => positions.map((position, index) => ({
    id: `native-practice-${side}-${index + 1}`, name: `Jugador ${start + index + 1}`, order: index + 1, position, jersey: ''
  }));
  const lineups = { home: lineup('home', 0), away: lineup('away', 9) };
  return { friendly: true, names: { home: 'Tigres del Valle', away: 'Leones del Norte' }, lineups,
    rosters: structuredClone(lineups), courtesyRunnerSource: 'ROSTER' };
}
type Session = { saved: ReturnType<typeof readPrivateSave>; state: PrivateState };
export default function ScoringPractice({ onBack, onBusy }: { onBack: () => void; onBusy?: (_busy: boolean) => void }) { // eslint-disable-line no-unused-vars
  const [scenario, setScenario] = useState('third');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const key = `playsport:scorecard-practice:native:v1:${scenario}`;
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false); }, [busy, onBusy]);
  useEffect(() => {
    let active = true;
    setSession(null); setError('');
    void AsyncStorage.getItem(key).then(raw => {
      const seed = nativeScoringPracticeSeed();
      let saved = raw === null ? { version: 1 as const, seed, commands: scorecardPracticeCommands(seed, scenario) } : readPrivateSave(raw);
      const state = { ...replayPrivate(saved.seed, saved.commands), ...(saved.clock ? { clock: saved.clock } : {}) };
      if (state.seed.softballTieBreakerFromInning !== undefined) saved = { ...saved,
        seed: { ...saved.seed, softballTieBreakerFromInning: state.seed.softballTieBreakerFromInning } };
      if (active) setSession({ saved, state });
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo leer este ejercicio.'); });
    return () => { active = false; };
  }, [key, scenario]);
  const update = async (command: PrivateCommand | null, clockAction?: GameClockAction) => {
    if (!session || sending.current) return false;
    sending.current = true; setBusy(true); setError('');
    try {
      if (clockAction && session.state.finished) throw new Error('El tiempo de una práctica finalizada no se modifica.');
      const next = clockAction ? { commands: session.saved.commands, state: session.state } :
        command ? { commands: [...session.saved.commands, command], state: applyPrivateCommand(session.state, command) } :
          undoPrivateCommand(session.saved.seed, session.saved.commands);
      const now = new Date().toISOString();
      let clock = clockAction ? changeGameClock(session.state.clock, clockAction, now) :
        command && isTimedScoringCommand(command) ? startOrResumeGameClock(session.state.clock, now) : session.state.clock;
      if (clock && next.state.finished) clock = pauseGameClock(clock, now);
      if (clock) next.state = { ...next.state, clock };
      const saved = { ...session.saved, seed: { ...session.saved.seed,
        ...(next.state.seed.softballTieBreakerFromInning === undefined ? {} :
          { softballTieBreakerFromInning: next.state.seed.softballTieBreakerFromInning }) }, commands: next.commands, ...(clock ? { clock } : {}) };
      await AsyncStorage.setItem(key, JSON.stringify(saved));
      setSession({ saved, state: next.state });
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo guardar este ejercicio.');
      return false;
    } finally { sending.current = false; setBusy(false); }
  };
  return <View style={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Práctica del anotador</Text>
    <Text>Ejercicios ficticios guardados aparte en este dispositivo. No escriben partidos ni estadísticas oficiales.</Text>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={onBack}><Text>Volver sin borrar la práctica</Text></Pressable>
    <Text style={styles.label}>Ejercicio</Text>
    {Object.entries(scenarios).map(([id, value]) => <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: scenario === id }}
      disabled={busy} onPress={() => setScenario(id)} style={[styles.button, scenario === id && styles.selected]}><Text>{value.label}</Text></Pressable>)}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {!session ? !error ? <Text>Cargando ejercicio…</Text> : null : <>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.label}>{session.state.seed.names.away} {session.state.scores.away}–{session.state.scores.home} {session.state.seed.names.home}</Text>
        <Text>Entrada {session.state.inning} · {session.state.side === 'away' ? 'Alta' : 'Baja'} · {session.state.outs} outs · Cuenta {session.state.balls}–{session.state.strikes}</Text>
        <GameClockDisplay clock={session.state.clock} finished={session.state.finished} disabled={busy}
          onAction={action => { void update(null, action); }} />
        {(['away', 'home'] as const).map(side => <Text key={side}>{session.state.seed.names[side]} · E: {privateFieldingStats(session.state, side).errors ?? '—'}</Text>)}
        {session.state.bases.map((id, index) => <Text key={index}>{index + 1}.ª base: {id ? playerName(session.state, id) : 'Vacía'}</Text>)}
      </View>
      <ScoringControls key={scenario} state={session.state} disabled={busy} canUndo={session.saved.commands.some(command => !command.sharedRequestId)}
        onCommand={update} onUndo={() => update(null)} />
      {(['away', 'home'] as const).map(side => <DefensiveErrorsSheet key={side} state={session.state} side={side} />)}
      <Text accessibilityRole="header" style={styles.label}>Jugadas registradas</Text>
      {session.state.log.map((entry, index) => <Text key={index}>{entry.inning}.ª · {entry.text}</Text>)}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, minWidth: 0 }, title: { fontSize: 24, fontWeight: '700' }, label: { fontWeight: '700' },
  card: { padding: 14, gap: 8, backgroundColor: sportsTheme.surface, borderRadius: 12, borderWidth: 1, borderColor: sportsTheme.border },
  button: { minHeight: 44, padding: 12, justifyContent: 'center', borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 },
  selected: { borderWidth: 2, borderColor: '#16804a', backgroundColor: '#e5f4ed' }
});
