'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { accountChangedEvent, marketplaceCategories, marketplaceSports, marketplaceSportFilters, marketplaceListingMatchesFilters, marketplacePhotoMaxLength, marketplacePrice, minimumMarketplaceBid,
  isProfileLocation, profileLocationLabel, venezuelaStates,
  parseMarketplacePrice, readMarketplaceSnapshot, type MarketplaceListing, type MarketplaceMessage,
  type MarketplaceOrderStatus, type MarketplaceSnapshot, type MarketplaceFilters, type MarketplaceCategory, type MarketplaceSportFilter } from '@playsport/shared';
import { prepareLocalPhoto } from '../../local-photo';
import { useNavigationBusy, useNavigationDraft } from '../../navigation-hooks';
import { useMarketplaceProfileLocation } from './marketplace-location';
import { canEditMarketplaceListing, marketplaceListingStatus, MarketplaceListingEditor, MarketplaceReviews } from './marketplace-administration';
import { MarketplaceQuestions } from './marketplace-questions';

type Tab = 'catalog' | 'favorites' | 'publish' | 'orders' | 'selling' | 'bids' | 'messages' | 'reviews';
export function marketplaceRequestId(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Tu navegador no puede generar una solicitud segura. Usa un navegador actualizado.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const tabs: Array<{ id: Tab; title: string }> = [
  { id: 'catalog', title: 'Explorar' }, { id: 'favorites', title: 'Mis favoritos' }, { id: 'publish', title: 'Publicar' }, { id: 'orders', title: 'Mis compras' },
  { id: 'selling', title: 'Mis ventas' }, { id: 'bids', title: 'Mis pujas' }, { id: 'messages', title: 'Mensajes' }, { id: 'reviews', title: 'Reportes' }
];
const statuses: Record<MarketplaceOrderStatus, string> = {
  confirmed: 'Compra confirmada', reserved: 'Pedido anterior pendiente', sent: 'Enviado', delivered: 'Compra completada',
  cancelled: 'Cancelado', disputed: 'Reclamación · revisión pendiente'
};
const draftFields = ['type', 'title', 'description', 'category', 'condition', 'location', 'price', 'stock', 'increment', 'ends'] as const;
type PublicationDraft = Record<typeof draftFields[number], string> & { photo: string | null; stateId?: string; municipalityId?: string; sport?: string };
const emptyDraft: PublicationDraft = { type: 'sale', title: '', description: '', category: 'equipment', condition: 'used',
  location: '', price: '', stock: '1', increment: '1.00', ends: '', photo: null, stateId: '', municipalityId: '', sport: '' };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function isDraft(value: unknown): value is PublicationDraft {
  return record(value) && draftFields.every(key => typeof value[key] === 'string' && value[key].length <= 4000) &&
    ['stateId', 'municipalityId', 'sport'].every(key => value[key] === undefined || typeof value[key] === 'string' && value[key].length <= 100) &&
    (value.photo === null || typeof value.photo === 'string' && value.photo.length <= marketplacePhotoMaxLength);
}
const failure = (value: unknown) => value instanceof Error ? value.message : 'No se pudo completar la operación del Marketplace.';
const timeLabel = (date: string) => new Date(date).toLocaleString('es');
const listingLocation = (item: MarketplaceListing) => item.stateId && item.municipalityId ?
  profileLocationLabel({ stateId: item.stateId, municipalityId: item.municipalityId }) : `${item.location} · Estado sin especificar`;
const listingSport = (item: MarketplaceListing) => marketplaceSports.find(sport => sport.id === item.sport)?.label ?? 'Deporte sin especificar';

export default function Marketplace({ initialSnapshot = null }: { initialSnapshot?: MarketplaceSnapshot | null }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot), [tab, setTab] = useState<Tab>('catalog');
  const [selectedId, setSelectedId] = useState<number | null>(null), [threadId, setThreadId] = useState<number | null>(null);
  const [before, setBefore] = useState<number | null>(null), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false), [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState(''), [category, setCategory] = useState<MarketplaceCategory | 'all'>('all'), [mode, setMode] = useState<'sale' | 'auction' | 'all'>('all');
  const [sport, setSport] = useState<MarketplaceSportFilter | 'all'>('all'), [condition, setCondition] = useState<'new' | 'used' | 'all'>('all');
  const [bid, setBid] = useState(''), [quantity, setQuantity] = useState('1'), [message, setMessage] = useState('');
  const [report, setReport] = useState(''), [dispute, setDispute] = useState<Record<number, string>>({});
  const [older, setOlder] = useState<MarketplaceMessage[]>([]);
  const profile = useMarketplaceProfileLocation();
  const [region, setRegion] = useState('profile');
  const [reportType, setReportType] = useState('Contenido ajeno al deporte');
  const [editingId, setEditingId] = useState<number | null>(null), [removalReason, setRemovalReason] = useState('');
  const [beforeQuestion, setBeforeQuestion] = useState<number | null>(null);
  const stateId = region === 'profile' ? profile.location?.stateId ?? null : region === 'national' ? null : region;
  const stateName = venezuelaStates.find(state => state.id === stateId)?.name;
  const filters: MarketplaceFilters = { state: stateId ?? undefined, category: category === 'all' ? undefined : category,
    type: mode === 'all' ? undefined : mode, sport: sport === 'all' ? undefined : sport,
    condition: condition === 'all' ? undefined : condition, search: search.trim() || undefined };
  const lastState = useRef<string | null | undefined>(undefined);
  const offset = useRef(initialSnapshot ? Date.parse(initialSnapshot.serverNow) - Date.now() : 0);
  const sending = useRef(false), pending = useRef<{ signature: string; requestId: string } | null>(null);
  const [draft, setDraft, draftReady] = useNavigationDraft<PublicationDraft>(
    snapshot?.viewer ? `marketplace:${snapshot.viewer.id}:publication` : null, emptyDraft, isDraft, snapshot?.viewer?.id);
  useNavigationBusy(busy || photoBusy);
  const viewer = snapshot?.viewer ?? null;
  const editing = snapshot?.myListings.find(item => item.id === editingId);
  const selected = [...(snapshot?.listings ?? []), ...(snapshot?.myListings ?? []), ...(snapshot?.reviewListings ?? [])].find(item => item.id === selectedId);
  const own = Boolean(selected && viewer?.id === selected.seller.id);
  const ended = Boolean(selected?.endsAt && Date.parse(selected.endsAt) <= now + offset.current);
  useEffect(() => {
    if (profile.ready && lastState.current !== stateId) {
      lastState.current = stateId; setBefore(null); setSelectedId(null); setSnapshot(null);
    }
  }, [stateId, profile.ready]);
  useEffect(() => {
    if (viewer && draftReady && profile.ready && profile.location && !draft.stateId) {
      setDraft({ ...draft, stateId: profile.location.stateId, municipalityId: profile.location.municipalityId });
    }
  }, [viewer?.id, draftReady, profile.ready, profile.location?.stateId, profile.location?.municipalityId, draft.stateId]);
  useEffect(() => {
    if (!profile.ready) return;
    let active = true, revision = 0;
    const controller = new AbortController();
    const load = async () => {
      const request = ++revision;
      const query = new URLSearchParams();
      if (selectedId) query.set('listing', String(selectedId));
      else if (before) query.set('before', String(before));
      if (threadId) query.set('thread', String(threadId));
      if (selectedId && beforeQuestion) query.set('beforeQuestion', String(beforeQuestion));
      if (stateId && !selectedId) query.set('state', stateId);
      if (!selectedId) {
        if (category !== 'all') query.set('category', category);
        if (mode !== 'all') query.set('type', mode);
        if (sport !== 'all') query.set('sport', sport);
        if (condition !== 'all') query.set('condition', condition);
        if (search.trim()) query.set('search', search.trim());
      }
      try {
        const response = await fetch(`/api/marketplace${query.size ? `?${query}` : ''}`, { cache: 'no-store', signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : 'No se pudo consultar el Marketplace.');
        const next = readMarketplaceSnapshot(body);
        if (active && request === revision) {
          offset.current = Date.parse(next.serverNow) - Date.now(); setNow(Date.now()); setSnapshot(next); setError('');
        }
      } catch (value) { if (active && request === revision) { setSnapshot(null); setError(failure(value)); } }
    };
    const visible = () => { if (!globalThis.document.hidden) void load(); };
    const changed = () => { revision++; setSnapshot(null); setSelectedId(null); setThreadId(null); setEditingId(null); setBeforeQuestion(null); setRemovalReason(''); setOlder([]); setRetry(value => value + 1); };
    void load();
    const interval = setInterval(visible, 5000);
    globalThis.addEventListener(accountChangedEvent, changed); globalThis.document.addEventListener('visibilitychange', visible);
    return () => { active = false; controller.abort(); clearInterval(interval);
      globalThis.removeEventListener(accountChangedEvent, changed); globalThis.document.removeEventListener('visibilitychange', visible); };
  }, [selectedId, threadId, before, beforeQuestion, retry, stateId, category, mode, sport, condition, search, profile.ready]);
  useEffect(() => {
    const interval = setInterval(() => { if (!globalThis.document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (selected) { setBid((minimumMarketplaceBid(selected) / 100).toFixed(2)); setQuantity('1'); setReport(''); }
  }, [selected?.id]);
  const send = async (input: Record<string, unknown>) => {
    if (sending.current) return false;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const signature = JSON.stringify(input);
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, requestId: marketplaceRequestId() };
      const response = await fetch('/api/marketplace', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: pending.current.requestId }), signal: AbortSignal.timeout(15000) });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(record(body) && typeof body.message === 'string' ? body.message : 'No se pudo completar la operación.');
      if (!record(body) || typeof body.notice !== 'string' || typeof body.entityId !== 'number' || !Number.isSafeInteger(body.entityId)) throw new Error('La respuesta de la operación no es válida. Actualiza antes de repetirla.');
      pending.current = null; setNotice(body.notice);
      if (input.kind === 'publish') { setDraft(emptyDraft); setSelectedId(null); setBefore(null); setTab('selling'); }
      if (input.kind === 'buy') { setSelectedId(null); setTab('orders'); }
      if (input.kind === 'start-thread') { setSelectedId(null); setOlder([]); setThreadId(body.entityId); setTab('messages'); }
      if (input.kind === 'message') setMessage('');
      if (input.kind === 'report') setReport('');
      if (input.kind === 'edit') setEditingId(null);
      if (input.kind === 'remove') { setRemovalReason(''); setSelectedId(null); setTab('reviews'); }
      if (input.kind === 'question') setBeforeQuestion(null);
      setRetry(value => value + 1);
      return true;
    } catch (value) { setError(failure(value)); return false; }
    finally { sending.current = false; setBusy(false); }
  };
  const openListing = (listing: MarketplaceListing) => {
    setTab('catalog'); setThreadId(null); setBeforeQuestion(null); setSelectedId(listing.id);
    setError('');
  };
  const upload = async (file: File) => {
    setPhotoBusy(true);
    try { setDraft({ ...draft, photo: await prepareLocalPhoto(file, marketplacePhotoMaxLength) }); setError(''); }
    catch (value) { setError(failure(value)); } finally { setPhotoBusy(false); }
  };
  const olderMessages = async () => {
    if (!threadId || busy || !snapshot?.messages.length) return;
    setBusy(true);
    try {
      const first = [...older, ...snapshot.messages].reduce((id, entry) => Math.min(id, entry.id), Number.MAX_SAFE_INTEGER);
      const response = await fetch(`/api/marketplace?thread=${threadId}&beforeMessage=${first}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudieron consultar los mensajes anteriores.');
      const page = readMarketplaceSnapshot(await response.json());
      setOlder(previous => [...new Map([...page.messages, ...previous].map(entry => [entry.id, entry])).values()].sort((a, b) => a.id - b.id));
      setSnapshot(previous => previous ? { ...previous, hasOlderMessages: page.hasOlderMessages } : previous);
    } catch (value) { setError(failure(value)); } finally { setBusy(false); }
  };
  const publish = () => {
    try {
      const auction = draft.type === 'auction', ends = new Date(draft.ends);
      const location = { stateId: draft.stateId, municipalityId: draft.municipalityId };
      if (!isProfileLocation(location)) throw new Error('Selecciona el estado y municipio donde se encuentra el artículo.');
      if (!marketplaceSports.some(sport => sport.id === draft.sport)) throw new Error('Selecciona el deporte al que pertenece el artículo.');
      if (auction && !Number.isFinite(ends.getTime())) throw new Error('Elige la fecha y hora de cierre de la subasta.');
      void send({ kind: 'publish', type: draft.type, title: draft.title, description: draft.description,
        category: draft.category, condition: draft.condition, location: draft.location.trim() || profileLocationLabel(location), photo: draft.photo,
        stateId: location.stateId, municipalityId: location.municipalityId, sport: draft.sport, sportsOnly: true,
        priceCents: parseMarketplacePrice(draft.price), stock: auction ? 1 : Number(draft.stock),
        incrementCents: auction ? parseMarketplacePrice(draft.increment) : 0, endsAt: auction ? ends.toISOString() : null });
    } catch (value) { setError(failure(value)); }
  };
  const listingImage = (item: MarketplaceListing) => item.photo ?
    <img className="marketImage" src={item.photo} alt={`Foto de ${item.title}`} /> :
    <div className="marketImage marketPlaceholder" aria-hidden="true"><span>{item.category === 'clothing' ? 'ROPA' : item.category === 'collectibles' ? 'COLECCIÓN' : 'DEPORTE'}</span></div>;
  const favoriteButton = (item: MarketplaceListing) => {
    if (!viewer) return null;
    const saved = Boolean(snapshot?.favorites.some(favorite => favorite.listingId === item.id));
    return <button type="button" className="marketFavorite" aria-pressed={saved}
      aria-label={`${saved ? 'Quitar de favoritos' : 'Guardar en favoritos'}: ${item.title}`}
      disabled={busy || photoBusy || !saved && ['withdrawn', 'removed'].includes(item.status)}
      onClick={() => void send({ kind: 'favorite', listingId: item.id, saved: !saved })}>{saved ? 'Quitar de favoritos' : 'Guardar en favoritos'}</button>;
  };
  const listingCard = (item: MarketplaceListing) => <article className="marketCard" key={item.id}>
    {listingImage(item)}<div className="marketCardBody"><span className={`marketBadge ${item.type === 'auction' ? 'auction' : ''}`}>{item.type === 'auction' ? 'Subasta' : 'Venta directa'}</span>
      <h2>{item.title}</h2><strong className="marketPrice">{marketplacePrice(item.currentBidCents ?? item.priceCents)}</strong>
      <p>{listingSport(item)} · {item.condition === 'new' ? 'Nuevo' : 'Usado'}</p><p>{listingLocation(item)}</p><p>{item.seller.displayName}</p>
      {item.endsAt ? <p>{item.status === 'active' && Date.parse(item.endsAt) > now + offset.current ? `Cierra: ${timeLabel(item.endsAt)}` : 'Subasta cerrada'} · {item.bidCount} pujas</p> : <p>{item.stock} unidades disponibles</p>}
      <button className="managerButtonOutline" disabled={busy || photoBusy} onClick={() => openListing(item)}>Ver {item.type === 'auction' ? 'subasta' : 'artículo'}</button>
      {favoriteButton(item)}
      {item.status === 'closed' ? <p>Anuncio cerrado · ya no admite compras ni pujas.</p> : null}
      {tab === 'selling' && viewer?.id === item.seller.id ? <>
        <p>{marketplaceListingStatus(item)}</p>
        {canEditMarketplaceListing(item) ? <button disabled={busy || photoBusy} onClick={() => setEditingId(item.id)}>Editar anuncio #{item.id}</button> :
          <p>No admite edición: está retirado por moderación o es una subasta cerrada/con pujas.</p>}
        {item.status === 'removed' ? <button disabled={busy || photoBusy} onClick={() => { setEditingId(null); setTab('reviews'); }}>Ver motivo y apelar</button> : null}
        <details><summary>Historial de administración</summary><ul>{snapshot?.audits.filter(event => event.listingId === item.id).map(event => <li key={event.id}>{timeLabel(event.at)} · {event.action === 'edit' ? 'Edición' : event.action === 'remove' ? 'Retiro por moderación' : event.action === 'restore' ? 'Restauración de visibilidad' : 'Retiro voluntario'} · {event.reason}</li>)}</ul></details>
      </> : null}</div>
  </article>;
  const visibleListings = (snapshot?.listings ?? []).filter(item => marketplaceListingMatchesFilters(item, filters));
  const visibleFavorites = (snapshot?.favorites ?? []).filter(favorite => !favorite.listing || marketplaceListingMatchesFilters(favorite.listing, filters));
  const currentThread = snapshot?.conversations.find(item => item.id === threadId);
  const messages = [...new Map([...older, ...(snapshot?.messages ?? [])].filter(item => item.threadId === threadId).map(item => [item.id, item])).values()].sort((a, b) => a.id - b.id);
  return <section className="marketplace" aria-label="Marketplace deportivo">
    <header className="marketHero"><div><p className="eyebrow">PLAYSPORT · COMUNIDAD DEPORTIVA</p><h1>Marketplace</h1><p>Compra, vende y subasta exclusivamente artículos deportivos.</p></div></header>
    <div className="marketAccount">{viewer ? <span>Cuenta: <strong>{viewer.displayName}</strong></span> : <span>Explora libremente. Para publicar, comprar, pujar o escribir necesitas tu cuenta.</span>}<Link href="/account">{viewer ? 'Mi cuenta' : 'Iniciar sesión'}</Link></div>
    {viewer && snapshot?.walletBalance ? <div className="marketPanel"><div className="walletBalances">
      <div><span>Saldo disponible</span><strong>{marketplacePrice(snapshot.walletBalance.availableCents)}</strong></div>
      <div><span>Saldo retenido</span><strong>{marketplacePrice(snapshot.walletBalance.heldCents)}</strong></div></div><Link href="/wallet">Mi billetera · recargar saldo</Link></div> : null}
    {profile.error ? <div className="managerWarning" role="alert"><p>No se pudo leer la ubicación de tu perfil: {profile.error} Puedes elegir un estado o consultar todo Venezuela sin modificar tu perfil.</p><button onClick={profile.retry}>Reintentar ubicación</button></div> : null}
    <nav className="marketTabs" aria-label="Secciones del Marketplace">{tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined}
      onClick={() => { setTab(item.id); setSelectedId(null); setThreadId(null); setEditingId(null); setOlder([]); setError(''); }} disabled={busy || photoBusy}>{item.title}</button>)}</nav>
    {error ? <p className="managerWarning" role="alert">{error}</p> : null}
    {notice ? <p className="managerStatus success" role="status">{notice}</p> : null}
    {snapshot?.sessionExpired ? <p role="alert">La sesión de tu cuenta venció. Inicia sesión de nuevo para operar; el catálogo sigue siendo público.</p> : null}
    {!snapshot && !error ? <p role="status">Consultando Marketplace…</p> : null}
    {tab !== 'catalog' && snapshot && !viewer ? <div className="marketPanel"><h2>Usa tu cuenta PlaySport</h2><p>Elegir un rol deportivo no autentica compras ni publicaciones.</p><Link href="/account">Iniciar sesión o crear cuenta</Link></div> : null}
    {snapshot && (tab === 'catalog' && !selectedId || tab === 'favorites' && viewer) ? <>
      {tab === 'favorites' ? <div className="marketPanel"><h2>Mis favoritos</h2><p>Guardados en tu cuenta, independientemente del rol deportivo. Guardar no compra ni bloquea inventario. Los filtros también se aplican aquí; las referencias no disponibles se conservan sin mostrar su contenido.</p></div> : null}
      <div className="marketScope"><label>Ubicación del marketplace<select value={region === 'profile' && !profile.location ? 'national' : region} onChange={event => {
        setRegion(event.target.value); setBefore(null); setSnapshot(null); setError('');
      }}>
        {profile.location ? <option value="profile">Mi estado · {venezuelaStates.find(state => state.id === profile.location?.stateId)?.name}</option> : null}
        <option value="national">Todo Venezuela · alcance nacional</option>{venezuelaStates.map(state => <option key={state.id} value={state.id}>{state.name}</option>)}
      </select></label><p>{stateId ? `Mostrando artículos en ${stateName}.` : 'Mostrando artículos de todo Venezuela.'} {profile.location ? 'Cambiar este filtro no modifica tu perfil.' : 'Sin ubicación guardada, el alcance es nacional; puedes elegir un estado.'}</p>
        <p className="marketFull">Solo artículos deportivos. Los anuncios anteriores sin estado aparecen únicamente en el alcance nacional. Los anuncios sin deporte registrado se muestran en «Todos los deportes».</p></div>
      <div className="marketFilters"><label>Buscar<input maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setBefore(null); }} placeholder="Artículo o ubicación" /></label>
        <label>Categoría<select value={category} onChange={e => { setCategory(marketplaceCategories.find(item => item.id === e.target.value)?.id ?? 'all'); setBefore(null); }}><option value="all">Todas</option>{marketplaceCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Modalidad<select value={mode} onChange={e => { setMode(e.target.value === 'sale' ? 'sale' : e.target.value === 'auction' ? 'auction' : 'all'); setBefore(null); }}><option value="all">Ventas y subastas</option><option value="sale">Venta directa</option><option value="auction">Subastas</option></select></label>
        <label>Deporte<select value={sport} onChange={e => { setSport(marketplaceSportFilters.find(item => item.id === e.target.value)?.id ?? 'all'); setBefore(null); }}><option value="all">Todos los deportes</option>{marketplaceSportFilters.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Condición del artículo<select value={condition} onChange={e => { setCondition(e.target.value === 'new' ? 'new' : e.target.value === 'used' ? 'used' : 'all'); setBefore(null); }}><option value="all">Nuevo y usado</option><option value="new">Nuevo</option><option value="used">Usado</option></select></label>
        <button type="button" disabled={busy || photoBusy} onClick={() => { setSearch(''); setCategory('all'); setMode('all'); setSport('all'); setCondition('all'); setRegion('national'); setBefore(null); setSnapshot(null); }}>Limpiar filtros</button>
      </div>
      {tab === 'catalog' ? <>
        <div className="marketGrid">{visibleListings.map(listingCard)}</div>
        {!visibleListings.length ? <div className="marketPanel"><p>No hay anuncios que coincidan. Publica uno o cambia los filtros.</p>{stateId ? <button onClick={() => { setRegion('national'); setBefore(null); setSnapshot(null); }}>Ver todo Venezuela</button> : null}</div> : null}
        <div className="marketActions">{before ? <button onClick={() => setBefore(null)}>Volver a los más recientes</button> : null}
          {snapshot.hasMore ? <button onClick={() => setBefore(snapshot.listings[snapshot.listings.length - 1].id)}>Ver anuncios anteriores</button> : null}</div>
      </> : <>
        <div className="marketGrid">{visibleFavorites.map(favorite => favorite.listing ? listingCard(favorite.listing) :
          <article className="marketPanel" key={favorite.listingId}><h2>Anuncio #{favorite.listingId} no disponible</h2><p>Fue retirado y ya no se muestra su contenido. Puedes quitar esta referencia de tus favoritos.</p>
            <button disabled={busy || photoBusy} onClick={() => void send({ kind: 'favorite', listingId: favorite.listingId, saved: false })}>Quitar favorito no disponible #{favorite.listingId}</button></article>)}</div>
        {!snapshot.favorites.length ? <p>Aún no tienes favoritos. Guarda artículos desde el catálogo.</p> : !visibleFavorites.length ? <p>Ningún favorito coincide con estos filtros. Puedes limpiarlos para ver todos.</p> : null}
      </>}
    </> : null}
    {tab === 'catalog' && selected ? <article className="marketDetail">
      <button className="managerButtonOutline" onClick={() => { setSelectedId(null); setBefore(null); }}>Volver al catálogo</button>
      <div className="marketDetailGrid">{listingImage(selected)}<div><span className="marketBadge">{selected.type === 'auction' ? 'Subasta' : 'Venta directa'}</span>
        <h2>{selected.title}</h2><p className="marketDescription">{selected.description}</p><p>{listingSport(selected)} · {listingLocation(selected)} · {selected.condition === 'new' ? 'Nuevo' : 'Usado'}</p>
        {favoriteButton(selected)}
        {selected.stateId ? <p>Referencia: {selected.location}</p> : null}
        {!selected.sportsOnly ? <p>Publicación anterior sin declaración deportiva registrada. El propietario puede completar sus datos cuando admite edición; puedes reportar contenido ajeno al deporte.</p> : null}
        <p>{marketplaceListingStatus(selected)}</p>
        {selected.moderation ? <p className="marketDescription">Motivo del retiro: {selected.moderation.reason}. La subasta retirada no se adjudica. Los pedidos existentes conservan su historial.</p> : null}
        <p>Vendedor: <strong>{selected.seller.displayName}</strong> · Cuenta sin verificación comercial</p>
        <strong className="marketPrice">{marketplacePrice(selected.currentBidCents ?? selected.priceCents)}</strong>
        {selected.endsAt ? <><p>{selected.bidCount} pujas · Incremento mínimo: {marketplacePrice(selected.incrementCents)}</p><p>Cierre fijo: {timeLabel(selected.endsAt)}</p>
          <p className="marketCountdown">{selected.status === 'removed' ? 'Subasta detenida por moderación, sin adjudicación.' : ended || selected.status !== 'active' ? 'Subasta cerrada. Consulta tu historial de pedidos; una subasta detenida por moderación no se adjudica ni se reabre.' : `Quedan ${Math.max(1, Math.ceil((Date.parse(selected.endsAt) - now - offset.current) / 60000))} minutos`}</p>
          <p>Gana la mayor puja válida antes del vencimiento. Sin pujas no hay adjudicación. El servidor decide la hora; no se extiende el cierre.</p></> : <p>{selected.stock} unidades disponibles</p>}
        {own ? <p>Este anuncio es tuyo: no puedes comprarlo ni pujar por él.</p> : null}
        {!own && viewer && selected.status === 'active' && !ended && (selected.type === 'sale' || selected.walletBacked) ? <form onSubmit={e => { e.preventDefault();
          try { void send(selected.type === 'auction' ? { kind: 'bid', listingId: selected.id, amountCents: parseMarketplacePrice(bid) } : { kind: 'buy', listingId: selected.id, quantity: Number(quantity) }); }
          catch (value) { setError(failure(value)); } }}>
          <fieldset disabled={busy}><label>{selected.type === 'auction' ? 'Tu puja · USD' : 'Cantidad'}
            <input required inputMode={selected.type === 'auction' ? 'decimal' : 'numeric'} value={selected.type === 'auction' ? bid : quantity} onChange={e => selected.type === 'auction' ? setBid(e.target.value) : setQuantity(e.target.value)} /></label>
          {selected.type === 'auction' ? <p>Puja mínima actual: {marketplacePrice(minimumMarketplaceBid(selected))}</p> : null}
          <label className="marketConsent"><input type="checkbox" required /> Confirmo los datos de esta operación. No se mueve dinero real.</label>
          <button className="managerButtonSolid" type="submit">{selected.type === 'auction' ? 'Confirmar puja' : 'Confirmar compra'}</button>
          <p>{selected.type === 'sale' ? 'Al confirmar se retiene el importe en tu billetera, se descuenta inventario y se crea tu pedido con chat privado. El vendedor recibe el saldo cuando confirmas recepción.' :
            'La puja líder retiene su importe; al ser superada se devuelve el saldo. Si ya lideras, tu retención actual cuenta para aumentar la puja.'} Esto no acredita un pago real.</p></fieldset></form> : null}
        {selected.type === 'auction' && !selected.walletBacked ? <p>Subasta anterior sin billetera: conserva historial y cierre, sin nuevas pujas ni cargos retroactivos.</p> : null}
        {selected.status !== 'active' ? <p>Este anuncio ya no admite compras ni pujas.</p> : null}
        {!viewer ? <Link href="/account">Inicia sesión para comprar o pujar</Link> : null}
        {own && selected.status === 'active' && !selected.bidCount ? <button disabled={busy} onClick={() => void send({ kind: 'withdraw', listingId: selected.id })}>Retirar anuncio</button> : null}
        {own && canEditMarketplaceListing(selected) ? <button disabled={busy} onClick={() => { setEditingId(selected.id); setSelectedId(null); setTab('selling'); }}>Editar mi anuncio</button> : null}
        {snapshot?.canModerate && selected.status !== 'removed' ? <details className="marketReport"><summary>Retirar mediante moderación</summary>
          <label>Motivo del retiro<textarea maxLength={500} value={removalReason} onChange={event => setRemovalReason(event.target.value)} /></label>
          <button disabled={busy || !removalReason.trim()} onClick={() => void send({ kind: 'remove', listingId: selected.id, reason: removalReason })}>Confirmar retiro por incumplimiento</button>
          <p>Detiene compras y pujas. Conserva pedidos, mensajes y pujas anteriores; no adjudica una subasta retirada.</p></details> : null}
        {snapshot && (own || snapshot.canModerate) ? <details className="marketReport"><summary>Historial de administración</summary>
          <ul>{snapshot.audits.filter(event => event.listingId === selected.id).map(event => <li key={event.id}>{timeLabel(event.at)} · {event.reason}</li>)}</ul></details> : null}
      </div></div>
      {snapshot ? <MarketplaceQuestions key={`${viewer?.id ?? 'public'}:${selected.id}`} listing={selected} snapshot={snapshot}
        busy={busy} before={beforeQuestion} onPage={setBeforeQuestion} send={send} /> : null}
      {viewer ? <details className="marketReport"><summary>Reportar este anuncio</summary>
        <label>Tipo de reporte<select value={reportType} onChange={e => setReportType(e.target.value)}><option>Contenido ajeno al deporte</option><option>Información engañosa</option><option>Otro incumplimiento</option></select></label>
        <label>Motivo<textarea maxLength={440} value={report} onChange={e => setReport(e.target.value)} /></label>
        <button disabled={busy || !report.trim()} onClick={() => void send({ kind: 'report', listingId: selected.id, reason: `${reportType}: ${report}` })}>Guardar reporte para revisión</button><p>Consulta la decisión en Reportes. Reportar no bloquea automáticamente ni verifica al vendedor.</p></details> : null}
    </article> : null}
    {tab === 'publish' && viewer ? <div className="marketPanel"><h2>Publicar venta o subasta</h2><p>Se publicará con tu cuenta, no con el rol deportivo seleccionado.</p>
      <form onSubmit={e => { e.preventDefault(); publish(); }}><fieldset className="marketPublish" disabled={busy || photoBusy || !draftReady}>
        <aside className="marketWarning marketFull"><strong>Marketplace exclusivamente deportivo.</strong> Publica únicamente implementos, ropa/calzado, accesorios o coleccionables relacionados con un deporte. No se permiten productos de comercio general sin relación deportiva. Esta declaración no sustituye una revisión humana.</aside>
        <label>Modalidad<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}><option value="sale">Venta directa</option><option value="auction">Subasta · una unidad</option></select></label>
        <label>Título<input required maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="marketFull">Descripción<textarea required maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>Categoría<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>{marketplaceCategories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Deporte del artículo<select required value={draft.sport ?? ''} onChange={e => setDraft({ ...draft, sport: e.target.value })}><option value="">Selecciona el deporte</option>{marketplaceSports.map(sport => <option key={sport.id} value={sport.id}>{sport.label}</option>)}</select></label>
        <label>Condición<select value={draft.condition} onChange={e => setDraft({ ...draft, condition: e.target.value })}><option value="used">Usado</option><option value="new">Nuevo</option></select></label>
        <label>Estado del artículo<select required value={draft.stateId ?? ''} onChange={e => {
          const state = venezuelaStates.find(item => item.id === e.target.value);
          setDraft({ ...draft, stateId: e.target.value, municipalityId: state?.municipalities[0]?.id ?? '' });
        }}><option value="">Selecciona el estado</option>{venezuelaStates.filter(state => state.municipalities.length).map(state => <option key={state.id} value={state.id}>{state.name}</option>)}</select></label>
        <label>Municipio del artículo<select required disabled={!draft.stateId} value={draft.municipalityId ?? ''} onChange={e => setDraft({ ...draft, municipalityId: e.target.value })}>
          <option value="">Selecciona el municipio</option>{venezuelaStates.find(state => state.id === draft.stateId)?.municipalities.map(municipality => <option key={municipality.id} value={municipality.id}>{municipality.name}</option>)}
        </select></label>
        <p className="marketFull">Se precarga tu ubicación guardada cuando existe. Puedes cambiarla para indicar dónde está realmente el artículo; tu perfil no se modifica.</p>
        <label>Ubicación<input maxLength={160} placeholder="Referencia opcional o punto de encuentro" value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })} /></label>
        <label>{draft.type === 'auction' ? 'Precio inicial · USD' : 'Precio por unidad · USD'}<input required inputMode="decimal" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} /></label>
        {draft.type === 'auction' ? <><label>Incremento mínimo · USD<input required inputMode="decimal" value={draft.increment} onChange={e => setDraft({ ...draft, increment: e.target.value })} /></label>
          <label>Fecha y hora local de cierre<input type="datetime-local" required value={draft.ends} onChange={e => setDraft({ ...draft, ends: e.target.value })} /></label></> :
          <label>Unidades<input type="number" min={1} max={1000} required value={draft.stock} onChange={e => setDraft({ ...draft, stock: e.target.value })} /></label>}
        <label className="marketFull">Foto opcional<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }} /></label>
        {draft.photo ? <div className="marketFull"><img className="marketUpload" src={draft.photo} alt="Vista previa de la foto" /><button type="button" onClick={() => setDraft({ ...draft, photo: null })}>Quitar foto</button></div> : null}
        <p className="marketFull">Las subastas cierran entre un minuto y treinta días. Una subasta con pujas no puede retirarse. Solo publica fotos que puedas utilizar.</p>
        <label className="marketConsent marketFull"><input type="checkbox" required /> Declaro que este artículo está relacionado con el deporte seleccionado y cumple las reglas del marketplace deportivo.</label>
        <button className="managerButtonSolid marketFull" type="submit">Publicar anuncio</button>
      </fieldset></form></div> : null}
    {tab === 'selling' && viewer ? <><h2>Mis anuncios</h2><div className="marketGrid">{snapshot?.myListings.map(listingCard)}</div>
      {!snapshot?.myListings.length ? <p>Todavía no has publicado artículos.</p> : null}</> : null}
    {tab === 'selling' && viewer && editing ? <MarketplaceListingEditor key={`${viewer.id}:${editingId}`} listing={editing}
      busy={busy} send={send} onError={setError} onClose={() => setEditingId(null)} onUploading={setPhotoBusy} /> : null}
    {tab === 'reviews' && viewer && snapshot ? <MarketplaceReviews key={viewer.id} snapshot={snapshot} busy={busy} send={send} openListing={openListing} /> : null}
    {(tab === 'orders' || tab === 'selling') && viewer ? <div className="marketOrders"><h2>{tab === 'orders' ? 'Mis compras' : 'Pedidos recibidos'}</h2>
      {snapshot?.orders.filter(item => (tab === 'orders' ? item.buyer.id : item.seller.id) === viewer.id).map(order => <article className="marketPanel" key={order.id}>
        <span className="marketBadge">Pedido #{order.id} · {statuses[order.status]}</span><h3>{order.title}</h3>
        <p>{order.quantity} unidad(es) · {marketplacePrice(order.totalCents)} · {order.type === 'auction' ? 'Adjudicación de subasta' : 'Venta directa'}</p>
        <p>{order.buyer.id === viewer.id ? `Vendedor: ${order.seller.displayName}` : `Comprador: ${order.buyer.displayName}`}</p>
        <p>{order.payment === 'held' ? 'Pago retenido en billetera hasta confirmar recepción.' :
          order.payment === 'released' ? 'Pago liberado al vendedor.' : order.payment === 'refunded' ? 'Saldo devuelto al comprador.' :
            'Pedido anterior sin pago de billetera registrado. No se cobra retroactivamente.'}</p>
        <div className="marketActions">{['confirmed', 'reserved'].includes(order.status) ? <>
          {order.seller.id === viewer.id ? <button disabled={busy} onClick={() => void send({ kind: 'update-order', orderId: order.id, status: 'sent' })}>Marcar envío</button> : null}
          <button disabled={busy} onClick={() => void send({ kind: 'update-order', orderId: order.id, status: 'cancelled' })}>Cancelar pedido</button></> : null}
          {order.status === 'sent' && order.buyer.id === viewer.id ? <button disabled={busy} onClick={() => void send({ kind: 'update-order', orderId: order.id, status: 'delivered' })}>Confirmar recepción</button> : null}
          <button disabled={busy} onClick={() => void send({ kind: 'start-thread', orderId: order.id })}>Chat privado del pedido #{order.id}</button></div>
        <details><summary>Historial del pedido</summary><ul>{order.history.map((event, index) => <li key={index}>{timeLabel(event.at)} · {statuses[event.status]} {event.note}</li>)}</ul></details>
        {['sent', 'delivered'].includes(order.status) ? <details className="marketReport"><summary>Registrar reclamación de prueba</summary><label>Motivo<textarea maxLength={500} value={dispute[order.id] ?? ''} onChange={e => setDispute({ ...dispute, [order.id]: e.target.value })} /></label>
          <button disabled={busy || !dispute[order.id]?.trim()} onClick={() => void send({ kind: 'update-order', orderId: order.id, status: 'disputed', note: dispute[order.id] })}>Guardar reclamación</button><p>Revisión pendiente. Si el pago sigue retenido, no se libera ni devuelve automáticamente; un pago ya liberado no se vuelve a debitar. No se hacen reembolsos reales.</p></details> : null}
      </article>)}
      {!snapshot?.orders.some(item => (tab === 'orders' ? item.buyer.id : item.seller.id) === viewer.id) ? <p>No tienes pedidos en esta sección.</p> : null}
    </div> : null}
    {tab === 'bids' && viewer ? <div className="marketPanel"><h2>Mis pujas</h2><p>En nuevas subastas la puja líder retiene saldo y devuelve el del anterior líder. Si ganas, la retención pasa al pedido en Mis compras. Las pujas anteriores sin billetera no se cobran retroactivamente.</p>
      <ul>{snapshot?.bids.map(item => <li key={item.id}>{item.title} · {marketplacePrice(item.amountCents)} · {timeLabel(item.createdAt)}
        <button onClick={() => { setSelectedId(item.listingId); setThreadId(null); setTab('catalog'); }}>Ver subasta</button></li>)}</ul>
      {!snapshot?.bids.length ? <p>Aún no has pujado.</p> : null}</div> : null}
    {tab === 'messages' && viewer ? <div className="marketInbox"><section className="marketPanel"><h2>Chats privados de pedidos</h2>
      {snapshot?.conversations.map(item => <button className="marketThread" key={item.id} aria-current={threadId === item.id ? 'true' : undefined} onClick={() => { setThreadId(item.id); setOlder([]); setMessage(''); }}>
        <strong>{item.title}</strong><span>{item.orderId ? `Pedido #${item.orderId}` : 'Archivo privado anterior · solo lectura'} · {item.buyer.id === viewer.id ? item.seller.displayName : item.buyer.displayName}</span></button>)}
      {!snapshot?.conversations.length ? <p>El chat privado se crea al confirmar una compra o ganar una subasta. Antes de comprar usa las preguntas públicas del anuncio.</p> : null}</section>
      {currentThread ? <section className="marketPanel"><h2>{currentThread.title}</h2><p>{currentThread.orderId ? `Pedido #${currentThread.orderId}: solo comprador y vendedor coordinan pago, envío o retiro. Conversar no confirma un pago.` : 'Consulta anterior conservada en privado, de solo lectura. No se publicó ni se trasladó su contenido a las preguntas públicas.'}</p>
        {snapshot?.hasOlderMessages ? <button disabled={busy} onClick={() => void olderMessages()}>Leer mensajes anteriores</button> : null}
        <div className="marketMessages">{messages.map(item => <article key={item.id}><strong>{item.author.displayName}</strong><p>{item.text}</p><small>{timeLabel(item.createdAt)}</small></article>)}</div>
        {currentThread.orderId ? <form onSubmit={e => { e.preventDefault(); void send({ kind: 'message', threadId, text: message }); }}><label>Mensaje privado<textarea required maxLength={500} value={message} onChange={e => setMessage(e.target.value)} /></label>
          <button className="managerButtonSolid" disabled={busy || !message.trim()} type="submit">Enviar mensaje privado</button></form> : null}</section> : null}
    </div> : null}
  </section>;
}
