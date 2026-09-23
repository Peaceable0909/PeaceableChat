/**
 * Persistence layer.
 *
 * Everything is scoped to the signed-in Puter user (puter.kv is per-user,
 * per-app). Data is modelled as separate "tables": a light index document per
 * collection plus one document per record, so large records are never loaded
 * unless they're opened.
 *
 *   nx:settings                 - user settings singleton
 *   nx:idx:conversations        - [{id,title,projectId,pinned,archived,...}]
 *   nx:conversation:<id>        - { ...meta, messages: [] }
 *   nx:idx:projects             - [{id,name,...}]
 *   nx:project:<id>             - { ...meta, instructions, knowledge }
 *   nx:idx:files                - [{id,name,mime,size,...}]
 *   nx:file:<id>                - { ...meta, chunks: [] }   (extracted text)
 *   nx:idx:artifacts            - [{id,title,kind,...}]
 *   nx:artifact:<id>            - { ...meta, files: [] }
 *   nx:memories                 - [{id,text,scope,createdAt}]
 *   nx:registry:overrides       - admin model registry overrides
 *   nx:usage                    - rolling usage events (capped)
 *   nx:feedback                 - feedback entries
 */
import { safeJSON, uid, nowISO } from './utils.js';

const P = 'nx:';
const memCache = new Map();

async function kvGet(key, fallback) {
  if (memCache.has(key)) return memCache.get(key);
  try {
    const v = safeJSON(await puter.kv.get(key), fallback);
    const out = v ?? fallback;
    memCache.set(key, out);
    return out;
  } catch { return fallback; }
}

async function kvSet(key, value) {
  memCache.set(key, value);
  try { await puter.kv.set(key, JSON.stringify(value)); return true; }
  catch (e) { console.error('[store] write failed', key, e); return false; }
}

async function kvDel(key) {
  memCache.delete(key);
  try { await puter.kv.del(key); } catch {}
}

export function clearCache() { memCache.clear(); }

/* -------------------------------------------------- generic collection ---- */
function collection(name, { summary }) {
  const idxKey = `${P}idx:${name}`;
  const recKey = id => `${P}${name}:${id}`;

  return {
    async index() {
      const v = await kvGet(idxKey, []);
      return Array.isArray(v) ? v : [];
    },
    async setIndex(list) { return kvSet(idxKey, list); },
    async get(id) { return id ? kvGet(recKey(id), null) : null; },
    async put(record) {
      record.updatedAt = nowISO();
      if (!record.createdAt) record.createdAt = record.updatedAt;
      await kvSet(recKey(record.id), record);
      const idx = await this.index();
      const entry = summary(record);
      const i = idx.findIndex(r => r.id === record.id);
      if (i === -1) idx.unshift(entry); else idx[i] = entry;
      await kvSet(idxKey, idx);
      return record;
    },
    async remove(id) {
      await kvDel(recKey(id));
      const idx = (await this.index()).filter(r => r.id !== id);
      await kvSet(idxKey, idx);
    },
    async patchIndex(id, patch) {
      const idx = await this.index();
      const i = idx.findIndex(r => r.id === id);
      if (i === -1) return null;
      idx[i] = { ...idx[i], ...patch, updatedAt: nowISO() };
      await kvSet(idxKey, idx);
      const rec = await this.get(id);
      if (rec) { Object.assign(rec, patch); await kvSet(recKey(id), rec); }
      return idx[i];
    }
  };
}

/* ------------------------------------------------------------ settings ---- */
export const DEFAULT_SETTINGS = {
  account: { displayName: '', bio: '' },
  ai: {
    routingMode: 'auto',          // auto | fast | smart | reasoning | coding | vision
    pinnedModel: null,            // explicit model_id overriding the router
    autoRoute: true,
    responseStyle: 'balanced',    // concise | balanced | detailed | technical
    customInstructions: '',
    nickname: '',
    memoryEnabled: true,
    showRouting: true,
    showReasoning: false,
    temperature: 0.7
  },
  appearance: { theme: 'light', fontSize: 'medium', accent: 'clay', density: 'comfortable' },
  privacy: { saveHistory: true, allowUsageStats: true },
  tools: {
    web_search: false, calculator: true, code_exec: true,
    doc_reader: true, image_analysis: true, artifact_writer: true,
    searchApiKey: ''
  },
  voice: { provider: 'openai', autoSend: false }
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object'
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

export const settingsRepo = {
  async get() {
    const raw = await kvGet(`${P}settings`, null);
    return deepMerge(DEFAULT_SETTINGS, raw || {});
  },
  async save(patch) {
    const merged = deepMerge(await this.get(), patch);
    await kvSet(`${P}settings`, merged);
    return merged;
  },
  async reset() { await kvSet(`${P}settings`, {}); return { ...DEFAULT_SETTINGS }; }
};

/* ------------------------------------------------------- conversations ---- */
export const conversations = collection('conversation', {
  summary: c => ({
    id: c.id, title: c.title, projectId: c.projectId || null,
    pinned: !!c.pinned, archived: !!c.archived,
    model: c.lastModel || null, messageCount: (c.messages || []).length,
    preview: (c.messages || []).slice(-1)[0]?.content?.slice(0, 120) || '',
    createdAt: c.createdAt, updatedAt: c.updatedAt
  })
});

export function newConversation(projectId = null) {
  return {
    id: uid('conv'), title: 'New chat', projectId,
    pinned: false, archived: false, messages: [],
    lastModel: null, createdAt: nowISO(), updatedAt: nowISO()
  };
}

/* ------------------------------------------------------------ projects ---- */
export const projects = collection('project', {
  summary: p => ({
    id: p.id, name: p.name, color: p.color, icon: p.icon,
    description: p.description || '', createdAt: p.createdAt, updatedAt: p.updatedAt
  })
});

export function newProject(name) {
  return {
    id: uid('proj'), name, description: '', instructions: '',
    color: 'clay', icon: 'folder', knowledge: [], fileIds: [],
    createdAt: nowISO(), updatedAt: nowISO()
  };
}

/* --------------------------------------------------------------- files ---- */
export const files = collection('file', {
  summary: f => ({
    id: f.id, name: f.name, mime: f.mime, size: f.size, kind: f.kind,
    projectId: f.projectId || null, tokens: f.tokens || 0,
    status: f.status, path: f.path || null,
    createdAt: f.createdAt, updatedAt: f.updatedAt
  })
});

/* ----------------------------------------------------------- artifacts ---- */
export const artifacts = collection('artifact', {
  summary: a => ({
    id: a.id, title: a.title, kind: a.kind, conversationId: a.conversationId || null,
    fileCount: (a.files || []).length, createdAt: a.createdAt, updatedAt: a.updatedAt
  })
});

/* ------------------------------------------------------------ memories ---- */
export const memories = {
  async all() {
    const v = await kvGet(`${P}memories`, []);
    return Array.isArray(v) ? v : [];
  },
  async add(text, { scope = 'global', source = 'user', projectId = null } = {}) {
    const list = await this.all();
    const clean = String(text).trim();
    if (!clean) return null;
    if (list.some(m => m.text.toLowerCase() === clean.toLowerCase())) return null;
    const rec = { id: uid('mem'), text: clean, scope, source, projectId, createdAt: nowISO() };
    list.unshift(rec);
    await kvSet(`${P}memories`, list.slice(0, 300));
    return rec;
  },
  async update(id, text) {
    const list = await this.all();
    const m = list.find(x => x.id === id);
    if (m) { m.text = text; await kvSet(`${P}memories`, list); }
    return m;
  },
  async remove(id) {
    await kvSet(`${P}memories`, (await this.all()).filter(m => m.id !== id));
  },
  async clear() { await kvSet(`${P}memories`, []); }
};

/* -------------------------------------------------- registry overrides ---- */
export const registryStore = {
  async get() { return kvGet(`${P}registry:overrides`, { disabled: [], custom: [], providers: {} }); },
  async save(v) { return kvSet(`${P}registry:overrides`, v); }
};

/* --------------------------------------------------------------- usage ---- */
export const usage = {
  async all() {
    const v = await kvGet(`${P}usage`, []);
    return Array.isArray(v) ? v : [];
  },
  async record(evt) {
    const list = await this.all();
    list.unshift({ id: uid('u'), at: nowISO(), ...evt });
    await kvSet(`${P}usage`, list.slice(0, 400));
  },
  async clear() { await kvSet(`${P}usage`, []); }
};

/* ------------------------------------------------------------ feedback ---- */
export const feedback = {
  async all() { const v = await kvGet(`${P}feedback`, []); return Array.isArray(v) ? v : []; },
  async add(entry) {
    const list = await this.all();
    list.unshift({ id: uid('fb'), at: nowISO(), ...entry });
    await kvSet(`${P}feedback`, list.slice(0, 200));
  }
};

/* ------------------------------------------------------ data lifecycle ---- */
export async function exportAll() {
  const [s, convIdx, projIdx, fileIdx, artIdx, mem, use, fb] = await Promise.all([
    settingsRepo.get(), conversations.index(), projects.index(),
    files.index(), artifacts.index(), memories.all(), usage.all(), feedback.all()
  ]);
  const full = await Promise.all(convIdx.map(c => conversations.get(c.id)));
  const fullProjects = await Promise.all(projIdx.map(p => projects.get(p.id)));
  const fullArtifacts = await Promise.all(artIdx.map(a => artifacts.get(a.id)));
  return {
    exportedAt: nowISO(), version: 1, settings: s,
    conversations: full.filter(Boolean), projects: fullProjects.filter(Boolean),
    files: fileIdx, artifacts: fullArtifacts.filter(Boolean),
    memories: mem, usage: use, feedback: fb
  };
}

export async function wipeAll() {
  try { await puter.kv.flush(); } catch {}
  memCache.clear();
}
