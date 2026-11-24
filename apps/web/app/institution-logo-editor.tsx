'use client';
import { useEffect, useRef, useState, type ReactNode, type Dispatch } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  institutionLogoMaxLength,
  institutionLogosChangedEvent,
  institutionLogosChangedKey,
  readInstitutionLogoChange,
  readInstitutionLogos,
  type InstitutionLogo,
  type InstitutionLogoChange,
  type InstitutionKind
} from '@playsport/shared';
import { usePlatformSession } from './platform-session';
import { demoIdentity } from './platform-navigation';
import {
  InstitutionName,
  InstitutionLogoEditingContext,
  institutionLogoUrl,
  notifyInstitutionLogosChanged,
  useInstitutionLogos
} from './institutional-logos';
import DemoTeamLogo from './demo-team-logo';
import { prepareLocalPhoto } from './local-photo';
import { useNavigationBusy } from './navigation-hooks';
function useLogoAccess() {
  const { session, account } = usePlatformSession();
  const role = session?.role;
  const actorId =
    (session?.role === 'manager' || session?.role === 'organizer' && !account?.localTestAccess) && account?.identity?.status === 'verified'
      ? (account.identity.actorId ?? null)
      : session
        ? demoIdentity(session).id
        : null;
  return { account, role, actorId };
}
export default function IdentityPage() {
  const { account, role, actorId } = useLogoAccess(),
    [entities, setEntities] = useState<InstitutionLogo[] | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setEntities(null);
    setError('');
    if (!account || !actorId || (role !== 'manager' && role !== 'organizer')) return;
    const params = new URLSearchParams({ role, actorId });
    void fetch(`/api/institutional-logos/manage?${params}`)
      .then(async (response) => {
        const body: unknown = await response.json();
        if (
          !response.ok ||
          !body ||
          typeof body !== 'object' ||
          !('accountId' in body) ||
          body.accountId !== account.id ||
          !('entities' in body)
        ) {
          throw new Error(
            body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
              ? body.message
              : 'No se pudieron consultar las identidades que administras.'
          );
        }
        const rows = readInstitutionLogos(body.entities);
        if (active) setEntities(rows);
      })
      .catch((value) => {
        if (active) setError(value instanceof Error ? value.message : 'No se pudo cargar la identidad visual.');
      });
    return () => {
      active = false;
    };
  }, [account?.id, actorId, role, attempt]);
  return (
    <main className="managerShell identityPage">
      <header className="moduleHeader">
        <h1>Logos de equipos, torneos y ligas</h1>
        <p>
          El manager administra el logo de su inscripción. El organizador administra los logos independientes de sus
          torneos y ligas.
        </p>
        <p>
          Tu identidad verificada y la propiedad de cada inscripción, torneo o liga determinan cuáles logos puedes editar.
        </p>
      </header>
      {!account ? (
        <p>
          <Link href="/account">Inicia sesión en tu cuenta</Link> para administrar logos.
        </p>
      ) : role !== 'manager' && role !== 'organizer' ? (
        <p>Entra como manager u organizador para administrar la identidad visual.</p>
      ) : error ? (
        <div role="alert" className="managerWarning">
          {error}
          <button onClick={() => setAttempt((value) => value + 1)}>Reintentar</button>
        </div>
      ) : !entities ? (
        <p role="status">Consultando equipos y torneos…</p>
      ) : !entities.length ? (
        <p>No tienes equipos o torneos asignados para esta edición.</p>
      ) : (
        entities.map((entity) => (
          <LogoEditor
            key={`${account.id}:${role}:${actorId}:${entity.kind}:${entity.id}:${attempt}`}
            entity={entity}
            accountId={account.id}
            role={role}
            actorId={actorId ?? ''}
          />
        ))
      )}
    </main>
  );
}
export function EditableInstitutionName({
  kind = 'team',
  id,
  children,
  editable = true
}: {
  kind?: InstitutionKind;
  id?: string;
  children: ReactNode;
  editable?: boolean;
}) {
  return <InstitutionName kind={kind} id={id} editable={editable}>{children}</InstitutionName>;
}
export function InstitutionLogoEditing({ children }: { children: ReactNode }) {
  const { account, role, actorId } = useLogoAccess();
  const [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<{ owner: string; entities: InstitutionLogo[]; error: string } | null>(null);
  const [selected, setSelected] = useState<{ owner: string; entity: InstitutionLogo; editing: boolean } | null>(null);
  const dialog = useRef<globalThis.HTMLDialogElement>(null);
  const trigger = useRef<globalThis.Element | null>(null);
  const canLoad = Boolean(
    account &&
    actorId &&
    (role === 'organizer' || role === 'manager') &&
    (account.localTestAccess || account.identity?.status === 'verified')
  );
  const owner = JSON.stringify([account?.id, role, actorId, canLoad]);
  const entities = canLoad && data?.owner === owner ? data.entities : [];
  const error = canLoad && data?.owner === owner ? data.error : '';
  const current = canLoad && selected?.owner === owner &&
    entities.some((row) => row.kind === selected.entity.kind && row.id === selected.entity.id) ? selected : null;
  const open = Boolean(current);
  useEffect(() => {
    setSelected(null);
    setBusy(false);
  }, [owner]);
  useEffect(() => {
    if (!canLoad) return;
    const reload = () => setAttempt((value) => value + 1);
    const storage = (event: globalThis.StorageEvent) => {
      if (event.key === institutionLogosChangedKey) reload();
    };
    globalThis.addEventListener(institutionLogosChangedEvent, reload);
    globalThis.addEventListener('storage', storage);
    globalThis.addEventListener('focus', reload);
    return () => {
      globalThis.removeEventListener(institutionLogosChangedEvent, reload);
      globalThis.removeEventListener('storage', storage);
      globalThis.removeEventListener('focus', reload);
    };
  }, [canLoad]);
  useEffect(() => {
    if (!canLoad || !account || !actorId || (role !== 'organizer' && role !== 'manager')) return;
    let active = true;
    const params = new URLSearchParams({ role, actorId });
    void fetch(`/api/institutional-logos/manage?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (
          !response.ok ||
          !body ||
          typeof body !== 'object' ||
          !('accountId' in body) ||
          body.accountId !== account.id ||
          !('entities' in body)
        )
          throw new Error(
            body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
              ? body.message
              : 'No se pudieron consultar tus permisos para este logo.'
          );
        const rows = readInstitutionLogos(body.entities);
        if (active) setData({ owner, entities: rows, error: '' });
      })
      .catch((value) => {
        if (active) setData({ owner, entities: [], error: value instanceof Error ? value.message : 'No se pudo consultar la edición de logos.' });
      });
    return () => {
      active = false;
    };
  }, [canLoad, account?.id, actorId, role, owner, attempt]);
  useEffect(() => {
    if (current && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!current && trigger.current instanceof globalThis.HTMLElement && trigger.current.isConnected) trigger.current.focus();
  }, [open]);
  return (
    <InstitutionLogoEditingContext.Provider value={{
      entities,
      open: (entity) => {
        trigger.current = globalThis.document.activeElement;
        setBusy(false);
        setSelected({ owner, entity, editing: false });
      }
    }}>
      {error ? (
        <div className="institutionLogoWarning" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Reintentar</button>
        </div>
      ) : null}
      {children}
      {current && account && actorId && (role === 'organizer' || role === 'manager')
        ? createPortal(
            <dialog
              ref={dialog}
              className="institutionLogoDialog"
              aria-label={current.editing ? 'Editar logo' : 'Cambiar logo'}
              onCancel={(event) => {
                if (busy) event.preventDefault();
                else setSelected(null);
              }}
            >
              <button
                className="managerButtonOutline institutionLogoClose"
                type="button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                {current.editing ? 'Cerrar editor de logo' : 'Cancelar'}
              </button>
              {current.editing ? (
                <LogoEditor
                  key={`${account.id}:${role}:${actorId}:${current.entity.kind}:${current.entity.id}`}
                  entity={current.entity}
                  accountId={account.id}
                  role={role}
                  actorId={actorId}
                  onBusyChange={setBusy}
                  onSaved={(entity) => setSelected((value) => value ? { ...value, entity } : null)}
                />
              ) : (
                <>
                  <h2>¿Deseas cambiar el logo?</h2>
                  <p>{current.entity.name}</p>
                  <button type="button" className="managerButtonSolid"
                    onClick={() => setSelected((value) => value ? { ...value, editing: true } : null)}>
                    Cambiar logo
                  </button>
                </>
              )}
            </dialog>,
            globalThis.document.body
          )
        : null}
    </InstitutionLogoEditingContext.Provider>
  );
}
export function LogoEditor({
  entity,
  accountId,
  role,
  actorId,
  onBusyChange,
  onSaved
}: {
  entity: InstitutionLogo;
  accountId: string;
  role: 'manager' | 'organizer';
  actorId: string;
  onBusyChange?: Dispatch<boolean>;
  onSaved?: Dispatch<InstitutionLogo>;
}) {
  const [current, setCurrent] = useState(entity);
  const shared = useInstitutionLogos().find((row) => row.kind === entity.kind && row.id === entity.id);
  const latest = shared && shared.revision > entity.revision ? shared : entity;
  const [logo, setLogo] = useState<string | null>(null),
    [pending, setPending] = useState<InstitutionLogoChange | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const base = useRef(entity.revision),
    sending = useRef(false),
    mounted = useRef(false);
  const key = `playsport:institution-logo-pending:v1:${accountId}:${entity.kind}:${entity.id}:${role}:${actorId}`;
  useNavigationBusy(busy);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (latest.revision > current.revision && logo === null && !pending && !sending.current) {
      setCurrent(latest);
      base.current = latest.revision;
    }
  }, [latest, current.revision, logo, pending]);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = globalThis.sessionStorage.getItem(key);
      if (saved) {
        const command = readInstitutionLogoChange(JSON.parse(saved));
        if (
          command.expectedAccountId !== accountId ||
          command.kind !== entity.kind ||
          command.id !== entity.id ||
          command.role !== role ||
          command.actorId !== actorId
        )
          throw new Error('La solicitud pendiente no corresponde a esta identidad o perfil.');
        setPending(command);
        setLogo(command.logo);
        base.current = command.expectedRevision;
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : 'No se pudo recuperar el logo pendiente.');
    }
    return () => {
      mounted.current = false;
    };
  }, [key, accountId, entity.kind, entity.id, role, actorId]);
  const prepare = async (file: File) => {
    if (sending.current) {
      setError('Espera a que termine la preparación del logo.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const image = await prepareLocalPhoto(
        file,
        institutionLogoMaxLength,
        320,
        file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
      );
      if (mounted.current) setLogo(image);
    } catch (value) {
      if (mounted.current) setError(value instanceof Error ? value.message : 'No se pudo preparar el logo.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = async (resume = false) => {
    if (!mounted.current) return;
    if (sending.current) {
      setError('Espera a que termine el cambio de logo.');
      return;
    }
    let command = pending;
    if (!command) {
      if (logo === null) {
        setError('Selecciona un logo o pulsa quitar antes de guardar.');
        return;
      }
      try {
        command = readInstitutionLogoChange({
          requestId: crypto.randomUUID(),
          expectedAccountId: accountId,
          expectedRevision: base.current,
          role,
          actorId,
          kind: entity.kind,
          id: entity.id,
          logo
        });
        globalThis.sessionStorage.setItem(key, JSON.stringify(command));
        setPending(command);
      } catch (value) {
        setError(value instanceof Error ? value.message : 'No se pudo conservar la solicitud. No se envió el logo.');
        return;
      }
    } else if (!resume) {
      setError('Confirma primero el cambio pendiente con la misma solicitud.');
      return;
    }
    sending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/institutional-logos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command)
        }),
        body: unknown = await response.json();
      if (!mounted.current) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          globalThis.sessionStorage.removeItem(key);
          setPending(null);
        }
        throw new Error(
          body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
            ? body.message
            : 'No se confirmó el logo. Reintenta la misma solicitud.'
        );
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('entities' in body) ||
        !('appliedRevision' in body) ||
        typeof body.appliedRevision !== 'number' ||
        !Number.isSafeInteger(body.appliedRevision) ||
        body.appliedRevision < 1
      )
        throw new Error('La confirmación del logo no es válida.');
      const saved = readInstitutionLogos(body.entities).find((row) => row.kind === entity.kind && row.id === entity.id);
      if (!saved || saved.revision < body.appliedRevision)
        throw new Error('La revisión confirmada del logo no es válida.');
      base.current = saved.revision;
      setLogo(null);
      setCurrent(saved);
      onSaved?.(saved);
      setNotice(
        saved.revision === body.appliedRevision
          ? 'Logo guardado. Se comparte en todas las vistas de esta identidad.'
          : 'Solicitud confirmada. Otra edición posterior cambió el logo.'
      );
      try {
        globalThis.sessionStorage.removeItem(key);
        setPending(null);
      } catch {
        throw new Error(
          'El logo se guardó, pero no se pudo limpiar su solicitud pendiente. Reintentar no duplica el cambio.'
        );
      }
      try {
        notifyInstitutionLogosChanged();
      } catch {
        throw new Error('El logo se guardó, pero no se pudo avisar a otras pestañas. Recárgalas para verlo.');
      }
    } catch (value) {
      if (mounted.current)
        setError(value instanceof Error ? value.message : 'No se confirmó el logo. Reintenta la misma solicitud.');
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section className="managerCard managerStepCard institutionLogoEditor">
      <h2>
        <InstitutionName kind={entity.kind} id={entity.id} editable={false}>
          {entity.name}
        </InstitutionName>
      </h2>
      <p>{entity.kind === 'team' ? 'Equipo' : entity.kind === 'league' ? 'Liga' : 'Torneo'}</p>
      {logo !== null ? (
        logo ? (
          <img className="institutionLogoPreview" src={logo} alt={`Vista previa del logo de ${entity.name}`} />
        ) : (
          <p>Vista previa sin logo. Aún no se ha publicado.</p>
        )
      ) : current.hasLogo ? (
        <img
          className="institutionLogoPreview"
          src={institutionLogoUrl(current)}
          alt={`Logo guardado de ${entity.name}`}
        />
      ) : entity.kind === 'team' && current.revision === 0 ? (
        <>
          <DemoTeamLogo name={entity.name} preview />
          <p>Sube y guarda tu logo para reemplazarlo.</p>
        </>
      ) : (
        <p>Esta identidad todavía no tiene logo.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || pending !== null}>
          <label className="managerField">
            Seleccionar logo de {entity.name}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void prepare(file);
              }}
            />
          </label>
          <p>
            JPG, PNG o WebP de hasta 5 MB. Hasta 320 píxeles, sin metadatos originales. Se conserva la transparencia de
            PNG y WebP.
          </p>
          <button
            type="button"
            className="managerButtonOutline"
            onClick={() => {
              setLogo('');
              setNotice('');
            }}
          >
            Quitar logo
          </button>{' '}
          <button type="submit" className="managerButtonSolid">
            Guardar logo de {entity.name}
          </button>
        </fieldset>
      </form>
      {pending && !busy ? (
        <button className="managerButtonOutline" onClick={() => void save(true)}>
          Confirmar cambio pendiente de {entity.name}
        </button>
      ) : null}
      {!pending ? (
        <button
          className="managerButtonOutline"
          disabled={busy}
          onClick={async () => {
            setError('');
            try {
              const params = new URLSearchParams({ role, actorId });
              const response = await fetch(`/api/institutional-logos/manage?${params}`, { cache: 'no-store' }),
                body: unknown = await response.json();
              if (
                !response.ok ||
                !body ||
                typeof body !== 'object' ||
                !('entities' in body) ||
                !('accountId' in body) ||
                body.accountId !== accountId
              )
                throw new Error('No se pudo recargar el logo.');
              const saved = readInstitutionLogos(body.entities).find(
                (row) => row.kind === entity.kind && row.id === entity.id
              );
              if (!saved) throw new Error('La identidad ya no está disponible.');
              base.current = saved.revision;
              setLogo(null);
              setCurrent(saved);
              onSaved?.(saved);
              setNotice('Logo guardado recuperado. La vista previa no se publicó.');
              notifyInstitutionLogosChanged();
            } catch (value) {
              setError(value instanceof Error ? value.message : 'No se pudo recargar el logo.');
            }
          }}
        >
          Recargar logo guardado
        </button>
      ) : null}
      {busy ? <p role="status">Preparando o guardando logo…</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? (
        <p role="alert" className="managerWarning">
          {error}
        </p>
      ) : null}
    </section>
  );
}
