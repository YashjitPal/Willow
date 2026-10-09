// Writes out the first Write tool call's contents for a path, from an agent transcript (JSONL):
// how a scratch file overwritten later in the same session is put back.
//   node tools/scratch/restore-from-transcript.cjs <transcript.jsonl> <path suffix> <out file>
const fs = require('fs');

const [, , transcript, suffix, out] = process.argv;
for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
  if (!line.includes(suffix)) continue;
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  for (const part of event?.message?.content ?? []) {
    if (part?.type === 'tool_use' && part.name === 'Write' && String(part.input?.path).endsWith(suffix)) {
      fs.writeFileSync(out, part.input.contents.replace(/\r?\n/g, '\r\n'));
      console.log(`restored ${part.input.contents.length} chars -> ${out}`);
      process.exit(0);
    }
  }
}
console.error('not found');
process.exit(1);
