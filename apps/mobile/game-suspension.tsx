import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { isGameSuspension, preservesStartedGame, readOfficialObservation, type OfficialObservation, type OfficialGameSummary, type GameSuspension } from '@playsport/shared';

export function SuspensionNotice({ apiBase, game, suspension, suspended }: {
  apiBase: string; game: Pick<OfficialGameSummary, 'gameId' | 'tournamentId'>; suspension?: GameSuspension; suspended: boolean;
}) {
  const [error, setError] = useState('');
  const [history, setHistory] = useState<GameSuspension[] | null>(null);
  const [loading, setLoading] = useState(false);
  if (!suspension) return null;
  const archive = async (id = suspension.id) => {
    try {
      await Linking.openURL(`${apiBase}/games/${encodeURIComponent(game.gameId)}/suspension-archive?tournamentId=${encodeURIComponent(game.tournamentId)}&id=${encodeURIComponent(id)}`);
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir la anotación archivada.'); }
  };
  const loadHistory = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBase}/games/${encodeURIComponent(game.gameId)}/suspension-archive?tournamentId=${encodeURIComponent(game.tournamentId)}`);
      if (!response.ok) throw new Error('No se pudo consultar el historial de suspensiones.');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('interruptions' in value) || !Array.isArray(value.interruptions) ||
          !value.interruptions.every(isGameSuspension)) throw new Error('El historial contiene datos inválidos.');
      setHistory(value.interruptions);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo consultar el historial.'); }
    finally { setLoading(false); }
  };
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header">{suspended ? 'Suspendido · Nueva fecha pendiente' : 'Juego reprogramado'}</Text>
    <Text>{suspension.cause === 'weather' ? 'Clima' : 'Fuerza mayor'} · {suspension.reason}</Text>
    <Text>{suspension.scoreHandling === 'keep' ? 'Se conserva el juego completo para continuarlo.' : 'Se reinicia el juego completo; la anotación anterior está archivada.'}</Text>
    <Text>Registrado por {suspension.recordedBy} · {suspension.recordedAt}</Text>
    {suspension.rescheduled ? <Text>Nueva fecha: {suspension.rescheduled.date} · {suspension.rescheduled.time}</Text> : <Text>Solo el organizador puede fijar la nueva fecha.</Text>}
    <Pressable accessibilityRole="button" onPress={() => { void archive(); }} style={{ minHeight: 44, padding: 12 }}>
      <Text>Consultar anotación anterior archivada</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={loading} onPress={() => { void loadHistory(); }} style={{ minHeight: 44, padding: 12 }}>
      <Text>{loading ? 'Consultando historial…' : 'Ver historial de suspensiones'}</Text>
    </Pressable>
    {history?.map((entry, i) => <View key={entry.id}>
      <Text>{i + 1} · {entry.recordedAt} · {entry.reason}</Text>
      <Pressable accessibilityRole="button" onPress={() => { void archive(entry.id); }} style={{ minHeight: 44, padding: 12 }}><Text>Ver archivo de esta interrupción</Text></Pressable>
    </View>)}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
  </View>;
}
export default function GameSuspensionPanel({ apiBase, game, actorId, role, disabled, onBusy, onState }: {
  apiBase: string; game: OfficialGameSummary; actorId: string; role: 'organizer' | 'scorekeeper'; disabled: boolean;
  onBusy: (_busy: boolean) => void; onState: (_observation: OfficialObservation, _playByPlay: unknown) => void; // eslint-disable-line no-unused-vars
}) {
  const [snapshot, setSnapshot] = useState<OfficialObservation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState('');
  const [cause, setCause] = useState('');
  const [mode, setMode] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const callbacks = useRef({ onBusy, onState });
  const latest = useRef(-1), sending = useRef(false);
  callbacks.current = { onBusy, onState };
  const path = `${apiBase}/games/${encodeURIComponent(game.gameId)}`;
  const accept = (value: unknown) => {
    const observation = readOfficialObservation(value);
    if (observation.officialVersion < latest.current) return;
    latest.current = observation.officialVersion;
    setSnapshot(observation);
    callbacks.current.onState(observation, value && typeof value === 'object' && 'playByPlay' in value ? value.playByPlay : undefined);
  };
  useEffect(() => { callbacks.current.onBusy(busy); return () => callbacks.current.onBusy(false); }, [busy]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`${path}/state?tournamentId=${encodeURIComponent(game.tournamentId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar el estado de suspensión.');
        const value: unknown = await response.json();
        if (active) { accept(value); setError(''); }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la suspensión.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [path, game.tournamentId]);
  const reprogramming = role === 'organizer' && snapshot?.status === 'suspended';
  const suspending = snapshot?.status === 'scheduled' || snapshot?.status === 'in_progress';
  const started = snapshot?.status === 'in_progress' || preservesStartedGame(snapshot?.suspension);
  const submit = async () => {
    if (sending.current) return;
    if (!snapshot || !confirmed || (!reprogramming && (!cause || !reason.trim() || started && !mode))) {
      setError('Completa los datos, elige si conservar o reiniciar y confirma la decisión.'); return;
    }
    sending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${path}/${reprogramming ? 'reschedule' : 'suspension'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reprogramming ? { tournamentId: game.tournamentId, organizerId: actorId, date, time, expectedOfficialVersion: snapshot.officialVersion } :
          { tournamentId: game.tournamentId, actorId, actorRole: role, reason, cause, scoreHandling: started ? mode : 'reset',
            expectedOfficialVersion: snapshot.officialVersion })
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo registrar la suspensión o nueva fecha.');
      accept(value); setConfirmed(false); setMode(''); setCause(''); setReason('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo registrar la decisión.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const locked = disabled || busy || !snapshot;
  const buttonStyle = { minHeight: 44, padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 };
  return <View style={{ gap: 12, padding: 16, backgroundColor: sportsTheme.surface, borderRadius: 12 }}>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <SuspensionNotice apiBase={apiBase} game={game} suspension={snapshot?.suspension} suspended={snapshot?.status === 'suspended'} />
    {suspending || reprogramming ? <>
      <Pressable accessibilityRole="button" disabled={locked} onPress={() => setExpanded(v => !v)} style={buttonStyle}>
        <Text>{reprogramming ? 'Organizador · Reprogramar partido' : 'Suspender por clima o fuerza mayor'}</Text>
      </Pressable>
      {expanded ? <>
        {reprogramming ? <>
          <TextInput style={buttonStyle} accessibilityLabel="Nueva fecha del partido" placeholder="Nueva fecha YYYY-MM-DD" editable={!locked} value={date} onChangeText={setDate} />
          <TextInput style={buttonStyle} accessibilityLabel="Nueva hora del partido" placeholder="Nueva hora HH:MM" editable={!locked} value={time} onChangeText={setTime} />
        </> : <>
          <Text>Causa de la suspensión</Text>
          {[{ value: 'weather', label: 'Clima' }, { value: 'force-majeure', label: 'Fuerza mayor' }].map(choice =>
            <Pressable key={choice.value} accessibilityRole="radio" accessibilityState={{ checked: cause === choice.value }} disabled={locked}
              style={buttonStyle} onPress={() => setCause(choice.value)}><Text>{cause === choice.value ? '✓ ' : ''}{choice.label}</Text></Pressable>)}
          <TextInput style={buttonStyle} accessibilityLabel="Motivo de la suspensión" placeholder="Motivo de la suspensión" multiline maxLength={2000}
            editable={!locked} value={reason} onChangeText={setReason} />
          {started ? <>
            <Text>¿Conservar o reiniciar el juego?</Text>
            {[{ value: 'keep', label: 'Conservar marcador, jugadas y estadísticas' }, { value: 'reset', label: 'Reiniciar marcador, entradas, cuenta, bases y estadísticas' }].map(choice =>
              <Pressable key={choice.value} style={buttonStyle} accessibilityRole="radio" accessibilityState={{ checked: mode === choice.value }}
                disabled={locked} onPress={() => setMode(choice.value)}><Text>{mode === choice.value ? '✓ ' : ''}{choice.label}</Text></Pressable>)}
          </> : null}
          <Text>La nueva fecha queda pendiente. Se archiva la anotación anterior y no se concede victoria o derrota.</Text>
        </>}
        <Pressable style={buttonStyle} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} disabled={locked} onPress={() => setConfirmed(v => !v)}>
          <Text>{confirmed ? '✓ ' : ''}Confirmo la decisión y su registro</Text>
        </Pressable>
        <Pressable style={buttonStyle} accessibilityRole="button" disabled={locked} onPress={() => { void submit(); }}>
          <Text>{busy ? 'Guardando…' : reprogramming ? 'Guardar nueva fecha' : 'Confirmar suspensión'}</Text>
        </Pressable>
      </> : null}
    </> : null}
  </View>;
}
