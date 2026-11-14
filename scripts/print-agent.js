#!/usr/bin/env node
// Mizani print agent: runs on a computer in the restaurant and sends receipts and kitchen tickets to a network
// thermal printer (ESC/POS over TCP port 9100). No dependencies.
//
//   One receipt:        node print-agent.js --server http://localhost:3000 --token $TOKEN --printer 192.168.1.50 --receipt BILL_ID
//   Kitchen watcher:    node print-agent.js --server https://app.example.com --token $TOKEN --printer 192.168.1.51 --watch-kot
//
// --watch-kot polls open bills every 3 seconds and prints only lines the kitchen has not been sent yet. The server marks
// lines as sent, so a restart or a second agent never prints an order twice. Use a long-lived waiter/cashier login for the token.
const net = require('net');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const server = (arg('server', 'http://localhost:3000')).replace(/\/$/, ''), token = arg('token', process.env.MIZANI_TOKEN), host = arg('printer'), port = Number(arg('port', 9100));
if (!token || !host || (!flag('watch-kot') && !arg('receipt'))) { console.error('usage: print-agent.js --server URL --token TOKEN --printer IP [--port 9100] (--receipt BILL_ID [--drawer] | --watch-kot)'); process.exit(2); }
const api = async (method, path) => { const r = await fetch(server + '/api' + path, { method, headers: { authorization: 'Bearer ' + token } }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error || ''}`); return j; };
const send = (bytes) => new Promise((res, rej) => { const s = net.connect({ host, port, timeout: 5000 }, () => s.end(bytes)); s.on('close', () => res()); s.on('timeout', () => { s.destroy(); rej(new Error('printer timed out')); }); s.on('error', rej); });
(async () => {
  if (arg('receipt')) { const r = await api('GET', `/bills/${arg('receipt')}/receipt?format=escpos${flag('drawer') ? '&drawer=1' : ''}`); await send(Buffer.from(r.base64, 'base64')); console.log('receipt printed'); return; }
  console.log(`watching for kitchen orders, printing to ${host}:${port}`);
  for (;;) {
    try { for (const b of await api('GET', '/bills?status=open')) { const k = await api('POST', `/bills/${b.id}/kot?format=escpos`); if (k.lines) { await send(Buffer.from(k.base64, 'base64')); console.log(new Date().toISOString(), 'printed', k.bill, k.lines, 'line(s)'); } } }
    catch (e) { console.error(new Date().toISOString(), e.message); }
    await new Promise((r) => setTimeout(r, 3000));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
