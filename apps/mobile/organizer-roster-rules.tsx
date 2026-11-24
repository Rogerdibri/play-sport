import { sportsTheme } from '@playsport/shared';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RosterRulesClient, rosterGroups, rosterRulesDraft, rulesFromDraft, type RosterRulesView } from '@playsport/shared';

const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudieron actualizar las reglas del roster.';
export default function OrganizerRosterRules({ apiBase, organizerId, disabled, onBusy, onGames }: {
  apiBase: string; organizerId: string; disabled: boolean;
  onBusy: (_busy: boolean) => void; onGames: () => void; // eslint-disable-line no-unused-vars
}) {
  const client = useMemo(() => new RosterRulesClient(apiBase, organizerId), [apiBase, organizerId]);
  const [tournaments, setTournaments] = useState<{ tournamentId: string; tournamentName: string }[] | null>(null);
  const [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void client.tournaments().then(value => { if (active) setTournaments(value); }).catch(failure => { if (active) setError(message(failure)); });
    return () => { active = false; };
  }, [client, attempt]);
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>Centro del organizador · Reglas del roster</Text>
    <Text>Cupos por equipo y un único cierre simultáneo para todo el torneo.</Text>
    <Text>Configura aquí tus torneos asignados, incluso sin partidos. La creación completa está disponible en la web.</Text>
    <Pressable disabled={disabled} style={styles.button} onPress={onGames}><Text>Abrir herramientas oficiales de partidos</Text></Pressable>
    {error ? <><Text accessibilityRole="alert">{error}</Text><Pressable disabled={disabled} onPress={() => setAttempt(value => value + 1)} style={styles.button}><Text>Reintentar</Text></Pressable></> : null}
    {!tournaments && !error ? <Text>Consultando tus torneos…</Text> : null}
    {tournaments?.length === 0 ? <Text>No tienes torneos configurados en esta API.</Text> : null}
    {tournaments?.map(row => <Pressable key={row.tournamentId} disabled={disabled} style={styles.button} accessibilityRole="radio"
      accessibilityState={{ checked: selected === row.tournamentId }} onPress={() => setSelected(row.tournamentId)}>
      <Text>{selected === row.tournamentId ? '✓ ' : ''}{row.tournamentName}</Text>
    </Pressable>)}
    {selected ? <RulesEditor key={selected} client={client} tournamentId={selected} disabled={disabled} onBusy={onBusy} /> : null}
  </ScrollView>;
}

export function RulesEditor({ client, tournamentId, disabled, onBusy }: {
  client: RosterRulesClient; tournamentId: string; disabled: boolean; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const [view, setView] = useState<RosterRulesView | null>(null), [draft, setDraft] = useState(() => rosterRulesDraft(null));
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(true), [reopen, setReopen] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => { onBusy(working); return () => onBusy(false); }, [working, onBusy]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void client.load(tournamentId).then(value => { if (active) { setView(value); setDraft(rosterRulesDraft(value.rules)); setReopen(false); } })
      .catch(failure => { if (active) setError(message(failure)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, tournamentId, attempt]);
  const blocked = disabled || working || loading;
  const save = async () => {
    if (!view) return;
    setWorking(true); setError(''); setNotice('');
    try {
      const value = await client.save(tournamentId, rulesFromDraft(draft), view.revision, reopen);
      setView(value); setDraft(rosterRulesDraft(value.rules)); setReopen(false);
      setNotice('Reglas guardadas para todos los equipos. No se modificó ningún partido ni lineup.');
    } catch (failure) { setError(message(failure)); } finally { setWorking(false); }
  };
  return <View style={styles.content}>
    <Text style={styles.heading}>Reglamento de incorporaciones</Text>
    {loading ? <Text>Consultando reglas…</Text> : null}
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}{notice ? <Text>{notice}</Text> : null}
    {view ? <><Text>{view.closed ? 'INCORPORACIONES CERRADAS. ' : 'Incorporaciones abiertas. '}{view.reason}</Text>
      <Text>Revisión {view.revision}. Los cupos incluyen las preinscripciones. No se elimina a nadie al reducir un cupo.</Text></> : null}
    <Pressable disabled={blocked} style={styles.button} onPress={() => { setNotice(''); setAttempt(value => value + 1); }}><Text>Recargar reglas y descartar cambios sin guardar</Text></Pressable>
    {view ? <>
      <Text style={styles.heading}>Cupos de personas por equipo</Text>
      {rosterGroups.map(group => <View key={group.id}><Text>{group.title}</Text><TextInput accessibilityLabel={`Cupo · ${group.title}`} editable={!blocked}
        keyboardType="number-pad" style={styles.input} value={draft.caps[group.id]} onChangeText={value => setDraft({ ...draft, caps: { ...draft.caps, [group.id]: value } })} /></View>)}
      <Text style={styles.heading}>Una sola modalidad de cierre</Text>
      {(['date', 'round', 'games'] as const).map(kind => <Pressable key={kind} disabled={blocked} style={styles.button} accessibilityRole="radio"
        accessibilityState={{ checked: draft.kind === kind }} onPress={() => setDraft({ ...draft, kind })}>
        <Text>{draft.kind === kind ? '✓ ' : ''}{kind === 'date' ? 'Fecha tope' : kind === 'round' ? 'Jornada / ronda tope' : 'Cantidad de juegos finalizados'}</Text>
      </Pressable>)}
      {draft.kind === 'date' ? <><Text>Último día para incorporar · Venezuela (UTC−4)</Text><TextInput editable={!blocked} accessibilityLabel="Fecha tope"
        placeholder="AAAA-MM-DD" value={draft.date} style={styles.input} onChangeText={date => setDraft({ ...draft, date })} /></> : null}
      {draft.kind === 'games' ? <>
        <Text>Cantidad de juegos finalizados tope</Text><TextInput editable={!blocked} keyboardType="number-pad" accessibilityLabel="Juegos tope"
          style={styles.input} value={draft.games} onChangeText={games => setDraft({ ...draft, games })} />
        <Text>Cómo se calcula el cierre para todos</Text>
        {(['tournament', 'first-team', 'all-teams'] as const).map(count => <Pressable key={count} disabled={blocked} style={styles.button}
          accessibilityRole="radio" accessibilityState={{ checked: draft.count === count }} onPress={() => setDraft({ ...draft, count })}>
          <Text>{draft.count === count ? '✓ ' : ''}{count === 'tournament' ? 'Total de partidos finalizados del torneo' : count === 'first-team' ? 'Cuando el primer equipo llegue al tope' : 'Cuando todos los equipos lleguen al tope'}</Text>
        </Pressable>)}
        <Text>Solo cuentan juegos finalizados. Suspendidos y bajo protesta no cuentan como finalizados.</Text>
      </> : null}
      {draft.kind === 'round' ? <>
        <Text>Jornada / ronda tope</Text><TextInput editable={!blocked} keyboardType="number-pad" accessibilityLabel="Ronda tope" style={styles.input}
          value={draft.round} onChangeText={round => setDraft({ ...draft, round })} />
        {(['start', 'finish'] as const).map(moment => <Pressable key={moment} disabled={blocked} style={styles.button} accessibilityRole="radio"
          accessibilityState={{ checked: draft.moment === moment }} onPress={() => setDraft({ ...draft, moment })}>
          <Text>{draft.moment === moment ? '✓ ' : ''}{moment === 'start' ? 'Al comenzar la ronda tope' : 'Al finalizar todos los partidos hasta la ronda tope'}</Text>
        </Pressable>)}
        <Text>Asigna ronda a cada partido. Si falta alguna, se bloquean incorporaciones hasta completarla. Una ronda posterior iniciada cierra el plazo de una ronda anterior.</Text>
        {view.games.map(game => <View key={game.gameId}><Text>Ronda · {game.label} · {game.gameId}</Text><TextInput editable={!blocked}
          keyboardType="number-pad" accessibilityLabel={`Ronda · ${game.gameId}`} style={styles.input} value={draft.rounds[game.gameId] ?? ''}
          onChangeText={value => setDraft({ ...draft, rounds: { ...draft.rounds, [game.gameId]: value } })} /></View>)}
        {!view.games.length ? <Text>No hay partidos todavía. Cuando se incorporen, deberás asignarles ronda aquí.</Text> : null}
      </> : null}
      {view.closed ? <Pressable disabled={blocked} style={styles.button} accessibilityRole="checkbox" accessibilityState={{ checked: reopen }} onPress={() => setReopen(value => !value)}>
        <Text>{reopen ? '✓ ' : ''}Reabrir explícitamente para todos con estas nuevas reglas</Text>
      </Pressable> : null}
      <Text>El cierre queda guardado. Deshacer resultados o reprogramar no reabre el roster. Una reapertura solo funciona si el nuevo tope todavía no se alcanzó.</Text>
      <Pressable disabled={blocked} style={styles.button} onPress={() => { void save(); }}><Text>Guardar reglas del roster</Text></Pressable>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 }, heading: { fontSize: 22, fontWeight: '700' },
  button: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8 },
  input: { borderWidth: 1, borderColor: sportsTheme.muted, padding: 12, borderRadius: 8, backgroundColor: sportsTheme.surface, color: sportsTheme.text }
});
