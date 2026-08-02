# tools/ — scripts, prototypes, and research

Not shipped. Nothing here is imported by the app.

| Path | Role | Typechecked? |
| --- | --- | --- |
| `scripts/` | One-off maintenance scripts, run by hand with `node`. | **Yes** |
| `prototypes/` | Exploratory UIs and early staging prototypes. Not maintained. | No |
| `ui-research/` | Captured HTML/CSS/images from external reference UIs. | No |
| `scratch/` | Throwaway working files. | No |

`tools/scripts` is in `tsconfig.json`'s `include`, so `npm run typecheck` covers it
— a broken script fails the build gate. The other three are in `exclude`.
