/**
 * Unified provider interface. Everything above this module talks to
 * chatWithFallback() and never touches puter.ai.chat or a model_id
 * directly — swapping/adding providers happens in registry.js + here.
 */
import { pickChain } from './router.js';
import { friendlyError } from './security.js';
import { usage } from './store.js';
import { estimateTokens } from './utils.js';

/**
 * Async generator. Yields:
 *   { type: 'model',   model, mode }               - about to try a candidate
 *   { type: 'chunk',   text, full, model }          - streamed text delta
 *   { type: 'fallback',from, error }                - candidate failed pre-stream, trying next
 *   { type: 'stopped', model }                       - user aborted
 *   { type: 'done',    full, model }                 - success
 *   { type: 'error',   error, partial? }             - all candidates failed / mid-stream error
 */
export async function* chatWithFallback({
  messages, mode = 'auto', text = '', hasImage = false, hasDocs = false,
  longDoc = false, pinnedModel = null, shouldStop = () => false
}) {
  const { mode: resolvedMode, chain } = await pickChain({ mode, text, hasImage, hasDocs, longDoc, pinnedModel });
  if (!chain.length) {
    yield { type: 'error', error: { code: 'no_model', text: 'No enabled model can handle this request. Check Settings → Models.' } };
    return;
  }

  let lastErr = null;
  for (const candidate of chain) {
    let receivedAny = false;
    let full = '';
    const startedAt = Date.now();
    try {
      yield { type: 'model', model: candidate, mode: resolvedMode };
      const resp = await puter.ai.chat(messages, { model: candidate.model_id, stream: true });
      for await (const part of resp) {
        if (shouldStop()) { yield { type: 'stopped', model: candidate, full }; break; }
        const chunk = part?.text ?? part?.message?.content ?? '';
        if (!chunk) continue;
        receivedAny = true;
        full += chunk;
        yield { type: 'chunk', text: chunk, full, model: candidate };
      }
      usage.record({
        model: candidate.model_id, provider: candidate.provider, mode: resolvedMode,
        promptTokens: estimateTokens(messages.map(m => m.content).join(' ')),
        completionTokens: estimateTokens(full), ms: Date.now() - startedAt, ok: true
      }).catch(() => {});
      yield { type: 'done', full, model: candidate, mode: resolvedMode };
      return;
    } catch (err) {
      lastErr = err;
      usage.record({
        model: candidate.model_id, provider: candidate.provider, mode: resolvedMode,
        ok: false, ms: Date.now() - startedAt, error: friendlyError(err).code
      }).catch(() => {});
      if (receivedAny) {
        yield { type: 'error', error: friendlyError(err), partial: true, full };
        return;
      }
      yield { type: 'fallback', from: candidate, error: friendlyError(err) };
      continue;
    }
  }
  yield { type: 'error', error: lastErr ? friendlyError(lastErr) : { code: 'unknown', text: 'All available models failed.' } };
}

/** Single non-streaming call, used for small utility jobs (titling, routing hints). */
export async function utilityComplete(prompt, { model = 'qwen/qwen-flash' } = {}) {
  try {
    const resp = await puter.ai.chat(
      [{ role: 'user', content: prompt }],
      { model, stream: false }
    );
    return resp?.message?.content ?? resp?.text ?? '';
  } catch { return ''; }
}
