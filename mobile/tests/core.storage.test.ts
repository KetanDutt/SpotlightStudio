/**
 * The storage helpers – the defensive JSON/scalar coercion that every screen relies on.
 * They are pure, so no mock of AsyncStorage is needed here.
 */
import { asStringArray, pushRecent, withLimit } from '../src/core/storage-utils';

describe('asStringArray', () => {
  it('keeps only non-empty strings', () => {
    expect(asStringArray(['a', '', 3, null, 'b'])).toEqual(['a', 'b']);
  });

  it('returns an empty array for anything that is not a list', () => {
    expect(asStringArray(null)).toEqual([]);
    expect(asStringArray({ 0: 'a' })).toEqual([]);
    expect(asStringArray('a')).toEqual([]);
  });
});

describe('withLimit', () => {
  it('de-duplicates and truncates, newest first', () => {
    expect(withLimit(['a', 'b', 'a', 'c'], 2)).toEqual(['a', 'b']);
    expect(withLimit([], 5)).toEqual([]);
  });
});

describe('pushRecent', () => {
  it('puts the newest entry first', () => {
    expect(pushRecent(['sunset'], 'aurora', 8)).toEqual(['aurora', 'sunset']);
  });

  it('moves a repeated entry to the front instead of duplicating it', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 8)).toEqual(['b', 'a', 'c']);
  });

  it('trims the entry and ignores blank input', () => {
    expect(pushRecent([], '  sunset  ', 8)).toEqual(['sunset']);
    expect(pushRecent(['a'], '   ', 8)).toEqual(['a']);
  });

  it('respects the limit', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('survives a corrupt stored value', () => {
    expect(pushRecent(asStringArray(null), 'first', 4)).toEqual(['first']);
  });
});
