'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import DemoTeamLogo from './demo-team-logo';
import {
  institutionLogoKey,
  institutionLogosChangedEvent,
  institutionLogosChangedKey,
  readInstitutionLogos,
  type InstitutionKind,
  type InstitutionLogo
} from '@playsport/shared';
const Context = createContext<InstitutionLogo[]>([]);
const DemoLogos = createContext(false);
export const InstitutionLogoEditingContext = createContext<{
  entities: InstitutionLogo[];
  open: (_entity: InstitutionLogo) => void; // eslint-disable-line no-unused-vars
} | null>(null);
export const useInstitutionLogos = () => useContext(Context);
export const institutionLogoUrl = (entity: InstitutionLogo) =>
  `/api/institutional-logos/image?${new URLSearchParams({ kind: entity.kind, id: entity.id, revision: String(entity.revision) })}`;
export function notifyInstitutionLogosChanged() {
  globalThis.dispatchEvent(new globalThis.Event(institutionLogosChangedEvent));
  globalThis.localStorage.setItem(institutionLogosChangedKey, globalThis.crypto.randomUUID());
}
export default function InstitutionalLogos({ children }: { children: ReactNode }) {
  const [entities, setEntities] = useState<InstitutionLogo[]>([]),
    [error, setError] = useState(''),
    revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current;
    try {
      const response = await fetch('/api/institutional-logos', { cache: 'no-store' }),
        body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || !('entities' in body))
        throw new Error('No se pudieron cargar los logos compartidos.');
      const next = readInstitutionLogos(body.entities);
      if (current === revision.current) {
        setEntities(next);
        setError('');
      }
    } catch (value) {
      if (current === revision.current)
        setError(value instanceof Error ? value.message : 'No se pudieron cargar los logos.');
    }
  }, []);
  useEffect(() => {
    void load();
    const storage = (event: globalThis.StorageEvent) => {
      if (event.key === institutionLogosChangedKey) void load();
    };
    globalThis.addEventListener(institutionLogosChangedEvent, load);
    globalThis.addEventListener('storage', storage);
    globalThis.addEventListener('focus', load);
    const timer = globalThis.setInterval(load, 30000);
    return () => {
      revision.current++;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener(institutionLogosChangedEvent, load);
      globalThis.removeEventListener('storage', storage);
      globalThis.removeEventListener('focus', load);
    };
  }, [load]);
  return (
    <Context.Provider value={entities}>
      <DemoLogos.Provider value={true}>
        {error ? (
          <div className="institutionLogoWarning" role="alert">
            {error}{' '}
            <button type="button" onClick={() => void load()}>
              Recargar logos
            </button>
          </div>
        ) : null}
        {children}
      </DemoLogos.Provider>
    </Context.Provider>
  );
}
export function InstitutionName({
  kind = 'team',
  id,
  example = false,
  editable = true,
  logoEntity,
  children
}: {
  kind?: InstitutionKind;
  id?: string;
  example?: boolean;
  editable?: boolean;
  logoEntity?: InstitutionLogo;
  children: ReactNode;
}) {
  const entities = useContext(Context);
  const demo = useContext(DemoLogos) === true;
  const access = useContext(InstitutionLogoEditingContext);
  const managed = access?.entities.find((row) => row.kind === kind && row.id === id);
  const edit = editable && managed && access ? () => access.open(managed) : undefined;
  const entity =
    logoEntity && logoEntity.id === id && logoEntity.kind === kind
      ? logoEntity
      : managed ?? (id
        ? entities.find((row) => institutionLogoKey(row.kind, row.id) === institutionLogoKey(kind, id))
        : undefined);
  const label = entity && children === id ? entity.name : children;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [entity?.id, entity?.revision]);
  const canonicalName =
    entity?.name ??
    (id === 'team-A'
      ? 'Tigres del Valle'
      : id === 'team-B'
        ? 'Leones del Norte'
        : typeof children === 'string'
          ? children
          : '');
  let graphic: ReactNode;
  if (!entity?.hasLogo) {
    if (kind === 'team' && canonicalName && (example || (demo && Boolean(id))) && (!entity || entity.revision === 0)) {
      graphic = <DemoTeamLogo name={canonicalName} />;
    } else if (edit) {
      graphic = (
        <span className="institutionLogoPlaceholder" aria-hidden="true">
          +
        </span>
      );
    } else return <>{label}</>;
  } else {
    graphic = failed ? (
      <span className="institutionLogoUnavailable" role="status">
        Logo no disponible
      </span>
    ) : (
      <img
        src={institutionLogoUrl(entity)}
        alt={`Logo de ${entity.name}`}
        className="institutionLogo"
        width={32}
        height={32}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="institutionName">
      {edit ? (
        <InstitutionLogoTrigger name={canonicalName} onEdit={edit}>
          {graphic}
        </InstitutionLogoTrigger>
      ) : (
        graphic
      )}
      <span>{label}</span>
    </span>
  );
}
export function InstitutionLogoTrigger({ name, onEdit, children }: {
  name: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  const target = useRef<globalThis.HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const opened = useRef(false);
  const [nested, setNested] = useState(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => {
    const parent = target.current?.parentElement?.closest<globalThis.HTMLElement>('button, a, summary, [role="button"]');
    setNested(Boolean(parent));
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        onEdit();
      }
    };
    parent?.addEventListener('keydown', keyboard);
    return () => parent?.removeEventListener('keydown', keyboard);
  }, [onEdit, cancel]);
  useEffect(() => {
    globalThis.addEventListener('blur', cancel);
    globalThis.document.addEventListener('visibilitychange', cancel);
    return () => {
      cancel();
      globalThis.removeEventListener('blur', cancel);
      globalThis.document.removeEventListener('visibilitychange', cancel);
    };
  }, [cancel]);
  return (
    <span
      ref={target}
      className="institutionLogoTrigger"
      role={nested ? undefined : 'button'}
      tabIndex={nested ? undefined : 0}
      aria-label={nested ? undefined : `Cambiar logo de ${name}`}
      title={`Mantén presionado para cambiar el logo de ${name}`}
      aria-haspopup={nested ? undefined : 'dialog'}
      onPointerDown={(event) => {
        cancel();
        opened.current = false;
        if (!event.isPrimary || event.button !== 0) return;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = globalThis.setTimeout(() => {
          timer.current = null;
          origin.current = null;
          opened.current = true;
          onEdit();
        }, 600);
      }}
      onPointerMove={(event) => {
        if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10)
          cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (opened.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (!nested && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) onEdit();
        } else if (event.key === 'Escape') cancel();
      }}
    >
      {children}
    </span>
  );
}
export function ExampleTeamName({ children }: { children: string }) {
  return <InstitutionName example>{children}</InstitutionName>;
}
export function ExampleTeamText({ children, teams }: { children: string; teams: string[] }) {
  const names = [...new Set(teams.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!names.length) return <>{children}</>;
  const pattern = new RegExp(`(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return (
    <>
      {children
        .split(pattern)
        .map((part, index) => (names.includes(part) ? <ExampleTeamName key={index}>{part}</ExampleTeamName> : part))}
    </>
  );
}
