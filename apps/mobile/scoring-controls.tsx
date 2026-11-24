import { useRef, useState, type Dispatch } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  applyPrivateCommand, assertScoringSubmission, currentBatter, fieldersChoiceBaseLabels, fieldersChoiceDestinationOptions, fieldersChoiceOptions, fieldersChoiceThirdOut, fieldersChoiceTwoOutOptions, fieldersChoiceTwoOutStepOptions, minimumDestinations, playerName, playLabels,
  reachedOnErrorResults, runnerLabels, runnerRuleOutHelp, runnerRuleOutIssue, runnerRuleOutLabels, runnerRuleOutOptions, scorecardPlayGroups, scoringPlayRestriction, scoringRuleLabels, softballTieBreakerNotice, sportsTheme, strikeoutLabels,
  type DefensiveError, type Destination, type FieldersChoiceOutStepOption, type PlayResult, type PrivateCommand, type PrivateState, type RunnerAction, type RunnerRuleOut, type StrikeoutType
} from '@playsport/shared';

export function prepareNativeScoringCommand(state: PrivateState, command: PrivateCommand): PrivateCommand {
  assertScoringSubmission(state, command);
  const prepared = command.kind === 'play' && !command.destinations
    ? { ...command, destinations: minimumDestinations(state, command.result) } : command;
  applyPrivateCommand(state, prepared);
  return prepared;
}

export default function ScoringControls({ state, disabled, canUndo, onCommand, onUndo }: {
  state: PrivateState; disabled: boolean; canUndo: boolean;
  onCommand: (_command: PrivateCommand) => Promise<boolean>; onUndo: () => Promise<boolean>; // eslint-disable-line no-unused-vars
}) {
  const [phase, setPhase] = useState<'pitch' | 'inPlay' | 'out'>('pitch');
  const [expanded, setExpanded] = useState('');
  const [detail, setDetail] = useState<PlayResult | null>(null);
  const [moves, setMoves] = useState<Record<string, Destination>>({});
  const [choiceId, setChoiceId] = useState('');
  const [twoOutSelection, setTwoOutSelection] = useState(false);
  const [firstSelectionOut, setFirstSelectionOut] = useState<FieldersChoiceOutStepOption | null>(null);
  const [selectionBase, setSelectionBase] = useState<Exclude<Destination, 0> | null>(null);
  const [firstBaseOutConfirmed, setFirstBaseOutConfirmed] = useState(false);
  const [thirdOutRuns, setThirdOutRuns] = useState(false);
  const [errors, setErrors] = useState<DefensiveError[]>([]);
  const [cause, setCause] = useState<'wild' | 'passed' | ''>('');
  const [rbis, setRbis] = useState<number | null>(null);
  const [errorOuts, setErrorOuts] = useState<number | null>(null);
  const [sacrifice, setSacrifice] = useState(false);
  const [strikeout, setStrikeout] = useState<'pitch' | 'play' | null>(null);
  const [strikeoutType, setStrikeoutType] = useState<StrikeoutType | ''>('');
  const [runner, setRunner] = useState<{ from: number; to: Destination; action: RunnerAction | null; attemptedBase: Destination; ruleOut?: RunnerRuleOut; confirmed?: boolean; note?: string } | null>(null);
  const [foulError, setFoulError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const blocked = disabled || busy || state.finished;
  const draftOpen = detail !== null || runner !== null || foulError || strikeout !== null;
  const defense = state.lineups[state.side === 'away' ? 'home' : 'away'].filter(player => !['NA', 'DH'].includes(player.position));
  const batter = currentBatter(state);
  const participants = [batter, ...state.bases.filter((id): id is string => id !== null)];
  const selectionWithError = detail === 'fieldersChoice' && errors.length > 0;
  const selectionWithTwoOuts = detail === 'fieldersChoice' && twoOutSelection;
  const twoOutChoices = fieldersChoiceTwoOutOptions(state);
  const choices = selectionWithTwoOuts ? twoOutChoices : fieldersChoiceOptions(state, selectionWithError);
  const choice = detail === 'fieldersChoice' && Object.keys(moves).length === participants.length &&
    participants.every(id => moves[id] !== undefined) ? choices.find(option => option.id === choiceId) : undefined;
  const thirdOut = choice ? fieldersChoiceThirdOut(state, moves, choice.selectionOuts) : null;
  const thirdOutTiming = thirdOut === 'timing' && Object.values(moves).includes(4);
  const outStepOptions = selectionWithTwoOuts ? fieldersChoiceTwoOutStepOptions(state, firstSelectionOut ?? undefined) : [];
  const secondSelectionOut = choice?.selectionOuts?.[1];
  const secondOutLabel = secondSelectionOut ? outStepOptions.find(option =>
    option.runnerId === secondSelectionOut.runnerId && option.base === secondSelectionOut.base) : undefined;
  const clearSelectionOuts = (keepFirst = false) => {
    if (!keepFirst) setFirstSelectionOut(null);
    setSelectionBase(null); setChoiceId(''); setMoves({}); setThirdOutRuns(false); setError('');
  };
  const chooseSelectionOut = (out: FieldersChoiceOutStepOption) => {
    setSelectionBase(null); setError('');
    if (!firstSelectionOut) { setFirstSelectionOut(out); return; }
    const option = twoOutChoices.find(entry => entry.selectionOuts?.[0].runnerId === firstSelectionOut.runnerId &&
      entry.selectionOuts[0].base === firstSelectionOut.base &&
      entry.selectionOuts[1].runnerId === out.runnerId && entry.selectionOuts[1].base === out.base);
    if (!option) { clearSelectionOuts(); setError('Las bases cambiaron. Vuelve a elegir el primer out.'); return; }
    setChoiceId(option.id); setMoves({ ...option.destinations }); setThirdOutRuns(false);
  };
  const runnerId = runner ? state.bases[runner.from - 1] : null;
  const reset = () => { setDetail(null); setRunner(null); setFoulError(false); setStrikeout(null); setStrikeoutType(''); setErrors([]); setError(''); };
  const send = async (command: PrivateCommand | null) => {
    if (blocked || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try {
      const accepted = command ? await onCommand(prepareNativeScoringCommand(state, command)) : await onUndo();
      if (accepted) { reset(); setPhase('pitch'); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo registrar la jugada.');
    } finally { sending.current = false; setBusy(false); }
  };
  const button = (label: string, action: () => void, unavailable = false, selected = false, green = false) =>
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled: blocked || unavailable, selected }}
      disabled={blocked || unavailable} onPress={action}
      style={[styles.button, green && styles.onBase, selected && styles.selected, (blocked || unavailable) && styles.disabled]}>
      <Text style={[styles.buttonText, green && styles.onBaseText]}>{label}</Text>
    </Pressable>;
  const open = (result: PlayResult, withError = reachedOnErrorResults.includes(result), twoOuts = false) => {
    setTwoOutSelection(twoOuts);
    setFirstSelectionOut(null); setSelectionBase(null);
    reset(); setDetail(result); setCause(''); setRbis(null); setErrorOuts(result === 'fieldersChoice' && withError ? 1 : null); setSacrifice(false);
    setChoiceId(''); setFirstBaseOutConfirmed(false); setThirdOutRuns(false);
    const destinations = minimumDestinations(state, result);
    if (result === 'doublePlay' || result === 'triplePlay') {
      state.bases.forEach((id, index) => { if (id) destinations[id] = index === 0 ? 1 : index === 1 ? 2 : 3; });
    }
    setMoves(result === 'fieldersChoice' ? {} : destinations);
    setErrors(withError ? [{ playerId: '', position: '', type: 'fielding' }] : []);
  };
  const choose = (result: PlayResult) => {
    if (result === 'strikeout') { reset(); setStrikeout('play'); }
    else if (reachedOnErrorResults.includes(result) || ['fieldersChoice', 'insideParkHomeRun', 'groundRuleDouble', 'buntOut', 'droppedThirdStrike', 'doublePlay', 'triplePlay'].includes(result)) open(result);
    else void send({ kind: 'play', result });
  };
  const playButton = (result: PlayResult) => button(playLabels[result], () => choose(result),
    draftOpen || Boolean(scoringPlayRestriction(state, result)) ||
    result === 'doublePlay' && (state.outs > 1 || !state.bases.some(Boolean)) ||
    result === 'triplePlay' && (state.outs !== 0 || state.bases.filter(Boolean).length < 2), false, phase === 'inPlay');
  const destinations = (id: string, value: Destination | undefined, onChange: Dispatch<Destination>, minimum = 0) => <View key={id} style={styles.section}>
    <Text style={styles.label}>{id === batter ? 'Bateador' : 'Corredor'} · {playerName(state, id)}</Text>
    <View style={styles.row}>{(choice && detail === 'fieldersChoice' ? fieldersChoiceDestinationOptions(state, choice, moves, id) :
      ([0, 1, 2, 3, 4] as const).filter(destination => destination >= minimum)).map(destination =>
      button(['Out', 'Primera', 'Segunda', 'Tercera', 'Home · carrera'][destination], () => onChange(destination),
        runner?.action === 'obstruction' && destination > 0 && destination < 4 && Boolean(state.bases[destination - 1]),
        value === destination))}</View>
  </View>;
  const errorFields = errors.length ? <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.label}>{runner?.action === 'obstruction' ? 'Obstrucción defensiva · un error al defensor responsable' : 'Errores defensivos'}</Text>
    {!defense.length ? <Text accessibilityRole="alert">Asigna primero las posiciones de la defensa en la alineación.</Text> : null}
    {errors.map((entry, index) => <View key={index} style={styles.errorCard}>
      <Text style={styles.label}>Error {index + 1} · Posición y defensor responsable</Text>
      <View style={styles.row}>{defense.filter(player => detail !== 'catcherInterference' || player.position === 'C').map(player =>
        button(`${player.position} · ${player.name}`, () => setErrors(previous => previous.map((item, position) =>
          position === index ? { ...item, playerId: player.id, position: player.position } : item)), false, entry.playerId === player.id))}</View>
      {entry.playerId ? <Text>Responsable: {playerName(state, entry.playerId)} · {entry.position}</Text> : <Text>Selecciona quién cometió este error.</Text>}
      {runner?.action !== 'obstruction' ? <View style={styles.row}>{(['fielding', 'throwing'] as const).map(type => button(`${type === 'fielding' ? 'Fildeo / recepción' : 'Tiro'} · Error ${index + 1}`,
        () => setErrors(previous => previous.map((item, position) => position === index ? { ...item, type } : item)), false, entry.type === type))}</View> : null}
      {runner?.action !== 'obstruction' && errors.length > 1 ? button(`Quitar error ${index + 1}`, () => setErrors(previous => previous.filter((_, position) => position !== index))) : null}
    </View>)}
    {detail !== 'catcherInterference' ? <>
      {runner?.action !== 'obstruction' ? button('Añadir otro error', () => setErrors(previous => [...previous, { playerId: '', position: '', type: 'fielding' }]), errors.length >= 9) : null}
      {!foulError ? <><Text>Outs que evitó el error. Si falta reconstrucción, conserva pendiente.</Text>
      <View style={styles.row}>
        {button('Pendiente', () => setErrorOuts(null), false, errorOuts === null)}
        {[0, 1, 2, 3].filter(count => (!runner || count <= 1) && (!selectionWithError || count >= 1 && count <= 3 - state.outs)).map(count =>
          button(`${count} outs evitados`, () => setErrorOuts(count), false, errorOuts === count))}
      </View></> : null}
    </> : null}
    {detail ? <>
      <Text>Confirma las impulsadas sin atribuir al bateador avances debidos al error.</Text>
      <View style={styles.row}>{[0, 1, 2, 3, 4].map(count =>
        button(`${count} impulsadas`, () => setRbis(count), false, rbis === count))}</View>
    </> : null}
  </View> : null;
  const incomplete = detail === 'fieldersChoice' && (!choice || choice.id === 'safe' && !firstBaseOutConfirmed ||
    participants.some(id => moves[id] === undefined ||
      !fieldersChoiceDestinationOptions(state, choice, moves, id).includes(moves[id]))) ||
    errors.some(entry => !entry.playerId) || errors.length > 0 && detail !== null && rbis === null ||
    detail === 'droppedThirdStrike' && (!cause || !strikeoutType) || Boolean(detail && ['sacrificeBuntError', 'sacrificeFlyError'].includes(detail) && !sacrifice);
  const detailForm = detail ? <View style={styles.section} testID={detail === 'droppedThirdStrike' ? 'dropped-third-strike' : undefined}>
    <Text accessibilityRole="header" style={styles.label}>{selectionWithTwoOuts ? 'Jugada de selección · 2 outs' : selectionWithError ? 'Selección + error' : playLabels[detail]} · Confirmar jugada</Text>
    {!selectionWithTwoOuts ? <Text>Confirma el destino real de cada participante. No se suponen outs ni avances adicionales.</Text> : null}
    {detail === 'fieldersChoice' ? <>
      {selectionWithTwoOuts ? <View testID="selection-out-steps">
        {firstSelectionOut ? <>
          <Text><Text style={styles.label}>1.er out:</Text> {fieldersChoiceBaseLabels[firstSelectionOut.base]} · {firstSelectionOut.label}</Text>
          {button('Cambiar primer out', () => clearSelectionOuts())}
        </> : null}
        {secondOutLabel ? <>
          <Text><Text style={styles.label}>2.º out:</Text> {fieldersChoiceBaseLabels[secondOutLabel.base]} · {secondOutLabel.label}</Text>
          {button('Cambiar segundo out', () => clearSelectionOuts(true))}
        </> : <>
          <Text accessibilityRole="header" style={styles.label}>{firstSelectionOut ? '2.º out' : '1.er out'} · {selectionBase ?
            `¿Cómo fue en ${fieldersChoiceBaseLabels[selectionBase]}?` : '¿En qué base?'}</Text>
          <View style={styles.row}>{selectionBase ? outStepOptions.filter(option => option.base === selectionBase).map(option =>
            button(option.label, () => chooseSelectionOut(option))) :
            ([1, 2, 3, 4] as const).filter(base => outStepOptions.some(option => option.base === base)).map(base =>
              button(fieldersChoiceBaseLabels[base], () => {
                const options = outStepOptions.filter(option => option.base === base);
                if (options.length === 1) chooseSelectionOut(options[0]);
                else setSelectionBase(base);
              }))}</View>
          {selectionBase ? button('Cambiar base', () => setSelectionBase(null)) : null}
        </>}
      </View> : <>
      <Text>{selectionWithError ? 'Elige a quién salvó el error. Revisa los destinos y marca únicamente los outs que sí ocurrieron.' :
        'Elige lo que ocurrió. Solo aparecen corredores presentes y outs compatibles con las bases ocupadas.'}</Text>
      <View style={styles.row}>{choices.map(option => button(option.label, () => {
        setChoiceId(option.id); setMoves({ ...option.destinations });
        setFirstBaseOutConfirmed(false); setThirdOutRuns(false); setError('');
      }, false, choiceId === option.id))}</View>
      </>}
      {choice ? <Text>{selectionWithTwoOuts ? 'Dos corredores out y bateador a salvo, sin hit. Revisa los destinos restantes.' :
        'Bateador a primera y solo los avances obligatorios. Revisa los destinos; ajusta primero al corredor adelantado si avanzaron más.'}</Text> : null}
      {choice?.errorSavedRunnerId ? <Text>Corredor a salvo por el error: {playerName(state, choice.errorSavedRunnerId)}. No se acredita un hit.</Text> : null}
      {choice?.id === 'safe' ? <>
        <Text>Si el bateador habría llegado quieto por el batazo aun jugando en primera, cancela y registra un hit, no selección.</Text>
        {button('La defensa podía retirar al bateador en primera con esfuerzo normal.',
          () => setFirstBaseOutConfirmed(previous => !previous), false, firstBaseOutConfirmed)}
      </> : null}
      {thirdOut === 'noRuns' ? <Text>El tercer out fue forzado o del bateador antes de primera: no cuenta ninguna carrera.</Text> : null}
      {thirdOutTiming ? button('Las carreras llegaron antes del tercer out por toque y el bateador ya había alcanzado primera.',
        () => setThirdOutRuns(previous => !previous), false, thirdOutRuns) : null}
    </> : null}
    {detail === 'catcherInterference' ? <Text>Usa la concesión solo si se aplica la interferencia. Si el manager conserva el batazo, cancela y registra ese resultado.</Text> : null}
    {detail === 'droppedThirdStrike' ? <View style={styles.row}>
      {(['swinging', 'looking'] as const).map(type => button(strikeoutLabels[type], () => setStrikeoutType(type), false, strikeoutType === type))}
      {button('Lanzamiento descontrolado (WP)', () => setCause('wild'), false, cause === 'wild')}
      {button('Bola pasada (PB)', () => setCause('passed'), false, cause === 'passed')}
    </View> : null}
    {Object.entries(detail === 'fieldersChoice' && !choice ? {} : moves)
      .filter(([id]) => !choice?.selectionOuts?.some(out => out.runnerId === id)).map(([id]) =>
      destinations(id, moves[id], destination => setMoves(previous => ({ ...previous, [id]: destination }))))}
    {errorFields}
    {['sacrificeBuntError', 'sacrificeFlyError'].includes(detail) ? button('Confirmo el sacrificio sin el error',
      () => setSacrifice(previous => !previous), false, sacrifice) : null}
    {button('Confirmar jugada', () => { void send({ kind: 'play', result: detail, destinations: moves,
      ...(choice ? { note: choice.label, ...(thirdOutTiming && thirdOutRuns ? { validThirdOutRuns: true } : {}) } : {}),
      ...(choice?.errorSavedRunnerId ? { errorSavedRunnerId: choice.errorSavedRunnerId } : {}),
      ...(choice?.selectionOuts ? { selectionOuts: choice.selectionOuts } : {}),
      ...(errors.length ? { errors, rbis: rbis ?? undefined, ...(errorOuts === null ? {} : { errorOuts }) } : {}),
      ...(cause ? { thirdStrikeCause: cause } : {}), ...(strikeoutType ? { strikeoutType } : {}) }); }, incomplete)}
    {button('Cancelar jugada', reset)}
  </View> : null;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.title}>Anotar jugadas</Text>
    {softballTieBreakerNotice(state) ? <Text accessibilityRole="alert">{softballTieBreakerNotice(state)}</Text> : null}
    <Text>IN PLAY y OUT abren opciones sin registrar jugadas.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {button(`Reglamento: ${scoringRuleLabels[state.seed.scoringRules ?? 'baseball']}`, () => setExpanded(expanded === 'rules' ? '' : 'rules'), draftOpen)}
    {expanded === 'rules' ? <View style={styles.section}>
      <Text>Se elige antes de la primera anotación. En lento no se concede base por golpeado ni tercer strike caído y no hay toque legal.</Text>
      <View style={styles.row}>{Object.entries(scoringRuleLabels).filter(([rules]) => !state.seed.sport ||
        (state.seed.sport === 'baseball') === (rules === 'baseball')).map(([rules, label]) => {
        if (rules !== 'baseball' && rules !== 'softball-fastpitch' && rules !== 'softball-modified' && rules !== 'softball-slowpitch') return null;
        return button(label, () => { void send({ kind: 'rules', rules }); },
          state.log.some(entry => Boolean(entry.pitch || entry.result || entry.runnerId || entry.errors)), state.seed.scoringRules === rules);
      })}</View>
    </View> : null}
    <View style={styles.row}>
      {(['strike', 'foul', 'ball'] as const).map((value, index) => button(['Strike', 'Foul', 'Bola'][index], () => {
        if (value === 'strike' && state.strikes === 2) { setStrikeout('pitch'); setError(''); }
        else void send({ kind: 'pitch', value });
      }, draftOpen))}
      <Pressable accessibilityRole="button" disabled={blocked || draftOpen || phase !== 'pitch'}
        style={[styles.button, styles.inPlay, (blocked || draftOpen || phase !== 'pitch') && styles.disabled]}
        onPress={() => setPhase('inPlay')}><Text style={styles.inPlayText}>IN PLAY</Text></Pressable>
    </View>
    {strikeout ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.label}>Ponche · ¿Cómo fue el tercer strike?</Text>
      <Text>Si el receptor lo retuvo, elige el tipo para registrar el ponche y el out.</Text>
      <View style={styles.row}>
        {(['swinging', 'looking'] as const).map(type => button(strikeoutLabels[type], () => {
          void send(strikeout === 'pitch' ? { kind: 'pitch', value: 'strike', strikeoutType: type } :
            { kind: 'play', result: 'strikeout', strikeoutType: type });
        }))}
        {button('El receptor no lo retuvo', () => open('droppedThirdStrike'), Boolean(scoringPlayRestriction(state, 'droppedThirdStrike')))}
        {button('Cancelar ponche', reset)}
      </View>
    </View> : null}
    {detail === 'droppedThirdStrike' ? detailForm : null}
    {phase !== 'pitch' ? <>
      {button(phase === 'out' ? 'Volver a IN PLAY' : 'Volver a lanzamientos', () => { reset(); setPhase(phase === 'out' ? 'inPlay' : 'pitch'); })}
      <Text style={styles.label}>{scorecardPlayGroups[phase === 'out' ? 1 : 0].title}</Text>
      <View style={styles.row}>{scorecardPlayGroups[phase === 'out' ? 1 : 0].results
        .filter(result => result !== 'fieldersChoice' || choices.length > 0).flatMap(result => result === 'fieldersChoice' ?
          [playButton(result), ...(twoOutChoices.length ? [button('Jugada de selección · 2 outs', () => open('fieldersChoice', false, true), draftOpen, false, true)] : []),
            button('Selección + error', () => open('fieldersChoice', true), draftOpen, false, true)] : [playButton(result)])}
        {phase === 'inPlay' ? <>
          {(['single', 'double', 'triple'] as const).map(result =>
            button(`${playLabels[result]} + error`, () => open(result, true), draftOpen, false, true))}
          {button('OUT', () => setPhase('out'), draftOpen)}
        </> : null}</View>
    </> : null}
    {button('Error en foul que prolonga el turno', () => {
      reset(); setFoulError(true); setErrors([{ playerId: '', position: '', type: 'fielding' }]);
    }, draftOpen)}
    {foulError ? <View style={styles.section}>
      <Text>Solo si la atrapada debió ser out. Conserva el bateador y la cuenta.</Text>
      {errorFields}
      {button('Confirmar error en foul', () => { void send({ kind: 'misplay', errorOuts: 1, errors }); }, errors.some(entry => !entry.playerId))}
      {button('Cancelar error', reset)}
    </View> : null}
    {detail !== 'droppedThirdStrike' ? detailForm : null}
    {button('Deshacer última anotación', () => { void send(null); }, !canUndo || draftOpen)}
    <Text style={styles.label}>Bases</Text>
    {state.bases.map((id, index) => <View key={index} style={styles.section}>
      <Text>{index + 1}.ª base: {id ? playerName(state, id) : 'Vacía'}</Text>
      {id ? button(`Mover corredor de ${index + 1}.ª base`, () => {
        reset(); setErrorOuts(null); setRunner({ from: index + 1, to: index === 0 ? 2 : index === 1 ? 3 : 4, action: null, attemptedBase: index === 0 ? 2 : index === 1 ? 3 : 4 });
      }, draftOpen) : null}
    </View>)}
    {runner ? <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.label}>Movimiento del corredor</Text>
      <Text>Selecciona la causa del avance o de la eliminación.</Text>
      <View style={styles.row}>{Object.entries(runnerLabels).map(([action, label]) => {
        if (!isRunnerAction(action)) return null;
        const eliminated = ['caught', 'pickoff', 'ruleOut', 'advanceOut'].includes(action);
        return button(action === 'advance' ? 'Jugada sin error' : label, () => {
          setRunner(previous => previous ? { ...previous, action, ruleOut: undefined, confirmed: false, note: '', to: eliminated ? 0 :
            action === 'obstruction' ? previous.from === 1 ? 1 : previous.from === 2 ? 2 : 3 :
            action === 'run' ? 4 : previous.from === 1 ? 2 : previous.from === 2 ? 3 : 4 } : previous);
          setErrorOuts(null);
          setErrors(action === 'error' || action === 'obstruction' ? [{ playerId: '', position: '', type: action === 'obstruction' ? 'obstruction' : 'fielding' }] : []);
        }, state.seed.scoringRules === 'softball-slowpitch' && ['steal', 'caught', 'wild', 'passed', 'balk'].includes(action), runner.action === action);
      })}</View>
      {runner.action === 'ruleOut' ? <>
        <Text style={styles.label}>Causa del out por regla</Text>
        <View style={styles.row}>{runnerRuleOutOptions(state).map(reason => button(runnerRuleOutLabels[reason], () =>
          setRunner(previous => previous ? { ...previous, ruleOut: { reason }, confirmed: false, note: '' } : previous),
        false, runner.ruleOut?.reason === reason))}</View>
        {runner.ruleOut ? <Text>{runnerRuleOutHelp[runner.ruleOut.reason]}</Text> : null}
        {runner.ruleOut && ['missedBase', 'missedRetouch'].includes(runner.ruleOut.reason) ? <>
          <Text style={styles.label}>Base apelada</Text>
          <View style={styles.row}>{([1, 2, 3, 4] as const).filter(base => runner.ruleOut?.reason !== 'missedRetouch' || base < 4).map(base =>
            button(base === 4 ? 'Home' : `${base}.ª base`, () => setRunner(previous => previous?.ruleOut ?
              { ...previous, confirmed: false, ruleOut: { ...previous.ruleOut, appealBase: base } } : previous),
            false, runner.ruleOut?.appealBase === base))}</View>
        </> : null}
        {runner.ruleOut?.reason === 'other' ? <><Text style={styles.label}>Motivo del out por regla</Text><TextInput accessibilityLabel="Motivo del out por regla"
          style={styles.button} multiline maxLength={500} editable={!blocked} value={runner.note ?? ''}
          onChangeText={note => setRunner(previous => previous ? { ...previous, note } : previous)} /></> : null}
        <Text>Registra solo el out de este corredor. Anota por separado el resultado del bateador y los avances que correspondan. Si hubo una anulación, corrige esas jugadas antes de confirmar.</Text>
        {button('El árbitro declaró out a este corredor', () => setRunner(previous => previous ?
          { ...previous, confirmed: !previous.confirmed } : previous), !runner.ruleOut, Boolean(runner.confirmed))}
      </> : null}
      {runner.action === 'obstruction' ? <Text>Selecciona la base concedida por el árbitro. Solo se mueve este corredor.</Text> : null}
      {runner.to !== 0 && runnerId ? destinations(runnerId, runner.to,
        to => setRunner(previous => previous ? { ...previous, to } : previous), runner.from + 1) : null}
      {runner.action === 'advanceOut' ? <View style={styles.row}>
        {([2, 3, 4] as const).filter(base => base > runner.from).map(base => button(`Intentaba llegar a ${base === 4 ? 'home' : `${base}.ª base`}`,
          () => setRunner(previous => previous ? { ...previous, attemptedBase: base } : previous), false, runner.attemptedBase === base))}
      </View> : null}
      {errorFields}
      {button('Confirmar movimiento', () => {
        if (!runner.action) { setError('Selecciona la causa del movimiento.'); return; }
        void send({ kind: 'runner', from: runner.from, to: runner.to, action: runner.action,
          ...(runner.action === 'advanceOut' ? { attemptedBase: runner.attemptedBase } : {}),
          ...(runner.action === 'ruleOut' ? { ruleOut: runner.ruleOut, ...(runner.note?.trim() ? { note: runner.note.trim() } : {}) } : {}),
          ...(runner.action === 'advance' ? { cleanAdvance: true } : {}),
          ...(errors.length ? { errors, ...(errorOuts === null ? {} : { errorOuts }) } : {}) });
      }, !runner.action || !runnerId || errors.some(entry => !entry.playerId) ||
        runner.action === 'ruleOut' && (!runner.confirmed || Boolean(runnerRuleOutIssue(state, runner.ruleOut, runner.note))) ||
        runner.action === 'obstruction' && (runner.to <= runner.from || runner.to < 4 && Boolean(state.bases[runner.to - 1])))}
      {button('Cancelar movimiento', reset)}
    </View> : null}
  </View>;
}
function isRunnerAction(value: string): value is RunnerAction { return Object.hasOwn(runnerLabels, value); }
const styles = StyleSheet.create({
  card: { padding: 14, gap: 12, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 12, backgroundColor: sportsTheme.surface },
  title: { fontSize: 20, fontWeight: '700' }, label: { fontWeight: '700', flexShrink: 1 },
  section: { gap: 8, minWidth: 0 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 },
  buttonText: { flexShrink: 1, color: sportsTheme.text }, selected: { backgroundColor: '#e5f4ed', borderColor: '#16804a', borderWidth: 2 },
  onBase: { backgroundColor: '#e3f2e7', borderColor: '#8db99b' }, onBaseText: { color: '#174b2b' },
  inPlay: { backgroundColor: '#008b3b', borderColor: '#008b3b' }, inPlayText: { color: '#ffffff', fontWeight: '700' },
  errorCard: { gap: 8, padding: 10, borderWidth: 1, borderColor: sportsTheme.border, borderRadius: 10 },
  error: { color: '#b42318' }, disabled: { opacity: 0.45 }
});
