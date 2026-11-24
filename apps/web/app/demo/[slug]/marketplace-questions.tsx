'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { MarketplaceListing, MarketplaceSnapshot } from '@playsport/shared';

export function MarketplaceQuestions({ listing, snapshot, busy, before, onPage, send }: {
  listing: MarketplaceListing; snapshot: MarketplaceSnapshot; busy: boolean; before: number | null;
  onPage: (_before: number | null) => void; send: (_input: Record<string, unknown>) => Promise<boolean>; // eslint-disable-line no-unused-vars
}) {
  const [text, setText] = useState(''), [answers, setAnswers] = useState<Record<number, string>>({});
  const [reports, setReports] = useState<Record<number, string>>({}), [reasons, setReasons] = useState<Record<number, string>>({});
  const own = snapshot.viewer?.id === listing.seller.id;
  return <section className="marketQuestions" aria-label="Preguntas públicas del anuncio">
    <h2>Preguntas y respuestas públicas</h2>
    <p>Pregunta todo lo necesario antes de decidirte. Preguntar no compra el artículo, no bloquea unidades ni descuenta inventario.</p>
    <aside className="marketWarning">Tu pregunta, tu nombre visible y la respuesta del vendedor serán públicos. No publiques teléfonos, correos, direcciones ni datos de pago. Los detalles personales se coordinan en el chat privado después de comprar. Los controles y la moderación no garantizan detectar todo dato personal.</aside>
    {snapshot.questions.map(question => <article className="marketQuestion" key={question.id}>
      <strong>{question.author.displayName}</strong><small> · {new Date(question.createdAt).toLocaleString('es')}</small>
      <p className="marketDescription">{question.text}</p>
      {question.answer ? <div className="marketAnswer"><strong>Respuesta del vendedor · {listing.seller.displayName}</strong>
        <p className="marketDescription">{question.answer.text}</p><small>{new Date(question.answer.createdAt).toLocaleString('es')}</small></div> : <p>Respuesta del vendedor pendiente.</p>}
      {question.status === 'hidden' ? <p className="marketDescription">Oculta públicamente por moderación: {question.moderation?.reason}</p> : null}
      {own && !question.answer && question.status === 'visible' && listing.status === 'active' ? <form onSubmit={async event => {
        event.preventDefault();
        if (await send({ kind: 'answer', questionId: question.id, text: answers[question.id] })) setAnswers(previous => ({ ...previous, [question.id]: '' }));
      }}><fieldset disabled={busy}>
        <label>Respuesta pública a pregunta #{question.id}<textarea required maxLength={500} value={answers[question.id] ?? ''} onChange={event => setAnswers({ ...answers, [question.id]: event.target.value })} /></label>
        <button type="submit">Publicar respuesta del vendedor</button>
      </fieldset></form> : null}
      {snapshot.viewer && question.status === 'visible' ? <details className="marketReport"><summary>Reportar pregunta o respuesta #{question.id}</summary>
        <label>Motivo del reporte de pregunta #{question.id}<textarea maxLength={500} value={reports[question.id] ?? ''} onChange={event => setReports({ ...reports, [question.id]: event.target.value })} /></label>
        <button disabled={busy || !reports[question.id]?.trim()} onClick={async () => {
          if (await send({ kind: 'report-question', questionId: question.id, reason: reports[question.id] })) setReports(previous => ({ ...previous, [question.id]: '' }));
        }}>Enviar reporte de pregunta</button>
      </details> : null}
      {snapshot.canModerate && question.status === 'visible' ? <details className="marketReport"><summary>Moderar pregunta #{question.id}</summary>
        <label>Motivo para ocultar pregunta #{question.id}<textarea maxLength={500} value={reasons[question.id] ?? ''} onChange={event => setReasons({ ...reasons, [question.id]: event.target.value })} /></label>
        <button disabled={busy || !reasons[question.id]?.trim()} onClick={() => void send({ kind: 'hide-question', questionId: question.id, reason: reasons[question.id] })}>Ocultar pregunta y respuesta</button>
      </details> : null}
    </article>)}
    {!snapshot.questions.length ? <p>Todavía no hay preguntas visibles en esta página.</p> : null}
    <div className="marketActions">
      {snapshot.hasOlderQuestions && snapshot.questions[0] ? <button disabled={busy} onClick={() => onPage(snapshot.questions[0].id)}>Preguntas anteriores</button> : null}
      {before ? <button disabled={busy} onClick={() => onPage(null)}>Volver a preguntas recientes</button> : null}
    </div>
    {snapshot.viewer && !own && listing.status === 'active' ? <form onSubmit={async event => {
      event.preventDefault();
      if (await send({ kind: 'question', listingId: listing.id, text })) setText('');
    }}><fieldset disabled={busy}>
      <label>Tu pregunta pública<textarea required maxLength={500} value={text} onChange={event => setText(event.target.value)} /></label>
      <label className="marketConsent"><input type="checkbox" required /> Entiendo que mi pregunta y mi nombre serán públicos; no incluiré datos personales de contacto o pago.</label>
      <button className="managerButtonOutline" type="submit">Publicar pregunta sin comprar</button>
    </fieldset></form> : !snapshot.viewer ? <Link href="/account">Inicia sesión para preguntar; leer las respuestas es público.</Link> :
      <p>{own ? 'Como vendedor, responde las preguntas de los interesados.' : 'El anuncio está cerrado o retirado; las preguntas existentes se conservan.'}</p>}
  </section>;
}
