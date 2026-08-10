import type { ComposerAttachment } from '@willow/core/attachments';

export interface GitHubRepositoryLocation {
  owner: string;
  repository: string;
  requestedRef?: string;
  sourceUrl: string;
}

const MAX_SOURCE_FILE_BYTES = 160_000;
const MAX_CONTEXT_CHARACTERS = 420_000;
const MAX_INCLUDED_FILES = 56;
const MAX_TREE_PATHS = 900;
const FETCH_BATCH_SIZE = 8;

const TEXT_EXTENSIONS = new Set([
  'astro', 'c', 'cc', 'cfg', 'conf', 'cpp', 'cs', 'css', 'dart', 'env.example', 'go',
  'graphql', 'h', 'hpp', 'htm', 'html', 'ini', 'java', 'js', 'json', 'jsx', 'kt',
  'kts', 'less', 'lua', 'm', 'md', 'mdx', 'php', 'pl', 'properties', 'py', 'r',
  'rb', 'rs', 'sass', 'scss', 'sh', 'sql', 'svelte', 'swift', 'text', 'toml', 'ts',
  'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml',
]);

const SKIPPED_PATH_PARTS = new Set([
  '.git', '.next', '.nuxt', '.output', '.turbo', '.venv', 'build', 'coverage', 'dist',
  'node_modules', 'target', 'vendor',
]);

const PRIORITY_FILENAMES = new Set([
  'readme', 'readme.md', 'package.json', 'vite.config.js', 'vite.config.ts',
  'next.config.js', 'next.config.mjs', 'next.config.ts', 'tsconfig.json', 'pyproject.toml',
  'requirements.txt', 'cargo.toml', 'go.mod', 'dockerfile', 'compose.yaml',
  'docker-compose.yml', '.gitignore', '.env.example',
]);

function randomAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseGitHubRepositoryUrl(rawValue: string): GitHubRepositoryLocation | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repository = segments[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository)) return null;

  let requestedRef: string | undefined;
  if (segments.length > 2) {
    if (segments[2] !== 'tree' || segments.length < 4) return null;
    requestedRef = segments.slice(3).join('/');
  }

  const sourceUrl = `https://github.com/${owner}/${repository}${requestedRef ? `/tree/${requestedRef}` : ''}`;
  return { owner, repository, requestedRef, sourceUrl };
}

function getPathExtension(path: string): string {
  const fileName = path.split('/').pop()?.toLowerCase() || '';
  if (fileName === '.env.example') return 'env.example';
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1) : fileName;
}

function isUsefulTextPath(path: string, size: number): boolean {
  if (!Number.isFinite(size) || size <= 0 || size > MAX_SOURCE_FILE_BYTES) return false;
  const lower = path.toLowerCase();
  const parts = lower.split('/');
  if (parts.some((part) => SKIPPED_PATH_PARTS.has(part))) return false;
  if (/\.(min\.(js|css)|map|lock|snap)$/i.test(lower)) return false;
  return TEXT_EXTENSIONS.has(getPathExtension(lower));
}

function pathPriority(path: string): number {
  const lower = path.toLowerCase();
  const fileName = lower.split('/').pop() || lower;
  let score = lower.split('/').length * 10;
  if (PRIORITY_FILENAMES.has(fileName)) score -= 1_000;
  if (/^(src|app|lib|components|server|client)\//.test(lower)) score -= 160;
  if (/\.(ts|tsx|js|jsx|py|rs|go|java|cs|cpp|c)$/.test(lower)) score -= 80;
  if (/test|spec|fixture|example/.test(lower)) score += 80;
  return score;
}

async function fetchGitHubJson(url: string, signal?: AbortSignal): Promise<any> {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('Repository or branch was not found, or it is private.');
    if (response.status === 403) throw new Error('GitHub temporarily rate-limited this import. Try again in a little while.');
    throw new Error(`GitHub import failed (${response.status}).`);
  }
  return await response.json();
}

async function fetchRawFile(
  owner: string,
  repository: string,
  commit: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(
    `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(commit)}/${encodedPath}`,
    { signal },
  );
  if (!response.ok) return null;
  const text = await response.text();
  if (text.includes('\u0000')) return null;
  return text;
}

export async function importGitHubRepository(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<ComposerAttachment> {
  const location = parseGitHubRepositoryUrl(rawUrl);
  if (!location) {
    throw new Error('Enter a GitHub repository or branch URL.');
  }

  const repoApiBase = `https://api.github.com/repos/${encodeURIComponent(location.owner)}/${encodeURIComponent(location.repository)}`;
  const repo = await fetchGitHubJson(repoApiBase, signal);
  const sourceRef = location.requestedRef || repo.default_branch || 'main';
  const commit = await fetchGitHubJson(`${repoApiBase}/commits/${encodeURIComponent(sourceRef)}`, signal);
  const commitSha = String(commit.sha || '');
  const treeSha = String(commit.commit?.tree?.sha || '');
  if (!commitSha || !treeSha) throw new Error('GitHub did not return a readable repository snapshot.');

  const treeResponse = await fetchGitHubJson(`${repoApiBase}/git/trees/${treeSha}?recursive=1`, signal);
  const tree = Array.isArray(treeResponse.tree) ? treeResponse.tree : [];
  const textFiles = tree
    .filter((entry: any) => entry?.type === 'blob' && typeof entry.path === 'string' && isUsefulTextPath(entry.path, Number(entry.size)))
    .sort((a: any, b: any) => pathPriority(a.path) - pathPriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_INCLUDED_FILES);

  const included: Array<{ path: string; text: string }> = [];
  let usedCharacters = 0;
  for (let start = 0; start < textFiles.length && usedCharacters < MAX_CONTEXT_CHARACTERS; start += FETCH_BATCH_SIZE) {
    const batch = textFiles.slice(start, start + FETCH_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (entry: any) => ({
      path: entry.path,
      text: await fetchRawFile(location.owner, location.repository, commitSha, entry.path, signal),
    })));
    for (const result of results) {
      if (!result.text) continue;
      const remaining = MAX_CONTEXT_CHARACTERS - usedCharacters;
      if (remaining <= 0) break;
      const text = result.text.slice(0, remaining);
      included.push({ path: result.path, text });
      usedCharacters += text.length;
    }
  }

  const treePaths = tree
    .filter((entry: any) => typeof entry?.path === 'string')
    .slice(0, MAX_TREE_PATHS)
    .map((entry: any) => entry.path);
  const description = typeof repo.description === 'string' ? repo.description : '';
  const context = [
    'GitHub repository snapshot imported by Willow.',
    `Repository: ${location.owner}/${location.repository}`,
    `Source URL: ${location.sourceUrl}`,
    `Ref: ${sourceRef}`,
    `Commit: ${commitSha}`,
    description ? `Description: ${description}` : '',
    '',
    `Repository tree (${treePaths.length}${tree.length > treePaths.length ? ` of ${tree.length}` : ''} paths):`,
    treePaths.join('\n'),
    '',
    ...included.flatMap(({ path, text }) => [
      `===== FILE: ${path} =====`,
      text,
      '',
    ]),
  ].filter((line) => line !== '').join('\n');

  const snapshot = new File(
    [context],
    `${location.repository}-${sourceRef.replace(/[^A-Za-z0-9_.-]+/g, '-')}-github-context.txt`,
    { type: 'text/plain' },
  );

  return {
    id: randomAttachmentId(),
    kind: 'github',
    name: `${location.owner}/${location.repository}`,
    extension: '',
    mimeType: 'application/x-github-repository',
    size: snapshot.size,
    file: snapshot,
    sourceUrl: location.sourceUrl,
    sourceOwner: location.owner,
    sourceRepository: location.repository,
    sourceRef,
    sourceCommit: commitSha,
    sourceDescription: description || undefined,
    sourceFileCount: included.length,
  };
}
