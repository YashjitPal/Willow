/**
 * Gemini's "Get app": the top bar's pill on a new chat, the phone's "Try the app", and the page
 * they lead to at `/app/download`, measured at 1536x826, 800x1280 and 390x844
 * (tools/ui-research/captures/gemini/download/). Willow's offers Willow's own apps.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');

const download = await importTs(path.join(ROOT, 'apps/studio/src/download/app-download.ts'));
const styled = await importTs(path.join(ROOT, 'apps/studio/src/download/styled-qr.ts'));
const routes = await importTs(path.join(ROOT, 'apps/studio/src/app/shell-routes.ts'));

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

describe('who is offered the app', () => {
  it('offers the desktop pill on a Mac or a Windows PC, reading the client hints before the user agent', () => {
    const platform = (userAgent, hintsPlatform) => download.desktopPlatformOf({ userAgent, hintsPlatform });
    assert.equal(platform(UA.mac), 'mac');
    assert.equal(platform(UA.windows), 'windows');
    for (const ua of [UA.linux, UA.androidPhone, UA.androidTablet, UA.iphone]) assert.equal(platform(ua), 'other', ua);
    assert.equal(platform(UA.windows, 'macOS'), 'mac', 'the client hints win');
    assert.equal(platform(UA.mac, 'Windows'), 'windows');
    assert.equal(platform(UA.windows, 'Chrome OS'), 'other');
    assert.equal(download.showsDesktopGetApp({ userAgent: UA.mac }, false), true);
    assert.equal(download.showsDesktopGetApp({ userAgent: UA.windows }, false), true);
    assert.equal(download.showsDesktopGetApp({ userAgent: UA.linux }, false), false);
    assert.equal(download.showsDesktopGetApp({ userAgent: UA.windows }, true), false, 'never inside one of the apps it offers');
  });

  it('offers the phone\'s button in an Android phone\'s browser: not a tablet, an iPhone or Willow\'s Android app', () => {
    const phone = (userAgent, inApp = false) => download.showsPhoneGetApp({ userAgent }, inApp);
    assert.equal(phone(UA.androidPhone), true);
    assert.equal(phone(UA.androidPhone, true), false);
    for (const ua of [UA.androidTablet, UA.iphone, UA.mac, UA.windows, UA.linux]) assert.equal(phone(ua), false, ua);
  });

  it('reads the browser it runs in, taking an empty client-hints platform as none', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const browse = (navigator) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
    try {
      browse({ userAgent: UA.windows, userAgentData: { platform: 'Windows' } });
      assert.deepEqual(download.currentAgent(), { userAgent: UA.windows, hintsPlatform: 'Windows' });
      browse({ userAgent: UA.mac, userAgentData: { platform: '' } });
      assert.deepEqual(download.currentAgent(), { userAgent: UA.mac, hintsPlatform: undefined });
      browse({ userAgent: UA.androidPhone });
      assert.deepEqual(download.currentAgent(), { userAgent: UA.androidPhone, hintsPlatform: undefined });
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete globalThis.navigator;
    }
  });
});

describe('the page', () => {
  const page = read('apps/studio/src/download/AppDownloadPage.tsx');

  it('names this computer\'s app in Gemini\'s words, with Willow\'s name and the dev server\'s downloads', () => {
    assert.deepEqual(download.desktopOffer('mac'), { title: 'Willow on your Mac', cta: 'Download for macOS', href: '/download/macos' });
    assert.deepEqual(download.desktopOffer('windows'), { title: 'Willow on your Windows PC', cta: 'Download for Windows', href: '/download/windows' });
    assert.deepEqual(download.desktopOffer('other'), { title: 'Willow on your desktop', cta: 'Download for desktop', href: '/download/linux' });
    assert.deepEqual(['mac', 'windows', 'other'].map(download.showsDesktopRow), [true, true, false], 'Gemini draws the desktop row on a Mac or a Windows PC only');
  });

  it('keeps Gemini\'s copy, with Willow\'s name in it', () => {
    const copy = download.DOWNLOAD_COPY;
    assert.equal(copy.desktopText, 'From image creation to getting help with what\u2019s on your desktop, Willow is just a shortcut away.');
    assert.equal(copy.phoneTitle, 'Willow on your phone');
    assert.equal(copy.phoneText, 'Take Willow anywhere you go. Talk with Willow, use your camera for real-time help, create images, and more.');
    assert.equal(copy.phoneCta, 'Download for mobile');
    for (const text of Object.values(copy)) assert.ok(!/Gemini/.test(text), `"${text}" names Gemini`);
  });

  it('points a phone at the APK on the server the page came from', () => {
    assert.equal(download.APP_DOWNLOAD_PATH, '/app/download');
    assert.equal(download.ANDROID_DOWNLOAD_PATH, '/download/android');
    assert.equal(download.androidDownloadUrl('http://192.168.1.20:3000'), 'http://192.168.1.20:3000/download/android');
    assert.equal(download.androidDownloadUrl('https://willow.example'), 'https://willow.example/download/android');
    assert.match(page, /androidDownloadUrl\(window\.location\.origin\)/);
  });

  it('shows the desktop row above 960px only, and on phones and tablets the blue button in place of the QR code', () => {
    assert.match(page, /const compact = useCompactViewport\(\);/);
    assert.match(page, /\{!compact && showsDesktopRow\(platform\) && \(/);
    assert.match(page, /<a className="gm-download-cta" href=\{offer\.href\} target="_blank" rel="noopener" \{\.\.\.desktopRipple\.handlers\}>/);
    assert.match(page, /\{compact \? \(\s*<a className="gm-download-mobile-cta" href=\{ANDROID_DOWNLOAD_PATH\} target="_blank" rel="noopener" \{\.\.\.mobileRipple\.handlers\}>/);
    assert.match(page, /<DownloadQr value=\{qrValue\} \/>\s*<span className="gm-download-qr-label">\{DOWNLOAD_COPY\.phoneCta\}<\/span>/);
    assert.match(page, /src=\{isLight \? desktopLight : desktopDark\}/);
    assert.match(page, /src=\{isLight \? phoneLight : phoneDark\}/);
  });

  it('ships Gemini\'s four 880x660 pictures', () => {
    const webpSize = (bytes) => {
      const chunk = bytes.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
      if (chunk === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
      if (chunk === 'VP8L') {
        const bits = bytes.readUInt32LE(21);
        return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
      }
      return null;
    };
    for (const name of ['desktop-dark', 'desktop-light', 'phone-dark', 'phone-light']) {
      const bytes = fs.readFileSync(path.join(ROOT, `assets/app-download/${name}.webp`));
      assert.equal(bytes.toString('ascii', 0, 4) + bytes.toString('ascii', 8, 12), 'RIFFWEBP', name);
      assert.deepEqual(webpSize(bytes), [880, 660], name);
      assert.match(page, new RegExp(`import \\w+ from '@willow/assets/app-download/${name}\\.webp';`));
    }
  });
});

describe('the QR code', () => {
  const ADDRESS = 'http://192.168.1.20:3000/download/android';
  const inFinder = (size, x, y) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

  it('is Gemini\'s 37 modules a side for the page\'s address, and grows only for an address that needs it', () => {
    assert.equal(styled.GEMINI_QR_VERSION, 5);
    assert.equal(styled.qrModulesFor(ADDRESS).size, 37);
    assert.ok(styled.qrModulesFor(`http://localhost:3000/${'x'.repeat(120)}`).size > 37);
  });

  it('rounds each finder 2.5 modules out and 1.5 in around a square centre, with no quiet zone', () => {
    const qr = styled.styledQr(styled.qrModulesFor(ADDRESS));
    assert.equal(qr.size, 37);
    for (const [x, y] of [[0, 0], [30, 0], [0, 30]]) {
      assert.ok(qr.finders.includes(`M${x} ${y + 2.5}v2a2.5 2.5 0 0 0 2.5 2.5h2`), `no outer ring at ${x},${y}`);
      assert.ok(qr.finders.includes(`M${x + 2.5} ${y + 1}h2a1.5 1.5 0 0 1 1.5 1.5`), `no inner ring at ${x},${y}`);
      assert.ok(qr.finders.includes(`M${x + 2} ${y + 2}h3v3h-3z`), `no centre at ${x},${y}`);
    }
    assert.equal(qr.finders.split('M').length - 1, 9);
  });

  it('draws every dark module outside the finders once', () => {
    const modules = styled.qrModulesFor(ADDRESS);
    const outside = modules.data.filter((dark, i) => dark && !inFinder(modules.size, i % modules.size, Math.floor(i / modules.size))).length;
    assert.equal(styled.styledQr(modules).dots.split('M').length - 1, outside);
  });

  it('draws a lone module as a dot, a run\'s ends with caps, a bend with its outer corner round and the rest square', () => {
    const size = 21;
    const data = Array(size * size).fill(false);
    const on = (x, y) => { data[y * size + x] = true; };
    on(10, 10);
    on(8, 12); on(9, 12);
    on(12, 15); on(13, 15); on(14, 15);
    on(16, 9); on(16, 10); on(17, 10);
    on(0, 0);
    const shapes = styled.styledQr({ size, version: 1, data }).dots.split(/(?=M)/);
    assert.equal(shapes.length, 9, 'one shape per module, none for the finder\'s');
    assert.ok(shapes.includes('M10 10.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0z'), 'a lone module is a dot');
    assert.ok(shapes.includes('M9 12v1h-.5a.5 .5 0 0 1 0 -1z'), 'the left of a pair is capped on the left');
    assert.ok(shapes.includes('M9 12v1h.5a.5 .5 0 0 0 0 -1z'), 'the right of a pair is capped on the right');
    assert.ok(shapes.includes('M13 15h1v1h-1z'), 'the middle of a run is square');
    assert.ok(shapes.includes('M17 10v1h-.5a.5 .5 0 0 1 -.5 -.5v-.5z'), 'a bend rounds the corner away from both neighbours');
  });

  it('paints the dots through one clip path, so touching modules show no seams', () => {
    const page = read('apps/studio/src/download/AppDownloadPage.tsx');
    assert.match(page, /<clipPath id=\{clipId\}>\s*<path d=\{qr\.dots\} \/>\s*<\/clipPath>/);
    assert.match(page, /<rect width=\{qr\.size\} height=\{qr\.size\} fill="#000000" clipPath=\{`url\(#\$\{clipId\}\)`\} \/>/);
    assert.match(page, /<path d=\{qr\.finders\} fill="#000000" fillRule="evenodd" \/>/);
  });
});

describe('where the buttons sit and what they open', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');
  const buttons = read('apps/studio/src/download/GetAppButtons.tsx');
  const newChat = 'currentView === \'home\' && isChatExperience && studioMode === \'chat\' && !isChatOngoing && !isGemChat';

  it('decides once who is offered which, and never inside Willow\'s desktop or Android app', () => {
    assert.match(layout, /showsDesktopGetApp\(agent, isDesktop \|\| isAndroidApp\(\)\)/);
    assert.match(layout, /showsPhoneGetApp\(agent, isAndroidApp\(\)\)/);
  });

  it('puts the desktop pill on a new chat 24px before the temporary-chat button, above 960px', () => {
    assert.ok(layout.includes(`{${newChat} && getAppOffers.desktop && (\n          <div className="absolute top-[14px] right-[72px] z-30 flex items-center max-[960px]:hidden">\n            <DesktopGetAppButton onOpen={() => setCurrentView('download')} />`));
  });

  it('puts the phone\'s button on a new chat 12px before the temporary-chat button, and alone on the download page', () => {
    assert.ok(layout.includes(`{${newChat} && getAppOffers.phone && (\n          <div className="min-[961px]:hidden absolute top-[12px] right-[112px] z-30 flex items-center">\n            <PhoneGetAppButton />`));
    assert.ok(layout.includes('{currentView === \'download\' && getAppOffers.phone && (\n          <div className="min-[961px]:hidden absolute top-[12px] right-[24px] z-30 flex items-center">\n            <PhoneGetAppButton />'));
  });

  it('comes before the temporary-chat button in the tab order, as in Gemini\'s bar', () => {
    const pill = layout.indexOf('<DesktopGetAppButton');
    const temporary = layout.indexOf('Top-right: Temporary Chat button');
    assert.ok(pill > 0 && temporary > pill);
  });

  it('gives the download page the narrow bar\'s wordmark and no New chat, as the Library has', () => {
    assert.match(layout, /currentView === 'library' \|\| currentView === 'download'\) && \(/);
    assert.match(layout, /currentView !== 'library' && currentView !== 'download' && currentView !== 'customize' && \(/);
  });

  it('draws the desktop pill as Gemini\'s: Luminous `download` at 24px, weight 300, then "Get app"', () => {
    assert.match(buttons, /<MaterialSymbol name="download" family="luminous" size=\{24\} weight=\{300\} roundness=\{100\} opticalSize=\{24\} \/>\s*<span className="gm-get-app-label">Get app<\/span>/);
    assert.match(buttons, /<button type="button" className="gm-get-app" onClick=\{onOpen\} \{\.\.\.ripple\.handlers\}>/);
  });

  it('draws the phone\'s as Gemini\'s: Google Symbols `install_mobile`, the icon below 480px, "App" to 600px, "Try app" beyond', () => {
    assert.match(buttons, /<MaterialSymbol name="install_mobile" family="google-symbols" size=\{18\} weight=\{400\} className="gm-phone-get-app-pill-icon" \/>/);
    assert.match(buttons, /<span className="gm-phone-get-app-label gm-phone-get-app-label--long">Try app<\/span>/);
    assert.match(buttons, /<span className="gm-phone-get-app-label gm-phone-get-app-label--medium">App<\/span>/);
    assert.match(buttons, /<button type="button" className="gm-phone-get-app-icon" aria-label="Try the app" onClick=\{openAndroidApp\} \{\.\.\.iconRipple\.handlers\}>/);
    assert.match(buttons, /<MaterialSymbol name="install_mobile" family="google-symbols" size=\{24\} weight=\{400\} className="gm-phone-get-app-glyph" \/>/);
    assert.match(buttons, /usePressRipple\('gm-get-app-ripple gm-get-app-ripple--icon', true\)/, 'the icon\'s ripple grows from its middle');
  });

  it('downloads Willow\'s Android app in a new tab, as Gemini\'s opens its app in one', () => {
    assert.match(buttons, /window\.open\(ANDROID_DOWNLOAD_PATH, '_blank', 'noopener'\)/);
  });
});

describe('the address', () => {
  const app = read('apps/studio/src/app/App.tsx');

  it('keeps `/app/download` for the page, not a chat', () => {
    for (const address of ['/app/download', '/app/download/']) {
      assert.equal(routes.parseShellPath(address), null, address);
      assert.equal(routes.isShellPath(address), false, address);
    }
  });

  it('spells out the first letter of a chat called "download", which reads back as the chat', () => {
    for (const surface of ['chat', 'code']) {
      const route = { surface, chatId: 'download' };
      const address = routes.shellPathFor(route);
      assert.equal(address, surface === 'chat' ? '/app/%64ownload' : '/code/%64ownload');
      assert.deepEqual(routes.parseShellPath(address), route);
    }
    assert.equal(routes.shellPathFor({ surface: 'chat', chatId: 'Download' }), '/app/Download');
    assert.deepEqual(routes.parseShellPath('/app/Download'), { surface: 'chat', chatId: 'Download' });
  });

  it('opens the page from its address and writes its address when opened', () => {
    assert.match(app, /const AppDownloadPage = React\.lazy\(\(\) => import\('\.\.\/download\/AppDownloadPage'\)\);/);
    assert.match(app, /const isDownloadPath = \(pathname: string\): boolean => \/\^\\\/app\\\/download\\\/\?\$\/\.test\(pathname\);/);
    assert.match(app, /if \(isDownloadPath\(location\.pathname\)\) return 'download';/);
    assert.match(app, /else if \(view === 'download'\) navigate\('\/app\/download'\);/);
    assert.match(app, /<Route path="\/app\/download" element=\{null\} \/>\s*<Route path="\/app\/:chatId" element=\{null\} \/>/);
    assert.match(app, /currentView === 'download' \? \(\s*<Suspense fallback=\{<StudioLoadingFallback reason="download-suspense"[^]*?<AppDownloadPage \/>/);
    assert.match(read('apps/studio/src/shell/sidebar/Sidebar.tsx'), /export type ViewType = [^;]*\| 'download';/);
  });

  it('serves the apps this checkout has built at `/download/<platform>`, in development only', () => {
    const config = read('apps/studio/vite.config.ts');
    assert.match(config, /plugins: \[[^\]]*\bappDownloads\(\)[^\]]*\]/);
    const plugin = config.slice(config.indexOf('function appDownloads(): Plugin {'));
    assert.match(plugin, /apply: 'serve',/);
    assert.match(plugin, /\/\^\\\/download\\\/\(windows\|macos\|linux\|android\)\\\/\?\$\//);
    assert.match(plugin, /android: \{ name: 'Android', dirs: \['apps\/android\/dist'\], match: \/\\\.apk\$\/i/);
    assert.match(plugin, /windows: \{ name: 'Windows', dirs: \[`\$\{BUNDLE\}\/nsis`, `\$\{BUNDLE\}\/msi`\]/);
    assert.match(plugin, /res\.setHeader\('Content-Disposition', `attachment; filename="\$\{path\.basename\(found\.file\)\}"`\);/);
    assert.match(plugin, /Willow for \$\{build\.name\} hasn't been built on this computer yet\. Build it with \$\{build\.build\}\./);
  });
});

describe('the measured look', () => {
  const rule = (scope, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[{}])\\s*${escaped} \\{([^}]*)\\}`).exec(scope)?.[1] ?? '';
  };
  const blockOf = (css, at) => {
    const start = css.indexOf(`${at} {`);
    assert.ok(start >= 0, `no ${at} block`);
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
    }
    return '';
  };
  const has = (decls, ...wanted) => { for (const decl of wanted) assert.ok(decls.includes(decl), `missing \`${decl}\` in {${decls}}`); };
  const pill = stripComments(read('apps/studio/src/download/get-app.css'));
  const css = stripComments(read('apps/studio/src/download/app-download.css'));

  it('draws the desktop pill: 36px, #171717 under #e6e6e6, an 8% and 12% layer, a 3px ring, gone at 960px', () => {
    has(rule(pill, '.gm-get-app'), 'height: 36px;', 'padding: 0 12px 0 8px;', 'border-radius: 9999px;', 'background-color: #171717;', 'color: #e6e6e6;', 'cursor: default;');
    has(rule(pill, '.gm-get-app::before'), 'background-color: #e6e6e6;', 'opacity: 0;');
    has(rule(pill, '.gm-get-app:hover::before,\n.gm-get-app:focus-visible::before'), 'opacity: 0.08;');
    has(rule(pill, '.gm-get-app:active::before'), 'opacity: 0.12;');
    has(rule(pill, '.gm-get-app:focus-visible'), 'outline: 3px solid #e6e6e6;', 'outline-offset: 2px;');
    has(rule(pill, '.gm-get-app-content'), 'height: 24px;', 'gap: 8px;');
    has(rule(pill, '.gm-get-app-label'), 'font-size: 15px;', 'line-height: 20px;', 'font-variation-settings: "ROND" 0, "slnt" 0, "wdth" 92, "wght" 400;');
    has(rule(pill, '.gm-get-app-ripple'), 'background-color: rgba(230, 230, 230, 0.1);');
    has(rule(blockOf(pill, '@media (max-width: 960px)'), '.gm-get-app'), 'display: none;');
  });

  it('draws the phone\'s: a 40px icon at 87% white, and from 480px a #333537 pill', () => {
    has(rule(pill, '.gm-phone-get-app-icon'), 'width: 40px;', 'height: 40px;', 'padding: 8px;', 'color: rgba(255, 255, 255, 0.87);');
    has(rule(pill, '.gm-phone-get-app-pill'), 'display: none;', 'height: 40px;', 'padding: 0 16px;', 'background-color: #333537;', 'color: #c4c7c5;');
    has(rule(pill, '.gm-phone-get-app-pill-icon'), 'margin: 0 8px 0 -8px;');
    has(rule(pill, '.gm-phone-get-app-label'), 'display: none;', 'font-size: 15px;', 'line-height: 20px;');
    has(rule(pill, '.gm-get-app-ripple--icon,\n.gm-get-app-ripple--pill'), 'background-color: rgba(196, 199, 197, 0.12);');
    const medium = blockOf(pill, '@media (min-width: 480px)');
    has(rule(medium, '.gm-phone-get-app-icon'), 'display: none;');
    has(rule(medium, '.gm-phone-get-app-pill'), 'display: flex;');
    has(rule(medium, '.gm-phone-get-app-label--medium'), 'display: inline-block;');
    const long = blockOf(pill, '@media (min-width: 600px)');
    has(rule(long, '.gm-phone-get-app-label--medium'), 'display: none;');
    has(rule(long, '.gm-phone-get-app-label--long'), 'display: inline-block;');
  });

  it('lays the page out as Gemini\'s: 880px of two rows on #0f0f0f, sized by the viewport', () => {
    has(rule(css, '.gm-download'), 'overflow-y: auto;', 'background-color: #0f0f0f;', 'color: #e3e3e3;');
    has(rule(css, '.gm-download-page'), 'justify-content: center;', 'padding: clamp(72px, 8vh, 86px) 24px 12px;');
    has(rule(css, '.gm-download-content'), 'max-width: 880px;', 'gap: 12px;');
    has(rule(css, '.gm-download-row'), 'gap: clamp(24px, 4vw, 48px);');
    has(rule(css, '.gm-download-info'), 'max-width: 380px;');
    has(rule(css, '.gm-download-title'), 'margin: 0 0 clamp(6px, 1.2vh, 12px);', 'font-size: 28px;', 'line-height: 36px;', 'font-variation-settings: "ROND" 20, "slnt" 0, "wdth" 100, "wght" 350;');
    has(rule(css, '.gm-download-text'), 'margin: 0 0 clamp(10px, 1.8vh, 18px);', 'font-size: 15px;', 'line-height: 20px;');
    has(rule(css, '.gm-download-mockup'), 'max-width: 440px;', 'height: clamp(230px, -75px + 50vh, 330px);', 'aspect-ratio: 4 / 3;', 'border-radius: 40px;');
    has(rule(css, '.gm-download-mockup--desktop'), 'align-self: flex-end;');
    has(rule(css, '.gm-download-mockup--phone'), 'align-self: flex-start;');
    has(rule(css, '.gm-download-footer'), 'height: 49px;', 'margin-top: 12px;');
  });

  it('draws the buttons: 40px pills, #282a2c with a 2px ring and a #a8c7fa keyboard ring, #1f3b9b on phones, a dark blue ripple', () => {
    has(rule(css, '.gm-download-cta,\n.gm-download-mobile-cta'), 'height: 40px;', 'padding: 10px 24px;', 'border-radius: 9999px;', 'line-height: normal;', 'user-select: none;');
    has(rule(css, '.gm-download-cta'), '--gm-download-cta-bg: #282a2c;', 'backdrop-filter: blur(25px);');
    has(rule(css, '.gm-download-cta:hover'), 'rgba(230, 230, 230, 0.08)');
    has(rule(css, '.gm-download-cta:focus'), 'rgba(230, 230, 230, 0.08)', 'outline: 2px solid #e3e3e3;', 'outline-offset: 2px;');
    has(rule(css, '.gm-download-cta:active'), 'rgba(230, 230, 230, 0.12)');
    has(rule(css, '.gm-download-cta:focus-visible::after'), 'inset: -3px;', 'border: 1px solid #a8c7fa;');
    has(rule(css, '.gm-download-mobile-cta'), 'background-color: #1f3b9b;', 'color: #e0e0e0;', 'transition: box-shadow 0.28s cubic-bezier(0.4, 0, 0.2, 1);');
    has(rule(css, '.gm-download-mobile-cta:hover'), 'background-color: color-mix(in srgb, #1f3b9b 92%, #e0e0e0);');
    has(rule(css, '.gm-download-ripple--tonal,\n.gm-download-ripple--accent'), 'background-color: rgba(6, 46, 111, 0.12);');
  });

  it('draws the QR card: white, 28px corners, the code at 12vh between 96px and 112px', () => {
    has(rule(css, '.gm-download-qr'), 'gap: 20px;', 'padding: 14px 20px 14px 16px;', 'border-radius: 28px;', 'background: #ffffff;', 'box-shadow: 0 4px 20px 0 rgba(227, 227, 227, 0.06);');
    has(rule(css, '.gm-download-qr-image'), 'width: clamp(96px, 12vh, 112px);', 'height: clamp(96px, 12vh, 112px);');
    has(rule(css, '.gm-download-qr-label'), 'width: 85px;', 'color: #000000;', 'font-size: 15px;', 'line-height: 20px;');
  });

  it('stacks the phone\'s row from the top on black at 960px and below, the picture as wide as the column', () => {
    const narrow = blockOf(css, '@media (max-width: 960px)');
    has(rule(narrow, '.gm-download'), 'background-color: #000000;');
    has(rule(narrow, '.gm-download-page'), 'justify-content: flex-start;', 'padding: clamp(72px, 14vh, 128px) 24px 24px;');
    has(rule(narrow, '.gm-download-row'), 'flex-direction: column;', 'gap: 24px;');
    has(rule(narrow, '.gm-download-title'), 'margin: 0 0 12px;');
    has(rule(narrow, '.gm-download-text'), 'margin: 0 0 24px;');
    has(rule(narrow, '.gm-download-mockup--phone'), 'width: 100%;', 'height: auto;');
    has(rule(narrow, '.gm-download-footer'), 'height: 13px;', 'margin-top: 48px;');
  });

  it('neither animates in nor out, as Gemini\'s page swaps in with the route', () => {
    assert.ok(!/\banimation\b|@keyframes/.test(css + pill));
    for (const selector of ['.gm-download', '.gm-download-page', '.gm-download-content', '.gm-download-row', '.gm-download-mockup']) {
      assert.ok(!/\btransition\b/.test(rule(css, selector)), `${selector} animates`);
    }
  });
});
