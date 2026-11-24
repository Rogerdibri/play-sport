'use client';
import { useRef, useState } from 'react';
import { parseMarketplacePrice, readWalletRequestRecharge, walletDemoBolivarsPerDollar, walletPaymentMethods, walletProofMaximumBytes,
  type WalletPaymentMethod, type WalletPendingRecharge } from '@playsport/shared';
import { useNavigationBusy } from '../navigation-hooks';

function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
// eslint-disable-next-line no-unused-vars -- Type-only callback parameter.
export default function RechargeForm({ accountId, disabled, onSubmit }: { accountId: string; disabled: boolean; onSubmit: (request: WalletPendingRecharge) => void }) {
  const [method, setMethod] = useState<WalletPaymentMethod>('transfer');
  const [amount, setAmount] = useState('100'), [payerName, setPayerName] = useState('');
  const [paidAt, setPaidAt] = useState(localDateTime), [reference, setReference] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({}), [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState(''), [preparing, setPreparing] = useState(false);
  const fileInput = useRef<globalThis.HTMLInputElement | null>(null);
  useNavigationBusy(preparing);
  const clearProof = () => { setProof(null); if (fileInput.current) fileInput.current.value = ''; };
  const selected = walletPaymentMethods.find(value => value.id === method);
  if (!selected) throw new Error('El método de recarga seleccionado no es válido.');
  const bolivars = method === 'transfer' || method === 'pagomovil';
  const numericAmount = /^\d+(?:[.,]\d{1,2})?$/.test(amount) ? Number(amount.replace(',', '.')) : null;
  const input = () => readWalletRequestRecharge({ kind: 'request-recharge', requestId: globalThis.crypto.randomUUID(), expectedAccountId: accountId,
    amountCents: parseMarketplacePrice(amount), method, payerName, paidAt: new Date(paidAt).toISOString(), reference, details });
  const example = async () => {
    setError(''); setPreparing(true);
    try {
      const request = input(), canvas = globalThis.document.createElement('canvas');
      canvas.width = 1000; canvas.height = 620;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('El navegador no permite crear el soporte de ejemplo.');
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#173c31'; context.font = 'bold 30px sans-serif';
      context.fillText('PLAYSPORT · SOPORTE GENERADO', 40, 65);
      context.font = '24px sans-serif';
      const lines = ['SIN VALIDEZ BANCARIA · NO REPRESENTA UN PAGO REAL', `Método: ${selected.label}`,
        `Pagador: ${request.payerName}`, `Referencia: ${request.reference}`, `Fecha: ${request.paidAt}`,
        `Recarga: ${(request.amountCents / 100).toFixed(2)} USD`,
        bolivars ? `Importe: ${(request.amountCents * walletDemoBolivarsPerDollar / 100).toFixed(2)} Bs` : selected.currency,
        ...selected.fields.map(field => `${field.label}: ${request.details[field.key]}`)];
      lines.forEach((line, index) => context.fillText(line, 40, 120 + index * 44, 920));
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo crear el comprobante de ejemplo.')), 'image/png'));
      setProof(new File([blob], 'comprobante-demo.png', { type: 'image/png' }));
      if (fileInput.current) fileInput.current.value = '';
    } catch (value) { setError(value instanceof Error ? value.message : 'No se pudo crear el comprobante.'); }
    finally { setPreparing(false); }
  };
  const submit = async () => {
    setError(''); setPreparing(true);
    try {
      const request = input();
      if (!proof) throw new Error('Adjunta un comprobante o genera uno.');
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(proof.type) || proof.size > walletProofMaximumBytes || proof.size === 0) throw new Error('Elige un archivo JPG, PNG, WebP o PDF de hasta 2 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new globalThis.FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer el comprobante.'));
        reader.onerror = () => reject(new Error('No se pudo leer el comprobante.'));
        reader.readAsDataURL(proof);
      });
      onSubmit({ kind: 'pending-recharge', input: request, proof: { name: proof.name, data } });
    } catch (value) { setError(value instanceof Error ? value.message : 'Revisa los datos de recarga.'); }
    finally { setPreparing(false); }
  };
  return <section className="marketPanel"><h2>Recargar saldo</h2>
    <p>Elige un método, registra los datos y adjunta su soporte. La solicitud queda <strong>pendiente de revisión</strong>, sin aumentar tu saldo.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={disabled || preparing}>
        <legend>Método de recarga</legend>
        <div className="walletMethods">{walletPaymentMethods.map(value => <label key={value.id} className={`walletMethod${method === value.id ? ' selected' : ''}`}>
          <input type="radio" name="recharge-method" value={value.id} checked={method === value.id}
            onChange={() => { setMethod(value.id); setDetails({}); setReference(''); clearProof(); setError(''); }} />
          <strong>{value.label}</strong><span>{value.currency}</span></label>)}</div>
        <div className="walletDestination"><h3>Datos de destino de ejemplo</h3><strong>NO REALICES PAGOS A ESTOS DATOS.</strong>
          <ul>{selected.destination.map(line => <li key={line}>{line}</li>)}</ul></div>
        <div className="walletFormGrid">
          <label>Importe de recarga · USD<input required inputMode="decimal" maxLength={10} value={amount} onChange={event => { setAmount(event.target.value); clearProof(); }} /></label>
          <label>Nombre del titular o remitente<input required maxLength={100} placeholder="Nombre y apellido" value={payerName} onChange={event => { setPayerName(event.target.value); clearProof(); }} /></label>
          {selected.fields.map(field => <label key={`${method}:${field.key}`}>{field.label}<input required type={field.format === 'email' ? 'email' : 'text'}
            inputMode={field.format === 'digits' || field.format === 'phone' ? 'numeric' : undefined} maxLength={field.format === 'digits' ? 4 : field.format === 'phone' ? 11 : 100}
            placeholder={field.placeholder} value={details[field.key] ?? ''} onChange={event => { setDetails(value => ({ ...value, [field.key]: event.target.value })); clearProof(); }} /></label>)}
          <label>Fecha y hora del pago<input required type="datetime-local" value={paidAt} onChange={event => { setPaidAt(event.target.value); clearProof(); }} /></label>
          <label>Referencia o ID de transacción<input required minLength={6} maxLength={100} placeholder="Referencia de la operación" value={reference} onChange={event => { setReference(event.target.value); clearProof(); }} /></label>
        </div>
        {bolivars ? <p className="walletConversion">Importe del pago: {numericAmount !== null && numericAmount > 0 ? `${(numericAmount * walletDemoBolivarsPerDollar).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs` : 'ingresa un importe válido'}.
          Tasa fija de referencia: {walletDemoBolivarsPerDollar} Bs = 1 USD. No es una tasa oficial ni de mercado.</p> :
          method === 'binance' ? <p>1 USDT = 1 USD. No se envían criptomonedas ni se utilizan direcciones blockchain.</p> : null}
        <label>Soporte de pago · JPG, PNG, WebP o PDF · máximo 2 MB<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { setProof(event.target.files?.[0] ?? null); setError(''); }} /></label>
        <div className="marketActions"><button type="button" onClick={() => void example()}>Crear comprobante de ejemplo con estos datos</button></div>
        {proof ? <p role="status">Soporte seleccionado: {proof.name} · {(proof.size / 1024).toFixed(1)} KB</p> : <p>No hay soporte seleccionado. Puedes crear uno de ejemplo después de completar los campos.</p>}
        <label className="marketConsent"><input type="checkbox" required /> No he enviado dinero real y entiendo que el saldo espera aprobación.</label>
        <button type="submit" className="managerButtonSolid">Enviar recarga para revisión</button>
      </fieldset>
    </form>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    <p>No adjuntes documentos financieros reales. PlaySport no está conectado a bancos, Zelle ni Binance.</p>
  </section>;
}
