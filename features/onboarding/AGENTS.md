# features/onboarding

The first-run flow: asks a new user for their name and role, then marks onboarding
complete. One file.

## Files

| Path | Role |
| --- | --- |
| `src/Onboarding.tsx` | The multi-step form shown to users whose profile is incomplete. |

## How it is gated

`platform/auth`'s `AuthContext` exposes `userProfile.onboardingComplete` and a
`completeOnboarding(name, role, photoURL)` action.
`apps/studio/src/app/App.tsx` watches that flag in an effect and flips a local
`showOnboarding` state; while it is true the app returns `<Onboarding />` in place
of the whole shell. The form's `onComplete` callback clears the flag locally, and
`completeOnboarding` persists the profile to Firestore so it stays cleared on the
next load.

## Dependencies

`@willow/auth` (2) and `@willow/assets` (1). Nothing else.
