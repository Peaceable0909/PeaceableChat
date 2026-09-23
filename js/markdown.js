// Tiny, safe markdown renderer (escapes HTML first, then applies formatting).
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMarkdown(src) {
  const text = escapeHtml(src || '');
  const parts = text.split(/```/);
  let out = '';

  parts.forEach((chunk, i) => {
    if (i % 2 === 1) {
      const nl = chunk.indexOf('\n');
      const body = nl === -1 ? chunk : chunk.slice(nl + 1);
      out += `<pre><code>${body.replace(/\n$/, '')}</code></pre>`;
      return;
    }
    out += renderBlocks(chunk);
  });

  return out;
}

function renderBlocks(text) {
  const lines = text.split('\n');
  let html = '';
  let list = null;
  let para = [];

  const flushPara = () => {
    if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; }
  };
  const flushList = () => {
    if (list) { html += `</${list}>`; list = null; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) { flushPara(); flushList(); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); flushList(); html += '<hr>'; continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); html += `<blockquote>${inline(q[1])}</blockquote>`; continue; }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  flushPara();
  flushList();
  return html;
}
