'use client';

import { getDemoJerseyNumber } from './demo-players';
import { InstitutionName } from '../../institutional-logos';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonnelAction, PersonnelRequest, PersonnelRole, PresentOfficial, TeamSheetsSnapshot } from '@playsport/shared';
import { readTeamSheets, presentOfficialRoleLabels, isPresentOfficialRole } from '@playsport/shared';
export { readTeamSheets };
import { connectVisibleStream } from './live-stream';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { isTextDraft, isTextMapDraft } from '../../navigation-drafts';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const officialRoleLabels = presentOfficialRoleLabels;
const statusLabels = { pending: 'Pendiente de confirmación', approved: 'Confirmado', rejected: 'Rechazado' };
const roleLabels = { manager: 'Dirigente rival', organizer: 'Organizador', scorekeeper: 'Anotador' };
const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const message = (error: unknown) => error instanceof Error ?
  (/Failed to fetch|NetworkError/.test(error.message) ? 'No hay conexión con el servicio de entregas.' : error.message) : 'No se pudo completar la entrega.';

export type TeamSheetConnection = ReturnType<typeof useTeamSheets>;
export function useTeamSheets(config: { apiBase: string; gameId: string; tournamentId: string; userId: string; role: PersonnelRole; enabled?: boolean }) {
  const { apiBase, gameId, tournamentId, userId, role, enabled = true } = config;
  const [data, setData] = useState<TeamSheetsSnapshot | null>(null);
  const latest = useRef<TeamSheetsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useNavigationBusy(busy);
  const sending = useRef(false);
  const [retry, setRetry] = useState(0);
  const accept = useCallback((value: unknown) => {
    const snapshot = readTeamSheets(value);
    if (snapshot.gameId !== gameId || snapshot.tournamentId !== tournamentId) throw new Error('La entrega recibida pertenece a otro partido.');
    if (!latest.current || snapshot.version >= latest.current.version) {
      latest.current = snapshot;
      setData(snapshot);
    }
    return snapshot;
  }, [gameId, tournamentId]);
  const path = `${apiBase}/games/${encodeURIComponent(gameId)}/team-sheets`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const query = new URLSearchParams({ tournamentId, userId, role });
    const load = async () => {
      try {
        const response = await fetch(`${path}?${query}`, { credentials: 'include', signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : 'No se pudo consultar la entrega.');
        if (active) { accept(body); setError(''); }
      } catch (failure) { if (active) setError(message(failure)); }
    };
    const disconnect = connectVisibleStream(`${path}/stream?${query}`, (source) => {
      source.onmessage = (event) => {
        if (!active) return;
        try { accept(JSON.parse(event.data)); setStreamError(''); }
        catch (failure) { setStreamError(message(failure)); }
      };
      source.onerror = () => {
        if (active) setStreamError('La recepción en vivo está desconectada. Se intentará reconectar; también puedes actualizar la bandeja.');
      };
    });
    void load();
    return () => { active = false; controller.abort(); disconnect(); };
  }, [path, tournamentId, userId, role, retry, accept, enabled]);
  const send = async (endpoint: string, payload: unknown) => {
    if (!enabled) throw new Error('Las entregas compartidas están desactivadas en esta planilla de ejemplo.');
    if (sending.current) throw new Error('Espera a que termine el envío anterior.');
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/games/${gameId}/${endpoint}`, {
        credentials: 'include',
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : 'No se pudo enviar el movimiento.');
      accept(body);
      setNotice('Movimiento comunicado a los destinatarios del partido.');
    } catch (failure) { setError(message(failure)); throw failure; }
    finally { sending.current = false; setBusy(false); }
  };
  const request = async (teamId: string, action: PersonnelAction) => {
    const sheet = latest.current?.sheets.find((s) => s.teamId === teamId);
    if (!sheet) throw new Error('Todavía no se ha recibido la entrega inicial de este equipo.');
    await send(`team-sheets/${teamId}/requests`, { tournamentId, managerId: userId, expectedRevision: sheet.revision, action });
  };
  const decide = async (request: PersonnelRequest, decision: 'approve' | 'reject', note: string) => {
    if (latest.current?.scoringBlockReason) throw new Error(latest.current.scoringBlockReason);
    const sheet = latest.current?.sheets.find((s) => s.teamId === request.teamId);
    if (!sheet) throw new Error('No se encontró la entrega del equipo.');
    await send(`personnel-requests/${encodeURIComponent(request.id)}/decision`, {
      tournamentId, actorId: userId, actorRole: role, expectedRevision: sheet.revision, decision, note
    });
  };
  const record = async (teamId: string, action: PersonnelAction, expectedOfficialVersion: number) => {
    if (latest.current?.scoringBlockReason) throw new Error(latest.current.scoringBlockReason);
    const sheet = latest.current?.sheets.find((s) => s.teamId === teamId);
    if (!sheet || !latest.current?.canDecide) throw new Error('Solo un oficial autorizado puede registrar este cambio.');
    await send(`team-sheets/${teamId}/official-changes`, {
      tournamentId, actorId: userId, actorRole: role, expectedRevision: sheet.revision, expectedOfficialVersion, action
    });
  };
  return { data, error, streamError, notice, busy, request, decide, record, draftScope: `${tournamentId}:${gameId}:${userId}`, refresh: () => setRetry((n) => n + 1) };
}

// eslint-disable-next-line no-unused-vars -- ESLint's core rule treats this type-only parameter as a variable.
export function OfficialEntryForm({ onAdd, draftKey, disabled = false }: { onAdd(official: PresentOfficial): void | Promise<void>; draftKey: string; disabled?: boolean }) {
  const [role, setRole] = useNavigationDraft<PresentOfficial['role']>(`${draftKey}:role`, 'DIRIGENTE', isPresentOfficialRole);
  const [id, setId] = useNavigationDraft(`${draftKey}:id`, '', isTextDraft);
  const [name, setName] = useNavigationDraft(`${draftKey}:name`, '', isTextDraft);
  const [error, setError] = useState('');
  const add = async () => {
    const identificationNumber = normalize(id);
    if (identificationNumber.length < 4 || !name.trim()) { setError('Indica cédula y nombre del directivo presente.'); return; }
    try {
      await onAdd({ role, identificationNumber, displayName: name.trim() });
      setError(''); setId(''); setName('');
    } catch (failure) { setError(message(failure)); }
  };
  return <fieldset className="privateControls" disabled={disabled}>
    <legend>Directivos presentes: dirigente, manager y delegados</legend>
    <p>Dirigente y manager son cargos distintos. No se incluyen los coach de primera y tercera. Anotar un directivo no le concede permisos de cuenta.</p>
    <label className="managerField"><span>Cargo del directivo presente</span><select value={role} onChange={(e) => setRole(e.target.value as PresentOfficial['role'])}>{Object.entries(officialRoleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="managerField"><span>Cédula del directivo presente</span><input value={id} onChange={(e) => setId(e.target.value)} /></label>
    <label className="managerField"><span>Nombre del directivo presente</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
    <button type="button" className="managerButtonOutline" onClick={add}>Agregar directivo presente</button>
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}

export function personnelDescription(action: PersonnelAction, positionLabels: Record<string, string>) {
  switch (action.kind) {
    case 'arrival': return `Llegada tardía: ${action.identificationNumber}; se incorpora como suplente, sin agregar un turno de bateo`;
    case 'substitution': return `${action.arrival ? 'Llegada y sustitución' : 'Sustitución'}: ${action.incomingIdentificationNumber} por ${action.outgoingIdentificationNumber} · ${positionLabels[action.fieldPosition]} · camiseta ${action.jerseyNumber}`;
    case 'defense': return `Cambio defensivo: ${action.identificationNumber} a ${positionLabels[action.fieldPosition]}${action.swapWith ? ` · intercambio con ${action.swapWith}` : ''}`;
    case 'courtesy': return `Corredor temporal: ${action.incomingIdentificationNumber} por ${action.outgoingIdentificationNumber} en ${action.fromBase}.ª base`;
    case 'staff-arrival': return `Directivo presente: ${officialRoleLabels[action.official.role]} · ${action.official.displayName} · ${action.official.identificationNumber}`;
    case 'staff-departure': return `Retiro de directivo: ${officialRoleLabels[action.role]} · ${action.identificationNumber}`;
  }
}

export function DemoRecipientNotice() {
  return <p>Los destinatarios consultan las entregas desde su propia cuenta. Para probar otro rol del demo, usa «Cambiar rol» en la barra superior.</p>;
}

export function TeamSheetPanel({ connection, names, positionLabels, roster = [], allowManagerRequests = false }: {
  connection: TeamSheetConnection; names: Record<string, string>; positionLabels: Record<string, string>;
  allowManagerRequests?: boolean;
  roster?: Array<{ identificationNumber: string; displayName: string; jerseyNumber?: string }>;
}) {
  const { data } = connection;
  const [late, setLate] = useNavigationDraft(`${connection.draftScope}:late`, '', isTextDraft);
  const [notes, setNotes] = useNavigationDraft<Record<string, string>>(`${connection.draftScope}:notes`, {}, isTextMapDraft);
  const [error, setError] = useState('');
  const ownSheet = data?.sheets.find((sheet) => sheet.teamId === data.ownTeamId);
  const jerseyFor = (id: string) => {
    const change = [...(data?.requests ?? [])].reverse().find((request) =>
      request.status === 'approved' && request.action.kind === 'substitution' && request.action.incomingIdentificationNumber === id);
    if (change?.action.kind === 'substitution') return change.action.jerseyNumber;
    return data?.sheets.flatMap((sheet) => sheet.initialLineup).find((player) => player.identificationNumber === id)?.jerseyNumber ||
      roster.find((player) => player.identificationNumber === id)?.jerseyNumber || getDemoJerseyNumber(id);
  };
  const present = ownSheet ? [...ownSheet.lineup, ...ownSheet.presentSubstitutes].map((p) => p.identificationNumber) : [];
  const submit = async (action: PersonnelAction) => {
    if (!ownSheet) throw new Error('Envía primero la alineación inicial.');
    await connection.request(ownSheet.teamId, action);
  };
  const run = async (action: () => Promise<void>) => {
    try { await action(); setError(''); }
    catch (failure) { setError(message(failure)); }
  };
  return <article className="managerCard managerStepCard">
    <h2>Entrega compartida de alineaciones y personal presente</h2>
    <p>El manager entrega su lineup con jugadores del roster de su equipo. La incorporación es directa dentro de los cupos y plazo del torneo. Después, el anotador u organizador registra las jugadas y los cambios comunicados en el campo; ambos managers los consultan en vivo. «Recibida» no significa que el destinatario la haya leído.</p>
    <p>El oficial debe respetar el reglamento del torneo, incluidos reingresos y casos especiales del bateador asignado y jugador flexible. Los movimientos pendientes anteriores se conservan para su resolución.</p>
    <DemoRecipientNotice />
    <button type="button" className="managerButtonOutline" onClick={connection.refresh}>Actualizar bandeja de entregas</button>
    {connection.error || connection.streamError || error ? <p className="managerWarning" role="alert">{connection.error || error || connection.streamError}</p> : null}
    {connection.notice ? <p role="status">{connection.notice}</p> : null}
    {data?.scoringBlockReason ? <p className="managerWarning" role="status">{data.scoringBlockReason}</p> : null}
    {!data ? <p>Consultando entregas del partido…</p> : null}
    {data?.sheets.map((sheet) => <section key={sheet.teamId} className="managerInlineList" aria-label={`Entrega de ${names[sheet.teamId] ?? sheet.teamId}`}>
      <h3><InstitutionName id={sheet.teamId}>{names[sheet.teamId] ?? sheet.teamId}</InstitutionName> · Entrega recibida · Versión {sheet.revision}</h3>
      <p>Disponible para: {sheet.recipients.map((recipient) => `${roleLabels[recipient.role]} (${recipient.userId})`).join(', ')}</p>
      {sheet.representative ? <p>Representante en el campo: {sheet.representative.displayName}</p> : null}
      <ol>{sheet.lineup.map((p) => <li key={p.identificationNumber}>{p.battingOrder ?? 'Sin turno'} · {p.displayName} · {p.identificationNumber} · {positionLabels[p.fieldPosition]} · camiseta {p.jerseyNumber ?? 'sin asignar'}</li>)}</ol>
      <h4>Suplentes presentes confirmados</h4>
      {sheet.presentSubstitutes.length ? <ul>{sheet.presentSubstitutes.map((p) => <li key={p.identificationNumber}>{p.displayName} · {p.identificationNumber}{jerseyFor(p.identificationNumber) ? ` · Camiseta ${jerseyFor(p.identificationNumber)}` : ''}</li>)}</ul> : <p>No se declararon suplentes presentes.</p>}
      <h4>Directivos presentes</h4>
      {sheet.presentOfficials.length ? <ul>{sheet.presentOfficials.map((official) => <li key={`${official.role}:${official.identificationNumber}`}>
        {officialRoleLabels[official.role]} · {official.displayName} · {official.identificationNumber}
        {sheet.teamId === data.ownTeamId ? <button type="button" className="chipSubtle" disabled={connection.busy} onClick={() => run(() => submit({ kind: 'staff-departure', identificationNumber: official.identificationNumber, role: official.role }))}>Comunicar retiro</button> : null}
      </li>)}</ul> : <p>No se declararon directivos presentes.</p>}
    </section>)}
    {data && !data.sheets.length ? <p>Aún no se ha recibido ninguna alineación.</p> : null}
    {ownSheet && (data?.canDecide || allowManagerRequests) ? <>
      <h3>Jugador inscrito que llegó tarde</h3>
      <label className="managerField"><span>Jugador que llegó tarde</span><select value={late} onChange={(e) => setLate(e.target.value)}><option value="">Selecciona un jugador ausente</option>{roster.filter((p) => !present.includes(p.identificationNumber)).map((p) => <option key={p.identificationNumber} value={p.identificationNumber}>{p.displayName} · {p.identificationNumber}{jerseyFor(p.identificationNumber) ? ` · Camiseta ${jerseyFor(p.identificationNumber)}` : ''}</option>)}</select></label>
      <button type="button" className="managerButtonOutline" disabled={connection.busy} onClick={() => run(() => submit({ kind: 'arrival', identificationNumber: late }))}>Comunicar llegada tardía para confirmación</button>
      <OfficialEntryForm draftKey={`${connection.draftScope}:staff-form`} disabled={connection.busy} onAdd={(official) => submit({ kind: 'staff-arrival', official })} />
    </> : null}
    <h3>Movimientos comunicados</h3>
    {data?.requests.map((request) => <section className="managerInlineList" key={request.id} aria-label={`Movimiento ${request.id}`}>
      <p><strong><InstitutionName id={request.teamId}>{names[request.teamId] ?? request.teamId}</InstitutionName> · {statusLabels[request.status]}</strong></p>
      <p>{personnelDescription(request.action, positionLabels)}</p>
      {request.decidedBy ? <p>Resuelto por {roleLabels[request.decidedBy.role]} ({request.decidedBy.id}){request.decisionNote ? ` · ${request.decisionNote}` : ''}</p> :
        request.decisionNote ? <p>{request.decisionNote}</p> : null}
      {data.canDecide && request.status === 'pending' ? <>
        <label className="managerField"><span>Motivo o nota para {request.id}</span><input value={notes[request.id] ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [request.id]: e.target.value }))} /></label>
        <div className="managerButtonRow">
          <button type="button" className="managerButtonSolid" disabled={connection.busy || Boolean(data.scoringBlockReason)} onClick={() => run(() => connection.decide(request, 'approve', notes[request.id] ?? ''))}>Confirmar movimiento</button>
          <button type="button" className="managerButtonOutline" disabled={connection.busy || Boolean(data.scoringBlockReason)} onClick={() => run(() => connection.decide(request, 'reject', notes[request.id] ?? ''))}>Rechazar movimiento</button>
        </div>
      </> : null}
    </section>)}
    {data && !data.requests.length ? <p>No hay movimientos comunicados.</p> : null}
  </article>;
}
