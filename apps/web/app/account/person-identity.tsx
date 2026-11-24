'use client';
import { useEffect, useRef, useState } from 'react';
import {
  identityImageMaxLength,
  readAccountProfile,
  readPersonIdentity,
  type AccountProfile,
  type PersonIdentity
} from '@playsport/shared';
import BirthDateInput from '../birth-date-input';
import { prepareLocalPhoto } from '../local-photo';
import { notifyAccountChange } from '../account-events';
import { useNavigationBusy } from '../navigation-hooks';

async function request(action: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/accounts/${action}`, {
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
        : 'No se pudo completar la operación de identidad.'
    );
  return value;
}
export default function PersonIdentityForm({
  account,
  onSaved
}: {
  account: AccountProfile;
  // eslint-disable-next-line no-unused-vars
  onSaved: (_account: AccountProfile) => void;
}) {
  const [identification, setIdentification] = useState(account.identity?.identification ?? '');
  const [fullName, setFullName] = useState(account.identity?.fullName ?? '');
  const [birthDate, setBirthDate] = useState(account.identity?.birthDate ?? '');
  const [documentPhoto, setDocumentPhoto] = useState(''),
    [personalPhoto, setPersonalPhoto] = useState('');
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null),
    sending = useRef(false);
  useNavigationBusy(busy);
  const prepare = async (file: File, kind: 'document' | 'personal') => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const photo = await prepareLocalPhoto(file, identityImageMaxLength, kind === 'document' ? 1400 : 800);
      if (kind === 'document') setDocumentPhoto(photo);
      else setPersonalPhoto(photo);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo preparar la fotografía.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const submit = async () => {
    if (sending.current) return;
    if (!pending.current)
      pending.current = {
        expectedAccountId: account.id,
        requestId: globalThis.crypto.randomUUID(),
        expectedRevision: account.identity?.revision ?? 0,
        identification,
        fullName,
        birthDate,
        documentPhoto,
        personalPhoto,
        consent
      };
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await request('identity', pending.current);
      if (!value || typeof value !== 'object' || !('account' in value)) throw new Error('No se confirmó la solicitud.');
      const next = readAccountProfile(value.account);
      if (next.id !== account.id) throw new Error('La solicitud no corresponde a esta cuenta.');
      onSaved(next);
      pending.current = null;
      setDocumentPhoto('');
      setPersonalPhoto('');
      setConsent(false);
      setNotice(
        'Solicitud recibida. Tu identidad queda pendiente hasta que un administrador compruebe los documentos.'
      );
      notifyAccountChange();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se confirmó el envío.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const identity = account.identity;
  return (
    <section className="managerCard managerStepCard personIdentityForm">
      <h2>Mi identidad en todo PlaySport</h2>
      <p>
        Una cédula identifica a la misma persona en todos los roles y módulos. Conocerla no permite acceder a su cuenta.
      </p>
      <p>
        Estado:{' '}
        <strong>
          {identity?.status === 'verified'
            ? 'Verificada mediante revisión documental manual'
            : identity?.status === 'pending'
              ? 'Documentos pendientes de revisión'
              : identity?.status === 'rejected'
                ? 'Requiere correcciones'
                : 'Perfil personal pendiente de completar'}
        </strong>
      </p>
      {identity ? <p>Cédula privada: {identity.identification}</p> : null}
      {identity?.reason ? <p>Resultado de revisión: {identity.reason}</p> : null}
      <p>
        La cédula y ambas fotografías son privadas. Las evidencias se guardan cifradas en el servidor, no en el
        almacenamiento del navegador, y se eliminan al resolver la revisión. Tu foto de cuenta pública se administra por
        separado.
      </p>
      <p className="managerWarning">
        Subir archivos no verifica
        automáticamente tu identidad ni habilita dinero real.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {identity?.status !== 'verified' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="accountFields" disabled={busy || pending.current !== null}>
            <label className="managerField">
              <span>Cédula personal</span>
              <input
                required
                maxLength={14}
                placeholder="V-12345678"
                value={identification}
                onChange={(event) => setIdentification(event.target.value)}
              />
            </label>
            <label className="managerField">
              <span>Nombres y apellidos de la cédula</span>
              <input required maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
            <BirthDateInput label="Fecha de nacimiento" value={birthDate} onChange={setBirthDate} />
            <label className="managerField">
              <span>Foto o escaneo de la cédula</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void prepare(file, 'document');
                }}
              />
            </label>
            <p>{documentPhoto ? 'Imagen de cédula preparada.' : 'Adjunta una imagen legible de la cédula.'}</p>
            <label className="managerField">
              <span>Foto personal para verificar tu identidad</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void prepare(file, 'personal');
                }}
              />
            </label>
            <p>{personalPhoto ? 'Foto personal preparada.' : 'Adjunta una foto frontal y clara de tu rostro.'}</p>
            <label>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{' '}
              Confirmo que los datos y documentos son míos y autorizo su revisión privada para verificar mi identidad.
            </label>
            <button
              className="managerButtonSolid"
              type="submit"
              disabled={!documentPhoto || !personalPhoto || !consent}
            >
              Enviar identidad a revisión
            </button>
          </fieldset>
          {pending.current && !busy ? (
            <div className="managerButtonRow">
              <button type="button" className="managerButtonSolid" onClick={() => void submit()}>
                Reintentar el mismo envío
              </button>
              <button
                type="button"
                className="managerButtonOutline"
                onClick={() => {
                  pending.current = null;
                  setError('Consulta el estado de tu cuenta antes de cambiar un envío que pudo haberse recibido.');
                }}
              >
                Editar solicitud
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
      {account.identityReviewer ? <IdentityReview key={account.id} accountId={account.id} /> : null}
    </section>
  );
}
export function IdentityReview({ accountId }: { accountId: string }) {
  const [queue, setQueue] = useState<Array<{ accountId: string; identity: PersonIdentity }>>([]);
  const [selected, setSelected] = useState<{
    accountId: string;
    identity: PersonIdentity;
    documentPhoto: string;
    personalPhoto: string;
  } | null>(null);
  const [reason, setReason] = useState(''),
    [matches, setMatches] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  useNavigationBusy(busy);
  useEffect(() => {
    let active = true;
    void request('identity-requests')
      .then((value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('accountId' in value) ||
          value.accountId !== accountId ||
          !('requests' in value) ||
          !Array.isArray(value.requests)
        )
          throw new Error('La cola no corresponde a la cuenta revisora.');
        const next = value.requests.map((row: unknown) => {
          if (
            !row ||
            typeof row !== 'object' ||
            !('accountId' in row) ||
            typeof row.accountId !== 'string' ||
            !('identity' in row)
          )
            throw new Error('La solicitud recibida no es válida.');
          return { accountId: row.accountId, identity: readPersonIdentity(row.identity) };
        });
        if (active) {
          setQueue(next);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'No se pudieron consultar las solicitudes.');
      });
    return () => {
      active = false;
      setSelected(null);
    };
  }, [accountId, retry]);
  const inspect = async (item: (typeof queue)[number]) => {
    setBusy(true);
    setError('');
    setSelected(null);
    try {
      const evidence = await request(`identity-evidence?accountId=${encodeURIComponent(item.accountId)}`);
      if (
        !evidence ||
        typeof evidence !== 'object' ||
        !('documentPhoto' in evidence) ||
        typeof evidence.documentPhoto !== 'string' ||
        !('personalPhoto' in evidence) ||
        typeof evidence.personalPhoto !== 'string'
      )
        throw new Error('No se pudieron leer las evidencias.');
      setSelected({ ...item, documentPhoto: evidence.documentPhoto, personalPhoto: evidence.personalPhoto });
      setReason('');
      setMatches(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo abrir la solicitud.');
    } finally {
      setBusy(false);
    }
  };
  const decide = async (decision: 'verified' | 'rejected') => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await request('identity-review', {
        expectedAccountId: accountId,
        accountId: selected.accountId,
        expectedRevision: selected.identity.revision,
        decision,
        reason,
        documentsMatch: matches
      });
      setSelected(null);
      setRetry((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se confirmó la revisión.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Administración privada de identidad">
      <h3>Revisión privada de identidades</h3>
      <p>Acceso administrativo explícito, independiente del rol Organizador. No puedes aprobar tu propia identidad.</p>
      {error ? <p role="alert">{error}</p> : null}
      <button
        className="managerButtonOutline"
        disabled={busy}
        onClick={() => {
          setSelected(null);
          setRetry((value) => value + 1);
        }}
      >
        Actualizar solicitudes
      </button>
      {!queue.length ? (
        <p>No hay solicitudes pendientes.</p>
      ) : (
        queue.map((item) => (
          <article key={item.accountId}>
            <p>
              {item.identity.fullName} · {item.identity.identification}
            </p>
            <button
              className="managerButtonOutline"
              disabled={busy || item.accountId === accountId}
              onClick={() => void inspect(item)}
            >
              Revisar documentos privados
            </button>
          </article>
        ))
      )}
      {selected ? (
        <fieldset disabled={busy}>
          <legend>
            {selected.identity.fullName} · {selected.identity.identification} · {selected.identity.birthDate}
          </legend>
          <img
            src={selected.documentPhoto}
            alt="Documento privado para revisión"
            style={{ maxWidth: '100%', maxHeight: 420 }}
          />
          <img
            src={selected.personalPhoto}
            alt="Foto personal privada para revisión"
            style={{ maxWidth: '100%', maxHeight: 320 }}
          />
          <label className="managerField">
            <span>Motivo y observaciones de la decisión</span>
            <textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={matches} onChange={(event) => setMatches(event.target.checked)} /> Comprobé
            los datos del documento y que ambas fotografías corresponden a la misma persona.
          </label>
          <div className="managerButtonRow">
            <button
              type="button"
              className="managerButtonSolid"
              disabled={!matches || !reason.trim()}
              onClick={() => void decide('verified')}
            >
              Aprobar identidad
            </button>
            <button
              type="button"
              className="managerButtonOutline"
              disabled={!reason.trim()}
              onClick={() => void decide('rejected')}
            >
              Solicitar correcciones
            </button>
            <button type="button" className="managerButtonOutline" onClick={() => setSelected(null)}>
              Cerrar documentos
            </button>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
