/**
 * Prints the Cloudflare Images account hash, read from your own account.
 *
 *   node scripts/cloudflare-account-hash.mjs
 *
 * The hash is the middle segment of every delivery URL
 * (https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>) and Cloudflare
 * does not expose it as a field of its own, so this reads it out of the URLs the
 * API returns for images you already have.
 *
 * Credentials come from backend/.env, never from the command line: an argument
 * lands in shell history and in the process list, where other users on the
 * machine can read it.
 *
 * Read-only. It lists images and creates nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];

  try {
    const line = readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((row) => row.startsWith(`${name}=`));

    return line ? line.slice(name.length + 1).trim() : '';
  } catch {
    return '';
  }
}

const accountId = fromEnvFile('CLOUDFLARE_ACCOUNT_ID');
const token = fromEnvFile('CLOUDFLARE_IMAGES_TOKEN');

if (!accountId || !token) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_IMAGES_TOKEN in backend/.env first.');
  process.exit(1);
}

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?per_page=1`,
  { headers: { Authorization: `Bearer ${token}` } },
);

const body = await response.json().catch(() => null);

if (!response.ok || !body?.success) {
  // Cloudflare's own message is the useful part - a wrong token and a token
  // missing the Images scope fail differently, and guessing between them wastes
  // more time than printing what it said.
  console.error(`Cloudflare refused the request (HTTP ${response.status}).`);
  for (const error of body?.errors ?? []) console.error(`  ${error.code}: ${error.message}`);
  process.exit(1);
}

const [image] = body.result?.images ?? [];

if (!image) {
  console.error(
    'That account has no images yet, so there is no delivery URL to read the hash from.\n' +
      'Upload any image once in the Cloudflare dashboard (Images > Upload), then run this again.',
  );
  process.exit(1);
}

const hash = String(image.variants?.[0] ?? '').split('/')[3];

if (!hash) {
  console.error('Could not parse a delivery URL. Raw variants:', image.variants);
  process.exit(1);
}

console.log(`\nCLOUDFLARE_IMAGES_ACCOUNT_HASH=${hash}\n`);
console.log('Copy that line into backend/.env and into Railway.');
