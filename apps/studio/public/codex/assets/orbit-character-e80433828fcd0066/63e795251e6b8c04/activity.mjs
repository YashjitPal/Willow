import {
  ActivityApplyResult,
  ActivityCommandType,
  ActivityEntry,
  ActivityKind,
  ActivityOutcome,
} from "../runtime/orbit-enums.mjs";

/** @typedef {import("../../activity").CharacterActivity} CharacterActivity */

/** Owns one renderer's ordered activity episodes, independently of its render clock. */
export class CharacterActivityController {
  /** @type {CharacterActivity} */
  requested = { kind: ActivityKind.None, turnId: null };
  /** @type {CharacterActivity} */
  current = { kind: ActivityKind.None, turnId: null };
  sequence = 0n;
  episode = 0n;

  /** @param {import("../runtime/orbit-characters.mjs").Character} character */
  bind(character) {
    return (
      character.applyActivity({
        command: ActivityCommandType.Restore,
        sequence: this.sequence,
        episodeId: 0n,
        episodeHighWater: this.episode,
        activity: ActivityKind.None,
        outcome: ActivityOutcome.Neutral,
        entry: ActivityEntry.Sustained,
      }) === ActivityApplyResult.Applied
    );
  }

  /**
   * @param {import("../runtime/orbit-characters.mjs").Character} character
   * @param {boolean} fitting
   */
  apply(character, fitting) {
    const next = fitting
      ? { kind: ActivityKind.None, turnId: null }
      : this.requested;
    if (
      next.kind === this.current.kind &&
      (next.kind === ActivityKind.None || next.turnId === this.current.turnId)
    ) {
      return true;
    }
    const stopping = next.kind === ActivityKind.None;
    const result = character.applyActivity({
      command: stopping ? ActivityCommandType.Stop : ActivityCommandType.Start,
      sequence: ++this.sequence,
      episodeId: stopping ? this.episode : ++this.episode,
      episodeHighWater: 0n,
      activity: stopping ? this.current.kind : next.kind,
      // A status change alone does not establish a successful outcome.
      outcome: ActivityOutcome.Neutral,
      entry: ActivityEntry.Start,
    });
    if (result !== ActivityApplyResult.Applied) {
      return false;
    }
    this.current = next;
    return true;
  }
}
