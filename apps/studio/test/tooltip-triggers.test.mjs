/**
 * Which elements are allowed to raise the Gemini tooltip, and which are not.
 *
 * `<GlobalTooltips>` anchors on exactly one thing: `closest('[title]')` in a
 * capture-phase `mouseover` (Tooltip.tsx). That single line makes `title` the
 * whole opt-in surface, and it cuts both ways:
 *
 *   - A collapsed rail row with no `title` can never tooltip, no matter what
 *     markup sits inside it.
 *   - Any element with a non-empty `title` tooltips instantly, including ones
 *     that only ever carried it for the native bubble's several-hundred-ms
 *     dwell delay and were effectively invisible before.
 *
 * Both directions were reported as bugs by the user and are pinned here.
 *
 * Verified in the running app over CDP, hovering every rail row at its measured
 * centre with the sidebar collapsed:
 *
 *   Expand sidebar / Switch to Spark / New chat / Search / Code / Media /
 *   Agents / Projects / Starred / Shared with me / Settings
 *     -> shown, place: right, gap: 8, crossDelta: 0, bg rgb(230,230,230)
 *   Open account menu (no title)   -> not shown
 *   hand-rolled #18181b bubbles remaining in <aside> -> 0
 *
 * The source is read as text because Node cannot import the TSX modules, which
 * is the approach the other tests in this directory take.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(here, rel), 'utf8');

const tooltip = read('../../../platform/ui/src/Tooltip.tsx');
const primitives = read('../src/shell/sidebar/SidebarPrimitives.tsx');
const sidebar = read('../src/shell/sidebar/Sidebar.tsx');
const responseChrome = read('../../../features/chat/src/ChatResponseChrome.tsx');

describe('GlobalTooltips opt-in surface', () => {
  it('anchors only on [title], so a missing title is a guaranteed no-tooltip', () => {
    assert.match(
      tooltip,
      /closest\?\.<HTMLElement>\('\[title\]'\)/,
      'GlobalTooltips no longer keys off [title]; the rest of this file assumes it does',
    );
  });

  it('ignores an empty or whitespace-only title', () => {
    assert.match(tooltip, /if \(title === null \|\| title\.trim\(\) === ''\) return;/);
  });
});

describe('collapsed rail rows', () => {
  // The bug: neither row component set `title`, so GlobalTooltips had nothing
  // to attach to. What did exist was a hand-rolled bubble at `left-[46px]`
  // (x=64) inside a 52px-wide rail, clipped away entirely by the scroll
  // wrapper's `overflow: auto` for every row inside it.
  for (const [name, source] of [
    ['SidebarItem', primitives],
    ['SparkSidebarItem', sidebar],
  ]) {
    it(`${name} routes its collapsed label through title=`, () => {
      assert.match(
        source,
        /title=\{isCollapsed \? label : undefined\}/,
        `${name} must set title when collapsed or its rail row cannot tooltip`,
      );
    });

    it(`${name} asks for right placement`, () => {
      assert.match(source, /data-tooltip-position="right"/);
    });
  }

  it('no hand-rolled #18181b tooltip bubbles are left in the sidebar', () => {
    for (const [name, source] of [
      ['SidebarPrimitives.tsx', primitives],
      ['Sidebar.tsx', sidebar],
    ]) {
      const handRolled = source.match(/role="tooltip"[\s\S]{0,400}?bg-\[#18181b\]/);
      assert.equal(
        handRolled,
        null,
        `${name} still builds its own tooltip box; the portal one replaced it`,
      );
      assert.equal(
        /left-\[46px\]/.test(source),
        false,
        `${name} still positions a bubble at left-[46px], which the 52px rail clips`,
      );
    }
  });
});

describe('response three-dot menu', () => {
  // The bug: four of six rows are unavailable in Willow and all four carried
  // title="Unavailable in Willow". Invisible behind the native dwell delay,
  // instant once GlobalTooltips took over every title in the app.
  const menuItem = responseChrome.match(
    /role="menuitem"[\s\S]*?onClick=\{\(\) => runMenuAction\(action\)\}/,
  );

  it('has a menuitem block to check', () => {
    assert.ok(menuItem, 'the menu item button in ChatResponseChrome moved or changed shape');
  });

  it('sets no title on a menu row', () => {
    // Comments are stripped first: the block carries an explanation that quotes
    // the removed `title="Unavailable in Willow"` verbatim, and a naive search
    // would match its own tombstone.
    const code = menuItem[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(
      /title=/.test(code),
      false,
      'a title on a menu row raises a tooltip over the open menu',
    );
  });

  it('still marks unavailable rows for AT without a title', () => {
    assert.match(menuItem[0], /disabled=\{unavailable\}/);
    assert.match(menuItem[0], /aria-disabled=\{unavailable\}/);
  });

  it('keeps the tooltip on the trigger that opens the menu', () => {
    // The more_horiz button itself is icon-only, so it does need one.
    assert.match(responseChrome, /aria-label="Show more options"[\s\S]{0,120}?title="More"/);
  });

  it('leaves no "Unavailable in Willow" tooltip anywhere in the response chrome', () => {
    // Action-row buttons do tooltip in Gemini — the stopped turn's flag button
    // says "Report legal issue" there, so a disabled one says that here too.
    const code = responseChrome.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.equal(
      /title="Unavailable in Willow"/.test(code),
      false,
      'a non-Gemini string is now visible instantly instead of hidden behind the dwell delay',
    );
  });
});
