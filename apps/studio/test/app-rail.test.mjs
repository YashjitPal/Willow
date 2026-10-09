import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const src = path.join(import.meta.dirname, '..', 'src');
const read = (...parts) => fs.readFileSync(path.join(src, ...parts), 'utf8');

const {
  EMPTY_RAIL_CUSTOMIZATION,
  RAIL_PIN_LIMIT,
  moveRailPin,
  parseRailCustomization,
  pinnedRailIds,
  splitRailDestinations,
  toggleRailPin,
} = await importTs(path.join(import.meta.dirname, '..', 'src', 'shell', 'rail', 'rail-pins.ts'));

const destinations = [
  { id: 'customize', visibleByDefault: false },
  { id: 'spark', visibleByDefault: false },
  { id: 'notes', visibleByDefault: true },
];

it('pins the defaults until the user says otherwise', () => {
  assert.deepEqual(pinnedRailIds(EMPTY_RAIL_CUSTOMIZATION, destinations), ['notes']);
  const { state } = toggleRailPin(EMPTY_RAIL_CUSTOMIZATION, destinations, 'notes');
  assert.deepEqual(pinnedRailIds(state, destinations), []);
});

it('lands a new pin last, and unpinning keeps its place in the order', () => {
  let state = toggleRailPin(EMPTY_RAIL_CUSTOMIZATION, destinations, 'customize').state;
  assert.deepEqual(splitRailDestinations(state, destinations).pinnedIds, ['notes', 'customize']);
  state = toggleRailPin(state, destinations, 'spark').state;
  assert.deepEqual(splitRailDestinations(state, destinations).pinnedIds, ['notes', 'customize', 'spark']);
  const order = state.order;
  state = toggleRailPin(state, destinations, 'customize').state;
  assert.deepEqual(state.order, order);
  assert.deepEqual(splitRailDestinations(state, destinations), { pinnedIds: ['notes', 'spark'], exploreOnlyIds: ['customize'] });
});

it('refuses a pin past the limit', () => {
  const many = Array.from({ length: RAIL_PIN_LIMIT + 1 }, (_, index) => ({ id: `d${index}`, visibleByDefault: true }));
  assert.equal(pinnedRailIds(EMPTY_RAIL_CUSTOMIZATION, many).length, RAIL_PIN_LIMIT);
  const result = toggleRailPin(EMPTY_RAIL_CUSTOMIZATION, many, `d${RAIL_PIN_LIMIT}`);
  assert.equal(result.limited, true);
  assert.equal(result.state, EMPTY_RAIL_CUSTOMIZATION);
});

it('moves only pinned destinations when dragging', () => {
  let state = toggleRailPin(EMPTY_RAIL_CUSTOMIZATION, destinations, 'customize').state;
  state = toggleRailPin(state, destinations, 'spark').state;
  state = moveRailPin(state, destinations, 'spark', 'notes');
  assert.deepEqual(splitRailDestinations(state, destinations).pinnedIds, ['spark', 'notes', 'customize']);
  assert.equal(moveRailPin(state, destinations, 'spark', 'spark'), state);
});

it('keeps ids this build does not know, and ignores malformed storage', () => {
  const stored = parseRailCustomization({ version: 2, order: ['future', 'spark', 'customize'], pinOverrides: { future: true, spark: true, bad: 'yes' } });
  assert.deepEqual(stored.pinOverrides, { future: true, spark: true });
  assert.deepEqual(splitRailDestinations(stored, destinations).pinnedIds, ['spark', 'notes']);
  const moved = moveRailPin(stored, destinations, 'notes', 'spark');
  assert.equal(moved.order[0], 'future');
  assert.deepEqual(parseRailCustomization('nonsense'), EMPTY_RAIL_CUSTOMIZATION);
  assert.deepEqual(parseRailCustomization({ version: 1, order: ['spark'] }), EMPTY_RAIL_CUSTOMIZATION);
});

it('starts with Home', () => {
  const rail = read('shell', 'rail', 'AppRail.tsx');
  assert.match(rail, /const HOME: RailDestination = \{ id: 'home', label: 'Home'/);
  assert.match(rail, /\[HOME, \.\.\.PRIMARY\]/);
});

it("is the app's only way to Code and Media, which have the page to themselves", () => {
  assert.match(read('shell', 'sidebar', 'Sidebar.tsx'), /\{!isDesktopApp\(\) && \(\s*<>\s*<SidebarItem[^>]*?label="Code"[\s\S]*?label="Media"/);
  const app = read('app', 'App.tsx');
  assert.match(app, /const isSidebarAway = isDesktopApp\(\) && \(isCodeSurface \|\| isMediaSurface\);/);
  assert.match(app, /isSidebarAway=\{isSidebarAway\}/);
  assert.match(read('shell', 'StudioLayout.tsx'), /<div style=\{\{ display: isSidebarAway \? 'none' : 'contents' \}\}>\s*<Sidebar/);
});
