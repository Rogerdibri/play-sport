'use client';

import { useState, type Dispatch } from 'react';
import { runTotals, type AccountedRun, type RunReview } from '@playsport/shared';

export function ErrorOutsField({ value, onChange, disabled = false, runnerOnly = false, required = true }: {
  value: string; onChange: Dispatch<string>; disabled?: boolean; runnerOnly?: boolean; required?: boolean;
}) {
  return <label className="managerField">
    <span>¿Cuántos outs evitó el error?</span>
    <select aria-label="¿Cuántos outs evitó el error?" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} required={required}>
      <option value="">Selecciona el efecto del error</option>
      <option value="0">0 · Solo permitió avanzar</option>
      <option value="1">1 · Debió producir un out</option>
      {!runnerOnly ? <><option value="2">2 · Debió producir dos outs</option>
        <option value="3">3 · Debió producir tres outs</option></> : null}
    </select>
  </label>;
}

function ReviewForm({ run, disabled, onReview }: {
  run: AccountedRun; disabled: boolean; onReview: Dispatch<RunReview>;
}) {
  const [team, setTeam] = useState('');
  const [pitcher, setPitcher] = useState('');
  const [note, setNote] = useState('');
  return <form className="privateRunReview" onSubmit={(event) => {
    event.preventDefault();
    if ((team !== 'earned' && team !== 'unearned') || (pitcher !== 'earned' && pitcher !== 'unearned') || !note.trim()) return;
    onReview({ eventId: run.eventId, runnerId: run.runnerId, team, pitcher, note });
  }}>
    <label className="managerField"><span>Para el equipo</span>
      <select aria-label="Para el equipo" value={team} onChange={(event) => setTeam(event.target.value)} disabled={disabled} required>
        <option value="">Reconstruir entrada</option>
        <option value="earned">Limpia</option><option value="unearned">Sucia</option>
      </select>
    </label>
    <label className="managerField"><span>Para el lanzador responsable</span>
      <select aria-label="Para el lanzador responsable" value={pitcher} onChange={(event) => setPitcher(event.target.value)} disabled={disabled} required>
        <option value="">Considerar su relevo</option>
        <option value="earned">Limpia</option><option value="unearned">Sucia</option>
      </select>
    </label>
    <label className="managerField"><span>Justificación de la reconstrucción</span>
      <input value={note} onChange={(event) => setNote(event.target.value)} disabled={disabled} required />
    </label>
    <button className="managerButtonOutline" type="submit"
      disabled={disabled || !team || !pitcher || !note.trim()}>Guardar revisión de carrera</button>
  </form>;
}

const labels = { earned: 'Limpia', unearned: 'Sucia', pending: 'Pendiente de revisión' };

export default function RunAccountingPanel({ runs, name, disabled, onReview, readOnly = false }: {
  runs: AccountedRun[];
  name: (id: string) => string; // eslint-disable-line no-unused-vars
  disabled: boolean;
  onReview: Dispatch<RunReview>;
  readOnly?: boolean;
}) {
  const totals = runTotals(runs, 'team');
  const pitchers = [...new Set(runs.map((run) => run.pitcherId))];
  return <details className="managerCard privateRunAccounting">
    <summary>Carreras limpias y sucias · CL {totals.earned} · CS {totals.unearned} · Pendientes {totals.pending}</summary>
    <p>CL: limpias. CS: sucias. Las pendientes no se cuentan como limpias ni como sucias. La responsabilidad corresponde al lanzador que dejó al corredor, aunque anote durante un relevo.</p>
    {pitchers.length ? <div className="scorecardTableScroll"><table className="scorecardTable" aria-label="Carreras permitidas por lanzador">
      <thead><tr><th scope="col">Lanzador responsable</th><th scope="col">Carreras</th><th scope="col">CL</th><th scope="col">CS</th><th scope="col">Pendientes</th></tr></thead>
      <tbody>{pitchers.map((id) => {
        const stats = runTotals(runs.filter((run) => run.pitcherId === id), 'pitcher');
        return <tr key={id ?? 'unidentified'}><th scope="row">{id ? name(id) : 'Sin lanzador identificado'}</th>
          <td>{stats.total}</td><td>{stats.earned}</td><td>{stats.unearned}</td><td>{stats.pending}</td></tr>;
      })}</tbody>
    </table></div> : <p>Todavía no hay carreras anotadas.</p>}
    {runs.map((run) => <details key={`${run.eventId}:${run.runnerId}`}>
      <summary>Jugada {run.eventId} · {run.runnerId ? name(run.runnerId) : `${run.count} carrera(s) sin identificar`} · {labels[run.team]}</summary>
      <p>Equipo: {labels[run.team]}. Lanzador: {labels[run.pitcher]}{run.pitcherId ? ` · ${name(run.pitcherId)}` : ' · Sin identificar'}.</p>
      {run.reviewed ? <p>Revisión del anotador: {run.note}</p> : run.note ? <p>{run.note}</p> : null}
      <p>Revisa si habría anotado sin errores ni bolas pasadas, considerando los outs que debieron ocurrir. El criterio del equipo y el del relevista pueden ser distintos.</p>
      {!readOnly ? <ReviewForm run={run} disabled={disabled} onReview={onReview} /> : null}
    </details>)}
  </details>;
}
