# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-26

### Added

- Filesystem-independent folder reconcile engine.
- Browser File System Access API driver with scoped metadata.
- Durable dirty records, tombstones, conflict copies, and per-item locks.
- Registries for synced folders, project areas, and project-folder writers.
- ESM bundle, TypeScript declarations, package contract tests, and MIT license.

### Security

- Reject unsafe filesystem ids and conflicting folder ownership.
- Abort deletion decisions after failed scans, state reads, or state applies.
