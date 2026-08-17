# upstream/ — do not edit

Every file in this folder except this one is a **byte-for-byte copy of
[openai/codex](https://github.com/openai/codex)**, licensed Apache-2.0.

The pinned commit, the checksums, and what each file is for are all in
`MANIFEST.json`.

## The rule

**Do not edit these files. Ever.**

`apps/studio/test/code-beta-harness.test.mjs` hashes each one against
`MANIFEST.json`, so an edit fails `npm test`. `npm run codex:check` reports the
same thing with a clearer message.

This is not bureaucracy. The whole point of vendoring rather than forking is
that an upgrade is `npm run codex:update` and a diff review. One local edit
turns every future upgrade into a merge conflict that someone has to
reconstruct from memory.

## What to do instead

| You want to | Do this |
| --- | --- |
| Change what the prompt says | Add an operation in [`../overlay/prompt-overlay.ts`](../overlay/AGENTS.md) |
| Add or remove a tool | Edit `../overlay/tool-policy.ts` and `../runtime/tools.ts` |
| Pull in a newer Codex | `npm run codex:update` |
| Track a new upstream file | Add it to `TRACKED` in `tools/scripts/sync-codex-upstream.mjs`, then `npm run codex:update` |

The overlay can replace a section, drop one, or append new ones — which covers
every reason anyone has needed to change this text so far.

## If you genuinely must edit one

Apache-2.0 §4(b) requires modified files to carry a prominent notice saying they
were changed. So: add that notice at the top of the file, regenerate
`MANIFEST.json` (the checksum will have moved), and write down in
[`../AGENTS.md`](../AGENTS.md) what was changed and why, because the next person
to run `codex:update` will silently overwrite it otherwise.

Strongly prefer the overlay.

## Provenance

`MANIFEST.json` records the repository, licence, release tag, full commit sha,
fetch timestamp, and a SHA-256 for every file. The Harness panel in the app
(Code Beta → Harness → Overview) renders all of it, so the pin is visible
without reading this folder.
