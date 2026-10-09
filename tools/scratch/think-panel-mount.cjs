/**
 * Mounts Willow's real `ThinkingStepsSidebar` (the app's own module instances of React,
 * framer-motion and ChatResponseChrome, found through the page's loaded resources) into a
 * throwaway container with neutral fixture text, so the panel can be measured without
 * creating a chat. `close` runs its exit animation through AnimatePresence; `unmount`
 * removes the harness. Touches no storage.
 *
 *   node tools/scratch/think-panel-mount.cjs mount | close | unmount
 */
const puppeteer = require('puppeteer-core');

(async () => {
  const command = process.argv[2] || 'mount';
  const browser = await puppeteer.connect({ browserURL: 'http://[::1]:9222', defaultViewport: null, protocolTimeout: 60000 });
  const page = (await browser.pages()).find((p) => p.url().startsWith('http://localhost:3000') && !p.url().includes('/media'));
  await page.bringToFront();
  console.log(await page.evaluate(async (cmd) => {
    const harness = window.__thinkHarness;
    if (cmd === 'close') { harness?.close(); return harness ? 'closing' : 'no harness'; }
    if (cmd === 'unmount') {
      if (!harness) return 'no harness';
      harness.root.unmount();
      harness.host.remove();
      delete window.__thinkHarness;
      return 'unmounted';
    }
    if (harness) return 'already mounted';
    const urls = performance.getEntriesByType('resource').map((e) => e.name);
    const find = (re) => urls.filter((n) => re.test(n)).at(-1);
    const reactUrl = find(/\/node_modules\/\.vite\/deps\/react\.js/);
    const clientUrl = find(/\/node_modules\/\.vite\/deps\/react-dom_client\.js/);
    const motionUrl = find(/\/node_modules\/\.vite\/deps\/framer-motion\.js/);
    const chromeUrl = find(/\/features\/chat\/src\/ChatResponseChrome\.tsx/);
    if (!reactUrl || !clientUrl || !motionUrl || !chromeUrl) return `missing ${JSON.stringify({ reactUrl: !!reactUrl, clientUrl: !!clientUrl, motionUrl: !!motionUrl, chromeUrl: !!chromeUrl })}`;
    const reactModule = await import(reactUrl);
    const React = reactModule.default || reactModule;
    const clientModule = await import(clientUrl);
    const createRoot = clientModule.createRoot || clientModule.default?.createRoot;
    const { AnimatePresence } = await import(motionUrl);
    const { ThinkingStepsSidebar } = await import(chromeUrl);
    const host = document.createElement('div');
    host.id = 'think-harness';
    document.body.appendChild(host);
    const root = createRoot(host);
    let setOpen = null;
    const Harness = () => {
      const [open, set] = React.useState(true);
      setOpen = set;
      return React.createElement(AnimatePresence, null, open && React.createElement(ThinkingStepsSidebar, {
        key: 'fixture',
        thinkingText: '**Checking the panel**\n\nA neutral test thought that runs long enough to wrap across a few lines on a phone, so the dotted rail and the body text can be measured.\n\n**Second step**\n\nAnother neutral thought, shorter.',
        modelLabel: '3.8 Flash Extended',
        onClose: () => set(false),
      }));
    };
    root.render(React.createElement(Harness));
    window.__thinkHarness = { root, host, close: () => setOpen?.(false), open: () => setOpen?.(true) };
    return 'mounted';
  }, command));
  browser.disconnect();
})();
