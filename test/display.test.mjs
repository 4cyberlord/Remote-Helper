import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { displayRect, chooseDisplay } from '../lib/display.mjs';

const ultrawide = { id: 100, index: 1, x: -1728, y: 60, width: 3441, height: 1440, main: false };
test('odd-width crop rectangles precisely partition a negative-origin ultrawide monitor', () => {
  const left = displayRect(ultrawide, 'left');
  const right = displayRect(ultrawide, 'right');
  assert.deepEqual(left, { x: -1728, y: 60, width: 1720, height: 1440 });
  assert.deepEqual(right, { x: -8, y: 60, width: 1721, height: 1440 });
  assert.equal(left.x + left.width, right.x);
  assert.equal(right.x + right.width, ultrawide.x + ultrawide.width);
  assert.deepEqual(displayRect(ultrawide, 'full'), { x: -1728, y: 60, width: 3441, height: 1440 });
});
test('cursor display is chosen, otherwise the main monitor', () => {
  const main = { id: 200, main: true, x: 0, y: 0, width: 1920, height: 1080 };
  const layout = { displays: [ultrawide, main], activeDisplayId: 100 };
  assert.equal(chooseDisplay(layout).id, 100);
  assert.equal(chooseDisplay({ ...layout, activeDisplayId: 999 }).id, 200);
});
test('invalid display rectangles and unlisted capture commands are rejected', () => {
  assert.throws(() => displayRect({ ...ultrawide, width: 0 }, 'full'), /Invalid/);
  assert.throws(() => displayRect(ultrawide, 'grid'), /Invalid screenshot kind/);
  assert.throws(() => displayRect(ultrawide, 'selection'), /Invalid screenshot kind/);
});
