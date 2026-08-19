/**
 * Material's circular-progress rules and keyframes, out of every stylesheet on the Gemini
 * page. `CSS.enable` replays `styleSheetAdded` for sheets already there, which is the only
 * way to enumerate the constructed ones.
 */
const { connect, save } = require('../ui-research/scrapers/notebooks/lib.cjs');

(async () => {
  const browser = await connect();
  try {
    const page = (await browser.pages()).find((p) => /gemini\.google\.com\/notebook/.test(p.url()));
    if (!page) throw new Error('no Gemini notebook tab');

    const client = await page.createCDPSession();
    const headers = [];
    client.on('CSS.styleSheetAdded', ({ header }) => headers.push(header));
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    await new Promise((r) => setTimeout(r, 2500));
    console.log(`${headers.length} stylesheets`);

    let all = '';
    for (const h of headers) {
      try {
        const { text } = await client.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId });
        all += `\n\n/* ==== ${h.sourceURL || '(inline/constructed)'} ==== */\n${text}`;
      } catch { /* gone */ }
    }
    console.log(`${(all.length / 1024).toFixed(0)}KB of CSS`);

    const keyframeNames = new Set();
    const kfRe = /@(?:-webkit-)?keyframes\s+([\w-]+)/g;
    let m;
    while ((m = kfRe.exec(all))) if (/spinner|circular|progress|rotate|dash/i.test(m[1])) keyframeNames.add(m[1]);
    console.log('\nspinner-ish keyframes:', [...keyframeNames].join(', ') || '(none)');

    // Whole blocks for those keyframes, plus the circular-progress rules.
    const wanted = [];
    for (const name of keyframeNames) {
      const start = all.indexOf('@keyframes ' + name);
      if (start === -1) continue;
      let depth = 0;
      let i = all.indexOf('{', start);
      const from = i;
      for (; i < all.length; i += 1) {
        if (all[i] === '{') depth += 1;
        else if (all[i] === '}') { depth -= 1; if (depth === 0) break; }
      }
      wanted.push(`@keyframes ${name} ${all.slice(from, i + 1)}`);
    }
    /*
     * `@keyframes` blocks must be filtered out here, not just collected above.
     *
     * Their own names contain `mdc-circular-progress`, so they match this regex too — and
     * `[^}]*\}` then stops at the first INNER close brace, emitting `@keyframes X{0%{…}` with
     * no closing brace. An unclosed at-rule makes Chrome's parser swallow everything after it
     * as keyframe selectors, so a saved file with even one of these fragments applies almost
     * none of its rules: it cost a run that measured MDC's spinner as having zero animations.
     * The blocks are already extracted above with a proper brace matcher.
     */
    const rules = (all.match(/[^}{]*(?:mdc-circular-progress|mat-progress-spinner|mat-mdc-progress-spinner)[^{}]*\{[^}]*\}/gi) || [])
      .filter((r) => !/@(?:-webkit-)?keyframes/i.test(r));
    save('src-chip/gemini-spinner.css', wanted.join('\n\n') + '\n\n/* ---- rules ---- */\n' + rules.join('\n'));

    console.log('\n=== keyframes');
    for (const k of wanted) console.log(k.replace(/\s+/g, ' ').slice(0, 700) + '\n');
    console.log(`\n=== ${rules.length} circular-progress rules (saved; first few below)`);
    for (const r of rules.slice(0, 18)) console.log('  ' + r.replace(/\s+/g, ' ').slice(0, 300));
    await client.detach();
  } finally {
    await browser.disconnect();
  }
})();
