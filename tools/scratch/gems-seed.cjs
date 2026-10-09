/**
 * Seeds neutral test Gems into the Willow tab's localStorage (`willow_gems:v1`) and reloads,
 * or purges exactly the ones it created (ids kept under `willow:gems:seed-fixtures`).
 *
 *   node tools/scratch/gems-seed.cjs seed|purge|list
 */
const puppeteer = require('puppeteer-core');

const FIXTURES = [
  ['Trip Planner', 'Plans day-by-day itineraries around your budget and pace.', 'You plan trips.', 'none'],
  ['Recipe Helper', '', 'You are a friendly home cook who turns whatever is in the fridge into a simple dinner, with quantities and timings.', 'none'],
  ['Code Reviewer', 'Reviews diffs for bugs, readability and style.', 'You review code.', 'canvas'],
  ['Spanish Tutor', 'Practice conversational Spanish at your level.', 'You tutor Spanish.', 'learn'],
  ['Meeting Notes', 'Turns rough notes into a clean summary with action items.', 'You summarise meetings.', 'none'],
  ['Workout Coach', 'Builds a weekly plan for the equipment you have.', 'You coach fitness.', 'none'],
  ['Essay Critic', 'Line-by-line feedback on argument and structure.', 'You critique essays.', 'none'],
  ['Gift Finder', 'Finds gifts from a few details about the person.', 'You suggest gifts.', 'images'],
  ['Budget Buddy', 'Sorts expenses and suggests where to save.', 'You help budget.', 'none'],
  ['Story Starter', 'Opening lines and premises for short fiction.', 'You start stories.', 'none'],
  ['Interview Prep', 'Mock interviews with feedback on each answer.', 'You run mock interviews.', 'none'],
  ['Plant Doctor', 'Diagnoses houseplant problems from a description.', 'You diagnose plants.', 'research'],
];

(async () => {
  const command = process.argv[2] || 'list';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 30_000 });
  const page = (await browser.pages()).find((p) => (p.url().startsWith('http://localhost:3000') && !p.url().includes('/media')));
  if (!page) throw new Error('no willow tab');
  const result = await page.evaluate((cmd, fixtures) => {
    const KEY = 'willow_gems:v1';
    const SEED = 'willow:gems:seed-fixtures';
    const gems = JSON.parse(localStorage.getItem(KEY) || '[]');
    const seeded = JSON.parse(localStorage.getItem(SEED) || '[]');
    if (cmd === 'seed') {
      const now = Date.now();
      const created = fixtures.map(([name, description, instructions, defaultTool], i) => ({
        id: `${name} seed`,
        name,
        description,
        instructions,
        defaultTool,
        knowledge: [],
        hideCitations: false,
        createdAt: now - i * 60_000,
        updatedAt: now - i * 60_000,
      }));
      const ids = new Set(created.map((g) => g.id));
      localStorage.setItem(KEY, JSON.stringify([...created, ...gems.filter((g) => !ids.has(g.id))]));
      localStorage.setItem(SEED, JSON.stringify([...new Set([...seeded, ...ids])]));
      return { seeded: created.length };
    }
    if (cmd === 'purge') {
      const ids = new Set(seeded);
      const kept = gems.filter((g) => !ids.has(g.id));
      localStorage.setItem(KEY, JSON.stringify(kept));
      localStorage.removeItem(SEED);
      return { removed: gems.length - kept.length, left: kept.length };
    }
    return { gems: gems.map((g) => g.id), seeded };
  }, command, FIXTURES);
  if (command !== 'list') await page.reload({ waitUntil: 'domcontentloaded' });
  console.log(JSON.stringify(result));
  browser.disconnect();
})();
