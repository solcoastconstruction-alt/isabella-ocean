// Local testing only: a plain forwarder from 127.0.0.1 to the PUBLIC devnet endpoint.
//
// Why it exists: every request a Worker makes carries a CF-Worker header (the local runtime adds it
// too), and api.devnet.solana.com answers any request with that header with
// 403 "Your IP or provider is blocked from this endpoint". So `wrangler dev` cannot use the public
// endpoint as its upstream directly. This hop receives the relay's request and re-sends only the
// body, which the public endpoint accepts. A paid provider needs no such hop.
//
//   node rpc-relay/tools/devnet-hop.mjs            listens on http://127.0.0.1:8899
//   rpc-relay/.dev.vars:  UPSTREAM_RPC_URL=http://127.0.0.1:8899
import http from 'node:http';

const PORT = Number(process.env.HOP_PORT || 8899);
const TARGET = process.env.HOP_TARGET || 'https://api.devnet.solana.com';
const counts = {};

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    if (req.method === 'GET' && req.url === '/counts') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(counts)); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    const body = Buffer.concat(chunks).toString('utf8');
    try { const j = JSON.parse(body); for (const c of Array.isArray(j) ? j : [j]) counts[c.method] = (counts[c.method] || 0) + 1; } catch (e) { /* forwarded as it is */ }
    try {
      const up = await fetch(TARGET, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const text = await up.text();
      res.writeHead(up.status, { 'content-type': 'application/json' });
      res.end(text);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('hop: target unreachable');
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`devnet hop on http://127.0.0.1:${PORT} -> ${TARGET}`));
