/**
 * Read-only: what the debug Chrome profile says about proxies and network blocking, from its
 * Preferences / Secure Preferences files and Chrome's policy keys.
 *
 *   node tools/scratch/chrome-profile-proxy.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROFILE = 'C:\\Users\\Yashjit 2\\ChromeDebugProfile';
const find = (obj, re, at = '', out = []) => {
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    const here = at ? `${at}.${key}` : key;
    if (re.test(key)) out.push(`${here} = ${JSON.stringify(value).slice(0, 300)}`);
    find(value, re, here, out);
  }
  return out;
};

for (const file of ['Default/Preferences', 'Default/Secure Preferences', 'Local State']) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(PROFILE, file), 'utf8'));
    const hits = find(json, /proxy|cold.?turkey|dns_over_https|doh/i).slice(0, 20);
    console.log(`== ${file}\n  ${hits.join('\n  ') || '(nothing)'}`);
  } catch (error) {
    console.log(`== ${file}: ${error.message}`);
  }
}
for (const key of ['HKLM\\SOFTWARE\\Policies\\Google\\Chrome', 'HKCU\\SOFTWARE\\Policies\\Google\\Chrome']) {
  try {
    console.log(`== ${key}\n${execSync(`reg query "${key}" /s`, { encoding: 'utf8' }).trim().slice(0, 1500)}`);
  } catch {
    console.log(`== ${key}: none`);
  }
}
