# Spark workspace adapters

The default Spark workspace is a private, per-account OPFS directory. Paths are
normalised and confined to `/workspace`; files over the small-file limit are not
loaded. A host may inject another adapter, such as a user-authorised mounted
folder, without changing the harness loop.

Workspace adapters must never expose arbitrary absolute paths or silently fall
back to a user's machine directory.
