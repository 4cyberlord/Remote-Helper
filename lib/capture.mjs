import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chooseDisplay, displayRect, getDisplays, nativeBridge } from './display.mjs';
import { sessionDir } from './state.mjs';

function exec(binary, args) {
  const done = spawnSync(binary, args, { encoding: 'utf8', timeout: 120000 });
  if (done.error) throw new Error(`${binary}: ${done.error.message}`);
  return done;
}
function pixelSize(file) {
  const done = exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
  if (done.status !== 0) throw new Error(`Unable to read captured image dimensions: ${done.stderr}`);
  const width = Number(/pixelWidth:\s*(\d+)/.exec(done.stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(done.stdout)?.[1]);
  if (!width || !height) throw new Error('macOS reported an invalid screenshot.');
  return { width, height };
}
export async function capture(session, kind) {
  if (process.platform !== 'darwin') throw new Error('Screenshots require macOS.');
  if (session.captures.length >= 10) throw new Error('10 screenshots are already captured. Use 04, then 00 for a fresh session.');
  if (nativeBridge(['screen-permission']) !== 'granted') {
    nativeBridge(['screen-request']);
    if (nativeBridge(['screen-permission']) !== 'granted') {
      throw new Error('Grant Screen & System Audio Recording permission for Terminal in macOS System Settings, then retry.');
    }
  }
  // Always ask Core Graphics for live geometry. Retina scaling and external
  // monitor offsets are not inferred from stale saved screenshots.
  const display = chooseDisplay(getDisplays());
  const rect = displayRect(display, kind);
  const name = `${String(session.captures.length + 1).padStart(2, '0')}-${kind}-${randomUUID().slice(0, 8)}.png`;
  const path = join(sessionDir(session.id), name);
  const result = exec('screencapture', ['-x', '-t', 'png', `-R${rect.x},${rect.y},${rect.width},${rect.height}`, path]);
  if (result.status !== 0) throw new Error(`macOS screenshot failed: ${result.stderr.trim() || 'Check Screen Recording permission.'}`);
  const file = await stat(path);
  if (!file.size) throw new Error('macOS saved an empty screenshot.');
  const pixels = pixelSize(path);
  return {
    id: randomUUID(), name, path, kind, displayId: display.id, rect,
    capturedAt: new Date().toISOString(), bytes: file.size, width: pixels.width, height: pixels.height,
  };
}
