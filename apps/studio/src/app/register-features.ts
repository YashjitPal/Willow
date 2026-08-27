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
 *  - `@willow/storage/local-sync` — the public registration facade for both
 *    project areas and independent synced folders. See platform/storage/README.md.
 *
 * Imported once, for its side effects, from apps/studio/src/main.tsx.
 * Import order does not matter; each registration is independent and
 * idempotent.
 */

import '@willow/design/register';
import '@willow/gems/register';
import '@willow/spark/register';
import './register-model-catalog';
