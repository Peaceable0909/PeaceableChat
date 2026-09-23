export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const nowISO = () => new Date().toISOString();

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Rough token estimate: ~4 chars/token. Good enough for routing + budgeting.
export const estimateTokens = text => Math.ceil((String(text || '').length) / 4);

export function formatBytes(b) {
  if (!b && b !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function relTime(ts) {
  const d = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const s = Math.floor((Date.now() - d) / 1000);
  if (isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function groupByDate(items, key = 'updatedAt') {
  const out = { Today: [], Yesterday: [], 'Previous 7 days': [], Older: [] };
  const day = 86400000;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  for (const it of items) {
    const t = new Date(it[key]).getTime();
    if (t >= startOfToday.getTime()) out.Today.push(it);
    else if (t >= startOfToday.getTime() - day) out.Yesterday.push(it);
    else if (t >= startOfToday.getTime() - 7 * day) out['Previous 7 days'].push(it);
    else out.Older.push(it);
  }
  return Object.entries(out).filter(([, v]) => v.length);
}

export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function safeJSON(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** Extract the first fenced JSON object from a model reply. */
export function extractJSON(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); } catch { return null; }
}
