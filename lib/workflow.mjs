import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { operation, uploadSigned, imageStoragePath } from './api.mjs';
import { saveSession, sessionLock } from './state.mjs';

export async function captureSignature(captures) {
  const digest = createHash('sha256');
  for (const shot of captures) {
    digest.update(shot.name); digest.update('\0');
    digest.update(createHash('sha256').update(await readFile(shot.path)).digest());
  }
  return digest.digest('hex');
}

// A durable, per-folder journal survives a crash at any network boundary.
// Retries always use the original submission UUID and the same storage paths.
export async function submit(session, { config, token, call = operation, upload = uploadSigned } = {}) {
  return sessionLock(session.id, async () => {
    if (!session.captures.length) throw new Error('No screenshots in this session. Capture with 01, 02 or 03.');
    if (session.captures.length > 10) throw new Error('The Council cloud API accepts at most 10 screenshots.');
    if (session.submissions.length && !session.pending) return session.submissions[0]; // 04 is idempotent.
    const who = await call(config, token, 'auth.whoami');
    if (!who?.userId || who.userId !== session.userId) throw new Error('This session belongs to a different account. Create a new session using 00.');
    const signature = await captureSignature(session.captures);
    if (session.pending && session.pending.signature !== signature) throw new Error('Captured files changed after 04. Restore the original files before retrying.');
    if (!session.remoteSessionId) {
      const remote = await call(config, token, 'sessions.create', { title: session.title });
      session.remoteSessionId = remote.id;
      await saveSession(session);
    }
    if (!session.pending) {
      session.pending = {
        signature, submissionId: randomUUID(),
        settingsSnapshot: { source: 'council-remote-helper', origin: 'remote-terminal', overlayMode: 'auto' },
        mode: 'council', images: [],
      };
      await saveSession(session);
    }
    const journal = session.pending;
    for (const [position, shot] of session.captures.entries()) {
      if (!journal.images[position]) {
        const fileName = shot.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = imageStoragePath(who.userId, session.remoteSessionId, journal.submissionId, position, fileName);
        journal.images[position] = {
          position, storageBucket: 'screenshots', storagePath: path, fileName,
          bytes: shot.bytes, mime: 'image/png', width: shot.width, height: shot.height,
          uploaded: false, recorded: false,
        };
        await saveSession(session);
      }
      const image = journal.images[position];
      if (!image.uploaded) {
        const signed = await call(config, token, 'storage.uploadUrl', { path: image.storagePath, bucket: 'screenshots', idempotent: true });
        await upload(signed.url, shot.path);
        image.uploaded = true;
        await saveSession(session);
      }
      if (!image.recorded) {
        // If screenshots.add committed but its response was lost, avoid a duplicate.
        const stored = await call(config, token, 'screenshots.list', { sessionId: session.remoteSessionId });
        if (!stored.some(row => row.storagePath === image.storagePath)) {
          await call(config, token, 'screenshots.add', {
            sessionId: session.remoteSessionId, storageBucket: 'screenshots', storagePath: image.storagePath,
            fileName: image.fileName, bytes: image.bytes, mime: image.mime, width: image.width, height: image.height,
          });
        }
        image.recorded = true;
        await saveSession(session);
      }
    }
    const images = journal.images.map(({ uploaded, recorded, ...fields }) => fields);
    const queued = await call(config, token, 'jobs.create', {
      submissionId: journal.submissionId, sessionId: session.remoteSessionId,
      mode: journal.mode, settingsSnapshot: journal.settingsSnapshot, images,
    });
    const result = {
      id: queued.id, sessionId: session.remoteSessionId, signature,
      submittedAt: new Date().toISOString(), submissionId: journal.submissionId,
    };
    session.submissions.push(result);
    session.pending = null;
    await saveSession(session);
    return result;
  });
}
