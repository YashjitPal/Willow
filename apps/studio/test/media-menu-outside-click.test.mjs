import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (relativePath) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');

test('media prompt model menu sees outside presses stopped by prompt surfaces', async () => {
  const source = await readSource('features/media/src/MediaView.tsx');
  const effect = source.slice(
    source.indexOf('const isInsideMenu ='),
    source.indexOf("const [modelMode, setModelMode]"),
  );

  assert.match(effect, /addEventListener\('mousedown', handleClickOutside, \{ capture: true \}\)/);
  assert.match(effect, /removeEventListener\('mousedown', handleClickOutside, \{ capture: true \}\)/);
});

test('media plus menu sees outside presses stopped by prompt surfaces', async () => {
  const source = await readSource('features/media/src/AssetMenuModal.tsx');

  assert.match(source, /addEventListener\('mousedown', handleClickOutside, \{ capture: true \}\)/);
  assert.match(source, /removeEventListener\('mousedown', handleClickOutside, \{ capture: true \}\)/);
});

test('media header menus see outside presses stopped by prompt surfaces', async () => {
  const source = await readSource('features/media/src/HeaderMenus.tsx');

  assert.match(source, /addEventListener\('mousedown', onDown, \{ capture: true \}\)/);
  assert.match(source, /removeEventListener\('mousedown', onDown, \{ capture: true \}\)/);
});

test('agent sidebar model dropdowns close when its prompt is pressed', async () => {
  const source = await readSource('features/media/src/AgentSidebar.tsx');

  assert.match(source, /data-agent-model-dropdown/);
  assert.match(source, /addEventListener\('mousedown', handleClickOutside, \{ capture: true \}\)/);
  assert.match(source, /setIsImgDropdownOpen\(false\)/);
  assert.match(source, /setIsVidDropdownOpen\(false\)/);
});
