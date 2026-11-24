'use client';

import { useState } from 'react';
import { marketplaceCategories, marketplaceSports, marketplacePhotoMaxLength, parseMarketplacePrice, profileLocationLabel,
  venezuelaStates, type MarketplaceListing, type MarketplaceSnapshot } from '@playsport/shared';
import { prepareLocalPhoto } from '../../local-photo';

type Command = (_input: Record<string, unknown>) => Promise<unknown>; // eslint-disable-line no-unused-vars
const failure = (error: unknown) => error instanceof Error ? error.message : 'No se pudo preparar la edición del anuncio.';
export function canEditMarketplaceListing(listing: MarketplaceListing): boolean {
  return listing.status !== 'removed' && (listing.type === 'sale' || listing.status === 'active' && listing.bidCount === 0);
}
export const marketplaceListingStatus = (listing: MarketplaceListing) => listing.status === 'removed' ? 'Retirado por moderación' :
  listing.status === 'withdrawn' ? 'Retirado por el vendedor' : listing.status === 'closed' ? 'Cerrado' : 'Activo';

export function MarketplaceListingEditor({ listing, busy, send, onError, onClose, onUploading }: {
  listing: MarketplaceListing; busy: boolean; send: Command; onError: (_message: string) => void; onClose: () => void; onUploading: (_busy: boolean) => void; // eslint-disable-line no-unused-vars
}) {
  const [draft, setDraft] = useState(() => ({ ...listing }));
  const [price, setPrice] = useState((listing.priceCents / 100).toFixed(2));
  const [increment, setIncrement] = useState((listing.incrementCents / 100).toFixed(2));
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true); onUploading(true);
    try { const photo = await prepareLocalPhoto(file, marketplacePhotoMaxLength); setDraft(previous => ({ ...previous, photo })); }
    catch (error) { onError(failure(error)); } finally { setUploading(false); onUploading(false); }
  };
  return <section className="marketPanel" aria-label="Editar mi anuncio">
    <h2>Editar {listing.title}</h2>
    <p>Solo cambia este anuncio. Los pedidos existentes conservan su título, precio y cantidad. La modalidad y la fecha de cierre no se pueden cambiar.</p>
    {listing.revision !== draft.revision ? <p role="alert">El anuncio cambió mientras lo editabas. Cierra y vuelve a abrir la edición para cargar el inventario y las pujas actuales.</p> : null}
    <form onSubmit={event => {
      event.preventDefault();
      try {
        const location = draft.stateId && draft.municipalityId ? { stateId: draft.stateId, municipalityId: draft.municipalityId } : null;
        void send({ kind: 'edit', listingId: listing.id, revision: draft.revision, title: draft.title, description: draft.description,
          category: draft.category, condition: draft.condition, location: draft.location.trim() || (location ? profileLocationLabel(location) : ''),
          stateId: draft.stateId, municipalityId: draft.municipalityId, sport: draft.sport, sportsOnly: true, photo: draft.photo,
          priceCents: parseMarketplacePrice(price), stock: draft.stock, incrementCents: listing.type === 'auction' ? parseMarketplacePrice(increment) : 0 });
      } catch (error) { onError(failure(error)); }
    }}><fieldset className="marketPublish" disabled={busy || uploading || !canEditMarketplaceListing(listing) || listing.revision !== draft.revision}>
      <label>Título<input required maxLength={100} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Categoría<select value={draft.category} onChange={event => {
        const category = marketplaceCategories.find(item => item.id === event.target.value);
        if (category) setDraft({ ...draft, category: category.id });
      }}>{marketplaceCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="marketFull">Descripción<textarea required maxLength={4000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <label>Deporte del artículo<select required value={draft.sport ?? ''} onChange={event => {
        const sport = marketplaceSports.find(item => item.id === event.target.value);
        setDraft({ ...draft, sport: sport?.id ?? null });
      }}><option value="">Selecciona el deporte</option>{marketplaceSports.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Condición<select value={draft.condition} onChange={event => setDraft({ ...draft, condition: event.target.value === 'new' ? 'new' : 'used' })}><option value="new">Nuevo</option><option value="used">Usado</option></select></label>
      <label>Estado del artículo<select required value={draft.stateId ?? ''} onChange={event => {
        const state = venezuelaStates.find(item => item.id === event.target.value);
        setDraft({ ...draft, stateId: state?.id ?? null, municipalityId: state?.municipalities[0]?.id ?? null });
      }}><option value="">Selecciona el estado</option>{venezuelaStates.filter(item => item.municipalities.length).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Municipio del artículo<select required value={draft.municipalityId ?? ''} onChange={event => setDraft({ ...draft, municipalityId: event.target.value || null })}>
        <option value="">Selecciona el municipio</option>{venezuelaStates.find(item => item.id === draft.stateId)?.municipalities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Ubicación<input maxLength={160} value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
      <label>Precio · USD<input required inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      {listing.type === 'sale' ? <label>Stock disponible<input required type="number" min={0} max={1000} value={draft.stock} onChange={event => setDraft({ ...draft, stock: Number(event.target.value) })} /></label> :
        <label>Incremento mínimo · USD<input required inputMode="decimal" value={increment} onChange={event => setIncrement(event.target.value)} /></label>}
      <p className="marketFull">El stock indica unidades disponibles, sin incluir pedidos pendientes. Disponible más pedidos pendientes no puede superar 1000. Cero cierra una venta; añadir stock vuelve a abrir una venta agotada, pero no un anuncio retirado.</p>
      <label>Foto JPEG local<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
      {draft.photo ? <div><img className="marketUpload" src={draft.photo} alt="Foto del anuncio a editar" /><button type="button" onClick={() => setDraft({ ...draft, photo: null })}>Quitar foto</button></div> : null}
      <label className="marketConsent marketFull"><input type="checkbox" required /> Confirmo que el artículo está relacionado con deportes y que son pruebas sin dinero real.</label>
      <button className="managerButtonSolid" type="submit">Guardar cambios del anuncio</button>
    </fieldset></form>
    <button type="button" disabled={busy || uploading} onClick={onClose}>Cerrar edición sin guardar</button>
  </section>;
}

export function MarketplaceReviews({ snapshot, busy, send, openListing }: {
  snapshot: MarketplaceSnapshot; busy: boolean; send: Command; openListing: (_listing: MarketplaceListing) => void; // eslint-disable-line no-unused-vars
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState('pending');
  const [appeals, setAppeals] = useState<Record<number, string>>({});
  return <section className="marketOrders" aria-label="Reportes y apelaciones">
    <div className="marketPanel"><h2>{snapshot.canModerate ? 'Moderación del marketplace' : 'Mis reportes y apelaciones'}</h2>
      <p>Reportar no oculta automáticamente un anuncio. Cada decisión exige un motivo y conserva el historial. Este permiso no concede privilegios deportivos ni acceso a conversaciones o pedidos de otras cuentas.</p>
      <label>Estado de revisión<select value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Pendientes</option><option value="resolved">Resueltos</option><option value="all">Todos</option></select></label>
      <p>{snapshot.reviews.filter(item => item.status === 'pending').length} revisión(es) pendiente(s).</p>
    </div>
    {snapshot.reviews.filter(item => filter === 'all' || item.status === filter).map(review => {
      const listing = [...snapshot.reviewListings, ...snapshot.myListings].find(item => item.id === review.listingId);
      return <article className="marketPanel" key={review.id}>
        <span className="marketBadge">{review.kind === 'appeal' ? 'Apelación' : review.kind === 'question' ? `Reporte de pregunta #${review.questionId}` : 'Reporte'} #{review.id} · {review.status === 'pending' ? 'Pendiente' : 'Resuelto'}</span>
        <h3>{listing?.title ?? `Anuncio #${review.listingId}`}</h3><p className="marketDescription">{review.reason}</p><p>{new Date(review.createdAt).toLocaleString('es')}</p>
        {listing ? <><p>{marketplaceListingStatus(listing)}</p><button disabled={busy} onClick={() => openListing(listing)}>Inspeccionar anuncio</button></> : null}
        {review.decisionReason ? <p className="marketDescription">Decisión: {review.decision === 'dismiss' ? 'Reporte desestimado' : review.decision === 'remove' ? review.kind === 'question' ? 'Pregunta y respuesta ocultas' : 'Retiro por incumplimiento' : review.decision === 'restore' ? 'Apelación aceptada' : 'Retiro confirmado'}. Motivo: {review.decisionReason}</p> : null}
        {snapshot.canModerate && review.status === 'pending' ? <form onSubmit={event => event.preventDefault()}>
          <label>Motivo de la decisión #{review.id}<textarea required maxLength={500} value={notes[review.id] ?? ''} onChange={event => setNotes({ ...notes, [review.id]: event.target.value })} /></label>
          <div className="marketActions">{(review.kind !== 'appeal' ? [{ decision: 'dismiss', label: 'Desestimar reporte' }, { decision: 'remove', label: review.kind === 'question' ? 'Ocultar pregunta y respuesta' : 'Retirar por incumplimiento' }] :
            [{ decision: 'uphold', label: 'Mantener retiro' }, { decision: 'restore', label: 'Aceptar apelación' }]).map(item =>
              <button key={item.decision} disabled={busy || !notes[review.id]?.trim()} onClick={() => void send({ kind: 'review-report', reviewId: review.id, decision: item.decision, reason: notes[review.id] })}>{item.label}</button>)}</div>
          <p>{review.kind === 'question' ? 'Ocultar esta pregunta también oculta su respuesta, sin retirar el anuncio ni afectar inventario, pedidos o pujas.' : 'Retirar detiene nuevas compras y pujas. Una subasta retirada no se adjudica ni se reabre al aceptar una apelación; solo recupera su visibilidad. Los pedidos ya existentes no se cancelan automáticamente.'}</p>
        </form> : null}
      </article>;
    })}
    {!snapshot.reviews.some(item => filter === 'all' || item.status === filter) ? <p>No hay revisiones en este estado.</p> : null}
    {snapshot.myListings.filter(item => item.status === 'removed').map(listing => <article className="marketPanel" key={listing.id}>
      <h3>Apelar retiro: {listing.title}</h3><p className="marketDescription">Motivo: {listing.moderation?.reason}</p>
      {snapshot.reviews.some(review => review.listingId === listing.id && review.kind === 'appeal' && review.status === 'pending') ? <p>Tu apelación ya está pendiente.</p> :
        <form onSubmit={event => { event.preventDefault(); void send({ kind: 'appeal', listingId: listing.id, reason: appeals[listing.id] }); }}>
          <label>Motivo de la apelación<textarea required maxLength={500} value={appeals[listing.id] ?? ''} onChange={event => setAppeals({ ...appeals, [listing.id]: event.target.value })} /></label>
          <button disabled={busy || !appeals[listing.id]?.trim()} type="submit">Enviar apelación</button>
        </form>}
    </article>)}
  </section>;
}
