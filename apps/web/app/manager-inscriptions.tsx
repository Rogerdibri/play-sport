'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  isManagerRosterTeam,
  type ManagerRosterTeam,
  type TournamentTeam,
  type AccountProfile
} from '@playsport/shared';
import { usePlatformSession } from './platform-session';
import { useNavigationBusy } from './navigation-hooks';
import { EditableInstitutionName } from './institution-logo-editor';
import { useManagerTeamAccess } from './account/manager-teams/use-manager-team-access';

type Assignment = ManagerRosterTeam & {
  revision: number;
  enrollment: NonNullable<TournamentTeam['enrollment']>;
  rosterStatus: TournamentTeam['rosterStatus'];
  status: TournamentTeam['status'];
};
async function request(body?: unknown) {
  const response = await fetch('/api/tournaments/manager', {
    cache: 'no-store',
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  });
  const value: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      value && typeof value === 'object' && 'message' in value && typeof value.message === 'string'
        ? value.message
        : 'No se pudo consultar la inscripción.'
    );
  return value;
}
function assignments(value: unknown, accountId: string): Assignment[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('accountId' in value) ||
    value.accountId !== accountId ||
    !('tournaments' in value) ||
    !Array.isArray(value.tournaments)
  )
    throw new Error('Las inscripciones recibidas no corresponden a tu cuenta.');
  return value.tournaments.map((row: unknown) => {
    if (
      !isManagerRosterTeam(row) ||
      !('revision' in row) ||
      typeof row.revision !== 'number' ||
      !Number.isSafeInteger(row.revision) ||
      !('enrollment' in row) ||
      !row.enrollment ||
      typeof row.enrollment !== 'object' ||
      !('status' in row) ||
      !['pending', 'accepted', 'withdrawn'].includes(String(row.status)) ||
      !('rosterStatus' in row) ||
      !['pending', 'approved', 'rejected'].includes(String(row.rosterStatus))
    )
      throw new Error('Una inscripción recibida no es válida.');
    const entry = row.enrollment;
    if (
      !('status' in entry) ||
      !['invited', 'draft', 'submitted', 'changes-requested'].includes(String(entry.status)) ||
      !('contact' in entry) ||
      typeof entry.contact !== 'string' ||
      !('notes' in entry) ||
      typeof entry.notes !== 'string' ||
      !('submittedAt' in entry) ||
      typeof entry.submittedAt !== 'string' ||
      !('reviewNotes' in entry) ||
      typeof entry.reviewNotes !== 'string'
    )
      throw new Error('Los detalles de la inscripción no son válidos.');
    return {
      ...row,
      status: row.status as Assignment['status'],
      rosterStatus: row.rosterStatus as Assignment['rosterStatus'],
      revision: row.revision,
      enrollment: {
        status: entry.status as Assignment['enrollment']['status'],
        contact: entry.contact,
        notes: entry.notes,
        submittedAt: entry.submittedAt,
        reviewNotes: entry.reviewNotes
      }
    };
  });
}
export default function ManagerInscriptions() {
  const { account, session } = usePlatformSession();
  if (session?.role !== 'manager') return null;
  return (
    <details className="managerWorkDetails managerInscriptions">
      <summary>Mis inscripciones de equipos</summary>
      {!account ? (
        <p>
          <Link href="/account">Inicia sesión</Link> para consultar las inscripciones asignadas a tu identidad.
        </p>
      ) : account.identity?.status !== 'verified' ? (
        <p>
          <Link href="/account">Completa la verificación privada de tu identidad</Link>. Las invitaciones por cédula
          quedarán pendientes hasta entonces.
        </p>
      ) : (
        <AssignedInscriptions key={account.id} account={account} />
      )}
    </details>
  );
}
function AssignedInscriptions({ account }: { account: AccountProfile }) {
  const [list, setList] = useState<Assignment[] | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const { access, error: accessError } = useManagerTeamAccess(account.id);
  useEffect(() => {
    let active = true;
    void request()
      .then((value) => {
        const next = assignments(value, account.id);
        if (active) {
          setList(next);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'No se pudieron consultar tus inscripciones.');
      });
    return () => {
      active = false;
    };
  }, [account.id, retry]);
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {accessError ? <p role="alert">{accessError}</p> : null}
      <Link href="/account/manager-teams" className="managerButtonOutline">Mis cupos de Manager</Link>
      <button className="managerButtonOutline" onClick={() => setRetry((value) => value + 1)}>
        Actualizar mis inscripciones
      </button>
      {!list && !error ? <p role="status">Consultando tus inscripciones…</p> : null}
      {list?.length === 0 ? (
        <p>No tienes inscripciones asignadas. El organizador debe utilizar tu cédula, sin crear otra persona.</p>
      ) : null}
      {list?.map((item) => (
        <InscriptionEditor
          key={`${item.tournamentId}:${item.teamId}:${item.revision}`}
          item={item}
          accountId={account.id}
          readOnly={!access?.teams.some(team => team.managed && team.teamId === item.teamId && team.tournamentId === item.tournamentId)}
          onSaved={() => setRetry((value) => value + 1)}
        />
      ))}
    </>
  );
}
function InscriptionEditor({ item, accountId, onSaved, readOnly }: { item: Assignment; accountId: string; onSaved: () => void; readOnly: boolean }) {
  const { session, enter } = usePlatformSession();
  const [name, setName] = useState(item.enrollment.status === 'invited' ? '' : item.teamName);
  const [contact, setContact] = useState(item.enrollment.contact),
    [notes, setNotes] = useState(item.enrollment.notes);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null);
  useNavigationBusy(busy);
  const choose = () => {
    if (session?.role === 'manager')
      enter({
        ...session,
        workTeamId: item.teamId,
        workTournamentId: item.tournamentId,
        workTeamName: item.teamName,
        workManagerId: item.managerId
      });
  };
  const save = async (action: 'save' | 'submit') => {
    if (busy) return;
    if (!pending.current)
      pending.current = {
        requestId: globalThis.crypto.randomUUID(),
        expectedAccountId: accountId,
        expectedRevision: item.revision,
        tournamentId: item.tournamentId,
        teamId: item.teamId,
        action,
        name,
        contact,
        notes
      };
    setBusy(true);
    setError('');
    try {
      await request(pending.current);
      pending.current = null;
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se confirmó la inscripción.');
    } finally {
      setBusy(false);
    }
  };
  const locked = readOnly || item.enrollment.status === 'submitted' || item.status === 'withdrawn';
  return (
    <article className="tournamentSubcard">
      <h3>{item.tournamentName}</h3>
      <p>
        <EditableInstitutionName kind="team" id={item.teamId} editable={!locked && !busy && pending.current === null}>
          {item.teamName}
        </EditableInstitutionName>{' '}
        ·{' '}
        {item.rosterStatus === 'approved'
          ? 'Roster aprobado'
          : item.enrollment.status === 'submitted'
            ? 'En revisión por el organizador'
            : item.enrollment.status === 'changes-requested'
              ? 'Correcciones solicitadas'
              : 'Preparando inscripción'}
      </p>
      {!locked ? <p>Toca el logo o su recuadro vacío para colocar la imagen de este equipo.</p> : null}
      {item.enrollment.reviewNotes ? <p>{item.enrollment.reviewNotes}</p> : null}
      {readOnly ? <p role="status">Solo consulta. Activa esta inscripción en Mis cupos de Manager para continuar administrando.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <fieldset disabled={busy || locked || pending.current !== null}>
        <label className="managerField">
          <span>Nombre de mi equipo para este torneo</span>
          <input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="managerField">
          <span>Contacto del equipo para la organización</span>
          <input maxLength={500} value={contact} onChange={(event) => setContact(event.target.value)} />
        </label>
        <label className="managerField">
          <span>Detalles del equipo y observaciones de inscripción</span>
          <textarea maxLength={5000} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="managerButtonRow">
          <button className="managerButtonOutline" disabled={!name.trim()} onClick={() => void save('save')}>
            Guardar detalles de mi equipo
          </button>
          <button className="managerButtonSolid" disabled={!name.trim()} onClick={() => void save('submit')}>
            Enviar inscripción y roster a revisión
          </button>
        </div>
      </fieldset>
      {pending.current && !busy ? (
        <div className="managerButtonRow">
          <button className="managerButtonOutline" onClick={() => void save('save')}>
            Reintentar la misma operación
          </button>
          <button
            className="managerButtonOutline"
            onClick={() => {
              pending.current = null;
              setError('Actualiza las inscripciones antes de modificar un envío que pudo haberse recibido.');
            }}
          >
            Liberar edición
          </button>
        </div>
      ) : null}
      <div className="managerButtonRow">
        <Link className="managerButtonOutline" href="/demo/roster" onClick={choose}>
          Preparar roster y personal técnico
        </Link>
      </div>
    </article>
  );
}
