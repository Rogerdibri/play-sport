import { playerName, privateFieldingStats, type PrivateState, type Side } from './private-scorecard';

export default function DefensiveErrorsSheet({ state, side }: { state: PrivateState; side: Side }) {
  const fielding = privateFieldingStats(state, side);
  return <section className="privateDefense" aria-label={`Errores defensivos de ${state.seed.names[side]}`}>
    <h3>Defensa · Errores por entrada</h3>
    <p><strong>E: {fielding.errors ?? '—'}</strong> · total del equipo</p>
    {fielding.incomplete ? <p role="status">Historial defensivo incompleto: se muestran los errores disponibles, no un total definitivo.</p> : null}
    {fielding.unattributed ? <p role="status">{fielding.unattributed} sin atribuir. No se asignan a ningún jugador; sus totales individuales quedan pendientes.</p> : null}
    {fielding.entries.length ? <ol className="privateDefensiveErrors">
      {fielding.entries.map(entry => <li key={`${entry.logIndex}-${entry.errorIndex}`}>
        <strong>Entrada {entry.inning} · {entry.playerId ? playerName(state, entry.playerId) : 'Sin atribuir'}</strong>
        <p>{entry.position ?? 'Sin posición registrada'} · {entry.type === 'obstruction' ? 'Error por obstrucción defensiva' : entry.type === 'throwing' ? 'Error de tiro' :
          entry.type === 'fielding' ? 'Error de fildeo / recepción' : 'Tipo no registrado'}</p>
        <p>{entry.text}</p>
      </li>)}
    </ol> : <p>{fielding.incomplete ? 'Sin detalle defensivo disponible.' : 'Sin errores defensivos registrados.'}</p>}
  </section>;
}
