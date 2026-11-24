'use client';
import { useRef, useState } from 'react';
import { marketplacePrice, walletPaymentMethods, type WalletRechargeRequest, type WalletReviewRecharge } from '@playsport/shared';

export default function RechargeRequest({ request, accountId, review, busy, onReview, onDownload }: {
  request: WalletRechargeRequest; accountId: string; review?: boolean; busy: boolean;
  // eslint-disable-next-line no-unused-vars -- Type-only callback parameters.
  onReview: (input: WalletReviewRecharge) => void; onDownload: (request: WalletRechargeRequest) => void;
}) {
  const [reason, setReason] = useState(''), [selfConsent, setSelfConsent] = useState(false);
  const pending = useRef<WalletReviewRecharge | null>(null);
  const method = walletPaymentMethods.find(value => value.id === request.method);
  if (!method) throw new Error('El método guardado de la recarga no es válido.');
  const own = request.accountId === accountId;
  const decide = (decision: 'approve' | 'reject') => {
    if (!pending.current || pending.current.decision !== decision || pending.current.reason !== reason.trim() || pending.current.demoSelfReview !== selfConsent) {
      pending.current = { kind: 'review-recharge', requestId: crypto.randomUUID(), expectedAccountId: accountId, rechargeId: request.id, decision, reason: reason.trim(), demoSelfReview: own && selfConsent };
    }
    onReview(pending.current);
  };
  return <article className="walletRechargeRequest">
    <header><h3>Recarga #{request.id} · {method.label}</h3><strong className={`walletRechargeStatus ${request.status}`}>
      {request.status === 'pending' ? 'Pendiente de revisión' : request.status === 'approved' ? 'Aprobada · saldo acreditado' : 'Rechazada · sin saldo acreditado'}</strong></header>
    <dl><div><dt>Importe</dt><dd>{marketplacePrice(request.amountCents)}</dd></div>
      <div><dt>Titular o remitente</dt><dd>{request.payerName}</dd></div>
      <div><dt>Referencia</dt><dd>{request.reference}</dd></div><div><dt>Fecha del pago</dt><dd>{new Date(request.paidAt).toLocaleString('es')}</dd></div>
      {method.fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{request.details[field.key]}</dd></div>)}
      <div><dt>Fecha de solicitud</dt><dd>{new Date(request.createdAt).toLocaleString('es')}</dd></div></dl>
    <button disabled={busy} onClick={() => onDownload(request)}>Descargar comprobante · {request.proof.name}</button>
    {request.reason ? <p><strong>Motivo de revisión:</strong> {request.reason}</p> : null}
    {request.reviewedAt ? <p>Revisada el {new Date(request.reviewedAt).toLocaleString('es')}{request.eventId ? ` · movimiento #${request.eventId}` : ''}.</p> : null}
    {request.status === 'rejected' ? <p>Puedes enviar una nueva solicitud con los datos o el soporte corregidos.</p> : null}
    {review && request.status === 'pending' ? <form onSubmit={event => { event.preventDefault(); decide('approve'); }}>
      <fieldset disabled={busy}>
        {own ? <label className="marketConsent"><input type="checkbox" required checked={selfConsent} onChange={event => setSelfConsent(event.target.checked)} />
          Soy el solicitante y autorizo una autorrevisión. La revisión bancaria debe realizarla otra persona.</label> : null}
        <label>Motivo de aprobación o rechazo<textarea required minLength={3} maxLength={240} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <p>La revisión es manual. El comprobante no acredita una verificación bancaria.</p>
        <div className="marketActions"><button type="submit" className="managerButtonSolid">Aprobar y acreditar saldo</button>
          <button type="button" disabled={reason.trim().length < 3 || own && !selfConsent} onClick={() => decide('reject')}>Rechazar sin acreditar</button></div>
      </fieldset></form> : null}
  </article>;
}
