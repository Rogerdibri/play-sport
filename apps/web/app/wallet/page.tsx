'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { accountChangedEvent, marketplacePrice, readWalletPendingRecharge, readWalletRequestResult, readWalletReviewRecharge,
  readWalletResult, readWalletSnapshot, type WalletPendingRecharge, type WalletRechargeRequest, type WalletReviewRecharge, type WalletSnapshot } from '@playsport/shared';
import { useNavigationBusy } from '../navigation-hooks';
import RechargeForm from './recharge-form';
import RechargeRequest from './recharge-request';
import { usePlatformSession } from '../platform-session';
import AccountAvatar from '../account-avatar';

export default function WalletPage() {
  const { account } = usePlatformSession();
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [unauthorized, setUnauthorized] = useState(false);
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [before, setBefore] = useState<number | null>(null);
  const [beforeRecharge, setBeforeRecharge] = useState<number | null>(null), [beforeReview, setBeforeReview] = useState<number | null>(null);
  const revision = useRef(0), sending = useRef(false);
  const mounted = useRef(false);
  const accountEpoch = useRef(0), knownAccount = useRef<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const pending = useRef<{ accountId: string; command: WalletPendingRecharge } | null>(null);
  const pendingKey = (id: string) => `playsport:wallet-pending:v1:${id}`;
  useNavigationBusy(busy);
  useEffect(() => {
    mounted.current = true;
    let active = true, signedOut = false;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision.current;
      try {
        const query = new URLSearchParams();
        if (before) query.set('before', String(before));
        if (beforeRecharge) query.set('beforeRecharge', String(beforeRecharge));
        if (beforeReview) query.set('beforeReview', String(beforeReview));
        const response = await fetch(`/api/wallet${query.size ? `?${query}` : ''}`, { cache: 'no-store', signal: controller.signal });
        const body: unknown = await response.json();
        if (!active || request !== revision.current) return;
        if (response.status === 401) { signedOut = true; accountEpoch.current++; knownAccount.current = null; pending.current = null; setPendingAmount(null); setNotice(''); setSnapshot(null); setUnauthorized(true); setError(''); return; }
        if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'No se pudo consultar la billetera.');
        const next = readWalletSnapshot(body);
        if (knownAccount.current !== next.accountId) {
          accountEpoch.current++; pending.current = null; setPendingAmount(null); setNotice('');
          const saved = globalThis.sessionStorage.getItem(pendingKey(next.accountId));
          if (saved) {
            const request = readWalletPendingRecharge(JSON.parse(saved));
            if (request.kind === 'pending-recharge' && request.input.expectedAccountId !== next.accountId) throw new Error('La solicitud guardada no corresponde a esta cuenta.');
            pending.current = { accountId: next.accountId, command: request };
            setPendingAmount(request.kind === 'recharge' ? request.amountCents : request.input.amountCents);
          }
          knownAccount.current = next.accountId;
        }
        signedOut = false; setSnapshot(next); setUnauthorized(false); setError('');
      } catch (value) {
        if (active && request === revision.current) { setSnapshot(null); setError(value instanceof Error ? value.message : 'No se pudo consultar la billetera.'); }
      }
    };
    const changed = () => {
      revision.current++; accountEpoch.current++; knownAccount.current = null; pending.current = null; setPendingAmount(null); setSnapshot(null); setNotice(''); setError(''); setBefore(null); setBeforeRecharge(null); setBeforeReview(null); setRetry(value => value + 1);
    };
    const visible = () => { if (!globalThis.document.hidden) void load(); };
    void load();
    const interval = setInterval(() => { if (!signedOut) visible(); }, 5000);
    globalThis.addEventListener(accountChangedEvent, changed); globalThis.document.addEventListener('visibilitychange', visible);
    return () => { active = false; mounted.current = false; revision.current++; accountEpoch.current++; controller.abort(); clearInterval(interval);
      globalThis.removeEventListener(accountChangedEvent, changed); globalThis.document.removeEventListener('visibilitychange', visible); };
  }, [before, beforeRecharge, beforeReview, retry]);
  const recharge = async (command?: WalletPendingRecharge) => {
    if (!mounted.current || sending.current || !snapshot || snapshot.accountId !== knownAccount.current) { setError('Espera a que termine la operación y se confirme tu cuenta.'); return; }
    const accountId = snapshot.accountId;
    if (pending.current && command) { setError('Confirma primero la solicitud pendiente antes de crear otra.'); return; }
    if (!pending.current) {
      if (!command || command.kind !== 'pending-recharge' || command.input.expectedAccountId !== accountId) { setError('La solicitud no corresponde a tu cuenta actual.'); return; }
      let request: WalletPendingRecharge;
      try { request = readWalletPendingRecharge(command); }
      catch (value) { setError(value instanceof Error ? value.message : 'No se pudo preparar la solicitud y su soporte.'); return; }
      try { globalThis.sessionStorage.setItem(pendingKey(accountId), JSON.stringify(request)); }
      catch { setError('No se pudo guardar la solicitud y el soporte pendiente en esta pestaña. No se envió la recarga.'); return; }
      pending.current = { accountId, command: request }; setPendingAmount(command.input.amountCents);
    }
    const request = pending.current.command, accountRevision = accountEpoch.current;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      let response: Response;
      if (request.kind === 'recharge') response = await fetch('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      else {
        const comma = request.proof.data.indexOf(','), bytes = Uint8Array.from(atob(request.proof.data.slice(comma + 1)), value => value.charCodeAt(0));
        const form = new FormData();
        form.append('input', JSON.stringify(request.input));
        form.append('proof', new Blob([bytes], { type: request.proof.data.slice(5, request.proof.data.indexOf(';')) }), request.proof.name);
        response = await fetch('/api/wallet/recharges', { method: 'POST', body: form });
      }
      const body: unknown = await response.json();
      if (accountRevision !== accountEpoch.current) return;
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          globalThis.sessionStorage.removeItem(pendingKey(accountId)); pending.current = null; setPendingAmount(null);
        }
        if (response.status === 401) { setSnapshot(null); setUnauthorized(true); }
        throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'No se confirmó la recarga. Reintenta con la misma solicitud.');
      }
      const result = request.kind === 'recharge' ? readWalletResult(body) : readWalletRequestResult(body);
      try { globalThis.sessionStorage.removeItem(pendingKey(accountId)); }
      catch { throw new Error('La recarga fue confirmada, pero no se pudo limpiar su solicitud pendiente. Reintentar la misma solicitud no duplica el saldo.'); }
      setNotice(result.notice); pending.current = null; setPendingAmount(null); setBefore(null); setBeforeRecharge(null); setRetry(value => value + 1);
    } catch (value) { if (accountRevision === accountEpoch.current) setError(value instanceof Error ? value.message : 'No se confirmó la recarga. Reintenta con la misma solicitud.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const review = async (input: WalletReviewRecharge) => {
    if (!mounted.current || sending.current || !snapshot || snapshot.accountId !== knownAccount.current) { setError('Espera a que termine la operación y se confirme tu cuenta.'); return; }
    const epoch = accountEpoch.current;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const command = readWalletReviewRecharge(input);
      const response = await fetch('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const body: unknown = await response.json();
      if (epoch !== accountEpoch.current) return;
      if (!response.ok) throw new Error(body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : 'No se pudo confirmar la revisión. Consulta el estado antes de reintentar.');
      setNotice(readWalletRequestResult(body).notice); setBefore(null); setBeforeReview(null); setRetry(value => value + 1);
    } catch (value) { if (epoch === accountEpoch.current) setError(value instanceof Error ? value.message : 'No se pudo confirmar la revisión.'); }
    finally { sending.current = false; setBusy(false); }
  };
  const download = async (request: WalletRechargeRequest) => {
    const epoch = accountEpoch.current;
    try {
      const response = await fetch(`/api/wallet/recharges/${request.id}/proof`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo descargar el comprobante privado. Comprueba tu sesión y reintenta.');
      const blob = await response.blob();
      if (epoch !== accountEpoch.current) return;
      const url = URL.createObjectURL(blob), link = globalThis.document.createElement('a');
      link.href = url; link.download = request.proof.name; link.click(); URL.revokeObjectURL(url);
    } catch (value) { if (epoch === accountEpoch.current) setError(value instanceof Error ? value.message : 'No se pudo descargar el comprobante.'); }
  };
  return <main className="moduleView walletPage">
    <header className="moduleHeader"><p className="eyebrow">BILLETERA ÚNICA · USD</p><h1>Mi billetera</h1>
      <p>Un saldo común para tu cuenta, independiente del rol deportivo. No hay fondos separados por servicio.</p>
      <p>Sin dinero real, tarjetas ni retiros bancarios. El marketplace ya utiliza esta billetera; apuestas e inscripciones de torneos todavía no están conectadas.</p></header>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
    {snapshot && pendingAmount !== null && !busy ? <div className="managerWarning" role="alert"><p>Hay una solicitud pendiente de confirmar por {marketplacePrice(pendingAmount)}. Puede haberse registrado aunque la respuesta no llegara. Esto no significa que el pago esté aprobado.</p>
      <button onClick={() => void recharge()}>Reintentar recarga pendiente con la misma solicitud</button></div> : null}
    {unauthorized ? <section className="marketPanel"><h2>Inicia sesión para ver tu billetera</h2><p>Elegir un perfil deportivo no autentica el saldo de una cuenta.</p><Link href="/account">Iniciar sesión o crear cuenta</Link></section> :
      !snapshot ? <p role="status">{error ? 'No se pudo confirmar tu saldo.' : 'Consultando tu billetera…'}</p> : <>
        <section className="marketPanel"><h2>Tu saldo común</h2><div className="walletBalances">
          <div><span>Disponible</span><strong>{marketplacePrice(snapshot.balance.availableCents)}</strong></div>
          <div><span>Retenido</span><strong>{marketplacePrice(snapshot.balance.heldCents)}</strong></div>
          <div><span>Total</span><strong>{marketplacePrice(snapshot.balance.totalCents)}</strong></div></div>
          {account?.id === snapshot.accountId ? <div className="accountIdentity walletOwner"><AccountAvatar account={account} size={64} /><span><strong>{account.displayName}</strong><p>Titular de esta billetera · misma cuenta en todos tus roles</p></span></div> : null}
          <p>Las compras y la puja líder retienen saldo disponible. Al confirmar recepción se paga al vendedor; cancelar antes del envío devuelve la retención. Una disputa antes de la recepción mantiene los fondos retenidos hasta resolverse.</p>
          <Link href="/demo/marketplace">Ir al marketplace</Link></section>
        <RechargeForm key={snapshot.accountId} accountId={snapshot.accountId} disabled={busy || pendingAmount !== null} onSubmit={request => void recharge(request)} />
        <section className="marketPanel"><h2>Mis solicitudes de recarga</h2><p>Solo las aprobadas generan un movimiento de saldo. El comprobante permanece privado para tu cuenta y moderación local.</p>
          {!snapshot.recharges.length ? <p>Aún no has enviado solicitudes.</p> : snapshot.recharges.map(request => <RechargeRequest key={request.id} request={request} accountId={snapshot.accountId} busy={busy} onReview={input => void review(input)} onDownload={request => void download(request)} />)}
          <div className="marketActions">{beforeRecharge ? <button disabled={busy} onClick={() => setBeforeRecharge(null)}>Solicitudes más recientes</button> : null}
            {snapshot.rechargesHasMore ? <button disabled={busy} onClick={() => setBeforeRecharge(snapshot.recharges[snapshot.recharges.length - 1].id)}>Solicitudes anteriores</button> : null}</div></section>
        {snapshot.canReviewRecharges ? <section className="marketPanel"><h2>Revisión de recargas · moderación local</h2>
          <p>Revisa los datos y descarga el comprobante antes de decidir. Aprobar acredita saldo una sola vez; rechazar no acredita fondos. La comprobación bancaria por API no está conectada.</p>
          {!snapshot.rechargeReviews.length ? <p>No hay recargas pendientes de revisión.</p> : snapshot.rechargeReviews.map(request => <RechargeRequest key={request.id} request={request} accountId={snapshot.accountId} review busy={busy} onReview={input => void review(input)} onDownload={request => void download(request)} />)}
          <div className="marketActions">{beforeReview ? <button disabled={busy} onClick={() => setBeforeReview(null)}>Revisión más reciente</button> : null}
            {snapshot.rechargeReviewsHasMore ? <button disabled={busy} onClick={() => setBeforeReview(snapshot.rechargeReviews[snapshot.rechargeReviews.length - 1].id)}>Más recargas por revisar</button> : null}</div></section> : null}
        <section className="marketPanel"><h2>Movimientos de tu billetera</h2>
          {!snapshot.movements.length ? <p>Aún no tienes movimientos.</p> : <ul className="walletMovements">{snapshot.movements.map(movement => <li key={movement.id}>
            <strong>{movement.description}</strong><span>{new Date(movement.createdAt).toLocaleString('es')} · {movement.reference}</span>
            <span>Importe: {marketplacePrice(movement.amountCents)} · Disponible: {movement.availableDelta >= 0 ? '+' : '−'}{marketplacePrice(Math.abs(movement.availableDelta))} · Retenido: {movement.heldDelta >= 0 ? '+' : '−'}{marketplacePrice(Math.abs(movement.heldDelta))}</span>
          </li>)}</ul>}
          <div className="marketActions">{before ? <button disabled={busy} onClick={() => setBefore(null)}>Movimientos más recientes</button> : null}
            {snapshot.hasMore ? <button disabled={busy} onClick={() => setBefore(snapshot.movements[snapshot.movements.length - 1].id)}>Movimientos anteriores</button> : null}</div>
        </section>
      </>}
    {error ? <button disabled={busy} onClick={() => { setSnapshot(null); setRetry(value => value + 1); }}>Reintentar consulta</button> : null}
  </main>;
}
