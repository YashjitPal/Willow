/**
 * The space under the newest reply in the Code chat.
 *
 * The reply streaming in, or the newest reply, keeps exactly the prompt box's
 * measured height as its own bottom padding. Under its screen-filling minimum
 * height that costs nothing; once the reply outgrows it, it is what lets the
 * last line scroll clear of the prompt box. There used to be a second, fixed
 * padding (210px, or 290px with a tool tab open) that took over once a reply
 * reached the prompt box and stacked on the first: a reply just past that line
 * got up to a prompt box's height of empty space under its buttons.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const sidebar = fs.readFileSync(path.join(repoRoot, 'features', 'code', 'src', 'workbench', 'WorkbenchSidebar.tsx'), 'utf8');

it('measures the prompt box instead of assuming its height', () => {
  assert.match(sidebar, /const \[footerHeight, setFooterHeight\] = useState\(210\);/);
  assert.match(sidebar, /const observer = new ResizeObserver\(measure\);\s*observer\.observe\(footer\);/);
  assert.doesNotMatch(sidebar, /pb-\[210px\]|pb-\[290px\]|offsetHeight \|\| 210/, 'no fixed guess at the prompt box height');
});

it('keeps one padding under the newest reply, however long the reply is', () => {
  assert.doesNotMatch(sidebar, /needsScrollPadding/, 'no second padding that takes over and stacks');
  assert.match(sidebar, /paddingBottom: isLastAssistantMessage && replyHoldsFooterSpace && !isCurrentlyGenerating\s*\? `\$\{footerHeight\}px`/);
  assert.match(sidebar, /paddingBottom: `\$\{footerHeight\}px`\s*\}\}/, 'the reply streaming in holds it the same way');
  assert.match(sidebar, /paddingBottom: replyHoldsFooterSpace \? 0 : footerHeight,/, 'the thread holds it only when no reply does');
});

it('lets the thread hold the space when no reply is under the last prompt, or the thread is not shown', () => {
  assert.match(sidebar, /const threadShown = isChatMode \|\| \(activeTab !== 'design' && activeTab !== 'agents'\);/);
  assert.match(sidebar, /const replyHoldsFooterSpace = threadShown && \(isCurrentlyGenerating \|\| newestConversationMessage\?\.role === 'assistant'\);/);
});

it('keeps the end of the thread in view when the prompt box grows under it', () => {
  assert.match(sidebar, /if \(grew && atBottom && !isScrollingToTop\.current\) \{\s*flushSync\(\(\) => setFooterHeight\(next\)\);\s*container!\.scrollTop = container!\.scrollHeight;/);
});
