// The blog's Pages copy is built from docs/blog/*.md (tools/blog.mjs). Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitFrontMatter, toHtml, inline } from '../blog.mjs';

test('blog: front matter, lists with wrapped lines, code blocks and inline marks', () => {
  const { meta, body } = splitFrontMatter('---\ntitle: "A: b"\ntags: x, y\n---\n## Hi\n\n- one\n  more\n- two\n\n```bash\na < b\n```\n\nText **bold** `c*d*` [l](https://x.y).\n');
  assert.equal(meta.title, 'A: b');
  assert.equal(meta.tags, 'x, y');
  const html = toHtml(body);
  assert.match(html, /<h2>Hi<\/h2>/);
  assert.match(html, /<ul><li>one more<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<pre><code class="language-bash">a &lt; b<\/code><\/pre>/);
  assert.equal(inline('**b** `c*d*` [l](https://x.y)'), '<strong>b</strong> <code>c*d*</code> <a href="https://x.y">l</a>');
});

test('blog: the post has dev.to front matter with a canonical link to the Pages copy', async () => {
  const { meta } = splitFrontMatter((await readFile(new URL('../../docs/blog/web-tv-launcher.md', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'));
  for (const k of ['title', 'description', 'tags', 'cover_image', 'canonical_url']) assert.ok(meta[k], k);
  assert.equal(meta.canonical_url, 'https://paulbennet.github.io/AndroidTVLauncher/blog/');
  assert.ok(meta.tags.split(',').length <= 4, 'dev.to allows 4 tags');
});
