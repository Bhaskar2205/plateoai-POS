import { slugify, uniqueSlug } from './slug.util';

describe('slugify', () => {
  it.each([
    ['The Green Bowl', 'the-green-bowl'],
    ['  Spaced   Out  ', 'spaced-out'],
    ['Cafe & Co.', 'cafe-co'],
    ['Bombay-Bistro', 'bombay-bistro'],
    ['Café Déjà Vu', 'cafe-deja-vu'],
    ['MIXED Case 123', 'mixed-case-123'],
    ['!!!', 'restaurant'],
    ['', 'restaurant'],
  ])('turns %j into %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('never produces leading or trailing hyphens', () => {
    expect(slugify('---Edge Case---')).toBe('edge-case');
  });

  it('caps the length so the uniqueness suffix always fits', () => {
    expect(slugify('a'.repeat(400)).length).toBeLessThanOrEqual(180);
  });
});

describe('uniqueSlug', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlug('the-green-bowl', [])).toBe('the-green-bowl');
  });

  it('appends -2 for the first collision', () => {
    expect(uniqueSlug('spice-route', ['spice-route'])).toBe('spice-route-2');
  });

  it('keeps counting past further collisions', () => {
    expect(uniqueSlug('spice-route', ['spice-route', 'spice-route-2', 'spice-route-3'])).toBe(
      'spice-route-4',
    );
  });

  it('ignores unrelated slugs that merely share a prefix', () => {
    expect(uniqueSlug('spice', ['spice-route', 'spice-market'])).toBe('spice');
  });
});
