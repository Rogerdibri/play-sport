import { isProfileLocation, venezuelaStates } from './venezuela.js';
import { readWalletBalance, type WalletBalance } from './wallet.js';

export const marketplaceCategories = [
  { id: 'equipment', label: 'Implementos deportivos' }, { id: 'clothing', label: 'Ropa y calzado deportivo' },
  { id: 'accessories', label: 'Accesorios deportivos' }, { id: 'collectibles', label: 'Coleccionables deportivos' }
] as const;
export type MarketplaceCategory = typeof marketplaceCategories[number]['id'];
export const marketplaceSports = [
  { id: 'baseball', label: 'Béisbol' }, { id: 'softball', label: 'Softbol' },
  { id: 'football', label: 'Fútbol' }, { id: 'basketball', label: 'Baloncesto' },
  { id: 'volleyball', label: 'Voleibol' }, { id: 'racquet', label: 'Deportes de raqueta' },
  { id: 'athletics', label: 'Atletismo' }, { id: 'cycling', label: 'Ciclismo' },
  { id: 'swimming', label: 'Natación y deportes acuáticos' }, { id: 'gymnastics', label: 'Gimnasia' },
  { id: 'combat', label: 'Artes marciales y deportes de combate' }, { id: 'fitness', label: 'Entrenamiento deportivo' },
  { id: 'outdoor', label: 'Deportes al aire libre' }, { id: 'adaptive', label: 'Deporte adaptado' },
  { id: 'multisport', label: 'Uso multideportivo' }
] as const;
export type MarketplaceSport = typeof marketplaceSports[number]['id'];
export const marketplaceSportFilters = [
  { id: 'baseball-softball', label: 'Béisbol y softbol', sports: ['baseball', 'softball'] as const },
  ...marketplaceSports.flatMap(sport => sport.id === 'baseball' || sport.id === 'softball' ? [] :
    [{ id: sport.id, label: sport.label, sports: [sport.id] }])
] as const;
export type MarketplaceSportFilter = typeof marketplaceSportFilters[number]['id'];
export type MarketplaceFilters = {
  state?: string; category?: MarketplaceCategory; type?: 'sale' | 'auction';
  sport?: MarketplaceSportFilter; condition?: 'new' | 'used'; search?: string;
};
export type MarketplaceQuery = MarketplaceFilters & {
  before?: number; listing?: number; thread?: number; beforeMessage?: number; beforeQuestion?: number;
};
export const marketplacePhotoMaxLength = 64000;
export function isMarketplacePhotoPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/api\/marketplace\/photos\/[a-f0-9]{64}\.jpg$/.test(value);
}
export const marketplaceMaximumCents = 100000000;
export type MarketplaceActor = { id: string; displayName: string };
export type MarketplaceListing = {
  id: number; seller: MarketplaceActor; type: 'sale' | 'auction'; title: string; description: string;
  category: MarketplaceCategory; condition: 'new' | 'used'; location: string; photo: string | null;
  stateId: string | null; municipalityId: string | null; sport: MarketplaceSport | null; sportsOnly: boolean;
  priceCents: number; stock: number; incrementCents: number; endsAt: string | null;
  currentBidCents: number | null; bidCount: number; status: 'active' | 'closed' | 'withdrawn' | 'removed'; createdAt: string;
  revision: number; walletBacked: boolean; moderation: { reason: string; at: string; previousStatus: 'active' | 'closed' | 'withdrawn' } | null;
};
export type MarketplaceOrderStatus = 'confirmed' | 'reserved' | 'sent' | 'delivered' | 'cancelled' | 'disputed';
export type MarketplaceOrder = {
  id: number; listingId: number; title: string; type: 'sale' | 'auction'; buyer: MarketplaceActor;
  seller: MarketplaceActor; quantity: number; totalCents: number; status: MarketplaceOrderStatus; createdAt: string;
  payment: 'held' | 'released' | 'refunded' | 'legacy-unpaid';
  history: Array<{ status: MarketplaceOrderStatus; at: string; actorId: string; note: string }>;
};
export type MarketplaceBid = { id: number; listingId: number; title: string; amountCents: number; createdAt: string };
export type MarketplaceConversation = { id: number; listingId: number; orderId: number | null; title: string; buyer: MarketplaceActor; seller: MarketplaceActor; createdAt: string };
export type MarketplaceMessage = { id: number; threadId: number; author: MarketplaceActor; text: string; createdAt: string };
export type MarketplaceQuestion = {
  id: number; listingId: number; author: MarketplaceActor; text: string; createdAt: string;
  answer: { text: string; createdAt: string } | null; status: 'visible' | 'hidden';
  moderation: { reason: string; actorId: string; at: string } | null;
};
export type MarketplaceReview = {
  id: number; listingId: number; questionId: number | null; authorId: string; kind: 'report' | 'appeal' | 'question'; reason: string; createdAt: string;
  status: 'pending' | 'resolved'; decision: 'dismiss' | 'remove' | 'restore' | 'uphold' | null;
  decisionReason: string | null; reviewerId: string | null; resolvedAt: string | null;
};
export type MarketplaceAudit = {
  id: number; listingId: number; actorId: string; action: 'edit' | 'withdraw' | 'remove' | 'restore';
  reason: string; at: string;
};
export type MarketplaceFavorite = { listingId: number; savedAt: string; listing: MarketplaceListing | null };
export type MarketplaceSnapshot = {
  mode: 'test'; currency: 'USD_DEMO'; serverNow: string; viewer: MarketplaceActor | null; sessionExpired: boolean;
  canModerate: boolean; reviews: MarketplaceReview[]; reviewListings: MarketplaceListing[]; audits: MarketplaceAudit[];
  listings: MarketplaceListing[]; hasMore: boolean; myListings: MarketplaceListing[];
  orders: MarketplaceOrder[]; bids: MarketplaceBid[]; conversations: MarketplaceConversation[];
  messages: MarketplaceMessage[]; hasOlderMessages: boolean;
  questions: MarketplaceQuestion[]; hasOlderQuestions: boolean;
  favorites: MarketplaceFavorite[];
  walletBalance: WalletBalance | null;
};
export type MarketplaceResult = { notice: string; entityId: number };

export function minimumMarketplaceBid(listing: MarketplaceListing): number {
  return listing.currentBidCents === null ? listing.priceCents : listing.currentBidCents + listing.incrementCents;
}
export function marketplacePrice(cents: number): string {
  return new Intl.NumberFormat('es', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
export function parseMarketplacePrice(value: string): number {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Escribe un precio positivo con hasta dos decimales, sin separadores de miles.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (cents < 1 || cents > marketplaceMaximumCents) throw new Error('El precio debe estar entre 0,01 y 1.000.000 USD.');
  return cents;
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El Marketplace contiene datos inválidos.');
  return Object.fromEntries(Object.entries(value));
};
const text = (value: unknown, max = 4000): string => {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw new Error('El Marketplace contiene texto inválido.');
  return value;
};
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('El Marketplace contiene números inválidos.');
  return value;
};
const date = (value: unknown): string => {
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error('El Marketplace contiene una fecha inválida.');
  return result;
};
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find(candidate => candidate === value);
  if (result === undefined) throw new Error('El Marketplace contiene una opción inválida.');
  return result;
}
function array<T>(value: unknown, reader: (_value: unknown) => T): T[] { // eslint-disable-line no-unused-vars
  if (!Array.isArray(value)) throw new Error('El Marketplace contiene una lista inválida.');
  return value.map(reader);
}
function actor(value: unknown): MarketplaceActor {
  const v = object(value), id = text(v.id, 36);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new Error('La identidad del Marketplace no es válida.');
  return { id, displayName: text(v.displayName, 80) };
}
export function readMarketplaceQuery(entries: Iterable<readonly [string, unknown]>): MarketplaceQuery {
  const seen = new Set<string>(), result: MarketplaceQuery = {};
  for (const [key, value] of entries) {
    if (seen.has(key) || typeof value !== 'string') throw new Error('La consulta del Marketplace contiene campos repetidos o inválidos.');
    seen.add(key);
    switch (key) {
      case 'state':
        if (!venezuelaStates.some(state => state.id === value)) throw new Error('El estado del Marketplace no es válido.');
        result.state = value; break;
      case 'category': result.category = choice(value, marketplaceCategories.map(item => item.id)); break;
      case 'type': result.type = choice(value, ['sale', 'auction'] as const); break;
      case 'sport': result.sport = choice(value, marketplaceSportFilters.map(item => item.id)); break;
      case 'condition': result.condition = choice(value, ['new', 'used'] as const); break;
      case 'search':
        if ([...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('La búsqueda contiene caracteres no permitidos.');
        result.search = text(value, 100).trim(); break;
      case 'before': case 'listing': case 'thread': case 'beforeMessage': case 'beforeQuestion':
        if (!/^[1-9]\d*$/.test(value)) throw new Error('El cursor del Marketplace no es válido.');
        result[key] = integer(Number(value), 1); break;
      default: throw new Error('La consulta del Marketplace contiene un campo no permitido.');
    }
  }
  if (result.before && result.listing || result.beforeMessage && !result.thread || result.beforeQuestion && !result.listing) {
    throw new Error('Los cursores del Marketplace no son válidos.');
  }
  return result;
}
export function marketplaceListingMatchesFilters(listing: MarketplaceListing, filters: MarketplaceFilters): boolean {
  const sport = filters.sport ? marketplaceSportFilters.find(item => item.id === filters.sport) : null;
  return (!filters.state || listing.stateId === filters.state) && (!filters.category || listing.category === filters.category) &&
    (!filters.type || listing.type === filters.type) && (!filters.condition || listing.condition === filters.condition) &&
    (!filters.sport || Boolean(sport && listing.sport && sport.sports.some(id => id === listing.sport))) &&
    (!filters.search || `${listing.title} ${listing.description} ${listing.location}`.toLocaleLowerCase('es').includes(filters.search.trim().toLocaleLowerCase('es')));
}
export function readMarketplaceListing(value: unknown): MarketplaceListing {
  const v = object(value);
  const moderation = v.moderation === undefined || v.moderation === null ? null : object(v.moderation);
  const stateId = v.stateId === undefined || v.stateId === null ? null : text(v.stateId, 10);
  const municipalityId = v.municipalityId === undefined || v.municipalityId === null ? null : text(v.municipalityId, 100);
  if (!(stateId === null && municipalityId === null) && !isProfileLocation({ stateId, municipalityId })) {
    throw new Error('El estado y municipio del anuncio no pertenecen al catálogo territorial.');
  }
  if (v.sportsOnly !== undefined && typeof v.sportsOnly !== 'boolean') throw new Error('La declaración deportiva del anuncio no es válida.');
  if (!(v.photo === null || isMarketplacePhotoPath(v.photo))) throw new Error('La foto del anuncio no es válida.');
  if (v.walletBacked !== undefined && typeof v.walletBacked !== 'boolean') throw new Error('El modo de pago del anuncio no es válido.');
  const result: MarketplaceListing = {
    id: integer(v.id, 1), seller: actor(v.seller), type: choice(v.type, ['sale', 'auction']), title: text(v.title, 100),
    description: text(v.description), category: choice(v.category, marketplaceCategories.map(item => item.id)),
    condition: choice(v.condition, ['new', 'used']), location: text(v.location, 160), photo: v.photo,
    stateId, municipalityId, sport: v.sport === undefined || v.sport === null ? null : choice(v.sport, marketplaceSports.map(item => item.id)),
    sportsOnly: v.sportsOnly === true,
    priceCents: integer(v.priceCents, 1, marketplaceMaximumCents), stock: integer(v.stock, 0, 1000),
    incrementCents: integer(v.incrementCents, 0, marketplaceMaximumCents), endsAt: v.endsAt === null ? null : date(v.endsAt),
    currentBidCents: v.currentBidCents === null ? null : integer(v.currentBidCents, 1, marketplaceMaximumCents),
    bidCount: integer(v.bidCount), status: choice(v.status, ['active', 'closed', 'withdrawn', 'removed']), createdAt: date(v.createdAt),
    revision: v.revision === undefined ? 0 : integer(v.revision),
    walletBacked: v.walletBacked === true,
    moderation: moderation ? { reason: text(moderation.reason, 500), at: date(moderation.at),
      previousStatus: choice(moderation.previousStatus, ['active', 'closed', 'withdrawn']) } : null
  };
  if ((result.status === 'removed') !== (result.moderation !== null)) throw new Error('El estado de moderación del anuncio no es válido.');
  if (result.type === 'auction' && (!result.endsAt || result.incrementCents < 1 || result.stock > 1) ||
    result.type === 'sale' && (result.endsAt !== null || result.incrementCents !== 0 || result.currentBidCents !== null || result.bidCount !== 0)) {
    throw new Error('Las reglas del anuncio son inválidas.');
  }
  return result;
}
const statuses = ['confirmed', 'reserved', 'sent', 'delivered', 'cancelled', 'disputed'] as const;
export function readMarketplaceOrder(value: unknown): MarketplaceOrder {
  const v = object(value);
  return { id: integer(v.id, 1), listingId: integer(v.listingId, 1), title: text(v.title, 100), type: choice(v.type, ['sale', 'auction']),
    buyer: actor(v.buyer), seller: actor(v.seller), quantity: integer(v.quantity, 1, 1000),
    totalCents: integer(v.totalCents, 1), status: choice(v.status, statuses), createdAt: date(v.createdAt),
    payment: v.payment === undefined ? 'legacy-unpaid' : choice(v.payment, ['held', 'released', 'refunded', 'legacy-unpaid']),
    history: array(v.history, value => { const entry = object(value); return {
      status: choice(entry.status, statuses), at: date(entry.at), actorId: text(entry.actorId, 36),
      note: typeof entry.note === 'string' && entry.note.length <= 500 ? entry.note : text(entry.note, 500)
    }; }) };
}
export function readMarketplaceConversation(value: unknown): MarketplaceConversation {
  const v = object(value);
  return { id: integer(v.id, 1), listingId: integer(v.listingId, 1), orderId: v.orderId === undefined || v.orderId === null ? null : integer(v.orderId, 1),
    title: text(v.title, 100), buyer: actor(v.buyer), seller: actor(v.seller), createdAt: date(v.createdAt) };
}
export function readMarketplaceMessage(value: unknown): MarketplaceMessage {
  const v = object(value);
  return { id: integer(v.id, 1), threadId: integer(v.threadId, 1), author: actor(v.author), text: text(v.text, 500), createdAt: date(v.createdAt) };
}
export function readMarketplaceBid(value: unknown): MarketplaceBid {
  const v = object(value);
  return { id: integer(v.id, 1), listingId: integer(v.listingId, 1), title: text(v.title, 100), amountCents: integer(v.amountCents, 1, marketplaceMaximumCents), createdAt: date(v.createdAt) };
}
export function readMarketplaceQuestion(value: unknown): MarketplaceQuestion {
  const v = object(value), answer = v.answer === null ? null : object(v.answer), moderation = v.moderation === null ? null : object(v.moderation);
  const result: MarketplaceQuestion = { id: integer(v.id, 1), listingId: integer(v.listingId, 1), author: actor(v.author), text: text(v.text, 500),
    createdAt: date(v.createdAt), answer: answer ? { text: text(answer.text, 500), createdAt: date(answer.createdAt) } : null,
    status: choice(v.status, ['visible', 'hidden']), moderation: moderation ? { reason: text(moderation.reason, 500),
      actorId: actor({ id: moderation.actorId, displayName: 'Cuenta' }).id, at: date(moderation.at) } : null };
  if ((result.status === 'hidden') !== (result.moderation !== null)) throw new Error('La moderación de la pregunta no es válida.');
  return result;
}
export function readMarketplaceReview(value: unknown): MarketplaceReview {
  const v = object(value);
  const result: MarketplaceReview = {
    id: integer(v.id, 1), listingId: integer(v.listingId, 1), authorId: actor({ id: v.authorId, displayName: 'Cuenta' }).id,
    questionId: v.questionId === undefined || v.questionId === null ? null : integer(v.questionId, 1),
    kind: choice(v.kind, ['report', 'appeal', 'question']), reason: text(v.reason, 500), createdAt: date(v.createdAt),
    status: choice(v.status, ['pending', 'resolved']),
    decision: v.decision === null ? null : choice<NonNullable<MarketplaceReview['decision']>>(v.decision, ['dismiss', 'remove', 'restore', 'uphold']),
    decisionReason: v.decisionReason === null ? null : text(v.decisionReason, 500),
    reviewerId: v.reviewerId === null ? null : actor({ id: v.reviewerId, displayName: 'Cuenta' }).id,
    resolvedAt: v.resolvedAt === null ? null : date(v.resolvedAt)
  };
  if (result.status === 'pending' ? [result.decision, result.decisionReason, result.reviewerId, result.resolvedAt].some(v => v !== null) :
    [result.decision, result.decisionReason, result.reviewerId, result.resolvedAt].some(v => v === null)) throw new Error('La revisión del anuncio no es válida.');
  if ((result.kind === 'question') !== (result.questionId !== null)) throw new Error('El objetivo del reporte no es válido.');
  if (result.decision && !(result.kind !== 'appeal' ? ['dismiss', 'remove'] : ['restore', 'uphold']).includes(result.decision)) throw new Error('La decisión de revisión no es válida.');
  return result;
}
export function readMarketplaceAudit(value: unknown): MarketplaceAudit {
  const v = object(value);
  return { id: integer(v.id, 1), listingId: integer(v.listingId, 1), actorId: actor({ id: v.actorId, displayName: 'Cuenta' }).id,
    action: choice(v.action, ['edit', 'withdraw', 'remove', 'restore']), reason: text(v.reason, 500), at: date(v.at) };
}
export function readMarketplaceFavorite(value: unknown): MarketplaceFavorite {
  const v = object(value), listing = v.listing === null ? null : readMarketplaceListing(v.listing);
  const listingId = integer(v.listingId, 1);
  if (listing && (listing.id !== listingId || ['withdrawn', 'removed'].includes(listing.status))) throw new Error('El favorito contiene un anuncio no disponible o una identidad distinta.');
  return { listingId, savedAt: date(v.savedAt), listing };
}
export function readMarketplaceSnapshot(value: unknown): MarketplaceSnapshot {
  const v = object(value);
  if (v.mode !== 'test' || v.currency !== 'USD_DEMO' || typeof v.sessionExpired !== 'boolean' ||
    typeof v.hasMore !== 'boolean' || typeof v.hasOlderMessages !== 'boolean' || typeof v.canModerate !== 'boolean' ||
    typeof v.hasOlderQuestions !== 'boolean') throw new Error('La respuesta del Marketplace es inválida.');
  return { mode: 'test', currency: 'USD_DEMO', serverNow: date(v.serverNow), viewer: v.viewer === null ? null : actor(v.viewer),
    sessionExpired: v.sessionExpired, listings: array(v.listings, readMarketplaceListing), hasMore: v.hasMore,
    myListings: array(v.myListings, readMarketplaceListing), orders: array(v.orders, readMarketplaceOrder),
    walletBalance: v.walletBalance === null ? null : readWalletBalance(v.walletBalance),
    bids: array(v.bids, readMarketplaceBid), conversations: array(v.conversations, readMarketplaceConversation),
    messages: array(v.messages, readMarketplaceMessage), hasOlderMessages: v.hasOlderMessages,
    canModerate: v.canModerate, reviews: array(v.reviews, readMarketplaceReview),
    reviewListings: array(v.reviewListings, readMarketplaceListing), audits: array(v.audits, readMarketplaceAudit),
    questions: array(v.questions, readMarketplaceQuestion), hasOlderQuestions: v.hasOlderQuestions,
    favorites: array(v.favorites, readMarketplaceFavorite) };
}
