'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { passwordPolicyHint, passwordPolicyProblem } from '@playsport/shared';
import { notifyAccountChange } from '../../account-events';
import { useNavigationBusy } from '../../navigation-hooks';

// The page remounts when the token leaves the address bar and when the new session is announced; keep both for this tab.
let capturedToken: string | null = null, completed = false;

export default function PasswordResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(completed);
  const sending = useRef(false);
  useNavigationBusy(busy);
  useEffect(() => {
    const value = new URLSearchParams(globalThis.location.hash.slice(1)).get('token');
    if (value) { capturedToken = /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''; completed = false; setDone(false); }
    setToken(capturedToken ?? '');
    if (value) globalThis.history.replaceState(null, '', globalThis.location.pathname);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending.current || !token) return;
    if (password !== confirmation) { setError('La nueva contraseña y su confirmación no coinciden.'); return; }
    const problem = passwordPolicyProblem(password);
    if (problem) { setError(problem); return; }
    sending.current = true; setBusy(true); setError('');
    void fetch('/api/accounts/password-reset-confirm', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: password }) }).then(async response => {
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result && typeof result === 'object' && 'message' in result && typeof result.message === 'string' ?
        result.message : 'No se pudo cambiar la contraseña. Vuelve a intentarlo.');
      setPassword(''); setConfirmation(''); setDone(true); capturedToken = null; completed = true;
      try { notifyAccountChange(); } catch { /* Other tabs refresh on their next account check. */ }
    }).catch(failure => setError(failure instanceof Error ? failure.message : 'No se pudo cambiar la contraseña.'))
      .finally(() => { sending.current = false; setBusy(false); });
  };
  return <main className="moduleView accountPage">
    <header className="moduleHeader">
      <p className="eyebrow">MI CUENTA PLAYSPORT</p>
      <h1>Elegir una nueva contraseña</h1>
      <p>Al guardarla se cierran todas tus sesiones anteriores y entras con la nueva.</p>
    </header>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {done ? <section className="managerCard managerStepCard">
      <p className="managerStatus success" role="status">Contraseña actualizada. Ya iniciaste sesión con tu nueva contraseña.</p>
      <Link className="managerButtonSolid" href="/account">Ir a mi cuenta</Link>
    </section> : token === null ? <p role="status">Comprobando el enlace…</p> : !token ? <section className="managerCard managerStepCard">
      <p className="managerWarning" role="alert">El enlace no es válido o está incompleto. Ábrelo de nuevo desde el correo o solicita otro.</p>
      <Link className="managerButtonOutline" href="/account">Solicitar un enlace nuevo</Link>
    </section> : <section className="managerCard managerStepCard">
      <form onSubmit={submit}>
        <fieldset className="accountFields" disabled={busy}>
          <label className="managerField"><span>Nueva contraseña</span>
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          <label className="managerField"><span>Confirmar nueva contraseña</span>
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          </label>
          <p>{passwordPolicyHint}</p>
          <button className="managerButtonSolid" type="submit" aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
        </fieldset>
      </form>
    </section>}
  </main>;
}
