#!/usr/bin/env node
/**
 * Vendoring tool for the Codex harness behind the Code tab's Agent tool.
 *
 * The harness tracks a pinned commit of openai/codex (Apache-2.0). Upstream's
 * prompts and tool grammars are copied byte-for-byte into
 * `features/code/src/agent/harness/upstream/` and are never hand-edited —
 * everything Willow changes lives in `../overlay/` and is applied at runtime.
 * That split is what makes an upgrade mechanical: re-run this script, read the
 * diff, and adjust the overlay only if an anchor it depends on moved.
 *
 * Usage:
 *   node tools/scripts/sync-codex-upstream.mjs            # verify + report
 *   node tools/scripts/sync-codex-upstream.mjs --update   # pull latest release
 *   node tools/scripts/sync-codex-upstream.mjs --update --ref rust-v0.147.0
 *
 * Exit codes: 0 clean, 1 drift or missing files, 2 network/remote failure.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/**
 * Every harness that vendors upstream, in priority order.
 *
 * There are two, because the Code tab's harness and Spark's are separate forks
 * that each compose the prompt themselves. They must be pinned to the *same*
 * commit — a Spark agent running an older Codex prompt than the Code agent is
 * exactly the kind of silent divergence this script exists to prevent.
 *
 * This used to point at Code's folder alone, and Spark's copy was made by hand.
 * The predictable happened: Code moved to ten vendored files and Spark still had
 * five, so Spark's Plan mode had no mode template to compose. Writing every
 * directory from one list is what stops that recurring.
 *
 * The first entry owns the canonical `MANIFEST.json`; the rest receive an
 * identical copy, and `check()` verifies all of them.
 */
const UPSTREAM_DIRS = [
  path.join(REPO_ROOT, 'features', 'code', 'src', 'agent', 'harness', 'upstream'),
  path.join(REPO_ROOT, 'features', 'spark', 'src', 'harness', 'upstream'),
];
const MANIFEST_PATH = path.join(UPSTREAM_DIRS[0], 'MANIFEST.json');

const GITHUB_REPO = 'openai/codex';
const UA = { 'User-Agent': 'willow-codex-sync' };

/**
 * The set of upstream artifacts the harness depends on.
 *
 * Keep this list small and declarative. Every entry is something the runtime
 * genuinely reads; anything added here becomes a file a future upgrade has to
 * reconcile, so do not vendor "for reference".
 */
const TRACKED = [
  {
    upstream: 'codex-rs/core/prompt_with_apply_patch_instructions.md',
    local: 'prompt_with_apply_patch_instructions.md',
    role: 'Base agent prompt, including the apply_patch section.',
  },
  {
    upstream: 'codex-rs/prompts/templates/apply_patch_tool_instructions.md',
    local: 'apply_patch_tool_instructions.md',
    role: 'Tool description handed to the model for apply_patch.',
  },
  {
    upstream: 'codex-rs/core/src/tools/handlers/apply_patch.lark',
    local: 'apply_patch.lark',
    role: 'Lark grammar for the freeform apply_patch tool.',
  },
  {
    upstream: 'codex-rs/collaboration-mode-templates/templates/plan.md',
    local: 'collaboration_mode_plan.md',
    role: 'Plan mode developer instructions, injected in <collaboration_mode> tags.',
  },
  {
    upstream: 'codex-rs/collaboration-mode-templates/templates/default.md',
    local: 'collaboration_mode_default.md',
    role: 'Default mode developer instructions, injected in <collaboration_mode> tags.',
  },
  {
    upstream: 'codex-rs/ext/goal/templates/goals/continuation.md',
    local: 'goal_continuation.md',
    role: 'Steering message that drives each automatic goal continuation turn.',
  },
  {
    upstream: 'codex-rs/ext/goal/templates/goals/budget_limit.md',
    local: 'goal_budget_limit.md',
    role: 'Steering message sent once a goal exhausts its token budget.',
  },
  {
    upstream: 'codex-rs/ext/goal/templates/goals/objective_updated.md',
    local: 'goal_objective_updated.md',
    role: "Steering message sent when the user edits an active goal's objective.",
  },
  {
    upstream: 'LICENSE',
    local: 'LICENSE',
    role: 'Apache-2.0 licence text, required for redistribution.',
  },
  {
    upstream: 'NOTICE',
    local: 'NOTICE',
    role: 'Upstream attribution notice, required by Apache-2.0 §4(d).',
  },
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const args = process.argv.slice(2);
const wantsUpdate = args.includes('--update');

/**
 * The ref to vendor, if one was named.
 *
 * A bare positional counts as well as `--ref <tag>`, because **npm eats the
 * flag**. `npm run codex:update -- --ref rust-v0.147.0` — the form this repo's
 * docs give — reaches the script as `--update rust-v0.147.0`, with npm warning
 * that it treated `--ref` as its own unknown config. Reading only `--ref` meant
 * that command silently vendored *latest* instead of the tag asked for, which
 * is the worst possible outcome for a pin: it moves without being asked to.
 */
const refIndex = args.indexOf('--ref');
const explicitRef =
  (refIndex !== -1 ? args[refIndex + 1] : null)
  ?? args.find((arg) => /^rust-v\d/.test(arg))
  ?? null;

async function getJson(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getText(url) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function resolveRef() {
  if (explicitRef) {
    const commit = await getJson(
      `https://api.github.com/repos/${GITHUB_REPO}/commits/${explicitRef}`
    );
    return { ref: explicitRef, commit: commit.sha };
  }
  const release = await getJson(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
  );
  const commit = await getJson(
    `https://api.github.com/repos/${GITHUB_REPO}/commits/${release.tag_name}`
  );
  return { ref: release.tag_name, commit: commit.sha };
}

async function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
}

async function update() {
  const { ref, commit } = await resolveRef();
  console.log(`Vendoring ${GITHUB_REPO} @ ${ref} (${commit.slice(0, 12)})`);

  /*
   * Fetch everything before touching the disk.
   *
   * This used to clear the vendored folders first and fetch second, which meant
   * a single moved path took out every harness and left the repo with no
   * vendored prompt at all — the harness cannot compose a system prompt without
   * it, so the app was broken until someone restored from git. And a moved path
   * is not an edge case: it is the *expected* failure whenever the pin moves,
   * and it is the one this script is designed to report.
   *
   * Fetching into memory first makes the operation all-or-nothing. A 404 now
   * costs a re-run rather than a `git checkout`.
   */
  const fetched = [];
  for (const item of TRACKED) {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${commit}/${item.upstream}`;
    try {
      const text = await getText(url);
      fetched.push({ item, text });
      console.log(`  got  ${item.local}  (${Buffer.byteLength(text, 'utf8')} bytes)`);
    } catch (error) {
      console.error(`  FAIL ${item.upstream}`);
      console.error(`       ${error.message}`);
      console.error(
        '       The path likely moved upstream. Locate it in the new tree and\n' +
          '       update TRACKED in this script, then re-run.\n' +
          '       Nothing was written; the vendored folders are untouched.'
      );
      process.exitCode = 2;
      return;
    }
  }

  /*
   * Now clear, so a path that disappears upstream does not linger and quietly
   * keep feeding the harness stale text.
   *
   * `KEEP` is Willow's own files in that folder. `.gitattributes` is not
   * optional: it carries `* -text`, which is what stops git rewriting LF to
   * CRLF on checkout and breaking every checksum this script just wrote. It was
   * deleted here once, and the failure that followed looked like a hand-edited
   * vendored file rather than a missing exemption.
   */
  const KEEP = new Set(['AGENTS.md', '.gitattributes']);
  for (const dir of UPSTREAM_DIRS) {
    await mkdir(dir, { recursive: true });
    for (const entry of existsSync(dir) ? await readdir(dir) : []) {
      if (KEEP.has(entry)) continue;
      await rm(path.join(dir, entry), { recursive: true, force: true });
    }
  }

  const files = [];
  for (const { item, text } of fetched) {
    // Written verbatim, into every harness. Normalising line endings here would
    // change the string the model actually receives.
    for (const dir of UPSTREAM_DIRS) {
      await writeFile(path.join(dir, item.local), text, 'utf8');
    }
    files.push({
      upstream: item.upstream,
      local: item.local,
      role: item.role,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(Buffer.from(text, 'utf8')),
    });
    console.log(`  ok   ${item.local}`);
  }

  const manifest = {
    $comment:
      'Generated by tools/scripts/sync-codex-upstream.mjs. Do not edit by hand.',
    repository: `https://github.com/${GITHUB_REPO}`,
    license: 'Apache-2.0',
    ref,
    commit,
    fetchedAt: new Date().toISOString(),
    files,
  };

  const serialised = `${JSON.stringify(manifest, null, 2)}\n`;
  for (const dir of UPSTREAM_DIRS) {
    const target = path.join(dir, 'MANIFEST.json');
    await writeFile(target, serialised, 'utf8');
    console.log(`\nWrote ${path.relative(REPO_ROOT, target)}`);
  }
  console.log(
    '\nNext: run `npm run codex:check`, then review overlay anchors in\n' +
      'features/code/src/agent/harness/overlay/prompt-overlay.ts.'
  );
}

async function check() {
  const manifest = await readManifest();
  if (!manifest) {
    console.error('No MANIFEST.json. Run with --update to vendor upstream first.');
    process.exitCode = 1;
    return;
  }

  console.log(`Pinned to ${manifest.ref} (${manifest.commit.slice(0, 12)})`);

  let drifted = 0;
  for (const dir of UPSTREAM_DIRS) {
    console.log(`\n${path.relative(REPO_ROOT, dir)}`);

    /*
     * Every harness carries an identical copy of the manifest, so a fork left
     * on an older pin is caught here rather than at runtime. This is the check
     * that would have reported Spark sitting on five vendored files while Code
     * had ten.
     */
    const localManifestPath = path.join(dir, 'MANIFEST.json');
    if (!existsSync(localManifestPath)) {
      console.error('  MISSING  MANIFEST.json');
      drifted += 1;
    } else {
      const local = JSON.parse(await readFile(localManifestPath, 'utf8'));
      if (local.commit !== manifest.commit) {
        console.error(
          `  PIN      MANIFEST.json is at ${local.ref} (${String(local.commit).slice(0, 12)}), ` +
            `canonical is ${manifest.ref} (${manifest.commit.slice(0, 12)})`
        );
        drifted += 1;
      }
    }

    for (const file of manifest.files) {
      const target = path.join(dir, file.local);
      if (!existsSync(target)) {
        console.error(`  MISSING  ${file.local}`);
        drifted += 1;
        continue;
      }
      const actual = sha256(await readFile(target));
      if (actual !== file.sha256) {
        console.error(`  EDITED   ${file.local}`);
        console.error(
          '           Vendored files are byte-for-byte upstream. Move this change\n' +
            '           into ../overlay/ and restore the file with --update.'
        );
        drifted += 1;
      } else {
        console.log(`  ok       ${file.local}`);
      }
    }
  }

  // Report availability of a newer release, but never fail on it — being a few
  // versions behind is a choice, not a defect.
  try {
    const release = await getJson(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
    );
    if (release.tag_name !== manifest.ref) {
      console.log(
        `\nUpstream has ${release.tag_name}; this pin is ${manifest.ref}.` +
          '\nRun `npm run codex:update` to move the pin.'
      );
    } else {
      console.log('\nPin is at the latest upstream release.');
    }
  } catch {
    console.log('\n(Could not reach GitHub to compare releases; skipped.)');
  }

  if (drifted > 0) process.exitCode = 1;
}

await (wantsUpdate ? update() : check());
