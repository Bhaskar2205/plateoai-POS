/**
 * Builds plateo-print-agent.exe: the agent and the Node runtime in one file, so
 * a restaurant till needs nothing installed to run it.
 *
 * Uses Node's single-executable-application support: the script is packed into
 * a blob and injected into a copy of the node binary that runs this build.
 *
 *   node build-exe.cjs          -> dist/plateo-print-agent.exe
 *
 * The .exe is not committed (dist/ is ignored); it is built and handed out.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const dist = path.join(here, 'dist');
const blob = path.join(dist, 'sea-prep.blob');
const exe = path.join(dist, process.platform === 'win32' ? 'plateo-print-agent.exe' : 'plateo-print-agent');
const config = path.join(dist, 'sea-config.json');

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(
  config,
  JSON.stringify({ main: path.join(here, 'agent.js'), output: blob, disableExperimentalSEAWarning: true }),
);

// Only npx needs a shell on Windows (it is a .cmd); node is called directly,
// because a shell would split "C:\Program Files" at the space.
const run = (cmd, args, shell = false) => execFileSync(cmd, args, { stdio: 'inherit', shell });

console.log('1/3  packing agent.js');
run(process.execPath, ['--experimental-sea-config', config]);

console.log('2/3  copying the Node runtime');
fs.copyFileSync(process.execPath, exe);

console.log('3/3  injecting the agent');
run(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes',
  'postject@1.0.0-alpha.6',
  exe,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  '--overwrite',
], process.platform === 'win32');

fs.rmSync(blob, { force: true });
fs.rmSync(config, { force: true });

const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\nbuilt ${exe} (${mb} MB)`);
