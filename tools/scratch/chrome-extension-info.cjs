/**
 * Read-only: one extension of the debug profile, from its manifest and the profile's records
 * (name, version, enabled state, install time, the proxy rule it set, decoded).
 *
 *   node tools/scratch/chrome-extension-info.cjs <extension id>
 */
const fs = require('fs');
const path = require('path');

const id = process.argv[2];
if (!id) throw new Error('chrome-extension-info <extension id>');
const PROFILE = 'C:\\Users\\Yashjit 2\\ChromeDebugProfile\\Default';

const dir = path.join(PROFILE, 'Extensions', id);
let manifest = null;
let messages = null;
if (fs.existsSync(dir)) {
  const version = fs.readdirSync(dir).sort().at(-1);
  manifest = JSON.parse(fs.readFileSync(path.join(dir, version, 'manifest.json'), 'utf8'));
  const locale = path.join(dir, version, '_locales', manifest.default_locale || 'en', 'messages.json');
  if (fs.existsSync(locale)) messages = JSON.parse(fs.readFileSync(locale, 'utf8'));
}
const msg = (value) => {
  const m = /^__MSG_(\w+)__$/.exec(value || '');
  return m && messages ? (messages[m[1]]?.message ?? messages[m[1].toLowerCase()]?.message ?? value) : value;
};
const secure = JSON.parse(fs.readFileSync(path.join(PROFILE, 'Secure Preferences'), 'utf8'));
const settings = secure.extensions?.settings?.[id] || {};
const chromeTime = (t) => (t ? new Date(Number(BigInt(t) / 1000n) - 11644473600000).toISOString() : null);
const proxy = settings.preferences?.proxy;
let pac = null;
if (proxy?.pac_url?.startsWith('data:')) pac = Buffer.from(proxy.pac_url.split(',')[1], 'base64').toString('utf8');

console.log(JSON.stringify({
  name: msg(manifest?.name),
  description: msg(manifest?.description)?.slice(0, 160),
  version: manifest?.version,
  installedFrom: settings.from_webstore ? 'web store' : (settings.location ?? null),
  state: settings.state ?? null,
  disableReasons: settings.disable_reasons ?? null,
  firstInstall: chromeTime(settings.first_install_time),
  lastUpdate: chromeTime(settings.last_update_time),
  proxyMode: proxy?.mode ?? null,
}, null, 1));
if (pac) {
  const proxies = [...new Set(pac.match(/(?:PROXY|HTTPS|SOCKS5?)\s+[\w.-]+:\d+/g) || [])];
  console.log(`PAC: ${pac.length} chars; proxies named in it: ${proxies.slice(0, 12).join(', ') || '(none literal)'}`);
}
