/**
 * Document processing pipeline (section 8):
 * upload -> extract -> chunk -> (keyword) retrieve -> inject into prompt.
 * No server, so extraction runs client-side via CDN libraries loaded on demand.
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

let _pdfjs = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs');
  mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
  _pdfjs = mod;
  return _pdfjs;
}

async function loadMammoth() {
  if (window.mammoth) return window.mammoth;
  await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
  return window.mammoth;
}

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  return window.XLSX;
}

export async function extractText(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith('.pdf')) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let text = '';
    const max = Math.min(doc.numPages, 80);
    for (let i = 1; i <= max; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it => it.str).join(' ') + '\n\n';
    }
    if (doc.numPages > max) text += `\n[...truncated after ${max} of ${doc.numPages} pages]`;
    return text.trim();
  }
  if (name.endsWith('.docx')) {
    const mammoth = await loadMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
    return value.trim();
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array' });
    return wb.SheetNames.map(n => `## Sheet: ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n');
  }
  if (name.endsWith('.doc')) return '[.doc (legacy Word) files aren\'t parseable in-browser — please re-save as .docx or .pdf]';
  // txt, md, csv, json, and source/code files — read as plain text
  return new TextDecoder('utf-8').decode(buf);
}

export function chunkText(text, size = 900, overlap = 120) {
  const clean = (text || '').replace(/\r\n/g, '\n');
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + size));
    i += Math.max(1, size - overlap);
  }
  return chunks.filter(c => c.trim());
}

/** Naive TF-style keyword retrieval — no embeddings API required, works offline/free. */
export function retrieveChunks(chunks, query, limit = 5) {
  if (!chunks?.length) return [];
  const words = new Set((query || '').toLowerCase().match(/[a-z0-9']{3,}/g) || []);
  if (!words.size) return chunks.slice(0, limit);
  const scored = chunks.map((c, idx) => {
    const cw = c.toLowerCase().match(/[a-z0-9']{3,}/g) || [];
    const score = cw.reduce((n, w) => n + (words.has(w) ? 1 : 0), 0);
    return { c, idx, score };
  });
  const top = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  const pick = top.length ? top : scored.slice(0, limit);
  return pick.sort((a, b) => a.idx - b.idx).map(s => s.c);
}

export function docsToContextBlock(fileResults) {
  if (!fileResults?.length) return '';
  return 'Relevant excerpts from attached files (cite the filename when you use one):\n\n' +
    fileResults.map(f => `--- ${f.name} ---\n${f.chunks.join('\n...\n')}`).join('\n\n');
}
