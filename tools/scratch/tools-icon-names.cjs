// The Google Symbols names the Tools pages draw: icon props and literals in features/media/src/tools,
// plus the picker and menus they open. Prints them comma-separated for symbols-subset-headless --check.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../../features/media/src/tools');
const names = new Set(['code', 'css', 'description', 'radio_button_checked', 'radio_button_unchecked', 'check_circle', 'error', 'arrow_forward_ios', 'warning', 'info']);
const patterns = [/(?:name|icon)="([a-z][a-z0-9_]+)"/g, /icon: '([a-z][a-z0-9_]+)'/g, /'(keyboard_arrow_[a-z]+|push_pin|bug_report|thumb_[a-z]+|content_copy|stop|undo|extension|shuffle|assignment|star|favorite|share|more_vert|arrow_back|arrow_forward|close|done|flag|image|edit|delete|open_in_full|restart_alt|upgrade|apps_spark_2|app_registration|add|link|photo|publish)'/g];
for (const f of fs.readdirSync(dir)) {
  if (!/\.(tsx?|css)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const re of patterns) for (const m of src.matchAll(re)) names.add(m[1]);
}
console.log([...names].sort().join(','));
