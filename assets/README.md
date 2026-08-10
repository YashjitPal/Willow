# assets/ — images, animations, and prompts

Committed static files served from `apps/studio/public/` at build time. No code.

| Path | Role |
| --- | --- |
| `animations/` | Lottie JSON files for Gemini thinking dots and gradient backgrounds. |
| `brand/` | Logo in full and glyph variants. |
| `cursors/` | Custom mouse cursors (`.cur`, `.png`). |
| `file-type-icons/` | 32px file-type icons for attachment tiles, keyed by content hash. See below. |
| `media-samples/` | Sample images and videos for the Media app's starter gallery. |
| `prompt-suggestions/` | Cover images for the Code app's template cards. |
| `voices/` | Voice preview audio files (`.mp3`, `.wav`) for voice settings. |

All of it is imported via `@willow/assets/*` (`tsconfig.base.json` aliases it) and
bundled into the app. To add a new asset, drop it here and import it as
`import myAsset from '@willow/assets/<subfolder>/filename.ext'`.

## file-type-icons/

Filenames are the first 12 hex characters of each PNG's SHA-256. The 257 mime types
an attachment tile can resolve to collapse to 30 distinct images, so hashing
de-duplicates them: `text/x-rust` and `text/x-lua` are the same bytes and share one
file. Don't rename these — `platform/core/src/file-type-icons.ts` maps mime to hash
and is generated, not hand-written.
