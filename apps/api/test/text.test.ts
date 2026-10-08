import { describe, it, expect } from 'vitest';
import { htmlToText } from '../src/utils/text';

describe('htmlToText', () => {
  it('handles <p> and <br>', () => {
    expect(htmlToText('<p>Hello<p>World')).toBe('Hello\nWorld');
  });
  it('decodes entities correctly', () => {
    expect(htmlToText('It&#x27;s &amp; <i>ok</i>')).toBe("It's & ok");
  });
  it('removes other tags', () => {
    expect(htmlToText('<a href="https://x.com/a" rel="nofollow">https://x.com/a</a>')).toBe('https://x.com/a');
  });
  it('decodes &lt; without double-decoding &amp;lt;', () => {
    expect(htmlToText('a &lt;b&gt;')).toBe('a <b>');
    expect(htmlToText('&amp;lt;')).toBe('&lt;');
  });
  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('handles non-breaking spaces, trims lines, collapses newlines, and trims', () => {
    const html = '&nbsp;  <p>  Hello  </p>  <br>  <p>  World  </p>  &nbsp;';
    expect(htmlToText(html)).toBe('Hello\n\nWorld');
  });
});
