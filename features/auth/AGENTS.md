# features/auth

The login screen. One file. Aliased as **`@willow/account`** (not `@willow/auth` —
that alias belongs to `platform/auth`, the Firebase layer).

## Files

| Path | Role |
| --- | --- |
| `src/LoginPage.tsx` | The `/login` route. Sign-in / sign-up, Google OAuth, error surfaces. |

## The alias trap

There are two auth packages, and they are easy to confuse:

| Alias | Points at | Contains |
| --- | --- | --- |
| `@willow/account` | `features/auth/src` | The login **UI**. |
| `@willow/auth` | `platform/auth/src` | Firebase, `useAuth()`, `useUserData()`. |

`LoginPage.tsx` imports `@willow/auth` to do the actual signing in. Not the other
way round — `platform/auth` must never import this feature.

## Behaviour

The route reads `?mode=login` / `?mode=signup` to pick which form to show; the
sidebar's Log in / Sign up buttons link to those. All credential work goes through
`useAuth()` from `@willow/auth/AuthContext` (`signInWithGoogle`, plus the Firebase
email/password calls).

One constraint worth knowing: COOP/COEP headers break Firebase's
`signInWithPopup`, which is why `apps/studio/vite.config.ts` scopes those headers
to `/project1` only and never to this route.

<!-- related-packages -->

## Related packages

**This package imports from:**

- [`platform/auth`](../../platform/auth/AGENTS.md) — Firebase, `useAuth()`, `useUserData()`
- [`platform/core`](../../platform/core/AGENTS.md) — utilities, types, constants
- [`platform/ui`](../../platform/ui/AGENTS.md) — shared components

**Imported by:**

- [`apps/studio`](../../apps/studio/AGENTS.md) — the host shell: routing, sidebar, settings

Repo-wide conventions, the layering rule and the full package table live in
[the root `AGENTS.md`](../../AGENTS.md).
