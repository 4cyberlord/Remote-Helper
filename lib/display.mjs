import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE = join(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'remote-native');
export function nativeBridge(args = [], input) {
  if (process.platform !== 'darwin') throw new Error('Screen capture and Keychain require macOS.');
  const result = spawnSync(NATIVE, args, { input, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000 });
  if (result.error) throw new Error(`macOS helper binary unavailable. Run ./install.sh first. ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || 'macOS helper command failed').trim());
  return result.stdout.trim();
}
export function getDisplays() {
  const data = JSON.parse(nativeBridge(['displays']));
  if (!Array.isArray(data.displays) || !data.displays.length) throw new Error('No usable displays detected.');
  return data;
}
export function chooseDisplay(layout) {
  return layout.displays.find(d => d.id === layout.activeDisplayId) || layout.displays.find(d => d.main) || layout.displays[0];
}
export function displayRect(display, kind) {
  const { x, y, width, height } = display;
  if (![x, y, width, height].every(Number.isInteger) || width < 2 || height < 2) throw new Error('Invalid macOS display dimensions.');
  if (kind === 'full') return { x, y, width, height };
  const half = Math.floor(width / 2);
  if (kind === 'left') return { x, y, width: half, height };
  if (kind === 'right') return { x: x + half, y, width: width - half, height };
  throw new Error('Invalid screenshot kind.');
}
