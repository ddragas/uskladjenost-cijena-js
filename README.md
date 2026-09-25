# Usklađenost cijena – JavaScript / TypeScript SDK

JavaScript klijent (Node 18+ ili preglednik s `fetch`) za API servisa [Usklađenost cijena](https://uskladjenost-cijena.com): sidrene cijene i javni strojno čitljiv cjenik po NN 101/2026. Pokriva cijeli API i provjeru potpisa webhook isporuka, bez ovisnosti. Tipovi za TypeScript su uključeni.

```bash
npm install uskladjenost-cijena
```

## Brzi početak

```js
import { Client } from 'uskladjenost-cijena';

const api = new Client(process.env.PC_TOKEN);

// 1. Artikl po vašoj šifri (catalog:write); odgovor nosi offer_id
const item = await api.items.upsert('SKU-1', { merchant_id, kind: 'product', name: 'Deterdžent 3 kg', barcode: '3859000000001', fmcg_category: 'cleaning' });

// 2. Cijena po vašoj šifri, bez offer_id-a (prices:write); iznosi u centima
await api.prices.recordByExternal('SKU-1', { regular_price_minor: 1250, effective_price_minor: 990 }, { location_code: 'PU-01' }, 'order-42-line-1');

// 3. Što ispisati uz cijenu (compliance:read)
const { data } = await api.compliance.byExternal('SKU-1', { location_code: 'PU-01' });
console.log(data.anchor_display.label); // "Cijena na dan 10. 9. 2026.: 12,50 €" ili null
```

## Sve metode

| Resurs | Metoda | Poziv | Opseg |
|---|---|---|---|
| — | `ping()` | `GET /api/v1/ping` | — |
| `merchants` | `list()` | `GET /merchants` | catalog:read |
| | `upsert(key, data)` | `PUT /merchants/{key}` | catalog:write |
| | `locations(merchantId)` / `channels(merchantId)` | `GET /merchants/{id}/locations` / `channels` | catalog:read |
| | `upsertLocation(merchantId, code, data)` / `upsertChannel(...)` | `PUT /merchants/{id}/locations/{code}` | catalog:write |
| `items` | `list(filters)` / `all(filters)` (async iterator) | `GET /items` (kursor) | catalog:read |
| | `get(externalId, { merchant_id, source_system })` | `GET /items/{id}` | catalog:read |
| | `upsert(externalId, data)` / `bulk(items)` | `PUT /items/{id}` / `POST /items/bulk` | catalog:write |
| `prices` | `record(offerId, event, idempotencyKey?)` | `POST /offers/{id}/price-events` | prices:write |
| | `recordByExternal(externalId, event, scope?, idempotencyKey?)` | `POST /prices/by-external/{id}` | prices:write |
| | `bulk(events)` | `POST /price-events/bulk` | prices:write |
| | `history(offerId, { since, cursor, limit })` | `GET /offers/{id}/price-events` | prices:read |
| `offers` | `get(offerId)` | `GET /offers/{id}` | prices:read |
| `compliance` | `forOffer(offerId, { at, locale })` | `GET /offers/{id}/compliance` | compliance:read |
| | `byExternal(externalId, scope)` | `GET /compliance/by-external/{id}` | compliance:read |
| | `query(offerIds, { at, locale })` | `POST /compliance/query` | compliance:read |
| | `list(filters)` / `all(filters)` | `GET /compliance` | compliance:read |
| `publications` | `scopes()` / `status(scopeId)` | `GET /publication-scopes` | publications:read |
| | `publish(scopeId)` | `POST /publication-scopes/{id}/publish` | publications:manage |
| `imports` | `upload(merchantId, type, file, filename, { on_conflict, dry_run })` | `POST /imports` | imports:write |
| | `get(importId)` | `GET /imports/{id}` | imports:write |
| `webhooks` | `list()` / `create(url, events, description?)` / `test(id)` / `delete(id)` | `/webhooks` | webhooks:manage |

Svaka metoda vraća `Promise` s dekodiranim JSON-om (`data`, `next_cursor`, `summary`…) plus `_status`. Odbijanje API-ja je `ApiError` s `code` (npr. `validation`, `not_found`, `ambiguous`, `insufficient_scope`), `status` i `details`.

## Webhookovi

```js
import { webhookEvent } from 'uskladjenost-cijena';

// Express: app.post('/hook', express.raw({ type: '*/*' }), async (req, res) => { ... })
const event = await webhookEvent(secret, req.headers, req.body); // baca ako potpis ne drži
if (event.event === 'publication.failed') { /* ... */ }
```

## Razvoj

```bash
npm test
```

Dokumentacija API-ja: `https://uskladjenost-cijena.com/api/docs` i `/api/swagger`. Licenca MIT, © Info Media d.o.o.

## Ostali SDK-ovi i dodaci

Ista obitelj za isti API, svaki u svom repozitoriju:

- [uskladjenost-cijena-php](https://github.com/ddragas/uskladjenost-cijena-php) – PHP SDK (Composer `infomedia/uskladjenost-cijena-php`)
- [uskladjenost-cijena-python](https://github.com/ddragas/uskladjenost-cijena-python) – Python SDK (`uskladjenost-cijena`)
- [uskladjenost-cijena-woocommerce](https://github.com/ddragas/uskladjenost-cijena-woocommerce) – WooCommerce dodatak
- [uskladjenost-cijena-shopify](https://github.com/ddragas/uskladjenost-cijena-shopify) – Shopify custom app
- [uskladjenost-cijena-prestashop](https://github.com/ddragas/uskladjenost-cijena-prestashop) – PrestaShop 8 modul
