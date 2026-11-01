// Entry point: wires modules together, handles view switching, keyboard
// shortcuts and ONE delegated click handler for every [data-action] element.

import { renderGraph } from './graph.js';
import { showConfirmModal, showToast } from './modal.js';
import {
  clearOutput,
  deleteBlock,
  initNotebook,
  insertBlock,
  runAllCells,
  runCell,
  toggleDrawer,
} from './notebook.js';
import { createNote, loadConnections, loadNotes, noteNameFromUrl, selectNote } from './notes.js';
import { initRawSource, toggleRawSource } from './rawsource.js';
import {
  closeNoteMenuOnOutsideClick,
  confirmDeleteConnection,
  confirmDeleteNote,
  initSidebar,
  onToggleFolder,
  openNoteMenu,
  promptNewNote,
  promptNewNoteInFolder,
  promptRenameNote,
  submitConnectionForm,
  toggleConnectionForm,
  toggleSidebar,
} from './sidebar.js';
import { state } from './state.js';

const $ = (id) => document.getElementById(id);

// --- Views (Document / Graph) ---

const TAB_ACTIVE =
  'px-2.5 py-1 rounded text-xs font-medium bg-[#1e1e24] text-[#f4f4f7] transition flex items-center gap-1.5';
const TAB_IDLE =
  'px-2.5 py-1 rounded text-xs font-medium text-[#8e8e99] hover:text-[#dcdce5] hover:bg-[#18181f] transition flex items-center gap-1.5';

function switchView(view) {
  const isNotebook = view === 'notebook';
  $('contentContainer').classList.toggle('hidden', !isNotebook);
  $('viewGraph').classList.toggle('hidden', isNotebook);
  $('tabNotebook').className = isNotebook ? TAB_ACTIVE : TAB_IDLE;
  $('tabGraph').className = isNotebook ? TAB_IDLE : TAB_ACTIVE;

  if (!isNotebook) renderGraph(openNoteFromGraph);
}

function openNoteFromGraph(noteId) {
  switchView('notebook');
  selectNote(noteId);
}

// --- Click actions: data-action="<name>" (+ data-* arguments) ---

const actions = {
  'toggle-sidebar': () => toggleSidebar(),
  'switch-view': (el) => switchView(el.dataset.view),
  'toggle-raw': () => toggleRawSource(),

  'new-note': () => promptNewNote(),
  'new-note-in-folder': (el) => promptNewNoteInFolder(el.dataset.path),
  'toggle-folder': (el) => onToggleFolder(el.dataset.path),
  'select-note': async (el) => {
    const name = el.dataset.name;
    const ok = await selectNote(name);
    if (!ok && (el.dataset.unresolved === 'true' || el.classList.contains('wikilink'))) {
      const create = await showConfirmModal({
        title: 'Note Belum Ada',
        message: `Note '${name}.md' belum dibuat. Apakah Anda ingin membuat note baru ini sekarang?`,
        confirmText: 'Buat Note',
      });
      if (create) await createNote(name);
    }
  },
  'open-note-menu': (el) => openNoteMenu(el.dataset.name, el),
  'rename-note': (el) => promptRenameNote(el.dataset.name),
  'delete-note': (el) => confirmDeleteNote(el.dataset.name),

  'toggle-conn-form': () => toggleConnectionForm(),
  'save-connection': () => submitConnectionForm(),
  'delete-connection': (el) => confirmDeleteConnection(el.dataset.alias),

  'insert-block': (el) => insertBlock(Number(el.dataset.index), el.dataset.type),
  'delete-block': (el) => deleteBlock(Number(el.dataset.index)),
  'run-cell': (el) => runCell(el.closest('[data-cell]')),
  'run-all-blocks': () => runAllCells(),
  'toggle-drawer': (el) => toggleDrawer(el.closest('[data-cell]')),
  'clear-output': (el) => clearOutput(el.closest('[data-cell]')),
};

document.addEventListener('click', (event) => {
  closeNoteMenuOnOutsideClick(event.target);

  const el = event.target.closest('[data-action]');
  const handler = el && actions[el.dataset.action];
  if (!handler) return;
  event.preventDefault();
  handler(el);
});

// --- Keyboard shortcuts ---

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();

  if (key === 'e') {
    // Toggle View Source (Obsidian standard, no browser collision)
    e.preventDefault();
    toggleRawSource();
  } else if (key === 'b' || key === '\\') {
    e.preventDefault();
    toggleSidebar();
  } else if (key === 's') {
    e.preventDefault();
    showToast('Note tersimpan', 'success');
  }
});

// Browser Back / Forward
window.addEventListener('popstate', () => {
  const name = noteNameFromUrl();
  if (name) selectNote(name, false);
  else if (state.notes.length > 0) selectNote(state.notes[0].name, false);
});

// --- Start ---

async function init() {
  initSidebar();
  initNotebook();
  initRawSource();

  await Promise.all([loadConnections(), loadNotes()]);

  const initial = noteNameFromUrl();
  if (initial) selectNote(initial, false);
  else if (state.notes.length > 0) selectNote(state.notes[0].name, true);
}

init();
