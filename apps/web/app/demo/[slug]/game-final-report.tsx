'use client';
/* eslint-env browser */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createGameReport, defensivePlayContext, finalReviewIssue, gameReportPitcherAppeared, gameReportPlayer,
  readGameReport, statisticsInnings, statisticsMetrics,
  type FinalFieldingEvidence, type FinalPitchingEvidence, type GameFinalReview, type GameReport,
  type GameReportPlayer, type PrivateState, type StatisticsLine
} from '@playsport/shared';

const number = (value: number | null, precision = 0) => value === null ? 'ND' :
  precision === 3 ? value.toFixed(precision).replace(/^0(?=\.)/, '') : precision ? value.toFixed(precision) : String(value);
type Metric = { key: string; label: string; description: string; precision: number };
function StatisticsTable({ title, players, totals, group, metrics }: {
  title: string; players: GameReportPlayer[]; totals: StatisticsLine; group: keyof StatisticsLine; metrics: readonly Metric[];
}) {
  const cells = (line: StatisticsLine) => {
    const data: Record<string, number | null> = line[group];
    return metrics.map(metric => <td key={metric.key} title={data[metric.key] === null ? 'No disponible: falta respaldo o el denominador es cero.' : undefined}>
      {metric.key === 'outs' ? data.outs === null ? 'ND' : statisticsInnings(data.outs) : number(data[metric.key], metric.precision)}
    </td>);
  };
  return <section className="gameReportStatistics">
    <h3>{title}</h3>
    <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label={`${title}, desplazamiento horizontal`}>
      <table className="scorecardTable gameReportTable">
        <thead><tr><th scope="col">Jugador</th>{metrics.map(metric => <th scope="col" key={metric.key}>
          <abbr title={metric.description}>{metric.label}</abbr>
        </th>)}</tr></thead>
        <tbody>{players.map(player => <tr key={player.key}>
          <th scope="row">{player.order !== null ? `${player.order} · ` : ''}{player.name}{player.jersey ? ` · #${player.jersey}` : ''}</th>
          {cells(player.line)}
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Equipo</th>{cells(totals)}</tr></tfoot>
      </table>
    </div>
  </section>;
}
export default function GameFinalReport({ report, onBack, onExit, showDetails = true }: {
  report: GameReport; onBack: () => void; onExit: () => void; showDetails?: boolean;
}) {
  const detailed = report.detailed && showDetails;
  const heading = useRef<HTMLHeadingElement>(null);
  const printId = useRef(0);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); }, []);
  useEffect(() => {
    const result = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : null;
      if (!detail || typeof detail !== 'object' || !('requestId' in detail) || detail.requestId !== printId.current) return;
      setPrinting(false);
      if (!('ok' in detail) || detail.ok !== true) setPrintError('message' in detail && typeof detail.message === 'string' ?
        detail.message : 'No se pudo imprimir el resumen.');
    };
    window.addEventListener('playsport:print-result', result);
    return () => window.removeEventListener('playsport:print-result', result);
  }, []);
  const print = () => {
    setPrintError('');
    try {
      if ('ReactNativeWebView' in window && window.ReactNativeWebView && typeof window.ReactNativeWebView === 'object' &&
          'postMessage' in window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
        const element = heading.current?.closest('.gameFinalReport')?.cloneNode(true);
        if (!(element instanceof HTMLElement)) throw new Error('No se pudo preparar el resumen para imprimir.');
        element.querySelectorAll('.gameReportActions, details').forEach(node => node.remove());
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>
          @page{size:A4 landscape;margin:10mm}body{font:12px sans-serif;color:#111}
          table{width:100%;border-collapse:collapse;font-size:10px;margin:12px 0}
          th,td{border:1px solid #d9e0e8;padding:4px 6px;text-align:center}th:first-child{text-align:left}
          thead{display:table-header-group}tfoot{display:table-row-group;font-weight:bold}
          thead th{background:#16171b;color:white}tr{break-inside:avoid}h2,h3{break-after:avoid}
          .gameReportHonors{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}.gameReportScrollHint{display:none}
          dt{font-weight:bold}dd{margin:4px 0}.scorecardTableScroll{overflow:visible}
          </style></head><body>${element.outerHTML}</body></html>`;
        setPrinting(true);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'playsport:print-report', requestId: ++printId.current, html }));
      } else window.print();
    } catch (failure) {
      setPrinting(false); setPrintError(failure instanceof Error ? failure.message : 'No se pudo imprimir el resumen.');
    }
  };
  const pending = report.reviewed ? 'No adjudicado' : 'Pendiente de confirmación';
  return <article className="gameFinalReport" aria-label="Resumen final del partido">
    <header className="managerCard gameReportHeader">
      <p className="eyebrow">{report.source === 'official' ? 'RESULTADO OFICIAL' :
        report.source === 'friendly' ? 'AMISTOSO PRIVADO · NO OFICIAL' :
          report.source === 'practice' ? 'PRÁCTICA DE ANOTACIÓN' : 'SEGUIMIENTO PRIVADO · NO OFICIAL'}</p>
      <h2 ref={heading} tabIndex={-1}>{report.source === 'official' ? 'Resumen final del partido' :
        report.source === 'friendly' ? 'Resumen final del amistoso' :
          report.source === 'practice' ? 'Resumen final · práctica de anotación' : 'Resumen del seguimiento privado'}</h2>
      <p><strong>{report.teams.away.name} {report.teams.away.runs} – {report.teams.home.runs} {report.teams.home.name}</strong></p>
      {report.metadata ? <p>{[report.metadata.tournament, report.metadata.date, report.metadata.time, report.metadata.venue,
        report.metadata.revision !== null ? `Revisión ${report.metadata.revision}` : null].filter(Boolean).join(' · ')}</p> : null}
      {report.rules ? <p>{report.rules}{report.eraBase ? ` · PCL sobre ${report.eraBase} entradas` : ''}</p> : null}
      <p className="gameReportScrollHint">Desliza las tablas para ver todas sus columnas.</p>
      <div className="managerButtonRow gameReportActions">
        <button type="button" className="managerButtonSolid" disabled={printing} onClick={print}>{printing ? 'Preparando impresión…' : 'Imprimir / guardar PDF'}</button>
        <button type="button" className="managerButtonOutline" onClick={onBack}>Volver a la hoja de anotación</button>
        <button type="button" className="managerButtonOutline" onClick={onExit}>Volver al partido</button>
      </div>
      {printError ? <p className="managerWarning" role="alert">{printError}</p> : null}
    </header>
    <section className="managerCard gameReportSection">
      <h3>Pizarra por entradas</h3>
      <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label="Marcador por entradas, desplazamiento horizontal">
        <table className="scorecardTable gameReportTable">
          <thead><tr><th scope="col">Equipo</th>{report.innings.map(inning => <th scope="col" key={inning}>{inning}</th>)}
            <th scope="col">C</th><th scope="col">H</th><th scope="col">E</th>{detailed ? <th scope="col">LOB</th> : null}</tr></thead>
          <tbody>{(['away', 'home'] as const).map(side => <tr key={side}>
            <th scope="row">{report.teams[side].name}</th>{report.teams[side].innings.map((runs, index) => <td key={index}>{runs === null ? '—' : runs}</td>)}
            <td>{report.teams[side].runs}</td><td>{number(report.teams[side].hits)}</td><td>{number(report.teams[side].errors)}</td>
            {detailed ? <td>{number(report.teams[side].leftOnBase)}</td> : null}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="managerCard gameReportSection">
      <h3>Decisiones y reconocimientos</h3>
      <dl className="gameReportHonors">{([
        ['winner', 'Pitcher ganador'], ['loser', 'Pitcher perdedor'], ['saver', 'Pitcher salvador'],
        ['bestBatter', 'Mejor bate'], ['mvp', 'MVP']
      ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{report.honors[key] ?? pending}</dd></div>)}</dl>
      {report.rulesReference ? <p>Reglamento y criterio confirmado: {report.rulesReference}</p> : null}
      {report.note ? <p>{report.note}</p> : null}
    </section>
    {!detailed ? <p className="managerWarning" role="status">
      Resumen básico. Las cifras detalladas requieren un plan; por ahora solo están habilitadas para la cuenta maestra de pruebas.
    </p> : (['away', 'home'] as const).map(side => {
      const team = report.teams[side], players = team.players!, totals = team.totals!;
      const pitchers = players.filter(player => player.line.pitching.G === 1 ||
        player.positions.includes('P') && player.line.pitching.G === null);
      const fielders = players.filter(player => player.positions.some(position => !['NA', 'DH'].includes(position)));
      const counts = statisticsMetrics.batting.filter(metric => metric.precision === 0);
      return <section className="managerCard gameReportSection" key={side}>
        <h2>{team.name}</h2>
        <StatisticsTable title="Bateo y corrido · producción" players={players} totals={totals} group="batting" metrics={counts.slice(0, 13)} />
        <StatisticsTable title="Bateo y corrido · detalle" players={players} totals={totals} group="batting" metrics={counts.slice(13)} />
        <StatisticsTable title="Promedios ofensivos" players={players} totals={totals} group="batting"
          metrics={statisticsMetrics.batting.filter(metric => metric.precision > 0)} />
        <StatisticsTable title="Pitcheo · resultados y trabajo" players={pitchers} totals={totals} group="pitching" metrics={statisticsMetrics.pitching.slice(0, 14)} />
        <StatisticsTable title="Pitcheo · efectividad" players={pitchers} totals={totals} group="pitching" metrics={statisticsMetrics.pitching.slice(14)} />
        <section className="gameReportStatistics">
          <h3>Conteos confirmados del pitcheo</h3>
          <div className="scorecardTableScroll" tabIndex={0} role="region" aria-label="Conteos confirmados, desplazamiento horizontal">
            <table className="scorecardTable gameReportTable">
              <thead><tr><th scope="col">Pitcher</th><th scope="col">Lanzamientos totales</th><th scope="col">Strikes totales</th>
                <th scope="col">WP</th><th scope="col">BK</th></tr></thead>
              <tbody>{pitchers.map(player => <tr key={player.key}><th scope="row">{player.name}</th>
                <td>{number(player.pitching.pitches)}</td><td>{number(player.pitching.strikes)}</td>
                <td>{number(player.pitching.wildPitches)}</td><td>{number(player.pitching.balks)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <StatisticsTable title="Defensa" players={fielders} totals={totals} group="fielding" metrics={statisticsMetrics.fielding} />
      </section>;
    })}
    {detailed ? <section className="managerCard gameReportSection">
      <h3>Jonrones del partido</h3>
      {report.homeRuns?.length ? <ul>{report.homeRuns.map((entry, index) => <li key={index}>
        {entry.batter} · {entry.inning}.ª entrada · pitcher: {entry.pitcher ?? 'No disponible'} · {entry.rbis} CI
        {entry.insidePark ? ' · dentro del campo' : ''}
      </li>)}</ul> : <p>No hay jonrones registrados.</p>}
    </section> : null}
    <section className="managerCard gameReportSection gameReportNotes">
      <p>ND: no disponible, dato sin respaldo o cálculo sin denominador. —: media entrada no disputada.</p>
      {report.warnings.map(warning => <p key={warning} role="status">{warning}</p>)}
      {detailed ? <details><summary>Fórmulas y alcance</summary> 
        <p>AVG = H/VB. OBP = (H+BB+GP)/(VB+BB+GP+SF). SLG = (1B+2×2B+3×3B+4×HR)/VB. OPS = OBP+SLG.</p>
        <p>PCL = CL×base reglamentaria/IP. WHIP = (H+BB)/IP. FLD = (PO+A)/(PO+A+E).</p>
        <p>IP se calcula con outs/3; 5.1 son cinco entradas y un out, no 5,1 entradas decimales. LR y SR solo cuentan lanzamientos registrados, no un total estimado.</p>
        <p>WAR, OPS+, wOBA, FIP ajustado y métricas Statcast necesitan referencias de liga, constantes o mediciones adicionales; no se inventan con esta planilla.</p>
      </details> : null}
    </section>
  </article>;
}

const initialPitching = (): FinalPitchingEvidence => ({ pitches: null, strikes: null, wildPitches: null, balks: null });
const initialFielding = (): FinalFieldingEvidence => ({ putouts: null, assists: null, doublePlays: null, triplePlays: null, passedBalls: null });
export function GameFinalReviewForm({ state, detailed, disabled, onConfirm, onCancel }: {
  state: PrivateState; detailed: boolean; disabled: boolean;
  onConfirm: (_review: GameFinalReview) => Promise<boolean>; // eslint-disable-line no-unused-vars
  onCancel: () => void;
}) {
  const report = createGameReport(state, { source: 'private', detailed: true });
  const players = [...report.teams.away.players!, ...report.teams.home.players!];
  const [review, setReview] = useState<GameFinalReview>(() => ({
    confirmed: true, rulesReference: report.rules ?? '', note: '', winner: null, loser: null, saver: null,
    bestBatter: null, mvp: null, pitching: {}, fielding: {}
  }));
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const context = useRef(defensivePlayContext(state));
  const heading = useRef<HTMLHeadingElement>(null);
  const sending = useRef(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const stale = context.current !== defensivePlayContext(state);
  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' });
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); };
  }, []);
  const tie = state.scores.home === state.scores.away;
  const pitchers = players.filter(player => gameReportPitcherAppeared(state, player.key));
  const winnerSide = state.scores.home > state.scores.away ? 'home' : 'away';
  const options = (key: 'winner' | 'loser' | 'saver' | 'bestBatter' | 'mvp') => key === 'mvp' ? players :
    key === 'bestBatter' ? players.filter(player => {
      const member = gameReportPlayer(state.seed, player.key);
      return member && state.log.some(entry => entry.side === member.side && entry.batterId === member.player.id && entry.result !== null);
    }) :
      pitchers.filter(player => key === 'loser' ? !player.key.startsWith(`${winnerSide}:`) : player.key.startsWith(`${winnerSide}:`));
  const capture = (value: string) => value === '' ? null : Number(value);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    setError('');
    if (stale || !confirmed) { setError(stale ? 'La hoja cambió. Cancela y vuelve a revisar el cierre.' : 'Confirma la revisión antes de finalizar.'); return; }
    const issue = finalReviewIssue(state, review);
    if (issue) { setError(issue); return; }
    sending.current = true; setBusy(true);
    try {
      if (!await onConfirm(review)) setError('El cierre no se guardó. Revisa el error de la pizarra y vuelve a intentar.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el cierre.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <section className="managerCard gameFinalReview" aria-label="Revisión del resumen final">
    <h2 ref={heading} tabIndex={-1}>Revisar y finalizar el partido</h2>
    <p>Confirma las decisiones según el reglamento de la liga. MVP y mejor bate son reconocimientos oficiales confirmados, no premios calculados por un ranking.</p>
    <form onSubmit={event => { void submit(event); }}>
      <fieldset disabled={disabled || busy || stale} className="privateControls">
        <label className="managerField"><span>Reglamento y criterio aplicado</span>
          <input value={review.rulesReference} maxLength={500} required onChange={event => setReview({ ...review, rulesReference: event.target.value })} /></label>
        <div className="gameReviewChoices">{([
          ['winner', 'Pitcher ganador'], ['loser', 'Pitcher perdedor'], ['saver', 'Pitcher salvador'],
          ['bestBatter', 'Mejor bate'], ['mvp', 'MVP']
        ] as const).map(([key, label]) => <label className="managerField" key={key}><span>{label}</span>
          <select aria-label={label} value={review[key] ?? ''} disabled={tie && ['winner', 'loser', 'saver'].includes(key)}
            onChange={event => setReview({ ...review, [key]: event.target.value || null })}>
            <option value="">{tie && ['winner', 'loser', 'saver'].includes(key) ? 'No aplica: empate' : 'No adjudicado'}</option>
            {options(key).map(player => <option value={player.key} key={player.key}>{player.name}{player.jersey ? ` · #${player.jersey}` : ''}</option>)}
          </select>
        </label>)}</div>
        <details className="gameReviewEvidence">
          <summary>Completar conteos reales del pitcheo</summary>
          <p>No se estima un total de lanzamientos a partir de los turnos. Deja vacío lo que no puedas respaldar.</p>
          {pitchers.map(player => <fieldset key={player.key} className="gameReviewPlayer">
            <legend>{player.name}{detailed ? ` · IP ${statisticsInnings(player.line.pitching.outs)} · ${player.pitching.recorded} lanzamientos registrados` : ''}</legend>
            <div className="gameReviewCounts">{([
              ['pitches', 'Lanzamientos totales'], ['strikes', 'Strikes totales'], ['wildPitches', 'Wild pitches'], ['balks', 'Balks']
            ] as const).map(([key, label]) => <label className="managerField" key={key}><span>{label}</span>
              <input type="number" min="0" max="1000000" step="1" value={review.pitching[player.key]?.[key] ?? ''}
                aria-label={`${label} de ${player.name}`}
                onChange={event => setReview({ ...review, pitching: { ...review.pitching,
                  [player.key]: { ...(review.pitching[player.key] ?? initialPitching()), [key]: capture(event.target.value) } } })} />
            </label>)}</div>
          </fieldset>)}
        </details>
        <details className="gameReviewEvidence">
          <summary>Completar créditos defensivos que falten</summary>
          <p>Los recorridos completos calculan los créditos automáticamente. Completa solo lo respaldado por la anotación; no reemplaces una jugada incorrecta con un total.</p>
          {players.filter(player => player.positions.some(position => !['NA', 'DH'].includes(position)) &&
            (['PO', 'A', 'DP', 'TP', 'PB'] as const).some(metric => player.line.fielding[metric] === null)).map(player =>
            <fieldset key={player.key} className="gameReviewPlayer"><legend>{player.name}</legend><div className="gameReviewCounts">
              {([
                ['putouts', 'Outs realizados', 'PO'], ['assists', 'Asistencias', 'A'], ['doublePlays', 'Dobles jugadas', 'DP'],
                ['triplePlays', 'Triples jugadas', 'TP'], ['passedBalls', 'Pelotas pasadas', 'PB']
              ] as const).filter(([, , metric]) => player.line.fielding[metric] === null).map(([key, label, metric]) => <label className="managerField" key={key}><span>{label}</span>
                <input type="number" min="0" max="1000000" step="1" aria-label={`${label} de ${player.name}`}
                  placeholder={detailed ? player.line.fielding[metric] === null ? 'No disponible' : String(player.line.fielding[metric]) : ''}
                  value={review.fielding[player.key]?.[key] ?? ''}
                  onChange={event => setReview({ ...review, fielding: { ...review.fielding,
                    [player.key]: { ...(review.fielding[player.key] ?? initialFielding()), [key]: capture(event.target.value) } } })} />
              </label>)}
            </div></fieldset>)}
        </details>
        <label className="managerField"><span>Justificación, incidencias o reconocimientos no adjudicados</span>
          <textarea value={review.note} maxLength={2000} onChange={event => setReview({ ...review, note: event.target.value })} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
          Confirmo el resultado, las decisiones reglamentarias y los datos registrados. Los datos faltantes quedarán como No disponible.</label>
        {error ? <p className="managerWarning" role="alert">{error}</p> : null}
        <div className="managerButtonRow">
          <button type="submit" className="managerButtonSolid" disabled={!confirmed}>Confirmar cierre y abrir resumen</button>
          <button type="button" className="managerButtonOutline" onClick={onCancel}>Volver a revisar las jugadas</button>
        </div>
      </fieldset>
    </form>
    {stale ? <p className="managerWarning" role="alert">La pizarra cambió. Cancela esta revisión y vuelve a abrirla.</p> : null}
  </section>;
}

export function GameReportScreen({ state, endpoint, onBack, onExit, showDetails = true }: {
  state: PrivateState; endpoint?: string; onBack: () => void; onExit: () => void; showDetails?: boolean;
}) {
  const [report, setReport] = useState<GameReport | null>(() =>
    endpoint ? null : createGameReport(state, { source: 'practice', detailed: true }));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    setReport(null); setError('');
    void fetch(endpoint, { credentials: 'include', cache: 'no-store' }).then(async response => {
      const value: unknown = await response.json();
      if (!response.ok) throw new Error(value && typeof value === 'object' && 'message' in value && typeof value.message === 'string' ?
        value.message : 'No se pudo consultar el resumen final.');
      const next = readGameReport(value);
      if (!next.finished) throw new Error('El servicio todavía no confirmó el cierre del partido. Actualiza el resumen.');
      if (active) setReport(next);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar el resumen final.'); });
    return () => { active = false; };
  }, [endpoint, attempt]);
  if (report) return <GameFinalReport report={report} onBack={onBack} onExit={onExit} showDetails={showDetails} />;
  return <section className="managerCard">
    <h2>Resumen final del partido</h2>
    {error ? <p className="managerWarning" role="alert">{error}</p> : <p role="status">Consultando el resumen guardado…</p>}
    <div className="managerButtonRow">
      {error ? <button type="button" className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Volver a consultar el resumen</button> : null}
      <button type="button" className="managerButtonOutline" onClick={onBack}>Volver a la hoja de anotación</button>
    </div>
  </section>;
}
