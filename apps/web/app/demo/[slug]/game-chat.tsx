'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { gameChatTextLimit, readGameChat, type GameChatAction, type GameChatSnapshot, type GameChatWindow } from '@playsport/shared';

export const gameChatLabels: Record<GameChatWindow, string> = {
  waiting: 'Se habilita cuando comienza el partido.',
  live: 'Chat abierto durante el partido.',
  postgame: 'Comentarios finales: abierto hasta 30 minutos después del final oficial.',
  closed: 'Chat cerrado. Los comentarios quedan disponibles para lectura.',
  paused: 'Chat en pausa mientras el partido está suspendido o bajo protesta.'
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación del chat.';
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
async function requestChat(path: string, signal: AbortSignal, action?: GameChatAction) {
  const response = await fetch(path, { method: action ? 'POST' : 'GET', cache: 'no-store', signal,
    ...(action ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) } : {}) });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : 'No se pudo consultar el chat del partido.');
  if (action) {
    if (!record(body) || typeof body.notice !== 'string') throw new Error('No se pudo confirmar la operación del chat.');
    return { chat: readGameChat(body.chat), notice: body.notice };
  }
  return { chat: readGameChat(body), notice: '' };
}
export function gameChatCanWrite(chat: GameChatSnapshot, serverNow: number): boolean {
  return Boolean(chat.viewer) && (chat.window === 'live' ||
    chat.window === 'postgame' && chat.closesAt !== null && serverNow < Date.parse(chat.closesAt));
}

export default function GameChat({ gameId, example = false }: { gameId: string; example?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GameChatSnapshot | null>(null);
  const [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [actionError, setActionError] = useState(''), [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now);
  const [report, setReport] = useState<{ messageId: number; reason: 'spam' | 'abuse' | 'other' } | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const sending = useRef(false), revision = useRef(0), offset = useRef(0), mounted = useRef(false);
  const cursor = useRef<number | null>(null);
  const viewer = useRef<string | null | undefined>(undefined);
  const path = `/api/game-chat/${encodeURIComponent(gameId)}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const accept = (chat: GameChatSnapshot, older = false) => {
    if (chat.gameId !== gameId) throw new Error('La respuesta del chat pertenece a otro partido.');
    offset.current = Date.now() - Date.parse(chat.serverNow);
    viewer.current = chat.viewer?.id ?? null;
    setNow(Date.now());
    setData(previous => {
      if (!previous || previous.viewer?.id !== chat.viewer?.id) return chat;
      const muted = new Set(chat.mutedAuthors.map(author => author.id));
      const messages = new Map([...previous.messages, ...chat.messages].filter(item => !muted.has(item.author.id)).map(item => [item.id, item]));
      return { ...chat, messages: [...messages.values()].sort((a, b) => a.id - b.id) };
    });
    if (older || cursor.current === null) setHasOlder(chat.hasOlder);
  };
  useEffect(() => {
    if (!open || example) return;
    let active = true, loading = false;
    const controller = new AbortController();
    const load = async () => {
      if (loading || sending.current) return;
      loading = true;
      const ticket = ++revision.current;
      try {
        const after = cursor.current;
        let result = await requestChat(after === null ? path : `${path}?after=${after}`, controller.signal);
        if (viewer.current !== undefined && viewer.current !== (result.chat.viewer?.id ?? null)) {
          result = await requestChat(path, controller.signal); cursor.current = null;
        }
        if (active && ticket === revision.current) {
          accept(result.chat); cursor.current = result.chat.messages.at(-1)?.id ?? after; setLoadError('');
        }
      } catch (error) { if (active && ticket === revision.current) setLoadError(errorMessage(error)); }
      finally { loading = false; }
    };
    void load();
    const timer = setInterval(() => { if (globalThis.document.visibilityState === 'visible') void load(); }, 5000);
    const visible = () => { if (globalThis.document.visibilityState === 'visible') void load(); };
    globalThis.document.addEventListener('visibilitychange', visible);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false; controller.abort(); clearInterval(timer); clearInterval(clock);
      globalThis.document.removeEventListener('visibilitychange', visible);
    };
  }, [open, path, example, attempt]);

  const perform = async (action: GameChatAction) => {
    if (sending.current) { setActionError('Espera a que termine la operación anterior del chat.'); return; }
    sending.current = true; setBusy(true); setActionError(''); setNotice('');
    const ticket = ++revision.current;
    try {
      const result = await requestChat(path, AbortSignal.timeout(10000), action);
      if (mounted.current && ticket === revision.current) {
        accept(result.chat); setNotice(result.notice);
        if (action.kind === 'message') setText('');
        if (action.kind === 'report') setReport(null);
      }
    } catch (error) { if (mounted.current) setActionError(errorMessage(error)); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  const older = async () => {
    if (sending.current || !data?.messages.length) return;
    sending.current = true; setBusy(true); setActionError('');
    const ticket = ++revision.current;
    try {
      const result = await requestChat(`${path}?before=${data.messages[0].id}`, AbortSignal.timeout(10000));
      if (mounted.current && ticket === revision.current) accept(result.chat, true);
    } catch (error) { if (mounted.current) setActionError(errorMessage(error)); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  const serverNow = now - offset.current;
  const closed = data?.window === 'postgame' && data.closesAt !== null && serverNow >= Date.parse(data.closesAt);
  const window = closed ? 'closed' : data?.window;
  const canWrite = data && gameChatCanWrite(data, serverNow) && !loadError && !busy;
  const length = [...text].length;
  const submit = (event: FormEvent) => { event.preventDefault(); void perform({ kind: 'message', text }); };
  return <details className="gameChat" id="chat-del-partido" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>Chat del partido</strong><span>Público · {open ? 'Ocultar' : 'Abrir'}</span></summary>
    {open ? <div className="gameChatContent">
      <p>Comentarios de la comunidad, separados de la anotación y de las apuestas. No publiques datos personales.</p>
      {example ? <p role="status">Este partido es un ejemplo con jugadas fijas. El chat público está disponible en los partidos oficiales, sin inventar comentarios.</p> : <>
        {loadError || actionError ? <p role="alert">{actionError || loadError}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Actualizar chat</button>
        {!data ? <p role="status">{loadError ? 'El chat no está disponible. Puedes seguir usando la pizarra.' : 'Consultando comentarios…'}</p> : <>
          <p className="gameChatStatus">{window ? gameChatLabels[window] : ''}</p>
          {window === 'postgame' && data.closesAt ? <p>Tiempo restante: {Math.ceil(Math.max(0, Date.parse(data.closesAt) - serverNow) / 60000)} min.</p> : null}
          {data.sessionExpired ? <p role="status">Tu sesión venció. Puedes leer los comentarios; inicia sesión para participar.</p> : null}
          {hasOlder ? <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => void older()}>Leer comentarios anteriores</button> : null}
          <ol className="gameChatMessages" aria-label="Comentarios públicos del partido">
            {data.messages.map(item => <li key={item.id}>
              <header><strong>{item.author.displayName}</strong>
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })}</time></header>
              <p>{item.text}</p>
              {data.viewer ? <div className="gameChatActions">
                <button type="button" disabled={busy} onClick={() => setReport({ messageId: item.id, reason: 'spam' })}>Reportar</button>
                {item.author.id !== data.viewer.id ? <button type="button" disabled={busy}
                  onClick={() => void perform({ kind: 'mute', authorId: item.author.id, muted: true })}>Silenciar en este partido</button> : null}
              </div> : null}
            </li>)}
          </ol>
          {!data.messages.length ? <p>No hay comentarios visibles en este partido.</p> : null}
          {report ? <form className="gameChatReport" onSubmit={event => {
            event.preventDefault(); void perform({ kind: 'report', ...report });
          }}>
            <label>Motivo del reporte<select value={report.reason} disabled={busy}
              onChange={event => setReport({ ...report, reason: event.target.value === 'abuse' ? 'abuse' : event.target.value === 'other' ? 'other' : 'spam' })}>
              <option value="spam">Mensajes repetidos o publicidad</option><option value="abuse">Acoso o insultos</option><option value="other">Otro contenido inapropiado</option>
            </select></label>
            <button type="submit" disabled={busy}>Enviar reporte</button>
            <button type="button" disabled={busy} onClick={() => setReport(null)}>Cancelar reporte</button>
          </form> : null}
          {data.mutedAuthors.length ? <details className="gameChatMuted"><summary>Usuarios silenciados por mí</summary>
            {data.mutedAuthors.map(author => <p key={author.id}>{author.displayName} <button type="button" disabled={busy}
              onClick={() => void perform({ kind: 'mute', authorId: author.id, muted: false })}>Volver a leer</button></p>)}
          </details> : null}
          {!data.viewer ? <Link href="/account">Crear cuenta o iniciar sesión para comentar</Link> : <form className="gameChatForm" onSubmit={submit}>
            <label htmlFor="game-chat-comment">Tu comentario · {data.viewer.displayName}</label>
            <textarea id="game-chat-comment" rows={2} required maxLength={gameChatTextLimit * 2}
              disabled={!canWrite} value={text} onChange={event => setText(event.target.value)} />
            <div><small>{length}/{gameChatTextLimit} caracteres · Máximo 5 mensajes en 30 segundos.</small>
              <button className="managerButtonSolid" type="submit" disabled={!canWrite || !text.trim() || length > gameChatTextLimit}>
                {busy ? 'Procesando…' : 'Enviar comentario'}
              </button></div>
          </form>}
        </>}
      </>}
    </div> : null}
  </details>;
}
