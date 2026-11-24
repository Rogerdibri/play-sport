import { battedBallLabels, battedOutResults, defensivePositions, scoringPlayRestriction,
  type BattedBallType, type PrivateState } from './private-scorecard';

export default function DefensiveRouteFields({ state, sequence, onChange, ballType, onBallTypeChange, disabled = false,
  outs = 1, outAt = [], onOutAtChange }: {
  state: PrivateState; sequence: number[]; onChange: (_sequence: number[]) => void; // eslint-disable-line no-unused-vars
  ballType?: BattedBallType | ''; onBallTypeChange?: (_type: BattedBallType) => void; // eslint-disable-line no-unused-vars
  disabled?: boolean;
  outs?: number; outAt?: number[]; onOutAtChange?: (_indices: number[]) => void; // eslint-disable-line no-unused-vars
}) {
  return <div className="privateDefensiveRoute privateBattedOut" data-defensive-route>
    {onBallTypeChange ? <div className="managerButtonRow" role="group" aria-label="Tipo de batazo">
      {(['ground', 'line', 'fly', 'bunt'] as const).map(type => {
        const label = battedBallLabels[type];
        const restriction = scoringPlayRestriction(state, battedOutResults[type]);
        return <button key={type} type="button" className="managerButtonOutline" aria-label={`Tipo de batazo: ${label}`}
          aria-pressed={ballType === type} disabled={disabled || Boolean(restriction)} title={restriction ?? undefined}
          onClick={() => onBallTypeChange(type)}>{label}</button>;
      })}
    </div> : null}
    <p>Marca las posiciones en el orden en que tocaron la pelota. Puedes repetir una posición; la vía no determina cuántos outs hubo.</p>
    <div className="privateFieldingPositions" role="group" aria-label="Posiciones que participaron, en orden">
      {defensivePositions(state).map(position => <button key={position.number} type="button" className="managerButtonOutline"
        disabled={disabled || sequence.length >= 20} onClick={() => onChange([...sequence, position.number])}>
        {`${position.number} · ${position.label}`}</button>)}
    </div>
    <p>Vía: <output aria-label="Vía defensiva" aria-live="polite">{sequence.length ? sequence.join('-') : 'Sin indicar'}</output></p>
    {outs > 1 && onOutAtChange ? <div className="gameReviewCounts">
      {Array.from({ length: outs }, (_, index) => <label key={index} className="managerField">
        <span>Quién realizó el out {index + 1}</span>
        <select aria-label={`Paso del recorrido del out ${index + 1}`} value={outAt[index] >= 0 ? outAt[index] : ''} disabled={disabled || !sequence.length}
          onChange={event => onOutAtChange(Array.from({ length: outs }, (_, position) =>
            position === index ? event.target.value === '' ? -1 : Number(event.target.value) : outAt[position] ?? -1))}>
          <option value="">Marca el momento del out</option>
          {sequence.map((number, step) => <option key={step} value={step}>
            Paso {step + 1} · {number} · {defensivePositions(state).find(position => position.number === number)?.label}
          </option>)}
        </select>
      </label>)}
    </div> : null}
    <div className="managerButtonRow">
      <button type="button" className="managerButtonOutline" disabled={disabled || !sequence.length}
        onClick={() => onChange(sequence.slice(0, -1))}>Quitar último defensor</button>
      <button type="button" className="managerButtonOutline" disabled={disabled || !sequence.length}
        onClick={() => onChange([])}>Limpiar vía</button>
    </div>
  </div>;
}
