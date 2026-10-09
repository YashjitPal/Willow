// How far `aria-label="Copy prompt"` sits after `handleCopyPrompt(msg)` (copy-toast.test allows 800), HEAD vs now.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repo = path.resolve(__dirname, '../..');
const head = execSync('git show HEAD:features/chat/src/ChatView.tsx', { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
const now = fs.readFileSync(path.join(repo, 'features/chat/src/ChatView.tsx'), 'utf8');
for (const [name, src] of [['HEAD', head], ['working', now]]) {
  const at = src.indexOf('handleCopyPrompt(msg)');
  const label = src.indexOf('aria-label="Copy prompt"', at);
  console.log(name, 'distance', label - at, 'lines', src.split('\n').length);
}
