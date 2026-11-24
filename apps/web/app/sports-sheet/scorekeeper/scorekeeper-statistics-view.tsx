'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { aggregateStatistics, readOfficialGames, readScorekeeperAccess, readScorekeeperStatistics, statisticsGroupKey,
  type AccountProfile, type OfficialGameSummary, type ScorekeeperAccess, type ScorekeeperStatistics } from '@playsport/shared';
import { accessRequest } from '../../account/access/access-request';
import { MetricTables } from '../statistics/statistics-view';

export type ScorekeeperStatisticsExample = {
  access: ScorekeeperAccess; games: OfficialGameSummary[]; statistics: ScorekeeperStatistics[];
};
export default function ScorekeeperStatisticsView({ account, example }: { account: AccountProfile; example?: ScorekeeperStatisticsExample }) {
  const [ownAccess, setAccess] = useState<ScorekeeperAccess | null>(example?.access ?? null);
  const access = ownAccess?.accountId === account.id ? ownAccess : null;
  const [games, setGames] = useState<OfficialGameSummary[]>(example?.games ?? []);
  const [tournamentId, setTournamentId] = useState(''), [gameId, setGameId] = useState('');
  const [totals, setTotals] = useState(false), [report, setReport] = useState<ScorekeeperStatistics | null>(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    if (example) return;
    let active = true, request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const [own, catalog] = await Promise.all([accessRequest('/api/sports-sheet/scorekeeper-tournaments'), accessRequest('/api/sports-sheet/scorekeeper-games')]);
        const next = readScorekeeperAccess(own, account.id);
        if (!catalog || typeof catalog !== 'object' || !('accountId' in catalog) || catalog.accountId !== account.id || !account.identity?.actorId)
          throw new Error('Los partidos no corresponden a tu identidad.');
        const list = readOfficialGames(catalog, account.identity.actorId, 'scorekeeper', false);
        if (active && current === request) { setAccess(next); setGames(list.games); setAccessError(''); }
      } catch (failure) {
        if (active && current === request) { setAccess(null); setGames([]); setReport(null);
          setAccessError(failure instanceof Error ? failure.message : 'No se pudieron consultar tus accesos.'); }
      }
    };
    void load(); globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => { active = false; globalThis.removeEventListener('focus', load); globalThis.clearInterval(timer); };
  }, [account.id, account.identity?.actorId, example, attempt]);
  const enabledTournament = access?.tournaments.some(team => team.tournamentId === tournamentId && team.enabled);
  const choices = games.filter(game => game.tournamentId === tournamentId && (enabledTournament ||
    access?.substitutions?.some(item => item.tournamentId === tournamentId && item.gameId === game.gameId) ||
    access?.extras.some(extra => extra.tournamentId === tournamentId && extra.gameId === game.gameId && extra.status === 'granted')));
  const tournamentChoices = [...new Map<string, { tournamentId: string; tournamentName: string; enabled: boolean }>([
    ...(access?.substitutions?.map(item => [item.tournamentId, { ...item, enabled: false }] as const) ?? []),
    ...(access?.tournaments.filter(team => team.enabled || access.extras.some(extra => extra.tournamentId === team.tournamentId && extra.status === 'granted'))
      .map(team => [team.tournamentId, team] as const) ?? []),
  ]).values()];
  const allowed = Boolean(access && access.level >= 2 && (totals ? access.level === 3 && enabledTournament : choices.some(game => game.gameId === gameId)));
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setError(''); setLoading(false);
    if (!allowed) { setReport(null); return; }
    setLoading(true);
    const query = new URLSearchParams({ tournamentId, ...(!totals ? { gameId } : {}) });
    const load = async () => {
      try {
        let value: unknown;
        if (example) {
          const matches = example.statistics.filter(row => row.tournamentId === tournamentId && (totals || row.gameId === gameId));
          const players = matches.flatMap(row => row.players), groups = new Map<string, typeof players>();
          if (totals) for (const player of players) {
            const key = JSON.stringify([player.id, statisticsGroupKey(player.game)]);
            groups.set(key, [...(groups.get(key) ?? []), player]);
          }
          value = { accountId: account.id, tournamentId, gameId: totals ? null : gameId, games: matches.flatMap(row => row.games), players,
            totals: [...groups.values()].map(rows => ({ id: rows[0].id, name: rows[0].name,
              group: `${rows[0].game.sport === 'baseball' ? 'Béisbol' : 'Softbol'} · ${rows[0].game.modality} · ${rows[0].game.category} · PCL/${rows[0].game.eraBase}`,
              line: aggregateStatistics(rows.map(row => row.game)) })) };
        } else value = await accessRequest(`/api/sports-sheet/scorekeeper-statistics?${query}`);
        const next = readScorekeeperStatistics(value, account.id, tournamentId, totals ? null : gameId);
        if (active && current === generation.current) setReport(next);
      } catch (failure) {
        if (active && current === generation.current) { setReport(null); setError(failure instanceof Error ? failure.message : 'No se pudieron consultar las estadísticas.'); }
      } finally { if (active && current === generation.current) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [account.id, access, allowed, tournamentId, gameId, totals, example, attempt]);
  const visible = allowed && report?.accountId === account.id && report.tournamentId === tournamentId && report.gameId === (totals ? null : gameId) ? report : null;
  return <main className="moduleView administrationPage scorekeeperStatistics">
    <header className="moduleHeader"><h1>Box score y torneos · Anotador</h1>
      <p>Solo tus torneos y partidos autorizados. Nunca perfiles ajenos, trayectoria de por vida ni mezclas entre torneos o ligas.</p>
      <div className="managerButtonRow"><Link href="/account/scorekeeper-tournaments" className="managerButtonOutline">Mis cupos</Link>
        <Link href="/demo/live-scoring?view=scorekeeper" className="managerButtonOutline">Mis partidos asignados</Link></div></header>
    {accessError || error ? <p role="alert" className="managerWarning">{accessError || error}</p> : null}
    {!example ? <button className="managerButtonOutline" onClick={() => setAttempt(value => value + 1)}>Actualizar accesos y estadísticas</button> : null}
    {!access && !accessError ? <p role="status">Comprobando accesos…</p> : null}
    {access?.level === 1 ? <section className="managerCard"><h2>Nivel 1 · Pizarra básica</h2>
      <p>9 innings en béisbol y 7 en softbol; pizarra general y reconocimientos solo con nombres. El box score completo requiere nivel 2 o 3.</p>
      <Link href="/account/access">Consultar los niveles de Anotador</Link></section> : access ? <section className="managerCard managerStepCard">
      <h2>Nivel {access.level} · {access.level === 3 ? 'Detalle y acumulados por torneo' : 'Box score por partido'}</h2>
      <div className="sportsSheetGrid">
        <label className="managerField"><span>Torneo autorizado</span><select aria-label="Torneo autorizado" value={tournamentId} onChange={event => {
          setTournamentId(event.target.value); setGameId(''); setTotals(false); setReport(null);
        }}><option value="">Selecciona un torneo</option>{tournamentChoices.map(team =>
          <option key={team.tournamentId} value={team.tournamentId}>{team.tournamentName}{team.enabled ? '' : ' · Solo partido puntual'}</option>)}</select></label>
        <label className="managerField"><span>Partido</span><select aria-label="Partido" value={gameId} disabled={!tournamentId || totals} onChange={event => { setGameId(event.target.value); setReport(null); }}>
          <option value="">Selecciona un partido</option>{choices.map(game => <option key={game.gameId} value={game.gameId}>
            {game.details?.date ?? 'Sin fecha'} · {game.details?.awayTeamName ?? game.awayTeamId} vs. {game.details?.homeTeamName ?? game.homeTeamId}
          </option>)}</select></label>
      </div>
      {access.level === 3 ? <label className="managerTeamChoice"><input type="checkbox" checked={totals} disabled={!enabledTournament}
        onChange={event => { setTotals(event.target.checked); setReport(null); }} /><span>Acumulados individuales únicamente de este torneo</span></label> :
        <p>Sin acumulados. Cada box score corresponde únicamente al partido elegido.</p>}
      {totals ? <p>Solo partidos finalizados con respaldo, separados por deporte, modalidad, categoría y base de PCL. Corregir o deshacer una jugada reemplaza la versión anterior.</p> : null}
    </section> : null}
    {loading ? <p role="status">Consultando el ámbito autorizado…</p> : null}
    {visible ? <section className="managerCard managerStepCard scorekeeperPlayerReport" key={JSON.stringify([tournamentId, gameId, totals])}>
      <h2>{totals ? 'Jugadores · Acumulado del torneo seleccionado' : 'Jugadores · Box score del partido'}</h2>
      {!totals ? visible.games.map(game => <details className="adminUserCard" key={JSON.stringify([game.gameId, game.teamId])}>
        <summary>Equipo · {game.teamName}</summary>{game.line ? <MetricTables line={game.line} /> : <p>{game.reason || 'Anotación sin respaldo suficiente.'}</p>}</details>) : null}
      {(totals ? visible.totals : visible.players.map(player => ({ ...player, group: player.game.teamName, line: player.game.line }))).map(player =>
        <details className="adminUserCard scorekeeperPlayer" key={JSON.stringify([player.id, player.group])}>
          <summary>{player.name ?? 'Nombre no registrado'} · {player.group}</summary>
          {player.line ? <MetricTables line={player.line} /> : <p>No hay cifras finalizadas con respaldo para acumular.</p>}
        </details>)}
      {!(totals ? visible.totals.length : visible.players.length) ? <p>No hay participaciones individuales respaldadas en este ámbito.</p> : null}
    </section> : null}
  </main>;
}
