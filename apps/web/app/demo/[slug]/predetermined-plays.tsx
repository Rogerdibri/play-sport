import { type ComponentRef, Fragment, useEffect, useRef, useState } from 'react';
import { useScreenBack } from '../../navigation-hooks';
import { battedBallLabels, battedBallTypeForLog, battedOutResults, defensivePlayContext, currentBatter, fieldersChoiceBaseLabels, fieldersChoiceDestinationOptions, fieldersChoiceOptions, fieldersChoiceThirdOut, fieldersChoiceTwoOutOptions, fieldersChoiceTwoOutStepOptions, minimumDestinations, playerName, playLabels, scorecardPlayGroups, scoringRuleLabels, scoringPlayRestriction, reachedOnErrorResults, strikeoutLabels,
  scoringSacrificeRestriction, scoringInfieldFlyRestriction, batterRuleOutLabels, batterRuleOutHelp, batterRuleOutRestriction, batterRuleOutIssue,
  defensivePositions, defensivePlayerAt, type CaughtBallFielder,
  type BatterRuleOut, type BatterRuleOutReason, type BattedBallType, type DefensiveError, type Destination, type FieldersChoiceOutStepOption, type PlayResult, type PrivateCommand, type PrivateState, type StrikeoutType } from './private-scorecard';
import { DefensiveErrorFields } from './defensive-error-fields';
import { ErrorOutsField } from './run-accounting-panel';
import DefensiveRouteFields from './defensive-route-fields';

export const predeterminedPlayGroups = scorecardPlayGroups.map(group => group.tone === 'out' ? {
  ...group, results: ['groundOut', 'lineOut', 'flyOut', 'buntOut', 'ruleOut'] satisfies PlayResult[]
} : group);

type Phase = 'pitch' | 'inPlay' | 'out';

export default function PredeterminedPlays({ state, disabled, undoDisabled, blockingReason, onCommand, onUndo }: {
  state: PrivateState;
  disabled: boolean; undoDisabled: boolean; blockingReason?: string;
  onCommand: (_command: PrivateCommand) => Promise<boolean>; // eslint-disable-line no-unused-vars
  onUndo: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('pitch');
  const [multipleOut, setMultipleOut] = useState<'doublePlay' | 'triplePlay' | null>(null);
  const [selectedRunners, setSelectedRunners] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<PlayResult | null>(null);
  const [destinations, setDestinations] = useState<Record<string, Destination>>({});
  const [choiceId, setChoiceId] = useState('');
  const [twoOutSelection, setTwoOutSelection] = useState(false);
  const [firstSelectionOut, setFirstSelectionOut] = useState<FieldersChoiceOutStepOption | null>(null);
  const [selectionBase, setSelectionBase] = useState<Exclude<Destination, 0> | null>(null);
  const [firstBaseOutConfirmed, setFirstBaseOutConfirmed] = useState(false);
  const [thirdOutRuns, setThirdOutRuns] = useState(false);
  const [errors, setErrors] = useState<DefensiveError[]>([]);
  const [cause, setCause] = useState<'wild' | 'passed' | ''>('');
  const [rbis, setRbis] = useState('');
  const [errorOuts, setErrorOuts] = useState('');
  const [sacrifice, setSacrifice] = useState(false);
  const [strikeout, setStrikeout] = useState<'pitch' | 'play' | null>(null);
  const [strikeoutType, setStrikeoutType] = useState<StrikeoutType | ''>('');
  const [outType, setOutType] = useState<BattedBallType | null>(null);
  const [fieldingSequence, setFieldingSequence] = useState<number[]>([]);
  const [outAt, setOutAt] = useState<number[]>([]);
  const changeSequence = (sequence: number[]) => { setFieldingSequence(sequence); setOutAt([]); };
  const [caughtBy, setCaughtBy] = useState<CaughtBallFielder | null>(null);
  const [outContext, setOutContext] = useState('');
  const [detailBallType, setDetailBallType] = useState<BattedBallType | ''>('');
  const [infieldFly, setInfieldFly] = useState(false);
  const [infieldFlyDeclared, setInfieldFlyDeclared] = useState(false);
  const [ruleReason, setRuleReason] = useState<BatterRuleOutReason | ''>('');
  const [ruleDeclared, setRuleDeclared] = useState(false);
  const [ruleAppeal, setRuleAppeal] = useState(false);
  const [ruleNote, setRuleNote] = useState('');
  const sending = useRef(false);
  const panel = useRef<ComponentRef<'fieldset'>>(null);
  const detailPanel = useRef<ComponentRef<'fieldset'>>(null);
  const selectionPanel = useRef<ComponentRef<'div'>>(null);
  const battedOutPanel = useRef<ComponentRef<'fieldset'>>(null);
  const previousPhase = useRef<Phase>('pitch');
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    panel.current?.querySelector<ComponentRef<'h3'>>(`[data-scoring-phase="${phase}"] h3`)?.focus();
  }, [phase]);
  useEffect(() => {
    if (strikeout) panel.current?.querySelector<ComponentRef<'fieldset'>>('[data-strikeout-choice]')?.focus();
  }, [strikeout]);
  useEffect(() => {
    if (!outType) return;
    battedOutPanel.current?.focus({ preventScroll: true });
    battedOutPanel.current?.scrollIntoView({ block: 'start' });
  }, [outType]);
  const blocked = disabled || busy;
  const draftOpen = detail !== null || outType !== null || strikeout !== null;
  const runners = state.bases.filter((id): id is string => id !== null);
  const batter = currentBatter(state);
  const outStateKey = defensivePlayContext(state);
  const staleOut = outType !== null && outContext !== outStateKey;
  const staleDetail = detail !== null && outContext !== outStateKey;
  const simpleCatch = !multipleOut && (outType === 'line' || outType === 'fly');
  const catchIssue = simpleCatch ? !caughtBy ? 'Selecciona quién atrapó la pelota antes de confirmar.' :
    defensivePlayerAt(state, caughtBy.position)?.id !== caughtBy.playerId ? 'La defensa cambió. Revisa quién atrapó la pelota.' : null : null;
  const outSequence = simpleCatch ? caughtBy ? [caughtBy.position] : [] : fieldingSequence;
  const detailNeedsRoute = !infieldFly && detail !== 'ruleOut' && (detail === 'fieldersChoice' || detail !== null && detail !== 'catcherInterference' &&
    Object.values(destinations).includes(0));
  const detailNeedsType = detailNeedsRoute && detail !== 'droppedThirdStrike';
  const detailOuts = Object.values(destinations).filter(destination => destination === 0).length;
  const incompleteCredits = (outs: number) => outs > 1 && (outAt.length !== outs ||
    outAt.some(index => index < 0 || index >= fieldingSequence.length) ||
    outAt.some((index, position) => position > 0 && index < outAt[position - 1]) ||
    outAt.at(-1) !== fieldingSequence.length - 1);
  const incompleteRoute = detailNeedsRoute && (!fieldingSequence.length || detailNeedsType && !detailBallType || incompleteCredits(detailOuts));
  useEffect(() => {
    if (!detailNeedsRoute && !infieldFly && detail !== 'ruleOut') return;
    detailPanel.current?.focus({ preventScroll: true });
    detailPanel.current?.scrollIntoView({ block: 'start' });
  }, [detail, detailNeedsRoute, infieldFly]);
  const batterRuleOut: BatterRuleOut | undefined = ruleReason && ruleDeclared && (ruleReason !== 'battingOutOfTurn' || ruleAppeal) ?
    ruleReason === 'battingOutOfTurn' ? { reason: ruleReason, umpireConfirmed: true, appealConfirmed: true } :
      { reason: ruleReason, umpireConfirmed: true } : undefined;
  const ruleIssue = detail === 'ruleOut' ? batterRuleOutIssue(state, batterRuleOut, detailBallType || undefined, ruleNote) : null;
  const participants = [batter, ...runners];
  const selectionWithError = detail === 'fieldersChoice' && errors.length > 0;
  const selectionWithTwoOuts = detail === 'fieldersChoice' && twoOutSelection;
  const twoOutChoices = fieldersChoiceTwoOutOptions(state);
  const choices = selectionWithTwoOuts ? twoOutChoices : fieldersChoiceOptions(state, selectionWithError);
  const choice = detail === 'fieldersChoice' && Object.keys(destinations).length === participants.length &&
    participants.every(id => destinations[id] !== undefined) ? choices.find(option => option.id === choiceId) : undefined;
  const thirdOut = choice ? fieldersChoiceThirdOut(state, destinations, choice.selectionOuts) : null;
  const thirdOutTiming = thirdOut === 'timing' && Object.values(destinations).includes(4);
  const outStepOptions = selectionWithTwoOuts ? fieldersChoiceTwoOutStepOptions(state, firstSelectionOut ?? undefined) : [];
  const secondSelectionOut = choice?.selectionOuts?.[1];
  const secondOutLabel = secondSelectionOut ? outStepOptions.find(option =>
    option.runnerId === secondSelectionOut.runnerId && option.base === secondSelectionOut.base) : undefined;
  useEffect(() => {
    if (!selectionWithTwoOuts || !firstSelectionOut && !selectionBase && !choiceId) return;
    const heading = selectionPanel.current?.querySelector<ComponentRef<'h4'> | ComponentRef<'p'>>('[data-selection-step-heading]');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'center' });
  }, [selectionWithTwoOuts, firstSelectionOut, selectionBase, choiceId]);
  const clearSelectionOuts = (keepFirst = false) => {
    if (!keepFirst) setFirstSelectionOut(null);
    setSelectionBase(null); setChoiceId(''); setDestinations({}); setThirdOutRuns(false); setError('');
  };
  const chooseSelectionOut = (out: FieldersChoiceOutStepOption) => {
    setSelectionBase(null); setError('');
    if (!firstSelectionOut) { setFirstSelectionOut(out); return; }
    const option = twoOutChoices.find(entry => entry.selectionOuts?.[0].runnerId === firstSelectionOut.runnerId &&
      entry.selectionOuts[0].base === firstSelectionOut.base &&
      entry.selectionOuts[1].runnerId === out.runnerId && entry.selectionOuts[1].base === out.base);
    if (!option) { clearSelectionOuts(); setError('Las bases cambiaron. Vuelve a elegir el primer out.'); return; }
    setChoiceId(option.id); setDestinations({ ...option.destinations }); setThirdOutRuns(false);
  };
  const requiredRunners = multipleOut === 'triplePlay' ? 2 : multipleOut === 'doublePlay' ? 1 : 0;
  const automaticRunners = requiredRunners > 0 && runners.length === requiredRunners;
  const selected = automaticRunners ? runners : selectedRunners.filter(id => runners.includes(id));
  const outResult = outType ? multipleOut ?? (sacrifice && outType === 'fly' ? 'sacrificeFly' :
    sacrifice && outType === 'bunt' ? 'sacrificeBunt' : battedOutResults[outType]) : null;
  const sacrificeResult = outType === 'fly' ? 'sacrificeFly' : outType === 'bunt' ? 'sacrificeBunt' : detail;
  const sacrificeRestriction = sacrificeResult ? scoringSacrificeRestriction(state, sacrificeResult, destinations) : null;
  useEffect(() => {
    if (sacrifice && sacrificeRestriction) {
      setSacrifice(false); setError(`Se quitó la marca de sacrificio. ${sacrificeRestriction}`);
    }
  }, [sacrifice, sacrificeRestriction]);
  const changeSacrifice = (checked: boolean) => {
    if (checked && sacrificeRestriction) { setError(sacrificeRestriction); return; }
    setSacrifice(checked); setError('');
  };
  const changeDestination = (id: string, value: Destination) => {
    setDestinations(current => ({ ...current, [id]: value }));
    const issue = sacrifice && sacrificeResult ?
      scoringSacrificeRestriction(state, sacrificeResult, { ...destinations, [id]: value }) : null;
    if (issue) { setSacrifice(false); setError(`Se quitó la marca de sacrificio. ${issue}`); }
  };
  const run = async (command: PrivateCommand) => {
    if (disabled || sending.current) return;
    if (detail === 'ruleOut' && ruleIssue) { setError(ruleIssue); return; }
    if (infieldFly && (!infieldFlyDeclared || scoringInfieldFlyRestriction(state))) {
      setError(scoringInfieldFlyRestriction(state) ?? 'Confirma que el árbitro declaró infield fly.'); return;
    }
    if (sacrifice && sacrificeRestriction) { setError(sacrificeRestriction); return; }
    if (detail && (staleDetail || incompleteRoute)) {
      setError(staleDetail ? 'El partido cambió. Cancela esta selección y revisa la pizarra antes de anotar.' :
        'Indica el tipo de batazo y la vía defensiva antes de confirmar.');
      return;
    }
    sending.current = true; setBusy(true); setError('');
    try {
      if (await onCommand(command)) {
        setMultipleOut(null); setSelectedRunners([]); setDetail(null); setOutType(null); setFieldingSequence([]);
        setCaughtBy(null); setOutAt([]);
        setStrikeout(null); setStrikeoutType(''); setPhase('pitch');
        setInfieldFly(false); setInfieldFlyDeclared(false);
        setRuleReason(''); setRuleDeclared(false); setRuleAppeal(false); setRuleNote('');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo registrar la jugada. Inténtalo de nuevo.');
    } finally {
      sending.current = false; setBusy(false);
    }
  };
  const openDetails = (result: PlayResult, withError = reachedOnErrorResults.includes(result), twoOuts = false) => {
    setInfieldFly(false); setInfieldFlyDeclared(false);
    setRuleReason(''); setRuleDeclared(false); setRuleAppeal(false); setRuleNote('');
    setFieldingSequence([]); setOutAt([]); setOutContext(outStateKey);
    setCaughtBy(null);
    setDetailBallType(result === 'sacrificeBuntError' ? 'bunt' : result === 'sacrificeFlyError' ? 'fly' : battedBallTypeForLog({ result }) ?? '');
    setTwoOutSelection(twoOuts);
    setFirstSelectionOut(null); setSelectionBase(null);
    setDetail(result); setMultipleOut(null); setDestinations(result === 'fieldersChoice' ? {} : minimumDestinations(state, result));
    setChoiceId(''); setFirstBaseOutConfirmed(false); setThirdOutRuns(false);
    setErrors(withError ? [{ playerId: '', position: '', type: 'fielding' }] : []);
    setCause(''); setRbis(''); setErrorOuts(result === 'fieldersChoice' && withError ? '1' : ''); setSacrifice(false);
    setStrikeout(null); setStrikeoutType('');
  };
  const choosePlay = (result: PlayResult) => {
    const type = battedBallTypeForLog({ result });
    if (type) {
      setInfieldFly(false); setInfieldFlyDeclared(false);
      setOutType(type); setFieldingSequence([]); setOutAt([]); setOutContext(outStateKey);
      setCaughtBy(null);
      setMultipleOut(null); setSelectedRunners([]); setSacrifice(false);
      setDestinations(minimumDestinations(state, battedOutResults[type])); setError('');
    } else if (result === 'strikeout') {
      setStrikeout('play'); setError('');
    } else if (reachedOnErrorResults.includes(result) || ['ruleOut', 'fieldersChoice', 'insideParkHomeRun', 'groundRuleDouble', 'buntOut', 'droppedThirdStrike'].includes(result)) {
      openDetails(result);
    } else {
      void run({ kind: 'play', result });
    }
  };
  const multipleAllowed = (result: PlayResult) => result === 'doublePlay'
    ? state.outs <= 1 && runners.length >= 1
    : result !== 'triplePlay' || state.outs === 0 && runners.length >= 2;
  const back = () => {
    if (outType) { setOutType(null); setFieldingSequence([]); setCaughtBy(null); setMultipleOut(null); setSelectedRunners([]); setError(''); return; }
    if (strikeout) { setStrikeout(null); setError(''); return; }
    if (detail) { setDetail(null); setInfieldFly(false); setInfieldFlyDeclared(false); setError(''); return; }
    setMultipleOut(null); setSelectedRunners([]); setError('');
    setPhase(phase === 'out' ? 'inPlay' : 'pitch');
  };
  const confirmOut = () => {
    if (staleOut) { setError('El partido cambió. Cancela esta selección y revisa la pizarra antes de anotar.'); return; }
    if (sacrifice && sacrificeRestriction) { setError(sacrificeRestriction); return; }
    if (catchIssue) { setError(catchIssue); return; }
    if (incompleteCredits(requiredRunners + 1)) {
      setError('Marca en qué paso del recorrido se realizó cada out. Esto determina los créditos defensivos.');
      return;
    }
    if (!outType || !outResult || !outSequence.length || selected.length !== requiredRunners) {
      setError('Completa la vía e identifica a los eliminados antes de confirmar.');
      return;
    }
    const moves: Record<string, Destination> = { [batter]: 0 };
    ([1, 2, 3] as const).forEach(base => {
      const id = state.bases[base - 1];
      if (!id) return;
      moves[id] = selected.includes(id) ? 0 : destinations[id] ?? base;
    });
    void run({ kind: 'play', result: outResult, destinations: moves, battedBallType: outType, fieldingSequence: outSequence,
      ...(requiredRunners > 0 ? { outAt } : {}),
      ...(simpleCatch && caughtBy ? { caughtBy } : {}) });
  };
  useScreenBack(back, (phase !== 'pitch' || detail !== null || strikeout !== null) && !busy, 2);
  const detailForm = detail ? <><fieldset ref={detailPanel} tabIndex={-1} className="privateMultipleOut" disabled={blocked || staleDetail}
    data-fielders-choice={detail === 'fieldersChoice' ? true : undefined}
    data-infield-fly={infieldFly ? true : undefined}
    data-batter-rule-out={detail === 'ruleOut' ? true : undefined}
    data-dropped-third-strike={detail === 'droppedThirdStrike' ? true : undefined}>
    <legend>{infieldFly ? 'Infield fly' : selectionWithTwoOuts ? 'Jugada de selección · 2 outs' : selectionWithError ? 'Selección + error' : playLabels[detail]} · Confirmar jugada</legend>
    {staleDetail ? <p role="alert">El partido cambió. Cancela esta selección y revisa la pizarra antes de anotar.</p> : null}
    {detail === 'ruleOut' ? <>
      {!ruleReason ? <>
        <p>Elige la causa indicada por el árbitro. Abrir o elegir una opción no guarda la jugada.</p>
        <div className="predeterminedPlayButtons" role="group" aria-label="Causas del out del bateador por regla">
          {(Object.keys(batterRuleOutLabels) as BatterRuleOutReason[]).map(reason =>
            <button key={reason} type="button" className="managerButtonOutline"
              disabled={blocked || staleDetail || Boolean(batterRuleOutRestriction(state, reason))}
              title={batterRuleOutRestriction(state, reason) ?? undefined} onClick={() => {
                setRuleReason(reason); setRuleDeclared(false); setRuleAppeal(false); setRuleNote('');
                setDetailBallType(''); setFieldingSequence([]); setError('');
              }}>{batterRuleOutLabels[reason]}</button>)}
          <button type="button" className="managerButtonOutline"
            disabled={blocked || staleDetail || Boolean(scoringInfieldFlyRestriction(state))}
            title={scoringInfieldFlyRestriction(state) ?? undefined}
            onClick={() => { openDetails('flyOut'); setInfieldFly(true); }}>Infield fly declarado por el árbitro</button>
        </div>
      </> : <>
        <h4>{batterRuleOutLabels[ruleReason]}</h4>
        <button type="button" className="managerButtonOutline" onClick={() => {
          setRuleReason(''); setRuleDeclared(false); setRuleAppeal(false); setRuleNote('');
          setDetailBallType(''); setFieldingSequence([]); setError('');
        }}>Cambiar causa del out</button>
        <p>{batterRuleOutHelp[ruleReason]}</p>
        <p>Se elimina a <strong>{playerName(state, batter)}</strong>, el bateador del turno actual. Los corredores permanecen en sus bases; otras decisiones se registran aparte.</p>
        {ruleReason === 'intentionalDrop' ? <>
          <label className="managerField"><span>Tipo de pelota dejada caer</span><select value={detailBallType}
            onChange={event => {
              const value = event.currentTarget.value;
              if (value === '' || value === 'fly' || value === 'line') setDetailBallType(value);
            }}><option value="">Selecciona elevado o línea</option><option value="fly">Elevado fair</option><option value="line">Línea fair</option></select></label>
          <details><summary className="managerButtonOutline">Vía defensiva opcional</summary>
            <DefensiveRouteFields state={state} sequence={fieldingSequence} onChange={setFieldingSequence} disabled={blocked || staleDetail} />
          </details>
          {batterRuleOutRestriction(state, ruleReason) ? <p role="alert">{batterRuleOutRestriction(state, ruleReason)}</p> : null}
        </> : null}
        {ruleReason === 'other' ? <label className="managerField"><span>Motivo del out del bateador</span>
          <textarea value={ruleNote} maxLength={500} onChange={event => setRuleNote(event.currentTarget.value)} /></label> : null}
        <label><input type="checkbox" checked={ruleDeclared} onChange={event => setRuleDeclared(event.currentTarget.checked)} />
          Confirmo que el árbitro declaró out a este bateador por esta causa.</label>
        {ruleReason === 'battingOutOfTurn' ? <label><input type="checkbox" checked={ruleAppeal}
          onChange={event => setRuleAppeal(event.currentTarget.checked)} />
          La apelación fue aceptada a tiempo, el turno indebido está anulado y este es el bateador que debía batear.</label> : null}
      </>}
    </> : null}
    {detailNeedsRoute ? <DefensiveRouteFields state={state} sequence={fieldingSequence} onChange={changeSequence}
      outs={detailOuts} outAt={outAt} onOutAtChange={setOutAt}
      {...(detailNeedsType && detail !== 'sacrificeBuntError' && detail !== 'sacrificeFlyError' ?
        { ballType: detailBallType, onBallTypeChange: setDetailBallType } : {})}
      disabled={blocked || staleDetail} /> : null}
    {infieldFly ? <>
      <p>Elevado fair, no línea ni toque, atrapable por un infielder con esfuerzo normal; primera y segunda ocupadas y menos de dos outs.</p>
      <label><input type="checkbox" checked={infieldFlyDeclared}
        onChange={event => setInfieldFlyDeclared(event.currentTarget.checked)} /> Confirmo que el árbitro declaró infield fly.</label>
      {scoringInfieldFlyRestriction(state) ? <p role="alert">{scoringInfieldFlyRestriction(state)}</p> : null}
      <p>Solo el bateador queda out, aunque no atrapen la pelota. Los corredores permanecen en su base salvo avances reales; los otros outs se anotan aparte.</p>
      <p>Vía opcional: complétala únicamente si hubo intervención defensiva real. No se inventa una atrapada.</p>
      <details><summary className="managerButtonOutline">Vía defensiva opcional</summary>
        <DefensiveRouteFields state={state} sequence={fieldingSequence} onChange={setFieldingSequence} disabled={blocked || staleDetail} />
      </details>
    </> : null}
    {!selectionWithTwoOuts && detail !== 'ruleOut' ? <p>Confirma el destino real del bateador y de cada corredor. No se inventan outs ni avances adicionales.</p> : null}
    {detail === 'fieldersChoice' ? <>
      {selectionWithTwoOuts ? <div ref={selectionPanel} data-selection-out-step={choice ? 'review' : firstSelectionOut ? 'second' : 'first'}>
        {firstSelectionOut ? <>
          <p><strong>1.er out:</strong> {fieldersChoiceBaseLabels[firstSelectionOut.base]} · {firstSelectionOut.label}</p>
          <button type="button" className="managerButtonOutline" onClick={() => clearSelectionOuts()}>Cambiar primer out</button>
        </> : null}
        {secondOutLabel ? <>
          <p tabIndex={-1} data-selection-step-heading><strong>2.º out:</strong> {fieldersChoiceBaseLabels[secondOutLabel.base]} · {secondOutLabel.label}</p>
          <button type="button" className="managerButtonOutline" onClick={() => clearSelectionOuts(true)}>Cambiar segundo out</button>
        </> : <>
          <h4 tabIndex={-1} data-selection-step-heading>{firstSelectionOut ? '2.º out' : '1.er out'} · {selectionBase ? `¿Cómo fue en ${fieldersChoiceBaseLabels[selectionBase]}?` : '¿En qué base?'}</h4>
          <div className="predeterminedPlayButtons">
            {selectionBase ? outStepOptions.filter(option => option.base === selectionBase).map(option =>
              <button key={`${option.runnerId}-${option.base}`} type="button" className="managerButtonOutline"
                onClick={() => chooseSelectionOut(option)}>{option.label}</button>) :
              ([1, 2, 3, 4] as const).filter(base => outStepOptions.some(option => option.base === base)).map(base =>
                <button key={base} type="button" className="managerButtonOutline" onClick={() => {
                  const options = outStepOptions.filter(option => option.base === base);
                  if (options.length === 1) chooseSelectionOut(options[0]);
                  else setSelectionBase(base);
                }}>{fieldersChoiceBaseLabels[base]}</button>)}
          </div>
          {selectionBase ? <button type="button" className="managerButtonOutline" onClick={() => setSelectionBase(null)}>Cambiar base</button> : null}
        </>}
      </div> : <>
      <p>{selectionWithError ? 'Elige a quién salvó el error. Revisa los destinos y marca únicamente los outs que sí ocurrieron.' :
        'Elige lo que ocurrió. Solo aparecen corredores presentes y outs compatibles con las bases ocupadas.'}</p>
      <div className="predeterminedPlayButtons">
        {choices.map(option => <button key={option.id} type="button" className="managerButtonOutline"
          aria-pressed={choiceId === option.id} onClick={() => {
            setChoiceId(option.id); setDestinations({ ...option.destinations });
            setFirstBaseOutConfirmed(false); setThirdOutRuns(false); setError('');
          }}>{option.label}</button>)}
      </div>
      </>}
      {choice ? <p>{selectionWithTwoOuts ? 'Dos corredores out y bateador a salvo, sin hit. Revisa los destinos restantes.' :
        'Bateador a primera y solo los avances obligatorios. Revisa los destinos; ajusta primero al corredor adelantado si avanzaron más.'}</p> : null}
      {choice?.errorSavedRunnerId ? <p>Corredor a salvo por el error: <strong>{playerName(state, choice.errorSavedRunnerId)}</strong>. No se acredita un hit.</p> : null}
      {choice?.id === 'safe' ? <>
        <p>Si el bateador habría llegado quieto por el batazo aun jugando en primera, cancela y registra un hit, no selección.</p>
        <label><input type="checkbox" checked={firstBaseOutConfirmed}
          onChange={event => setFirstBaseOutConfirmed(event.currentTarget.checked)} />
          La defensa podía retirar al bateador en primera con esfuerzo normal.</label>
      </> : null}
      {thirdOut === 'noRuns' ? <p>El tercer out fue forzado o del bateador antes de primera: no cuenta ninguna carrera.</p> : null}
      {thirdOutTiming ? <label><input type="checkbox" checked={thirdOutRuns}
        onChange={event => setThirdOutRuns(event.currentTarget.checked)} />
        Las carreras indicadas llegaron antes del tercer out por toque; el bateador ya había alcanzado primera.</label> : null}
    </> : null}
    {detail === 'catcherInterference' ? <p>Usa esta concesión solo si se aplica la interferencia. Si el manager conserva el resultado del batazo, cancela y registra ese resultado.</p> : null}
    {detail === 'droppedThirdStrike' ? <label className="managerField"><span>Causa del tercer strike no retenido</span>
      <select value={cause} onChange={event => {
        const value = event.currentTarget.value;
        if (value === 'wild' || value === 'passed' || value === '') setCause(value);
      }}><option value="">Selecciona la causa</option><option value="wild">Lanzamiento descontrolado (WP)</option><option value="passed">Bola pasada (PB)</option></select>
    </label> : null}
    {detail === 'droppedThirdStrike' ? <label className="managerField"><span>Tipo de tercer strike</span>
      <select value={strikeoutType} onChange={event => {
        const value = event.currentTarget.value;
        if (value === 'swinging' || value === 'looking' || value === '') setStrikeoutType(value);
      }}><option value="">Selecciona el tipo</option>
        {Object.entries(strikeoutLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label> : null}
    {Object.entries(detail === 'ruleOut' || detail === 'fieldersChoice' && !choice ? {} : destinations)
      .filter(([id]) => !choice?.selectionOuts?.some(out => out.runnerId === id)).map(([id]) => <label className="managerField" key={id}>
      <span>{id === batter ? 'Bateador' : `Corredor en ${state.bases.indexOf(id) + 1}.ª`} · {playerName(state, id)}</span>
      <select value={destinations[id] ?? ''} onChange={event => {
        if (event.currentTarget.value === '') return;
        const value = Number(event.currentTarget.value);
        if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) changeDestination(id, value);
      }}>
        {(infieldFly ? id === batter ? [0] : [1, 2, 3, 4].filter(base => base >= state.bases.indexOf(id) + 1) :
          choice ? fieldersChoiceDestinationOptions(state, choice, destinations, id) : [0, 1, 2, 3, 4]).map(destination =>
          <option key={destination} value={destination}>{['Out', 'Primera', 'Segunda', 'Tercera', 'Home · carrera'][destination]}</option>)}
      </select>
    </label>)}
    {errors.length ? <>
      <DefensiveErrorFields state={state} errors={errors} onChange={setErrors} />
      {detail !== 'catcherInterference' ? <ErrorOutsField value={errorOuts} onChange={setErrorOuts} disabled={blocked} required={false}
        minimum={selectionWithError ? 1 : 0} maximum={selectionWithError ? 3 - state.outs : 3} /> : null}
      <label className="managerField"><span>Carreras impulsadas sin atribuir avances debidos al error</span>
        <select value={rbis} onChange={event => setRbis(event.currentTarget.value)}>
          <option value="">Confirma las impulsadas</option>
          {[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </> : null}
    {['sacrificeBuntError', 'sacrificeFlyError'].includes(detail) ? <>
      <label><input type="checkbox" checked={sacrifice} disabled={Boolean(sacrificeRestriction)}
        title={sacrificeRestriction ?? undefined} onChange={event => changeSacrifice(event.currentTarget.checked)} />
        {detail === 'sacrificeFlyError' ? 'Confirmo que el corredor habría anotado aun sin el error.' :
          'Confirmo que el corredor habría avanzado aun sin el error.'}
      </label>
      {sacrificeRestriction ? <p>{sacrificeRestriction}</p> : null}
    </> : null}
    <button type="button" className="managerButtonSolid"
      disabled={blocked || staleDetail || Boolean(ruleIssue) || Boolean(incompleteRoute) || detail === 'fieldersChoice' && (!choice || choice.id === 'safe' && !firstBaseOutConfirmed ||
        participants.some(id => destinations[id] === undefined ||
          !fieldersChoiceDestinationOptions(state, choice, destinations, id).includes(destinations[id]))) ||
        errors.some(entry => !entry.playerId) || errors.length > 0 && !rbis ||
        detail === 'droppedThirdStrike' && (!cause || !strikeoutType) ||
        ['sacrificeBuntError', 'sacrificeFlyError'].includes(detail) && (!sacrifice || Boolean(sacrificeRestriction)) ||
        infieldFly && (!infieldFlyDeclared || Boolean(scoringInfieldFlyRestriction(state)))}
      onClick={() => void run({ kind: 'play', result: detail, destinations,
        ...(detail === 'ruleOut' && batterRuleOut ? { batterRuleOut, ...(ruleNote.trim() ? { note: ruleNote.trim() } : {}),
          ...(ruleReason === 'intentionalDrop' && detailBallType ? { battedBallType: detailBallType,
            ...(fieldingSequence.length ? { fieldingSequence } : {}) } : {}) } : {}),
        ...(infieldFly ? { infieldFly: true as const, ...(fieldingSequence.length ? { battedBallType: 'fly' as const, fieldingSequence } : {}) } : {}),
        ...(detailNeedsRoute ? { fieldingSequence, ...(detailOuts > 1 ? { outAt } : {}),
          ...(detailNeedsType && detailBallType ? { battedBallType: detailBallType } : {}) } : {}),
        ...(choice ? { note: choice.label, ...(thirdOutTiming && thirdOutRuns ? { validThirdOutRuns: true } : {}) } : {}),
        ...(choice?.errorSavedRunnerId ? { errorSavedRunnerId: choice.errorSavedRunnerId } : {}),
        ...(choice?.selectionOuts ? { selectionOuts: choice.selectionOuts } : {}),
        ...(errors.length ? { errors, rbis: Number(rbis), ...(errorOuts ? { errorOuts: Number(errorOuts) } : {}) } : {}),
        ...(cause ? { thirdStrikeCause: cause } : {}), ...(strikeoutType ? { strikeoutType } : {}) })}>Confirmar jugada</button>
  </fieldset><button type="button" className="managerButtonOutline" disabled={busy} onClick={back}>Cancelar jugada</button></> : null;
  return <fieldset className="predeterminedPlays" ref={panel} data-scoring-stage={phase}>
    <legend>Jugadas predeterminadas</legend>
    <p>IN PLAY y OUT abren opciones, sin registrar jugadas.</p>
    <p><a href="/demo/scoring-practice" target="_blank" rel="noopener noreferrer">Practicar en una planilla aparte</a></p>
    {blockingReason ? <p className="managerWarning" role="status">{blockingReason}</p> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    <details className="privateBaseMenu">
      <summary>Reglamento: {scoringRuleLabels[state.seed.scoringRules ?? 'baseball']}</summary>
      <p>Selecciona la modalidad antes de la primera anotación. En lento no se concede base por golpeado, no hay toque legal ni tercer strike caído; el foul con dos strikes es out.</p>
      <label className="managerField"><span>Modalidad del partido</span>
        <select value={state.seed.scoringRules ?? 'baseball'}
          disabled={blocked || state.log.some(entry => entry.pitch || entry.result || entry.runnerId || entry.errors)}
          onChange={event => {
            const rules = event.currentTarget.value;
            if (rules === 'baseball' || rules === 'softball-fastpitch' || rules === 'softball-modified' || rules === 'softball-slowpitch')
              void run({ kind: 'rules', rules });
          }}>
          {Object.entries(scoringRuleLabels).filter(([rules]) => !state.seed.sport ||
            (state.seed.sport === 'baseball') === (rules === 'baseball')).map(([rules, label]) => <option key={rules} value={rules}>{label}</option>)}
        </select>
      </label>
    </details>
    {phase !== 'pitch' ? <button type="button" className="managerButtonOutline" disabled={busy}
      onClick={back}>{phase === 'out' ? 'Volver a IN PLAY' : 'Volver a lanzamientos'}</button> : null}
    <div className="predeterminedPlayGroups">
      <section className="predeterminedPlayGroup" aria-label="Lanzamientos" data-scoring-phase="pitch" data-active={true}>
        <h3 tabIndex={-1}>Lanzamientos</h3>
        <div className="predeterminedPlayButtons predeterminedPitchButtons">
          {(['strike', 'foul', 'ball'] as const).map((value, index) => <button key={value} type="button" className="managerButtonSolid"
            disabled={blocked || draftOpen}
            onClick={() => {
              if (value === 'strike' && state.strikes === 2) { setStrikeout('pitch'); setError(''); }
              else void run({ kind: 'pitch', value });
            }}>{['Strike', 'Foul', 'Bola'][index]}</button>)}
          <button type="button" className="managerButtonSolid privateInPlayButton" disabled={blocked || draftOpen || phase !== 'pitch'}
            aria-expanded={phase !== 'pitch'} onClick={() => setPhase('inPlay')}>IN PLAY</button>
        </div>
        {strikeout ? <fieldset className="privateMultipleOut" disabled={blocked} data-strikeout-choice tabIndex={-1}>
          <legend>Ponche · ¿Cómo fue el tercer strike?</legend>
          <p>Si el receptor lo retuvo, elige el tipo para registrar el ponche y el out.</p>
          <div className="predeterminedPlayButtons">
            {(['swinging', 'looking'] as const).map(type => <button key={type} type="button" className="managerButtonOutline privatePlayOut"
              onClick={() => void run(strikeout === 'pitch' ? { kind: 'pitch', value: 'strike', strikeoutType: type } :
                { kind: 'play', result: 'strikeout', strikeoutType: type })}>{strikeoutLabels[type]}</button>)}
            <button type="button" className="managerButtonOutline" disabled={Boolean(scoringPlayRestriction(state, 'droppedThirdStrike'))}
              title={scoringPlayRestriction(state, 'droppedThirdStrike') ?? undefined}
              onClick={() => openDetails('droppedThirdStrike')}>El receptor no lo retuvo</button>
            <button type="button" className="managerButtonOutline" onClick={() => { setStrikeout(null); setError(''); }}>Cancelar ponche</button>
          </div>
        </fieldset> : null}
        {detail === 'droppedThirdStrike' ? detailForm : null}
      </section>
      {predeterminedPlayGroups.map(group => {
        const groupPhase = group.tone === 'out' ? 'out' : 'inPlay';
        return <section key={group.title} className="predeterminedPlayGroup" aria-label={group.title}
          data-scoring-phase={groupPhase} data-active={phase === groupPhase}>
        <h3 tabIndex={-1}>{group.title}</h3>
        <div className="predeterminedPlayButtons">
          {group.results.filter(result => result !== 'fieldersChoice' || choices.length > 0).map(result => {
            const type = battedBallTypeForLog({ result });
            return <Fragment key={result}><button type="button"
            className={`managerButtonOutline ${group.tone === 'out' ? 'privatePlayOut' : 'privatePlayOnBase'}`}
            title={scoringPlayRestriction(state, result) ?? undefined}
            disabled={blocked || draftOpen || phase !== groupPhase || !multipleAllowed(result) || Boolean(scoringPlayRestriction(state, result))}
            onClick={() => choosePlay(result)}>{type ?
              battedBallLabels[type] : result === 'homeRun' ? `${playLabels[result]} (HR)` : playLabels[result]}</button>
            {result === 'fieldersChoice' && twoOutChoices.length > 0 ? <button type="button" className="managerButtonOutline privatePlayOnBase"
              disabled={blocked || draftOpen || phase !== 'inPlay'} onClick={() => openDetails('fieldersChoice', false, true)}>Jugada de selección · 2 outs</button> : null}
            {result === 'fieldersChoice' ? <button type="button" className="managerButtonOutline privatePlayOnBase"
              disabled={blocked || draftOpen || phase !== 'inPlay'} onClick={() => openDetails('fieldersChoice', true)}>Selección + error</button> : null}
          </Fragment>;
          })}
          {group.tone === 'out' ? <button type="button" className="managerButtonOutline privatePlayOut"
            disabled={blocked || draftOpen || phase !== 'out' || Boolean(scoringInfieldFlyRestriction(state))}
            title={scoringInfieldFlyRestriction(state) ?? undefined}
            onClick={() => { openDetails('flyOut'); setInfieldFly(true); }}>Infield fly</button> : null}
          {group.tone === 'onBase' ? <>
            {(['single', 'double', 'triple'] as const).map(result => <button type="button" key={`${result}-error`}
              className="managerButtonOutline privatePlayOnBase"
              disabled={blocked || phase !== 'inPlay' || Boolean(detail) || strikeout !== null}
              onClick={() => openDetails(result, true)}>{playLabels[result]} + error</button>)}
            <button type="button" className="managerButtonSolid"
            disabled={blocked || Boolean(detail) || strikeout !== null || phase !== 'inPlay'} aria-expanded={phase === 'out'} onClick={() => setPhase('out')}>OUT</button>
          </> : null}
        </div>
      </section>;
      })}
    </div>
    {detail !== 'droppedThirdStrike' ? detailForm : null}
    {outType ? <fieldset ref={battedOutPanel} tabIndex={-1} className="privateMultipleOut privateBattedOut" disabled={blocked || staleOut} data-batted-out>
      <legend>{battedBallLabels[outType]} · Confirmar jugada</legend>
      {staleOut ? <p role="alert">El partido cambió. Cancela esta selección y revisa la pizarra antes de anotar.</p> : null}
      <div className="managerButtonRow" role="group" aria-label="Cantidad de outs de la jugada">
        {([null, 'doublePlay', 'triplePlay'] as const).map((result, index) => <button key={index} type="button"
          className="managerButtonOutline" aria-pressed={multipleOut === result}
          disabled={state.outs + index + 1 > 3 || runners.length < index}
          onClick={() => {
            setMultipleOut(result); setSelectedRunners([]); setSacrifice(false);
            if ((outType === 'line' || outType === 'fly') && (result === null) !== (multipleOut === null)) {
              setCaughtBy(null); setFieldingSequence([]);
            }
            setError('');
            setDestinations(minimumDestinations(state, battedOutResults[outType]));
          }}>{result ? playLabels[result] : 'Out sencillo'}</button>)}
      </div>
      {simpleCatch ? <div data-caught-ball>
        <h4>¿Quién atrapó {outType === 'line' ? 'la línea' : 'el elevado'}?</h4>
        <p>El out corresponde a quien la atrapó de aire. Elige un defensor; cambiar la elección no agrega una vía ni otro out.</p>
        {!defensivePositions(state).some(position => defensivePlayerAt(state, position.number)) ?
          <p role="status">Asigna las posiciones en la alineación defensiva para identificar quién atrapó la pelota.</p> : null}
        <div className="privateFieldingPositions" role="group" aria-label="Defensor que atrapó la pelota">
          {defensivePositions(state).map(position => {
            const fielder = defensivePlayerAt(state, position.number);
            const label = `${position.number} · ${position.label}`;
            return <button key={position.number} type="button" className="managerButtonOutline"
              aria-label={label} aria-description={fielder?.name} aria-pressed={caughtBy?.playerId === fielder?.id && Boolean(fielder)}
              disabled={blocked || staleOut || !fielder} onClick={() => {
                if (!fielder) { setError('Esa posición no tiene un defensor activo. Revisa la alineación.'); return; }
                setCaughtBy({ playerId: fielder.id, position: position.number }); setError('');
              }}><span>{label}<br /><small>{fielder?.name ?? 'Sin defensor activo'}</small></span></button>;
          })}
        </div>
        {caughtBy ? <p><strong>La atrapó: {playerName(state, caughtBy.playerId)}.</strong> Un solo out del bateador.</p> : null}
      </div> : <DefensiveRouteFields state={state} sequence={fieldingSequence} onChange={changeSequence}
        outs={requiredRunners + 1} outAt={outAt} onOutAtChange={setOutAt} disabled={blocked || staleOut} />}
      <p><strong>Bateador eliminado: {playerName(state, batter)}.</strong>
        {multipleOut ? automaticRunners ?
          requiredRunners === 1 ? ' El único corredor en base también queda eliminado.' : ' Los dos corredores en base también quedan eliminados.' :
          ` Selecciona ${requiredRunners === 1 ? 'el corredor eliminado' : 'los dos corredores eliminados'}.` :
          ' Los corredores permanecen donde estaban salvo que indiques un avance.'}</p>
      {runners.map(id => <div key={id} className="privateBattedRunner">
        {automaticRunners ? <p>{`Corredor en ${state.bases.indexOf(id) + 1}.ª · ${playerName(state, id)} · eliminado`}</p> :
          multipleOut ? <label><input type="checkbox" checked={selected.includes(id)} onChange={event => {
          const checked = event.currentTarget.checked;
          setSelectedRunners(values => checked ? [...values.filter(value => runners.includes(value)), id] : values.filter(value => value !== id));
        }} /> {`Corredor en ${state.bases.indexOf(id) + 1}.ª · ${playerName(state, id)} · eliminado`}</label> : null}
        {!selected.includes(id) ? <label className="managerField"><span>{`Destino desde ${state.bases.indexOf(id) + 1}.ª · ${playerName(state, id)}`}</span>
          <select value={destinations[id] ?? state.bases.indexOf(id) + 1}
            onChange={event => {
              const value = Number(event.currentTarget.value);
              if (value === 1 || value === 2 || value === 3 || value === 4) changeDestination(id, value);
            }}>
            {([1, 2, 3, 4] as const).filter(base => base >= state.bases.indexOf(id) + 1).map(base =>
              <option key={base} value={base}>{base === 4 ? 'Home' : `${base}.ª base`}</option>)}
          </select></label> : null}
      </div>)}
      {!multipleOut && (outType === 'fly' || outType === 'bunt') ? <>
        <label className="privateBattedSacrifice">
          <input type="checkbox" checked={sacrifice} disabled={Boolean(sacrificeRestriction)}
            title={sacrificeRestriction ?? undefined} onChange={event => changeSacrifice(event.currentTarget.checked)} />
          {outType === 'fly' ? 'Registrar elevado de sacrificio (SF)' : 'Registrar toque de sacrificio (SH)'}
        </label>
        {sacrificeRestriction ? <p>{sacrificeRestriction}</p> : null}
      </> : null}
      <button type="button" className="managerButtonSolid"
        disabled={blocked || staleOut || Boolean(catchIssue) || incompleteCredits(requiredRunners + 1) || !outSequence.length || selected.length !== requiredRunners ||
          !outResult || !multipleAllowed(outResult) || sacrifice && Boolean(sacrificeRestriction)}
        onClick={confirmOut}>Confirmar out por batazo</button>
    </fieldset> : null}
    {outType ? <button type="button" className="managerButtonOutline" disabled={busy} onClick={back}>Cancelar out por batazo</button> : null}
    <button type="button" className="managerButtonOutline privateUndoButton" disabled={undoDisabled || busy || draftOpen} onClick={onUndo}>Deshacer última anotación</button>
    <p>Los robos, pickoffs, lanzamientos descontrolados, balks y avances siguen disponibles al tocar las bases.</p>
  </fieldset>;
}
