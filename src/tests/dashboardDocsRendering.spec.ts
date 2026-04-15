import { describe, expect, it } from 'vitest';
import { renderPanelMarkdownHtml } from '../dashboard/server/routes/index.js';

describe('renderPanelMarkdownHtml', () => {
  it('escapes raw HTML while preserving markdown formatting and safe URLs', () => {
    const html = renderPanelMarkdownHtml(
      'overview',
      '# Heading\n\n<script>alert(1)</script>\n\n**bold** `code` [safe](https://example.com?a=1&b=2) [unsafe](javascript:alert(1))'
    );

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(html).toContain('href="#"');
  });
});
