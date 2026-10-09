/**
 * Traces the Willow tab around one "View remote browser" click (or, with `close`,
 * the pane's close button) and breaks every long main-thread task down: script,
 * style, layout, paint, and the entry points (timers, frames, observers, events)
 * that ran inside it. Needs a seeded task with a browser in the Willow tab, pane
 * closed for `open` and open for `close`.
 *
 *   node tools/scratch/willow-open-trace.cjs [open|close] [minTaskMs]
 */
const puppeteer = require('puppeteer-core');

const phase = process.argv[2] || 'open';
const minTaskMs = Number(process.argv[3] || 16);

const clickCenter = async (page, handle) => {
  const box = await handle?.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
};

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  if (!page) throw new Error('no willow tab');
  await page.bringToFront();
  let target;
  if (phase === 'open') {
    if (!(await clickCenter(page, await page.$('button[aria-label="Open remote browser and remote computer menu"]')))) throw new Error('no monitor button');
    await page.waitForSelector('.spark-task-detail__browser-menu [role="menuitem"]');
    await new Promise((resolve) => setTimeout(resolve, 400));
    target = await page.$('.spark-task-detail__browser-menu [role="menuitem"]');
  } else {
    target = await page.$('button[aria-label="Close remote browser"]');
  }
  if (!target) throw new Error(`nothing to click for ${phase}`);
  const cdp = await page.createCDPSession();
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink', 'toplevel'],
    },
  });
  await page.evaluate(() => performance.mark('willow-trace-click'));
  await clickCenter(page, target);
  await new Promise((resolve) => setTimeout(resolve, 800));
  await cdp.send('Tracing.end');
  await done;

  const mark = events.find((e) => e.name === 'willow-trace-click');
  const main = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain' && (!mark || e.pid === mark.pid));
  const onMain = events.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && typeof e.dur === 'number');
  const origin = mark ? mark.ts : Math.min(...onMain.map((e) => e.ts));
  const tasks = onMain.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const kinds = {
    script: ['FunctionCall', 'EvaluateScript', 'v8.callFunction', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'RunMicrotasks', 'v8.run'],
    style: ['UpdateLayoutTree', 'RecalculateStyles', 'ScheduleStyleRecalculation'],
    layout: ['Layout'],
    paint: ['Paint', 'PrePaint', 'Layerize', 'UpdateLayer', 'CompositeLayers', 'Commit'],
  };
  const sumOf = (inside, names) => {
    // Top-most matching events only, so nested ones are not counted twice.
    const hits = inside.filter((e) => names.includes(e.name)).sort((a, b) => a.ts - b.ts);
    let total = 0;
    let end = -Infinity;
    for (const e of hits) {
      if (e.ts >= end) {
        total += e.dur;
        end = e.ts + e.dur;
      } else if (e.ts + e.dur > end) {
        total += e.ts + e.dur - end;
        end = e.ts + e.dur;
      }
    }
    return total / 1000;
  };
  const busy = tasks.filter((t) => t.ts + t.dur >= origin).reduce((sum, t) => sum + t.dur, 0) / 1000;
  console.log(`main thread busy ${busy.toFixed(0)}ms in the 800ms after the click`);
  for (const task of tasks.filter((t) => t.ts + t.dur >= origin && t.dur / 1000 >= minTaskMs)) {
    const inside = onMain.filter((e) => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur);
    const parts = Object.entries(kinds).map(([kind, names]) => `${kind} ${sumOf(inside, names).toFixed(1)}`).join(', ');
    console.log(`\n@${((task.ts - origin) / 1000).toFixed(0)}ms task ${(task.dur / 1000).toFixed(1)}ms: ${parts}`);
    const entries = inside
      .filter((e) => ['FunctionCall', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'Layout', 'UpdateLayoutTree', 'ResizeObserverController::DeliverObservations', 'IntersectionObserverController::computeIntersections', 'ParseHTML', 'Paint'].includes(e.name) && e.dur >= 1000)
      .sort((a, b) => a.ts - b.ts);
    for (const e of entries.slice(0, 18)) {
      const data = e.args?.data || e.args?.beginData || {};
      const where = data.functionName || data.url ? ` ${data.functionName || '(anonymous)'} ${String(data.url || '').split('/').pop().split('?')[0]}:${data.lineNumber ?? ''}` : '';
      const extra = e.name === 'EventDispatch' ? ` ${data.type}` : e.name === 'Layout' ? ` ${data.dirtyObjects ?? e.args?.beginData?.dirtyObjects ?? ''}/${data.totalObjects ?? e.args?.beginData?.totalObjects ?? ''} objects` : e.name === 'UpdateLayoutTree' ? ` ${data.elementCount ?? e.args?.elementCount ?? ''} elements` : '';
      console.log(`  +${((e.ts - task.ts) / 1000).toFixed(0)} ${e.name} ${(e.dur / 1000).toFixed(1)}ms${where}${extra}`);
    }
  }
  browser.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
