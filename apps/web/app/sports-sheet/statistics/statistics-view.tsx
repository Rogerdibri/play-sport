'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { aggregateStatistics, fieldPositionLabels, readStatisticsSnapshot, statisticsGroupKey, statisticsInnings,
  statisticsMetrics, statisticsExampleObservation, type AccountProfile, type StatisticsGame, type StatisticsLine,
  filterStatisticsGames, hasAccountFeature, statisticsTeamKey, statisticsLeagueKey, statisticsGameKind, statisticsGameKindLabels,
  sportsSheetDiscipline, type StatisticsFilters, type StatisticsSnapshot } from '@playsport/shared';
import SportsSheetExampleScorecard from '../example-scorecard';

type Filters = StatisticsFilters;
const emptyFilters = (): Filters => ({ group: '', season: '', league: '', tournament: '', team: '', game: '', from: '', to: '' });
function groupLabel(game: StatisticsGame) {
  return `${game.sport === 'baseball' ? 'Béisbol' : game.sport === 'softball' ? 'Softbol' : 'Sin deporte definido'} · ${game.modality || 'Sin modalidad'} · ${game.category || 'Sin categoría'}${game.eraBase ? ` · PCL/${game.eraBase}` : ''}${statisticsGameKind(game) !== 'official' ? ` · ${statisticsGameKindLabels[statisticsGameKind(game)]}` : ''}`;
}
export function MetricTables({ line }: { line: StatisticsLine }) {
  return <div className="sportsStatisticsTables">{(['batting', 'pitching', 'fielding'] as const).map(group => {
    const values: Record<string, number | null> = line[group];
    const primary = group === 'batting' ? ['G', 'AB', 'H', 'AVG', 'HR', 'R', 'RBI', 'SB'] :
      group === 'pitching' ? ['G', 'outs', 'ERA', 'WHIP', 'K', 'H', 'R', 'ER'] : ['G', 'E', 'PO', 'A', 'FLD'];
    const metrics = (expanded: boolean) => statisticsMetrics[group].filter(metric => primary.includes(metric.key) !== expanded).map(metric => {
        const value = values[metric.key];
        const display = value === null ? 'No disponible' : group === 'pitching' && metric.key === 'outs' ?
          statisticsInnings(value) : metric.precision ? value.toFixed(metric.precision) : String(value);
        return <div className="sportsStatisticsMetric" key={metric.key}>
          <strong title={metric.description}>{metric.label}</strong><span>{display}</span><small>{metric.description}</small>
        </div>;
      });
    return <details className="sportsStatisticsPanel" key={group} open={group === 'batting'}>
      <summary>{group === 'batting' ? 'Bateo y corrido de bases' : group === 'pitching' ? 'Pitcheo' : 'Defensa'}</summary>
      <div className="sportsStatisticsMetrics">{metrics(false)}</div>
      <details className="sportsStatisticsExpanded"><summary>Más estadísticas y definiciones</summary>
        <div className="sportsStatisticsMetrics">{metrics(true)}</div></details>
    </details>;
  })}</div>;
}
function ExampleScorecard({ game, onBack }: { game: StatisticsGame; onBack: () => void }) {
  return <SportsSheetExampleScorecard observation={statisticsExampleObservation(game.gameId)}
    tournamentId={game.tournamentId} gameId={game.gameId} onBack={onBack} />;
}
export default function AccountStatistics({ account, example, initialMode }: {
  account: AccountProfile; example?: StatisticsSnapshot; initialMode?: StatisticsSnapshot['mode'];
}) {
  const [mode, setMode] = useState<StatisticsSnapshot['mode']>(example?.mode ?? initialMode ?? 'player');
  const [source, setSource] = useState<StatisticsSnapshot['source']>(example ? 'example' : account.localTestAccess ? 'example' : 'official');
  const [snapshot, setSnapshot] = useState<StatisticsSnapshot | null>(example ?? null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [detail, setDetail] = useState<string | null>(null);
  const [planLocked, setPlanLocked] = useState(Boolean(example && !hasAccountFeature(account, example.mode === 'team' ? 'team-statistics' : 'player-statistics')));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [analysisSelection, setAnalysisSelection] = useState<{ query: string; snapshot: StatisticsSnapshot } | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const detailRef = useRef<globalThis.HTMLElement | null>(null);
  useEffect(() => { if (detail) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [detail]);
  useEffect(() => {
    if (example) return;
    let active = true, revision = 0;
    setSnapshot(null); setPlanLocked(false); setError('');
    const load = async () => {
      const request = ++revision;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/sports-sheet/statistics?mode=${mode}&source=${source}`, {
          cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        const body: unknown = await response.json();
        if (response.status === 403 && body && typeof body === 'object' && 'code' in body &&
            body.code === 'STATISTICS_PLAN_REQUIRED' && 'accountId' in body && body.accountId === account.id) {
          if (active && request === revision) { setPlanLocked(true); setSnapshot(null); setError(''); }
          return;
        }
        if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ?
          body.message : 'No se pudieron consultar las estadísticas.');
        const value = readStatisticsSnapshot(body, account.id, mode, source);
        if (active && request === revision) { setSnapshot(value); setError(''); setPlanLocked(false); }
      } catch (failure) {
        if (active && request === revision) {
          setSnapshot(null); setError(failure instanceof Error ? failure.message : 'No se pudieron consultar las estadísticas.');
        }
      } finally { if (active && request === revision) setRefreshing(false); }
    };
    void load();
    globalThis.addEventListener('focus', load);
    const interval = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(interval); };
  }, [account.id, mode, source, attempt, example]);
  const data = snapshot?.mode === mode && snapshot.source === source ? snapshot : null;
  const analysisAllowed = data?.analysisAllowed === true;
  const groups = useMemo(() => [...new Map((data?.games ?? []).map(game => [statisticsGroupKey(game), game])).values()]
    .sort((a, b) => Number(a.sport === null) - Number(b.sport === null) || groupLabel(a).localeCompare(groupLabel(b), 'es')), [data]);
  const group = analysisAllowed ? filters.group || (groups[0] ? statisticsGroupKey(groups[0]) : '') : '';
  const invalidDates = Boolean(analysisAllowed && filters.from && filters.to && filters.from > filters.to);
  const unavailableGroup = Boolean(analysisAllowed && data && group && !groups.some(game => statisticsGroupKey(game) === group));
  const hasFilters = analysisAllowed && Object.values(filters).some(Boolean);
  const analysisParams = new URLSearchParams({ mode, source });
  for (const [key, value] of Object.entries(filters)) if (value) analysisParams.set(key, value);
  const analysisQuery = analysisParams.toString();
  useEffect(() => {
    if (!data || !analysisAllowed || !hasFilters || invalidDates || example) { setAnalysisSelection(null); return; }
    let active = true;
    setAnalysisSelection(null); setAnalysisError('');
    const load = async () => {
      try {
        const response = await fetch(`/api/sports-sheet/statistics?${analysisQuery}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const body: unknown = await response.json();
        if (!response.ok) {
          if (active && response.status === 403 && body && typeof body === 'object' &&
              'accountId' in body && body.accountId === account.id && 'code' in body &&
              (body.code === 'STATISTICS_ANALYSIS_REQUIRED' || body.code === 'STATISTICS_PLAN_REQUIRED')) setAttempt(value => value + 1);
          throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ?
            body.message : 'No se pudo calcular el análisis seleccionado.');
        }
        const value = readStatisticsSnapshot(body, account.id, mode, source);
        if (!value.analysisAllowed) throw new Error('El servidor no confirmó el acceso al análisis completo.');
        if (active) setAnalysisSelection({ query: analysisQuery, snapshot: value });
      } catch (failure) {
        if (active) setAnalysisError(failure instanceof Error ? failure.message : 'No se pudo calcular el análisis seleccionado.');
      }
    };
    void load();
    return () => { active = false; };
  }, [account.id, mode, source, analysisQuery, analysisAllowed, hasFilters, invalidDates, data, example]);
  const analysisPending = hasFilters && !example && !invalidDates && analysisSelection?.query !== analysisQuery && !analysisError;
  const rows = !analysisAllowed ? data?.games ?? [] : hasFilters && !example ?
    analysisSelection?.query === analysisQuery ? analysisSelection.snapshot.games : [] : data?.games ?? [];
  const selected = invalidDates || unavailableGroup ? [] : (analysisAllowed ? filterStatisticsGames(rows, { ...filters, group }) : [...rows])
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.gameId.localeCompare(b.gameId));
  const report = analysisAllowed ? aggregateStatistics(selected) : null;
  const selectedGame = selected.find(game => JSON.stringify([game.tournamentId, game.gameId, game.teamId]) === detail) ?? null;
  const update = (patch: Partial<Filters>) => { setFilters(value => ({ ...value, ...patch })); setDetail(null); setShowScorecard(false); setAnalysisError(''); };
  const choice = (field: keyof Filters, label: string, options: Array<{ value: string; label: string }>) =>
    <label className="managerField"><span>{label}</span><select value={filters[field]} onChange={event => update({ [field]: event.target.value })}>
      <option value="">Todos</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>;
  const groupGames = (data?.games ?? []).filter(game => statisticsGroupKey(game) === group);
  const distinct = (key: (_game: StatisticsGame) => string, label: (_game: StatisticsGame) => string) => // eslint-disable-line no-unused-vars
    [...new Map(groupGames.map(game => [key(game), { value: key(game), label: label(game) }])).values()];
  return <main className="moduleView sportsSheet sportsStatistics">
    <header className="moduleHeader"><h1>Estadísticas deportivas</h1>
      <p><strong>Disciplina:</strong> {sportsSheetDiscipline.label}</p>
      <p>{mode === 'team' ? 'Las cifras de los equipos que dirigiste y de sus jugadores, respaldadas por las alineaciones y jugadas de cada partido.' :
        'Tus participaciones vinculadas a tu identidad. Los juegos oficiales, amistosos y privados conservan su origen y respaldo.'}</p>
      {!example ? <div className="managerButtonRow" aria-label="Tipo de estadísticas">
        {(['player', 'team'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
          className={mode === value ? 'managerButtonSolid' : 'managerButtonOutline'} onClick={() => {
            setMode(value); setFilters(emptyFilters()); setDetail(null); setShowScorecard(false); setAnalysisError('');
          }}>{value === 'player' ? 'Mi actuación' : 'Equipos que dirigí'}</button>)}
      </div> : null}
      <Link href="/sports-sheet" className="managerButtonOutline">Volver a mi hoja deportiva</Link>
    </header>
    {planLocked ? <section className="managerCard managerStepCard"><h2>Estadísticas con plan</h2>
      <p>{mode === 'team' ? 'Las cifras del equipo y de sus jugadores requieren Manager · Nivel 2 o Nivel 3. El nivel gratuito conserva una inscripción activa y la pizarra básica.' :
        'Tu actuación requiere Jugador · Nivel 2 o Nivel 3. Los equipos que dirigiste conservan su plan de Manager.'}</p>
      <Link href="/account/access" className="managerButtonOutline">Consultar mis accesos</Link>
      <p>Tu ficha deportiva básica sigue disponible sin mostrar estadísticas personales.</p></section> : <>
      <section className="managerCard managerStepCard">
        <div className="managerButtonRow">
          <button type="button" className="managerButtonOutline" disabled={refreshing || Boolean(example)} onClick={() => { setAnalysisError(''); setAttempt(value => value + 1); }}>
            {refreshing ? 'Actualizando…' : 'Actualizar estadísticas'}</button>
          {account.localTestAccess ? <button type="button" className="managerButtonOutline" onClick={() => {
            setSource(source === 'official' ? 'example' : 'official');
            setFilters(emptyFilters()); setDetail(null); setShowScorecard(false);
          }}>{source === 'official' ? 'Ver ejemplos' : 'Volver a mis estadísticas'}</button> : null}
        </div>
      </section>
      {error ? <section className="managerCard managerStepCard"><p className="managerWarning" role="alert">{error}</p></section> : null}
      {analysisError ? <p className="managerWarning" role="alert">{analysisError}</p> : null}
      {!data && !error ? <p role="status">Comprobando acceso y recuperando estadísticas…</p> : null}
      {data && !data.games.length ? <section className="managerCard managerStepCard"><h2>Sin registros para esta cuenta</h2>
        <p>{!data.identityVerified ? 'Verifica tu identidad en Mi cuenta para vincular tus actuaciones reales.' :
          mode === 'player' ? 'Todavía no hay actuaciones vinculadas a tu identidad. En amistosos y privados, el creador puede vincular tu cédula sin publicar la planilla.' :
            'Todavía no hay juegos cuyas alineaciones oficiales te registren como manager.'}</p>
        <p>Los registros incompletos no se sustituyen por estadísticas ficticias.
          {account.localTestAccess ? ' Puedes abrir Ver ejemplos para probar los filtros.' : ''}</p></section> : null}
      {data && data.games.length ? <>
        <section className="managerCard managerStepCard">
          <h2>{analysisAllowed ? 'Nivel 3 · Análisis completo' : mode === 'team' ? 'Nivel 2 · Mis equipos por juego' : 'Nivel 2 · Mis números'}</h2>
          <p>{analysisAllowed ? mode === 'team' ? 'Analiza los equipos que dirigiste. Las estadísticas de cada jugador se consultan solo por partido, nunca acumuladas.' :
            'Analiza tu actuación con filtros y acumulados personalizados.' :
            mode === 'team' ? 'Abre un partido para consultar las cifras de tu equipo y de cada jugador, sin combinar otros partidos.' :
              'Abre un partido para consultar solamente tus cifras de ese juego. Los datos siguen registrándose, pero los acumulados, filtros y trayectoria detallada se consultan en Nivel 3.'}</p>
          {!analysisAllowed ? <Link href="/account/access" className="managerButtonOutline">Consultar los niveles de {mode === 'team' ? 'Manager' : 'Jugador'}</Link> : null}
        </section>
        {analysisAllowed ? <details className="managerCard managerStepCard sportsStatisticsFilters">
          <summary>Filtrar estadísticas{source === 'example' ? ' · Ejemplos' : ''}</summary>
          <div className="sportsSheetGrid">
            <label className="managerField"><span>Deporte, modalidad y categoría</span><select value={group} onChange={event => update({ ...emptyFilters(), group: event.target.value })}>
              {groups.map(game => <option key={statisticsGroupKey(game)} value={statisticsGroupKey(game)}>{groupLabel(game)}</option>)}
            </select></label>
            {choice('season', 'Temporada', distinct(game => JSON.stringify(game.season), game => game.season || 'Sin temporada indicada'))}
            {choice('league', 'Liga', distinct(statisticsLeagueKey, game => game.leagueName || 'Sin liga indicada'))}
            {choice('tournament', 'Torneo', distinct(game => game.tournamentId, game => game.tournamentName))}
            {choice('team', 'Equipo', distinct(statisticsTeamKey, game => `${game.teamName} · ${game.tournamentName}`))}
            {choice('game', 'Juego', distinct(game => JSON.stringify([game.tournamentId, game.gameId, game.teamId]),
              game => `${game.date ?? 'Sin fecha'} · ${game.teamName} vs. ${game.opponentName}`))}
            <label className="managerField"><span>Desde</span><input type="date" value={filters.from} onChange={event => update({ from: event.target.value })} /></label>
            <label className="managerField"><span>Hasta</span><input type="date" value={filters.to} onChange={event => update({ to: event.target.value })} /></label>
          </div>
          <button type="button" className="managerButtonOutline" onClick={() => update(emptyFilters())}>Limpiar filtros</button>
        </details> : null}
        {invalidDates ? <p role="alert" className="managerWarning">La fecha inicial no puede ser posterior a la fecha final.</p> : null}
        {unavailableGroup ? <p role="alert" className="managerWarning">El grupo seleccionado ya no está disponible. Selecciona otro grupo.</p> : null}
        {analysisAllowed ? <section className="managerCard managerStepCard">
          <h2>{mode === 'team' ? 'Acumulado del equipo' : groupGames[0] && statisticsGameKind(groupGames[0]) === 'friendly' ? 'Acumulado de amistosos' :
            groupGames[0] && statisticsGameKind(groupGames[0]) === 'private' ? 'Acumulado de planillas privadas' : 'Acumulado oficial'}{source === 'example' ? ' · Ejemplo' : ''}</h2>
          <p>Solo incluye juegos finalizados con anotación respaldada, desde la primera participación registrada, incluso antes de activar el plan.
            Las cifras se recalculan desde la última versión; oficiales, amistosos y privados no se mezclan.</p>
          <p>{selected.filter(game => ['official', 'recorded'].includes(game.qualification)).length} registros finalizados · {selected.filter(game => game.qualification === 'provisional').length} provisionales · {selected.filter(game => game.qualification === 'excluded').length} excluidos.</p>
          {mode === 'team' && report ? <p>Resultados del equipo: {selected.filter(game => game.result === 'win').length} ganados · {selected.filter(game => game.result === 'loss').length} perdidos · {selected.filter(game => game.result === 'tie').length} empatados.</p> : null}
          {analysisPending ? <p role="status">Calculando los filtros con tu acceso vigente…</p> :
            report ? <MetricTables line={report} /> : <p>No hay juegos computables con estos filtros.</p>}
        </section> : null}
        <section className="managerCard managerStepCard"><h2>Registro por juego</h2>
          <p>{analysisAllowed ? 'Los provisionales y excluidos se muestran para consulta, pero no se suman al acumulado.' :
            'Cada detalle muestra un solo partido. No combina sus cifras con las de ningún otro juego.'}</p>
          {selected.length ? <div className="sportsStatisticsHistory">{selected.map(game => {
            const key = JSON.stringify([game.tournamentId, game.gameId, game.teamId]);
            return <article className="sportsSheetRole" key={key}>
              <h3>{game.teamName} vs. {game.opponentName}</h3><p>{game.date ?? 'Fecha no registrada'} · {game.tournamentName}</p>
              <p>{statisticsGameKindLabels[statisticsGameKind(game)]} · {game.qualification === 'official' || game.qualification === 'recorded' ? 'Finalizado' : game.qualification === 'provisional' ? 'Provisional' : 'Excluido'} · Versión {game.version}</p>
              {game.reason ? <p>{game.reason}</p> : null}
              <button type="button" className="managerButtonOutline" aria-expanded={detail === key} onClick={() => {
                setDetail(value => value === key ? null : key); setShowScorecard(false);
              }}>{detail === key ? 'Cerrar detalle' : 'Ver detalle estadístico'}</button>
            </article>;
          })}</div> : <p>{analysisPending ? 'Consultando los registros filtrados…' : 'No hay juegos que coincidan con los filtros seleccionados.'}</p>}
        </section>
        {selectedGame ? <section className="managerCard managerStepCard sportsStatisticsDetail" ref={detailRef}>
          <h2>Detalle: {selectedGame.teamName} vs. {selectedGame.opponentName}</h2>
          <button type="button" className="managerButtonOutline" onClick={() => { setDetail(null); setShowScorecard(false); }}>Cerrar detalle</button>
          <p>{selectedGame.date ?? 'Fecha no registrada'} · {selectedGame.tournamentName} · {statisticsGameKindLabels[statisticsGameKind(selectedGame)]} · Versión {selectedGame.version}</p>
          {selectedGame.reason ? <p className="managerWarning">{selectedGame.reason}</p> : null}
          <p>Posiciones registradas: {selectedGame.positions.map(position => fieldPositionLabels[position] ?? position).join(' · ') || 'No disponible'}.
            No se estiman entradas por posición.</p>
          {selectedGame.line ? <MetricTables line={selectedGame.line} /> : <p>La anotación no permite presentar una línea estadística completa.</p>}
          {mode === 'team' ? <section className="managerGamePlayers"><h3>Jugadores de este partido</h3>
            {(data.players ?? []).filter(player => player.game.gameId === selectedGame.gameId &&
              player.game.tournamentId === selectedGame.tournamentId && player.game.teamId === selectedGame.teamId).map(player =>
              <details className="managerCard managerPlayerGame" key={player.id}><summary>{player.name ?? 'Nombre no registrado'}</summary>
                {player.game.line ? <MetricTables line={player.game.line} /> : <p>Las cifras de este jugador no están completas.</p>}</details>)}
            {!data.players?.some(player => player.game.gameId === selectedGame.gameId &&
              player.game.tournamentId === selectedGame.tournamentId && player.game.teamId === selectedGame.teamId) ?
              <p>No hay actuaciones individuales respaldadas para este partido.</p> : null}
          </section> : null}
          {source === 'example' ? <button className="managerButtonOutline" type="button" onClick={() => setShowScorecard(value => !value)}>
            {showScorecard ? 'Cerrar planilla de ejemplo' : 'Ver planilla de respaldo'}</button> :
            selectedGame.public ? <Link className="managerButtonOutline" href={`/demo/events-map?official=${encodeURIComponent(selectedGame.gameId)}`}>Ver planilla oficial</Link> :
              <p>{mode === 'team' ? 'Consulta las cifras de tu equipo y sus jugadores en este partido. La planilla completa no está publicada.' :
                'Solo puedes consultar tus propias cifras. La planilla completa de este juego no está publicada.'}</p>}
          {source === 'example' && showScorecard ? <ExampleScorecard key={selectedGame.gameId}
            game={selectedGame} onBack={() => setShowScorecard(false)} /> : null}
        </section> : null}
        <section className="managerCard managerStepCard"><h2>Cómo leer estas cifras</h2>
          <p>«No disponible» no significa cero. Las decisiones de pitcher, juegos completos, blanqueos, asistencias y participaciones defensivas
            no se deducen si falta su registro oficial. Los errores sin defensor identificado tampoco se reparten.</p>
          <p>IP utiliza outs: 5.1 son cinco entradas y un out. El PCL queda sin calcular mientras existan carreras pendientes.
            La base se indica en cada grupo; no depende de la duración real del juego.</p>
          <p>LR y SR son únicamente lanzamientos y strikes registrados con los controles de conteo; no se estima el total de lanzamientos.
            El PCL colectivo utiliza las carreras limpias del equipo, no la suma de promedios individuales.</p>
          <p>Los resultados técnicos quedan fuera del acumulado hasta definir su validación estadística.
            Las estadísticas siguen siendo privadas aunque publiques tu ficha deportiva.</p>
        </section>
      </> : null}
    </>}
  </main>;
}
