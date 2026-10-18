/**
 * Which host:port pairs accept a TCP connection, from Node (not through any browser proxy).
 *
 *   node tools/scratch/tcp-reach.cjs host:port [host:port ...]
 */
const net = require('net');

const check = (pair) => new Promise((resolve) => {
  const [host, port] = pair.split(':');
  const t0 = Date.now();
  const socket = net.connect({ host, port: Number(port), timeout: 6000 });
  const done = (result) => { socket.destroy(); resolve(`${pair}  ${result} ${Date.now() - t0}ms`); };
  socket.on('connect', () => done('open'));
  socket.on('timeout', () => done('timeout'));
  socket.on('error', (error) => done(error.code));
});

(async () => {
  const results = await Promise.all(process.argv.slice(2).map(check));
  for (const line of results) console.log(line);
})();
