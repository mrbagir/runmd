// Shared application state, persisted UI preferences and a tiny event bus.

import { parentFolders } from './util.js';

// --- localStorage (may be unavailable/blocked: never throw) ---

const KEY_SIDEBAR = 'runmd_sidebar_collapsed';
const KEY_FOLDERS = 'runmd_expanded_folders';

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn('localStorage unavailable:', err);
  }
}

function loadExpandedFolders() {
  try {
    const saved = storageGet(KEY_FOLDERS);
    if (saved) return new Set(JSON.parse(saved));
  } catch (err) {
    console.warn('Failed to parse expanded folders:', err);
  }
  return null; // first visit: expand everything once notes are known
}

// --- State ---

export const state = {
  notes: [],
  connections: {},
  activeNote: null,
  rawMode: false,
  graphData: null, // cached /api/graph payload; null = needs refetch
  sidebarCollapsed: storageGet(KEY_SIDEBAR) === 'true',
  expandedFolders: loadExpandedFolders(),
};

export function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = collapsed;
  storageSet(KEY_SIDEBAR, collapsed ? 'true' : 'false');
}

function persistFolders() {
  if (state.expandedFolders) {
    storageSet(KEY_FOLDERS, JSON.stringify([...state.expandedFolders]));
  }
}

/** On the very first visit, expand every folder that contains a note. */
export function initExpandedFolders(notes) {
  if (state.expandedFolders !== null) return;
  state.expandedFolders = new Set(notes.flatMap((n) => parentFolders(n.name)));
  persistFolders();
}

/** Make sure all ancestor folders of a note are open. */
export function expandParentsOf(noteName) {
  if (!state.expandedFolders) state.expandedFolders = new Set();
  let changed = false;
  for (const folder of parentFolders(noteName)) {
    if (!state.expandedFolders.has(folder)) {
      state.expandedFolders.add(folder);
      changed = true;
    }
  }
  if (changed) persistFolders();
}

export function toggleFolder(path) {
  if (!state.expandedFolders) state.expandedFolders = new Set();
  if (!state.expandedFolders.delete(path)) state.expandedFolders.add(path);
  persistFolders();
}

// --- Event bus ---
//
// Events:
//   notes-changed        the note list was (re)loaded
//   connections-changed  the connection list was (re)loaded
//   active-changed       a different note (or none) is now active
//   content-saved        {note} a note's content was saved

const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
  },
  emit(event, detail) {
    for (const fn of listeners.get(event) ?? []) fn(detail);
  },
};
