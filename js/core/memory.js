/**
 * Lightweight relevance-scored memory (section 11).
 * Nothing is stored automatically — only explicit user requests
 * ("remember that...") or the Memory panel add relevant entries.
 */
import { memories, settingsRepo } from './store.js';

export async function relevantMemories(text, { limit = 6 } = {}) {
  const settings = await settingsRepo.get();
  if (!settings.ai.memoryEnabled) return [];
  const all = await memories.all();
  if (!all.length) return [];

  const words = new Set((text || '').toLowerCase().match(/[a-z0-9']{3,}/g) || []);
  const scored = all.map(m => {
    const mw = m.text.toLowerCase().match(/[a-z0-9']{3,}/g) || [];
    const overlap = mw.filter(w => words.has(w)).length;
    return { m, score: overlap };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.filter(s => s.score > 0).slice(0, limit).map(s => s.m);
  const merged = [...top];
  for (const g of all.filter(m => m.scope === 'global').slice(0, 3)) {
    if (!merged.some(x => x.id === g.id) && merged.length < limit) merged.push(g);
  }
  return merged;
}

export function memoryToSystemBlock(list) {
  if (!list.length) return '';
  return 'Relevant things you already know about this user (weave in naturally, never list them back verbatim):\n' +
    list.map(m => `- ${m.text}`).join('\n');
}

const REMEMBER_RE = /^(?:remember|note|keep in mind|don't forget)(?: that)?[:,]?\s+(.+)$/i;

/** Detects an explicit "remember that X" instruction in a user message. */
export function extractExplicitMemory(text) {
  const m = REMEMBER_RE.exec((text || '').trim());
  return m ? m[1].trim().replace(/\.$/, '') : null;
}
