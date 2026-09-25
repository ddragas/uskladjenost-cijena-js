import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhook, verifyWebhook, webhookEvent } from '../src/index.js';

test('a fresh delivery verifies and a stale or forged one does not', async () => {
  const body = '{"event":"publication.succeeded","data":{"scope_id":"s1"}}';
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await signWebhook('whsec_x', ts, body);
  assert.match(sig, /^v1=[0-9a-f]{64}$/);
  assert.equal(await verifyWebhook('whsec_x', sig, ts, body), true);
  assert.equal(await verifyWebhook('whsec_x', 'v1=deadbeef,' + sig, ts, body), true);
  assert.equal(await verifyWebhook('whsec_y', sig, ts, body), false);
  assert.equal(await verifyWebhook('whsec_x', sig, ts, body + ' '), false);
  assert.equal(await verifyWebhook('whsec_x', sig, String(Number(ts) - 301), body), false);
  assert.equal(await verifyWebhook('whsec_x', sig, 'abc', body), false);

  const event = await webhookEvent('whsec_x', { 'X-PC-Signature': sig, 'X-PC-Timestamp': ts, 'X-PC-Event-Id': 'e1' }, body);
  assert.equal(event.data.scope_id, 's1');
  assert.equal(event.event_id, 'e1');
  assert.equal(event.event, 'publication.succeeded');
  const viaHeaders = await webhookEvent('whsec_x', new Headers({ 'x-pc-signature': sig, 'x-pc-timestamp': ts }), new TextEncoder().encode(body));
  assert.equal(viaHeaders.data.scope_id, 's1');
  await assert.rejects(webhookEvent('whsec_x', { 'X-PC-Signature': 'v1=nope', 'X-PC-Timestamp': ts }, body), /does not hold/);
});

test('the PHP and Python SDKs compute the same signature', async () => {
  // hmac_sha256('whsec_x', '1700000000.{}'), computed independently in Python
  assert.equal(await signWebhook('whsec_x', '1700000000', '{}'), 'v1=be8cb8325f2202445260a855532f967e30ad2a9394ce28da66ee02880ddcb661');
});
