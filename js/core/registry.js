/**
 * ModelRegistry — the single place that knows about available models.
 * Combines the static MODEL_CATALOG (config) with admin overrides stored
 * in Puter KV (registryStore). Nothing else in the app should import
 * MODEL_CATALOG directly.
 */
import { PROVIDERS, MODEL_CATALOG, UTILITY_MODELS } from '../config/models.js';
import { registryStore } from './store.js';

let _cache = null;

export async function loadRegistry(force = false) {
  if (_cache && !force) return _cache;
  const overrides = await registryStore.get().catch(() => ({ disabled: [], custom: [], providers: {} }));
  const disabled = new Set(overrides.disabled || []);
  const models = MODEL_CATALOG
    .map(m => ({ ...m, enabled: disabled.has(m.model_id) ? false : m.enabled }))
    .concat(overrides.custom || []);
  _cache = { models, providers: PROVIDERS, overrides };
  return _cache;
}

export function invalidateRegistry() { _cache = null; }

export async function listModels({ onlyEnabled = true } = {}) {
  const { models } = await loadRegistry();
  return onlyEnabled ? models.filter(m => m.enabled) : models;
}

export async function getModel(id) {
  const { models } = await loadRegistry();
  return models.find(m => m.model_id === id) || null;
}

export async function setModelEnabled(id, enabled) {
  const { overrides } = await loadRegistry();
  const disabled = new Set(overrides.disabled || []);
  if (enabled) disabled.delete(id); else disabled.add(id);
  await registryStore.save({ ...overrides, disabled: [...disabled] });
  invalidateRegistry();
  return loadRegistry(true);
}

export async function addSelfHostedModel(entry) {
  const { overrides } = await loadRegistry();
  const custom = [...(overrides.custom || []), entry];
  await registryStore.save({ ...overrides, custom });
  invalidateRegistry();
  return loadRegistry(true);
}

export async function byFamily() {
  const models = await listModels({ onlyEnabled: false });
  const map = new Map();
  for (const m of models) {
    if (!map.has(m.family)) map.set(m.family, []);
    map.get(m.family).push(m);
  }
  return map;
}

export { UTILITY_MODELS, PROVIDERS };
