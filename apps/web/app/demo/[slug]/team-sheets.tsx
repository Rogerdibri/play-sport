'use client';

import { getDemoJerseyNumber } from './demo-players';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PersonnelAction, PersonnelRequest, PersonnelRole, PresentOfficial, TeamSheetsSnapshot } from '@playsport/shared';
import { connectVisibleStream } from './live-stream';

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const officialRoleLabels = { DIRIGENTE: 'Dirigente', MANAGER: 'Manager', DELEGADO: 'Delegado' };
const statusLabels = { pending: 'Pendiente de confirmación', approved: 'Confirmado', rejected: 'Rechazado' };
const roleLabels = { manager: 'Dirigente rival', organizer: 'Organizador', scorekeeper: 'Anotador' };
const normalize = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

function isOfficial(value: unknown): value is PresentOfficial {
  return isRecord(value) && (value.role === 'DIRIGENTE' || value.role === 'MANAGER' || value.role === 'DELEGADO') &&
    typeof value.identificationNumber === 'string' && typeof value.displayName === 'string';
}
function isAction(value: unknown): value is PersonnelAction {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case 'arrival': return typeof value.identificationNumber === 'string';
    case 'substitution': return typeof value.outgoingIdentificationNumber === 'string' && typeof value.incomingIdentificationNumber === 'string' && typeof value.fieldPosition === 'string' && typeof value.jerseyNumber === 'string';
    case 'defense': return typeof value.identificationNumber === 'string' && typeof value.fieldPosition === 'string';
    case 'courtesy': return typeof value.outgoingIdentificationNumber === 'string' && typeof value.incomingIdentificationNumber === 'string' && typeof value.fromBase === 'number';
    case 'staff-arrival': return isOfficial(value.official);
    case 'staff-departure': return typeof value.identificationNumber === 'string' && (value.role === 'DIRIGENTE' || value.role === 'MANAGER' || value.role === 'DELEGADO');
    default: return false;
  }
}
function isSnapshot(value: unknown): value is TeamSheetsSnapshot {
  if (!isRecord(value) || typeof value.gameId !== 'string' || typeof value.tournamentId !== 'string' ||
      typeof value.version !== 'number' || typeof value.canDecide !== 'boolean' ||
      !(value.ownTeamId === null || typeof value.ownTeamId === 'string') ||
      !Array.isArray(value.sheets) || !Array.isArray(value.requests)) return false;
  const player = (item: unknown) => isRecord(item) && typeof item.identificationNumber === 'string' &&
    typeof item.displayName === 'string' && (item.battingOrder === null || typeof item.battingOrder === 'number') &&
    typeof item.fieldPosition === 'string' && ['PLAYER', 'DP', 'FLEX', 'EH'].includes(String(item.lineupRole)) &&
    (item.jerseyNumber === null || typeof item.jerseyNumber === 'string');
  return value.sheets.every((sheet: unknown) => isRecord(sheet) && typeof sheet.teamId === 'string' &&
    typeof sheet.managerId === 'string' && typeof sheet.revision === 'number' &&
    Array.isArray(sheet.lineup) && sheet.lineup.every(player) && Array.isArray(sheet.initialLineup) && sheet.initialLineup.every(player) &&
    Array.isArray(sheet.presentOfficials) && sheet.presentOfficials.every(isOfficial) &&
    Array.isArray(sheet.presentSubstitutes) && sheet.presentSubstitutes.every((p: unknown) => isRecord(p) && typeof p.identificationNumber === 'string' && typeof p.displayName === 'string') &&
    Array.isArray(sheet.recipients) && sheet.recipients.every((r: unknown) => isRecord(r) && typeof r.userId === 'string' && ['organizer', 'scorekeeper', 'manager'].includes(String(r.role))) &&
    (sheet.representative === null || isRecord(sheet.representative) && typeof sheet.representative.identificationNumber === 'string' && typeof sheet.representative.displayName === 'string') &&
    typeof sheet.submittedAt === 'string' && typeof sheet.updatedAt === 'string') &&
    value.requests.every((r: unknown) => isRecord(r) && typeof r.id === 'string' && typeof r.teamId === 'string' &&
      typeof r.managerId === 'string' && isAction(r.action) && ['pending', 'approved', 'rejected'].includes(String(r.status)) &&
      typeof r.requestedAt === 'string' && (r.decidedAt === null || typeof r.decidedAt === 'string') &&
      (r.decisionNote === null || typeof r.decisionNote === 'string') && (r.appliedRevision === null || typeof r.appliedRevision === 'number') &&
      (r.courtesyRunnerSource === null || r.courtesyRunnerSource === 'BENCH' || r.courtesyRunnerSource === 'ROSTER') &&
      (r.decidedBy === null || isRecord(r.decidedBy) && typeof r.decidedBy.id === 'string' && ['organizer', 'scorekeeper'].includes(String(r.decidedBy.role))));
}
export function readTeamSheets(value: unknown): TeamSheetsSnapshot {
  if (!isSnapshot(value)) throw new Error('La entrega compartida contiene datos inválidos.');
  return value;
}
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
  const path = `${apiBase}/games/${gameId}/team-sheets`;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const query = new URLSearchParams({ tournamentId, userId, role });
    const load = async () => {
      try {
        const response = await fetch(`${path}?${query}`, { signal: controller.signal });
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
    const sheet = latest.current?.sheets.find((s) => s.teamId === request.teamId);
    if (!sheet) throw new Error('No se encontró la entrega del equipo.');
    await send(`personnel-requests/${encodeURIComponent(request.id)}/decision`, {
      tournamentId, actorId: userId, actorRole: role, expectedRevision: sheet.revision, decision, note
    });
  };
  const record = async (teamId: string, action: PersonnelAction, expectedOfficialVersion: number) => {
    const sheet = latest.current?.sheets.find((s) => s.teamId === teamId);
    if (!sheet || !latest.current?.canDecide) throw new Error('Solo un oficial autorizado puede registrar este cambio.');
    await send(`team-sheets/${teamId}/official-changes`, {
      tournamentId, actorId: userId, actorRole: role, expectedRevision: sheet.revision, expectedOfficialVersion, action
    });
  };
  return { data, error, streamError, notice, busy, request, decide, record, refresh: () => setRetry((n) => n + 1) };
}

// eslint-disable-next-line no-unused-vars -- ESLint's core rule treats this type-only parameter as a variable.
export function OfficialEntryForm({ onAdd, disabled = false }: { onAdd(official: PresentOfficial): void | Promise<void>; disabled?: boolean }) {
  const [role, setRole] = useState<PresentOfficial['role']>('DIRIGENTE');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
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
    case 'substitution': return `Sustitución: ${action.incomingIdentificationNumber} por ${action.outgoingIdentificationNumber} · ${positionLabels[action.fieldPosition]} · camiseta ${action.jerseyNumber}`;
    case 'defense': return `Cambio defensivo: ${action.identificationNumber} a ${positionLabels[action.fieldPosition]}`;
    case 'courtesy': return `Corredor temporal: ${action.incomingIdentificationNumber} por ${action.outgoingIdentificationNumber} en ${action.fromBase}.ª base`;
    case 'staff-arrival': return `Directivo presente: ${officialRoleLabels[action.official.role]} · ${action.official.displayName} · ${action.official.identificationNumber}`;
    case 'staff-departure': return `Retiro de directivo: ${officialRoleLabels[action.role]} · ${action.identificationNumber}`;
  }
}

export function DemoRecipientLinks() {
  return <nav className="managerButtonRow" aria-label="Bandejas de destinatarios de demostración">
    <a className="managerButtonOutline" href="/demo/live-scoring?view=organizer">Ver bandeja del organizador</a>
    <a className="managerButtonOutline" href="/demo/live-scoring?view=scorekeeper">Ver bandeja del anotador</a>
    <a className="managerButtonOutline" href="/demo/live-scoring?view=rival">Ver bandeja del dirigente rival</a>
  </nav>;
}

export function TeamSheetPanel({ connection, names, positionLabels, roster = [] }: {
  connection: TeamSheetConnection; names: Record<string, string>; positionLabels: Record<string, string>;
  roster?: Array<{ identificationNumber: string; displayName: string; jerseyNumber?: string }>;
}) {
  const { data } = connection;
  const [late, setLate] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
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
    <p>El manager entrega su lineup con jugadores del roster aprobado por el organizador. Después, el anotador u organizador registra las jugadas y los cambios comunicados en el campo; ambos managers los consultan en vivo. «Recibida» no significa que el destinatario la haya leído.</p>
    <p>El oficial debe respetar el reglamento del torneo, incluidos reingresos y casos especiales del bateador asignado y jugador flexible. Los movimientos pendientes anteriores se conservan para su resolución.</p>
    <DemoRecipientLinks />
    <button type="button" className="managerButtonOutline" onClick={connection.refresh}>Actualizar bandeja de entregas</button>
    {connection.error || connection.streamError || error ? <p className="managerWarning" role="alert">{connection.error || error || connection.streamError}</p> : null}
    {connection.notice ? <p role="status">{connection.notice}</p> : null}
    {!data ? <p>Consultando entregas del partido…</p> : null}
    {data?.sheets.map((sheet) => <section key={sheet.teamId} className="managerInlineList" aria-label={`Entrega de ${names[sheet.teamId] ?? sheet.teamId}`}>
      <h3>{names[sheet.teamId] ?? sheet.teamId} · Entrega recibida · Versión {sheet.revision}</h3>
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
    {ownSheet && data?.canDecide ? <>
      <h3>Jugador inscrito que llegó tarde</h3>
      <label className="managerField"><span>Jugador que llegó tarde</span><select value={late} onChange={(e) => setLate(e.target.value)}><option value="">Selecciona un jugador ausente</option>{roster.filter((p) => !present.includes(p.identificationNumber)).map((p) => <option key={p.identificationNumber} value={p.identificationNumber}>{p.displayName} · {p.identificationNumber}{jerseyFor(p.identificationNumber) ? ` · Camiseta ${jerseyFor(p.identificationNumber)}` : ''}</option>)}</select></label>
      <button type="button" className="managerButtonOutline" disabled={connection.busy} onClick={() => run(() => submit({ kind: 'arrival', identificationNumber: late }))}>Comunicar llegada tardía para confirmación</button>
      <OfficialEntryForm disabled={connection.busy} onAdd={(official) => submit({ kind: 'staff-arrival', official })} />
    </> : null}
    <h3>Movimientos comunicados</h3>
    {data?.requests.map((request) => <section className="managerInlineList" key={request.id} aria-label={`Movimiento ${request.id}`}>
      <p><strong>{names[request.teamId] ?? request.teamId} · {statusLabels[request.status]}</strong></p>
      <p>{personnelDescription(request.action, positionLabels)}</p>
      {request.decidedBy ? <p>Resuelto por {roleLabels[request.decidedBy.role]} ({request.decidedBy.id}){request.decisionNote ? ` · ${request.decisionNote}` : ''}</p> : null}
      {data.canDecide && request.status === 'pending' ? <>
        <label className="managerField"><span>Motivo o nota para {request.id}</span><input value={notes[request.id] ?? ''} onChange={(e) => setNotes((current) => ({ ...current, [request.id]: e.target.value }))} /></label>
        <div className="managerButtonRow">
          <button type="button" className="managerButtonSolid" disabled={connection.busy} onClick={() => run(() => connection.decide(request, 'approve', notes[request.id] ?? ''))}>Confirmar movimiento</button>
          <button type="button" className="managerButtonOutline" disabled={connection.busy} onClick={() => run(() => connection.decide(request, 'reject', notes[request.id] ?? ''))}>Rechazar movimiento</button>
        </div>
      </> : null}
    </section>)}
    {data && !data.requests.length ? <p>No hay movimientos comunicados.</p> : null}
  </article>;
}
