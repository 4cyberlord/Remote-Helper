import { readFile } from 'node:fs/promises';

// These are the public deployment settings compiled into Council Editor itself.
// No service_role key, provider key, PIN, or account token ships with the helper.
export const DEFAULT_CONFIG = Object.freeze({
  url: 'https://ikpzlesstdqauevsdwem.supabase.co/functions/v1/council-editor-api',
  apiKey: 'sb_publishable_qhH6xqP5MOdm2ITyHEXpxA_zbSuz2qf',
});

export function validateConfig(config) {
  if (!config?.url || !config?.apiKey) throw new Error('Missing public Council Editor deployment configuration.');
  const parsed = new URL(config.url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid API protocol.');
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) throw new Error('Council Editor API must use HTTPS.');
  if (!/\/functions\/v1\/council-editor-api\/?$/.test(parsed.pathname)) throw new Error('Unexpected Council Editor API endpoint.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('API URL cannot contain credentials or parameters.');
}

export async function operation(config, token, op, args = {}, fetchImpl = fetch) {
  validateConfig(config);
  const res = await fetchImpl(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.apiKey, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(45000),
  });
  let result;
  try { result = await res.json(); } catch { throw new Error(`Council API answered non-JSON (HTTP ${res.status}).`); }
  if (!res.ok || result.ok !== true) {
    const message = String(result.error || `HTTP ${res.status}`);
    throw new Error(`${op}: HTTP ${res.status}: ${message}`);
  }
  return result.data;
}

export async function uploadSigned(url, file, fetchImpl = fetch) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))) {
    throw new Error('Refusing an insecure signed upload URL.');
  }
  const bytes = await readFile(file);
  const res = await fetchImpl(url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: bytes, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Screenshot upload failed (HTTP ${res.status}): ${(await res.text()).slice(0, 180)}`);
  return bytes.length;
}

export function imageStoragePath(userId, sessionId, submissionId, index, name) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (![userId, sessionId, submissionId].every(s => uuid.test(s))) throw new Error('Invalid account/session/submission UUID.');
  if (!Number.isInteger(index) || index < 0 || index > 9 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(name) || name.includes('..')) {
    throw new Error('Invalid screenshot storage identity.');
  }
  return `${userId}/${sessionId}/${submissionId}/${index}-${name}`;
}
