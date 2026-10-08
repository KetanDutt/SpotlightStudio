/** Guard the scoped query-string/decode-uri-component override used by Expo Router. */
import queryString from 'query-string';

describe('router query compatibility', () => {
  it.each([
    ['tag=lake&q=Mount%20Fuji', { q: 'Mount Fuji', tag: 'lake' }, 'q=Mount%20Fuji&tag=lake'],
    ['tag=Gal%C3%A1pagos', { tag: 'Galápagos' }, 'tag=Gal%C3%A1pagos'],
    ['tag=sky&tag=sea', { tag: ['sky', 'sea'] }, 'tag=sky&tag=sea'],
    ['empty=&nullable', { empty: '', nullable: null }, 'empty=&nullable'],
    ['q=a+b&source=peapix', { q: 'a b', source: 'peapix' }, 'q=a%20b&source=peapix'],
  ])('retains parsing/stringifying behavior for %s', (input, parsed, output) => {
    expect(queryString.parse(input as string)).toEqual(parsed);
    expect(queryString.stringify(queryString.parse(input as string), { sort: false })).toBe(output);
  });
  it('handles long malformed percent-encoded links without recursive stack exhaustion', () => {
    const result = queryString.parse('q=' + '%FE'.repeat(20000));
    expect(typeof result.q).toBe('string');
    expect(queryString.pick('https://example.com/?q=lake&tag=sky&unused=x', ['q', 'tag'])).toBe('https://example.com/?q=lake&tag=sky');
  });
});
