/**
 * Alpine Linux's minimal root filesystem: what every bot's computer starts as.
 * The newest stable release, from Alpine's own CDN, checked against the
 * checksum Alpine publishes beside it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RELEASES = 'https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases';

const architecture = () => (process.arch === 'arm64' ? 'aarch64' : 'x86_64');

/** `latest-releases.yaml` is a list of flat maps; this reads exactly that much YAML. */
const parseReleases = (yaml) => yaml
  .split(/\n-\n|\n- /)
  .map((block) => Object.fromEntries([...block.matchAll(/^\s*-?\s*(\w+):\s*(.+)$/gm)].map((match) => [match[1], match[2].trim().replace(/^['"]|['"]$/g, '')])));

const sha256Of = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');

/**
 * The tarball in `dir`, downloading it when it is missing or does not match.
 * Resolves to `{ file, version, sha256 }`.
 */
export const fetchMinirootfs = async (dir, { onProgress, signal } = {}) => {
  const base = `${RELEASES}/${architecture()}`;
  const listing = await fetch(`${base}/latest-releases.yaml`, { signal });
  if (!listing.ok) throw new Error(`Alpine's release list is unavailable (${listing.status}).`);
  const release = parseReleases(await listing.text()).find((entry) => entry.flavor === 'alpine-minirootfs' && entry.file && entry.sha256);
  if (!release) throw new Error("Alpine's release list has no minimal root filesystem.");
  if (!/^alpine-minirootfs-[\w.-]+\.tar\.gz$/.test(release.file) || !/^[a-f0-9]{64}$/.test(release.sha256)) throw new Error("Alpine's release list looks wrong.");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, release.file);
  const existing = await sha256Of(file).catch(() => null);
  if (existing === release.sha256) return { file, version: release.version, sha256: release.sha256 };

  const response = await fetch(`${base}/${release.file}`, { signal });
  if (!response.ok || !response.body) throw new Error(`Alpine's download failed (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) onProgress?.(received / total);
  }
  const bytes = Buffer.concat(chunks);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== release.sha256) throw new Error('The Alpine download did not match its published checksum, so it was not used.');
  await fs.writeFile(`${file}.part`, bytes);
  await fs.rename(`${file}.part`, file);
  return { file, version: release.version, sha256: release.sha256 };
};
