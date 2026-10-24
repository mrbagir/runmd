// "View Source" drawer: raw Markdown editor with debounced auto-sync and a
// draggable divider.

import { saveNoteContent } from './notes.js';
import { bus, state } from './state.js';

const $ = (id) => document.getElementById(id);
const SYNC_DELAY_MS = 350;

export function initRawSource() {
  initResizer();
  $('rawSourceTextarea').addEventListener('input', onRawInput);

  // Switching notes: first save any pending edit to the note it belongs to,
  // then show the new note's source.
  bus.on('active-changed', () => {
    flushPendingSync();
    if (state.rawMode) $('rawSourceTextarea').value = state.activeNote?.content ?? '';
  });
  // Edits made in the notebook: mirror them unless the user is typing here.
  bus.on('content-saved', ({ note }) => {
    const textarea = $('rawSourceTextarea');
    if (state.rawMode && note === state.activeNote && document.activeElement !== textarea) {
      textarea.value = note.content ?? '';
    }
  });
}

export function toggleRawSource() {
  state.rawMode = !state.rawMode;

  $('rawEditorPanel').classList.toggle('hidden', !state.rawMode);
  $('rawResizer').classList.toggle('hidden', !state.rawMode);
  $('btnRawToggle').textContent = state.rawMode ? 'Hide Source' : 'View Source';

  if (state.rawMode) {
    const textarea = $('rawSourceTextarea');
    textarea.value = state.activeNote?.content ?? '';
    textarea.focus();
  }
}

let syncTimer = null;
let pending = null; // { note, value }: captured at input time, never re-read later

function onRawInput() {
  const note = state.activeNote;
  if (!note) return;

  // Capture note AND text now: by the time the timer fires, the user may have
  // switched notes and the textarea may already show a different one.
  pending = { note, value: $('rawSourceTextarea').value };
  $('rawSyncStatus').textContent = 'syncing...';

  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushPendingSync, SYNC_DELAY_MS);
}

function flushPendingSync() {
  clearTimeout(syncTimer);
  if (!pending) return Promise.resolve();

  const { note, value } = pending;
  pending = null;
  return saveNoteContent(value, note).then(() => {
    $('rawSyncStatus').textContent = 'synced';
  });
}

function initResizer() {
  const resizer = $('rawResizer');
  const panel = $('rawEditorPanel');
  let resizing = false;

  resizer.addEventListener('mousedown', () => {
    resizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const width = window.innerWidth - e.clientX;
    if (width >= 200 && width <= window.innerWidth * 0.8) panel.style.width = `${width}px`;
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
