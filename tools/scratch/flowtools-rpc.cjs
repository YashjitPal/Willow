// Summarise a 09-network.cjs capture: per batchexecute call, the rpc id, its decoded f.req
// argument and the start of its decoded response payload.
//   node tools/scratch/flowtools-rpc.cjs <net-name> [rpcid] [--full]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const name = args[0];
const only = args[1] && !args[1].startsWith('--') ? args[1] : null;
const full = args.includes('--full');
const outFile = args.find((a) => a.startsWith('--out='))?.slice(6);
const list = JSON.parse(fs.readFileSync(path.join(__dirname, '../ui-research/captures/flow/tools/net', `${name}.json`), 'utf8'));

const decodeReq = (post) => {
  const m = /f\.req=([^&]*)/.exec(post || '');
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' '))); } catch { return decodeURIComponent(m[1]); }
};
const decodeRes = (body) => {
  if (!body || !body.startsWith(")]}'")) return body;
  const out = [];
  for (const line of body.split('\n')) {
    if (!line.startsWith('[')) continue;
    try {
      for (const entry of JSON.parse(line)) {
        if (entry[0] === 'wrb.fr') out.push({ rpc: entry[1], data: entry[2] ? JSON.parse(entry[2]) : null });
      }
    } catch { /* partial chunk */ }
  }
  return out;
};

for (const r of list) {
  const rpc = /rpcids=([^&]+)/.exec(r.url)?.[1];
  if (!rpc || (only && rpc !== only)) continue;
  const req = decodeReq(r.post);
  const res = decodeRes(r.body);
  const reqArg = req?.[0]?.[0]?.[1];
  console.log(`\n=== ${rpc} (${r.status}) req=${String(reqArg).slice(0, 400)}`);
  const text = JSON.stringify(res?.[0]?.data ?? res);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify({ rpc, req: reqArg, data: res?.[0]?.data ?? res }, null, 1));
  console.log(full ? text : `${text.slice(0, 1200)}${text.length > 1200 ? ` … (${text.length} chars)` : ''}`);
}
