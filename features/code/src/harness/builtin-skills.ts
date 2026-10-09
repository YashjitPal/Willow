/**
 * Skills that ship with the Code harness.
 *
 * They sit beside the user's skills in the prompt's catalog and the composer's
 * `$` menu, and are read the same way, with `read_skill`. The difference is that
 * some tools require one: `computer` refuses to act until `app-testing` has been
 * read in the turn, so every test session starts from the same playbook rather
 * than from whatever the model remembers about browser automation.
 */

import type { LibrarySkill } from '@willow/core/skill-library';

export const APP_TESTING_SKILL_ID = 'app-testing';

const APP_TESTING = `# Testing the app in the preview

You are about to use the app the way a person would, in the live preview, with the \`computer\` tool. The preview shows the project as it is right now, including everything you changed this turn: Willow loads your latest edits before your first action, and again after you edit more.

## How the computer tool works
- Every call returns a screenshot and a numbered list of what is on screen, for example \`[7] button "Add task" at 612,148 — /components/TaskForm.tsx:31\`. Point at things by number: \`{"action": "click", "ref": 7}\`. Use \`x\`/\`y\` (screenshot pixels) only for things without a number, like a spot on a canvas.
- Numbers belong to the result they came with. After the page changes, use the numbers from the newest result.
- When you know what happens between steps, put several in one call: \`{"actions": [{"action": "click", "ref": 4}, {"action": "type", "text": "Buy milk", "enter": true}]}\`. You get one screenshot, after the last. Never batch past a step whose result you need to see first.
- Each result also lists console errors since the previous call. A journey that looks right but logs an error has found a bug.

## Plan before you click
1. Decide what "working" means for this request: the two to four journeys that matter, the one the user asked about first, and what you expect to see after each step.
2. Start with \`{"action": "screenshot"}\` to see where the app is.
3. Walk each journey: act, then compare the screenshot with what you expected. Look for specific evidence (the new item in the list, the total that changed, the message that appeared), not just that something moved.

## Using the app
- \`type\` types into the field you point at, or the focused one. \`"clear": true\` replaces what is there; \`"enter": true\` presses Enter afterwards.
- \`press\` sends a key: \`"Enter"\`, \`"Escape"\`, \`"Tab"\`, \`"Shift+Tab"\`, \`"ArrowDown"\`, \`"Control+A"\`.
- Below the fold: \`scroll\` down, then use the new numbers. Hover menus: \`hover\` first.
- \`select\` picks an option in a dropdown by its label. \`drag\` moves one thing onto another.
- \`navigate\` changes the route (\`"to": "#/settings"\`) or goes \`"back"\`, \`"forward"\`, \`"reload"\`. Reload to check that saved data survives a refresh.
- \`viewport\` switches between \`"mobile"\`, \`"tablet"\` and \`"desktop"\` to test layouts. Switch back to desktop when you are done.
- \`wait\` with \`"text"\` waits up to five seconds for that text to appear.

## Keep it tight
- Test what matters to the request, usually five to fifteen actions. Do not tour parts of the app nobody asked about.
- Do not repeat an action that did not work. Read the screenshot, work out why (wrong element, covered, disabled, off screen) and change approach. After two failed attempts at one step, it is a finding, not a puzzle.
- Do not sign in to real services, pay, or send anything to real people. Test data you add is fine; say so if it stays in the app's storage.

## When something is broken
- Note what you did, what you expected and what happened.
- Fix it with your usual edits; each numbered element names the file and line that renders it. Then walk the same journey again to confirm the fix.

## Reporting
End with a short report in plain words:
- **Works:** each journey that passed, one line each.
- **Broken:** anything that failed and what happened, and whether you fixed it.
Report only what you saw. Never claim a check you did not do.
`;

export const BUILTIN_SKILLS: readonly LibrarySkill[] = [
  {
    id: APP_TESTING_SKILL_ID,
    name: 'App testing',
    description: 'Read before using the computer tool: how to plan a test, use the app in the preview, judge the results and report them.',
    shortDescription: 'How to test the app in the preview with the computer tool',
    instructions: APP_TESTING,
    enabled: true,
  },
];

/** Willow's skills first, then the user's; a user skill with a built-in's id is shadowed. */
export function withBuiltinSkills(skills: readonly LibrarySkill[]): LibrarySkill[] {
  const builtinIds = new Set(BUILTIN_SKILLS.map((skill) => skill.id));
  return [...BUILTIN_SKILLS, ...skills.filter((skill) => !builtinIds.has(skill.id))];
}
