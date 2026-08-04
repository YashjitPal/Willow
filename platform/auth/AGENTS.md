# platform/auth

Firebase authentication and user-data hooks. The source of truth for "who is
logged in" and their profile, API keys, and settings.

## Files

| Path | Role |
| --- | --- |
| `src/AuthContext.tsx` | React context. Wraps Firebase `onAuthStateChanged`. Exposes user, profile, sign in/out, Drive connect/disconnect. |
| `src/UserDataContext.tsx` | React context. Provides a nested boundary inside `App.tsx`; scopes user-data loading to authenticated children. |
| `src/use-user-data.ts` | Hook. API keys + settings (Firestore-backed, cached in `sessionStorage`), plus setters for each. |
| `src/firebase.ts` | Firebase app initialization (from env `VITE_FIREBASE_*`). |
| `src/upload-avatar.ts` | Uploads a File to Firebase Storage, returns the public URL. |

## How it is wired

1. `apps/studio/src/main.tsx` wraps the app in `<AuthProvider>` (from `AuthContext.tsx`).
2. Inside `App.tsx`, when the user is authenticated, the shell wraps the content area
   in `<UserDataProvider>` (from `UserDataContext.tsx`).
3. Every feature below those boundaries calls:
   - `useAuth()` (from `AuthContext.tsx`) — `{ user, userProfile, loading, error,
     accessToken, driveAccessToken, isDriveConnected, signInWithGoogle, signOut,
     connectDrive, disconnectDrive, updateUserProfile, completeOnboarding }`.
   - `useUserData()` (from `use-user-data.ts`) — `{ apiKeys, settings, loading,
     synced, addGeminiKey, removeGeminiKey, addOpenAIKey, ... }`. Keys and settings
     sync to Firestore and survive tab reloads via `sessionStorage` cache.

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
