/*
 * Seeds Willow's Spark (in the debug Chrome's Willow tab) with tasks and a schedule that
 * mirror the reference Gemini account's list, so the two can be compared row for row.
 * The content of each thread is placeholder text, not the reference account's data.
 *
 *   node tools/scratch/spark-seed.cjs seed     create the fixtures (no-op if already there)
 *   node tools/scratch/spark-seed.cjs warp     backdate them so rows read "1w ago" etc.
 *   node tools/scratch/spark-seed.cjs running  add one task in the running state (memory only)
 *   node tools/scratch/spark-seed.cjs clear    delete every fixture this script created
 *   node tools/scratch/spark-seed.cjs purge    also delete the fidelity harness's fixtures
 *
 * Goes through the app's own spark-store instance (found on the resource timeline), so
 * persistence, ordering and the task-body records all take the normal path. Nothing here
 * starts an agent run.
 */
const puppeteer = require('puppeteer-core');

const DAY = 24 * 60 * 60 * 1000;
const DIGEST = [
  'Here is your morning email digest for Thursday, October 1, covering messages received over the past 24 hours:',
  '',
  '### 🚨 Account Security Alerts (Action Required)',
  '',
  '- **Verify suspicious activity on your account**',
  '  - **Sender:** Example Service (`noreply@example.com`) | **Date:** Sep 30, 6:13 PM',
  '  - **Security Alert:** Unusual sign-in activity was flagged. Review your active sessions and check your security settings.',
  '- **Registrar | account security notice - failed login**',
  '  - **Sender:** Registrar (`support@example.com`) | **Date:** Sep 30, 6:40 PM',
  '  - **Security Alert:** A failed login attempt to username `example` from IP `203.0.113.7`. If this was not you, update your password and turn on two-factor authentication (2FA).',
  '',
  '### 🤖 AI Ecosystem & Platform Updates',
  '',
  '- **Skills are coming to your assistant**',
  '  - **Sender:** Product Updates (`updates@example.com`) | **Date:** Oct 1, 12:00 AM',
  '  - **Announcement:** A new feature lets you automate repetitive tasks and save custom instructions directly in chat using `/skill_name`.',
  '  - **Data Preservation:** Files stored in your drive (`My Drive > Workflows`) will not be deleted, but copy any custom prompt text before November 16.',
  '- **September update (the short version)**',
  '  - **Sender:** Newsletter (`hello@example.com`) | **Date:** Sep 30, 6:15 PM',
  '  - **Highlights:** A recap of version 2.0, including a shared brand library, an agent on an infinite canvas, native asset cropping and expanded model support.',
  '',
  '### 🔬 Research Programs & User Support',
  '',
  '- **Support request received - thank you**',
  '  - **Sender:** Support (`support@example.com`) | **Date:** Sep 30, 9:02 PM',
  '  - **Details:** Confirmation that your support ticket was received, noting a reply within two business days.',
].join('\n');

const FOLLOW_UP = [
  'Two of them need a reply today:',
  '',
  '1. **Support request received** — confirm the ticket number so they can find your case.',
  '2. **Registrar security notice** — reply only if the login attempt was not you.',
  '',
  'Everything else is informational and can wait.',
].join('\n');

/* Oldest first: createSparkTask prepends, so the newest lands on top as in Gemini's list. */
const TASKS = [
  { title: 'Vision and Scarlet Witch Exploration', description: 'Researched MCU film rumors regarding Vision and Scarlet Witch', ageDays: 33 },
  { title: 'Shopping List Organization', description: 'Organized the shopping list into Google Tasks.', ageDays: 32, unread: true },
  { title: 'Avengers: Doomsday Plot Analysis', description: 'Compiled comprehensive dossier on Avengers: Doomsday plot leaks', ageDays: 31 },
  { title: 'IFB Washing Machine Complaint Filing', description: 'Addressing loose appliance bonnet support mechanisms', ageDays: 30, status: 'failed', unread: true },
  { title: 'English Literature Project Deadline', description: 'Retrieving English literature submission date from WhatsApp', ageDays: 22 },
  { title: 'Browser-Based Automated Task Execution', description: 'Requested additional details for browser agent configuration', ageDays: 22, status: 'needs-input', unread: true, approval: true },
  { title: 'English Literature Project Deadline Verification', description: 'Searched personal workspace for project submission deadlines', ageDays: 21.5 },
  { title: 'Steam Account Username Verification', description: 'Provided Steam account details despite browser service errors', ageDays: 21.5 },
  { title: 'Travel Reservation Coordination', description: 'Explained limitations regarding cloud infrastructure provisioning', ageDays: 21.5 },
  { title: 'YouTube Platform Navigation', description: "Searched YouTube for Taylor Swift's Cruel Summer.", ageDays: 21.5 },
  { title: 'Discord Developer Mode Message', description: 'Building the Model Context Protocol base', ageDays: 21.5, status: 'failed', unread: true },
  { title: 'Gemini Spark Capability Overview', description: 'Performed cloud computing operations using a Python benchmark', ageDays: 9.5, unread: true },
  { title: 'YouTube Channel Access', description: 'Clarified limitations regarding local computer hardware control.', ageDays: 8.5 },
  { title: 'YouTube Music Playback Selection', description: 'Explained remote browser tool limitations and provided link.', ageDays: 8.5 },
  { title: 'Daily Email Summarization Workflow', description: 'Summarized recent emails and organized important notifications.', ageDays: 7.5, unread: true, digest: true },
];

async function run(page, command) {
  return page.evaluate(async (cmd, tasks, digest, followUp, dayMs) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/spark-store\.ts(\?|$)/.test(name));
    if (!url) return { error: 'spark-store module not loaded yet — open Spark once first' };
    const store = await import(url);
    const SEED_KEY = 'willow:spark:seed-fixtures';
    const saved = JSON.parse(localStorage.getItem(SEED_KEY) || '{"tasks":[],"schedules":[]}');
    const state = () => store.sparkState.get();

    if (cmd === 'seed') {
      if (saved.tasks.length && state().tasks.some((task) => saved.tasks.includes(task.id))) return { already: saved };
      const created = { tasks: [], schedules: [] };
      for (const [index, spec] of tasks.entries()) {
        const id = `seed-task-${String(index + 1).padStart(2, '0')}`;
        const status = spec.status || 'complete';
        const prompt = spec.digest ? 'Summarize my morning emails every day and flag anything that needs action.' : `${spec.title}.`;
        const task = store.createSparkTask(prompt, {
          id,
          title: spec.title,
          description: spec.description,
          status,
          openTask: false,
          response: spec.digest ? digest : status === 'failed' ? '' : `${spec.description} This is a placeholder response for layout checks.`,
          progressLabel: status === 'failed' ? 'Failed' : status === 'needs-input' ? 'Needs input' : 'Done',
          hasUnreadCompletion: Boolean(spec.unread),
          scheduledLabel: spec.digest ? 'Summarize daily morning emails' : undefined,
          scheduledTime: spec.digest ? 'October 1, 8:19 AM' : undefined,
          activityTitle: spec.digest ? 'Retrieving and summarizing recent email correspondence' : undefined,
          thinkingSteps: spec.digest ? ['Searching Gmail for messages from the last 24 hours', 'Grouping the messages by topic and urgency'] : [],
          usedTools: spec.digest ? ['files', 'app:gmail'] : [],
          approval: spec.approval ? {
            kind: 'browser',
            title: 'Allow Spark to use a browser?',
            description: 'Spark will open a browser to complete this task.',
            prompt: 'Open the site and finish the task.',
          } : undefined,
          turns: spec.digest ? [{
            id: `${id}-turn-1`,
            prompt: 'Which of these need a reply today?',
            response: followUp,
            createdAt: new Date(Date.now() - (spec.ageDays * dayMs) + 60_000).toISOString(),
          }] : [],
        });
        if (task) created.tasks.push(task.id);
      }
      const schedule = store.createSparkSchedule({
        title: 'Summarize daily morning emails',
        frequency: 'Daily',
        weekdays: [],
        time: '08:00',
        instructions: 'Summarize my morning emails and flag anything that needs action.',
        enabled: true,
        taskId: 'seed-task-15',
        lastRunLabel: 'Completed',
        lastRunAt: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString(),
        // Far future: the scheduler fires an enabled schedule once nextRunAt passes, and a
        // fixture must never start a real agent run.
        nextRunAt: '2099-01-01T02:30:00.000Z',
      });
      if (schedule) created.schedules.push(schedule.id);
      localStorage.setItem(SEED_KEY, JSON.stringify(created));
      return { created };
    }

    if (cmd === 'warp') {
      const ages = new Map(tasks.map((spec, index) => [`seed-task-${String(index + 1).padStart(2, '0')}`, spec.ageDays]));
      const current = state();
      store.sparkState.set({
        ...current,
        tasks: current.tasks.map((task) => {
          const age = ages.get(task.id);
          if (age === undefined) return task;
          const stamp = new Date(Date.now() - age * dayMs).toISOString();
          return { ...task, createdAt: stamp, updatedAt: stamp };
        }),
      });
      return { warped: ages.size };
    }

    if (cmd.startsWith('read:')) {
      // Mirror a task the reference account has already opened (its title drops to 400).
      const id = cmd.slice(5);
      return { read: Boolean(store.updateSparkTask(id, { hasUnreadCompletion: false })) };
    }

    if (cmd === 'running') {
      const task = store.createSparkTask('Find three weekend hiking trails near me with parking.', {
        id: 'seed-task-running',
        title: 'Weekend Hiking Trail Research',
        description: 'Searching trail guides',
        status: 'running',
        openTask: false,
        activityPhase: 'working',
        progressLabel: 'Searching the web',
        activityTitle: 'Searching trail guides near you',
        thinkingSteps: ['Looking up trails within an hour of you'],
        usedTools: ['google_search'],
      });
      if (task && !saved.tasks.includes(task.id)) {
        saved.tasks.push(task.id);
        localStorage.setItem(SEED_KEY, JSON.stringify(saved));
      }
      return { running: task?.id };
    }

    if (cmd === 'clear') {
      const removed = { tasks: 0, schedules: 0 };
      for (const id of saved.tasks) if (store.deleteSparkTask(id)) removed.tasks += 1;
      for (const id of saved.schedules) if (store.deleteSparkSchedule(id)) removed.schedules += 1;
      localStorage.removeItem(SEED_KEY);
      return { removed };
    }

    // Everything `clear` removes, plus the `seed-scroll-*` tasks and `seed-schedule-*`
    // schedules that tools/ui-research/scrapers/spark writes into every willow:spark:v* key,
    // in every scope, and the per-task records either leaves behind. Matches fixture ids
    // only; real task and schedule ids never carry these prefixes.
    if (cmd === 'purge') {
      const isFixture = (id) => /^seed-(task|scroll|schedule)-/.test(String(id))
        || saved.tasks.includes(id) || saved.schedules.includes(id);
      const removed = { tasks: 0, schedules: 0, otherScopes: 0, records: 0 };
      for (const task of [...state().tasks]) {
        if (isFixture(task.id) && store.deleteSparkTask(task.id)) removed.tasks += 1;
      }
      for (const schedule of [...(state().schedules || [])]) {
        if (isFixture(schedule.id) && store.deleteSparkSchedule(schedule.id)) removed.schedules += 1;
      }
      for (const key of Object.keys(localStorage)) {
        if (/^willow:spark:task:v\d+:/.test(key) && isFixture(key.split(':').pop())) {
          localStorage.removeItem(key);
          removed.records += 1;
          continue;
        }
        if (!/^willow:spark:v\d+:/.test(key)) continue;
        let value;
        try {
          value = JSON.parse(localStorage.getItem(key));
        } catch {
          continue;
        }
        const tasksBefore = value?.tasks?.length ?? 0;
        const schedulesBefore = value?.schedules?.length ?? 0;
        if (Array.isArray(value?.tasks)) value.tasks = value.tasks.filter((task) => !isFixture(task.id));
        if (Array.isArray(value?.schedules)) value.schedules = value.schedules.filter((s) => !isFixture(s.id));
        const dropped = tasksBefore - (value?.tasks?.length ?? 0) + schedulesBefore - (value?.schedules?.length ?? 0);
        if (dropped > 0) {
          localStorage.setItem(key, JSON.stringify(value));
          removed.otherScopes += dropped;
        }
      }
      localStorage.removeItem(SEED_KEY);
      return { removed };
    }
    return { error: `unknown command ${cmd}` };
  }, command, TASKS, DIGEST, FOLLOW_UP, DAY);
}

(async () => {
  const command = process.argv[2] || 'seed';
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith('http://localhost:3000'));
  if (!page) throw new Error('no Willow tab');
  console.log(JSON.stringify(await run(page, command)));
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
