import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'council-remote-test-'));
process.env.COUNCIL_REMOTE_DATA_HOME = root;
const { newSession, currentSession, loadSession, saveSession, sessionDir } = await import('../lib/state.mjs');
const { submit } = await import('../lib/workflow.mjs');
const userId = randomUUID(), remoteSessionId = randomUUID(), jobId = randomUUID();

test('each 00 creates a separate private folder with no shared screenshots or IDs', async () => {
  const first = await newSession('A', userId);
  const second = await newSession('B', userId);
  assert.notEqual(first.id, second.id);
  assert.notEqual(sessionDir(first.id), sessionDir(second.id));
  assert.equal(first.captures.length, 0);
  assert.equal(second.captures.length, 0);
  assert.equal((await currentSession()).id, second.id);
  assert.match((await readFile(join(sessionDir(first.id), 'session.json'), 'utf8')), /\(R\) A/);
});

test('04 is retryable and cannot duplicate an already-queued job', async () => {
  const session = await newSession('test', userId);
  const path = join(sessionDir(session.id), '01-full.png');
  const content = Buffer.from('private capture fixture');
  await writeFile(path, content);
  session.captures.push({ name: '01-full.png', path, bytes: content.length, width: 1920, height: 1080 });
  await saveSession(session);
  let uploads = 0, failOnce = true, createCount = 0;
  const calls = [];
  const call = async (_config, _token, op, args) => {
    calls.push({ op, args });
    if (op === 'auth.whoami') return { userId };
    if (op === 'sessions.create') return { id: remoteSessionId };
    if (op === 'storage.uploadUrl') return { url: 'https://example.test/signed' };
    if (op === 'screenshots.list') return [];
    if (op === 'screenshots.add') return { id: randomUUID() };
    if (op === 'jobs.create') { createCount += 1; return { id: jobId }; }
    throw new Error(`unexpected operation: ${op}`);
  };
  const upload = async () => { uploads += 1; if (failOnce) { failOnce = false; throw new Error('network offline'); } };
  await assert.rejects(() => submit(session, { config: {}, token: 'fake', call, upload }), /network offline/);
  assert.ok(session.pending?.submissionId);
  const pendingId = session.pending.submissionId;
  const saved = await submit(session, { config: {}, token: 'fake', call, upload });
  assert.equal(saved.id, jobId);
  assert.equal(uploads, 2);
  assert.equal(createCount, 1);
  assert.equal(saved.submissionId, pendingId);
  assert.equal(session.pending, null);
  assert.equal(session.submissions.length, 1);
  assert.equal(calls.filter(x => x.op === 'screenshots.add').length, 1);
  assert.equal(calls.find(x => x.op === 'jobs.create').args.settingsSnapshot.origin, 'remote-terminal');
  assert.equal(calls.find(x => x.op === 'jobs.create').args.images.length, 1);
  assert.equal((await submit(session, { config: {}, token: 'fake', call, upload })).id, jobId);
  assert.equal(createCount, 1);
  // New session can start even after prior job is committed; no shared metadata.
  const next = await newSession('second batch', userId);
  assert.notEqual(next.id, session.id);
  assert.equal(next.remoteSessionId, null);
  assert.deepEqual(next.submissions, []);
});

test('different signed-in account cannot upload another user session', async () => {
  const session = await newSession('owner test', userId);
  const path = join(sessionDir(session.id), '01-full.png');
  await writeFile(path, 'fixture');
  session.captures.push({ name: '01-full.png', path, bytes: 7, width: 100, height: 100 });
  await assert.rejects(() => submit(session, {
    call: async () => ({ userId: randomUUID() }), upload: async () => {},
  }), /different account/);
});

test('only numeric 00 through 04 are in published command line and installer', async () => {
  const bin = await readFile(new URL('../bin/remote.mjs', import.meta.url), 'utf8');
  const install = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
  assert.match(install, /for n in 00 01 02 03 04/);
  assert.doesNotMatch(bin, /case '05'|case '06'|case '07'|case '08'|case '09'/);
  assert.match(bin, /case '04'/);
});

test('recovering older sealed sessions does not change the new active capture batch', async () => {
  const prior = await newSession('first', userId);
  prior.pending = { submissionId: randomUUID(), signature: 'old', images: [] };
  await saveSession(prior);
  const latest = await newSession('second', userId);
  const reloaded = await loadSession(prior.id);
  assert.equal(reloaded.id, prior.id);
  assert.equal(reloaded.pending.submissionId, prior.pending.submissionId);
  assert.equal((await currentSession()).id, latest.id);
  await assert.rejects(() => loadSession(randomUUID()), /No saved session/);
});

test('clean test state', async () => { await rm(root, { recursive: true, force: true }); });
