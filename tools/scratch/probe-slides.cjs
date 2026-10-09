// The Community carousel's slides, one shot each as they come round (6s apart), with the bottom
// row's boxes on a tool slide.
module.exports = async ({ page, go, sleep, waitFor, shot }) => {
  await go('/media/tools');
  await waitFor(() => document.querySelector('.applet-section'), null, 120000);
  await page.evaluate(() => [...document.querySelectorAll('.marketplace-toggles .mat-button-toggle-button')].find((b) => b.textContent.trim() === 'Community')?.click());
  await waitFor(() => document.querySelector('.community-carousel-banner'), null, 8000);
  for (let i = 0; i < 4; i += 1) {
    await sleep(i === 0 ? 1500 : 6000);
    await shot(`slide-${i}`);
    const info = await page.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`; };
      return {
        title: document.querySelector('.hero-title')?.textContent,
        info: box('.community-tool-info'), thumb: box('.community-tool-thumbnail'), name: box('.community-tool-name'),
        author: document.querySelector('.community-author-name')?.textContent, cta: box('.community-cta-button'), ctaText: document.querySelector('.community-cta-button')?.textContent.trim(),
      };
    });
    console.log(i, JSON.stringify(info));
  }
};
