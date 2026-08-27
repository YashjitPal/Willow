# Contributing

Use Node.js 20 or newer and install dependencies with `npm ci`.

Before opening a change, run:

```sh
npm run typecheck
npm run test:package
npm run pack:check
```

Changes to reconciliation behavior must include a package-local contract test.
Treat failed reads, permission errors, and stale listings as inconclusive; they
must never become deletion evidence. Keep the public entry point browser-native,
UI-independent, and free of application-specific imports.

Use conventional commit-style summaries where practical. Breaking public API or
behavior changes require a major version; backward-compatible features require a
minor version; fixes require a patch version.
