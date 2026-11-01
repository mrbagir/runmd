// Sidebar: note tree, per-note edit menu, connection list/form.
// All interactivity goes through data-action attributes (see main.js); no
// inline handlers, and every dynamic value is escaped.

import { bus, setSidebarCollapsed, state, toggleFolder } from './state.js';
import { createNote, deleteConnection, deleteNote, renameNote, saveConnection } from './notes.js';
import { showConfirmModal, showPromptModal, showToast } from './modal.js';
import { baseName, escapeHtml, normalizeNoteName } from './util.js';

const $ = (id) => document.getElementById(id);

const ICON_PLUS =
  '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>';
const ICON_PENCIL =
  '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
  '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>';

export function initSidebar() {
  applySidebarState();
  bus.on('notes-changed', renderNotes);
  bus.on('active-changed', renderNoteTree);
  bus.on('connections-changed', renderConnections);
}

// --- Collapse / expand ---

function applySidebarState() {
  $('sidebar').classList.toggle('hidden', state.sidebarCollapsed);
  $('btnOpenSidebar').classList.toggle('hidden', !state.sidebarCollapsed);
}

export function toggleSidebar() {
  setSidebarCollapsed(!state.sidebarCollapsed);
  applySidebarState();
}

// --- Note tree ---

function renderNotes() {
  $('noteCount').textContent = state.notes.length;
  renderNoteTree();
}

/** Flat note list -> nested { folders: {name: node}, files: [note] }. */
function buildNoteTree(notes) {
  const root = { name: '', path: '', folders: {}, files: [] };
  for (const note of notes) {
    const parts = note.name.split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      current.folders[part] ??= {
        name: part,
        path: parts.slice(0, i + 1).join('/'),
        folders: {},
        files: [],
      };
      current = current.folders[part];
    }
    current.files.push(note);
  }
  return root;
}

function countNotes(node) {
  return node.files.length + Object.values(node.folders).reduce((n, sub) => n + countNotes(sub), 0);
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

export function renderNoteTree() {
  const el = $('noteList');
  el.innerHTML = '';
  appendNodeChildren(buildNoteTree(state.notes), el);
}

function appendNodeChildren(node, container) {
  for (const key of Object.keys(node.folders).sort()) {
    container.appendChild(createFolderElement(node.folders[key]));
  }
  for (const note of node.files.sort(byName)) {
    container.appendChild(createNoteElement(note));
  }
}

function createFolderElement(node) {
  const isExpanded = state.expandedFolders?.has(node.path) ?? false;
  const path = escapeHtml(node.path);

  const wrapper = document.createElement('div');
  wrapper.className = 'space-y-0.5';

  const row = document.createElement('div');
  row.className =
    'group flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#15151a] cursor-pointer text-[#8e8e99] hover:text-[#dcdce5] transition';
  row.innerHTML = `
    <div class="flex items-center space-x-1.5 truncate flex-1" data-action="toggle-folder" data-path="${path}">
      <span class="text-[10px] w-3 text-center text-[#60606e]">${isExpanded ? '▼' : '▶'}</span>
      <svg class="w-3.5 h-3.5 text-[#7c6cf0] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="truncate font-medium text-xs">${escapeHtml(node.name)}</span>
      <span class="text-[10px] text-[#555562]">(${countNotes(node)})</span>
    </div>
    <button data-action="new-note-in-folder" data-path="${path}" title="New Note in ${path}" class="opacity-0 group-hover:opacity-100 text-[#8e8e99] hover:text-[#ededf0] p-0.5 rounded hover:bg-[#1f1f26] transition">
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICON_PLUS}</svg>
    </button>
  `;
  wrapper.appendChild(row);

  if (isExpanded) {
    const children = document.createElement('div');
    children.className = 'pl-3.5 space-y-0.5 border-l border-[#1c1c24] ml-3';
    appendNodeChildren(node, children);
    wrapper.appendChild(children);
  }
  return wrapper;
}

function createNoteElement(note) {
  const isActive = state.activeNote?.name === note.name;
  const name = escapeHtml(note.name);

  const item = document.createElement('div');
  item.className = `group flex items-center justify-between rounded px-2 py-1.5 transition text-xs ${
    isActive
      ? 'bg-[#1e1e26] text-[#ededf0] font-medium'
      : 'text-[#9c9ca8] hover:bg-[#15151a] hover:text-[#dcdce5]'
  }`;
  item.innerHTML = `
    <button data-action="select-note" data-name="${name}" class="truncate flex-1 text-left flex items-center gap-1.5">
      <svg class="w-3 h-3 text-[#555562] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      </svg>
      <span class="truncate">${escapeHtml(baseName(note.name))}.md</span>
    </button>
    <button data-action="open-note-menu" data-name="${name}" title="Edit note" class="edit-note-btn opacity-0 group-hover:opacity-100 text-[#737380] hover:text-[#ededf0] p-1 rounded hover:bg-[#22222a] transition flex items-center justify-center">
      <svg class="w-3.5 h-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICON_PENCIL}</svg>
    </button>
  `;
  return item;
}

export function onToggleFolder(path) {
  toggleFolder(path);
  renderNoteTree();
}

// --- Note creation / rename / delete ---

export async function promptNewNote() {
  const name = await showPromptModal({
    title: 'New Note',
    message: 'Masukkan nama file note (misal: runbook atau folder/runbook):',
    defaultValue: 'new-runbook',
    placeholder: 'contoh: operations/payment-service',
    confirmText: 'Buat Note',
  });
  if (name) await createNote(name);
}

export async function promptNewNoteInFolder(folder) {
  const name = await showPromptModal({
    title: `New Note in '${folder}/'`,
    message: `Masukkan nama note di dalam folder '${folder}/':`,
    defaultValue: 'new-runbook',
    placeholder: 'nama-file',
    confirmText: 'Buat Note',
  });
  if (name) await createNote(`${folder}/${name}`);
}

export async function promptRenameNote(oldName) {
  closeNoteMenu();
  const newName = await showPromptModal({
    title: 'Rename Note',
    message: `Ubah nama atau path untuk note '${oldName}.md':`,
    defaultValue: oldName,
    placeholder: oldName,
    confirmText: 'Ganti Nama',
  });
  if (newName) await renameNote(oldName, normalizeNoteName(newName));
}

export async function confirmDeleteNote(name) {
  closeNoteMenu();
  const ok = await showConfirmModal({
    title: 'Hapus Note',
    message: `Hapus note '${name}.md' dari vault secara permanen?`,
    confirmText: 'Hapus Note',
    danger: true,
  });
  if (ok) await deleteNote(name);
}

// --- Per-note edit menu ---

let activeMenu = null;

export function closeNoteMenu() {
  activeMenu?.remove();
  activeMenu = null;
}

/** Close the menu when the click lands outside it. Call before dispatching actions. */
export function closeNoteMenuOnOutsideClick(target) {
  if (activeMenu && !target.closest('.edit-note-menu') && !target.closest('.edit-note-btn')) {
    closeNoteMenu();
  }
}

export function openNoteMenu(name, button) {
  closeNoteMenu();

  const rect = button.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className =
    'edit-note-menu fixed z-50 bg-[#141419] border border-[#262633] rounded-md shadow-2xl py-1 text-xs w-36 text-[#c9c9d4] select-none';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(10, Math.min(rect.right - 144, window.innerWidth - 154))}px`;

  const safe = escapeHtml(name);
  menu.innerHTML = `
    <button data-action="rename-note" data-name="${safe}" class="w-full text-left px-3 py-1.5 hover:bg-[#20202b] hover:text-[#ededf0] flex items-center gap-2 transition cursor-pointer">
      <svg class="w-3.5 h-3.5 text-[#8e8e99]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICON_PENCIL}</svg>
      <span>Rename note</span>
    </button>
    <div class="h-px bg-[#202028] my-1"></div>
    <button data-action="delete-note" data-name="${safe}" class="w-full text-left px-3 py-1.5 hover:bg-[#2b181e] text-[#f43f5e] hover:text-[#fb7185] flex items-center gap-2 transition cursor-pointer">
      <svg class="w-3.5 h-3.5 text-[#f43f5e]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      <span>Delete note</span>
    </button>
  `;
  document.body.appendChild(menu);
  activeMenu = menu;
}

// --- Connections ---

function renderConnections() {
  const el = $('connList');
  const list = Object.values(state.connections);
  if (list.length === 0) {
    el.innerHTML =
      '<div class="text-[#555560] italic text-[11px] px-2 py-1">No connections configured</div>';
    return;
  }
  el.innerHTML = list
    .map(
      (c) => `
      <div class="group flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#16161b] transition">
        <div class="flex items-center space-x-1.5 truncate">
          <span class="font-mono text-xs text-[#b8abfa]">${escapeHtml(c.alias)}</span>
          <span class="text-[9px] uppercase px-1 rounded bg-[#1c1c24] text-[#8e8e99] border border-[#262630]">${escapeHtml(c.type ?? '')}</span>
        </div>
        <button data-action="delete-connection" data-alias="${escapeHtml(c.alias)}" title="Delete connection" class="opacity-0 group-hover:opacity-100 text-[#60606b] hover:text-[#f43f5e] text-xs px-1 transition">✕</button>
      </div>`,
    )
    .join('');
}

export function toggleConnectionForm() {
  $('connForm').classList.toggle('hidden');
}

export async function submitConnectionForm() {
  let alias = $('cAlias').value.trim();
  const type = $('cType').value;
  const uri = $('cURI').value.trim();
  if (alias.startsWith('@')) alias = alias.slice(1).trim();

  if (!alias || !uri) {
    showToast('Alias dan DSN/URI koneksi wajib diisi', 'error');
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
    showToast('Alias hanya boleh berisi huruf, angka, underscore, dan dash (tanpa spasi)', 'error');
    return;
  }

  if (await saveConnection({ alias, type, uri })) {
    $('cAlias').value = '';
    $('cURI').value = '';
    toggleConnectionForm();
    showToast(`Koneksi '@${alias}' berhasil disimpan`, 'success');
  }
}

export async function confirmDeleteConnection(alias) {
  const ok = await showConfirmModal({
    title: 'Hapus Koneksi',
    message: `Hapus alias koneksi '@${alias}' dari sidebar?`,
    confirmText: 'Hapus',
    danger: true,
  });
  if (ok) await deleteConnection(alias);
}
