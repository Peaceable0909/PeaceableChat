/**
 * Web search tool (section 13). Kept separate from the model provider so
 * any model can use the same tool. Requires the user's own API key
 * (Settings → Tools) since there is no free, key-less search API — the
 * tool is honestly disabled until configured rather than faked.
 */
import { settingsRepo } from './store.js';

export async function webSearch(query) {
  const settings = await settingsRepo.get();
  if (!settings.tools?.web_search) return { ok: false, reason: 'disabled' };
  const key = settings.tools?.searchApiKey;
  if (!key) return { ok: false, reason: 'no_key' };

  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' }
    });
    if (!res.ok) return { ok: false, reason: 'http_' + res.status };
    const data = await res.json();
    const results = (data.web?.results || []).slice(0, 5)
      .map(r => ({ title: r.title, url: r.url, snippet: r.description || '' }));
    return { ok: true, results };
  } catch (e) {
    return { ok: false, reason: 'network', message: e.message };
  }
}

export function formatSearchContext(results) {
  if (!results?.length) return '';
  return 'Web search results (cite sources by URL when you use them):\n' +
    results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join('\n');
}
