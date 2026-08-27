# Security Policy

## Supported Versions

Until version 1.0, security fixes are released for the latest published minor
version only.

## Reporting

Do not disclose a suspected vulnerability in a public issue. Report it privately
to the repository owner with reproduction steps, affected versions, and the
expected impact. The standalone repository should enable GitHub private
vulnerability reporting before its first public release.

The maintainers should acknowledge a report within seven days and publish a fix
or status update within thirty days when the issue is confirmed.

## Scope

Security-sensitive areas include path validation, cross-workspace metadata
scoping, permission/error handling, conflict preservation, and any behavior that
can delete or overwrite user files.
