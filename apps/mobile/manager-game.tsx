import { sportsTheme } from '@playsport/shared';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { availablePersonnelPositions, managerPersonnelAction, readOfficialObservation, readTeamSheets, presentOfficialRoleLabels, isPresentOfficialRole, type ManagerPersonnelFields, type OfficialGameSummary, type OfficialObservation,
  type PersonnelAction, type TeamSheetsSnapshot } from '@playsport/shared';
import PublicOfficialGames from './public-official-games';
import GameClockDisplay, { readGameClockOffset } from './game-clock';
export { managerPersonnelAction };
const personnelLabels: Record<PersonnelAction['kind'], string> = {
  arrival: 'Llegada de jugador', substitution: 'Sustitución', defense: 'Cambio defensivo', courtesy: 'Corredor de cortesía',
  'staff-arrival': 'Llegada de directivo', 'staff-departure': 'Salida de directivo'
};
export default function ManagerGame({ apiBase, game, managerId, disabled, onBusy, onBack, onPrepare }: {
  apiBase: string; game: OfficialGameSummary; managerId: string; disabled: boolean; onBack: () => void;
  onBusy: (_busy: boolean) => void; onPrepare: (_game: OfficialGameSummary) => void; // eslint-disable-line no-unused-vars
}) {
  const [data, setData] = useState<{ observation: OfficialObservation; sheets: TeamSheetsSnapshot; clockOffsetMs: number } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [publicView, setPublicView] = useState(false);
  const [kind, setKind] = useState<PersonnelAction['kind']>('arrival');
  const [fields, setFields] = useState<ManagerPersonnelFields>({ player: '', outgoing: '', position: 'P', jersey: '', base: 1, name: '', role: 'DIRIGENTE' });
  const latest = useRef(-1), sending = useRef(false), callbacks = useRef(onBusy);
  callbacks.current = onBusy;
  const path = `${apiBase}/games/${encodeURIComponent(game.gameId)}`;
  const accept = (value: unknown) => {
    const sheets = readTeamSheets(value);
    if (sheets.gameId !== game.gameId || sheets.tournamentId !== game.tournamentId || sheets.ownTeamId !== game.managerTeamId) {
      throw new Error('La entrega no corresponde al partido y equipo de este manager.');
    }
    return sheets;
  };
  useEffect(() => { callbacks.current(busy); return () => callbacks.current(false); }, [busy]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const responses = await Promise.all([
          fetch(`${path}/state?tournamentId=${encodeURIComponent(game.tournamentId)}`, { signal: controller.signal }),
          fetch(`${path}/team-sheets?${new URLSearchParams({ tournamentId: game.tournamentId, userId: managerId, role: 'manager' })}`, { signal: controller.signal })
        ]);
        if (responses.some(response => !response.ok)) throw new Error('No se pudo consultar el partido asignado a tu equipo.');
        const [state, value]: unknown[] = await Promise.all(responses.map(response => response.json()));
        const observation = readOfficialObservation(state), sheets = accept(value);
        if (active && observation.officialVersion >= latest.current) {
          const clockOffsetMs = readGameClockOffset(state);
          latest.current = observation.officialVersion; setData({ observation, sheets, clockOffsetMs }); setError('');
        }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar tu partido.'); }
    };
    void load();
    const interval = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 5000);
    return () => { active = false; controller.abort(); clearInterval(interval); };
  }, [path, game.tournamentId, game.managerTeamId, managerId]);
  const sheet = data?.sheets.sheets.find(row => row.teamId === game.managerTeamId);
  const open = data && ['scheduled', 'in_progress'].includes(data.observation.status);
  const submit = async () => {
    if (sending.current) return;
    if (!sheet || !open) { setError('Este partido no admite solicitudes de personal.'); return; }
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const action = managerPersonnelAction(kind, fields);
      if ((action.kind === 'substitution' || action.kind === 'defense') && !availablePersonnelPositions(
        sheet, action.kind === 'defense' ? action.identificationNumber : action.outgoingIdentificationNumber, action.kind === 'defense'
      ).includes(action.fieldPosition)) throw new Error('Selecciona una posición que conserve la cantidad de defensores del lineup enviado.');
      const response = await fetch(`${path}/team-sheets/${encodeURIComponent(sheet.teamId)}/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId: game.tournamentId, managerId, expectedRevision: sheet.revision, action })
      });
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo registrar la solicitud de personal.');
      const sheets = accept(value); setData(previous => previous ? { ...previous, sheets } : null);
      setNotice('Solicitud enviada. El organizador o anotador debe confirmarla; todavía no modifica el lineup.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo enviar la solicitud.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const control = { minHeight: 44, padding: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 };
  const input = (key: 'player' | 'outgoing' | 'position' | 'jersey' | 'name', label: string) =>
    <TextInput style={control} accessibilityLabel={label} placeholder={label} value={fields[key]} editable={!disabled && !busy}
      onChangeText={value => setFields(previous => ({ ...previous, [key]: value }))} />;
  if (publicView) return <PublicOfficialGames apiBase={apiBase} gameId={game.gameId} onSelect={() => {}} onBack={() => setPublicView(false)} />;
  return <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
    <Pressable style={control} accessibilityRole="button" disabled={disabled || busy} onPress={onBack}><Text>Volver a mis partidos asignados</Text></Pressable>
    <Text accessibilityRole="header">{game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}</Text>
    <Pressable style={control} accessibilityRole="button" disabled={disabled || busy} onPress={() => setPublicView(true)}><Text>Consultar partido y resultado · Solo lectura</Text></Pressable>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    {notice ? <Text>{notice}</Text> : null}
    {data ? <GameClockDisplay clock={data.observation.scorecard.clock} finished={data.observation.status === 'final'} offsetMs={data.clockOffsetMs} /> : null}
    {!data && !error ? <Text>Consultando lineup y solicitudes…</Text> : null}
    {data ? <View style={{ gap: 12 }}>
      {!open ? <Text>El partido está cerrado o suspendido. El lineup y los movimientos son de solo lectura.</Text> : !sheet ?
        <Pressable style={control} accessibilityRole="button" disabled={disabled || busy} onPress={() => onPrepare(game)}><Text>Preparar y entregar lineup de este partido</Text></Pressable> : null}
      {sheet ? <>
        <Text accessibilityRole="header">Lineup de mi equipo · Orden al bate fijo</Text>
        <Text>La entrega fija la cantidad de titulares y defensores. Los suplentes reemplazan jugadores sin agregar turnos ni defensores.</Text>
        {sheet.lineup.map(player => <Text key={player.identificationNumber}>{player.battingOrder ?? 'FLEX'}. {player.displayName} · #{player.jerseyNumber} · {player.fieldPosition}</Text>)}
        {open ? <>
          <Text accessibilityRole="header">Solicitar movimiento de personal</Text>
          {(['arrival','substitution','defense','courtesy','staff-arrival','staff-departure'] as const).map(choice =>
            <Pressable key={choice} style={control} accessibilityRole="radio" accessibilityState={{ checked: kind === choice }} disabled={disabled || busy}
              onPress={() => setKind(choice)}><Text>{kind === choice ? '✓ ' : ''}{personnelLabels[choice]}</Text></Pressable>)}
          {input('player', 'Cédula del participante')}
          {['substitution', 'courtesy'].includes(kind) ? input('outgoing', 'Cédula del jugador saliente') : null}
          {['substitution', 'defense'].includes(kind) ? input('position', 'Posición defensiva') : null}
          {kind === 'substitution' ? input('jersey', 'Número de camiseta del entrante') : null}
          {kind === 'courtesy' ? [1,2,3].map(base => <Pressable key={base} style={control} accessibilityRole="radio" accessibilityState={{ checked: fields.base === base }}
            disabled={disabled || busy} onPress={() => setFields(previous => ({ ...previous, base }))}><Text>Base {base}</Text></Pressable>) : null}
          {kind === 'staff-arrival' ? input('name', 'Nombre del directivo') : null}
          {['staff-arrival', 'staff-departure'].includes(kind) ? Object.keys(presentOfficialRoleLabels).filter(isPresentOfficialRole).map(role => <Pressable key={role} style={control}
            accessibilityRole="radio" accessibilityState={{ checked: fields.role === role }} disabled={disabled || busy}
            onPress={() => setFields(previous => ({ ...previous, role }))}><Text>{role}</Text></Pressable>) : null}
          <Pressable style={control} accessibilityRole="button" disabled={disabled || busy} onPress={() => { void submit(); }}><Text>{busy ? 'Enviando…' : 'Enviar solicitud al organizador o anotador'}</Text></Pressable>
        </> : null}
      </> : null}
      <Text accessibilityRole="header">Solicitudes de mi equipo</Text>
      {data.sheets.requests.filter(request => request.teamId === game.managerTeamId).map(request =>
        <Text key={request.id}>{personnelLabels[request.action.kind]} · {request.status === 'pending' ? 'Pendiente' : request.status === 'approved' ? 'Confirmada' : 'Rechazada'}{request.decisionNote ? ` · ${request.decisionNote}` : ''}</Text>)}
    </View> : null}
  </ScrollView>;
}
