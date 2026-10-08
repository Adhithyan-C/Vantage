export function htmlToText(html: string): string {
  // 1. Replace every <p ...> tag and every <br>, <br/>, <br /> tag with a newline character (tags are case-insensitive).
  let text = html.replace(/<p\b[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 2. Remove all other HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 3. Decode entities in this order
  // numeric entities
  text = text.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
  // &lt; &gt; &quot; &apos; &nbsp;
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  // &amp; LAST
  text = text.replace(/&amp;/g, '&');

  // 4. Replace non-breaking spaces, trim every line, collapse 3 or more newlines into 2, trim the whole string
  text = text.replace(/\u00A0/g, ' ');
  text = text.split('\n').map(line => line.trim()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}
