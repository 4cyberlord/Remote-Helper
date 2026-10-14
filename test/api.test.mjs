import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { operation, imageStoragePath, validateConfig, DEFAULT_CONFIG } from '../lib/api.mjs';
import { loadConfig } from '../lib/state.mjs';

const ID = '1c91f4cb-f7cc-4abe-9cf1-372ea999a582';
const config = { url: 'https://unit.example/functions/v1/council-editor-api', apiKey: 'public-key' };
test('uses same public deployed backend without manual setup or private keys', async () => {
  const actual = await loadConfig();
  assert.deepEqual(actual, DEFAULT_CONFIG);
  assert.match(DEFAULT_CONFIG.apiKey, /^sb_publishable_/);
  assert.doesNotThrow(() => validateConfig(DEFAULT_CONFIG));
  assert.throws(() => validateConfig({ ...config, url: 'http://evil.example/functions/v1/council-editor-api' }), /HTTPS/);
  assert.throws(() => validateConfig({ ...config, url: 'https://unit.example/bad' }), /endpoint/);
});
test('owner/session/submission storage path follows Council Edge Function policy', () => {
  assert.equal(imageStoragePath(ID, ID, ID, 9, '09-full-abc.png'), `${ID}/${ID}/${ID}/9-09-full-abc.png`);
  assert.throws(() => imageStoragePath('../secret', ID, ID, 0, '00.png'), /Invalid/);
  assert.throws(() => imageStoragePath(ID, ID, ID, 0, '../xx.png'), /Invalid/);
});
test('API uses bearer identity, not a service-role credential', async () => {
  let seen;
  const mock = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => ({ ok: true, data: { id: 'job' } }) }; };
  assert.deepEqual(await operation(config, 'token', 'jobs.create', { submissionId: ID }, mock), { id: 'job' });
  assert.equal(seen.opts.headers.authorization, 'Bearer token');
  assert.equal(seen.opts.headers.apikey, 'public-key');
  assert.equal(JSON.parse(seen.opts.body).op, 'jobs.create');
});
test('401 is distinguishable from connection errors for automatic reauthentication', async () => {
  const unauthorized = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'That sign-in is no longer valid.' }) });
  await assert.rejects(() => operation(config, 'expired', 'auth.whoami', {}, unauthorized), /HTTP 401/);
});
