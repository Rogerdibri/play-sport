import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatGameClock, gameClockElapsed, readOfficialObservation, type GameClock, type GameClockAction, type OfficialObservation } from '@playsport/shared';

export function readGameClockOffset(value: unknown): number {
  if (!value || typeof value !== 'object' || !('serverTime' in value)) return 0;
  if (typeof value.serverTime !== 'string' || !Number.isFinite(Date.parse(value.serverTime))) {
    throw new Error('La hora del servidor para el cronómetro no es válida.');
  }
  return Date.parse(value.serverTime) - Date.now();
}

export default function GameClockDisplay({ clock, finished, disabled = false, onAction, offsetMs = 0 }: {
  clock?: GameClock; finished: boolean; disabled?: boolean; offsetMs?: number;
  onAction?: (_action: GameClockAction) => void; // eslint-disable-line no-unused-vars
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = clock?.runningSince ? setInterval(update, 1000) : undefined;
    const listener = AppState.addEventListener('change', update);
    return () => { clearInterval(interval); listener.remove(); };
  }, [clock]);
  const action = !clock ? 'start' : clock.runningSince ? 'pause' : 'resume';
  return <View style={styles.clock} accessibilityLabel="Tiempo de juego">
    <Text style={styles.label}>TIEMPO DE JUEGO</Text>
    <Text style={styles.value}>{clock || !finished ? formatGameClock(gameClockElapsed(clock, now + offsetMs)) : '—'}</Text>
    {!finished && onAction ? <Pressable accessibilityRole="button" disabled={disabled}
      style={[styles.button, disabled && styles.disabled]} onPress={() => onAction(action)}>
      <Text>{action === 'start' ? 'INICIAR TIEMPO' : action === 'pause' ? 'Pausar tiempo' : 'Reanudar tiempo'}</Text>
    </Pressable> : <Text>{!clock ? 'Sin iniciar' : finished ? 'Finalizado' : clock.runningSince ? 'En curso' : 'Pausado'}</Text>}
  </View>;
}

export function OfficialGameClock({ apiBase, gameId, tournamentId, actorId, role, disabled, onBusy, onState }: {
  apiBase: string; gameId: string; tournamentId: string; actorId: string; role: 'organizer' | 'scorekeeper';
  disabled: boolean; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
  onState: (_state: OfficialObservation) => void; // eslint-disable-line no-unused-vars
}) {
  const [observation, setObservation] = useState<OfficialObservation | null>(null);
  const [offsetMs, setOffsetMs] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const latest = useRef(-1), sending = useRef(false), callback = useRef(onBusy);
  callback.current = onBusy;
  const observationCallback = useRef(onState);
  observationCallback.current = onState;
  const path = `${apiBase}/games/${encodeURIComponent(gameId)}`;
  const accept = (value: unknown) => {
    const next = readOfficialObservation(value);
    if (next.officialVersion < latest.current) return;
    const offset = readGameClockOffset(value);
    latest.current = next.officialVersion; setObservation(next);
    observationCallback.current(next);
    setOffsetMs(offset);
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`${path}/state?tournamentId=${encodeURIComponent(tournamentId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar el tiempo de juego.');
        const value: unknown = await response.json();
        if (active) { accept(value); setError(''); }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el cronómetro.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [path, tournamentId]);
  useEffect(() => { callback.current(busy); return () => callback.current(false); }, [busy]);
  const change = async (clockAction: GameClockAction) => {
    if (sending.current || !observation || disabled) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${path}/official-updates`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId, actorId, actorRole: role, expectedOfficialVersion: latest.current, clockAction }) });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo modificar el cronómetro. Actualiza el partido.');
      accept(value);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el tiempo de juego.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <View>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {observation ? <GameClockDisplay clock={observation.scorecard.clock} finished={observation.status === 'final'}
      disabled={disabled || busy || Boolean(error)} offsetMs={offsetMs}
      onAction={['scheduled', 'in_progress'].includes(observation.status) ? action => { void change(action); } : undefined} /> :
      <Text>Consultando tiempo de juego…</Text>}
  </View>;
}

const styles = StyleSheet.create({
  clock: { alignSelf: 'flex-start', alignItems: 'center', gap: 4, padding: 8, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 },
  label: { fontSize: 10, fontWeight: '700', color: sportsTheme.text },
  value: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], color: sportsTheme.text },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 6 },
  disabled: { opacity: 0.5 }
});
