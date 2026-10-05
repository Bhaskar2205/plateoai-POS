import { Injectable } from '@nestjs/common';
import type { PublicMenuDto } from './dto/public-menu.dto';

/**
 * The assembled public menu, held for a few seconds.
 *
 * Service starts and a hundred and fifty people scan the QR code inside the same
 * second. Without this, that is a hundred and fifty identical runs of the same
 * four queries - measured at p95 1.19s for a 64-dish menu, on localhost, before a
 * single byte of network or the Next.js hop is counted. With it, the first scan
 * does the work and the rest are a map lookup.
 *
 * **It is flushed on every menu edit, not merely expired.** The promise that a
 * dish marked sold out disappears from the next scan is a real one - a diner
 * ordering something the kitchen has run out of is worse than a slow menu - and
 * an e2e test holds us to it. `MenuCacheSubscriber` clears this whenever anything
 * the menu displays changes, so the TTL below is only a backstop: it bounds both
 * memory and how long a missed invalidation could possibly matter.
 *
 * In-process on purpose. Several API instances each keep their own copy, which is
 * fine at this TTL and avoids making the menu depend on Redis being up - the menu
 * is the one surface that must work when everything else is struggling.
 */

/** How long an entry may live without being invalidated. */
const TTL_MS = 30_000;

/**
 * Enough for a restaurant and all its tables, several restaurants over. Bounded
 * so a flood of unknown slugs cannot grow it without limit - though only menus
 * that were actually found are ever stored.
 */
const MAX_ENTRIES = 500;

interface Entry {
  menu: PublicMenuDto;
  expiresAt: number;
}

@Injectable()
export class PublicMenuCache {
  private readonly entries = new Map<string, Entry>();

  /** Scans are counted so the health of this can be seen rather than assumed. */
  private hits = 0;
  private misses = 0;

  /** A menu is identified by its slug and the table it was asked for. */
  static keyFor(slug: string, table?: unknown): string {
    return `${slug}\u0000${typeof table === 'string' ? table : ''}`;
  }

  get(key: string): PublicMenuDto | null {
    const entry = this.entries.get(key);

    if (!entry) {
      this.misses += 1;

      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.misses += 1;

      return null;
    }

    this.hits += 1;

    return entry.menu;
  }

  set(key: string, menu: PublicMenuDto): void {
    // Oldest insertion first, which is what Map iteration gives. Not an LRU: at
        // one entry per table, eviction is a safety valve rather than a strategy.
    if (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next();

      if (!oldest.done) this.entries.delete(oldest.value);
    }

    this.entries.set(key, { menu, expiresAt: Date.now() + TTL_MS });
  }

  /**
   * Throws the whole cache away.
   *
   * Everything, rather than one restaurant's entries. Menu edits are rare - a
   * handful a day against thousands of scans - so the cost is one extra read per
   * restaurant afterwards, and in exchange there is no mapping from a changed row
   * back to a cache key that someone has to keep correct. A clever invalidation
   * that misses a case serves a sold-out dish; this cannot.
   */
  flush(): void {
    this.entries.clear();
  }

  stats(): { entries: number; hits: number; misses: number } {
    return { entries: this.entries.size, hits: this.hits, misses: this.misses };
  }
}
