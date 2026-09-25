export const VERSION: string;

export type Json = Record<string, any>;

export class ApiError extends Error {
  code: string;
  status: number;
  details: Json;
  apiMessage: string;
}

export interface ClientOptions { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }
export interface RequestOptions { query?: Json; json?: Json; body?: BodyInit; headers?: Record<string, string> }

export type ItemKind = 'product' | 'service' | 'price_component';
export interface ItemInput { merchant_id: string; kind: ItemKind; name: string; canonical_key?: string; sku?: string; description?: string; category?: string; fmcg_category?: 'food' | 'beverages' | 'cosmetics' | 'cleaning' | 'toiletries' | 'household'; brand?: string; unit_of_measure?: string; barcode?: string; active?: boolean; first_offered_on?: string; location_code?: string; channel_code?: string; platform_role?: 'principal' | 'agent' | 'marketplace'; audience?: 'b2c' | 'b2b' | 'b2g'; is_available?: boolean; metadata?: Json }
export interface PriceEventInput { regular_price_minor: number; effective_price_minor?: number; price_from?: boolean; price_to_minor?: number | null; currency?: string; tax_inclusive?: boolean; valid_from?: string; valid_to?: string; event_type?: 'create' | 'change' | 'correction' | 'import'; special_sale?: { active?: boolean; name?: string }; source_event_id?: string; payload?: Json }
export interface Scope { merchant_id?: string; source_system?: string; location_code?: string; channel_code?: string }
export interface ComplianceScope extends Scope { at?: string; locale?: 'hr' | 'en' }

export class Merchants {
  list(): Promise<Json>;
  upsert(externalKey: string, data: Json): Promise<Json>;
  locations(merchantId: string): Promise<Json>;
  upsertLocation(merchantId: string, code: string, data: Json): Promise<Json>;
  channels(merchantId: string): Promise<Json>;
  upsertChannel(merchantId: string, code: string, data: Json): Promise<Json>;
}
export class Items {
  list(filters?: { merchant_id?: string; kind?: ItemKind; active?: boolean; q?: string; updated_since?: string; cursor?: string; limit?: number }): Promise<Json>;
  all(filters?: Json): AsyncGenerator<Json>;
  get(externalId: string, options?: { merchant_id?: string; source_system?: string }): Promise<Json>;
  upsert(externalId: string, data: ItemInput): Promise<Json>;
  bulk(items: Array<ItemInput & { external_id: string }>): Promise<Json>;
}
export class Prices {
  record(offerId: string, event: PriceEventInput, idempotencyKey?: string): Promise<Json>;
  recordByExternal(externalId: string, event: PriceEventInput, scope?: Scope, idempotencyKey?: string): Promise<Json>;
  bulk(events: Array<PriceEventInput & { offer_id: string; idempotency_key?: string }>): Promise<Json>;
  history(offerId: string, options?: { since?: string; cursor?: number; limit?: number }): Promise<Json>;
}
export class Offers { get(offerId: string): Promise<Json> }
export class Compliance {
  forOffer(offerId: string, options?: { at?: string; locale?: 'hr' | 'en' }): Promise<Json>;
  byExternal(externalId: string, scope?: ComplianceScope): Promise<Json>;
  query(offerIds: string[], options?: { at?: string; locale?: 'hr' | 'en' }): Promise<Json>;
  list(filters?: Json): Promise<Json>;
  all(filters?: Json): AsyncGenerator<Json>;
}
export class Publications { scopes(): Promise<Json>; status(scopeId: string): Promise<Json>; publish(scopeId: string): Promise<Json> }
export class Imports {
  upload(merchantId: string, type: 'items_prices' | 'historical_prices' | 'anchors' | 'locations' | 'availability', file: Blob | string | Uint8Array, filename: string, options?: { on_conflict?: 'skip' | 'update'; dry_run?: boolean }): Promise<Json>;
  get(importId: number): Promise<Json>;
}
export class Webhooks { list(): Promise<Json>; create(url: string, events: string[], description?: string): Promise<Json>; test(endpointId: string): Promise<Json>; delete(endpointId: string): Promise<Json> }

export class Client {
  constructor(token: string, options?: ClientOptions);
  merchants: Merchants; items: Items; prices: Prices; offers: Offers; compliance: Compliance; publications: Publications; imports: Imports; webhooks: Webhooks;
  ping(): Promise<Json>;
  request(method: string, path: string, options?: RequestOptions): Promise<Json>;
}

export function signWebhook(secret: string, timestamp: string | number, body: string | Uint8Array): Promise<string>;
export function verifyWebhook(secret: string, signatureHeader: string, timestampHeader: string, body: string | Uint8Array, options?: { toleranceSeconds?: number; now?: number }): Promise<boolean>;
export function webhookEvent(secret: string, headers: Headers | Record<string, string>, body: string | Uint8Array, options?: { toleranceSeconds?: number; now?: number }): Promise<Json>;
