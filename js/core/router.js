/**
 * ModelRouter — turns a routing "mode" (auto/fast/smart/reasoning/coding/vision)
 * plus request context into a ranked fallback chain of enabled models.
 *
 * AUTO uses simple, transparent, configurable rules — no hidden model call,
 * no arbitrary guessing. Anyone can read exactly why a mode was chosen.
 */
import { listModels } from './registry.js';

export const MODES = ['auto', 'fast', 'smart', 'reasoning', 'coding', 'vision'];

const CODE_RE = /```|\bfunction\b|\bconst \w|\bclass \w|<\/?[a-z][\w-]*>|\bimport\s+\w|\bdef\s+\w+\(|\bSELECT\b[\s\S]*\bFROM\b|\bregex\b|\breact\b|\bcomponent\b|\brefactor\b|\bdebug\b|stack trace|npm install|pip install|css\b|html\b|api endpoint/i;
const REASON_RE = /\bsolve\b|\bprove\b|step[- ]by[- ]step|logic puzzle|\bderivative\b|\bintegral\b|optimi[sz]e|algorithm complexity|\britiquely\b|\briteriddle\b|\bbrainteaser\b|\btheorem\b/i;
const MATH_RE = /^[\s\d+\-*/^%().,]+$/;

/** Pure, testable classification — no I/O. */
export function classify({ text = '', hasImage = false, hasDocs = false, longDoc = false } = {}) {
  const t = (text || '').trim();
  if (hasImage) return 'vision';
  if (longDoc) return 'smart';
  if (CODE_RE.test(t)) return 'coding';
  if (REASON_RE.test(t)) return 'reasoning';
  if (MATH_RE.test(t) && t.length) return 'fast';
  if (t.length > 0 && t.length < 60 && !hasDocs) return 'fast';
  return 'smart';
}

function score(m, mode) {
  if (mode === 'fast') return m.speed * 2 - m.cost * 0.5;
  if (mode === 'vision') return (m.capabilities.vision ? 12 : 0) + m.quality;
  if (mode === 'coding') return (m.capabilities.coding ? 12 : 0) + m.quality;
  if (mode === 'reasoning') return (m.capabilities.reasoning ? 12 : 0) + m.quality * 1.2;
  return m.quality * 2 - m.cost * 0.3; // smart / general
}

/**
 * Returns { mode, chain } where chain is up to 3 candidate models,
 * pinnedModel (if valid + enabled) always first.
 */
export async function pickChain({ mode = 'auto', text = '', hasImage = false, hasDocs = false, longDoc = false, pinnedModel = null } = {}) {
  const models = await listModels({ onlyEnabled: true });
  if (!models.length) return { mode, chain: [] };

  const resolvedMode = mode === 'auto' ? classify({ text, hasImage, hasDocs, longDoc }) : mode;

  let pool = models;
  if (resolvedMode === 'vision') pool = models.filter(m => m.capabilities.vision);
  else if (resolvedMode === 'coding') pool = models.filter(m => m.capabilities.coding);
  else if (resolvedMode === 'reasoning') pool = models.filter(m => m.capabilities.reasoning);
  if (!pool.length) pool = models; // no exact match enabled — fall back to whole pool

  if (longDoc) {
    const longCtx = pool.filter(m => m.context_length >= 100000);
    if (longCtx.length) pool = longCtx;
  }

  const ranked = [...pool].sort((a, b) => score(b, resolvedMode) - score(a, resolvedMode));

  const chain = [];
  if (pinnedModel) {
    const pinned = models.find(m => m.model_id === pinnedModel);
    if (pinned) chain.push(pinned);
  }
  for (const m of ranked) {
    if (chain.length >= 3) break;
    if (!chain.some(c => c.model_id === m.model_id)) chain.push(m);
  }
  return { mode: resolvedMode, chain };
}
