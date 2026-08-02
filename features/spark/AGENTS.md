# features/spark

Scheduling agent + browser automation. The user defines tasks (e.g. "every weekday
at 9am, check my inbox and summarise") and Spark executes them on a schedule.

## Files

| Path | Role |
| --- | --- |
| `src/SparkWorkspace.tsx` | Entry workspace (1308 lines). Task dashboard. |
| `src/SparkHome.tsx` | The launch / suggested-tasks grid. |
| `src/SparkTaskDetail.tsx` | Task detail/edit view (2196 lines). |
| `src/spark-composer-chips.tsx` | Shared composer pieces: chip rows, tool labels, icon defaults, file-merge helper (128 lines). |
| `src/SparkAllTasks.tsx` | Full task list. |
| `src/SparkScheduleEditor.tsx` | Cron/time picker widget. |
| `src/SparkSkillEditor.tsx` | User-defined skill editor (LLM prompt templates). |
| `src/SparkCustomisePages.tsx` | Task customisation (1150 lines). |
| `src/SparkComputerUsePanel.tsx` | Browser-context panel for computer-use mode. |
| `src/SparkDictationWaveform.tsx` · `src/useSparkDictation.ts` | Voice-activation UI. |
| `src/useSparkNow.ts` | The "run now" hook. |
| `src/spark-store.ts` | Nanostore (1478 lines). Task state, scheduling, globals. |
| `src/spark-types.ts` | Shared types (`SparkTask`, `SparkSchedule`, `SparkSkill`, …). |
| `src/attachment-storage.ts` | File attachment persistence. |
| `src/browser-tabs-bridge.ts` | Connects the Spark agent to `chrome.tabs` / `browser.tabs`. |

## Architecture

Spark is nearly stateless-to-the-user: the store (`spark-store.ts`) is the action
hub, and the UI components dispatch through it. The backend agent (in
`@willow/ai/computer-use/session.ts`) is the runner; Spark is the scheduler.

## Splits

`SparkTaskDetail.tsx` was 2310 lines; the composer chips (file/tool context rows,
attachment pills), the tool-name labels, the MaterialSymbol icon defaults, and
`mergeSelectedFiles` moved to `spark-composer-chips.tsx` (128 lines). That helper
was duplicated byte-for-byte in `SparkAllTasks.tsx` and `SparkHome.tsx` — all
three now import it from one place. `spark-store.ts` (1478 lines) is the
remaining split candidate; its exports are widely referenced — verify before any
move.
