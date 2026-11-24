'use client';
import { useEffect, useRef, useState } from 'react';
import { accountPhotoMaxLength, accountPhotoChangedEvent, readAccountPhotoChange, readAccountProfile,
  type AccountPhotoChange, type AccountProfile } from '@playsport/shared';
import AccountAvatar from './account-avatar';
import { notifyAccountChange } from './account-events';
import { prepareLocalPhoto } from './local-photo';
import { useNavigationBusy } from './navigation-hooks';

// eslint-disable-next-line no-unused-vars -- Type-only callback parameter.
type Props = { account: AccountProfile; legacyPhoto?: string; disabled?: boolean; onSaved?: (account: AccountProfile) => void };
const pendingKey = (id: string) => `playsport:account-photo-pending:v1:${id}`;
export default function AccountPhotoEditor({ account, legacyPhoto, disabled = false, onSaved }: Props) {
  const [photo, setPhoto] = useState(account.photo ?? ''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<AccountPhotoChange | null>(null);
  const baseRevision = useRef(account.photoRevision ?? 0), savedPhoto = useRef(account.photo ?? ''), current = useRef(account), mounted = useRef(false), sending = useRef(false);
  current.current = account;
  useNavigationBusy(busy);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = globalThis.sessionStorage.getItem(pendingKey(account.id));
      if (saved) {
        const command = readAccountPhotoChange(JSON.parse(saved));
        if (command.expectedAccountId !== account.id) throw new Error('La foto pendiente no corresponde a esta cuenta.');
        setPending(command); setPhoto(command.photo); baseRevision.current = command.expectedRevision;
      }
    } catch (value) { setError(value instanceof Error ? value.message : 'No se pudo recuperar la foto pendiente.'); }
    return () => { mounted.current = false; };
  }, [account.id]);
  useEffect(() => {
    if (!sending.current && !pending && photo === savedPhoto.current) {
      savedPhoto.current = account.photo ?? ''; baseRevision.current = account.photoRevision ?? 0;
      setPhoto(savedPhoto.current);
    }
  }, [account.photo, account.photoRevision, pending, photo]);
  const prepare = async (file: File) => {
    if (sending.current) { setError('Espera a que termine la preparación de foto.'); return; }
    const id = account.id;
    sending.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const prepared = await prepareLocalPhoto(file, accountPhotoMaxLength, 320);
      if (mounted.current && current.current.id === id) setPhoto(prepared);
    } catch (value) { if (mounted.current && current.current.id === id) setError(value instanceof Error ? value.message : 'No se pudo preparar la foto.'); }
    finally { sending.current = false; if (mounted.current && current.current.id === id) setBusy(false); }
  };
  const save = async (resume = false) => {
    if (!mounted.current) return;
    if (sending.current) { setError('Espera a que termine la actualización de foto.'); return; }
    const id = account.id;
    let command = pending;
    if (!command) {
      try {
        command = readAccountPhotoChange({ requestId: globalThis.crypto.randomUUID(), expectedAccountId: id,
          expectedRevision: baseRevision.current, photo });
        globalThis.sessionStorage.setItem(pendingKey(id), JSON.stringify(command));
      } catch (value) { setError(value instanceof Error ? value.message : 'No se pudo guardar la solicitud pendiente. No se envió la foto.'); return; }
      setPending(command);
    } else if (!resume) { setError('Confirma primero la actualización pendiente con la misma solicitud.'); return; }
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/accounts/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const body: unknown = await response.json();
      if (!mounted.current || current.current.id !== id) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          globalThis.sessionStorage.removeItem(pendingKey(id)); setPending(null);
          globalThis.dispatchEvent(new globalThis.Event(accountPhotoChangedEvent));
        }
        throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'No se confirmó la foto. Reintenta la misma solicitud.');
      }
      if (!body || typeof body !== 'object' || !('account' in body) || !('appliedRevision' in body) ||
        typeof body.appliedRevision !== 'number' || !Number.isSafeInteger(body.appliedRevision) || body.appliedRevision < 1) throw new Error('La respuesta de actualización de foto no es válida.');
      const next = readAccountProfile(body.account);
      if (next.id !== id || !next.photoRevision || next.photoRevision < body.appliedRevision) throw new Error('La foto confirmada no corresponde a esta cuenta o revisión.');
      savedPhoto.current = next.photo ?? ''; setPhoto(savedPhoto.current); baseRevision.current = next.photoRevision; onSaved?.(next);
      setNotice(next.photoRevision === body.appliedRevision ? 'Foto de cuenta guardada. Se usa en todos tus roles y en tu billetera.' : 'Solicitud confirmada. Otra actualización posterior cambió la foto; se muestra la versión actual.');
      try { globalThis.sessionStorage.removeItem(pendingKey(id)); }
      catch { throw new Error('La foto fue guardada, pero no se pudo limpiar la solicitud pendiente. Reintentar la misma clave no la duplica.'); }
      setPending(null);
      try { notifyAccountChange(true); }
      catch { throw new Error('La foto fue guardada, pero no se pudo avisar a otras pestañas. Recárgalas para verla.'); }
    } catch (value) { if (mounted.current && current.current.id === id) setError(value instanceof Error ? value.message : 'No se confirmó la foto. Reintenta la misma solicitud.'); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="managerCard managerStepCard accountPhotoEditor">
    <h2>Foto de mi cuenta</h2><p>Identifica a {account.displayName} en todos sus roles, la barra superior y la billetera. No verifica identidad ni concede permisos.</p>
    <div className="accountIdentity"><AccountAvatar account={{ ...account, photo }} size={112} /><strong>{account.displayName}</strong></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={disabled || busy || pending !== null}>
        <label className="managerField"><span>Cargar foto de mi cuenta</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void prepare(file);
        }} /></label>
        <p>JPG, PNG o WebP de hasta 5 MB. Se prepara como JPEG de hasta 320 píxeles, sin metadatos del archivo original.</p>
        {legacyPhoto ? <><p>Este perfil tiene una foto local anterior. No se comparte automáticamente con tu cuenta.</p>
          <button type="button" className="managerButtonOutline" onClick={() => {
            try {
              const encoded = legacyPhoto.slice('data:image/jpeg;base64,'.length);
              const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
              void prepare(new File([bytes], 'foto-local.jpg', { type: 'image/jpeg' }));
            } catch { setError('No se pudo leer la foto local anterior. Selecciona un archivo para reemplazarla.'); }
          }}>Usar la foto guardada de este perfil para mi cuenta</button></> : null}
        {photo ? <button type="button" className="managerButtonOutline" onClick={() => { setPhoto(''); setNotice(''); }}>Quitar foto de mi cuenta</button> : null}
        <button type="submit" className="managerButtonSolid">Guardar foto de mi cuenta</button>
      </fieldset>
    </form>
    {pending && !busy ? <div className="managerWarning" role="alert"><p>La actualización puede haberse guardado aunque no llegara su respuesta.</p>
      <button disabled={disabled} onClick={() => void save(true)}>Reintentar foto pendiente con la misma solicitud</button></div> : null}
    {!pending ? <button className="managerButtonOutline" disabled={busy || disabled} onClick={() => {
      savedPhoto.current = account.photo ?? ''; setPhoto(savedPhoto.current); baseRevision.current = account.photoRevision ?? 0; setError(''); setNotice('Foto guardada recuperada. Los cambios de vista previa no se publicaron.');
    }}>Recargar foto guardada</button> : null}
    {busy ? <p role="status">Preparando o guardando foto…</p> : null}
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
  </section>;
}
