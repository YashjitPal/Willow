# platform/auth

Firebase authentication and user-data hooks. The source of truth for "who is
logged in" and their profile, API keys, and settings.

## Files

| Path | Role |
| --- | --- |
| `src/AuthContext.tsx` | React context. Wraps Firebase `onAuthStateChanged`. Exposes user, profile, sign in/out, Drive connect/disconnect. |
| `src/UserDataContext.tsx` | React context. Provides a nested boundary inside `App.tsx`, mounted signed in or out. |
| `src/use-user-data.ts` | Hook. API keys (**device-only, `localStorage`**) + settings (Firestore-backed, cached in `sessionStorage`), plus setters for each. |
| `src/device-keys.ts` | The keys' one slot on the device, and `adoptAccountKeys`, which folds the per-account slots older builds wrote into it. |
| `src/firebase.ts` | Firebase app initialization (from env `VITE_FIREBASE_*`). |
| `src/upload-avatar.ts` | Uploads a File to Firebase Storage, returns the public URL. |

## How it is wired

1. `apps/studio/src/main.tsx` wraps the app in `<AuthProvider>` (from `AuthContext.tsx`).
2. Inside `App.tsx` the shell wraps the content area in `<UserDataProvider>` (from
   `UserDataContext.tsx`), signed in or out.
3. Every feature below those boundaries calls:
   - `useAuth()` (from `AuthContext.tsx`) — `{ user, userProfile, loading, error,
     accessToken, driveAccessToken, isDriveConnected, signInWithGoogle, signOut,
     connectDrive, disconnectDrive, updateUserProfile, completeOnboarding,
     workspaceColor, setWorkspaceColor }`.

**The workspace colour is the same signed in or out.** Read `workspaceColor` from
`useAuth()`, never `userProfile.workspaceColor`: signed in it is the account's colour,
mirrored to the device (`willow_workspace_color` in localStorage), so signing out changes
nothing; signed out it is the device's, and `setWorkspaceColor` keeps a pick there (and on
the account when there is one). An account that never chose a colour adopts the device's.
`apps/studio/test/workspace-color.test.mjs` fails on a direct profile read. The background
works the same way: `BackgroundContext` mirrors the account's to `DEVICE_BACKGROUND_KEY`, and
an account without one adopts the device's.

**Signing in is optional, and gates nothing.** Every feature runs signed out: the prompts,
Agents, Search chats, Notebooks, the projects showcase, and every model call. Only what
genuinely needs a Google account checks `user` — Drive, the account menu, sign-out, deleting
the account. `apps/studio/test/signed-out-parity.test.mjs` pins the gates that were removed.
   - `useUserData()` (from `use-user-data.ts`) — `{ apiKeys, settings, loading,
     synced, addGeminiKey, removeGeminiKey, addOpenAIKey, ... }`. Settings sync to
     Firestore; `synced` refers to them alone. **Keys never do** — see below.

**A "no user" after a user is held back for `SIGN_OUT_CONFIRM_MS`.** Opening
another Willow tab rewrites Firebase's shared sign-in record, and an open tab can
read it mid-write: it reported "No user", then the same user about two seconds
later (seen in `[Auth] State changed` logs). Applied as given, that is an account
switch, which tears down every chat scope and stops every running chat and Spark
turn in the open tab. The listener applies a sign-out from elsewhere only if it
still holds after the wait; `signOut()` here sets `explicitSignOutRef` and applies
at once.

## API keys never leave the device

Willow used to write a signed-in user's provider keys to `users/{uid}` in
Firestore as plaintext strings, which put third-party credentials the user is
billed for inside a database the project owner can read. It does not any more,
and nothing in this package may reintroduce it.

- Keys live in `localStorage` under `willow:apiKeys:device` and
  `willow:providerState:device` (`DEVICE_KEY_SLOT`) — the device's, the same signed
  in or out, so signing out never stops a model running. Older builds kept one slot
  per account plus `guest`; the first read runs `adoptAccountKeys`, which merges
  those per provider (current account first) and then deletes them. Once the device
  slot exists, even emptied, it is the only copy. They are
  deliberately **not** in `sessionStorage`: that was only safe while Firestore
  held the real copy, and today it would drop a user's keys on every tab close.
- With a folder connected (always, in the desktop app) they are also in `settings.json`
  at the top of it, under `apiKeys` and `baseUrls` (`@willow/core/settings-file`, the
  sections in `apps/studio/src/app/register-settings-file.ts` and `SettingsFileBridge.tsx`):
  a file on this computer, in the folder the user chose, so a new copy of Willow on the
  folder starts with them and an edit there by hand is taken. Still no network.
- `saveApiKeys` writes locally and returns. It performs no network I/O.
- The single remaining remote touch is
  `apps/studio/src/settings/provider-settings.ts` → `ensureProviderStateLoaded`,
  which runs once per account to recover keys an *older build* uploaded and then
  deletes both key fields from the document. It is an eviction, not a sync, and
  it should eventually be deleted outright once enough users have run it.

## Dependency constraint

**`platform/auth` must never import from `features/` or `apps/`.** It may import
sibling platform packages (`@willow/ui`, `@willow/core`) and that is all.

<!-- related-packages -->

## Related packages

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings
- [`features/agent-builder`](../../features/agent-builder/AGENTS.md) — the Agents workflow canvas
- [`features/auth`](../../features/auth/AGENTS.md) — login / account UI
- [`features/chat`](../../features/chat/AGENTS.md) — the standalone chat surface
- [`features/code`](../../features/code/AGENTS.md) — the Workbench: sandbox and visual editing
- [`features/design`](../../features/design/AGENTS.md) — the design surface
- [`features/media`](../../features/media/AGENTS.md) — AI image and video generation
- [`features/onboarding`](../../features/onboarding/AGENTS.md) — first-run flow
- [`features/projects`](../../features/projects/AGENTS.md) — project browser UI
- [`features/spark`](../../features/spark/AGENTS.md) — scheduling / background-task agent
- [`platform/storage`](../storage/AGENTS.md) — persistence, adapters, sync

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
