'use client';

import { useEffect, useState } from 'react';
import { fieldPositionLabels, isGameSuspension, readOfficialInterruptionArchive, type GameSuspension } from '@playsport/shared';
import PrivateScorecardView from './private-scorecard-view';
import { useNavigationBusy } from '../../navigation-hooks';

export default function SuspensionArchive({ apiBase, gameId, tournamentId, archiveId }: {
  apiBase: string; gameId: string; tournamentId: string; archiveId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(archiveId);
  const [entries, setEntries] = useState<GameSuspension[]>([]);
  const [archive, setArchive] = useState<ReturnType<typeof readOfficialInterruptionArchive> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useNavigationBusy(busy);
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    const controller = new AbortController();
    const query = `${apiBase}/games/${encodeURIComponent(gameId)}/suspension-archive?tournamentId=${encodeURIComponent(tournamentId)}`;
    const load = async () => {
      setBusy(true); setArchive(null); setError('');
      try {
        const responses = await Promise.all([fetch(query, { signal: controller.signal }), fetch(`${query}&id=${encodeURIComponent(selected)}`, { signal: controller.signal })]);
        if (responses.some(response => !response.ok)) throw new Error('No se pudo consultar el historial de suspensiones.');
        const [list, value]: unknown[] = await Promise.all(responses.map(response => response.json()));
        if (!list || typeof list !== 'object' || !('interruptions' in list) || !Array.isArray(list.interruptions) ||
            !list.interruptions.every(isGameSuspension)) throw new Error('El historial de suspensiones contiene datos inválidos.');
        const snapshot = readOfficialInterruptionArchive(value);
        if (snapshot.suspension.id !== selected) throw new Error('El archivo recibido no corresponde a la suspensión seleccionada.');
        if (active) { setEntries(list.interruptions); setArchive(snapshot); }
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la anotación archivada.'); }
      finally { if (active) setBusy(false); }
    };
    void load();
    return () => { active = false; controller.abort(); };
  }, [apiBase, gameId, tournamentId, selected, expanded, retry]);
  const close = () => { setExpanded(false); setBusy(false); };
  return <section aria-label="Historial de suspensiones">
    <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => expanded ? close() : setExpanded(true)}>
      {expanded ? 'Cerrar anotación archivada' : 'Consultar anotación anterior archivada'}
    </button>
    {expanded ? <>
      {busy ? <p role="status">Consultando anotación archivada…</p> : null}
      {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>Reintentar archivo</button></p> : null}
      {entries.length > 1 ? <label className="managerField"><span>Interrupción archivada</span>
        <select disabled={busy} value={selected} onChange={event => setSelected(event.target.value)}>
          {entries.map((entry, i) => <option key={entry.id} value={entry.id}>{i + 1} · {entry.recordedAt} · {entry.reason}</option>)}
        </select></label> : null}
      {archive ? <>
        <p><strong>Archivo de solo lectura</strong> · {archive.suspension.recordedAt} · {archive.suspension.reason}</p>
        <PrivateScorecardView observation={archive.observation.scorecard} apiBase={apiBase} gameId={`${gameId}:archive:${selected}`}
          tournamentId={tournamentId} managerId="archive" homeId={archive.homeTeamId} awayId={archive.awayTeamId} ownSide="home"
          homeName={archive.observation.scorecard.seed.names.home} awayName={archive.observation.scorecard.seed.names.away}
          initialLineup={archive.observation.scorecard.lineups.home} positionLabels={fieldPositionLabels} onBack={close} />
      </> : null}
    </> : null}
  </section>;
}
