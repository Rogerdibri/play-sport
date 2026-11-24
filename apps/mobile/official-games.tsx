import { sportsTheme } from '@playsport/shared';
import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { activeAssignedGame, currentAssignedGame, assignedGameExamples, assignedGameSections, calendarDateLabel, officialGameStatusLabels, preservesStartedGame, readOfficialGames,
  type AssignedGameExample, type OfficialGameSummary, type OfficialGamesSnapshot } from '@playsport/shared';
import type { ReactNode } from 'react';
import OfficialResult from './official-result';

export default function OfficialGames({ apiBase, role, onSelect, disabled, onBusy, liveEntry = false, preferredId, onOpenAssignments, managerId, managerTeam }: {
  apiBase: string; role: 'organizer' | 'scorekeeper' | 'manager'; disabled: boolean; managerId?: string;
  managerTeam?: { teamId: string; tournamentId: string };
  liveEntry?: boolean; preferredId: string;
  onSelect: (_game: OfficialGameSummary) => void; onBusy: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
  onOpenAssignments: () => void;
}) {
  const singleLive = liveEntry && role === 'scorekeeper';
  const userId = role === 'manager' ? managerId ?? '' : role === 'organizer' ? 'org-demo' : 'scorer-demo';
  const [catalog, setCatalog] = useState<OfficialGamesSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [entryHandled, setEntryHandled] = useState(false);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      try {
        const response = await fetch(`${apiBase}/games?${new URLSearchParams({ userId, role })}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudieron consultar tus partidos.');
        const next = readOfficialGames(body, userId, role);
        if (role === 'manager') {
          if (!managerTeam) throw new Error('Selecciona tu equipo desde el inicio del manager.');
          next.games = next.games.filter(game => game.managerTeamId === managerTeam.teamId && game.tournamentId === managerTeam.tournamentId);
        }
        if (active && request === revision) { setCatalog(next); setError(''); }
      } catch (failure) { if (active && request === revision) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar tus partidos.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [apiBase, userId, role, retry, managerTeam?.teamId, managerTeam?.tournamentId]);
  useEffect(() => {
    if (!liveEntry || entryHandled || !catalog || error || disabled) return;
    if (singleLive) {
      const current = currentAssignedGame(catalog.games).game;
      if (current?.status === 'in_progress') onSelect(current);
      return;
    }
    setEntryHandled(true);
    const game = activeAssignedGame(catalog.games, preferredId);
    if (game) onSelect(game);
    else setNotice('No hay un único partido activo para abrir. Selecciona uno de tus partidos asignados.');
  }, [singleLive, liveEntry, entryHandled, catalog, error, disabled, preferredId, onSelect]);
  const assign = async (game: OfficialGameSummary) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`${apiBase}/games/${encodeURIComponent(game.gameId)}/authorization`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: game.tournamentId, organizerId: userId, scorekeeperIds: choices[game.gameId] ?? game.assignedScorekeeperIds })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'No se pudo guardar la asignación.');
      setChoices(previous => { const next = { ...previous }; delete next[game.gameId]; return next; });
      setNotice('Asignación guardada.'); setRetry(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar la asignación.'); }
    finally { setBusy(false); }
  };
  const current = singleLive && catalog && !error ? currentAssignedGame(catalog.games) : null;
  const currentGame = current?.game;
  if (singleLive) return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>TU PARTIDO · ANOTADOR</Text>
      <Text accessibilityRole="header" style={styles.heroTitle}>Pizarra en vivo</Text>
      <Pressable accessibilityRole="button" disabled={disabled || busy} style={styles.button} onPress={() => setRetry(value => value + 1)}>
        <Text>Actualizar</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={disabled || busy} style={styles.button} onPress={onOpenAssignments}>
        <Text>Mis partidos asignados</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert">{error} Puedes volver a actualizar.</Text> : null}
    {!catalog && !error ? <Text>Consultando tu partido actual…</Text> : null}
    {current ? currentGame ? <GameCard game={currentGame}>
      <Pressable accessibilityRole="button" disabled={disabled || busy} style={styles.primaryButton} onPress={() => onSelect(currentGame)}>
        <Text style={styles.primaryText}>{currentGame.status === 'in_progress' ? 'Continuar anotación' : preservesStartedGame(currentGame.suspension) ? 'Retomar anotación' : 'Comenzar anotación'}</Text>
      </Pressable>
    </GameCard> : <Text>{current.message}</Text> : null}
  </ScrollView>;
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.hero}>
      <Text style={styles.eyebrow}>TU JORNADA · {role === 'manager' ? 'MANAGER' : role === 'scorekeeper' ? 'ANOTADOR' : 'ORGANIZADOR'}</Text>
      <Text accessibilityRole="header" style={styles.heroTitle}>{role !== 'organizer' ? 'Mis partidos asignados' : 'Partidos y anotadores'}</Text>
      <Text style={styles.heroBody}>{role === 'manager' ? 'Los partidos de tu equipo: lineup, solicitudes de personal y consulta de resultados, sin anotar jugadas.' :
        role === 'scorekeeper' ? 'Cada encuentro, en su lugar. Elige tu partido y abre su pizarra en vivo.' : 'Organiza las asignaciones de tu jornada.'}</Text>
      <Pressable accessibilityRole="button" disabled={busy || disabled} style={styles.button} onPress={() => setRetry(value => value + 1)}><Text>Actualizar partidos</Text></Pressable>
    </View>
    {error ? <Text accessibilityRole="alert">{error} Puedes volver a actualizar la lista.</Text> : null}
    {notice ? <Text>{notice}</Text> : null}
    {!catalog && !error ? <Text>Consultando partidos…</Text> : null}
    {!error && catalog ? <>
      <Text accessibilityRole="header" style={styles.title}>Partidos oficiales</Text>
      <View style={styles.metrics}>{assignedGameSections.map(section => <View style={styles.metric} key={section.status}>
        <Text style={styles.metricCount}>{catalog.games.filter(game => game.status === section.status).length}</Text><Text style={styles.small}>{section.title}</Text>
      </View>)}</View>
      {!catalog.games.length ? <View style={styles.card}><Text>{role === 'manager' ? 'No hay partidos asignados a tu equipo.' :
        role === 'scorekeeper' ? 'No tienes partidos asignados.' : 'No hay partidos configurados para tus torneos.'}</Text>
        </View> : null}
      {assignedGameSections.map(section => {
        const games = catalog.games.filter(game => game.status === section.status);
        return games.length ? <View style={styles.group} key={section.status}>
          <Text accessibilityRole="header" style={styles.groupTitle}>{role === 'organizer' && section.status === 'protested' ? 'Mesa técnica · Protestas pendientes' : section.title}</Text>
          {games.map(game => <GameCard key={game.gameId} game={game}>
            <Pressable accessibilityRole="button" disabled={disabled || busy} style={styles.primaryButton} onPress={() => onSelect(game)}>
              <Text style={styles.primaryText}>{role === 'manager' ? ['scheduled', 'in_progress'].includes(game.status) ? 'Preparar lineup y gestionar equipo' : 'Consultar partido y resultado' :
                game.status === 'suspended' ? role === 'organizer' ? 'Reprogramar partido' : 'Consultar suspensión' :
                game.status === 'final' ? 'Ver resumen' : game.status === 'protested' ? role === 'organizer' ? 'Registrar decisión de mesa técnica' : 'Consultar protesta' :
                game.scoringBlockReason ? 'Consultar partido' : game.status === 'in_progress' ? 'Continuar anotación' :
                  preservesStartedGame(game.suspension) ? 'Retomar anotación' : 'Iniciar anotación'}</Text>
            </Pressable>
            {game.scoringBlockReason ? <Text accessibilityRole="alert">{game.scoringBlockReason}</Text> : null}
            {role === 'organizer' ? <>
              <Text>Anotadores asignados</Text>
              {!game.availableScorekeeperIds.length ? <Text>No hay anotadores autorizados en este torneo.</Text> : game.availableScorekeeperIds.map(id => {
                const ids = choices[game.gameId] ?? game.assignedScorekeeperIds;
                return <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked: ids.includes(id) }}
                  disabled={busy || game.status === 'final'} style={styles.button} onPress={() => {
                    setChoices(previous => ({ ...previous, [game.gameId]: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] })); setNotice('');
                  }}><Text>{ids.includes(id) ? '✓ ' : ''}{id === 'scorer-demo' ? 'Anotador' : id}</Text></Pressable>;
              })}
              <Text>Dejar la selección vacía retira las asignaciones, no las anotaciones.</Text>
              <Pressable accessibilityRole="button" disabled={busy || game.status === 'final' || !game.availableScorekeeperIds.length}
                style={styles.button} onPress={() => { void assign(game); }}><Text>Guardar asignación</Text></Pressable>
            </> : null}
          </GameCard>)}
        </View> : null;
      })}
    </> : null}
    {role !== 'manager' ? <View style={styles.examples}>
      <Text style={styles.eyebrowDark}>SOLO LECTURA</Text>
      <Text accessibilityRole="header" style={styles.title}>Otros partidos</Text>
      {assignedGameSections.filter(section => assignedGameExamples.some(game => game.status === section.status)).map(section => <View style={styles.group} key={section.status}>
        <Text accessibilityRole="header" style={styles.groupTitle}>{section.title}</Text>
        {assignedGameExamples.filter(game => game.status === section.status).map(game => <GameCard key={game.exampleId} game={game}>
          <ExampleDetails game={game} />
        </GameCard>)}
      </View>)}
    </View> : null}
  </ScrollView>;
}

function GameCard({ game, children }: { game: OfficialGameSummary | AssignedGameExample; children: ReactNode }) {
  const example = 'exampleId' in game;
  const away = example ? game.details.awayTeamName : game.details?.awayTeamName ?? game.awayTeamId;
  const home = example ? game.details.homeTeamName : game.details?.homeTeamName ?? game.homeTeamId;
  const showsScore = game.status !== 'scheduled' || !example && preservesStartedGame(game.suspension);
  return <View style={[styles.card, game.status === 'in_progress' && styles.liveCard]}>
    <View style={styles.cardTop}><Text style={[styles.badge, game.status === 'in_progress' ? styles.liveBadge : game.status === 'scheduled' ? styles.scheduledBadge : styles.finalBadge]}>{officialGameStatusLabels[game.status]}</Text>
      <Text style={styles.small}>{example ? 'EJEMPLO · SOLO LECTURA' : 'ASIGNACIÓN OFICIAL'}</Text></View>
    <Text style={styles.muted}>{example ? game.details.tournamentName : game.details?.tournamentName ?? game.tournamentId}</Text>
    {!example ? <OfficialResult game={game} /> : null}
    {[{ name: away, side: 'Visitante', score: game.awayScore }, { name: home, side: 'Local', score: game.homeScore }].map(team => <View style={styles.teamRow} key={team.side}>
      <View style={styles.teamMark}><Text style={styles.teamInitials}>{team.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</Text></View>
      <View style={styles.teamName}><Text style={styles.team}>{team.name}</Text><Text style={styles.small}>{team.side}</Text></View>
      <Text style={styles.score}>{showsScore ? team.score : '—'}</Text>
    </View>)}
    {example && game.innings ? <Text style={styles.progress}>{game.status === 'in_progress' ? `Entrada ${game.innings}` : `Final · ${game.innings} entradas`}</Text> : null}
    {game.details ? <View style={styles.meta}><Text style={styles.muted}>{game.status === 'suspended' ? 'Nueva fecha pendiente · Fecha original: ' : ''}{calendarDateLabel(game.details.date)} · {game.details.time}</Text><Text>{game.details.venue}</Text></View> :
      <Text>Fecha, hora y estadio pendientes de configurar por el organizador.</Text>}
    {children}
  </View>;
}

function ExampleDetails({ game }: { game: AssignedGameExample }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.button} onPress={() => setExpanded(value => !value)}>
      <Text>{expanded ? 'Cerrar detalle' : 'Ver detalle'}</Text>
    </Pressable>
    {expanded ? <View style={styles.preview}>
      <Text accessibilityRole="header" style={styles.groupTitle}>Ficha del partido · Solo lectura</Text>
      <Text>{game.details.tournamentName}</Text>
      <Text>{game.details.awayTeamName} vs. {game.details.homeTeamName}</Text>
      <Text>{game.status === 'scheduled' ? 'La anotación oficial requiere una asignación y los dos lineups entregados.' :
        `${game.awayScore}–${game.homeScore} · ${game.status === 'final' ? 'Finalizado' : `Entrada ${game.innings}`}`}</Text>
    </View> : null}
  </>;
}
const styles = StyleSheet.create({
  content: { padding: 18, gap: 20 },
  hero: { padding: 20, borderRadius: 20, backgroundColor: sportsTheme.ink, gap: 14 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: sportsTheme.mutedOnDark },
  eyebrowDark: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: sportsTheme.text },
  heroTitle: { fontSize: 26, lineHeight: 31, fontWeight: '700', color: sportsTheme.onDark },
  heroBody: { color: sportsTheme.mutedOnDark, lineHeight: 22 },
  title: { fontSize: 22, fontWeight: '700', color: sportsTheme.text },
  groupTitle: { fontSize: 17, fontWeight: '700', color: sportsTheme.text },
  group: { gap: 12 },
  team: { fontSize: 16, fontWeight: '700', color: sportsTheme.text },
  muted: { color: sportsTheme.muted, lineHeight: 21 },
  small: { fontSize: 10, color: sportsTheme.muted },
  cardTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, fontSize: 11, fontWeight: '700' },
  liveBadge: { backgroundColor: sportsTheme.accent, color: sportsTheme.onDark },
  scheduledBadge: { backgroundColor: '#fff1d7', color: '#845207' },
  finalBadge: { backgroundColor: '#edf1f5', color: sportsTheme.muted },
  button: { borderWidth: 1, borderColor: sportsTheme.border, padding: 12, borderRadius: 10, backgroundColor: sportsTheme.surface },
  primaryButton: { backgroundColor: sportsTheme.accent, padding: 14, borderRadius: 10, alignItems: 'center' },
  primaryText: { color: sportsTheme.onDark, fontWeight: '700' },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: sportsTheme.border, backgroundColor: sportsTheme.surface, gap: 14 },
  liveCard: { borderTopWidth: 4, borderTopColor: sportsTheme.accent },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamName: { flex: 1, minWidth: 0, gap: 4 },
  teamMark: { width: 34, height: 34, backgroundColor: sportsTheme.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  teamInitials: { fontSize: 11, fontWeight: '700', color: sportsTheme.text },
  score: { fontSize: 28, fontWeight: '800', color: sportsTheme.text },
  progress: { fontSize: 12, fontWeight: '700', color: '#13704f' },
  meta: { borderTopWidth: 1, borderTopColor: sportsTheme.border, paddingTop: 12, gap: 6 },
  metrics: { flexDirection: 'row', borderRadius: 14, backgroundColor: sportsTheme.surface, padding: 14 },
  metric: { flex: 1, alignItems: 'center', gap: 5 },
  metricCount: { fontSize: 24, fontWeight: '800', color: sportsTheme.accent },
  examples: { backgroundColor: sportsTheme.surfaceAlt, padding: 14, borderRadius: 20, gap: 16 },
  preview: { padding: 12, borderRadius: 10, backgroundColor: sportsTheme.surfaceAlt, gap: 10 }
});
