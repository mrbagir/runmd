// Notebook view: the active note rendered as a flow of editable Markdown
// blocks and executable code cells.

/* global marked, DOMPurify */

import { api } from './api.js';
import {
  buildFence,
  insertSegment,
  removeSegment,
  renderWikilinks,
  replaceSegment,
  splitSegments,
} from './markdown.js';
import { saveNoteContent } from './notes.js';
import { bus, state } from './state.js';
import { baseName, escapeHtml } from './util.js';

const $ = (id) => document.getElementById(id);
const APP_TITLE = 'RunMD — Executable Markdown';

export function initNotebook() {
  configureSanitizer();
  bus.on('active-changed', renderActiveNote);
  bus.on('content-saved', ({ note }) => {
    if (note === state.activeNote) renderFlowDocument(note);
  });
}

// Markdown comes from user-editable (and possibly third-party) files and is
// rendered into the same origin that can run code, so it MUST be sanitized.
function configureSanitizer() {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

function renderActiveNote() {
  const note = state.activeNote;
  if (!note) {
    $('activeNoteTitle').textContent = '';
    $('documentFlow').innerHTML = '';
    document.title = APP_TITLE;
    return;
  }
  $('activeNoteTitle').textContent = `${note.name}.md`;
  document.title = `${baseName(note.name)}.md - RunMD`;
  renderFlowDocument(note);
}

// --- Document flow ---

export function renderFlowDocument(note) {
  const container = $('documentFlow');
  container.innerHTML = '';

  const segments = splitSegments(note?.content ?? '');
  if (segments.length === 0) {
    container.innerHTML = `
      <div class="text-[#666675] text-sm italic py-12 text-center">
        Empty note. Click "View Source" or add a block below.
      </div>
    `;
    container.appendChild(createInsertDivider(0));
    return;
  }

  segments.forEach((seg, i) => {
    container.appendChild(createInsertDivider(i));
    container.appendChild(seg.type === 'code' ? createCodeCell(seg) : createMarkdownBlock(seg));
  });
  container.appendChild(createInsertDivider(segments.length));
}

function createInsertDivider(index) {
  const div = document.createElement('div');
  div.className = 'insert-divider';
  div.innerHTML = `
    <div class="insert-divider-line"></div>
    <div class="insert-actions">
      <button data-action="insert-block" data-index="${index}" data-type="code" class="insert-btn" title="Add executable code block">
        <span class="text-[#10b981] font-bold">+</span> Code
      </button>
      <button data-action="insert-block" data-index="${index}" data-type="text" class="insert-btn" title="Add text/markdown section">
        <span class="text-[#7c6cf0] font-bold">+</span> Text
      </button>
    </div>
  `;
  return div;
}

// --- Structural edits ---

async function updateContent(transform) {
  if (!state.activeNote) return;
  await saveNoteContent(transform(state.activeNote.content ?? ''));
}

export function insertBlock(index, type) {
  const raw = type === 'code' ? '```sh\necho "Hello world"\n```' : 'New section description...';
  return updateContent((content) => insertSegment(content, index, raw));
}

export async function deleteBlock(index) {
  if (!state.activeNote) return;
  const target = splitSegments(state.activeNote.content ?? '')[index];
  if (!target) return;

  const what = target.type === 'code' ? `blok kode (${target.lang})` : 'blok teks';
  if (!confirm(`Hapus ${what} ini?`)) return;
  await updateContent((content) => removeSegment(content, index));
}

function updateSegment(index, newText) {
  return updateContent((content) => replaceSegment(content, index, newText));
}

// --- Markdown block (double-click to edit in place) ---

function createMarkdownBlock(seg) {
  const markdown = seg.content.trim();

  const block = document.createElement('div');
  block.className = 'group relative py-0.5 px-2 rounded hover:bg-[#18181c]/50 transition';
  block.dataset.segmentIndex = seg.segmentIndex;

  const preview = document.createElement('div');
  preview.className = 'md-preview cursor-text';
  preview.title = 'Double click to edit text';
  preview.innerHTML = DOMPurify.sanitize(marked.parse(renderWikilinks(markdown)));

  const actions = document.createElement('div');
  actions.className =
    'absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition flex items-center bg-[#141418] px-1.5 py-0.5 rounded border border-[#262630] text-xs shadow-sm z-10';
  actions.innerHTML = `<button data-action="delete-block" data-index="${seg.segmentIndex}" class="text-[11px] text-[#60606b] hover:text-[#f43f5e] px-1" title="Delete text block">✕</button>`;

  const editor = document.createElement('div');
  editor.className = 'hidden my-1 bg-[#111114] border border-[#2c2c36] rounded p-2';
  editor.innerHTML = `<textarea class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-none overflow-hidden m-0 p-0 block" placeholder="Type markdown here..."></textarea>`;
  const textarea = editor.querySelector('textarea');
  textarea.value = markdown;

  const autoResize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(28, textarea.scrollHeight)}px`;
  };
  textarea.addEventListener('input', autoResize);

  let saving = false;
  const onOutsidePointer = (e) => {
    if (!block.contains(e.target)) finishEdit();
  };

  async function finishEdit() {
    if (editor.classList.contains('hidden') || saving) return;
    saving = true;
    document.removeEventListener('pointerdown', onOutsidePointer);

    const updated = textarea.value.trim();
    editor.classList.add('hidden');
    preview.classList.remove('hidden');
    actions.classList.remove('hidden');

    if (updated !== markdown) await updateSegment(seg.segmentIndex, updated);
    saving = false;
  }

  preview.addEventListener('dblclick', () => {
    preview.classList.add('hidden');
    actions.classList.add('hidden');
    editor.classList.remove('hidden');
    textarea.focus();
    autoResize();
    document.addEventListener('pointerdown', onOutsidePointer);
  });
  textarea.addEventListener('blur', finishEdit);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') textarea.blur();
  });

  block.append(actions, preview, editor);
  return block;
}

// --- Code cell ---

function createCodeCell(seg) {
  const code = seg.code.trim();

  const card = document.createElement('div');
  card.className =
    'rounded-lg border border-[#222228] bg-[#161619] overflow-hidden my-2 shadow-sm transition hover:border-[#2d2d38]';
  card.dataset.cell = seg.cellIndex;
  card.id = `code-cell-${seg.cellIndex}`;

  const connBadge = seg.conn
    ? `<span class="text-[10px] font-mono text-[#b8abfa] bg-[#221e3f] border border-[#332b6b] px-1.5 py-0.5 rounded">@conn=${escapeHtml(seg.conn)}</span>`
    : '';
  const assertBadge = seg.assert
    ? `<span class="text-[10px] font-mono text-[#a1a1aa] bg-[#1d1d24] border border-[#2c2c36] px-1.5 py-0.5 rounded">@assert="${escapeHtml(seg.assert)}"</span>`
    : '';

  card.innerHTML = `
    <div class="bg-[#111114] px-3.5 py-2 border-b border-[#202026] flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2">
        <span class="text-[11px] font-mono font-bold uppercase text-[#8e8e99] tracking-wider">${escapeHtml(seg.lang)}</span>
        ${connBadge}
        ${assertBadge}
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-[10px] text-[#555562] font-mono">Cmd+Enter</span>
        <button data-action="run-cell" class="flex items-center gap-1.5 bg-[#1e1e28] hover:bg-[#2b2659] text-[#d6d0ff] hover:text-[#ffffff] px-2.5 py-1 rounded text-xs font-medium transition shadow-sm border border-[#2c2c3a]">
          <svg class="w-3 h-3 text-[#10b981]" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>Run</span>
        </button>
        <button data-action="delete-block" data-index="${seg.segmentIndex}" title="Delete code block" class="text-[#60606b] hover:text-[#f43f5e] hover:bg-[#201a1e] px-1.5 py-1 rounded transition text-xs font-bold">
          ✕
        </button>
      </div>
    </div>

    <div class="p-3 bg-[#131316]">
      <textarea data-role="code" class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-none font-normal" rows="${Math.max(1, code.split('\n').length)}"></textarea>
    </div>

    <div data-role="drawer" class="hidden border-t border-[#222228] bg-[#0c0c0e]">
      <div class="px-3.5 py-1.5 border-b border-[#1b1b20] flex items-center justify-between text-xs bg-[#111114]">
        <div data-role="status" class="flex items-center space-x-2"></div>
        <div class="flex items-center space-x-2">
          <button data-action="toggle-drawer" data-role="toggle" class="text-[11px] text-[#8e8e99] hover:text-[#dcdce5] px-1.5 py-0.5 rounded hover:bg-[#1a1a22] transition">
            Collapse ▲
          </button>
          <button data-action="clear-output" title="Clear output" class="text-[11px] text-[#60606b] hover:text-[#f43f5e] px-1 rounded hover:bg-[#1a1a22] transition">✕</button>
        </div>
      </div>
      <div data-role="body" class="p-3.5 overflow-x-auto max-h-72 text-xs code-font text-[#c9c9d4] whitespace-pre-wrap leading-relaxed select-text"></div>
    </div>
  `;

  const textarea = card.querySelector('[data-role="code"]');
  textarea.value = code;

  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runCell(card);
    }
  });
  textarea.addEventListener('input', () => {
    textarea.rows = Math.max(1, textarea.value.split('\n').length);
  });
  textarea.addEventListener('change', async () => {
    const updated = buildFence(seg.lang, seg.metaStr, textarea.value);
    if (updated !== seg.raw) await updateSegment(seg.segmentIndex, updated);
  });

  return card;
}

// --- Running cells & the output drawer ---

const part = (card, role) => card.querySelector(`[data-role="${role}"]`);

export async function runCell(card) {
  if (!state.activeNote) return;

  const index = Number(card.dataset.cell);
  const seg = splitSegments(state.activeNote.content ?? '').filter((s) => s.type === 'code')[index];
  if (!seg) return;

  const drawer = part(card, 'drawer');
  const status = part(card, 'status');
  const body = part(card, 'body');

  drawer.classList.remove('hidden');
  body.classList.remove('hidden');
  part(card, 'toggle').textContent = 'Collapse ▲';
  status.innerHTML = '<span class="text-[#8e8e99] animate-pulse">Running...</span>';
  body.innerHTML = '<span class="text-[#555562]">Executing...</span>';

  try {
    const data = await api.run({
      lang: seg.lang,
      conn: seg.conn,
      assert: seg.assert,
      meta: seg.meta,
      code: part(card, 'code').value,
    });

    const passed = data.success && data.assert_pass;
    const ms = `<span class="text-[#60606b] font-normal text-[10px]">(${escapeHtml(data.duration_ms)}ms)</span>`;
    const badge = passed
      ? `<span class="text-[#10b981] font-semibold flex items-center gap-1"><span>✔ PASS</span> ${ms}</span>`
      : `<span class="text-[#f43f5e] font-semibold flex items-center gap-1"><span>✖ FAIL</span> ${ms}</span>`;
    const message = data.assert_msg
      ? `<span class="text-[11px] text-[#8e8e99] truncate max-w-sm" title="${escapeHtml(data.assert_msg)}">${escapeHtml(data.assert_msg)}</span>`
      : '';

    status.innerHTML = `${badge} <span class="text-[#33333d]">|</span> ${message}`;
    body.textContent = data.output || data.error || '(Process completed with no output)';
  } catch (err) {
    status.innerHTML = '<span class="text-[#f43f5e] font-semibold">Error</span>';
    body.innerHTML = `<span class="text-[#f43f5e]">${escapeHtml(err.message)}</span>`;
  }
}

export function toggleDrawer(card) {
  const body = part(card, 'body');
  const collapsed = body.classList.toggle('hidden');
  part(card, 'toggle').textContent = collapsed ? 'Expand ▼' : 'Collapse ▲';
}

export function clearOutput(card) {
  part(card, 'drawer').classList.add('hidden');
}
