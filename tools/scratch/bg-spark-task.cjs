/** One Spark task as a responsive Willow tab's store holds it: status, response and activity. */
const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const taskId = process.argv[2];
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  for (const page of (await browser.pages()).filter((candidate) => candidate.url() === 'http://localhost:3000/')) {
    const state = await Promise.race([page.evaluate(async (id) => {
      const url = performance.getEntriesByType('resource').map((entry) => entry.name).reverse().find((entry) => entry.includes('/spark-store.ts'));
      if (!url) return { error: 'spark store not loaded' };
      const task = (await import(url)).sparkState.get().tasks.find((candidate) => candidate.id === id);
      return task ? {
        status: task.status,
        description: task.description,
        progress: task.progressLabel,
        response: task.response.slice(0, 160),
        responseLength: task.response.length,
        updatedAt: task.updatedAt,
        createdAt: task.createdAt,
        modelLabel: task.modelLabel,
        turns: task.turns.length,
        thinkingSteps: (task.thinkingSteps || []).length,
        activity: (task.activityLog || []).slice(-6).map((entry) => `${entry.kind || entry.type || ''}:${(entry.title || entry.label || entry.text || '').slice(0, 50)}`),
        subagents: (task.subagents || []).length,
        usedTools: task.usedTools,
        bodyLoaded: task.bodyLoaded,
        hasUnread: task.hasUnreadCompletion,
      } : { error: 'task not in this tab' };
    }, taskId), sleep(5000).then(() => ({ error: 'no answer' }))]);
    console.log(JSON.stringify(state));
    const stored = await Promise.race([page.evaluate((id) => Object.keys(localStorage).filter((candidate) => candidate.includes(id)).map((key) => {
      const record = JSON.parse(localStorage.getItem(key));
      return {
        key: decodeURIComponent(key).slice(-70),
        status: record.status,
        description: record.description,
        progress: record.progressLabel,
        response: (record.response || '').slice(0, 200),
        responseLength: (record.response || '').length,
        modelLabel: record.modelLabel,
        activity: (record.activityLog || []).length,
        updatedAt: record.updatedAt,
        title: record.title,
      };
    }), taskId), sleep(5000).then(() => 'no answer')]);
    console.log('stored records:', JSON.stringify(stored, null, 1));
    if (!state.error) break;
  }
  browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
