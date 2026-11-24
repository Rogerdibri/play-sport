import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isGameProtest, isOfficialGameStatus, type GameProtest, type OfficialGameStatus, type OfficialGameSummary } from '@playsport/shared';

type Snapshot = { status: OfficialGameStatus; officialVersion: number; protest?: GameProtest };
function read(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || !('state' in value) || !value.state || typeof value.state !== 'object' ||
      !('status' in value.state) || !isOfficialGameStatus(value.state.status) ||
      !('officialVersion' in value.state) || typeof value.state.officialVersion !== 'number' || !Number.isSafeInteger(value.state.officialVersion) ||
      'protest' in value.state && value.state.protest !== undefined && !isGameProtest(value.state.protest)) {
    throw new Error('El estado de protesta contiene datos inválidos.');
  }
  return { status: value.state.status, officialVersion: value.state.officialVersion,
    ...('protest' in value.state && isGameProtest(value.state.protest) ? { protest: value.state.protest } : {}) };
}
export default function GameProtestPanel({ apiBase, game, role, actorId, disabled, onBusy, onState }: {
  apiBase: string; game: OfficialGameSummary; role: 'organizer' | 'scorekeeper'; actorId: string; disabled: boolean;
  onBusy: (_busy: boolean) => void; onState: (_state: Snapshot) => void; // eslint-disable-line no-unused-vars
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const callbacks = useRef({ onBusy, onState });
  const latest = useRef<Snapshot | null>(null);
  callbacks.current = { onBusy, onState };
  const accept = (next: Snapshot) => {
    if (latest.current && next.officialVersion < latest.current.officialVersion) return;
    latest.current = next;
    setSnapshot(next);
    callbacks.current.onState(next);
  };
  const path = `${apiBase}/games/${encodeURIComponent(game.gameId)}`;
  useEffect(() => { callbacks.current.onBusy(busy); return () => callbacks.current.onBusy(false); }, [busy]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`${path}/state?tournamentId=${encodeURIComponent(game.tournamentId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar la protesta.');
        const next = read(await response.json());
        if (active && request === revision) { accept(next); setError(''); }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la protesta.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [path, game.tournamentId]);
  const protest = snapshot?.protest;
  const deciding = role === 'organizer' && snapshot?.status === 'protested';
  const declaring = role === 'scorekeeper' && snapshot?.status === 'in_progress' && !protest;
  const names: Record<string, string> = { [game.homeTeamId]: game.details?.homeTeamName ?? game.homeTeamId, [game.awayTeamId]: game.details?.awayTeamName ?? game.awayTeamId };
  const submit = async () => {
    if (!snapshot) { setError('Carga el estado actual antes de registrar la protesta.'); return; }
    if (!confirmed || !teamId || !reason.trim() || deciding && !reference.trim()) {
      setError('Selecciona el equipo, completa el motivo y confirma el registro. La decisión también requiere un acta.'); return;
    }
    setBusy(true); setError('');
    try {
      const response = await fetch(`${path}/protest${deciding ? '/decision' : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deciding ? { tournamentId: game.tournamentId, organizerId: actorId,
          expectedOfficialVersion: snapshot.officialVersion, winnerTeamId: teamId, reason, recordReference: reference } :
          { tournamentId: game.tournamentId, actorId, actorRole: role, expectedOfficialVersion: snapshot.officialVersion, teamId, reason })
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo registrar la protesta o la decisión.');
      const next = read(value);
      accept(next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo registrar la protesta o la decisión.'); }
    finally { setBusy(false); }
  };
  if (!snapshot && !error) return <Text>Consultando estado de protesta…</Text>;
  return <View style={{ gap: 12, padding: 16, backgroundColor: sportsTheme.surface, borderRadius: 12 }}>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {protest ? <>
      <Text accessibilityRole="header">{protest.resolution ? 'Resultado determinado por mesa técnica' : 'Bajo protesta · Pendiente de mesa técnica'}</Text>
      <Text>{names[protest.teamId]} · {protest.reason}</Text>
      <Text>Entrada {protest.moment.inning} · {protest.moment.outs} outs · Cuenta {protest.moment.balls}–{protest.moment.strikes} ·
        Marcador registrado {protest.moment.awayScore}–{protest.moment.homeScore}</Text>
      {protest.resolution ? <><Text>Ganador: {names[protest.resolution.winnerTeamId]} · Perdedor: {names[protest.resolution.loserTeamId]}</Text>
        <Text>Fundamento: {protest.resolution.reason}</Text><Text>Acta: {protest.resolution.recordReference}</Text>
        <Text>Registrado por {protest.resolution.recordedBy} · {protest.resolution.recordedAt}</Text></> :
        <Text>Anotación pausada. No suma victoria ni derrota. El anotador puede atender otro partido.</Text>}
      <Text>Se conservan las carreras y estadísticas originales.</Text>
    </> : declaring ? <Pressable style={styles.control} accessibilityRole="button" disabled={disabled || busy} onPress={() => setExpanded(value => !value)}>
      <Text>Juego bajo protesta</Text></Pressable> : null}
    {deciding || declaring && expanded ? <>
      <Text accessibilityRole="header">{deciding ? 'Mesa técnica · Registrar resolución' : 'Registrar juego bajo protesta'}</Text>
      <Text>{deciding ? 'Ganador según el acta' : 'Equipo que presenta la protesta'}</Text>
      {Object.entries(names).map(([id, name]) => <Pressable style={styles.control} key={id} accessibilityRole="radio" accessibilityState={{ checked: teamId === id }}
        disabled={disabled || busy} onPress={() => setTeamId(id)}><Text>{teamId === id ? '✓ ' : ''}{name}</Text></Pressable>)}
      {deciding && teamId ? <Text>Perdedor: {Object.entries(names).find(([id]) => id !== teamId)?.[1]}</Text> : null}
      <TextInput style={styles.control} accessibilityLabel={deciding ? 'Fundamento de la decisión' : 'Motivo de la protesta'} multiline
        placeholder={deciding ? 'Fundamento de la decisión' : 'Motivo de la protesta'} maxLength={deciding ? 4000 : 2000}
        editable={!disabled && !busy} value={reason} onChangeText={setReason} />
      {deciding ? <TextInput style={styles.control} accessibilityLabel="Referencia del acta de mesa técnica" placeholder="Referencia del acta de mesa técnica"
        maxLength={500} editable={!disabled && !busy} value={reference} onChangeText={setReference} /> : null}
      <Pressable style={styles.control} accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} disabled={disabled || busy} onPress={() => setConfirmed(value => !value)}>
        <Text>{confirmed ? '✓ ' : ''}{deciding ? 'Confirmo que transcribo el acta de mesa técnica; no es una decisión unilateral.' :
          'Confirmo que el juego quedará pausado y no permitirá más jugadas.'}</Text></Pressable>
      <Pressable style={styles.control} accessibilityRole="button" disabled={disabled || busy} onPress={() => { void submit(); }}>
        <Text>{busy ? 'Guardando…' : deciding ? 'Registrar decisión de mesa técnica' : 'Confirmar juego bajo protesta'}</Text>
      </Pressable>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  control: { minHeight: 44, padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 }
});
