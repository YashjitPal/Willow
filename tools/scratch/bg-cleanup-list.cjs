/** Lists the background-work test artifacts in the Willow folder, with the evidence that each one is a test. */
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/Yashjit 2/Willow';
const chatsDir = path.join(ROOT, 'Chats');
const tasksDir = path.join(ROOT, 'Spark', 'Tasks');

const firstUser = (messages) => (Array.isArray(messages) ? messages.find((m) => m.role === 'user')?.content || '' : '');

for (const name of fs.readdirSync(chatsDir)) {
  if (!name.endsWith('.json')) continue;
  if (!/^(Lighthouse Keeper|Number List One to Fourhundred|Keep Items|New Conversation)/.test(name)) continue;
  const file = path.join(chatsDir, name);
  let question = '';
  try { question = firstUser(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { question = '(unreadable)'; }
  const sibling = path.join(chatsDir, name.replace(/\.json$/, ''));
  console.log(`CHAT ${name} | ${fs.statSync(file).mtime.toISOString()} | first message: ${JSON.stringify(question.slice(0, 70))}${fs.existsSync(sibling) ? ' | has folder' : ''}`);
}

for (const name of fs.readdirSync(tasksDir)) {
  if (!name.endsWith('.json')) continue;
  const isMine = name.startsWith('8a58939a-1532-43aa-a30d-8440d120590f');
  const isListedConflict = name.startsWith('5988343a-9563-4af5-88cf-b65b8f8b6cba (Disk conflict');
  if (!isMine && !isListedConflict) continue;
  const file = path.join(tasksDir, name);
  let task = {};
  try { task = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const sibling = path.join(tasksDir, name.replace(/\.json$/, ''));
  console.log(`TASK ${name} | title: ${task.title} | prompt: ${JSON.stringify((task.prompt || '').slice(0, 60))}${fs.existsSync(sibling) ? ' | has folder' : ''}`);
}
