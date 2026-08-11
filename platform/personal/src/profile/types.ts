/**
 * What a profile is made of.
 *
 * One bullet is one claim about the user plus the receipts for it. The receipts
 * are not decoration: `source` and `evidence` are what make the Settings list
 * auditable ("why does it think that?") and what let the merge decide which of
 * two contradictory bullets to keep. A bullet with no evidence is a guess with
 * good posture, and the builder drops it.
 */

import type { ProfileSectionId } from './sections';

export interface ProfileBullet {
  /** Stable across edits, rebuilds and reordering. */
  id: string;
  section: ProfileSectionId;
  /** The claim itself, one sentence, written about the user in the third person. */
  text: string;
  /**
   * Where it came from, in the user's language — "Willow chat history",
   * "Google Calendar", "You wrote this". Shown in Settings.
   */
  source: string;
  /** A short quote or paraphrase of what supports the claim. */
  evidence: string;
  /**
   * `YYYY-MM-DD`. When the thing happened for `events`, when it was observed for
   * everything else. Optional because a preference stated with no date attached
   * is still worth keeping, and inventing a date would corrupt expiry.
   */
  date?: string;
  /**
   * `auto` — derived by a build, replaceable by the next one.
   * `user` — typed or edited by the user in Settings. Never overwritten, never
   * dropped for being over the cap, and never re-derived away.
   */
  origin: 'auto' | 'user';
  createdAt: string;
  updatedAt?: string;
}

export interface ProfileState {
  /**
   * The Memory switch in Settings → Personal Intelligence. Off means the profile
   * stays stored and visible but never reaches a prompt, and no build runs.
   * Willow is being asked to stop *using* it, not to forget it — "Delete all"
   * is the separate, explicit action for that.
   */
  enabled: boolean;
  bullets: ProfileBullet[];
  /**
   * Fingerprints of bullets the user deleted.
   *
   * Without this, deletion does not work. The bullet was derived from chats that
   * are still on disk, so the next build derives it again and it reappears — the
   * user deletes the same line every week and concludes the button is broken.
   * A rebuild drops any candidate whose fingerprint is in here.
   */
  suppressed: string[];
  /** ISO instant of the last completed build. Absent until the first one runs. */
  lastBuiltAt?: string;
  /**
   * `chatId -> the chat's timestamp at the moment it was folded in.`
   *
   * This is what makes a build incremental. A chat whose timestamp has moved on
   * has new turns in it and goes back into the next batch; one that has not is
   * already represented in the bullets and costs nothing to skip. Storing the
   * timestamp rather than a bare "seen" flag is the difference between a growing
   * conversation being re-read and being ignored forever after its first build.
   */
  digested: Record<string, number>;
}

export const PROFILE_DEFAULTS: ProfileState = {
  enabled: true,
  bullets: [],
  suppressed: [],
  digested: {},
};

/**
 * A candidate bullet, as it comes back from the summarizer — before it has an
 * id, a provenance class, or any right to be believed.
 */
export interface CandidateBullet {
  section: ProfileSectionId;
  text: string;
  source: string;
  evidence: string;
  date?: string;
}

/**
 * The comparison key for "is this the same claim as that one".
 *
 * Deliberately lossy. Two builds over overlapping chats will phrase the same
 * fact differently every time — "Lives in Gainesville, Florida" and "The user
 * lives in Gainesville, FL" are one bullet, and an exact-string check would
 * stack both. Lowercase, strip everything that is not a letter or digit, drop
 * the handful of leading words a model uses to open a bullet, and keep the
 * first 48 characters of what is left.
 *
 * The 48 is a trade: shorter and genuinely distinct bullets that share an
 * opening ("Is studying computer science" / "Is studying at a community
 * college") collapse into one; longer and a rephrasing survives as a duplicate.
 * Duplicates are the more visible failure, so this errs short.
 */
const LEADING_NOISE = /^(the user |user |they |he |she |is |has |likes |prefers |wants )+/;

export const bulletFingerprint = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING_NOISE, '')
    .replace(/\s/g, '')
    .slice(0, 48);
