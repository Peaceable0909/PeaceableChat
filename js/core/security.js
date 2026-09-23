/**
 * Client-side security controls.
 *
 * Note on secrets: this app never handles provider API keys in the browser.
 * All hosted inference goes through Puter's authenticated session (the user's
 * own credits), and self-hosted endpoints are addressed by URL only. If a
 * self-hosted endpoint needs a key, it must sit behind a gateway — the UI
 * refuses to store bearer tokens.
 */

export const FILE_LIMITS = {
  maxBytes: 25 * 1024 * 1024,      // 25 MB per file
  maxFiles: 10,
  maxTotalBytes: 60 * 1024 * 1024,
  accept: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/json': 'json',
    'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image', 'image/gif': 'image'
  },
  extFallback: ['txt','md','csv','json','js','ts','jsx','tsx','py','java','c','cpp','cs','go','rs','rb','php','html','css','scss','sql','yml','yaml','xml','sh','toml','ini','log','pdf','docx','xlsx','pptx','png','jpg','jpeg','webp','gif']
};

export function validateFile(file) {
  if (!file) return { ok: false, reason: 'No file' };
  if (file.size > FILE_LIMITS.maxBytes)
    return { ok: false, reason: `"${file.name}" is larger than 25 MB` };
  if (file.size === 0) return { ok: false, reason: `"${file.name}" is empty` };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const byMime = FILE_LIMITS.accept[file.type];
  const byExt = FILE_LIMITS.extFallback.includes(ext);
  if (!byMime && !byExt) return { ok: false, reason: `"${file.name}" is not a supported file type` };
  return { ok: true, kind: byMime || (file.type.startsWith('image/') ? 'image' : ext) };
}

/** Token-bucket rate limiter guarding model calls and tool runs. */
export class RateLimiter {
  constructor({ capacity = 12, refillPerMinute = 12, label = 'requests' } = {}) {
    this.capacity = capacity; this.tokens = capacity;
    this.rate = refillPerMinute / 60000; this.last = Date.now(); this.label = label;
  }
  _refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
  }
  take(n = 1) {
    this._refill();
    if (this.tokens < n) {
      const wait = Math.ceil((n - this.tokens) / this.rate / 1000);
      return { ok: false, retryIn: wait, message: `Too many ${this.label}. Try again in ${wait}s.` };
    }
    this.tokens -= n;
    return { ok: true };
  }
}

/** Strip anything that could execute when rendering model output as HTML. */
export function sanitizeHTML(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = node => {
    [...node.children].forEach(child => {
      const tag = child.tagName.toLowerCase();
      if (['script', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'base'].includes(tag)) {
        child.remove(); return;
      }
      [...child.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        const v = String(attr.value || '');
        if (n.startsWith('on')) child.removeAttribute(attr.name);
        if ((n === 'href' || n === 'src') && /^\s*(javascript|data:text\/html|vbscript)/i.test(v))
          child.removeAttribute(attr.name);
      });
      if (tag === 'a') { child.setAttribute('rel', 'noopener noreferrer'); child.setAttribute('target', '_blank'); }
      walk(child);
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

/** Validate a self-hosted inference endpoint before we ever call it. */
export function validateEndpoint(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'Endpoint must be http(s)' };
    return { ok: true, url: u.toString().replace(/\/$/, '') };
  } catch { return { ok: false, reason: 'Not a valid URL' }; }
}

export function redactSecrets(text) {
  return String(text || '')
    .replace(/(sk-[A-Za-z0-9]{12,})/g, 'sk-***redacted***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1***redacted***');
}

/** Friendly wording for provider/runtime failures — never leak stack traces. */
export function friendlyError(err) {
  const raw = redactSecrets(err?.message || err?.error?.message || String(err || ''));
  const m = raw.toLowerCase();
  if (m.includes('timeout') || m.includes('timed out')) return { code: 'timeout', text: 'That model took too long to respond.' };
  if (m.includes('rate') && m.includes('limit')) return { code: 'rate_limit', text: 'The model is rate limited right now.' };
  if (m.includes('context') || m.includes('too long') || m.includes('max_tokens')) return { code: 'context', text: 'That request was too large for the model’s context window.' };
  if (m.includes('permission') || m.includes('unauthorized') || m.includes('401')) return { code: 'auth', text: 'This model isn’t available to your account.' };
  if (m.includes('not found') || m.includes('404') || m.includes('unknown model')) return { code: 'unavailable', text: 'That model is currently unavailable.' };
  if (m.includes('insufficient') || m.includes('quota') || m.includes('credit')) return { code: 'quota', text: 'Usage limit reached for this model.' };
  if (m.includes('network') || m.includes('failed to fetch')) return { code: 'network', text: 'Network problem reaching the model.' };
  return { code: 'error', text: 'The model couldn’t complete that request.' , raw };
}
