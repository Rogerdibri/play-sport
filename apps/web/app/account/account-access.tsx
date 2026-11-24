'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accountChangedEvent, accountChangedKey, accountPhotoChangedEvent, accountPhotoChangedKey, readAccountProfile, type AccountProfile } from '@playsport/shared';
import AccountPhotoEditor from '../account-photo-editor';
import AccountAvatar from '../account-avatar';
import { notifyAccountChange } from '../account-events';
import PersonIdentityForm from './person-identity';
import { usePlatformSession } from '../platform-session';
import { useNavigationBusy } from '../navigation-hooks';

class AccountError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function requestAccount(action: string, body?: Record<string, string>): Promise<AccountProfile | null> {
  const response = await fetch(`/api/accounts/${action}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (response.status === 204) return null;
  const result: unknown = await response.json();
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result && typeof result.message === 'string' ?
      result.message : 'No se pudo completar la operación de cuenta.';
    throw new AccountError(message, response.status);
  }
  if (!result || typeof result !== 'object' || !('account' in result)) throw new Error('No se pudo leer la cuenta.');
  return readAccountProfile(result.account);
}

export default function AccountAccess({ section = 'security' }: { section?: 'profile' | 'security' }) {
  const { clear, ready } = usePlatformSession();
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''), [nextPassword, setNextPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  const sending = useRef(false);
  useNavigationBusy(busy);
  useEffect(() => {
    let active = true, revision = 0;
    const load = (showLoading = true) => {
      const request = ++revision; if (showLoading) setLoading(true);
      void requestAccount('me').then(value => {
        if (active && request === revision) { setAccount(value); setError(''); }
      }).catch(failure => {
        if (!active || request !== revision) return;
        if (failure instanceof AccountError && failure.status === 401) setAccount(null);
        else setError(failure instanceof Error ? failure.message : 'No se pudo recuperar la cuenta.');
      }).finally(() => { if (active && request === revision) setLoading(false); });
    };
    const changed = () => { setAccount(null); load(); };
    const photoChanged = () => load(false);
    const storage = (event: globalThis.StorageEvent) => {
      if (event.key === accountChangedKey) changed();
      else if (event.key === accountPhotoChangedKey) photoChanged();
    };
    load(); globalThis.addEventListener(accountChangedEvent, changed); globalThis.addEventListener(accountPhotoChangedEvent, photoChanged); globalThis.addEventListener('storage', storage);
    return () => { active = false; globalThis.removeEventListener(accountChangedEvent, changed); globalThis.removeEventListener(accountPhotoChangedEvent, photoChanged); globalThis.removeEventListener('storage', storage); };
  }, [attempt]);

  const run = async (operation: () => Promise<void>) => {
    if (sending.current) { setError('Espera a que termine la operación anterior.'); return; }
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation();
      try { notifyAccountChange(); }
      catch { throw new Error('Operación de cuenta confirmada, pero no se pudo avisar a otras pestañas. Recárgalas para actualizar tu sesión.'); }
    }
    catch (failure) {
      if (failure instanceof AccountError && failure.status === 401 && account) setAccount(null);
      setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.');
    } finally { sending.current = false; setBusy(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const value = await requestAccount(mode, { email, password, ...(mode === 'register' ? { displayName: name } : {}) });
      if (!value) throw new Error('No se encontró la cuenta confirmada.');
      setAccount(value); setPassword('');
      setNotice(mode === 'register' ? 'Cuenta creada. Tu correo e identidad todavía no están verificados.' : 'Sesión iniciada.');
    });
  };

  return <main className="moduleView accountPage">
    <header className="moduleHeader">
      <p className="eyebrow">UNA CUENTA · TODOS TUS ROLES</p>
      <h1>{account ? section === 'profile' ? 'Mi perfil' : 'Seguridad de mi cuenta' : 'Mi cuenta PlaySport'}</h1>
      <p>Tu perfil, hoja deportiva, billetera y seguridad en un mismo lugar. El dinero y las apuestas reales no están habilitados.</p>
    </header>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
    {loading ? <p role="status">Consultando tu sesión…</p> : !account ? <section className="managerCard managerStepCard">
      <h2>{mode === 'register' ? 'Crear mi cuenta' : 'Iniciar sesión'}</h2>
      <form onSubmit={submit}>
        <fieldset className="accountFields" disabled={busy}>
          {mode === 'register' ? <label className="managerField"><span>Nombre público</span>
            <input autoComplete="nickname" required maxLength={80} value={name} onChange={event => setName(event.target.value)} />
          </label> : null}
          <label className="managerField"><span>Correo electrónico</span>
            <input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          </label>
          <label className="managerField"><span>Contraseña</span>
            <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required
              minLength={mode === 'register' ? 15 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          {mode === 'register' ? <p>Usa una frase de al menos 15 caracteres. Después deberás completar tu perfil con tu cédula, su imagen y una foto personal para revisión privada.</p> : null}
          <button className="managerButtonSolid" type="submit" aria-busy={busy}>{busy ? 'Procesando…' : mode === 'register' ? 'Crear cuenta' : 'Entrar a mi cuenta'}</button>
        </fieldset>
      </form>
      <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => {
        setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setError(''); setNotice('');
      }}>{mode === 'login' ? 'Quiero crear una cuenta' : 'Ya tengo cuenta'}</button>
      <p>Recuperación de contraseña por correo: pendiente de configurar el servicio de envío. No existe un acceso alternativo que omita tu contraseña.</p>
      {error ? <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Reintentar conexión</button> : null}
    </section> : <>
      {section === 'profile' ? <>
        <PersonIdentityForm key={`identity:${account.id}`} account={account} onSaved={setAccount} />
        <AccountPhotoEditor key={account.id} account={account} disabled={busy} onSaved={setAccount} />
      </> : <>
      <section className="managerCard managerStepCard">
        <div className="accountIdentity"><AccountAvatar account={account} size={80} /><h2>Hola, {account.displayName}</h2></div><p>{account.email}</p>
        {account.localTestAccess ? <p className="managerStatus success">Sesión persistente. Puedes cambiar entre los seis roles sin cerrar tu cuenta.</p> : null}
        <dl className="accountStates">
          <div><dt>Acceso a la cuenta</dt><dd>Sesión autenticada</dd></div>
          <div><dt>Correo electrónico</dt><dd>No verificado · servicio de envío pendiente</dd></div>
          <div><dt>Identidad documental y facial</dt><dd>{account.identity?.status === 'verified' ? 'Verificada · revisión documental manual' : account.identity?.status === 'pending' ? 'Pendiente de revisión privada' : 'Perfil personal pendiente de verificar'}</dd></div>
          <div><dt>Dinero y apuestas reales</dt><dd>Desactivados</dd></div>
          <div><dt>Segundo factor</dt><dd>Pendiente de implementar; no hay operaciones financieras habilitadas</dd></div>
        </dl>
        <p>Esta cuenta no hereda permisos de manager, organizador ni anotador por elegir un rol.</p>
        <p>{account.localTestAccess
          ? 'Esta sesión no vence por inactividad y se mantiene al cerrar el navegador. Cerrar sesión o borrar las cookies requiere volver a entrar. Cambiar la contraseña cierra las otras sesiones.'
          : 'La sesión vence tras 30 minutos sin consultar el servicio o al cumplir 24 horas. Cambiar la contraseña cierra las otras sesiones.'}</p>
        <button type="button" className="managerButtonOutline" disabled={busy} onClick={() => void run(async () => {
          await requestAccount('logout', {});
          setAccount(null); setEmail(''); setName(''); setPassword(''); setCurrentPassword(''); setNextPassword(''); setConfirmation('');
          setNotice('Sesión cerrada.');
        })}>Cerrar sesión de mi cuenta</button>
      </section>
      <p>El acceso con passkeys, huella o reconocimiento facial todavía no está habilitado.</p>
      <section className="managerCard managerStepCard">
        <h2>Cambiar contraseña</h2>
        <form onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            if (nextPassword !== confirmation) throw new Error('La nueva contraseña y su confirmación no coinciden.');
            const value = await requestAccount('password', { currentPassword, newPassword: nextPassword });
            if (!value) throw new Error('No se pudo confirmar el cambio de contraseña.');
            setAccount(value); setCurrentPassword(''); setNextPassword(''); setConfirmation('');
            setNotice('Contraseña actualizada. Las demás sesiones se cerraron.');
          });
        }}>
          <fieldset className="accountFields" disabled={busy}>
            <label className="managerField"><span>Contraseña actual</span><input type="password" autoComplete="current-password" required maxLength={128}
              value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label className="managerField"><span>Nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={15} maxLength={128}
              value={nextPassword} onChange={event => setNextPassword(event.target.value)} /></label>
            <label className="managerField"><span>Confirmar nueva contraseña</span><input type="password" autoComplete="new-password" required minLength={15} maxLength={128}
              value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
            <button type="submit" className="managerButtonSolid" aria-busy={busy}>Actualizar contraseña</button>
          </fieldset>
        </form>
      </section>
      </>}
    </>}
    <details className="managerCard managerStepCard">
      <summary>Estado de la seguridad y verificación</summary>
      <h2>La verificación no se simula</h2>
      <p>La identidad requiere revisión documental manual por un administrador autorizado. No hay reconocimiento facial automático ni prueba de presencia real; el correo continúa sin verificación externa.
        Las cuentas se guardan en SQLite local; el despliegue con PostgreSQL y los servicios externos son etapas posteriores.</p>
      <button className="managerButtonOutline" type="button" disabled={!ready || busy} onClick={clear}>Volver al inicio</button>
    </details>
  </main>;
}
