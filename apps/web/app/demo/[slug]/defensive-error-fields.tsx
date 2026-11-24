import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { type DefensiveError, type PrivateCommand, type PrivateState, fieldPositionLabels } from './private-scorecard';

export function DefensiveErrorFields({ state, errors, onChange, obstruction = false }: {
  state: PrivateState; errors: DefensiveError[]; obstruction?: boolean; onChange: (_errors: DefensiveError[]) => void; // eslint-disable-line no-unused-vars
}) {
  const defense = state.lineups[state.side === 'away' ? 'home' : 'away'].filter(player => !['NA', 'DH'].includes(player.position));
  return <fieldset className="scoringErrorFields">
    <legend>{obstruction ? 'Obstrucción defensiva' : 'Errores defensivos'}</legend>
    <p>{obstruction ? 'Identifica al defensor que obstruyó al corredor. Se carga un error por esta obstrucción, no uno por cada base concedida.' :
      'Identifica cada error; una bola pasada o un lanzamiento descontrolado no son errores defensivos.'}</p>
    {errors.map((error, index) => <fieldset key={index}>
      <legend>Error {index + 1}</legend>
      <label className="managerField"><span>Posición y defensor responsable</span>
        <select value={error.playerId} required onChange={event => {
          const player = defense.find(candidate => candidate.id === event.currentTarget.value);
          onChange(errors.map((entry, position) => position === index ?
            { ...entry, playerId: player?.id ?? '', position: player?.position ?? '' } : entry));
        }}>
          <option value="">Selecciona el defensor</option>
          {defense.map(player => <option key={player.id} value={player.id}>{player.position} · {player.name}</option>)}
        </select>
        {error.playerId ? <small>{fieldPositionLabels[error.position]} · {defense.find(player => player.id === error.playerId)?.name}</small> : null}
      </label>
      {!obstruction ? <label className="managerField"><span>Tipo de error</span>
        <select value={error.type} onChange={event => {
          const type = event.currentTarget.value;
          if (type === 'fielding' || type === 'throwing') onChange(errors.map((entry, position) => position === index ? { ...entry, type } : entry));
        }}><option value="fielding">Fildeo / recepción</option><option value="throwing">Tiro</option></select>
      </label> : null}
      {!obstruction && errors.length > 1 ? <button type="button" className="managerButtonOutline"
        onClick={() => onChange(errors.filter((_, position) => position !== index))}>Quitar error {index + 1}</button> : null}
    </fieldset>)}
    {!obstruction ? <button type="button" className="managerButtonOutline" disabled={errors.length >= 9}
      onClick={() => onChange([...errors, { playerId: '', position: '', type: 'fielding' }])}>Añadir otro error</button> : null}
  </fieldset>;
}

export function DefensiveErrorConfirmation({ state, command, onConfirm, onCancel }: {
  state: PrivateState; command: PrivateCommand;
  onConfirm: (_command: PrivateCommand) => Promise<boolean>; // eslint-disable-line no-unused-vars
  onCancel: () => void;
}) {
  const obstruction = command.kind === 'runner' && command.action === 'obstruction';
  const [errors, setErrors] = useState<DefensiveError[]>([{ playerId: '', position: '', type: obstruction ? 'obstruction' : 'fielding' }]);
  const [busy, setBusy] = useState(false);
  const panel = useRef<ComponentRef<'section'>>(null);
  useEffect(() => { panel.current?.scrollIntoView({ block: 'center' }); panel.current?.focus(); }, []);
  return <section ref={panel} tabIndex={-1} className="managerCard" aria-label="Completar error defensivo"
    data-advance-cause={obstruction ? 'obstruction' : undefined}>
    <h3>Completar error defensivo</h3>
    <fieldset disabled={busy}>
      <DefensiveErrorFields state={state} errors={errors} onChange={setErrors} obstruction={obstruction} />
      <button type="button" className="managerButtonSolid" disabled={errors.some(error => !error.playerId)}
        onClick={async () => {
          if (!['play', 'runner', 'misplay'].includes(command.kind)) return;
          setBusy(true);
          try {
            if (command.kind === 'play' || command.kind === 'runner' || command.kind === 'misplay')
              if (await onConfirm({ ...command, errors })) onCancel();
          } finally { setBusy(false); }
        }}>Confirmar error y jugada</button>
      <button type="button" className="managerButtonOutline" onClick={onCancel}>Cancelar error</button>
    </fieldset>
  </section>;
}
