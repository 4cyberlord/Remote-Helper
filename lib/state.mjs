import { mkdir, readFile, writeFile, rename, open, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG } from './api.mjs';

export const DATA_ROOT = process.env.COUNCIL_REMOTE_DATA_HOME || join(homedir(), 'Library', 'Application Support', 'Council Remote Helper');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temp, file);
}
export async function loadConfig() {
  const config = {
    url: process.env.COUNCIL_REMOTE_API_URL || DEFAULT_CONFIG.url,
    apiKey: process.env.COUNCIL_REMOTE_PUBLISHABLE_KEY || DEFAULT_CONFIG.apiKey,
  };
  return config;
}
export const sessionDir = id => {
  if (!UUID.test(id)) throw new Error('Invalid local session ID.');
  return join(DATA_ROOT, 'sessions', id);
};
export async function saveSession(session) {
  await atomicJson(join(sessionDir(session.id), 'session.json'), session);
}
export async function newSession(name = '', userId) {
  if (!UUID.test(userId)) throw new Error('Cannot create a session without an authenticated account.');
  const now = new Date();
  const id = randomUUID();
  const session = {
    id, userId, title: `(R) ${name.trim() || `Remote ${now.toISOString().replace('T', ' ').slice(0, 16)}`}`,
    createdAt: now.toISOString(), captures: [], remoteSessionId: null,
    pending: null, submissions: [],
  };
  await mkdir(join(DATA_ROOT, 'sessions'), { recursive: true, mode: 0o700 });
  await mkdir(sessionDir(id), { recursive: false, mode: 0o700 });
  await saveSession(session);
  await atomicJson(join(DATA_ROOT, 'current.json'), { id });
  return session;
}
export async function loadSession(id) {
  // A named retry may target a previously sealed session after the user has
  // begun working on a different problem with 00. Never change current.json.
  const session = await readJson(join(sessionDir(id), 'session.json'));
  if (!session || session.id !== id) throw new Error('No saved session exists for that ID.');
  return session;
}
export async function currentSession() {
  const current = await readJson(join(DATA_ROOT, 'current.json'));
  if (!current?.id) throw new Error('No active session. Run 00 first.');
  return loadSession(current.id);
}
export async function sessionLock(id, work) {
  const lock = join(sessionDir(id), '.lock');
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') {
      // Avoid deleting a live writer's lock. A crashed writer may be recovered
      // manually after verifying no other helper process is still active.
      throw new Error('This session is busy or interrupted. Ensure no other helper is running, then remove its .lock file to recover.');
    }
    throw error;
  }
  try { return await work(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}
