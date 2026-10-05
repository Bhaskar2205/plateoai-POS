import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_METHODS, ALLOWED_REQUEST_HEADERS } from './cors';

/**
 * A header the frontend sends but CORS does not allow blocks the whole request,
 * and no server-side test notices: supertest does not enforce CORS, so the e2e
 * suite stays green while every browser fails.
 *
 * These tests read the frontend source and check that whatever it sends is
 * allowed, which is the only place the two sides can be compared without a
 * browser.
 */
const FRONTEND = join(__dirname, '../../../frontend');

const frontendSources = [
  'lib/api.ts',
  'components/public-menu/diner-order.tsx',
].map((file) => readFileSync(join(FRONTEND, file), 'utf8'));

describe('allowed request headers', () => {
  it('includes everything the browser needs for an ordinary authenticated call', () => {
    expect(ALLOWED_REQUEST_HEADERS).toContain('Content-Type');
    expect(ALLOWED_REQUEST_HEADERS).toContain('Authorization');
  });

  it('allows the idempotency header, without which Place order is blocked outright', () => {
    expect(ALLOWED_REQUEST_HEADERS).toContain('Idempotency-Key');
  });

  it('allows every header the frontend actually sets', () => {
    // Matches `'Some-Header':` inside a headers object in the frontend sources.
    const sent = new Set<string>();

    for (const source of frontendSources) {
      for (const match of source.matchAll(/'([A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)+)':/g)) {
        sent.add(match[1]);
      }
    }

    // Sanity: the scan found something, so a silent regex failure cannot pass this.
    expect(sent.size).toBeGreaterThan(0);

    const allowed = new Set<string>(ALLOWED_REQUEST_HEADERS.map((header) => header.toLowerCase()));

    for (const header of sent) {
      expect(allowed.has(header.toLowerCase())).toBe(true);
    }
  });

  it('permits the methods the API actually exposes', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(ALLOWED_METHODS).toContain(method);
    }
  });
});
