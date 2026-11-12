#!/usr/bin/env node
// Writes the blog's GitHub Pages copy, site/blog/index.html, from docs/blog/web-tv-launcher.md (npm run blog).
// The Markdown file is the source, also for dev.to (its front matter is dev.to's). Pictures live in site/blog/.
// A small converter for the Markdown this post uses: headings, paragraphs, lists, fenced code, images, links,
// **bold**, *italic* and `code`.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'docs/blog/web-tv-launcher.md');
const OUT = join(root, 'site/blog/index.html');

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Front matter (key: value lines between --- fences) and the body. */
export function splitFrontMatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: md.slice(m[0].length) };
}

export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

export function toHtml(body) {
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4}) (.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    const list = line.match(/^(- |\d+\. )/);
    if (list) {
      const ordered = list[1] !== '- ';
      const items = [];
      while (i < lines.length && (/^(- |\d+\. )/.test(lines[i]) || (/^ {2,}\S/.test(lines[i]) && items.length))) {
        if (/^(- |\d+\. )/.test(lines[i])) items.push(lines[i].replace(/^(- |\d+\. )/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4} |```|- |\d+\. )/.test(lines[i])) para.push(lines[i++].trim());
    const text = para.join(' ');
    out.push(/^!\[[^\]]*\]\([^)]+\)$/.test(text) ? `<figure>${inline(text)}</figure>` : `<p>${inline(text)}</p>`);
  }
  return out.join('\n');
}

export function page(meta, html) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${esc(meta.canonical_url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:image" content="${esc(meta.cover_image)}">
<meta property="og:url" content="${esc(meta.canonical_url)}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: dark light; --bg: #0f0e14; --card: #1a1822; --fg: #efeaf7; --muted: #aaa2bd; --accent: #f2a93b; --line: #2c2938; }
  @media (prefers-color-scheme: light) { :root { --bg: #faf8fc; --card: #efeaf5; --fg: #1d1a24; --muted: #5d566b; --accent: #a35f00; --line: #ddd6e8; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 18px/1.65 system-ui, -apple-system, "Segoe UI", sans-serif; }
  article { max-width: 44rem; margin: 0 auto; padding: 2.4rem 16px 3rem; }
  h1 { font-size: clamp(1.7rem, 4.5vw, 2.4rem); line-height: 1.2; margin: 0 0 .6rem; letter-spacing: -.01em; }
  .lead { color: var(--muted); margin: 0 0 1.6rem; }
  h2 { font-size: 1.35rem; margin: 2.2rem 0 .4rem; }
  a { color: var(--accent); }
  figure { margin: 1.4rem 0; } img { max-width: 100%; height: auto; border-radius: 10px; display: block; }
  code { font-size: .9em; background: var(--card); padding: .1em .35em; border-radius: .3em; overflow-wrap: anywhere; }
  pre { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; overflow-x: auto; }
  pre code { background: none; padding: 0; overflow-wrap: normal; font-size: .85em; }
  li { margin: .3rem 0; }
  footer { color: var(--muted); font-size: .9rem; border-top: 1px solid var(--line); margin-top: 2.4rem; padding-top: 1rem; }
</style>
</head>
<body>
<article>
<h1>${esc(meta.title)}</h1>
<p class="lead">${esc(meta.description)}</p>
${html}
<footer>Paul Bennet · <a href="https://github.com/paulbennet/AndroidTVLauncher">Web TV Launcher on GitHub</a> ·
<a href="../skins/">Skins</a> · <a href="../">Install</a></footer>
</article>
</body>
</html>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { meta, body } = splitFrontMatter((await readFile(SRC, 'utf8')).replace(/\r\n/g, '\n'));
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, page(meta, toHtml(body)));
  console.log(`blog → ${OUT.slice(root.length + 1)}`);
}
