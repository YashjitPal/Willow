#!/usr/bin/env node
/**
 * Vendoring tool for the Codex harness used by features/code-beta.
 *
 * The Code Beta harness tracks a pinned commit of openai/codex (Apache-2.0).
 * Upstream's prompts and tool grammars are copied byte-for-byte into
 * `features/code-beta/src/harness/upstream/` and are never hand-edited —
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
const UPSTREAM_DIR = path.join(
  REPO_ROOT,
  'features',
  'code-beta',
  'src',
  'harness',
  'upstream'
);
const MANIFEST_PATH = path.join(UPSTREAM_DIR, 'MANIFEST.json');

const GITHUB_REPO = 'openai/codex';
const UA = { 'User-Agent': 'willow-code-beta-sync' };

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
const refIndex = args.indexOf('--ref');
const explicitRef = refIndex !== -1 ? args[refIndex + 1] : null;

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

  await mkdir(UPSTREAM_DIR, { recursive: true });

  // Clear previously vendored files so a path that disappears upstream does
  // not linger and quietly keep feeding the harness stale text.
  for (const entry of existsSync(UPSTREAM_DIR) ? await readdir(UPSTREAM_DIR) : []) {
    if (entry === 'AGENTS.md') continue;
    await rm(path.join(UPSTREAM_DIR, entry), { recursive: true, force: true });
  }

  const files = [];
  for (const item of TRACKED) {
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/${commit}/${item.upstream}`;
    let text;
    try {
      text = await getText(url);
    } catch (error) {
      console.error(`  FAIL ${item.upstream}`);
      console.error(`       ${error.message}`);
      console.error(
        '       The path likely moved upstream. Locate it in the new tree and\n' +
          '       update TRACKED in this script, then re-run.'
      );
      process.exitCode = 2;
      return;
    }

    // Written verbatim. Normalising line endings here would change the string
    // the model actually receives.
    const target = path.join(UPSTREAM_DIR, item.local);
    await writeFile(target, text, 'utf8');
    files.push({
      upstream: item.upstream,
      local: item.local,
      role: item.role,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(Buffer.from(text, 'utf8')),
    });
    console.log(`  ok   ${item.local}  (${Buffer.byteLength(text, 'utf8')} bytes)`);
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

  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  console.log(
    '\nNext: run `npm run codex:check`, then review overlay anchors in\n' +
      'features/code-beta/src/harness/overlay/prompt-overlay.ts.'
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
  for (const file of manifest.files) {
    const target = path.join(UPSTREAM_DIR, file.local);
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
