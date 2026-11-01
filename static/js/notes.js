// Note & connection operations: talk to the API, update shared state, emit
// events. No DOM code lives here; views subscribe through the bus.

import { api } from './api.js';
import { bus, expandParentsOf, initExpandedFolders, state } from './state.js';
import { normalizeNoteName } from './util.js';

export function reportError(prefix, err) {
  console.error(prefix, err);
  alert(`${prefix}: ${err?.message ?? err}`);
}

// --- URL <-> note ---

export function noteNameFromUrl() {
  const path = window.location.pathname;
  if (!path.startsWith('/n/')) return null;
  try {
    return decodeURIComponent(path.slice(3).replace(/\.md$/, '').trim());
  } catch {
    return null;
  }
}

function pushNoteUrl(name) {
  const target = `/n/${encodeURI(name)}`;
  if (window.location.pathname !== target) history.pushState({ note: name }, '', target);
}

// --- Loading ---

export async function loadNotes() {
  try {
    state.notes = await api.listNotes();
    initExpandedFolders(state.notes);
    bus.emit('notes-changed');
  } catch (err) {
    console.error('Failed to load notes', err);
  }
}

export async function loadConnections() {
  try {
    state.connections = await api.listConnections();
    bus.emit('connections-changed');
  } catch (err) {
    console.error('Failed to load connections', err);
  }
}

// --- Selection ---

function findNote(name) {
  const clean = normalizeNoteName(name);
  return state.notes.find(
    (n) => n.name === clean || n.name.endsWith('/' + clean) || clean.endsWith('/' + n.name),
  );
}

export async function selectNote(name, pushHistory = true) {
  const found = findNote(name);
  if (!found) return false;

  state.activeNote = found;
  if (pushHistory) pushNoteUrl(found.name);
  expandParentsOf(found.name);

  // The list normally carries full content; fetch only if it is missing.
  if (found.content === undefined || found.code_blocks === undefined) {
    try {
      Object.assign(found, await api.getNote(found.name));
    } catch (err) {
      console.error('Failed to fetch note content', err);
    }
  }
  bus.emit('active-changed');
  return true;
}

// --- Saving ---

let saveChain = Promise.resolve();
let pendingSaves = 0;

/**
 * Persist new content for a note (default: the active one). Saves run one at
 * a time, in order. The server's parsed view (links, code blocks...) is merged
 * back only when no newer save is queued, so a slow response can never roll
 * the visible content back.
 */
export function saveNoteContent(content, note = state.activeNote) {
  if (!note) return Promise.resolve();
  note.content = content; // optimistic

  pendingSaves++;
  const run = async () => {
    try {
      const saved = await api.saveNote(note.name, content);
      if (pendingSaves === 1) Object.assign(note, saved);
      state.graphData = null; // links may have changed
    } catch (err) {
      reportError('Gagal menyimpan note', err);
    } finally {
      pendingSaves--;
      bus.emit('content-saved', { note });
    }
  };
  saveChain = saveChain.then(run, run);
  return saveChain;
}

// --- Create / rename / delete ---

export async function createNote(name) {
  const clean = normalizeNoteName(name);
  if (!clean) return;

  const content =
    `# ${clean.split('/').pop()}\nDouble click this text to edit.\n\n` +
    '```sh @assert="contains:Hello"\n' +
    `echo "Hello from ${clean}"\n` +
    '```\n';

  try {
    const created = await api.saveNote(clean, content);
    expandParentsOf(created.name);
    state.graphData = null;
    await loadNotes();
    await selectNote(created.name);
  } catch (err) {
    reportError('Gagal membuat note', err);
  }
}

export async function renameNote(oldName, newName) {
  const clean = normalizeNoteName(newName);
  if (!clean || clean === oldName) return;

  try {
    await api.renameNote(oldName, clean);
  } catch (err) {
    reportError('Failed to rename note', err);
    return;
  }

  expandParentsOf(clean);
  state.graphData = null;
  const wasActive = state.activeNote?.name === oldName;
  await loadNotes();
  if (wasActive) await selectNote(clean, true);
}

export async function deleteNote(name) {
  try {
    await api.deleteNote(name);
  } catch (err) {
    reportError('Gagal menghapus note', err);
    return;
  }
  state.graphData = null;
  const wasActive = state.activeNote?.name === name;
  await loadNotes();

  if (wasActive) {
    if (state.notes.length > 0) {
      await selectNote(state.notes[0].name);
    } else {
      state.activeNote = null;
      bus.emit('active-changed');
    }
  }
}

// --- Connections ---

export async function saveConnection(conn) {
  try {
    await api.saveConnection(conn);
  } catch (err) {
    reportError('Gagal menyimpan koneksi', err);
    return false;
  }
  state.graphData = null;
  await loadConnections();
  return true;
}

export async function deleteConnection(alias) {
  try {
    await api.deleteConnection(alias);
  } catch (err) {
    reportError('Gagal menghapus koneksi', err);
    return;
  }
  state.graphData = null;
  await loadConnections();
}
