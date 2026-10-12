/**
 * Checks a set of environment variables before you trust it with production.
 *
 *   node scripts/preflight.mjs                  # checks backend/.env
 *   node scripts/preflight.mjs /path/to/file    # checks another file
 *
 * It runs the same `validateConfig` the API runs at boot, so it cannot drift away
 * from what the server will actually accept - a separate list of rules would be
 * wrong within a month. On top of that it reports the things that are not errors
 * but are worth seeing before a deploy: which storage photos will go to, whether
 * a seed password has been left lying around, whether Swagger is open.
 *
 * It never prints a value. Secrets are reported as set or missing and by length,
 * because the useful question is "is it there and plausible", never "what is it".
 *
 * It connects to nothing. Checking configuration should not require the database
 * to be up, and should never be the thing that touches production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..', '.env'));

/** Secrets are reported by presence and length, never by value. */
const SECRET = /PASSWORD|SECRET|TOKEN|KEY$/i;

function parseEnvFile(path) {
  const text = readFileSync(path, 'utf8');
  const out = {};

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  return out;
}

const problems = [];
const notes = [];

let env;
try {
  env = parseEnvFile(file);
} catch (error) {
  console.error(`Could not read ${file}: ${error.message}`);
  process.exit(1);
}

console.log(`\nPreflight: ${file}`);
console.log(`NODE_ENV=${env.NODE_ENV ?? '(unset - treated as development)'}\n`);

// --- The same rules the server enforces at boot -------------------------------
// Loaded through the compiled config so there is exactly one source of truth.
const previous = { ...process.env };
Object.assign(process.env, env);

try {
  const configPath = resolve(import.meta.dirname, '..', 'dist', 'config', 'configuration.js');
  const { configuration, validateConfig } = await import(pathToFileURL(configPath).href);

  validateConfig(configuration());
  console.log('  PASS  the API would accept this configuration at boot');
} catch (error) {
  const detail = String(error.message ?? error);

  if (detail.includes('Cannot find module')) {
    problems.push('Run `npm run build` first - preflight reads the compiled config.');
  } else {
    console.log('  FAIL  the API would refuse to start:');
    for (const line of detail.split('\n').slice(1)) console.log(`        ${line.trim()}`);
    problems.push('Configuration rejected at boot.');
  }
} finally {
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
}

// --- Presence, without ever printing a value ----------------------------------
const REQUIRED = [
  'NODE_ENV',
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_USERNAME',
  'DB_PASSWORD',
  'DB_DATABASE',
  'JWT_SECRET',
  'CORS_ORIGINS',
  'PUBLIC_API_URL',
  'PUBLIC_WEB_URL',
  'UPLOADS_DIR',
];

console.log('');
for (const key of REQUIRED) {
  const value = env[key];

  if (!value) {
    problems.push(`${key} is not set.`);
    console.log(`  FAIL  ${key} missing`);
  } else {
    console.log(`  PASS  ${key} ${SECRET.test(key) ? `set (${value.length} chars)` : `= ${value}`}`);
  }
}

// --- Things that are legal but worth seeing before a deploy -------------------
const production = env.NODE_ENV === 'production';

if (production && env.SWAGGER_ENABLED === 'true') {
  notes.push('SWAGGER_ENABLED=true publishes your API docs. Fine if deliberate.');
}

if (env.PLATFORM_ADMIN_PASSWORD) {
  notes.push(
    'PLATFORM_ADMIN_PASSWORD is still set. It is a one-time seed: once the administrator ' +
      'exists it does nothing but keep a password in the environment. Remove it.',
  );
}

const cloudflare = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_IMAGES_TOKEN', 'CLOUDFLARE_IMAGES_ACCOUNT_HASH'];
const cfSet = cloudflare.filter((key) => env[key]).length;

notes.push(
  cfSet === 3
    ? 'Dish photos will go to Cloudflare Images.'
    : 'Dish photos will be written to UPLOADS_DIR. In production that must be a mounted volume, or a deploy wipes them.',
);

if (production && env.DB_SSL !== 'true' && !/\.railway\.internal$|^localhost$|^127\./.test(env.DB_HOST ?? '')) {
  problems.push('DB_SSL is not enabled and the database is not on a private network.');
}

if (env.LOGIN_THROTTLE_LIMIT && Number(env.LOGIN_THROTTLE_LIMIT) > 10) {
  notes.push(
    `LOGIN_THROTTLE_LIMIT=${env.LOGIN_THROTTLE_LIMIT} is loose for a credential route. 5 is the default.`,
  );
}

console.log('');
for (const note of notes) console.log(`  NOTE  ${note}`);

console.log('');
if (problems.length === 0) {
  console.log('Preflight passed.\n');
  process.exit(0);
}

console.log(`Preflight found ${problems.length} problem(s):`);
for (const problem of problems) console.log(`  - ${problem}`);
console.log('');
process.exit(1);
