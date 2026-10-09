/**
 * What Gemini Spark's "Create with Gemini" opens on (recorded 2026-10-06,
 * `tools/ui-research/captures/spark/137-create-with-gemini/`):
 *
 * - **Schedules** opens a Spark task titled "Creating a schedule": the user's "Help me
 *   schedule a task." and, at once, Gemini asking what to schedule. The reply is fixed,
 *   not a model's; the user's answer is the task's first real turn.
 * - **Skills** leaves Spark for a new chat: "Create a skill", then Gemini's question back.
 *
 * Gemini's schedule reply also offers to "react to specific updates" (event triggers);
 * Willow's schedules run on time only, so that half is left out rather than promised.
 */
export const SCHEDULE_SEED_TITLE = 'Creating a schedule';
export const SCHEDULE_SEED_PROMPT = 'Help me schedule a task.';
export const SCHEDULE_SEED_REPLY = "Let's get started! I can run recurring tasks across your Gmail, Calendar, Drive, and the web. "
  + "What would you like me to schedule? (e.g., 'Send me a news digest every morning' or "
  + "'Summarize my unread emails every weekday at 5 PM')";

export const SKILL_SEED_PROMPT = 'Create a skill';
export const SKILL_SEED_REPLY = "What do you want the skill to do? Give me a brief idea of the workflow or task, and I'll build it.";

/** How long the fixed reply waits, and then streams, before its task settles. */
export const SEEDED_REPLY_DELAY_MS = 600;
export const SEEDED_REPLY_REVEAL_MS = 1600;
