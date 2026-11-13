import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../../src/lib/markdown';

describe('published documentation editorial punctuation', () => {
  it('normalizes every prose em dash while retaining fenced code and React escaping', () => {
    const html = renderToStaticMarkup(<Markdown source={'First — second — third <script>alert(1)</script>\n\n```text\nkeep — code\n```'} />);
    expect(html).toContain('First - second - third');
    expect(html).toContain('keep — code');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
