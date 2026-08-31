#!/usr/bin/env node
/**
 * Pre-commit guard for backup.cmd / backup_beta.cmd.
 *
 * Those scripts run `git add -A`, which is how personal data reached this
 * repository the first time round. The repository is now PUBLIC, so anything
 * they stage is one push away from being permanent and world-readable.
 *
 * This scans only what is actually staged. FATAL findings stop the backup;
 * WARN findings are printed and let it continue, because the author's name,
 * email and Windows username are already accepted as public.
 *
 * Escape hatch: put `backup-guard:allow` in a comment on the offending line.
 */
import { execFileSync } from 'node:child_process';

const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

/** Credentials and personal data that must never be published. */
const FATAL = [
  ['google oauth access token', /ya29\.[A-Za-z0-9._-]{40,}/],
  ['google refresh token', /1\/\/0[A-Za-z0-9_-]{40,}/],
  ['google oauth client secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['google oauth client id', /[0-9]{9,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com/],
  ['google api key', /AIza[0-9A-Za-z_-]{35}/],
  ['anthropic api key', /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{30,}/],
  ['openai api key', /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/],
  ['github token', /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['aws access key id', /AKIA[0-9A-Z]{16}/],
  ['slack token', /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ['private key block', /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/],
  ['hardcoded secret', /(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i],
  ['account avatar url', /lh3\.googleusercontent\.com\/a\//],
  ['gemini debug dump', /BardAnswerService|beyond_api_v4m__rev/],
  ['home location', /Shafter,\s*California/],
  // A value, not the word: every prose mention here is a comment warning about
  // the hazard, and flagging those trains you to ignore the guard.
  ['birthdate', /\b(?:birthdate|date of birth)\b\s*[:=]/i],
  ['private task title', /Discord Account Status Resolution|Gmail Inbox Categorization/],
];

/** Already-accepted exposure. Reported, not blocking. */
const WARN = [
  ['author name', /Yashjit Pal/],
  ['author email', /yashjitp@gmail\.com/],
  ['windows home directory', /Users[\\/]+Yashjit 2/],
];

/**
 * Paths where a marker is deliberate and already public: the Firebase web key
 * (public by design — it is restricted in the Firebase console, not hidden),
 * and the backend's own credential-scrubbing regexes and their fixtures.
 */
const ALLOW = [
  [/^platform\/auth\/src\/firebase\.ts$/, ['google api key', 'hardcoded secret']],
  [
    /^services\/agent-builder\/(?:src\/engine\/guardrails\/index\.ts|test\/api\.test\.ts)$/,
    ['google api key', 'openai api key', 'anthropic api key', 'github token', 'slack token'],
  ],
  // Fixtures and setup docs are where placeholder secrets live by definition.
  [/^services\/[^/]+\/test\//, ['hardcoded secret']],
  [/^services\/[^/]+\/README\.md$/, ['hardcoded secret']],
  [/^tools\/scripts\/backup-guard\.mjs$/, null], // this file is all patterns
];

/**
 * Filenames that carry credentials whatever is inside them. "credentials" has
 * to be the name or a segment of it — `providerCredentials.ts` is a module
 * about them, not a file full of them.
 */
const RISKY_NAME =
  /(?:^|\/)\.env(?:\..*)?$|(?:^|[/_.-])credentials?(?:\.[a-z0-9]+)?$|(?:^|[/_.-])service[_-]?account|\.pem$|\.p12$|\.pfx$|\.keystore$|(?:^|[/_.-])id_(?:rsa|dsa|ecdsa|ed25519)|settings\.local\.json$/i;

const allowed = (path, marker) =>
  ALLOW.some(([re, markers]) => re.test(path) && (markers === null || markers.includes(marker)));

const MAX_BYTES = 4 << 20;

/* Default: only what this backup would commit. `--all-tracked` sweeps every
   tracked file instead, which is what you want before a first public push. */
const sweepAll = process.argv.includes('--all-tracked');
const staged = (
  sweepAll
    ? git(['ls-files', '-z'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
)
  .split('\0')
  .filter(Boolean);

if (!staged.length) {
  console.log('[guard] Nothing staged — nothing to check.');
  process.exit(0);
}

const fatals = [];
const warns = [];

/* Ignore rules are not retroactive: a file added before its rule existed stays
   tracked, and `git add -A` keeps re-staging it. That is worth stopping for. */
const trackedButIgnored = git(['ls-files', '-c', '-i', '--exclude-standard'])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

for (const path of staged) {
  if (RISKY_NAME.test(path)) fatals.push({ path, line: 0, marker: 'credential filename', text: path });

  let buf;
  try {
    buf = execFileSync('git', ['show', `:${path}`], { maxBuffer: MAX_BYTES + (8 << 20) });
  } catch {
    continue; // unreadable or gone from the index
  }
  if (buf.length > MAX_BYTES) continue;
  if (buf.includes(0)) continue; // binary

  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    if (text.includes('backup-guard:allow')) return;
    for (const [marker, re] of FATAL) {
      if (re.test(text) && !allowed(path, marker)) fatals.push({ path, line: i + 1, marker, text });
    }
    for (const [marker, re] of WARN) {
      if (re.test(text) && !allowed(path, marker)) warns.push({ path, line: i + 1, marker, text });
    }
  });
}

/** Never echo a secret back — show where it is, not what it is. */
const mask = (text) => {
  const t = text.trim();
  return (t.length > 60 ? `${t.slice(0, 60)}…` : t).replace(/[A-Za-z0-9_\-.]{16,}/g, (m) => `${m.slice(0, 4)}…[${m.length} chars]`);
};

const group = (rows) => {
  const byMarker = new Map();
  rows.forEach((r) => {
    if (!byMarker.has(r.marker)) byMarker.set(r.marker, []);
    byMarker.get(r.marker).push(r);
  });
  return byMarker;
};

console.log(`[guard] Scanned ${staged.length} staged file(s).`);

if (warns.length) {
  console.log('\n[guard] Already-public details, listed so nothing is a surprise:');
  for (const [marker, rows] of group(warns)) {
    const shown = rows.slice(0, 6).map((r) => `${r.path}:${r.line}`).join(', ');
    console.log(`  - ${marker} in ${rows.length} place(s): ${shown}${rows.length > 6 ? ', …' : ''}`);
  }
}

if (trackedButIgnored.length) {
  console.log(`\n[guard] BLOCKED: ${trackedButIgnored.length} tracked file(s) that .gitignore says to exclude.`);
  console.log('        Ignore rules do not apply retroactively — untrack them once and they stay out:');
  trackedButIgnored.slice(0, 20).forEach((p) => console.log(`  git rm --cached "${p}"`));
  if (trackedButIgnored.length > 20) console.log(`  … and ${trackedButIgnored.length - 20} more`);
}

if (fatals.length) {
  console.log(`\n[guard] BLOCKED: ${fatals.length} finding(s) that must not be published.`);
  for (const [marker, rows] of group(fatals)) {
    console.log(`\n  ${marker} — ${rows.length} hit(s)`);
    rows.slice(0, 10).forEach((r) => {
      console.log(`    ${r.path}${r.line ? `:${r.line}` : ''}`);
      if (r.line) console.log(`        ${mask(r.text)}`);
    });
    if (rows.length > 10) console.log(`    … and ${rows.length - 10} more`);
  }
  console.log('\n  Fix, or add `backup-guard:allow` to the line if it is genuinely safe.');
}

if (fatals.length || trackedButIgnored.length) {
  console.log('\n[guard] Nothing was committed. The repository is public — this is the last');
  console.log('        checkpoint before a push becomes permanent.\n');
  process.exit(1);
}

console.log('[guard] Clear.');
