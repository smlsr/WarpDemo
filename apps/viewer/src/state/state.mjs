// Persisted run state (WV-14): the started and merged id lists, kept in
// localStorage so a reload keeps them. Same shape as the tracker (WV-06):
// { merged, running }. The browser is the only place this is written.
//
// `storage` is anything with getItem / setItem / removeItem (localStorage in the
// browser, a Map-backed stub in tests). When it is missing or throws (private
// mode, quota, blocked), every call degrades to in-memory state and never throws.
import { emptyState, normalizeState } from '../tracker/index.mjs';

export const STORAGE_KEY = 'warpview.state.v1';

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// Read the saved state. Missing, unreadable, or corrupt data gives a clean empty state.
export function loadState(storage = defaultStorage(), key = STORAGE_KEY) {
  try {
    const raw = storage?.getItem(key);
    if (raw == null || raw === '') return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

// Save the state as { merged, running }. Returns true when it was written.
export function saveState(state, storage = defaultStorage(), key = STORAGE_KEY) {
  try {
    if (!storage) return false;
    const { merged, running } = normalizeState(state);
    storage.setItem(key, JSON.stringify({ merged, running }));
    return true;
  } catch {
    return false;
  }
}

// Reset: clear both lists, in storage and in the returned state.
export function resetState(storage = defaultStorage(), key = STORAGE_KEY) {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear if storage is blocked.
  }
  return emptyState();
}

// Bind a store to one storage. `load()` is the state to hand to createTracker,
// `onChange` is the tracker callback that persists, `reset()` clears both lists.
export function createStore(storage = defaultStorage(), key = STORAGE_KEY) {
  return {
    key,
    load: () => loadState(storage, key),
    save: (state) => saveState(state, storage, key),
    onChange: (state) => saveState(state, storage, key),
    reset: () => resetState(storage, key),
  };
}
