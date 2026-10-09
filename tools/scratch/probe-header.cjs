// Measures the viewer header's buttons on a template copy (made on first run).
module.exports = async ({ page, go, sleep, waitFor }) => {
  await go('/media/tools');
  await waitFor(() => document.querySelector('.applet-section'), null, 120000);
  const existing = await page.evaluate(async () => {
    const store = await import('/@fs/C:/Users/Yashjit%202/Workspace/Willow%20Code/features/media/src/tools/tools-store.ts');
    return store.$tools.get().find((t) => t.remixedFrom?.kind === 'template')?.id ?? null;
  });
  let id = existing;
  if (!id) {
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'Templates');
      t?.click();
    });
    await waitFor(() => document.querySelector('.applet-grid-gallery .applet-card-main'), null, 5000);
    await page.evaluate(() => document.querySelector('.applet-grid-gallery .applet-card-main').click());
    await waitFor(() => /\/media\/tool\/[0-9a-f-]{20,}/.test(location.pathname), null, 20000);
    id = page.url().match(/\/media\/tool\/([^?]+)/)[1];
  }
  await go(`/media/tool/${id}`);
  await waitFor(() => document.querySelector('.applet-view-header .header-right button'), null, 30000);
  await sleep(1500);
  const out = await page.evaluate(() => [...document.querySelectorAll('.applet-view-header button, .applet-view-header .applet-icon-container, .applet-view-header .editable-text-input')].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return `${b.tagName.toLowerCase()}.${[...b.classList].filter((c) => /flow-|header|applet|toggle|mat-tonal|mat-mdc-icon/.test(c)).join('.')} [${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}] pad=${cs.padding} bg=${cs.backgroundColor} color=${cs.color} radius=${cs.borderRadius} font=${cs.fontSize}/${cs.lineHeight} ${cs.fontWeight}`;
  }));
  console.log(out.join('\n'));
};
