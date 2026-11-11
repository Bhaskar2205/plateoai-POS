#!/usr/bin/env node
'use strict';

/**
 * Plateo Print Agent.
 *
 * Runs on the till. Plateo, open in Chrome on the same till, sends it a kitchen
 * ticket or a bill already turned into ESC/POS bytes; it passes those bytes to
 * the thermal printer's raw port (9100) on the restaurant's network. That is the
 * whole job.
 *
 * Why it exists: printing through the browser hands the paper to the Windows
 * driver - its form length, its margins, its orientation - and that is how a
 * two-item bill came out sideways down two metres of blank roll. A printer fed
 * ESC/POS directly has no page at all, so none of that can happen. A website
 * cannot open a socket to a printer, and the cloud cannot reach one behind the
 * restaurant's router, so something on the till has to.
 *
 * Deliberately small and dependency-free, so there is nothing to install but
 * this file (or the single .exe built from it):
 *
 *  - listens on 127.0.0.1 only, so no other machine on the network can use it;
 *  - accepts print jobs only from Plateo's own web address, so a random website
 *    open in another tab cannot feed the printer;
 *  - accepts configuration only from its own settings page, at
 *    http://127.0.0.1:9123, so no website can repoint the printers;
 *  - keeps the printer addresses on this till, never in the cloud.
 */

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const VERSION = '1.0.0';
const PORT = Number(process.env.PLATEO_AGENT_PORT) || 9123;
const HOST = '127.0.0.1';
const SELF_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

/** Where Plateo is served from. Development servers are allowed so it can be tested. */
const ALLOWED_ORIGINS = new Set(
  [
    'https://app.plateoai.in',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    ...(process.env.PLATEO_ALLOWED_ORIGINS || '').split(','),
  ]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const MAX_JOB_BYTES = 4 * 1024 * 1024;
const PRINTER_TIMEOUT_MS = 8000;

// --- configuration ----------------------------------------------------------

const CONFIG_PATH =
  process.env.PLATEO_AGENT_CONFIG ||
  path.join(
    process.env.APPDATA || path.join(os.homedir(), '.config'),
    'PlateoPrintAgent',
    'config.json',
  );

/**
 * `bill` is the counter printer. `kot` is the kitchen printer; left empty, kitchen
 * tickets go to the bill printer, which is how a one-printer restaurant runs.
 */
function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      printers: {
        bill: parsed?.printers?.bill || null,
        kot: parsed?.printers?.kot || null,
      },
    };
  } catch {
    return { printers: { bill: null, kot: null } };
  }
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * A printer address: an IPv4 address or host name, with an optional port.
 * Returns the normalised "host:port", null for empty, or throws on nonsense.
 */
function parsePrinter(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const match = text.match(/^([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/);
  const port = match ? Number(match[2] || 9100) : 0;

  if (!match || port < 1 || port > 65535) {
    throw new Error(`"${text}" is not a printer address. Use the printer's IP, e.g. 192.168.1.50`);
  }

  return `${match[1]}:${port}`;
}

/** The printer that does this kind of job. */
function printerFor(role, config = readConfig()) {
  if (role === 'kot') return config.printers.kot || config.printers.bill;
  return config.printers.bill;
}

// --- talking to the printer -------------------------------------------------

/**
 * Writes the job to the printer's raw port.
 *
 * Reports which stage failed, because that decides what Plateo may do next:
 * `connect` means nothing reached the printer and the browser may safely print
 * it instead; `write` means part of the job may already be on paper, and
 * printing it again another way could put two bills on the table.
 */
function sendRaw(target, data) {
  const [host, portText] = target.split(':');
  const port = Number(portText) || 9100;

  return new Promise((resolve) => {
    let connected = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = net.createConnection({ host, port });
    socket.setTimeout(PRINTER_TIMEOUT_MS);

    socket.on('connect', () => {
      connected = true;
      socket.end(data);
    });

    // Everything handed to the OS and the printer closed its side, or we did.
    socket.on('finish', () => setTimeout(() => finish({ ok: true }), 50));

    socket.on('timeout', () =>
      finish({
        ok: false,
        stage: connected ? 'write' : 'connect',
        message: connected
          ? `The printer at ${target} stopped answering mid-job.`
          : `No printer answered at ${target}. Is it switched on and on the same network?`,
      }),
    );

    socket.on('error', (error) =>
      finish({
        ok: false,
        stage: connected ? 'write' : 'connect',
        message: `${connected ? 'Lost the printer' : 'Could not reach the printer'} at ${target} (${error.code || error.message}).`,
      }),
    );
  });
}

/** A short ticket to prove the address is right, built here so it needs no website. */
function testTicket(role, target) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const text = (value) => Buffer.from(`${value}\n`, 'ascii');
  const when = new Date().toLocaleString('en-IN');

  return Buffer.concat([
    Buffer.from([ESC, 0x40, ESC, 0x61, 1, ESC, 0x45, 1, GS, 0x21, 0x11]),
    text('PLATEO'),
    Buffer.from([GS, 0x21, 0x00, ESC, 0x45, 0]),
    text('Print agent test'),
    text('-'.repeat(32)),
    text(`${role === 'kot' ? 'Kitchen (KOT)' : 'Bill'} printer`),
    text(target),
    text(when),
    text('-'.repeat(32)),
    text('If you can read this, Plateo'),
    text('can print here directly.'),
    Buffer.from([GS, 0x56, 66, 24]),
  ]);
}

// --- HTTP -------------------------------------------------------------------

function send(res, status, body, extraHeaders = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

/**
 * CORS for Plateo's own address, and nobody else's.
 *
 * `Access-Control-Allow-Private-Network` answers Chrome's preflight for a public
 * site calling a local address; newer Chrome asks the person at the till once
 * instead, and needs nothing from here.
 */
function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('That job is too large to be a receipt.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const log = (...parts) => console.log(new Date().toLocaleTimeString('en-IN'), ...parts);

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const origin = req.headers.origin;
  const cors = corsHeaders(origin);
  const fromSettingsPage = origin && SELF_ORIGINS.has(origin);

  if (req.method === 'OPTIONS') {
    if (!cors) return send(res, 403, { ok: false, message: 'Origin not allowed.' });
    res.writeHead(204, cors);
    return res.end();
  }

  // Plateo asks whether this till can print directly, and to which printers.
  if (req.method === 'GET' && url.pathname === '/status') {
    if (origin && !cors && !fromSettingsPage) {
      return send(res, 403, { ok: false, message: 'Origin not allowed.' });
    }
    const config = readConfig();
    return send(
      res,
      200,
      { ok: true, agent: 'plateo-print-agent', version: VERSION, printers: config.printers },
      cors || {},
    );
  }

  // A job from Plateo: ESC/POS bytes for one kitchen ticket or one bill.
  if (req.method === 'POST' && url.pathname === '/print') {
    if (!cors) return send(res, 403, { ok: false, stage: 'config', message: 'Origin not allowed.' });

    const role = url.searchParams.get('role') === 'kot' ? 'kot' : 'bill';
    const target = printerFor(role);

    if (!target) {
      return send(
        res,
        409,
        {
          ok: false,
          stage: 'config',
          message: 'No printer set up in the Plateo Print Agent. Open http://127.0.0.1:9123 on this till.',
        },
        cors,
      );
    }

    let data;
    try {
      data = await readBody(req, MAX_JOB_BYTES);
    } catch (error) {
      return send(res, 413, { ok: false, stage: 'config', message: error.message }, cors);
    }

    const result = await sendRaw(target, data);
    log(`${role.toUpperCase().padEnd(4)} ${data.length} bytes -> ${target}  ${result.ok ? 'ok' : result.message}`);

    return send(res, result.ok ? 200 : 502, { ...result, printer: target }, cors);
  }

  // The settings page, and the two things it can do. Only from itself.
  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, settingsPage());
  }

  if (req.method === 'POST' && (url.pathname === '/config' || url.pathname === '/test')) {
    if (!fromSettingsPage) {
      return send(res, 403, { ok: false, message: 'Settings can only be changed from this till.' });
    }

    let body;
    try {
      body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8') || '{}');
    } catch {
      return send(res, 400, { ok: false, message: 'That was not a valid request.' });
    }

    if (url.pathname === '/config') {
      try {
        const config = { printers: { bill: parsePrinter(body.bill), kot: parsePrinter(body.kot) } };
        writeConfig(config);
        log(`printers set: bill=${config.printers.bill || '-'} kot=${config.printers.kot || '-'}`);
        return send(res, 200, { ok: true, printers: config.printers });
      } catch (error) {
        return send(res, 400, { ok: false, message: error.message });
      }
    }

    const role = body.role === 'kot' ? 'kot' : 'bill';
    const target = printerFor(role);
    if (!target) return send(res, 409, { ok: false, message: 'Save a printer address first.' });

    const result = await sendRaw(target, testTicket(role, target));
    log(`TEST ${role} -> ${target}  ${result.ok ? 'ok' : result.message}`);
    return send(res, result.ok ? 200 : 502, { ...result, printer: target });
  }

  return send(res, 404, { ok: false, message: 'Not found.' });
}

function settingsPage() {
  const { printers } = readConfig();
  const value = (v) => (v ? String(v).replace(/"/g, '&quot;') : '');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plateo Print Agent</title>
<style>
  :root { --ink:#16201b; --muted:#5d6b63; --line:#dfe6e1; --brand:#1f6b45; --bg:#f6f8f6; --bad:#b42318; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--ink); background:var(--bg); }
  main { max-width:560px; margin:40px auto; padding:0 16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:22px; }
  h1 { font-size:20px; margin:0 0 4px; } p { margin:0 0 16px; color:var(--muted); }
  label { display:block; font-weight:600; margin:16px 0 6px; }
  small { display:block; color:var(--muted); font-weight:400; }
  input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; font:inherit; }
  .row { display:flex; gap:8px; margin-top:20px; flex-wrap:wrap; }
  button { padding:10px 14px; border-radius:10px; border:1px solid var(--line); background:#fff; font:inherit; cursor:pointer; }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; font-weight:600; }
  #msg { margin-top:16px; min-height:1.5em; font-weight:600; }
  .ok { color:var(--brand); } .bad { color:var(--bad); }
  .foot { margin-top:16px; font-size:13px; color:var(--muted); }
</style></head>
<body><main><div class="card">
  <h1>Plateo Print Agent</h1>
  <p>Lets Plateo print kitchen tickets and bills on this till straight to the thermal printer - the right length, no blank paper, never sideways.</p>

  <label for="bill">Bill printer <small>The counter printer's IP address, e.g. 192.168.1.50</small></label>
  <input id="bill" placeholder="192.168.1.50" value="${value(printers.bill)}" autocomplete="off">

  <label for="kot">Kitchen (KOT) printer <small>Leave empty if kitchen tickets come out of the bill printer</small></label>
  <input id="kot" placeholder="same as the bill printer" value="${value(printers.kot)}" autocomplete="off">

  <div class="row">
    <button class="primary" id="save">Save</button>
    <button id="testBill">Test bill printer</button>
    <button id="testKot">Test kitchen printer</button>
  </div>
  <div id="msg"></div>
  <div class="foot">Then in Plateo open <b>KOT &amp; Printing</b> and press <b>Connect this till</b>. Keep this program running; it starts by itself with Windows. Version ${VERSION}.</div>
</div></main>
<script>
  const msg = document.getElementById('msg');
  const say = (text, ok) => { msg.textContent = text; msg.className = ok ? 'ok' : 'bad'; };
  async function post(path, body) {
    const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    return r.json();
  }
  document.getElementById('save').onclick = async () => {
    const r = await post('/config', { bill: bill.value, kot: kot.value });
    say(r.ok ? 'Saved.' : r.message, r.ok);
  };
  const test = (role) => async () => {
    say('Printing...', true);
    const r = await post('/test', { role });
    say(r.ok ? 'Sent to ' + r.printer + '. Check the printer.' : r.message, r.ok);
  };
  document.getElementById('testBill').onclick = test('bill');
  document.getElementById('testKot').onclick = test('kot');
</script></body></html>`;
}

// --- running on a till ------------------------------------------------------

function isPackagedExe() {
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function openInBrowser(url) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
}

/**
 * Starts with Windows, for this user. Re-pointed at wherever the .exe now lives
 * every time it runs, so moving the file never leaves a dead entry behind.
 */
function registerAutostart() {
  if (process.platform !== 'win32') return;
  const command = `cmd.exe /c start "" /min "${process.execPath}"`;
  execFile(
    'reg',
    ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'PlateoPrintAgent', '/t', 'REG_SZ', '/d', command, '/f'],
    (error) => error && log('could not register to start with Windows:', error.message),
  );
}

function unregisterAutostart() {
  execFile(
    'reg',
    ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'PlateoPrintAgent', '/f'],
    () => {
      console.log('Plateo Print Agent will no longer start with Windows.');
      process.exit(0);
    },
  );
}

if (process.argv.includes('--uninstall')) {
  unregisterAutostart();
} else {
  process.title = 'Plateo Print Agent - keep this running';

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log('error:', error.message);
      if (!res.headersSent) send(res, 500, { ok: false, message: 'The print agent hit an error.' });
    });
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      // Already running: show its settings rather than a second copy.
      console.log(`Plateo Print Agent is already running on port ${PORT}.`);
      openInBrowser(`http://${HOST}:${PORT}/`);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    console.error(error);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const { printers } = readConfig();
    console.log(`Plateo Print Agent ${VERSION}`);
    console.log(`  listening on http://${HOST}:${PORT}  (this till only)`);
    console.log(`  bill printer : ${printers.bill || 'not set'}`);
    console.log(`  KOT printer  : ${printers.kot || '(same as bill)'}`);
    console.log(`  settings     : ${CONFIG_PATH}`);
    console.log('  Keep this window open. It starts by itself with Windows.\n');

    // PLATEO_AGENT_NO_AUTOSTART lets the .exe be tested without adding itself
    // to the startup list of whatever machine it is being tested on.
    const wantsAutostart = isPackagedExe() || process.argv.includes('--install');
    if (wantsAutostart && !process.env.PLATEO_AGENT_NO_AUTOSTART) registerAutostart();
    if (!printers.bill && !process.env.PLATEO_AGENT_CONFIG) openInBrowser(`http://${HOST}:${PORT}/`);
  });
}
