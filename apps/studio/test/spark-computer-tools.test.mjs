/**
 * Spark's reach into the user's own computer in the desktop app: offered only there, and read back to a task in text
 * it can act on — the open windows, and a window's controls by number.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const tools = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'spark-computer-tools.ts'));

it('offers nothing outside the desktop app', async () => {
  assert.deepEqual(await tools.sparkComputerTools(), []);
});

it('reads windows and controls back as lines a task can act on', () => {
  assert.equal(tools.appLine({ title: 'Budget.xlsx - Excel', process: 'EXCEL', pid: 42, foreground: true }, 'windows'), '- "Budget.xlsx - Excel" (EXCEL) — pid 42; in front');
  assert.equal(tools.appLine({ title: 'Groceries', app: 'Notes', pid: 5, window: 9 }, 'mac'), '- "Groceries" (Notes) — window 9, pid 5');
  assert.equal(tools.appLine({ title: 'Firefox', window: 101 }, 'linux'), '- "Firefox" — window 101');
  assert.equal(tools.elementLine({ index: 2, role: 'checkbox', name: 'Remember me', state: 'off', actions: ['toggle'] }), '[2] checkbox "Remember me" — off — toggle');
  assert.equal(tools.elementLine({ index: 0, role: 'textbox', name: 'Search', value: 'cats', actions: ['set_value'] }), '[0] textbox "Search" — value "cats" — set_value');
});

it('names a window by pid, program or title, and nothing else', () => {
  assert.deepEqual(tools.target({ pid: '17', program: ' notepad.exe ', title: ' Untitled ', bogus: true }), { pid: 17, process: 'notepad', title: 'Untitled' });
  assert.deepEqual(tools.target({ pid: -3, window: 0 }), {});
});
