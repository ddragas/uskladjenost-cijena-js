import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ApiError, Client } from '../src/index.js';

// A small real server: every request is recorded, the next answer is scripted.
const calls = [];
const answers = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  calls.push({ method: req.method, url: req.url, headers: req.headers, body });
  const [status, payload] = answers.shift() || [200, {}];
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload === null ? '' : JSON.stringify(payload));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = new Client('pc_test_abc', { baseUrl: `http://127.0.0.1:${server.address().port}/` });
const last = () => calls[calls.length - 1];
const answer = (status, payload) => answers.push([status, payload]);
after(() => server.close());
server.unref();

test('the token and the user agent travel with every call', async () => {
  answer(200, { data: { pong: true, tenant: 'Firma' } });
  assert.equal((await api.ping()).data.tenant, 'Firma');
  assert.equal(last().headers.authorization, 'Bearer pc_test_abc');
  assert.match(last().headers['user-agent'], /^uskladjenost-cijena-js\//);
  assert.equal(last().url, '/api/v1/ping');
});

test('items are written and read by the callers ids', async () => {
  answer(201, { data: { id: 'i1', offer_id: 'o1' } });
  const r = await api.items.upsert('SKU/1', { merchant_id: 'm1', kind: 'product', name: 'Deterdžent' });
  assert.equal(r.data.offer_id, 'o1');
  assert.equal(r._status, 201);
  assert.equal(last().method, 'PUT');
  assert.equal(last().url, '/api/v1/items/SKU%2F1');
  assert.equal(JSON.parse(last().body).name, 'Deterdžent');

  answer(200, { data: [{ id: 'i1' }], next_cursor: 'i1' });
  answer(200, { data: [{ id: 'i2' }], next_cursor: null });
  const ids = [];
  for await (const item of api.items.all({ merchant_id: 'm1', limit: 1 })) ids.push(item.id);
  assert.deepEqual(ids, ['i1', 'i2']);
  assert.equal(last().url, '/api/v1/items?merchant_id=m1&limit=1&cursor=i1');

  answer(200, { data: { id: 'i1' } });
  await api.items.get('SKU-1', { merchant_id: 'm1' });
  assert.equal(last().url, '/api/v1/items/SKU-1?merchant_id=m1');

  answer(200, { data: [], summary: { created: 2 } });
  assert.equal((await api.items.bulk([{ external_id: 'a', name: 'A' }, { external_id: 'b', name: 'B' }])).summary.created, 2);
});

test('prices go in by offer or by the callers id', async () => {
  answer(201, { data: { id: 7 } });
  await api.prices.record('o1', { regular_price_minor: 1250 }, 'k-1');
  assert.equal(last().headers['idempotency-key'], 'k-1');
  assert.equal(last().url, '/api/v1/offers/o1/price-events');

  answer(201, { data: { id: 8, scope: { location_code: 'PU-01' } } });
  const r = await api.prices.recordByExternal('SKU-1', { regular_price_minor: 1250, effective_price_minor: 990 }, { location_code: 'PU-01', merchant_id: undefined });
  assert.equal(r.data.scope.location_code, 'PU-01');
  assert.deepEqual(JSON.parse(last().body), { regular_price_minor: 1250, effective_price_minor: 990, location_code: 'PU-01' });
  assert.equal(last().headers['idempotency-key'], undefined);

  answer(200, { data: [{ id: 8 }, { id: 7 }], next_cursor: null });
  assert.equal((await api.prices.history('o1', { since: '2026-09-01T00:00:00Z', limit: 50 })).data.length, 2);
  assert.equal(last().url, '/api/v1/offers/o1/price-events?since=2026-09-01T00%3A00%3A00Z&limit=50');

  answer(200, { summary: { created: 1 } });
  await api.prices.bulk([{ offer_id: 'o1', regular_price_minor: 100 }]);
  assert.equal(last().url, '/api/v1/price-events/bulk');
});

test('compliance, publications, imports and webhooks', async () => {
  answer(200, { data: { anchor_display: { label: 'Cijena na dan 10. 9. 2026.: 22,00 €' } } });
  assert.match((await api.compliance.byExternal('SKU-1', { location_code: 'PU-01', locale: 'hr' })).data.anchor_display.label, /22,00/);
  assert.equal(last().url, '/api/v1/compliance/by-external/SKU-1?location_code=PU-01&locale=hr');

  answer(200, { data: [] });
  await api.compliance.query(['o1', 'o2'], { locale: 'en' });
  assert.deepEqual(JSON.parse(last().body), { offer_ids: ['o1', 'o2'], locale: 'en' });

  answer(200, { data: [{ scope_id: 's1', stale: false }] });
  assert.equal((await api.publications.scopes()).data[0].stale, false);
  answer(202, null);
  assert.equal((await api.publications.publish('s1'))._status, 202);

  answer(202, { data: { id: 5, status: 'checked', preview: { new: 3 } } });
  const imp = await api.imports.upload('m1', 'items_prices', 'sifra;naziv;cijena\nA;Artikl;1,00\n', 'cjenik.csv', { dry_run: true, on_conflict: 'update' });
  assert.equal(imp.data.preview.new, 3);
  assert.match(last().headers['content-type'], /multipart\/form-data/);
  assert.match(last().body, /name="dry_run"\r\n\r\n1\r\n/);
  assert.match(last().body, /filename="cjenik.csv"/);

  answer(201, { data: { id: 'w1', secret: 'whsec_x' } });
  assert.equal((await api.webhooks.create('https://shop.test/hook', ['publication.succeeded'])).data.secret, 'whsec_x');
  answer(204, null);
  assert.equal((await api.webhooks.delete('w1'))._status, 204);
  assert.equal(last().method, 'DELETE');
});

test('a refusal becomes an ApiError with the APIs code and details', async () => {
  answer(422, { error: { code: 'validation', message: 'The item could not be saved.', details: { name: ['Missing.'] } } });
  await assert.rejects(api.items.upsert('x', {}), (e) => e instanceof ApiError && e.code === 'validation' && e.status === 422 && e.details.name[0] === 'Missing.');
  answer(403, { error: { code: 'insufficient_scope', message: 'This token lacks the prices:write scope.' } });
  await assert.rejects(api.prices.record('o1', { regular_price_minor: 1 }), /prices:write/);
});
