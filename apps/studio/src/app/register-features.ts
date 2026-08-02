/**
 * Feature registration.
 *
 * Some features contribute to shared platform machinery — writing their own
 * sub-folder inside a saved project, for instance. Platform code cannot import
 * features (that would invert the dependency arrow and make `platform/`
 * untestable on its own), so features register themselves instead, and this
 * file is the single place that pulls those registrations in.
 *
 * Imported once, for its side effects, from apps/studio/src/main.tsx.
 * Import order does not matter; each registration is independent and
 * idempotent.
 */

import '@willow/design/register';
