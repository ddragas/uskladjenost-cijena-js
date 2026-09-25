/**
 * The Usklađenost cijena API from JavaScript (Node 18+ or a browser with fetch).
 *
 *   import { Client } from '@uskladjenost-cijena/sdk';
 *   const api = new Client(process.env.PC_TOKEN);
 *   const item = await api.items.upsert('SKU-1', { merchant_id, kind: 'product', name: 'Deterdžent 3 kg' });
 *   await api.prices.recordByExternal('SKU-1', { regular_price_minor: 1250 }, { location_code: 'PU-01' });
 *   const { data } = await api.compliance.byExternal('SKU-1', { location_code: 'PU-01' });
 *   console.log(data.anchor_display.label);
 *
 * Every method resolves to the decoded JSON body plus `_status`; every refusal
 * rejects with an ApiError carrying the API's code, the HTTP status and details.
 */

export const VERSION = '1.0.0';

export class ApiError extends Error {
  constructor(code, message, status, details = {}) {
    super(`${code} (${status}): ${message}`);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.apiMessage = message;
  }
}

const clean = (o = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const enc = encodeURIComponent;

export class Client {
  /**
   * @param {string} token pc_live_… or pc_test_…
   * @param {{ baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} [options]
   */
  constructor(token, options = {}) {
    if (!token) throw new Error('An API token is required.');
    this.token = token;
    this.baseUrl = (options.baseUrl || 'https://uskladjenost-cijena.com').replace(/\/+$/, '');
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.merchants = new Merchants(this);
    this.items = new Items(this);
    this.prices = new Prices(this);
    this.offers = new Offers(this);
    this.compliance = new Compliance(this);
    this.publications = new Publications(this);
    this.imports = new Imports(this);
    this.webhooks = new Webhooks(this);
  }

  ping() {
    return this.request('GET', '/api/v1/ping');
  }

  /**
   * One call. `query` becomes the query string, `json` the body, `body` a raw body (FormData).
   * @returns {Promise<any>}
   */
  async request(method, path, { query, json, body, headers } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(clean(query))) url.searchParams.set(k, String(v));
    const init = {
      method,
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'User-Agent': `uskladjenost-cijena-js/${VERSION}`, ...clean(headers) },
    };
    if (json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    if (controller) init.signal = controller.signal;
    let response;
    try {
      response = await this.fetch(url, init);
    } catch (e) {
      throw new ApiError('transport', e.message || String(e), 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError('malformed', 'The API answered with something that is not JSON.', response.status);
      }
    }
    if (!response.ok) {
      const error = data && typeof data.error === 'object' ? data.error : {};
      const fallback = { 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 429: 'rate_limited' }[response.status] || `http_${response.status}`;
      throw new ApiError(error.code || fallback, error.message || (data && data.message) || `HTTP ${response.status}`, response.status, error.details || (data && data.errors) || {});
    }
    if (data === null) return { _status: response.status };
    if (typeof data !== 'object' || Array.isArray(data)) data = { data };
    data._status = response.status;
    return data;
  }
}

class Resource {
  constructor(client) {
    this.client = client;
  }
}

/** Merchants, their locations and sales channels. Scopes catalog:read / catalog:write. */
export class Merchants extends Resource {
  list() { return this.client.request('GET', '/api/v1/merchants'); }
  upsert(externalKey, data) { return this.client.request('PUT', `/api/v1/merchants/${enc(externalKey)}`, { json: data }); }
  locations(merchantId) { return this.client.request('GET', `/api/v1/merchants/${enc(merchantId)}/locations`); }
  upsertLocation(merchantId, code, data) { return this.client.request('PUT', `/api/v1/merchants/${enc(merchantId)}/locations/${enc(code)}`, { json: data }); }
  channels(merchantId) { return this.client.request('GET', `/api/v1/merchants/${enc(merchantId)}/channels`); }
  upsertChannel(merchantId, code, data) { return this.client.request('PUT', `/api/v1/merchants/${enc(merchantId)}/channels/${enc(code)}`, { json: data }); }
}

/** The catalogue, by your own ids. Scopes catalog:read / catalog:write. */
export class Items extends Resource {
  /** One page. Filters: merchant_id, kind, active, q, updated_since, cursor, limit. */
  list(filters = {}) { return this.client.request('GET', '/api/v1/items', { query: filters }); }
  /** Every item, page after page. */
  async *all(filters = {}) {
    let cursor;
    do {
      const page = await this.list({ ...filters, cursor });
      for (const item of page.data || []) yield item;
      cursor = page.next_cursor || undefined;
    } while (cursor);
  }
  get(externalId, { merchant_id, source_system } = {}) { return this.client.request('GET', `/api/v1/items/${enc(externalId)}`, { query: { merchant_id, source_system } }); }
  /** Create or update by your own id; the answer carries offer_id. */
  upsert(externalId, data) { return this.client.request('PUT', `/api/v1/items/${enc(externalId)}`, { json: data }); }
  /** Up to 500 rows, each an item plus external_id. */
  bulk(items) { return this.client.request('POST', '/api/v1/items/bulk', { json: { items: [...items] } }); }
}

const idem = (key) => (key ? { 'Idempotency-Key': key } : undefined);

/** Price events: append-only, idempotent. Scopes prices:write / prices:read. */
export class Prices extends Resource {
  /** Record a price on an offer: regular_price_minor, effective_price_minor?, price_from?, price_to_minor?, valid_from?, ... */
  record(offerId, event, idempotencyKey) { return this.client.request('POST', `/api/v1/offers/${enc(offerId)}/price-events`, { json: event, headers: idem(idempotencyKey) }); }
  /** Record a price by your own product id; scope may carry merchant_id, source_system, location_code, channel_code. */
  recordByExternal(externalId, event, scope = {}, idempotencyKey) { return this.client.request('POST', `/api/v1/prices/by-external/${enc(externalId)}`, { json: { ...event, ...clean(scope) }, headers: idem(idempotencyKey) }); }
  /** Up to 1000 rows, each an event plus offer_id (and optionally idempotency_key). */
  bulk(events) { return this.client.request('POST', '/api/v1/price-events/bulk', { json: { events: [...events] } }); }
  /** The offer's history, newest first: data and next_cursor. */
  history(offerId, { since, cursor, limit } = {}) { return this.client.request('GET', `/api/v1/offers/${enc(offerId)}/price-events`, { query: { since, cursor, limit } }); }
}

/** One offer: the item, the scope, the price in force. Scope prices:read. */
export class Offers extends Resource {
  get(offerId) { return this.client.request('GET', `/api/v1/offers/${enc(offerId)}`); }
}

/** What to print next to a price. Scope compliance:read. */
export class Compliance extends Resource {
  forOffer(offerId, { at, locale } = {}) { return this.client.request('GET', `/api/v1/offers/${enc(offerId)}/compliance`, { query: { at, locale } }); }
  /** By your own product id; scope: merchant_id, source_system, location_code, channel_code, at, locale. */
  byExternal(externalId, scope = {}) { return this.client.request('GET', `/api/v1/compliance/by-external/${enc(externalId)}`, { query: scope }); }
  /** Decisions for up to 500 offers. */
  query(offerIds, { at, locale } = {}) { return this.client.request('POST', '/api/v1/compliance/query', { json: clean({ offer_ids: [...offerIds], at, locale }) }); }
  /** One page of every active offer's decision. Filters: merchant_id, location_id, sales_channel_id, kind, needs_review, updated_since, cursor, limit. */
  list(filters = {}) { return this.client.request('GET', '/api/v1/compliance', { query: filters }); }
  async *all(filters = {}) {
    let cursor;
    do {
      const page = await this.list({ ...filters, cursor });
      for (const row of page.data || []) yield row;
      cursor = page.next_cursor || undefined;
    } while (cursor);
  }
}

/** The public price lists. Scopes publications:read / publications:manage. */
export class Publications extends Resource {
  scopes() { return this.client.request('GET', '/api/v1/publication-scopes'); }
  status(scopeId) { return this.client.request('GET', `/api/v1/publication-scopes/${enc(scopeId)}/status`); }
  publish(scopeId) { return this.client.request('POST', `/api/v1/publication-scopes/${enc(scopeId)}/publish`); }
}

/** CSV / XLSX uploads with a dry run. Scope imports:write. */
export class Imports extends Resource {
  /**
   * @param {string} merchantId
   * @param {'items_prices'|'historical_prices'|'anchors'|'locations'|'availability'} type
   * @param {Blob|string|Uint8Array} file
   * @param {string} filename
   * @param {{ on_conflict?: 'skip'|'update', dry_run?: boolean }} [options]
   */
  upload(merchantId, type, file, filename, options = {}) {
    const form = new FormData();
    form.set('merchant_id', merchantId);
    form.set('type', type);
    form.set('file', file instanceof Blob ? file : new Blob([file]), filename);
    if (options.on_conflict) form.set('on_conflict', options.on_conflict);
    if (options.dry_run !== undefined) form.set('dry_run', options.dry_run ? '1' : '0');
    return this.client.request('POST', '/api/v1/imports', { body: form });
  }
  get(importId) { return this.client.request('GET', `/api/v1/imports/${Number(importId)}`); }
}

/** Webhook endpoints. Scope webhooks:manage. Verify deliveries with verifySignature / webhookEvent. */
export class Webhooks extends Resource {
  list() { return this.client.request('GET', '/api/v1/webhooks'); }
  /** Add an endpoint; the answer carries the secret once. */
  create(url, events, description) { return this.client.request('POST', '/api/v1/webhooks', { json: clean({ url, events: [...events], description }) }); }
  test(endpointId) { return this.client.request('POST', `/api/v1/webhooks/${enc(endpointId)}/test`); }
  delete(endpointId) { return this.client.request('DELETE', `/api/v1/webhooks/${enc(endpointId)}`); }
}

// ---------------------------------------------------------------- webhook signatures
// X-PC-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body) with X-PC-Timestamp.

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (s) => (typeof s === 'string' ? new TextEncoder().encode(s) : s);

export async function signWebhook(secret, timestamp, body) {
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = new Uint8Array([...bytes(`${timestamp}.`), ...bytes(body)]);
  return 'v1=' + hex(await crypto.subtle.sign('HMAC', key, payload));
}

const equal = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export async function verifyWebhook(secret, signatureHeader, timestampHeader, body, { toleranceSeconds = 300, now } = {}) {
  if (!/^\d+$/.test(String(timestampHeader || ''))) return false;
  const current = now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(current - Number(timestampHeader)) > toleranceSeconds) return false;
  const expected = await signWebhook(secret, String(timestampHeader), body);
  return String(signatureHeader || '').split(',').some((candidate) => equal(expected, candidate.trim()));
}

/** The verified event from a request's headers (object or Headers) and raw body; throws when the signature does not hold. */
export async function webhookEvent(secret, headers, body, options) {
  const get = (name) => (typeof headers.get === 'function' ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()] ?? Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]) || '';
  if (!(await verifyWebhook(secret, get('X-PC-Signature'), get('X-PC-Timestamp'), body, options))) {
    throw new Error('The webhook signature does not hold.');
  }
  const data = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body));
  if (!data || typeof data !== 'object') return {};
  data.event ??= get('X-PC-Event') || undefined;
  data.event_id ??= get('X-PC-Event-Id') || undefined;
  return data;
}
