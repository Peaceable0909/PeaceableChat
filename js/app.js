import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
import { renderMarkdown, escapeHtml } from './markdown.js';
import {
  settingsRepo, conversations, newConversation as makeConv,
  projects, newProject as makeProject, files as filesRepo,
  artifacts as artifactsRepo, memories, usage, exportAll, wipeAll
} from './core/store.js';
import { listModels, byFamily, setModelEnabled } from './core/registry.js';
import { chatWithFallback } from './core/provider.js';
import { relevantMemories, memoryToSystemBlock, extractExplicitMemory } from './core/memory.js';
import { extractText, chunkText, retrieveChunks, docsToContextBlock } from './core/documents.js';
import { tryCalculate } from './core/calc.js';
import { runPython, preloadSandbox } from './core/sandbox.js';
import { webSearch, formatSearchContext } from './core/search.js';
import { validateFile } from './core/security.js';
import { estimateTokens, download } from './core/utils.js';

const BASE_SYSTEM_PROMPT = `You are Peaceable, a single thoughtful AI assistant. Behind the scenes different open models (Qwen, DeepSeek, Kimi, GLM, MiniMax and others) may answer depending on the task, but the user should always experience you as one consistent assistant — never mention which model answered unless asked.
Use markdown for structure when it helps. Be accurate, direct, and avoid filler.
When you produce a file the user would want to keep or reuse (code, a webpage, a document, a report), put each file in its own fenced code block with the language and filename on the opening fence line like this: \`\`\`html:index.html — this lets it open in the user's workspace panel. Use plain fences without a filename for short inline snippets that aren't meant to be saved as files.`;

const $ = id => document.getElementById(id);
const el = {
  sidebar: $('sidebar'), overlay: $('overlay'), openSidebar: $('openSidebar'), closeSidebar: $('closeSidebar'),
  newChatBtn: $('newChatBtn'), newProjectBtn: $('newProjectBtn'), convList: $('convList'),
  convTitle: $('convTitle'), projectBadge: $('projectBadge'), projectList: $('projectList'),
  convSearch: $('convSearch'),
  deleteConvBtn: $('deleteConvBtn'), modelSelect: $('modelSelect'), modeSelect: $('modeSelect'),
  authGate: $('authGate'), chatPane: $('chatPane'), signInBtn: $('signInBtn'), signOutBtn: $('signOutBtn'),
  userName: $('userName'), avatar: $('avatar'), messages: $('messages'), inner: $('messagesInner'),
  input: $('input'), sendBtn: $('sendBtn'), stopBtn: $('stopBtn'), toast: $('toast'),
  fileInput: $('fileInput'), attachBtn: $('attachBtn'), fileChips: $('fileChips'),
  webSearchToggle: $('webSearchToggle'), micBtn: $('micBtn'),
  workspaceBtn: $('workspaceBtn'), workspace: $('workspace'), workspaceCloseBtn: $('workspaceCloseBtn'),
  artifactTabs: $('artifactTabs'), artifactBody: $('artifactBody'),
  settingsBtn: $('settingsBtn'), settingsModal: $('settingsModal'), settingsCloseBtn: $('settingsCloseBtn'),
  settingsBody: $('settingsBody'), settingsTitle: $('settingsTitle'),
  promptModal: $('promptModal'), promptTitle: $('promptTitle'), promptInput: $('promptInput'),
  promptCancel: $('promptCancel'), promptOk: $('promptOk')
};

const state = {
  conv: null, streaming: false, stop: false, signedIn: false,
  projects: [], activeProjectId: null, pendingFiles: [], webSearchOn: false,
  artifactsByConv: new Map(), settings: null
};

const SUGGESTIONS = [
  { icon: 'pen-line', text: 'Help me write a thank-you note' },
  { icon: 'code', text: 'Build me a landing page' },
  { icon: 'calculator', text: 'What is 18% of 942?' },
  { icon: 'list-checks', text: 'Plan my week around three big goals' }
];

const BURST = '<svg viewBox="0 0 24 24" class="w-full h-full"><use href="#burst"/></svg>';

/* ---------------- generic helpers ---------------- */
function refreshIcons() { createIcons({ icons }); }

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add('hidden'), 2800);
}

function openSidebar(open) {
  el.sidebar.classList.toggle('-translate-x-full', !open);
  el.overlay.classList.toggle('hidden', !open);
}

function scrollToBottom(force = false) {
  const m = el.messages;
  const near = m.scrollHeight - m.scrollTop - m.clientHeight < 150;
  if (force || near) m.scrollTop = m.scrollHeight;
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 176) + 'px';
  el.sendBtn.disabled = (!el.input.value.trim() && !state.pendingFiles.length) || state.streaming;
}

function askPrompt(title, defaultVal = '') {
  return new Promise(resolve => {
    el.promptTitle.textContent = title;
    el.promptInput.value = defaultVal;
    el.promptModal.classList.remove('hidden'); el.promptModal.classList.add('flex');
    el.promptInput.focus();
    const done = val => {
      el.promptModal.classList.add('hidden'); el.promptModal.classList.remove('flex');
      el.promptOk.onclick = null; el.promptCancel.onclick = null;
      resolve(val);
    };
    el.promptOk.onclick = () => done(el.promptInput.value.trim() || null);
    el.promptCancel.onclick = () => done(null);
    el.promptInput.onkeydown = e => { if (e.key === 'Enter') done(el.promptInput.value.trim() || null); };
  });
}

/* ---------------- model + mode selectors ---------------- */
async function populateModelSelect() {
  const map = await byFamily();
  const current = el.modelSelect.value;
  el.modelSelect.innerHTML = '<option value="">Auto-picked</option>';
  for (const [family, models] of map) {
    const enabled = models.filter(m => m.enabled);
    if (!enabled.length) continue;
    const group = document.createElement('optgroup');
    group.label = family;
    for (const m of enabled) {
      const opt = document.createElement('option');
      opt.value = m.model_id; opt.textContent = m.display_name;
      group.appendChild(opt);
    }
    el.modelSelect.appendChild(group);
  }
  if ([...el.modelSelect.options].some(o => o.value === current)) el.modelSelect.value = current;
}

/* ---------------- message rendering ---------------- */
function bubbleUser(text, fileNames = []) {
  const wrap = document.createElement('div');
  wrap.className = 'flex justify-end fade-in';
  const chips = fileNames.length
    ? `<div class="flex flex-wrap gap-1 justify-end mb-1.5">${fileNames.map(n => `<span class="text-[11px] bg-white/70 border border-bone-line rounded-md px-1.5 py-0.5 text-ink-soft">${escapeHtml(n)}</span>`).join('')}</div>` : '';
  wrap.innerHTML = `<div class="max-w-[85%]"><div class="max-w-full rounded-2xl bg-bone-deep border border-bone-line px-4 py-2.5 text-[15.5px] leading-[1.65] whitespace-pre-wrap break-words">${chips}${escapeHtml(text)}</div></div>`;
  return wrap;
}

function bubbleAssistant(html = '') {
  const wrap = document.createElement('div');
  wrap.className = 'msg-group flex gap-3.5 fade-in';
  wrap.innerHTML = `
    <div class="w-6 h-6 shrink-0 text-clay mt-1">${BURST}</div>
    <div class="min-w-0 flex-1">
      <div data-model-badge class="text-[11px] text-ink-mute mb-1 hidden"></div>
      <div class="md" data-body>${html}</div>
      <div class="msg-actions mt-2 hidden items-center gap-1" data-actions>
        <button class="text-[12px] text-ink-mute hover:text-ink inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-black/5" data-copy>
          <i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy
        </button>
        <button class="text-[12px] text-ink-mute hover:text-ink inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-black/5" data-retry>
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Retry
        </button>
        <button class="text-[12px] text-ink-mute hover:text-ink inline-flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-black/5" data-speak>
          <i data-lucide="volume-2" class="w-3.5 h-3.5"></i> Speak
        </button>
      </div>
    </div>`;
  return wrap;
}

function typingHTML() { return '<div class="typing"><span></span><span></span><span></span></div>'; }

function renderEmptyState() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = state.signedIn && el.userName.textContent !== 'Signed out' ? el.userName.textContent : null;
  el.inner.innerHTML = `
    <div class="h-full flex flex-col items-center justify-center text-center py-14">
      <div class="flex items-center gap-3">
        <span class="text-clay w-8 h-8 inline-block">${BURST}</span>
        <h2 class="font-serif text-[34px] leading-none text-ink">${escapeHtml(greet)}${name ? ', ' + escapeHtml(name) : ''}</h2>
      </div>
      <p class="text-[14.5px] text-ink-soft mt-3">What would you like to think through today?</p>
      <div class="grid sm:grid-cols-2 gap-2 mt-8 w-full max-w-xl">
        ${SUGGESTIONS.map(s => `
          <button class="group text-left rounded-xl border border-bone-line bg-white/60 hover:bg-white hover:border-clay/40 px-3.5 py-3 transition-colors" data-suggest="${escapeHtml(s.text)}">
            <span class="flex items-start gap-2.5">
              <i data-lucide="${s.icon}" class="w-4 h-4 text-ink-mute group-hover:text-clay mt-0.5 shrink-0"></i>
              <span class="text-[13.5px] text-ink-soft group-hover:text-ink leading-snug">${escapeHtml(s.text)}</span>
            </span>
          </button>`).join('')}
      </div>
    </div>`;
  refreshIcons();
}

function attachActions(node, getText, onRetry) {
  const actions = node.querySelector('[data-actions]');
  if (!actions) return;
  actions.classList.remove('hidden'); actions.classList.add('flex');

  const copyBtn = actions.querySelector('[data-copy]');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      copyBtn.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Copied';
      refreshIcons();
      setTimeout(() => { copyBtn.innerHTML = '<i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy'; refreshIcons(); }, 1600);
    } catch { toast('Could not copy'); }
  });

  const retryBtn = actions.querySelector('[data-retry]');
  if (retryBtn) retryBtn.addEventListener('click', () => onRetry && onRetry());

  const speakBtn = actions.querySelector('[data-speak]');
  if (speakBtn) speakBtn.addEventListener('click', () => speak(getText()));
}

function renderMessages() {
  const msgs = state.conv?.messages || [];
  if (!msgs.length) { renderEmptyState(); return; }
  el.inner.innerHTML = '';
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      el.inner.appendChild(bubbleUser(m.content, m.fileNames || []));
    } else {
      const node = bubbleAssistant(renderMarkdown(m.content));
      if (m.model) {
        const badge = node.querySelector('[data-model-badge]');
        badge.textContent = `${m.model.display_name || m.model}${m.mode ? ' · ' + m.mode : ''}`;
        badge.classList.remove('hidden');
      }
      el.inner.appendChild(node);
      const isLast = i === msgs.length - 1;
      attachActions(node, () => m.content, isLast ? retryLast : null);
      if (!isLast) node.querySelector('[data-retry]')?.remove();
    }
  });
  refreshIcons();
  scrollToBottom(true);
  renderArtifactsForConv();
}

/* ---------------- sidebar: conversations + projects ---------------- */
function convMatchesQuery(c, q) {
  if (!q) return true;
  return (c.title || '').toLowerCase().includes(q) || (c.preview || '').toLowerCase().includes(q);
}

async function refreshList() {
  try {
    const q = (el.convSearch.value || '').trim().toLowerCase();
    let list = await conversations.index();
    if (state.activeProjectId) list = list.filter(c => c.projectId === state.activeProjectId);
    list = list.filter(c => !c.archived && convMatchesQuery(c, q));
    list.sort((a, b) => (b.pinned - a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));
    renderConvList(list);
  } catch {}
}

function renderConvList(list) {
  if (!list.length) {
    el.convList.innerHTML = '<p class="px-2.5 py-2 text-[12.5px] text-ink-mute">No chats yet.</p>';
    return;
  }
  el.convList.innerHTML = list.map(c => `
    <div class="group relative">
      <button data-conv="${c.id}" class="w-full text-left pl-2.5 pr-7 py-[7px] rounded-lg text-[13px] truncate transition-colors ${
        state.conv && c.id === state.conv.id ? 'bg-black/[0.06] text-ink font-medium' : 'text-ink-soft hover:bg-black/[0.04]'
      }">${c.pinned ? '<i data-lucide="pin" class="w-3 h-3 inline mr-1 -mt-0.5"></i>' : ''}${escapeHtml(c.title || 'Untitled')}</button>
      <button data-pin="${c.id}" title="Pin" class="hidden group-hover:flex absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-black/10 text-ink-mute">
        <i data-lucide="pin" class="w-3 h-3"></i>
      </button>
    </div>`).join('');
  refreshIcons();
}

async function refreshProjects() {
  const list = await projects.index();
  state.projects = list;
  el.projectList.innerHTML = list.map(p => `
    <button data-project="${p.id}" class="w-full flex items-center gap-1.5 text-left px-2.5 py-[7px] rounded-lg text-[13px] truncate transition-colors ${
      state.activeProjectId === p.id ? 'bg-black/[0.06] text-ink font-medium' : 'text-ink-soft hover:bg-black/[0.04]'
    }">
      <i data-lucide="folder" class="w-3.5 h-3.5 shrink-0"></i><span class="truncate">${escapeHtml(p.name)}</span>
    </button>`).join('') +
    (state.activeProjectId ? `<button id="clearProjectFilter" class="w-full text-left px-2.5 py-1 text-[11.5px] text-clay-dark hover:underline">Show all chats</button>` : '');
  refreshIcons();
  $('clearProjectFilter')?.addEventListener('click', () => { state.activeProjectId = null; refreshProjects(); refreshList(); });
}

/* ---------------- conversation flow ---------------- */
function blankConversation(projectId = state.activeProjectId) {
  return makeConv(projectId);
}

async function setConversation(conv) {
  state.conv = conv;
  el.convTitle.textContent = conv.title || 'New chat';
  if (conv.projectId) {
    const p = state.projects.find(x => x.id === conv.projectId);
    el.projectBadge.textContent = p ? p.name : '';
    el.projectBadge.classList.toggle('hidden', !p);
  } else {
    el.projectBadge.classList.add('hidden');
  }
  if (conv.lastModel && [...el.modelSelect.options].some(o => o.value === conv.lastModel)) {
    el.modelSelect.value = conv.lastModel;
  }
  renderMessages();
  refreshList();
}

function newConversationFlow() {
  if (state.streaming) state.stop = true;
  setConversation(blankConversation());
  clearPendingFiles();
  el.input.focus();
  openSidebar(false);
}

async function openConversation(id) {
  const conv = await conversations.get(id);
  if (!conv) { toast('Chat not found'); await refreshList(); return; }
  await setConversation(conv);
  openSidebar(false);
}

function setStreamingUI(on) {
  state.streaming = on;
  el.sendBtn.classList.toggle('hidden', on);
  el.stopBtn.classList.toggle('hidden', !on);
  autoGrow();
}

async function retryLast() {
  const conv = state.conv;
  if (!conv || state.streaming) return;
  const msgs = conv.messages;
  if (!msgs.length) return;
  if (msgs[msgs.length - 1].role === 'assistant') msgs.pop();
  const last = msgs.pop();
  if (!last) return;
  renderMessages();
  await conversations.put(conv).catch(() => {});
  send(last.content, { fileNames: last.fileNames || [] });
}

/* ---------------- file attachments ---------------- */
function clearPendingFiles() { state.pendingFiles = []; renderFileChips(); }

function renderFileChips() {
  if (!state.pendingFiles.length) { el.fileChips.classList.add('hidden'); el.fileChips.innerHTML = ''; return; }
  el.fileChips.classList.remove('hidden'); el.fileChips.classList.add('flex');
  el.fileChips.innerHTML = state.pendingFiles.map((f, i) => `
    <span class="inline-flex items-center gap-1 text-[11.5px] bg-bone-deep border border-bone-line rounded-full pl-2 pr-1 py-0.5">
      ${f.status === 'loading' ? '<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i>' : (f.kind === 'image' ? '<i data-lucide="image" class="w-3 h-3"></i>' : '<i data-lucide="file-text" class="w-3 h-3"></i>')}
      ${escapeHtml(f.name)}
      <button data-remove-file="${i}" class="p-0.5 rounded-full hover:bg-black/10"><i data-lucide="x" class="w-3 h-3"></i></button>
    </span>`).join('');
  refreshIcons();
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    const v = validateFile(file);
    if (!v.ok) { toast(v.reason); continue; }
    const entry = { name: file.name, kind: v.kind, status: 'loading', text: '', chunks: [], isImage: file.type.startsWith('image/') };
    state.pendingFiles.push(entry);
    renderFileChips(); autoGrow();
    try {
      if (entry.isImage) {
        entry.dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
      } else {
        const text = await extractText(file);
        entry.text = text;
        entry.chunks = chunkText(text);
      }
      entry.status = 'ready';
    } catch (e) {
      entry.status = 'error';
      toast(`Couldn't read "${file.name}"`);
    }
    renderFileChips();
  }
}

/* ---------------- voice ---------------- */
let recognizer = null;
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice input is not supported in this browser'); return; }
  if (recognizer) { recognizer.stop(); return; }
  recognizer = new SR();
  recognizer.lang = navigator.language || 'en-US';
  recognizer.interimResults = true;
  el.micBtn.classList.add('text-clay');
  recognizer.onresult = e => {
    let text = '';
    for (const r of e.results) text += r[0].transcript;
    el.input.value = text;
    autoGrow();
  };
  recognizer.onend = () => { recognizer = null; el.micBtn.classList.remove('text-clay'); };
  recognizer.onerror = () => { recognizer = null; el.micBtn.classList.remove('text-clay'); };
  recognizer.start();
}

function speak(text) {
  if (!('speechSynthesis' in window)) { toast('Speech synthesis not supported'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[#*`_>]/g, '').slice(0, 4000));
  window.speechSynthesis.speak(u);
}

/* ---------------- artifacts / workspace ---------------- */
function extractArtifactFiles(text) {
  const re = /```([a-zA-Z0-9+#.]*):([^\n`]+)\n([\s\S]*?)```/g;
  const out = []; let m;
  while ((m = re.exec(text))) out.push({ name: m[2].trim(), lang: (m[1] || '').trim(), code: m[3].replace(/\n$/, '') });
  return out;
}

function openWorkspace(open = true) {
  el.workspace.classList.toggle('hidden', !open);
  el.workspace.classList.toggle('flex', open);
}

async function saveArtifactsFromReply(conv, text) {
  const found = extractArtifactFiles(text);
  if (!found.length) return;
  let rec = state.artifactsByConv.get(conv.id);
  if (!rec) {
    rec = { id: `art_${conv.id}`, title: conv.title, kind: 'bundle', conversationId: conv.id, files: [] };
  }
  for (const f of found) {
    const i = rec.files.findIndex(x => x.name === f.name);
    if (i === -1) rec.files.push(f); else rec.files[i] = f;
  }
  state.artifactsByConv.set(conv.id, rec);
  await artifactsRepo.put(rec).catch(() => {});
  renderArtifactsForConv();
  openWorkspace(true);
}

async function renderArtifactsForConv() {
  if (!state.conv) return;
  let rec = state.artifactsByConv.get(state.conv.id);
  if (!rec) {
    rec = await artifactsRepo.get(`art_${state.conv.id}`);
    if (rec) state.artifactsByConv.set(state.conv.id, rec);
  }
  if (!rec || !rec.files.length) {
    el.artifactTabs.innerHTML = '';
    el.artifactBody.innerHTML = '<p class="text-[13px] text-ink-mute p-2">Files the AI creates for you to keep — code, docs, reports — will appear here.</p>';
    return;
  }
  const active = rec.files[rec._active || 0];
  el.artifactTabs.innerHTML = rec.files.map((f, i) => `
    <button data-art-tab="${i}" class="shrink-0 px-2.5 py-1 rounded-t-lg text-[12px] border-b-2 ${i === (rec._active || 0) ? 'border-clay text-ink' : 'border-transparent text-ink-mute hover:text-ink-soft'}">${escapeHtml(f.name)}</button>`).join('');
  const ext = active.name.split('.').pop().toLowerCase();
  const isWeb = ['html', 'htm'].includes(ext);
  const isPy = ext === 'py' || active.lang === 'python';

  const bundleForPreview = () => {
    const htmlFile = rec.files.find(f => /\.html?$/.test(f.name));
    if (!htmlFile) return null;
    let html = htmlFile.code;
    const css = rec.files.filter(f => f.name.endsWith('.css')).map(f => f.code).join('\n');
    const js = rec.files.filter(f => f.name.endsWith('.js')).map(f => f.code).join('\n');
    if (css && !html.includes('</style>')) html = html.replace('</head>', `<style>${css}</style></head>`);
    if (js) html = html.replace('</body>', `<script>${js}<\/script></body>`);
    return html;
  };

  el.artifactBody.innerHTML = `
    <div class="flex items-center gap-1.5 mb-2">
      <button id="artDownload" class="text-[12px] px-2 py-1 rounded-md border border-bone-line hover:bg-black/5 flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>Download</button>
      ${isWeb ? `<button id="artPreview" class="text-[12px] px-2 py-1 rounded-md border border-bone-line hover:bg-black/5 flex items-center gap-1"><i data-lucide="eye" class="w-3.5 h-3.5"></i>Preview</button>` : ''}
      ${isPy ? `<button id="artRun" class="text-[12px] px-2 py-1 rounded-md border border-bone-line hover:bg-black/5 flex items-center gap-1"><i data-lucide="play" class="w-3.5 h-3.5"></i>Run</button>` : ''}
    </div>
    <pre class="rounded-xl bg-ink text-[#e9e7df] p-3 text-[12.5px] leading-relaxed overflow-x-auto"><code>${escapeHtml(active.code)}</code></pre>
    <div id="artPreviewWrap" class="hidden mt-3"><iframe id="artIframe" class="w-full h-72 rounded-xl border border-bone-line bg-white"></iframe></div>
    <pre id="artRunOut" class="hidden mt-3 rounded-xl bg-bone-deep p-3 text-[12.5px] whitespace-pre-wrap"></pre>`;
  refreshIcons();

  $('artDownload')?.addEventListener('click', () => download(active.name, active.code));
  $('artPreview')?.addEventListener('click', () => {
    const wrap = $('artPreviewWrap'); wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) $('artIframe').srcdoc = bundleForPreview() || active.code;
  });
  $('artRun')?.addEventListener('click', async () => {
    const out = $('artRunOut'); out.classList.remove('hidden'); out.textContent = 'Running…';
    const res = await runPython(active.code);
    out.textContent = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '') + (res.error ? '\nError: ' + res.error : '') || '(no output)';
  });
  el.artifactTabs.onclick = e => {
    const b = e.target.closest('[data-art-tab]'); if (!b) return;
    rec._active = Number(b.getAttribute('data-art-tab'));
    renderArtifactsForConv();
  };
}

/* ---------------- send ---------------- */
async function send(text, { fileNames = null } = {}) {
  const attachments = state.pendingFiles.filter(f => f.status === 'ready');
  if ((!text.trim() && !attachments.length) || state.streaming) return;

  const conv = state.conv || blankConversation();
  state.conv = conv;
  const isFirst = conv.messages.length === 0;

  const userMsg = {
    role: 'user', content: text.trim() || '(see attached files)',
    fileNames: fileNames || attachments.map(f => f.name), ts: Date.now()
  };
  conv.messages.push(userMsg);
  if (isFirst) {
    conv.title = text.trim().slice(0, 60) || attachments[0]?.name || 'New chat';
    el.convTitle.textContent = conv.title;
    el.inner.innerHTML = '';
  }
  el.inner.appendChild(bubbleUser(userMsg.content, userMsg.fileNames));

  const settings = state.settings || await settingsRepo.get();

  // explicit memory capture
  const explicit = extractExplicitMemory(text);
  if (explicit && settings.ai.memoryEnabled) await memories.add(explicit, { scope: 'global', source: 'explicit' }).catch(() => {});

  // fast-path calculator — skip the model entirely for pure arithmetic
  const calc = settings.tools?.calculator ? tryCalculate(text) : null;

  el.input.value = ''; clearPendingFiles(); autoGrow(); scrollToBottom(true);

  const node = bubbleAssistant(typingHTML());
  el.inner.appendChild(node);
  refreshIcons(); scrollToBottom(true);
  const body = node.querySelector('[data-body]');
  const badge = node.querySelector('[data-model-badge]');

  if (calc) {
    const answer = `**${calc.expr.trim()} = ${Number.isInteger(calc.result) ? calc.result : Math.round(calc.result * 1e6) / 1e6}**`;
    body.innerHTML = renderMarkdown(answer);
    badge.textContent = 'Calculator · fast'; badge.classList.remove('hidden');
    conv.messages.push({ role: 'assistant', content: answer, model: { display_name: 'Calculator' }, mode: 'fast', ts: Date.now() });
    attachActions(node, () => answer, retryLast);
    refreshIcons();
    await conversations.put(conv); await refreshList();
    el.input.focus();
    return;
  }

  setStreamingUI(true);
  state.stop = false;

  // context assembly: memory + docs + search
  const memList = await relevantMemories(text);
  const memBlock = memoryToSystemBlock(memList);

  const docResults = [];
  for (const f of attachments) {
    if (f.isImage) continue;
    const relevant = retrieveChunks(f.chunks, text, 5);
    if (relevant.length) docResults.push({ name: f.name, chunks: relevant });
  }
  const docBlock = docsToContextBlock(docResults);

  let searchBlock = '';
  if (state.webSearchOn) {
    const sr = await webSearch(text);
    if (sr.ok) searchBlock = formatSearchContext(sr.results);
    else if (sr.reason === 'no_key') toast('Add a search API key in Settings → Tools to use web search');
  }

  const projectInstr = conv.projectId ? (state.projects.find(p => p.id === conv.projectId)?.instructionsCache || '') : '';
  let system = BASE_SYSTEM_PROMPT;
  if (settings.ai.customInstructions) system += `\n\nUser's custom instructions: ${settings.ai.customInstructions}`;
  if (settings.ai.responseStyle && settings.ai.responseStyle !== 'balanced') system += `\nResponse style: ${settings.ai.responseStyle}.`;
  if (projectInstr) system += `\n\nProject instructions: ${projectInstr}`;
  [memBlock, docBlock, searchBlock].filter(Boolean).forEach(b => { system += `\n\n${b}`; });

  const historyMsgs = conv.messages.slice(-24).map(m => ({ role: m.role, content: m.content }));
  const hasImage = attachments.some(f => f.isImage);
  if (hasImage) {
    const last = historyMsgs[historyMsgs.length - 1];
    last.content = [
      { type: 'text', text: last.content },
      ...attachments.filter(f => f.isImage).map(f => ({ type: 'image_url', image_url: { url: f.dataUrl } }))
    ];
  }

  const payload = [{ role: 'system', content: system }, ...historyMsgs];
  const longDoc = docResults.some(d => d.chunks.join('').length > 4000) || estimateTokens(text) > 3000;

  let full = '', lastModel = null, lastMode = null;
  try {
    for await (const ev of chatWithFallback({
      messages: payload, mode: el.modeSelect.value, text, hasImage,
      hasDocs: !!docResults.length, longDoc, pinnedModel: el.modelSelect.value || null,
      shouldStop: () => state.stop
    })) {
      if (ev.type === 'model') {
        lastModel = ev.model; lastMode = ev.mode;
        badge.textContent = `${ev.model.display_name} · ${ev.mode}`;
        badge.classList.remove('hidden');
      } else if (ev.type === 'fallback') {
        badge.textContent = `${ev.from.display_name} unavailable — trying another model…`;
      } else if (ev.type === 'chunk') {
        full = ev.full;
        body.innerHTML = renderMarkdown(full);
        body.classList.add('cursor-blink');
        scrollToBottom();
      } else if (ev.type === 'stopped') {
        full = ev.full || full;
      } else if (ev.type === 'error') {
        body.classList.remove('cursor-blink');
        if (ev.partial && full) {
          body.innerHTML = renderMarkdown(full) + `<div class="mt-2 text-[12.5px] text-clay-dark">${escapeHtml(ev.error.text)}</div>`;
        } else {
          body.innerHTML = `<div class="rounded-xl border border-clay/40 bg-clay-soft text-[13.5px] text-ink-soft px-3.5 py-2.5">${escapeHtml(ev.error.text)}</div>`;
        }
      } else if (ev.type === 'done') {
        full = ev.full;
      }
    }
    body.classList.remove('cursor-blink');
    if (!full.trim()) { full = state.stop ? '_(stopped)_' : '_(no response)_'; body.innerHTML = renderMarkdown(full); }

    conv.messages.push({ role: 'assistant', content: full, model: lastModel, mode: lastMode, ts: Date.now() });
    attachActions(node, () => full, retryLast);
    refreshIcons();
    conv.lastModel = lastModel?.model_id || conv.lastModel;
    await conversations.put(conv);
    await refreshList();
    await saveArtifactsFromReply(conv, full);
  } catch (err) {
    body.classList.remove('cursor-blink');
    body.innerHTML = `<div class="rounded-xl border border-clay/40 bg-clay-soft text-[13.5px] text-ink-soft px-3.5 py-2.5">Something went wrong: ${escapeHtml(err?.message || 'request failed')}</div>`;
    if (full.trim()) { conv.messages.push({ role: 'assistant', content: full, ts: Date.now() }); await conversations.put(conv).catch(() => {}); }
    else conv.messages.pop();
  } finally {
    setStreamingUI(false);
    el.input.focus();
  }
}

/* ---------------- settings / admin modal ---------------- */
const TAB_TITLES = { account: 'Account', ai: 'AI & routing', appearance: 'Appearance', privacy: 'Privacy', tools: 'Tools', memory: 'Memory', models: 'Models', usage: 'Usage' };
let activeTab = 'account';

function field(label, inner) {
  return `<label class="block mb-3"><span class="block text-[12px] text-ink-mute mb-1">${label}</span>${inner}</label>`;
}
const inputCls = 'w-full h-9 px-2.5 rounded-lg border border-bone-line text-[13.5px] focus:outline-none focus:border-clay/50';
const toggleRow = (id, label, checked) => `
  <label class="flex items-center justify-between py-2 border-b border-bone-line/70 last:border-0">
    <span class="text-[13.5px]">${label}</span>
    <input type="checkbox" data-setting="${id}" ${checked ? 'checked' : ''} class="w-4 h-4 accent-[#d97757]">
  </label>`;

async function renderSettingsTab() {
  const s = state.settings = await settingsRepo.get();
  el.settingsTitle.textContent = TAB_TITLES[activeTab];
  [...document.querySelectorAll('.settings-tab')].forEach(b => {
    b.classList.toggle('bg-white', b.dataset.tab === activeTab);
    b.classList.toggle('text-ink', b.dataset.tab === activeTab);
    b.classList.toggle('text-ink-soft', b.dataset.tab !== activeTab);
  });

  if (activeTab === 'account') {
    let name = 'Signed out';
    try { name = (await puter.auth.getUser())?.username || name; } catch {}
    el.settingsBody.innerHTML = `
      <p class="text-[13px] text-ink-mute mb-3">Signed in via Puter as <strong>${escapeHtml(name)}</strong>.</p>
      ${field('Display name (used in greetings)', `<input class="${inputCls}" data-setting="account.displayName" value="${escapeHtml(s.account.displayName)}">`)}
      ${field('Short bio / context for the AI', `<textarea class="${inputCls} h-20" data-setting="account.bio">${escapeHtml(s.account.bio)}</textarea>`)}`;
  }

  if (activeTab === 'ai') {
    el.settingsBody.innerHTML = `
      ${field('Response style', `<select class="${inputCls}" data-setting="ai.responseStyle">
        ${['concise', 'balanced', 'detailed', 'technical'].map(v => `<option value="${v}" ${s.ai.responseStyle === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>`)}
      ${field('Custom instructions (always included)', `<textarea class="${inputCls} h-24" data-setting="ai.customInstructions">${escapeHtml(s.ai.customInstructions)}</textarea>`)}
      ${toggleRow('ai.memoryEnabled', 'Use memory in conversations', s.ai.memoryEnabled)}
      ${toggleRow('ai.showRouting', 'Show which model answered', s.ai.showRouting)}`;
  }

  if (activeTab === 'appearance') {
    el.settingsBody.innerHTML = `
      ${field('Theme', `<select class="${inputCls}" data-setting="appearance.theme">
        ${['light', 'dark', 'system'].map(v => `<option value="${v}" ${s.appearance.theme === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>`)}
      ${field('Font size', `<select class="${inputCls}" data-setting="appearance.fontSize">
        ${['small', 'medium', 'large'].map(v => `<option value="${v}" ${s.appearance.fontSize === v ? 'selected' : ''}>${v}</option>`).join('')}
      </select>`)}
      <p class="text-[12px] text-ink-mute mt-2">Dark mode ships as a setting now; visual theme swap is next on the roadmap.</p>`;
  }

  if (activeTab === 'privacy') {
    el.settingsBody.innerHTML = `
      ${toggleRow('privacy.saveHistory', 'Save conversation history', s.privacy.saveHistory)}
      ${toggleRow('privacy.allowUsageStats', 'Keep local usage stats', s.privacy.allowUsageStats)}
      <div class="flex gap-2 mt-4">
        <button id="exportDataBtn" class="h-9 px-3 rounded-lg border border-bone-line text-[13px] hover:bg-black/5">Export my data</button>
        <button id="wipeDataBtn" class="h-9 px-3 rounded-lg border border-clay/50 text-clay-dark text-[13px] hover:bg-clay-soft">Delete all local data</button>
      </div>
      <p class="text-[11.5px] text-ink-mute mt-2">Everything is stored per-account in Puter's storage for this app — nothing is sent to a server Anthropic or this app controls.</p>`;
    $('exportDataBtn')?.addEventListener('click', async () => {
      const data = await exportAll();
      download('lumen-export.json', JSON.stringify(data, null, 2), 'application/json');
    });
    $('wipeDataBtn')?.addEventListener('click', async () => {
      if (!confirm('Delete all local Peaceable data? This cannot be undone.')) return;
      await wipeAll(); toast('Local data cleared'); location.reload();
    });
  }

  if (activeTab === 'tools') {
    el.settingsBody.innerHTML = `
      ${toggleRow('tools.calculator', 'Calculator (instant, no model call)', s.tools.calculator)}
      ${toggleRow('tools.code_exec', 'Python sandbox (Pyodide, runs in your browser)', s.tools.code_exec)}
      ${toggleRow('tools.doc_reader', 'Document reading (PDF / DOCX / XLSX)', s.tools.doc_reader)}
      ${toggleRow('tools.web_search', 'Web search', s.tools.web_search)}
      ${field('Search API key (Brave Search) — required for web search', `<input class="${inputCls}" type="password" data-setting="tools.searchApiKey" value="${escapeHtml(s.tools.searchApiKey || '')}" placeholder="BSA...">`)}
      <p class="text-[11.5px] text-ink-mute -mt-2">No key is bundled with the app — web search stays off until you add your own, and it's never sent anywhere except the search provider.</p>`;
  }

  if (activeTab === 'memory') {
    const list = await memories.all();
    el.settingsBody.innerHTML = `
      <div class="flex gap-2 mb-3">
        <input id="memNewInput" class="${inputCls} flex-1" placeholder="Add something to remember…">
        <button id="memAddBtn" class="h-9 px-3 rounded-lg bg-clay text-white text-[13px]">Add</button>
      </div>
      <div class="space-y-1.5">
        ${list.length ? list.map(m => `
          <div class="flex items-start gap-2 border border-bone-line rounded-lg px-2.5 py-2">
            <span class="flex-1 text-[13px]">${escapeHtml(m.text)}</span>
            <button data-mem-del="${m.id}" class="text-ink-mute hover:text-clay-dark"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
          </div>`).join('') : '<p class="text-[13px] text-ink-mute">Nothing remembered yet. Try saying "remember that…" in chat.</p>'}
      </div>`;
    refreshIcons();
    $('memAddBtn')?.addEventListener('click', async () => {
      const v = $('memNewInput').value.trim();
      if (v) { await memories.add(v, { scope: 'global', source: 'user' }); renderSettingsTab(); }
    });
    el.settingsBody.querySelectorAll('[data-mem-del]').forEach(b =>
      b.addEventListener('click', async () => { await memories.remove(b.getAttribute('data-mem-del')); renderSettingsTab(); }));
  }

  if (activeTab === 'models') {
    const map = await byFamily();
    let html = '<p class="text-[12px] text-ink-mute mb-2">Enable or disable individual models. This is a local, per-browser admin control — there\'s no shared multi-user backend in this build.</p>';
    for (const [family, models] of map) {
      html += `<div class="mb-3"><div class="text-[12px] font-medium text-ink-mute mb-1">${escapeHtml(family)}</div>`;
      html += models.map(m => `
        <label class="flex items-center justify-between py-1.5 border-b border-bone-line/60 last:border-0">
          <span class="text-[13px]">${escapeHtml(m.display_name)} <span class="text-ink-mute text-[11px]">${[m.capabilities.vision && 'vision', m.capabilities.coding && 'coding', m.capabilities.reasoning && 'reasoning'].filter(Boolean).join(' · ')}</span></span>
          <input type="checkbox" data-model-toggle="${m.model_id}" ${m.enabled ? 'checked' : ''} class="w-4 h-4 accent-[#d97757]">
        </label>`).join('');
      html += '</div>';
    }
    el.settingsBody.innerHTML = html;
    el.settingsBody.querySelectorAll('[data-model-toggle]').forEach(cb =>
      cb.addEventListener('change', async () => { await setModelEnabled(cb.getAttribute('data-model-toggle'), cb.checked); await populateModelSelect(); }));
  }

  if (activeTab === 'usage') {
    const events = await usage.all();
    const total = events.length;
    const tokens = events.reduce((n, e) => n + (e.promptTokens || 0) + (e.completionTokens || 0), 0);
    const errors = events.filter(e => !e.ok).length;
    const byModel = {};
    events.forEach(e => { byModel[e.model] = byModel[e.model] || { n: 0, tok: 0 }; byModel[e.model].n++; byModel[e.model].tok += (e.promptTokens || 0) + (e.completionTokens || 0); });
    el.settingsBody.innerHTML = `
      <div class="grid grid-cols-3 gap-2 mb-4">
        <div class="rounded-lg bg-bone-deep p-3"><div class="text-[20px] font-medium">${total}</div><div class="text-[11px] text-ink-mute">requests (local)</div></div>
        <div class="rounded-lg bg-bone-deep p-3"><div class="text-[20px] font-medium">${tokens.toLocaleString()}</div><div class="text-[11px] text-ink-mute">est. tokens</div></div>
        <div class="rounded-lg bg-bone-deep p-3"><div class="text-[20px] font-medium">${errors}</div><div class="text-[11px] text-ink-mute">errors</div></div>
      </div>
      <div class="text-[12px] font-medium text-ink-mute mb-1">By model</div>
      ${Object.entries(byModel).sort((a, b) => b[1].n - a[1].n).map(([m, v]) => `
        <div class="flex justify-between text-[13px] py-1 border-b border-bone-line/60"><span>${escapeHtml(m || 'unknown')}</span><span class="text-ink-mute">${v.n} req · ~${v.tok.toLocaleString()} tok</span></div>`).join('') || '<p class="text-[13px] text-ink-mute">No usage recorded yet.</p>'}
      <p class="text-[11px] text-ink-mute mt-3">Estimated from character counts, and only covers usage from this browser — there's no server aggregating usage across devices.</p>`;
  }

  refreshIcons();
  el.settingsBody.querySelectorAll('[data-setting]').forEach(input => {
    const commit = async () => {
      const path = input.getAttribute('data-setting').split('.');
      const val = input.type === 'checkbox' ? input.checked : input.value;
      const patch = path.reduceRight((acc, key) => ({ [key]: acc }), val);
      state.settings = await settingsRepo.save(patch);
    };
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'blur', commit);
  });
}

function openSettings(tab = 'account') {
  activeTab = tab;
  el.settingsModal.classList.remove('hidden'); el.settingsModal.classList.add('flex');
  renderSettingsTab();
}
function closeSettings() { el.settingsModal.classList.add('hidden'); el.settingsModal.classList.remove('flex'); }

document.querySelectorAll('.settings-tab').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab; renderSettingsTab(); }));

/* ---------------- auth ---------------- */
async function showSignedIn() {
  state.signedIn = true;
  el.authGate.classList.add('hidden'); el.authGate.classList.remove('flex');
  el.chatPane.classList.remove('hidden'); el.chatPane.classList.add('flex');
  el.signOutBtn.classList.remove('hidden');

  try {
    const u = await puter.auth.getUser();
    const name = u?.username || 'Signed in';
    el.userName.textContent = name;
    el.avatar.textContent = name.slice(0, 1).toUpperCase();
  } catch { el.userName.textContent = 'Signed in'; el.avatar.textContent = 'U'; }

  await populateModelSelect();
  state.settings = await settingsRepo.get();
  await refreshProjects();
  const list = await conversations.index();
  if (list.length) await openConversation(list[0].id); else await setConversation(blankConversation());
  refreshIcons();
  el.input.focus();
  preloadSandbox();
}

function showSignedOut() {
  state.signedIn = false;
  el.chatPane.classList.add('hidden'); el.chatPane.classList.remove('flex');
  el.authGate.classList.remove('hidden'); el.authGate.classList.add('flex');
  el.signOutBtn.classList.add('hidden');
  el.userName.textContent = 'Signed out'; el.avatar.textContent = '?';
  el.convList.innerHTML = '<p class="px-2.5 py-2 text-[12.5px] text-ink-mute">Sign in to see your chats.</p>';
  el.projectList.innerHTML = '';
  el.convTitle.textContent = 'New chat';
  refreshIcons();
}

/* ---------------- events ---------------- */
el.input.addEventListener('input', autoGrow);
el.input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(el.input.value); } });
el.sendBtn.addEventListener('click', () => send(el.input.value));
el.stopBtn.addEventListener('click', () => { state.stop = true; });

el.inner.addEventListener('click', e => {
  const s = e.target.closest('[data-suggest]');
  if (s) send(s.getAttribute('data-suggest'));
});

el.convList.addEventListener('click', e => {
  const pin = e.target.closest('[data-pin]');
  if (pin) { conversations.patchIndex(pin.getAttribute('data-pin'), { pinned: true }).then(refreshList); return; }
  const b = e.target.closest('[data-conv]');
  if (b) openConversation(b.getAttribute('data-conv'));
});
el.convSearch.addEventListener('input', () => refreshList());

el.projectList.addEventListener('click', e => {
  const b = e.target.closest('[data-project]');
  if (!b) return;
  state.activeProjectId = b.getAttribute('data-project');
  refreshProjects(); refreshList();
});

el.newChatBtn.addEventListener('click', newConversationFlow);
el.newProjectBtn.addEventListener('click', async () => {
  const name = await askPrompt('Name this project', '');
  if (!name) return;
  const proj = makeProject(name);
  await projects.put(proj);
  state.activeProjectId = proj.id;
  await refreshProjects();
  await setConversation(blankConversation(proj.id));
});

el.deleteConvBtn.addEventListener('click', async () => {
  if (!state.conv) return;
  if (!state.conv.messages.length) { newConversationFlow(); return; }
  if (!confirm('Delete this chat?')) return;
  await conversations.remove(state.conv.id);
  const list = await conversations.index();
  if (list.length) await openConversation(list[0].id); else await setConversation(blankConversation());
  toast('Chat deleted');
});

el.modelSelect.addEventListener('change', async () => {
  if (state.conv) { state.conv.lastModel = el.modelSelect.value || null; if (state.conv.messages.length) await conversations.put(state.conv).catch(() => {}); }
});

el.openSidebar.addEventListener('click', () => openSidebar(true));
el.closeSidebar.addEventListener('click', () => openSidebar(false));
el.overlay.addEventListener('click', () => openSidebar(false));

el.signInBtn.addEventListener('click', async () => { try { await puter.auth.signIn(); await showSignedIn(); } catch { toast('Sign-in cancelled'); } });
el.signOutBtn.addEventListener('click', async () => { try { await puter.auth.signOut(); } catch {} state.conv = null; showSignedOut(); });

el.attachBtn.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => { handleFiles(el.fileInput.files); el.fileInput.value = ''; });
el.fileChips.addEventListener('click', e => {
  const b = e.target.closest('[data-remove-file]'); if (!b) return;
  state.pendingFiles.splice(Number(b.getAttribute('data-remove-file')), 1);
  renderFileChips(); autoGrow();
});
['dragover', 'drop'].forEach(evt => document.getElementById('composer').addEventListener(evt, e => e.preventDefault()));
document.getElementById('composer').addEventListener('drop', e => { if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });

el.webSearchToggle.addEventListener('click', () => {
  state.webSearchOn = !state.webSearchOn;
  el.webSearchToggle.classList.toggle('text-clay', state.webSearchOn);
  el.webSearchToggle.classList.toggle('bg-clay-soft', state.webSearchOn);
});
el.micBtn.addEventListener('click', toggleVoice);

el.workspaceBtn.addEventListener('click', () => openWorkspace(!el.workspace.classList.contains('flex')));
el.workspaceCloseBtn.addEventListener('click', () => openWorkspace(false));

el.settingsBtn.addEventListener('click', () => openSettings('account'));
el.settingsCloseBtn.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', e => { if (e.target === el.settingsModal) closeSettings(); });

/* ---------------- init ---------------- */
(async function init() {
  refreshIcons();
  autoGrow();
  try { if (puter.auth.isSignedIn()) await showSignedIn(); else showSignedOut(); }
  catch { showSignedOut(); }
})();
