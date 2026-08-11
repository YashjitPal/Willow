/**
 * Turning extracted candidates into the profile that gets stored.
 *
 * This is where the feature is actually bounded. The extractor is a model and
 * will happily return forty bullets; everything that stops the profile growing
 * without limit — deduplication, the deletion list, the sensitive screen, expiry,
 * and the per-section caps — is here, in plain code, where it can be tested and
 * cannot be argued out of by a well-phrased conversation.
 *
 * Order matters and is not arbitrary. Each stage is cheaper than the one before
 * it is allowed to reject work for, and the caps run last so that a bullet only
 * loses its place to a bullet that survived everything else.
 */

import { normalizeSectionId, PROFILE_SECTIONS } from '../profile/sections';
import { isStorableClaim } from '../profile/sensitive';
import { bulletFingerprint, type ProfileBullet } from '../profile/types';
import type { ExtractedBullet } from './extract-prompt';

/**
 * A candidate, from either half of the build.
 *
 * The extractor's bullets have no source of their own — they all came from chat
 * history — while a connector's bullets each name their product. So `source` is
 * optional per candidate and falls back to the run's source, which keeps one
 * merge path for both halves instead of two that could drift apart.
 */
export type MergeCandidate = ExtractedBullet & { source?: string };

export interface MergeInput {
  /** Everything the extractor and the connectors produced this run. */
  candidates: MergeCandidate[];
  /** Auto bullets from the previous profile. User bullets never come in here. */
  existing: ProfileBullet[];
  /** Fingerprints of bullets the user deleted. */
  suppressed: string[];
  /** Fallback source for candidates that do not name one. */
  source: string;
  /** Injected so a test can pin it and so expiry is computed once per run. */
  now: Date;
  /** Injected for deterministic ids in tests. */
  newId: () => string;
}

export interface MergeResult {
  bullets: ProfileBullet[];
  /** Counts for the build log. Nothing here is shown to the user — a list of
   *  what was rejected would restate the rejected content. */
  stats: {
    accepted: number;
    duplicate: number;
    suppressed: number;
    sensitive: number;
    expired: number;
    overCap: number;
    malformed: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Long enough to be checkable; past this it is a paragraph, not a bullet. */
const MAX_TEXT_CHARS = 220;
const MAX_EVIDENCE_CHARS = 320;

const trimTo = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;

/**
 * True when a dated bullet has aged past its section's window.
 *
 * A bullet with no date never expires, which is why the extractor is told to
 * date only time-bound facts: an undated "flying to Delhi" would sit in the
 * profile forever. Sections with a null window ignore the date entirely.
 */
export const isExpired = (bullet: { section: string; date?: string }, now: Date): boolean => {
  const section = PROFILE_SECTIONS.find((entry) => entry.id === bullet.section);
  if (!section?.expiresAfterDays || !bullet.date) return false;
  const at = Date.parse(`${bullet.date}T00:00:00Z`);
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > section.expiresAfterDays * DAY_MS;
};

/**
 * Score a bullet for the cap fight.
 *
 * Evidence length is the main term, and it is a proxy rather than a measure: the
 * extractor writes longer evidence when it has more to point at, and "mentioned
 * across four conversations" is both longer and better-supported than "mentioned
 * it". Recency breaks ties, so when two bullets are equally well-evidenced the
 * newer observation wins — which is what makes the profile track a person who
 * changes rather than one frozen at first contact.
 */
const scoreBullet = (bullet: ProfileBullet, now: Date): number => {
  const evidence = Math.min(bullet.evidence.length, 200) / 200;
  const multiSource = /\b(across|multiple|several|repeated\w*|\d+\s+(?:separate\s+)?conversations)\b/i
    .test(bullet.evidence) ? 0.35 : 0;
  const observed = Date.parse(bullet.updatedAt ?? bullet.createdAt);
  const ageDays = Number.isFinite(observed) ? (now.getTime() - observed) / DAY_MS : 365;
  // Halves roughly every four months. Slow enough that a good six-month-old fact
  // still beats a thin new one, fast enough that the profile does not calcify.
  const recency = Math.exp(-ageDays / 120) * 0.4;
  return evidence + multiSource + recency;
};

/**
 * Keep the best `cap` bullets in each section, preserving input order.
 *
 * Sorting to pick and then restoring order matters: rendering the profile in
 * score order would put the same bullet at the top every run and reorder the
 * list under the user in Settings every time a build finished.
 */
const applyCaps = (bullets: ProfileBullet[], now: Date): { kept: ProfileBullet[]; dropped: number } => {
  const kept: ProfileBullet[] = [];
  let dropped = 0;

  for (const section of PROFILE_SECTIONS) {
    const inSection = bullets.filter((bullet) => bullet.section === section.id);
    if (inSection.length <= section.cap) {
      kept.push(...inSection);
      continue;
    }
    const survivors = new Set(
      [...inSection]
        .sort((a, b) => scoreBullet(b, now) - scoreBullet(a, now))
        .slice(0, section.cap)
        .map((bullet) => bullet.id),
    );
    dropped += inSection.length - survivors.size;
    kept.push(...inSection.filter((bullet) => survivors.has(bullet.id)));
  }

  return { kept, dropped };
};

/**
 * Merge one run's candidates into the existing auto bullets.
 *
 * Existing bullets go in first and win every collision. A candidate that matches
 * one is not "the same fact stated better" — it is the extractor re-deriving
 * something it was explicitly told was already known, and replacing the stored
 * bullet with it would reset `createdAt`, lose the older evidence, and churn the
 * Settings list for no gain.
 */
export const mergeCandidates = ({
  candidates,
  existing,
  suppressed,
  source,
  now,
  newId,
}: MergeInput): MergeResult => {
  const stats: MergeResult['stats'] = {
    accepted: 0,
    duplicate: 0,
    suppressed: 0,
    sensitive: 0,
    expired: 0,
    overCap: 0,
    malformed: 0,
  };

  const blocked = new Set(suppressed);
  const seen = new Set<string>();
  const merged: ProfileBullet[] = [];

  // Carry the previous profile forward, dropping anything that has since gone
  // stale or been deleted. A bullet already stored still has to pass expiry and
  // suppression — those are properties of now, not of when it was written.
  for (const bullet of existing) {
    const fingerprint = bulletFingerprint(bullet.text);
    if (blocked.has(fingerprint)) {
      stats.suppressed += 1;
      continue;
    }
    if (isExpired(bullet, now)) {
      stats.expired += 1;
      continue;
    }
    if (seen.has(fingerprint)) {
      stats.duplicate += 1;
      continue;
    }
    seen.add(fingerprint);
    merged.push(bullet);
  }

  const stamp = now.toISOString();

  for (const candidate of candidates) {
    const section = normalizeSectionId(candidate.section);
    const text = candidate.text.trim();
    const evidence = candidate.evidence.trim();
    if (!section || !text || !evidence) {
      stats.malformed += 1;
      continue;
    }

    const fingerprint = bulletFingerprint(text);
    if (blocked.has(fingerprint)) {
      stats.suppressed += 1;
      continue;
    }
    if (seen.has(fingerprint)) {
      stats.duplicate += 1;
      continue;
    }
    // The code-level half of the sensitive rule. The prompt asked the extractor
    // not to produce these; this is what happens when it does anyway.
    if (!isStorableClaim({ text, evidence })) {
      stats.sensitive += 1;
      continue;
    }
    if (isExpired({ section, date: candidate.date }, now)) {
      stats.expired += 1;
      continue;
    }

    seen.add(fingerprint);
    merged.push({
      id: newId(),
      section,
      text: trimTo(text, MAX_TEXT_CHARS),
      source: candidate.source?.trim() || source,
      evidence: trimTo(evidence, MAX_EVIDENCE_CHARS),
      ...(candidate.date ? { date: candidate.date } : {}),
      origin: 'auto',
      createdAt: stamp,
    });
    stats.accepted += 1;
  }

  const { kept, dropped } = applyCaps(merged, now);
  stats.overCap = dropped;
  return { bullets: kept, stats };
};
