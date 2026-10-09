/*
 * Prints the authored CSS rules (selector, enclosing @media, relevant declarations) that
 * match each part of Gemini's header model selector, including ::before/::after.
 *
 *   node tools/scratch/model-pill-rules.cjs [hover]
 *
 * With "hover", :hover is forced on the button first, so hover-only rules show up too.
 */
const puppeteer = require('puppeteer-core');

const BUTTON = 'button[aria-label^="Open mode picker"]';
const PARTS = {
  button: BUTTON,
  stateLayer: `${BUTTON} .mat-mdc-button-persistent-ripple`,
  label: `${BUTTON} .mdc-button__label`,
  content: `${BUTTON} .gem-button-content`,
  container: `${BUTTON} .logo-pill-label-container`,
  primary: `${BUTTON} .picker-primary-text`,
  secondary: `${BUTTON} .picker-secondary-text`,
  icon: `${BUTTON} mat-icon`,
};
const RELEVANT = /^(height|min-height|width|min-width|padding|margin|gap|transform|transform-origin|translate|scale|font-size|font-weight|line-height|letter-spacing|font-variation-settings|color|opacity|background|background-color|transition|transition-[a-z-]+|animation|border-radius|top|left|right|bottom|inset|display|overflow)/;

(async () => {
  const forceHover = process.argv[2] === 'hover';
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://[::1]:9222', defaultViewport: null });
  const page = (await browser.pages()).find((candidate) => candidate.url().startsWith('https://gemini.google.com/'));
  const cdp = await page.createCDPSession();
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const nodeOf = async (selector) => (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })).nodeId;
  if (forceHover) await cdp.send('CSS.forcePseudoState', { nodeId: await nodeOf(BUTTON), forcedPseudoClasses: ['hover'] });

  const printRules = (matches) => {
    for (const { rule } of matches) {
      if (rule.origin !== 'regular') continue;
      const declarations = rule.style.cssProperties
        .filter((prop) => RELEVANT.test(prop.name) && prop.value && !prop.disabled && prop.parsedOk !== false && prop.range)
        .map((prop) => `${prop.name}: ${prop.value}${prop.important ? ' !important' : ''}`);
      if (!declarations.length) continue;
      const media = (rule.media || []).map((m) => `@media ${m.text}`).join(' ');
      const selector = rule.selectorList.text.replace(/\s+/g, ' ');
      console.log(`    ${media ? `${media} ` : ''}${selector.length > 160 ? `${selector.slice(0, 160)}…` : selector}`);
      console.log(`        ${declarations.join('; ')}`);
    }
  };

  for (const [name, selector] of Object.entries(PARTS)) {
    const nodeId = await nodeOf(selector);
    if (!nodeId) {
      console.log(`== ${name}: not found`);
      continue;
    }
    const { matchedCSSRules, pseudoElements } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    console.log(`== ${name}`);
    printRules(matchedCSSRules);
    for (const pseudo of pseudoElements || []) {
      if (!['before', 'after'].includes(pseudo.pseudoType)) continue;
      console.log(`  ::${pseudo.pseudoType}`);
      printRules(pseudo.matches);
    }
  }
  if (forceHover) await cdp.send('CSS.forcePseudoState', { nodeId: await nodeOf(BUTTON), forcedPseudoClasses: [] });
  await cdp.detach();
  await browser.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
