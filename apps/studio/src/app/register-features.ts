/**
 * Feature registration.
 *
 * Some features contribute to shared platform machinery — writing their own
 * sub-folder inside a saved project, or their own top-level synced folder.
 * Platform code cannot import features (that would invert the dependency arrow
 * and make `platform/` untestable on its own), so features register themselves
 * instead, and this file is the single place that pulls those registrations in.
 *
 * Two registries exist, and a feature may use either or both:
 *  - `@willow/storage/project-contributors` — a sub-folder inside one saved
 *    project, e.g. `Code/<project>/Designs/`.
 *  - `@willow/storage/synced-folders` — a top-level workspace folder that syncs
 *    to disk on its own, e.g. `Gems/`. See ARCHITECTURE.md §13.
 *
 * Imported once, for its side effects, from apps/studio/src/main.tsx.
 * Import order does not matter; each registration is independent and
 * idempotent.
 */

import '@willow/design/register';
import '@willow/gems/register';
