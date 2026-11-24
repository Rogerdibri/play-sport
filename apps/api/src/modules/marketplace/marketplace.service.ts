import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, Optional, UnauthorizedException, type OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { marketplaceCategories, marketplaceSports, marketplaceMaximumCents, isMarketplacePhotoPath, minimumMarketplaceBid,
  isProfileLocation, marketplaceSportFilters, readMarketplaceQuery, marketplaceListingMatchesFilters,
  readMarketplaceListing, readMarketplaceOrder, readMarketplaceBid, readMarketplaceConversation, readMarketplaceMessage, readMarketplaceReview, readMarketplaceAudit, readMarketplaceQuestion,
  type MarketplaceActor, type MarketplaceListing, type MarketplaceOrder, type MarketplaceOrderStatus, type MarketplaceResult, type MarketplaceSnapshot, type MarketplaceReview, type MarketplaceQuestion, type MarketplaceQuery } from '@playsport/shared';
import { AccountsService } from '../accounts/accounts.service';
import { commercePath, openCommerceDatabase } from '../commerce-database';
import { commerceCanModerate } from '../commerce-moderation';
import { WalletLedger } from '../wallet/wallet-ledger';
import { MarketplacePhotos } from './marketplace-photos';

type Options = { path: string; now?: () => number };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys: Record<string, string[]> = {
  publish: ['type', 'title', 'description', 'category', 'condition', 'location', 'stateId', 'municipalityId', 'sport', 'sportsOnly', 'photo', 'priceCents', 'stock', 'incrementCents', 'endsAt'],
  buy: ['listingId', 'quantity'], bid: ['listingId', 'amountCents'], withdraw: ['listingId'],
  'update-order': ['orderId', 'status', 'note'], 'start-thread': ['orderId'], message: ['threadId', 'text'],
  question: ['listingId', 'text'], answer: ['questionId', 'text'], 'report-question': ['questionId', 'reason'], 'hide-question': ['questionId', 'reason'],
  report: ['listingId', 'reason'], appeal: ['listingId', 'reason'],
  edit: ['listingId', 'revision', 'title', 'description', 'category', 'condition', 'location', 'stateId', 'municipalityId', 'sport', 'sportsOnly', 'photo', 'priceCents', 'stock', 'incrementCents'],
  'review-report': ['reviewId', 'decision', 'reason'], remove: ['listingId', 'reason'], favorite: ['listingId', 'saved']
};

@Injectable()
export class MarketplaceService implements OnModuleDestroy {
  private readonly db: DatabaseSync;
  private readonly wallet: WalletLedger;
  private readonly accounts: AccountsService;
  private readonly now: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly moderatorsPath: string;
  private readonly photos: MarketplacePhotos;
  private readonly logger = new Logger(MarketplaceService.name);
  constructor(accounts: AccountsService, @Optional() options?: Options) {
    this.accounts = accounts; this.now = options?.now ?? Date.now;
    const path = commercePath(options?.path);
    this.photos = new MarketplacePhotos(resolve(dirname(path), 'photos'));
    this.moderatorsPath = resolve(dirname(path), 'moderators.json');
    this.db = openCommerceDatabase(path);
    this.wallet = new WalletLedger(this.db, this.now);
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== 5 && version !== 6) { this.db.close(); throw new Error('La base del Marketplace no es compatible. No se sobrescribió.'); }
    const threadColumns = this.db.prepare('PRAGMA table_info(market_threads)').all();
    const migratingThreads = threadColumns.length > 0 && !threadColumns.some(column => column.name === 'order_id');
    // SQLite table rebuilds require disabling foreign keys before BEGIN; validate all relations before COMMIT.
    if (migratingThreads) this.db.exec('PRAGMA foreign_keys=OFF;');
    try { this.transaction(() => { this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_listings(id INTEGER PRIMARY KEY, seller_id TEXT NOT NULL, status TEXT NOT NULL, ends_at INTEGER, payload TEXT NOT NULL, state_id TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS market_orders(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, auction_listing_id INTEGER UNIQUE, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS market_bids(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        bidder_id TEXT NOT NULL, bidder_name TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS market_threads(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, payload TEXT NOT NULL, order_id INTEGER UNIQUE REFERENCES market_orders(id)) STRICT;
      CREATE TABLE IF NOT EXISTS market_messages(id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL REFERENCES market_threads(id),
        author_id TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS market_reports(listing_id INTEGER NOT NULL REFERENCES market_listings(id), reporter_id TEXT NOT NULL,
        reason TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(listing_id,reporter_id)) STRICT;
      CREATE TABLE IF NOT EXISTS market_commands(actor_id TEXT NOT NULL, request_id TEXT NOT NULL, body_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, result TEXT NOT NULL, PRIMARY KEY(actor_id,request_id)) STRICT;
      CREATE INDEX IF NOT EXISTS market_expiration ON market_listings(status,ends_at);
      CREATE INDEX IF NOT EXISTS market_listing_bids ON market_bids(listing_id,amount);
      CREATE INDEX IF NOT EXISTS market_thread_messages ON market_messages(thread_id,id);
      CREATE INDEX IF NOT EXISTS market_actor_commands ON market_commands(actor_id,created_at);
      CREATE TABLE IF NOT EXISTS market_reviews(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        author_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS market_audits(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        payload TEXT NOT NULL, before_payload TEXT NOT NULL, after_payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS market_review_queue ON market_reviews(status,id);
      CREATE INDEX IF NOT EXISTS market_review_author ON market_reviews(author_id,id);
      CREATE INDEX IF NOT EXISTS market_listing_audits ON market_audits(listing_id,id);
      CREATE TABLE IF NOT EXISTS market_questions(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        author_id TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS market_listing_questions ON market_questions(listing_id,status,id);
      CREATE INDEX IF NOT EXISTS market_question_rate ON market_questions(author_id,created_at);
      CREATE TABLE IF NOT EXISTS market_favorites(account_id TEXT NOT NULL, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
        created_at INTEGER NOT NULL, PRIMARY KEY(account_id,listing_id)) STRICT;
      CREATE INDEX IF NOT EXISTS market_account_favorites ON market_favorites(account_id,created_at,listing_id);
      CREATE INDEX IF NOT EXISTS market_sport_condition ON market_listings(json_extract(payload,'$.sport'),json_extract(payload,'$.condition'),id);
    `);
      if (migratingThreads) {
        this.db.exec(`
          CREATE TABLE market_threads_v4(id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL REFERENCES market_listings(id),
            buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL, payload TEXT NOT NULL, order_id INTEGER UNIQUE REFERENCES market_orders(id)) STRICT;
          INSERT INTO market_threads_v4(id,listing_id,buyer_id,seller_id,payload) SELECT id,listing_id,buyer_id,seller_id,payload FROM market_threads;
          DROP TABLE market_threads;
          ALTER TABLE market_threads_v4 RENAME TO market_threads;
        `);
      }
      if (version === 1) this.db.exec('ALTER TABLE market_listings ADD COLUMN state_id TEXT;');
      this.db.exec('CREATE INDEX IF NOT EXISTS market_state_catalog ON market_listings(state_id,id);');
      if (version < 3) {
        const reports = this.db.prepare('SELECT listing_id,reporter_id,reason,created_at FROM market_reports').all();
        for (const report of reports) this.createReview(this.number(report.listing_id), this.text(report.reporter_id, 36), 'report',
          this.text(report.reason, 500), new Date(this.number(report.created_at, 0)).toISOString());
      }
      if (version < 4) for (const row of this.db.prepare('SELECT payload FROM market_orders').all()) this.orderThread(this.decode(row, readMarketplaceOrder));
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('La migración no conserva las relaciones del Marketplace.');
      this.wallet.initialize();
      this.db.exec('PRAGMA user_version = 6;');
    }); this.db.exec('PRAGMA foreign_keys=ON;'); } catch (error) { this.db.close(); throw error; }
    try {
      const migration = this.photos.migrate(this.db, path);
      if (migration.migrated) this.logger.log(`Fotos extraídas de ${migration.migrated} registros. Respaldo anterior: ${migration.backup}`);
    } catch (error) { this.db.close(); throw error; }
    this.db.function('market_search', { deterministic: true }, (payload, search) => {
      if (typeof payload !== 'string' || typeof search !== 'string') throw new Error('Los datos de búsqueda del Marketplace no son válidos.');
      return marketplaceListingMatchesFilters(readMarketplaceListing(JSON.parse(payload)), { search }) ? 1 : 0;
    });
    this.timer = setInterval(() => {
      try { this.transaction(() => this.settle()); }
      catch (error) { this.logger.error('No se pudieron cerrar las subastas. Las consultas devolverán el error hasta recuperar el servicio.', error instanceof Error ? error.stack : String(error)); }
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); this.db.close(); }
  readPhoto(filename: string) { return this.photos.read(filename); }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private decode<T>(row: unknown, reader: (_value: unknown) => T): T { // eslint-disable-line no-unused-vars
    if (!record(row) || typeof row.payload !== 'string') throw new Error('La base del Marketplace contiene un registro inválido.');
    return reader(JSON.parse(row.payload));
  }
  private number(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException('El número solicitado no es válido.');
    return value;
  }
  private text(value: unknown, max: number): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max ||
      [...value].some(c => c.charCodeAt(0) < 32 && c !== '\n' || c.charCodeAt(0) === 127)) throw new BadRequestException(`Escribe un texto de 1 a ${max} caracteres, sin controles.`);
    return value.trim();
  }
  private listing(id: number): MarketplaceListing {
    const row = this.db.prepare('SELECT payload FROM market_listings WHERE id=?').get(id);
    if (!row) throw new NotFoundException('El anuncio no existe.');
    return this.decode(row, readMarketplaceListing);
  }
  private storeListing(listing: MarketplaceListing) {
    if (listing.photo !== null && !isMarketplacePhotoPath(listing.photo)) listing.photo = this.photos.store(listing.photo);
    listing.revision++;
    this.db.prepare('UPDATE market_listings SET status=?,ends_at=?,state_id=?,payload=? WHERE id=?')
      .run(listing.status, listing.endsAt ? Date.parse(listing.endsAt) : null, listing.stateId, JSON.stringify(listing), listing.id);
  }
  private canModerate(actor: MarketplaceActor | null): boolean {
    return commerceCanModerate(actor?.id ?? null, this.moderatorsPath);
  }
  private requireModerator(actor: MarketplaceActor) {
    if (!this.canModerate(actor)) throw new ForbiddenException('Tu cuenta no tiene permiso de moderación del Marketplace local.');
  }
  private createReview(listingId: number, authorId: string, kind: MarketplaceReview['kind'], reason: string, at: string, questionId: number | null = null): number {
    const id = this.number(Number(this.db.prepare("INSERT INTO market_reviews(listing_id,author_id,kind,status,payload) VALUES(?,?,?,'pending','{}')")
      .run(listingId, authorId, kind).lastInsertRowid));
    const review: MarketplaceReview = { id, listingId, questionId, authorId, kind, reason, createdAt: at, status: 'pending',
      decision: null, decisionReason: null, reviewerId: null, resolvedAt: null };
    this.db.prepare('UPDATE market_reviews SET payload=? WHERE id=?').run(JSON.stringify(review), id);
    return id;
  }
  private audit(actor: MarketplaceActor, before: MarketplaceListing, after: MarketplaceListing, action: 'edit' | 'withdraw' | 'remove' | 'restore', reason: string, at: string) {
    const id = this.number(Number(this.db.prepare('INSERT INTO market_audits(listing_id,payload,before_payload,after_payload) VALUES(?,?,?,?)')
      .run(after.id, '{}', JSON.stringify(before), JSON.stringify(after)).lastInsertRowid));
    this.db.prepare('UPDATE market_audits SET payload=? WHERE id=?').run(JSON.stringify({ id, listingId: after.id, actorId: actor.id, action, reason, at }), id);
  }
  private remove(actor: MarketplaceActor, listing: MarketplaceListing, reason: string, at: string) {
    this.requireModerator(actor);
    if (listing.status === 'removed') throw new ConflictException('El anuncio ya fue retirado por moderación.');
    const before = { ...listing };
    if (listing.type === 'auction' && listing.walletBacked && listing.status === 'active' && listing.currentBidCents !== null) this.wallet.refund(`auction:${listing.id}`, `remove:auction:${listing.id}`);
    listing.moderation = { reason, at, previousStatus: listing.status }; listing.status = 'removed';
    this.storeListing(listing); this.audit(actor, before, listing, 'remove', reason, at);
  }
  private publicationFields(input: Record<string, unknown>) {
    const category = marketplaceCategories.find(item => item.id === input.category);
    const sport = marketplaceSports.find(item => item.id === input.sport);
    if (!category || input.condition !== 'new' && input.condition !== 'used') throw new BadRequestException('La categoría o condición no son válidas.');
    if (!sport || input.sportsOnly !== true) throw new BadRequestException('Solo se permiten artículos deportivos. Selecciona su deporte y confirma las reglas de publicación.');
    const geography = { stateId: input.stateId, municipalityId: input.municipalityId };
    if (!isProfileLocation(geography)) throw new BadRequestException('Selecciona un estado y un municipio válidos para ubicar el artículo.');
    return { title: this.text(input.title, 100), description: this.text(input.description, 4000), category: category.id,
      condition: input.condition === 'new' ? 'new' as const : 'used' as const, location: this.text(input.location, 160),
      photo: this.photos.validate(input.photo), stateId: geography.stateId, municipalityId: geography.municipalityId, sport: sport.id, sportsOnly: true };
  }
  private participant(value: { buyer: MarketplaceActor; seller: MarketplaceActor }, actor: MarketplaceActor) {
    if (![value.buyer.id, value.seller.id].includes(actor.id)) throw new ForbiddenException('Esta conversación o pedido pertenece a otras cuentas.');
  }
  private orderThread(order: MarketplaceOrder): number {
    const previous = this.db.prepare('SELECT id FROM market_threads WHERE order_id=?').get(order.id);
    if (previous) return this.number(previous.id);
    const id = this.number(Number(this.db.prepare('INSERT INTO market_threads(listing_id,buyer_id,seller_id,payload,order_id) VALUES(?,?,?,?,?)')
      .run(order.listingId, order.buyer.id, order.seller.id, '{}', order.id).lastInsertRowid));
    this.db.prepare('UPDATE market_threads SET payload=? WHERE id=?').run(JSON.stringify({
      id, listingId: order.listingId, orderId: order.id, title: order.title, buyer: order.buyer, seller: order.seller, createdAt: order.createdAt
    }), id);
    return id;
  }
  private question(id: number): MarketplaceQuestion {
    const row = this.db.prepare('SELECT payload FROM market_questions WHERE id=?').get(id);
    if (!row) throw new NotFoundException('La pregunta no existe.');
    return this.decode(row, readMarketplaceQuestion);
  }
  private publicText(input: unknown): string {
    const text = this.text(input, 500);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d(?:[\s().-]*\d){9,}/i.test(text)) throw new BadRequestException('No publiques correos, teléfonos ni números de pago. Los detalles personales van en el chat privado del pedido.');
    return text;
  }
  private hideQuestion(actor: MarketplaceActor, question: MarketplaceQuestion, reason: string, at: string) {
    this.requireModerator(actor);
    if (question.status === 'hidden') throw new ConflictException('La pregunta ya está oculta por moderación.');
    question.status = 'hidden'; question.moderation = { reason, actorId: actor.id, at };
    this.db.prepare("UPDATE market_questions SET status='hidden',payload=? WHERE id=?").run(JSON.stringify(question), question.id);
  }
  private order(listing: MarketplaceListing, buyer: MarketplaceActor, quantity: number, price: number, at: string, funded = true): number {
    const id = this.number(Number(this.db.prepare(`INSERT INTO market_orders(listing_id,buyer_id,seller_id,auction_listing_id,payload) VALUES(?,?,?,?,?)`)
      .run(listing.id, buyer.id, listing.seller.id, listing.type === 'auction' ? listing.id : null, '{}').lastInsertRowid));
    const order: MarketplaceOrder = { id, listingId: listing.id, title: listing.title, type: listing.type,
      buyer, seller: listing.seller, quantity, totalCents: price * quantity, status: 'confirmed', createdAt: at,
      payment: funded ? 'held' : 'legacy-unpaid',
      history: [{ status: 'confirmed', at, actorId: buyer.id, note: funded ? 'Compra confirmada con saldo retenido hasta la recepción.' : 'Adjudicación anterior sin billetera. No se cobraron fondos retroactivamente.' }] };
    if (funded) {
      if (listing.type === 'auction') this.wallet.award(listing.id, id, buyer.id, order.totalCents);
      else this.wallet.retain(`order:${id}`, buyer.id, order.totalCents, `hold:order:${id}`);
    }
    this.db.prepare('UPDATE market_orders SET payload=? WHERE id=?').run(JSON.stringify(order), id);
    this.orderThread(order);
    return id;
  }
  private settle() {
    const rows = this.db.prepare("SELECT payload FROM market_listings WHERE status='active' AND ends_at<=?").all(this.now());
    for (const row of rows) {
      const listing = this.decode(row, readMarketplaceListing);
      const winner = this.db.prepare('SELECT bidder_id,bidder_name,amount FROM market_bids WHERE listing_id=? ORDER BY amount DESC,id ASC LIMIT 1').get(listing.id);
      if (winner) {
        if (typeof winner.bidder_id !== 'string' || typeof winner.bidder_name !== 'string' || typeof winner.amount !== 'number' || !listing.endsAt) throw new Error('La adjudicación de la subasta contiene datos inválidos.');
        this.order(listing, { id: winner.bidder_id, displayName: winner.bidder_name }, 1, winner.amount, listing.endsAt, listing.walletBacked);
        listing.stock = 0;
      }
      listing.status = 'closed'; this.storeListing(listing);
    }
  }
  read(token?: string, query: MarketplaceQuery = {}): MarketplaceSnapshot {
    try {
      query = readMarketplaceQuery(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) =>
        [key, ['before', 'listing', 'thread', 'beforeMessage', 'beforeQuestion'].includes(key) && typeof value === 'number' ? String(value) : value]));
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La consulta del Marketplace no es válida.'); }
    return this.transaction(() => {
      this.settle();
      let viewer: MarketplaceActor | null = null, sessionExpired = false;
      if (token) {
        try { const a = this.accounts.authenticate(token); viewer = { id: a.id, displayName: a.displayName }; }
        catch (error) { if (!(error instanceof UnauthorizedException)) throw error; sessionExpired = true; }
      }
      const canModerate = this.canModerate(viewer);
      const conditions = ["status NOT IN ('withdrawn','removed')", 'id<?'];
      const parameters: Array<string | number> = [query.before ?? Number.MAX_SAFE_INTEGER];
      if (query.state) { conditions.push('state_id=?'); parameters.push(query.state); }
      for (const key of ['category', 'type', 'condition'] as const) {
        if (query[key]) { conditions.push(`json_extract(payload,'$.${key}')=?`); parameters.push(query[key]); }
      }
      if (query.sport) {
        const filter = marketplaceSportFilters.find(item => item.id === query.sport);
        if (!filter) throw new BadRequestException('El filtro deportivo no es válido.');
        conditions.push(`json_extract(payload,'$.sport') IN (${filter.sports.map(() => '?').join(',')})`); parameters.push(...filter.sports);
      }
      if (query.search) { conditions.push('market_search(payload,?)=1'); parameters.push(query.search); }
      const rows = query.listing ? [] : this.db.prepare(`SELECT payload FROM market_listings WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT 51`).all(...parameters);
      const listings = query.listing ? [this.listing(query.listing)] : rows.slice(0, 50).map(row => this.decode(row, readMarketplaceListing));
      if (listings.some(listing => listing.status === 'removed' && listing.seller.id !== viewer?.id && !canModerate)) throw new NotFoundException('Este anuncio fue retirado por moderación y ya no está disponible.');
      const id = viewer?.id ?? '';
      const favorites = this.db.prepare('SELECT listing_id,created_at FROM market_favorites WHERE account_id=? ORDER BY created_at DESC,listing_id DESC')
        .all(id).map(row => {
          const listingId = this.number(row.listing_id), listing = this.listing(listingId);
          return { listingId, savedAt: new Date(this.number(row.created_at, 0)).toISOString(),
            listing: ['withdrawn', 'removed'].includes(listing.status) ? null : listing };
        });
      const myListings = this.db.prepare('SELECT payload FROM market_listings WHERE seller_id=? ORDER BY id DESC').all(id).map(row => this.decode(row, readMarketplaceListing));
      const orders = this.db.prepare('SELECT payload FROM market_orders WHERE buyer_id=? OR seller_id=? ORDER BY id DESC').all(id, id).map(row => this.decode(row, readMarketplaceOrder));
      const bids = this.db.prepare('SELECT payload FROM market_bids WHERE bidder_id=? ORDER BY id DESC').all(id).map(row => this.decode(row, readMarketplaceBid));
      const conversations = this.db.prepare('SELECT payload FROM market_threads WHERE buyer_id=? OR seller_id=? ORDER BY id DESC').all(id, id).map(row => this.decode(row, readMarketplaceConversation));
      if (query.thread && !conversations.some(thread => thread.id === query.thread)) throw new ForbiddenException('No tienes acceso a esta conversación.');
      const messageRows = query.thread ? this.db.prepare('SELECT payload FROM market_messages WHERE thread_id=? AND id<? ORDER BY id DESC LIMIT 51')
        .all(query.thread, query.beforeMessage ?? Number.MAX_SAFE_INTEGER) : [];
      const reviews = (canModerate ? this.db.prepare("SELECT payload FROM market_reviews ORDER BY status='pending' DESC,id DESC").all() :
        this.db.prepare('SELECT payload FROM market_reviews WHERE author_id=? ORDER BY id DESC').all(id)).map(row => this.decode(row, readMarketplaceReview));
      const reviewListings = canModerate ? [...new Set(reviews.map(review => review.listingId))].map(id => this.listing(id)) : [];
      const auditRows = canModerate ? this.db.prepare('SELECT payload FROM market_audits ORDER BY id DESC').all() :
        this.db.prepare('SELECT a.payload FROM market_audits a JOIN market_listings l ON l.id=a.listing_id WHERE l.seller_id=? ORDER BY a.id DESC').all(id);
      const audits = auditRows.map(row => this.decode(row, readMarketplaceAudit));
      const questionRows = query.listing ? this.db.prepare(`SELECT payload FROM market_questions WHERE listing_id=? AND id<? AND (status='visible' OR author_id=? OR ?=1) ORDER BY id DESC LIMIT 51`)
        .all(query.listing, query.beforeQuestion ?? Number.MAX_SAFE_INTEGER, id, canModerate ? 1 : 0) : [];
      return { mode: 'test', currency: 'USD_DEMO', serverNow: new Date(this.now()).toISOString(), viewer, sessionExpired,
        canModerate, reviews, reviewListings, audits, favorites, walletBalance: viewer ? this.wallet.balance(viewer.id) : null,
        listings, hasMore: rows.length > 50, myListings, orders, bids, conversations,
        messages: messageRows.slice(0, 50).reverse().map(row => this.decode(row, readMarketplaceMessage)), hasOlderMessages: messageRows.length > 50,
        questions: questionRows.slice(0, 50).reverse().map(row => this.decode(row, readMarketplaceQuestion)), hasOlderQuestions: questionRows.length > 50 };
    });
  }
  perform(token: string | undefined, input: unknown): MarketplaceResult {
    this.accounts.authenticate(token);
    if (!record(input) || typeof input.kind !== 'string') throw new BadRequestException('La operación del Marketplace no es válida.');
    const kind = input.kind;
    if (!Object.hasOwn(keys, kind) ||
      Object.keys(input).some(key => !['kind', 'requestId', ...keys[kind]].includes(key)) ||
      typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(input.requestId)) {
      throw new BadRequestException('La operación del Marketplace contiene campos no permitidos o una clave de solicitud inválida.');
    }
    const requestId = input.requestId;
    return this.transaction(() => {
      const a = this.accounts.authenticate(token), actor = { id: a.id, displayName: a.displayName };
      if (kind === 'remove' || kind === 'review-report' || kind === 'hide-question') this.requireModerator(actor);
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = this.db.prepare('SELECT body_hash,result FROM market_commands WHERE actor_id=? AND request_id=?').get(actor.id, requestId);
      if (previous) {
        if (previous.body_hash !== hash) throw new ConflictException('No reutilices una solicitud con datos diferentes.');
        if (typeof previous.result !== 'string') throw new Error('La solicitud guardada es inválida.');
        const result: unknown = JSON.parse(previous.result);
        if (!record(result) || typeof result.notice !== 'string' || typeof result.entityId !== 'number') throw new Error('La respuesta guardada es inválida.');
        return { notice: result.notice, entityId: result.entityId };
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM market_commands WHERE actor_id=? AND created_at>?').get(actor.id, this.now() - 60000)?.count;
      if (typeof count !== 'number') throw new Error('No se pudo comprobar el límite de solicitudes.');
      if (count >= 60) throw new HttpException('Demasiadas operaciones. Espera un minuto.', 429);
      this.settle();
      const result = this.execute(actor, kind, input);
      this.db.prepare('INSERT INTO market_commands VALUES(?,?,?,?,?)').run(actor.id, requestId, hash, this.now(), JSON.stringify(result));
      return result;
    });
  }
  private execute(actor: MarketplaceActor, kind: string, input: Record<string, unknown>): MarketplaceResult {
    const at = new Date(this.now()).toISOString();
    if (kind === 'publish') {
      const fields = this.publicationFields(input);
      if (input.type !== 'sale' && input.type !== 'auction') throw new BadRequestException('La modalidad no es válida.');
      const type = input.type === 'auction' ? 'auction' : 'sale';
      const priceCents = this.number(input.priceCents, 1, marketplaceMaximumCents);
      const stock = this.number(input.stock, 1, type === 'auction' ? 1 : 1000);
      const incrementCents = this.number(input.incrementCents, type === 'auction' ? 1 : 0, type === 'auction' ? marketplaceMaximumCents : 0);
      let endsAt: string | null = null;
      if (type === 'auction') {
        if (typeof input.endsAt !== 'string' || !Number.isFinite(Date.parse(input.endsAt)) ||
          Date.parse(input.endsAt) < this.now() + 60000 || Date.parse(input.endsAt) > this.now() + 30 * 86400000) throw new BadRequestException('La subasta debe cerrar entre un minuto y treinta días a partir de ahora.');
        endsAt = new Date(input.endsAt).toISOString();
      } else if (input.endsAt !== null) throw new BadRequestException('Una venta directa no tiene hora de subasta.');
      const listing: MarketplaceListing = { id: 0, seller: actor, type, ...fields, priceCents, stock, incrementCents, endsAt,
        revision: 0, moderation: null, walletBacked: true,
        currentBidCents: null, bidCount: 0, status: 'active', createdAt: at };
      listing.id = this.number(Number(this.db.prepare("INSERT INTO market_listings(seller_id,status,ends_at,payload) VALUES(?,'active',?,?)")
        .run(actor.id, endsAt ? Date.parse(endsAt) : null, '{}').lastInsertRowid));
      this.storeListing(listing); return { notice: 'Anuncio publicado. No admite cobros reales.', entityId: listing.id };
    }
    if (kind === 'review-report') {
      const id = this.number(input.reviewId), row = this.db.prepare('SELECT payload FROM market_reviews WHERE id=?').get(id);
      if (!row) throw new NotFoundException('El reporte o apelación no existe.');
      const review = this.decode(row, readMarketplaceReview);
      if (review.status !== 'pending') throw new ConflictException('Esta revisión ya tiene una decisión definitiva.');
      const reason = this.text(input.reason, 500), listing = this.listing(review.listingId);
      const decision = (['dismiss', 'remove', 'restore', 'uphold'] as const).find(value => value === input.decision);
      if (!decision || !(review.kind !== 'appeal' ? decision === 'dismiss' || decision === 'remove' : decision === 'restore' || decision === 'uphold')) throw new BadRequestException('La decisión no corresponde a este reporte o apelación.');
      if (decision === 'remove' && review.kind === 'question' && review.questionId) {
        const question = this.question(review.questionId);
        if (question.status !== 'hidden') this.hideQuestion(actor, question, reason, at);
      } else if (decision === 'remove' && review.kind === 'report' && listing.status !== 'removed') this.remove(actor, listing, reason, at);
      if (decision === 'restore') {
        if (listing.status !== 'removed' || !listing.moderation) throw new ConflictException('El anuncio ya no está retirado por moderación.');
        const before = { ...listing };
        listing.status = listing.type === 'auction' ? 'closed' : listing.moderation.previousStatus === 'withdrawn' ? 'withdrawn' : listing.stock ? 'active' : 'closed';
        listing.moderation = null; this.storeListing(listing); this.audit(actor, before, listing, 'restore', reason, at);
      }
      review.status = 'resolved'; review.decision = decision; review.decisionReason = reason; review.reviewerId = actor.id; review.resolvedAt = at;
      this.db.prepare("UPDATE market_reviews SET status='resolved',payload=? WHERE id=?").run(JSON.stringify(review), id);
      return { notice: 'Decisión de moderación guardada con motivo e historial. No se alteraron pedidos ni se movió dinero.', entityId: id };
    }
    if (kind === 'update-order') {
      const id = this.number(input.orderId), row = this.db.prepare('SELECT payload FROM market_orders WHERE id=?').get(id);
      if (!row) throw new NotFoundException('El pedido no existe.');
      const order = this.decode(row, readMarketplaceOrder); this.participant(order, actor);
      const note = input.note === undefined || input.note === '' ? '' : this.text(input.note, 500);
      let status: MarketplaceOrderStatus;
      if (input.status === 'sent' && ['confirmed', 'reserved'].includes(order.status) && actor.id === order.seller.id) status = 'sent';
      else if (input.status === 'delivered' && order.status === 'sent' && actor.id === order.buyer.id) status = 'delivered';
      else if (input.status === 'cancelled' && ['confirmed', 'reserved'].includes(order.status)) {
        status = 'cancelled';
        const listing = this.listing(order.listingId);
        listing.stock = this.number(listing.stock + order.quantity, 0, 1000);
        if (listing.type === 'sale' && listing.status === 'closed') listing.status = 'active';
        this.storeListing(listing);
      } else if (input.status === 'disputed' && ['sent', 'delivered'].includes(order.status) && note) status = 'disputed';
      else throw new ConflictException('No puedes realizar esa transición del pedido. Solo el vendedor registra el envío y el comprador confirma la recepción.');
      if (order.payment === 'held' && status === 'delivered') {
        this.wallet.release(`order:${order.id}`, order.buyer.id, order.seller.id, order.totalCents); order.payment = 'released';
      } else if (order.payment === 'held' && status === 'cancelled') {
        this.wallet.refund(`order:${order.id}`, `cancel:order:${order.id}`); order.payment = 'refunded';
      }
      order.status = status; order.history.push({ status, at, actorId: actor.id, note });
      this.db.prepare('UPDATE market_orders SET payload=? WHERE id=?').run(JSON.stringify(order), id);
      return { notice: status === 'disputed' ? 'Reclamación guardada. Revisión pendiente; no se realizó devolución automática.' : 'Pedido actualizado. La billetera registra el pago o devolución correspondientes.', entityId: id };
    }
    if (kind === 'start-thread') {
      const row = this.db.prepare('SELECT payload FROM market_orders WHERE id=?').get(this.number(input.orderId));
      if (!row) throw new NotFoundException('El pedido no existe. Primero confirma una compra o gana la subasta.');
      const order = this.decode(row, readMarketplaceOrder); this.participant(order, actor);
      return { notice: 'Chat privado del pedido disponible. Solo comprador y vendedor coordinan detalles de pago y entrega.', entityId: this.orderThread(order) };
    }
    if (kind === 'message') {
      const threadId = this.number(input.threadId), row = this.db.prepare('SELECT payload FROM market_threads WHERE id=?').get(threadId);
      if (!row) throw new NotFoundException('La conversación no existe.');
      const thread = this.decode(row, readMarketplaceConversation); this.participant(thread, actor);
      if (thread.orderId === null) throw new ConflictException('Esta consulta anterior se conserva como archivo privado de solo lectura. Las nuevas dudas van en preguntas públicas y los detalles de una compra en su chat de pedido.');
      const recent = this.db.prepare('SELECT created_at FROM market_messages WHERE author_id=? AND created_at>?').get(actor.id, this.now() - 2000);
      if (recent) throw new HttpException('Espera dos segundos antes de enviar otro mensaje.', 429);
      const text = this.text(input.text, 500);
      const id = this.number(Number(this.db.prepare('INSERT INTO market_messages(thread_id,author_id,created_at,payload) VALUES(?,?,?,?)').run(threadId, actor.id, this.now(), '{}').lastInsertRowid));
      this.db.prepare('UPDATE market_messages SET payload=? WHERE id=?').run(JSON.stringify({ id, threadId, author: actor, text, createdAt: at }), id);
      return { notice: 'Mensaje privado enviado.', entityId: threadId };
    }
    if (kind === 'answer' || kind === 'report-question' || kind === 'hide-question') {
      const question = this.question(this.number(input.questionId)), listing = this.listing(question.listingId);
      if (kind === 'hide-question') {
        this.hideQuestion(actor, question, this.text(input.reason, 500), at);
        return { notice: 'Pregunta y respuesta ocultas públicamente; su contenido e historial se conservan para moderación.', entityId: question.id };
      }
      if (listing.status === 'removed' || question.status !== 'visible') throw new ConflictException('La pregunta ya no está disponible públicamente.');
      if (kind === 'answer') {
        if (listing.seller.id !== actor.id) throw new ForbiddenException('Solo el vendedor de este anuncio puede responder la pregunta.');
        if (question.answer) throw new ConflictException('Esta pregunta ya tiene respuesta. El interesado puede publicar otra pregunta.');
        if (listing.status !== 'active') throw new ConflictException('El anuncio ya no admite nuevas respuestas públicas.');
        question.answer = { text: this.publicText(input.text), createdAt: at };
        this.db.prepare('UPDATE market_questions SET payload=? WHERE id=?').run(JSON.stringify(question), question.id);
        return { notice: 'Respuesta pública del vendedor guardada. No se modificó inventario ni se confirmó un pago.', entityId: question.id };
      }
      const reason = this.text(input.reason, 500);
      if (this.db.prepare("SELECT id FROM market_reviews WHERE author_id=? AND kind='question' AND status='pending' AND json_extract(payload,'$.questionId')=?").get(actor.id, question.id)) throw new ConflictException('Ya tienes un reporte pendiente para esta pregunta.');
      this.createReview(listing.id, actor.id, 'question', reason, at, question.id);
      return { notice: 'Reporte de pregunta o respuesta guardado para revisión. No se oculta automáticamente.', entityId: question.id };
    }
    const listing = this.listing(this.number(input.listingId));
    if (kind === 'favorite') {
      if (typeof input.saved !== 'boolean') throw new BadRequestException('Indica si deseas guardar o quitar el favorito.');
      if (input.saved) {
        if (['withdrawn', 'removed'].includes(listing.status)) throw new ConflictException('El anuncio ya no está disponible para guardarlo en favoritos.');
        this.db.prepare('INSERT INTO market_favorites(account_id,listing_id,created_at) VALUES(?,?,?) ON CONFLICT(account_id,listing_id) DO NOTHING')
          .run(actor.id, listing.id, this.now());
      } else this.db.prepare('DELETE FROM market_favorites WHERE account_id=? AND listing_id=?').run(actor.id, listing.id);
      return { notice: input.saved ? 'Anuncio guardado en tus favoritos. No se compró ni se bloqueó inventario.' : 'Anuncio quitado de tus favoritos.', entityId: listing.id };
    }
    if (kind === 'question') {
      if (listing.status !== 'active') throw new ConflictException('El anuncio ya no admite nuevas preguntas públicas.');
      if (listing.seller.id === actor.id) throw new ForbiddenException('Como vendedor responde las preguntas de los interesados.');
      if (this.db.prepare('SELECT id FROM market_questions WHERE author_id=? AND created_at>?').get(actor.id, this.now() - 2000)) throw new HttpException('Espera dos segundos antes de publicar otra pregunta.', 429);
      const text = this.publicText(input.text);
      const id = this.number(Number(this.db.prepare("INSERT INTO market_questions(listing_id,author_id,status,created_at,payload) VALUES(?,?,'visible',?,'{}')").run(listing.id, actor.id, this.now()).lastInsertRowid));
      const question: MarketplaceQuestion = { id, listingId: listing.id, author: actor, text, createdAt: at, answer: null, status: 'visible', moderation: null };
      this.db.prepare('UPDATE market_questions SET payload=? WHERE id=?').run(JSON.stringify(question), id);
      return { notice: 'Pregunta pública publicada. No se descontó stock ni se creó un pedido.', entityId: id };
    }
    if (kind === 'edit') {
      if (actor.id !== listing.seller.id) throw new ForbiddenException('Solo el propietario puede editar el anuncio.');
      if (this.number(input.revision, 0) !== listing.revision) throw new ConflictException('El anuncio cambió. Actualiza antes de guardar para no sobrescribir inventario ni pujas.');
      if (listing.status === 'removed' || listing.type === 'auction' && (listing.status !== 'active' || listing.bidCount > 0)) throw new ConflictException('No se editan anuncios retirados por moderación ni subastas cerradas o con pujas.');
      const fields = this.publicationFields(input);
      const priceCents = this.number(input.priceCents, 1, marketplaceMaximumCents);
      const stock = this.number(input.stock, listing.type === 'auction' ? 1 : 0, listing.type === 'auction' ? 1 : 1000);
      const incrementCents = this.number(input.incrementCents, listing.type === 'auction' ? 1 : 0, listing.type === 'auction' ? marketplaceMaximumCents : 0);
      const reserved = this.db.prepare('SELECT payload FROM market_orders WHERE listing_id=?').all(listing.id)
        .map(row => this.decode(row, readMarketplaceOrder)).filter(order => ['confirmed', 'reserved'].includes(order.status)).reduce((sum, order) => sum + order.quantity, 0);
      if (listing.type === 'sale' && stock + reserved > 1000) throw new ConflictException('El inventario disponible más los pedidos pendientes no puede superar 1000 unidades.');
      const before = { ...listing };
      Object.assign(listing, fields, { priceCents, stock, incrementCents });
      if (listing.type === 'sale' && listing.status !== 'withdrawn') listing.status = stock ? 'active' : 'closed';
      this.storeListing(listing); this.audit(actor, before, listing, 'edit', 'Edición del propietario. No modifica pedidos existentes ni la fecha fija de cierre.', at);
      return { notice: 'Anuncio actualizado. El stock es disponible, sin incluir pedidos pendientes; los pedidos anteriores conservan sus condiciones.', entityId: listing.id };
    }
    if (kind === 'remove') {
      this.remove(actor, listing, this.text(input.reason, 500), at);
      return { notice: 'Anuncio retirado por moderación. Se detienen compras y pujas; su historial y los pedidos existentes se conservan.', entityId: listing.id };
    }
    if (kind === 'report') {
      const reason = this.text(input.reason, 500);
      if (listing.status === 'removed' && actor.id !== listing.seller.id && !this.canModerate(actor)) throw new NotFoundException('El anuncio fue retirado por moderación.');
      if (this.db.prepare("SELECT id FROM market_reviews WHERE listing_id=? AND author_id=? AND kind='report' AND status='pending'").get(listing.id, actor.id)) throw new ConflictException('Ya tienes un reporte pendiente para este anuncio. Puedes consultar su estado.');
      this.createReview(listing.id, actor.id, 'report', reason, at);
      return { notice: 'Reporte guardado para revisión pendiente. No se ocultó automáticamente el anuncio.', entityId: listing.id };
    }
    if (kind === 'appeal') {
      if (actor.id !== listing.seller.id) throw new ForbiddenException('Solo el propietario puede apelar el retiro del anuncio.');
      if (listing.status !== 'removed') throw new ConflictException('Solo se apela un anuncio retirado por moderación.');
      if (this.db.prepare("SELECT id FROM market_reviews WHERE listing_id=? AND kind='appeal' AND status='pending'").get(listing.id)) throw new ConflictException('Este anuncio ya tiene una apelación pendiente.');
      const id = this.createReview(listing.id, actor.id, 'appeal', this.text(input.reason, 500), at);
      return { notice: 'Apelación guardada para revisión. No reactiva automáticamente el anuncio ni una subasta detenida.', entityId: id };
    }
    if (kind === 'withdraw') {
      if (actor.id !== listing.seller.id) throw new ForbiddenException('Solo el propietario retira su anuncio.');
      if (listing.status !== 'active' || listing.type === 'auction' && listing.bidCount > 0) throw new ConflictException('No se retira un anuncio cerrado ni una subasta con pujas.');
      const before = { ...listing }; listing.status = 'withdrawn'; this.storeListing(listing);
      this.audit(actor, before, listing, 'withdraw', 'Retiro voluntario del propietario.', at);
      return { notice: 'Anuncio retirado. Los pedidos y conversaciones existentes se conservan.', entityId: listing.id };
    }
    if (actor.id === listing.seller.id) throw new ForbiddenException('No puedes comprar ni pujar por tus propios anuncios.');
    if (listing.status !== 'active') throw new ConflictException('El anuncio ya no está disponible.');
    if (kind === 'buy') {
      if (listing.type !== 'sale') throw new ConflictException('Este anuncio solo admite pujas.');
      const quantity = this.number(input.quantity, 1, 1000);
      if (quantity > listing.stock) throw new ConflictException('No quedan suficientes unidades. Actualiza el catálogo.');
      const id = this.order(listing, actor, quantity, listing.priceCents, at);
      listing.stock -= quantity; if (!listing.stock) listing.status = 'closed'; this.storeListing(listing);
      return { notice: 'Compra confirmada: saldo retenido y chat privado creado. El vendedor recibe el saldo al confirmar recepción.', entityId: id };
    }
    if (kind === 'bid') {
      if (listing.type !== 'auction' || !listing.endsAt || Date.parse(listing.endsAt) <= this.now()) throw new ConflictException('La subasta no admite pujas.');
      if (!listing.walletBacked) throw new ConflictException('Esta subasta anterior conserva su cierre e historial sin cargos retroactivos y no admite nuevas pujas.');
      const amount = this.number(input.amountCents, 1, marketplaceMaximumCents);
      if (amount < minimumMarketplaceBid(listing)) throw new ConflictException(`La puja mínima actual es ${(minimumMarketplaceBid(listing) / 100).toFixed(2)} USD. Actualiza la subasta.`);
      const id = this.number(Number(this.db.prepare('INSERT INTO market_bids(listing_id,bidder_id,bidder_name,amount,created_at,payload) VALUES(?,?,?,?,?,?)').run(listing.id, actor.id, actor.displayName, amount, this.now(), '{}').lastInsertRowid));
      this.db.prepare('UPDATE market_bids SET payload=? WHERE id=?').run(JSON.stringify({ id, listingId: listing.id, title: listing.title, amountCents: amount, createdAt: at }), id);
      if (listing.currentBidCents !== null) this.wallet.refund(`auction:${listing.id}`, `outbid:${id}`);
      this.wallet.retain(`auction:${listing.id}`, actor.id, amount, `bid:${id}`);
      listing.currentBidCents = amount; listing.bidCount++; this.storeListing(listing);
      return { notice: 'Puja registrada con saldo retenido. La retención del anterior líder se devuelve inmediatamente.', entityId: id };
    }
    throw new BadRequestException('La operación no está disponible.');
  }
}
