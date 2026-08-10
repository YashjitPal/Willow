#!/usr/bin/env node
/**
 * One-shot repository restructure: "Front End / Back End" -> monorepo layout.
 *
 * Run from the repo root:  node tools/scripts/migrate-layout.mjs
 *
 * Phase 1 moves files according to MOVES (files and whole directories).
 * Phase 2 rewrites every import/export specifier in the moved tree so that
 * intra-package references stay relative and cross-package references use the
 * `@willow/*` path aliases declared in tsconfig.base.json + vite.config.ts.
 *
 * The script is idempotent-ish: sources that no longer exist are skipped, so a
 * partial run can be re-run safely.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');

const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ *
 * Package map: alias prefix -> directory that backs it.
 * Longest match wins when classifying a file.
 * ------------------------------------------------------------------ */
const PACKAGES = [
  ['@willow/core', 'platform/core/src'],
  ['@willow/ai', 'platform/ai/src'],
  ['@willow/storage', 'platform/storage/src'],
  ['@willow/auth', 'platform/auth/src'],
  ['@willow/ui', 'platform/ui/src'],
  ['@willow/projects', 'platform/projects/src'],
  ['@willow/chat', 'features/chat/src'],
  ['@willow/code', 'features/code/src'],
  ['@willow/media', 'features/media/src'],
  ['@willow/agent-builder', 'features/agent-builder/src'],
  ['@willow/spark', 'features/spark/src'],
  ['@willow/design', 'features/design/src'],
  ['@willow/figma', 'features/figma/src'],
  ['@willow/onboarding', 'features/onboarding/src'],
  ['@willow/account', 'features/auth/src'],
  ['@willow/project-browser', 'features/projects/src'],
  ['@willow/studio', 'apps/studio/src'],
  ['@willow/assets', 'assets'],
];

/* ------------------------------------------------------------------ *
 * MOVES — [from, to]. A trailing '/' on both sides means "move directory
 * contents". Paths are repo-root relative and use forward slashes.
 * ------------------------------------------------------------------ */
const D = 'Front End/Dashboard';

const MOVES = [
  /* ---------------- services (node backends) ---------------- */
  ['Back End/agent-builder/', 'services/agent-builder/'],
  ['Back End/local-companion/', 'services/local-companion/'],

  /* ---------------- shared assets ---------------- */
  ['Front End/Animation/', 'assets/animations/'],
  ['Front End/Content/', 'assets/media-samples/'],
  ['Front End/cursor/', 'assets/cursors/'],
  ['Front End/Images for prompt suggestions (Willow Code)/', 'assets/prompt-suggestions/'],
  ['Front End/logo.png', 'assets/brand/willow-logo.png'],
  ['Front End/logog.png', 'assets/brand/willow-glyph.png'],
  [`${D}/src/assets/logo.png`, 'assets/brand/logo.png'],
  [`${D}/src/assets/logog.png`, 'assets/brand/logo-glyph.png'],
  [`${D}/src/assets/newspaper.png`, 'assets/brand/newspaper.png'],

  /* ---------------- platform/core ---------------- */
  [`${D}/lib/utils.ts`, 'platform/core/src/utils.ts'],
  [`${D}/lib/color-utils.ts`, 'platform/core/src/color.ts'],
  [`${D}/lib/displayName.ts`, 'platform/core/src/display-name.ts'],
  [`${D}/lib/dialogFocus.ts`, 'platform/core/src/dialog-focus.ts'],
  [`${D}/lib/dashboard-layout.ts`, 'platform/core/src/layout.ts'],
  [`${D}/lib/jsonSchemaValidation.ts`, 'platform/core/src/json-schema.ts'],
  [`${D}/lib/stores/error-store.ts`, 'platform/core/src/error-store.ts'],
  [`${D}/types.ts`, 'platform/core/src/types.ts'],

  /* ---------------- platform/ai (the provider / custom-API system) ---- */
  [`${D}/lib/ai.ts`, 'platform/ai/src/chat.ts'],
  [`${D}/lib/live.ts`, 'platform/ai/src/live.ts'],
  [`${D}/lib/transcription.ts`, 'platform/ai/src/transcription.ts'],
  [`${D}/lib/provider-endpoints.ts`, 'platform/ai/src/providers/endpoints.ts'],
  [`${D}/lib/model-efforts.ts`, 'platform/ai/src/models/efforts.ts'],
  ['defaultmodel.ts', 'platform/ai/src/models/defaults.ts'],
  [`${D}/lib/computer-use.ts`, 'platform/ai/src/computer-use/session.ts'],
  [`${D}/lib/test-store.ts`, 'platform/ai/src/computer-use/test-store.ts'],

  /* ---------------- platform/storage (local-first sync) -------------- */
  [`${D}/context/LocalFSContext.tsx`, 'platform/storage/src/local-fs/LocalFSContext.tsx'],
  [`${D}/lib/localFileSystemService.ts`, 'platform/storage/src/adapters/local-disk.ts'],
  [`${D}/lib/localFileSystemBinary.test.ts`, 'platform/storage/src/adapters/local-disk.test.ts'],
  [`${D}/lib/driveService.ts`, 'platform/storage/src/adapters/google-drive.ts'],
  [`${D}/lib/driveServiceBinary.test.ts`, 'platform/storage/src/adapters/google-drive.test.ts'],
  [`${D}/lib/driveProjectDiscovery.ts`, 'platform/storage/src/adapters/drive-discovery.ts'],
  [`${D}/lib/driveProjectDiscovery.test.ts`, 'platform/storage/src/adapters/drive-discovery.test.ts'],
  [`${D}/hooks/useDrive.ts`, 'platform/storage/src/adapters/use-drive.ts'],
  [`${D}/lib/willowDB.ts`, 'platform/storage/src/indexeddb/willow-db.ts'],
  [`${D}/lib/mediaStorage.ts`, 'platform/storage/src/media-storage.ts'],
  [`${D}/lib/codeChatStorage.ts`, 'platform/storage/src/code-chat-storage.ts'],
  [`${D}/lib/coverUtils.ts`, 'platform/storage/src/covers.ts'],
  [`${D}/hooks/useAutoSave.ts`, 'platform/storage/src/use-auto-save.ts'],
  [`${D}/STORAGE_SYNC.md`, 'platform/storage/ARCHITECTURE.md'],
  [`${D}/MEDIA_STORAGE.md`, 'platform/storage/MEDIA.md'],

  /* ---------------- platform/projects (registry) --------------------- */
  [`${D}/lib/projectStorage.ts`, 'platform/projects/src/registry.ts'],
  [`${D}/lib/projectRename.ts`, 'platform/projects/src/rename.ts'],
  [`${D}/lib/projectFileContent.ts`, 'platform/projects/src/file-content.ts'],
  [`${D}/lib/projectFileContent.test.ts`, 'platform/projects/src/file-content.test.ts'],

  /* ---------------- platform/auth ------------------------------------ */
  [`${D}/context/AuthContext.tsx`, 'platform/auth/src/AuthContext.tsx'],
  [`${D}/context/UserDataContext.tsx`, 'platform/auth/src/UserDataContext.tsx'],
  [`${D}/hooks/useUserData.ts`, 'platform/auth/src/use-user-data.ts'],
  [`${D}/lib/firebaseConfig.ts`, 'platform/auth/src/firebase.ts'],
  [`${D}/lib/uploadAvatar.ts`, 'platform/auth/src/upload-avatar.ts'],

  /* ---------------- platform/ui -------------------------------------- */
  [`${D}/components/ui/`, 'platform/ui/src/'],
  [`${D}/components/hooks/use-auto-resize-textarea.ts`, 'platform/ui/src/hooks/use-auto-resize-textarea.ts'],
  [`${D}/components/GithubImportDialog.tsx`, 'platform/ui/src/github/GithubImportDialog.tsx'],
  [`${D}/lib/githubRepository.ts`, 'platform/ui/src/github/repository.ts'],

  /* ---------------- features/chat ------------------------------------ */
  [`${D}/components/DashboardChat.tsx`, 'features/chat/src/ChatView.tsx'],
  [`${D}/components/InputBar.tsx`, 'features/chat/src/composer/Composer.tsx'],
  [`${D}/components/InputBar.css`, 'features/chat/src/composer/Composer.css'],
  [`${D}/components/PlusDropdownMenu.tsx`, 'features/chat/src/composer/PlusDropdownMenu.tsx'],
  [`${D}/components/ChatResponseChrome.tsx`, 'features/chat/src/ChatResponseChrome.tsx'],
  [`${D}/lib/stores/chat-store.ts`, 'features/chat/src/chat-store.ts'],
  [`${D}/lib/chatAttachments.ts`, 'features/chat/src/attachments.ts'],

  /* ---------------- features/code ------------------------------------ */
  [`${D}/components/CodeWorkspace.tsx`, 'features/code/src/CodeHome.tsx'],
  [`${D}/components/CodeWorkspaceSkeleton.tsx`, 'features/code/src/CodeHomeSkeleton.tsx'],
  [`${D}/components/staging/StagingView.tsx`, 'features/code/src/WorkbenchView.tsx'],
  [`${D}/components/staging/StagingSidebar.tsx`, 'features/code/src/workbench/WorkbenchSidebar.tsx'],
  [`${D}/components/staging/StagingMainPreview.tsx`, 'features/code/src/workbench/WorkbenchPreview.tsx'],
  [`${D}/components/staging/StagingTopBar.tsx`, 'features/code/src/workbench/WorkbenchTopBar.tsx'],
  [`${D}/components/staging/StagingCodePanel.tsx`, 'features/code/src/workbench/CodePanel.tsx'],
  [`${D}/components/staging/TestingIndicator.tsx`, 'features/code/src/workbench/TestingIndicator.tsx'],
  [`${D}/components/staging/UnsavedChangesBar.tsx`, 'features/code/src/workbench/UnsavedChangesBar.tsx'],
  [`${D}/components/staging/UnsavedChangesModal.tsx`, 'features/code/src/workbench/UnsavedChangesModal.tsx'],
  [`${D}/components/staging/VisualEditingOverlay.tsx`, 'features/code/src/visual-editing/VisualEditingOverlay.tsx'],
  [`${D}/components/staging/VisualEditToolbar.tsx`, 'features/code/src/visual-editing/VisualEditToolbar.tsx'],
  [`${D}/components/staging/VisualEditorSelectMenu.tsx`, 'features/code/src/visual-editing/VisualEditorSelectMenu.tsx'],
  [`${D}/lib/visual-editor/`, 'features/code/src/visual-editing/engine/'],
  [`${D}/lib/sandpack/`, 'features/code/src/runtime/sandpack/'],
  [`${D}/lib/preview/`, 'features/code/src/runtime/preview/'],
  [`${D}/lib/local-companion.ts`, 'features/code/src/local-companion.ts'],

  /* ---------------- features/design ---------------------------------- */
  [`${D}/components/staging/DesignCanvas.tsx`, 'features/design/src/DesignCanvas.tsx'],
  [`${D}/components/staging/DesignNode.tsx`, 'features/design/src/DesignNode.tsx'],
  [`${D}/components/staging/DesignChat.tsx`, 'features/design/src/DesignChat.tsx'],
  [`${D}/components/staging/ColorPickerMenu.tsx`, 'features/design/src/ColorPickerMenu.tsx'],
  [`${D}/lib/stores/design-store.ts`, 'features/design/src/design-store.ts'],

  /* ---------------- features/media ----------------------------------- */
  [`${D}/components/media/MediaView.tsx`, 'features/media/src/MediaView.tsx'],
  [`${D}/components/media/MusicView.tsx`, 'features/media/src/music/MusicView.tsx'],
  [`${D}/components/media/MusicPlayerSidebar.tsx`, 'features/media/src/music/MusicPlayerSidebar.tsx'],
  [`${D}/components/media/CharactersView.tsx`, 'features/media/src/characters/CharactersView.tsx'],
  [`${D}/components/media/AgentSidebar.tsx`, 'features/media/src/AgentSidebar.tsx'],
  [`${D}/components/AssetMenuModal.tsx`, 'features/media/src/AssetMenuModal.tsx'],
  [`${D}/components/HeroSection.tsx`, 'features/media/src/MediaHome.tsx'],
  [`${D}/components/BottomPanel.tsx`, 'features/media/src/MediaShowcase.tsx'],

  /* ---------------- features/agent-builder --------------------------- */
  [`${D}/components/agents/`, 'features/agent-builder/src/'],
  [`${D}/hooks/useAgentBuilderBackend.ts`, 'features/agent-builder/src/use-agent-builder-backend.ts'],
  [`${D}/lib/agentBuilder.ts`, 'features/agent-builder/src/agent-builder.ts'],
  [`${D}/lib/stores/agent-builder-store.ts`, 'features/agent-builder/src/agent-builder-store.ts'],
  [`${D}/lib/agentUsageDisplay.ts`, 'features/agent-builder/src/usage-display.ts'],
  [`${D}/lib/agentUsageDisplay.test.ts`, 'features/agent-builder/src/usage-display.test.ts'],
  [`${D}/lib/evaluationResultInspection.ts`, 'features/agent-builder/src/evaluation-inspection.ts'],
  [`${D}/lib/evaluationResultInspection.test.ts`, 'features/agent-builder/src/evaluation-inspection.test.ts'],

  /* ---------------- features/spark ----------------------------------- */
  [`${D}/components/spark/`, 'features/spark/src/'],
  [`${D}/lib/stores/spark-store.ts`, 'features/spark/src/spark-store.ts'],
  [`${D}/lib/spark-attachment-storage.ts`, 'features/spark/src/attachment-storage.ts'],
  [`${D}/lib/browser-tabs-bridge.ts`, 'features/spark/src/browser-tabs-bridge.ts'],

  /* ---------------- features/figma ----------------------------------- */
  ['Front End/Figma/', 'features/figma/src/'],

  /* ---------------- features/projects (project browser) -------------- */
  [`${D}/components/ProjectsPage.tsx`, 'features/projects/src/ProjectsPage.tsx'],

  /* ---------------- features/onboarding + auth screens --------------- */
  [`${D}/components/Onboarding.tsx`, 'features/onboarding/src/Onboarding.tsx'],
  [`${D}/components/LoginPage.tsx`, 'features/auth/src/LoginPage.tsx'],

  /* ---------------- apps/studio (host shell) ------------------------- */
  [`${D}/App.tsx`, 'apps/studio/src/app/App.tsx'],
  [`${D}/index.tsx`, 'apps/studio/src/main.tsx'],
  [`${D}/index.html`, 'apps/studio/index.html'],
  [`${D}/vite.config.ts`, 'apps/studio/vite.config.ts'],
  [`${D}/package.json`, 'apps/studio/package.json'],
  [`${D}/package-lock.json`, 'apps/studio/package-lock.json'],
  [`${D}/metadata.json`, 'apps/studio/metadata.json'],
  [`${D}/vercel.json`, 'apps/studio/vercel.json'],
  [`${D}/firebase.json`, 'apps/studio/firebase.json'],
  [`${D}/.firebaserc`, 'apps/studio/.firebaserc'],
  [`${D}/.env.local`, 'apps/studio/.env.local'],
  [`${D}/public/`, 'apps/studio/public/'],
  [`${D}/scripts/`, 'apps/studio/scripts/'],
  [`${D}/test/`, 'apps/studio/test/'],
  [`${D}/constants.ts`, 'apps/studio/src/shell/sample-projects.ts'],
  [`${D}/components/Sidebar.tsx`, 'apps/studio/src/shell/sidebar/Sidebar.tsx'],
  [`${D}/components/Sidebar.css`, 'apps/studio/src/shell/sidebar/Sidebar.css'],
  [`${D}/components/sidebar/`, 'apps/studio/src/shell/sidebar/'],
  [`${D}/components/SearchModal.tsx`, 'apps/studio/src/shell/SearchModal.tsx'],
  [`${D}/components/SearchModal.css`, 'apps/studio/src/shell/SearchModal.css'],
  [`${D}/components/TopDropdown.tsx`, 'apps/studio/src/shell/TopDropdown.tsx'],
  [`${D}/context/BackgroundContext.tsx`, 'apps/studio/src/shell/BackgroundContext.tsx'],
  [`${D}/components/SettingsModal.tsx`, 'apps/studio/src/settings/SettingsModal.tsx'],
  [`${D}/components/SettingsModal.css`, 'apps/studio/src/settings/SettingsModal.css'],
  [`${D}/components/settings/`, 'apps/studio/src/settings/tabs/'],

  /* ---------------- archives ----------------------------------------- */
  [`${D}/components/staging/StagingSidebarBackup.tsx`, 'tools/prototypes/staging-backups/StagingSidebarBackup.tsx'],
  [`${D}/components/staging/StagingSidebarBackup2.tsx`, 'tools/prototypes/staging-backups/StagingSidebarBackup2.tsx'],
  [`${D}/components/staging/StagingTopBarBackup.tsx`, 'tools/prototypes/staging-backups/StagingTopBarBackup.tsx'],
  [`${D}/context/FileStoreContext.tsx`, 'tools/prototypes/unused/FileStoreContext.tsx'],
  ['Front End/Staging/', 'tools/prototypes/staging-app/'],
  ['Front End/Onboarding/', 'tools/prototypes/onboarding-app/'],
];

/* ------------------------------------------------------------------ *
 * Phase 1 — PLAN the moves (no filesystem changes yet).
 *
 * Import specifiers must be resolved against the *original* tree, so the
 * whole map has to exist before anything is touched on disk.
 * ------------------------------------------------------------------ */
const moveMap = new Map(); // absolute old -> absolute new

/** Directories never walked file-by-file: moved wholesale or left behind. */
const OPAQUE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.vercel', '.firebase',
  '.playwright-cli', '.turbo', 'coverage',
  'data', // agent-builder runtime state (sqlite + keyring); may be held open
]);

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && OPAQUE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** Whole-directory renames done after the file moves (deps, runtime state). */
const OPAQUE_MOVES = [
  ['Back End/agent-builder/node_modules', 'services/agent-builder/node_modules'],
  ['Back End/agent-builder/data', 'services/agent-builder/data'],
  ['Front End/Dashboard/node_modules', 'node_modules'],
];

const dirsToPrune = [];
for (const [from, to] of MOVES) {
  const fromAbs = path.resolve(ROOT, from);
  const toAbs = path.resolve(ROOT, to);
  if (!fs.existsSync(fromAbs)) {
    log(`  - missing (skip): ${from}`);
    continue;
  }
  if (from.endsWith('/')) {
    for (const f of walkFiles(fromAbs)) {
      moveMap.set(f, path.join(toAbs, path.relative(fromAbs, f)));
    }
    dirsToPrune.push(fromAbs);
  } else {
    moveMap.set(fromAbs, toAbs);
  }
}
log(`\nPhase 1: planned ${moveMap.size} file moves.`);

/* ------------------------------------------------------------------ *
 * Phase 2 — rewrite import specifiers
 * ------------------------------------------------------------------ */
const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXT = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.css', '.json', '.png', '.svg', '.mp4'];

/** Package (alias, dirAbs) that owns an absolute path, longest dir first. */
const PKG_DIRS = PACKAGES
  .map(([alias, dir]) => ({ alias, dirAbs: path.resolve(ROOT, dir) }))
  .sort((a, b) => b.dirAbs.length - a.dirAbs.length);

function pkgOf(absPath) {
  return PKG_DIRS.find((p) => absPath === p.dirAbs || absPath.startsWith(p.dirAbs + path.sep));
}

/** Resolve a relative specifier from a directory to an existing file. */
function resolveTarget(fromDirAbs, spec) {
  const base = path.resolve(fromDirAbs, spec);
  for (const ext of RESOLVE_EXT) {
    const c = base + ext;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  for (const ext of RESOLVE_EXT) {
    if (!ext) continue;
    const c = path.join(base, 'index' + ext);
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Strip a resolvable extension so the emitted specifier stays extensionless. */
function stripExt(p) {
  const ext = path.extname(p);
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    const b = p.slice(0, -ext.length);
    return b.endsWith('.d') ? b.slice(0, -2) : b;
  }
  return p; // keep .css/.json/.png/... explicit
}

function toSpecifier(fromFileAbs, targetAbs) {
  const fromPkg = pkgOf(fromFileAbs);
  const toPkg = pkgOf(targetAbs);

  if (toPkg && (!fromPkg || fromPkg.alias !== toPkg.alias)) {
    const sub = path.relative(toPkg.dirAbs, targetAbs).split(path.sep).join('/');
    const clean = stripExt(sub);
    return clean === 'index' ? toPkg.alias : `${toPkg.alias}/${clean}`;
  }

  let rel = path.relative(path.dirname(fromFileAbs), targetAbs).split(path.sep).join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return stripExt(rel);
}

// Matches: from '...'  |  import '...'  |  import('...')  |  require('...')
const SPEC_RE = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/* ------------------------------------------------------------------ *
 * Phase 2 — compute rewritten contents while the ORIGINAL tree is intact.
 * ------------------------------------------------------------------ */
const pendingWrites = new Map(); // absolute new -> rewritten source
let specsRewritten = 0;
const unresolved = [];

for (const [oldAbs, newAbs] of moveMap) {
  if (!CODE_EXT.has(path.extname(newAbs))) continue;

  const oldDir = path.dirname(oldAbs);
  const src = fs.readFileSync(oldAbs, 'utf8');
  let changed = false;

  const out = src.replace(SPEC_RE, (match, head, quote, spec) => {
    if (!spec.startsWith('.')) return match; // bare/aliased specifier: leave alone

    // Resolve against the ORIGINAL location, then map through the move.
    const oldTarget = resolveTarget(oldDir, spec);
    if (!oldTarget) {
      unresolved.push(`${path.relative(ROOT, oldAbs)} -> ${spec}`);
      return match;
    }

    const newTarget = moveMap.get(oldTarget) ?? oldTarget;
    const next = toSpecifier(newAbs, newTarget);
    if (next === spec) return match;
    changed = true;
    specsRewritten++;
    return `${head}${quote}${next}${quote}`;
  });

  if (changed) pendingWrites.set(newAbs, out);
}

log(`Phase 2: ${specsRewritten} specifiers to rewrite in ${pendingWrites.size} files.`);
if (unresolved.length) {
  log(`  ! ${unresolved.length} unresolved specifier(s) left untouched:`);
  for (const u of unresolved.slice(0, 40)) log(`    ${u}`);
}

if (DRY) process.exit(0);

/* ------------------------------------------------------------------ *
 * Phase 3 — move files, writing rewritten content where we have it.
 * ------------------------------------------------------------------ */
let moved = 0;
for (const [oldAbs, newAbs] of moveMap) {
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  if (fs.existsSync(newAbs)) {
    log(`  ! target exists, skipping: ${path.relative(ROOT, newAbs)}`);
    continue;
  }
  const rewritten = pendingWrites.get(newAbs);
  if (rewritten !== undefined) {
    fs.writeFileSync(newAbs, rewritten);
    fs.rmSync(oldAbs);
  } else {
    fs.renameSync(oldAbs, newAbs);
  }
  moved++;
}

// hoist dependency trees / runtime state (fast same-volume renames).
// MUST run before pruning source dirs: these live inside dirs we are about to
// remove, and they are untracked (node_modules, sqlite state) — deleting them
// is unrecoverable.
const lockedMoves = [];
for (const [from, to] of OPAQUE_MOVES) {
  const fromAbs = path.resolve(ROOT, from);
  const toAbs = path.resolve(ROOT, to);
  if (!fs.existsSync(fromAbs) || fs.existsSync(toAbs)) continue;
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  try {
    fs.renameSync(fromAbs, toAbs);
    log(`  moved directory: ${from} -> ${to}`);
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
    lockedMoves.push([from, to]);
    log(`  ! locked, deferred: ${from}  (${err.code})`);
  }
}

if (lockedMoves.length) {
  log(`\n  ${lockedMoves.length} director(ies) are held open by a running process.`);
  log('  Stop dev servers, then re-run this script to finish them.');
}

/* Prune source dirs — but only ones that are genuinely empty, so a stray
 * untracked file is never destroyed by the restructure. */
function removeIfEmpty(dir) {
  if (!fs.existsSync(dir)) return true;
  let entries = fs.readdirSync(dir);
  for (const e of entries) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) removeIfEmpty(p);
  }
  entries = fs.readdirSync(dir);
  if (entries.length === 0) {
    fs.rmdirSync(dir);
    return true;
  }
  log(`  ! kept (not empty): ${path.relative(ROOT, dir)} -> ${entries.slice(0, 6).join(', ')}`);
  return false;
}
for (const d of dirsToPrune) removeIfEmpty(d);

log(`Phase 3: moved ${moved} files.`);
