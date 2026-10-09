# The native runtime (desktop app only)

On the web Spark's tools work on a private browser workspace with no shell. In the
desktop app they work on the user's computer, with Codex's own runtimes: real
commands through `exec_command` and `write_stdin`, and patches applied to files on
disk. **Same harness, same chat format, same turn loop** — only the tools, the
patch target, the turn context and the prompt profile change, and only when
`SparkHarnessOptions.native` is set. Without it nothing here runs and the web
path is byte-for-byte what it was.

```
native/
  native-host.ts           The companion's spark.* requests behind an interface (fakeable in tests).
  native-paths.ts          Paths as the disk has them: absolute keys, relative to the turn's folder, Windows-aware.
  native-tools.ts          exec_command, write_stdin, run_command (compat), and disk read_file/list_files/search_files.
  native-disk-patches.ts   apply_patch against disk: one read and one write per envelope, CRLF and BOM kept.
  native-approvals.ts      Codex's approval policies and prefix rules.
  native-context.ts        <environment_context>, <permissions instructions>, AGENTS.md, in Codex's shapes.
  native-runtime.ts        One turn's runtime: all of the above, for a task's folder or the whole computer.
```

The other half is `services/local-companion/src/spark-runtime.mjs` (its
AGENTS.md has the protocol and the security model). The app side — folders,
approvals UI, wiring — is `spark-projects.ts`, `spark-native.ts`,
`SparkApprovalPanel.tsx`, `SparkNativeBar.tsx` and the sidebar's
`SparkFolderSections.tsx`.

## What is Codex's, and what is ours

Taken from Codex (openai/codex, Apache-2.0), as it is there:

- `exec_command` / `write_stdin`: the parameters, the yields and caps, the
  environment, and the response text (`Chunk ID`, `Wall time`, exit code or
  session ID, `Output:`, middle truncation by tokens). The observation the model
  reads is the companion's text, unchanged.
- **They are declared function tools**, as in Codex (`nativeToolDeclarations`,
  with the disk file tools beside them). This is load-bearing: described only in
  the prompt's text protocol, a model that checks its tool list finds no terminal
  and tells the user which commands to type instead of running them. A function
  call reaches the same handler as the `*** Call:` envelope, which still works.
- The permissions templates (`danger-full-access`, `unless-trusted`, `never`),
  the environment-context fragment, and AGENTS.md discovery (git root down to
  the cwd, `AGENTS.override.md` first, 32 KiB) and rendering.
- Prefix-rule matching: split at control operators; never rule-match
  redirection, substitution, variables, wildcards or assignments.
- The rejection strings (`exec command rejected by user`, `patch rejected by
  user`, and the `never`-policy escalation refusal) and Windows safety rules.
- The prompt keeps upstream's `Shell commands` guidance and `AGENTS.md spec`,
  which the web overlay has to replace.

Changed or added, on purpose:

- **Two policies, no sandbox.** Willow has no OS sandbox, so "ask" is
  `unless-trusted` with `danger-full-access` and "full access" is `never`.
- **Edits follow writable roots.** Codex's `unless-trusted` asks for every
  patch; here edits inside the task's folder apply without asking (as under
  `workspace-write`) and edits elsewhere ask. A task with no folder asks for
  every edit.
- **`justification` and `prefix_rule` work without `sandbox_permissions`**,
  since in "ask" every command already asks. Offered prefixes are checked:
  never an interpreter or a destructive command, never a bare package manager.
- **Disk file tools.** `read_file`, `list_files` and `search_files` replace the
  web ones by id and never ask, so looking at files costs no approval.
- **`run_command` stays**, mapped onto `exec_command`, so a chat that used it
  keeps working. `add_dependency` is refused with "run the package manager".
- **Sessions use pipes, not a PTY.** `tty` is accepted; the prompt says so.
- **No `view_image`.** The transport is text-only; the refusal says so.
- The Work Title, Final Response and work-batch rules are Spark's, shared with
  the web profile (`overlay/spark-native-profile.ts`), so chats read the same.

## Invariants

- **The web path does not change.** `spark-native-runtime.test.mjs` asserts the
  web prompt's shape; `createSparkHarnessProfile` is byte-identical to before
  for every context (checked when the shared pieces were extracted).
- **A folder task never silently falls back.** If the companion is unreachable,
  a task with no folder runs on the browser workspace as before; a task in a
  folder fails with a message (`spark-native.ts`).
- **Stopping a task stops its commands.** The runtime kills the task's sessions
  when the turn is aborted; finished turns may leave a server running, and the
  prompt tells the model to stop what it started unless asked otherwise.
- **Approvals never block forever.** A pending approval resolves `deny` when
  the turn is stopped.
- **Function-call rounds stay legible and recoverable.** A run of terminal
  calls is one iteration with many rounds; `runtime/AGENTS.md` ("Function-Call
  Rounds") has the rules that keep its narration apart and its calls in the
  turn's history.

## Tests

- `apps/studio/test/spark-native-runtime.test.mjs`: paths, rules, context
  fragments, disk patches, the tools, the desktop prompt, and whole turns
  against a fake computer.
- `apps/studio/test/spark-projects.test.mjs`: folders, policies, prefixes, the
  approval queue.
- `npm run spark --prefix services/local-companion`: the companion half against
  real processes.
