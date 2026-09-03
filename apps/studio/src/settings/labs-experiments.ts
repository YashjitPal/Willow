/**
 * The Labs roster: which experiments are offered, in what order, with what copy.
 *
 * Shared for the same reason `provider-models.ts` is. Labs is reachable two ways
 * — the modal's `tabs/LabsTab.tsx` and the standalone `tabs/labs/LabsPage.tsx` —
 * and a row that exists on one surface and not the other is a feature the user
 * can only find by luck. Both render this list, so adding an experiment is one
 * edit here plus the flag itself, and neither surface can drift from the other on
 * wording or ordering.
 *
 * The flags themselves already had one home: `experimentsStore` in
 * `@willow/core/experiments-store`, which both surfaces read and write. This is
 * only the presentation of them.
 */

import { type ExperimentId } from '@willow/core/experiments-store';

export interface LabsExperimentRow {
  /**
   * The flag this row drives, or `null` for a row with nothing behind it yet.
   *
   * The null rows are not placeholders someone forgot to finish — they are in
   * the design and they render on both surfaces, because a missing row is a
   * visible difference from the panel this was drawn from. They are inert, and
   * each surface is responsible for making them non-interactive.
   */
  id: ExperimentId | null;
  title: string;
  description: string;
  /** The state an `id: null` row is drawn in. Ignored for a real flag. */
  staticEnabled?: boolean;
}

/** Page-level copy, above the rows. Both surfaces show it verbatim. */
export const LABS_DESCRIPTION =
  'These are experimental features, that might be modified or removed. Willow is an '
  + 'alpha release — anything switched on here is unfinished and may not behave as intended.';

/**
 * Order is the shipped order and is not alphabetical: the three surface flags
 * come first because they are the ones that change what the sidebar offers, then
 * the appearance flag, then the two unwired rows.
 */
export const LABS_EXPERIMENTS: readonly LabsExperimentRow[] = [
  {
    id: 'design-surface',
    title: 'Design',
    description:
      'Shows the Design tab in the sidebar. An in-progress canvas for generating UI designs '
      + 'from text or sketches — the surface is explorable but not finished.',
  },
  {
    id: 'agents-surface',
    title: 'Agents',
    description:
      'Shows the Agents tab in the sidebar. A node-based canvas for wiring visual workflow '
      + 'pipelines — the surface is explorable but not finished.',
  },
  {
    id: 'projects-panel',
    title: 'Projects panel',
    description:
      'Shows the Projects tab in the sidebar — every saved project in one place, with a '
      + 'starred-only filter. The search box and the sort, visibility, status and creator '
      + 'controls are not wired up yet.',
  },
  {
    id: 'darker-design-background',
    title: 'Darker Design Background',
    description:
      'Applies a darker pitch-black background to the Design tab instead of the default dark gray.',
  },
  {
    id: null,
    staticEnabled: true,
    title: 'GitHub branch switching',
    description: 'Select the branch to make edits to in your GitHub repository.',
  },
  {
    id: null,
    staticEnabled: false,
    title: 'Prototyping',
    description: 'Build and share AI-powered mini-apps using natural language prompts.',
  },
];
