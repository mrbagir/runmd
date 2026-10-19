let notes = [];
let connections = {};
let activeNote = null;
let isRawMode = false;
let cellOutputs = {}; // Cache cell outputs { [cellIdx]: result }
let expandedFolders = new Set(['examples']); // Default expanded folders

async function init() {
  initResizer();
  await Promise.all([loadConnections(), loadNotes()]);
  if (notes.length > 0) {
    selectNote(notes[0].name);
  }
}

// --- CONNECTIONS ---
async function loadConnections() {
  try {
    const res = await fetch('/api/connections');
    connections = await res.json();
    renderConnections();
  } catch (e) {
    console.error('Failed to load connections', e);
  }
}

function renderConnections() {
  const el = document.getElementById('connList');
  el.innerHTML = '';
  const list = Object.values(connections);
  if (list.length === 0) {
    el.innerHTML = '<div class="text-[#555560] italic text-[11px] px-2 py-1">No connections configured</div>';
    return;
  }
  list.forEach(c => {
    // Point 4: Remove '@' from alias display
    el.innerHTML += `
      <div class="group flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#16161b] transition">
        <div class="flex items-center space-x-1.5 truncate">
          <span class="font-mono text-xs text-[#b8abfa]">${escapeHtml(c.alias)}</span>
          <span class="text-[9px] uppercase px-1 rounded bg-[#1c1c24] text-[#8e8e99] border border-[#262630]">${c.type}</span>
        </div>
        <button onclick="deleteConnection('${c.alias}')" title="Delete connection" class="opacity-0 group-hover:opacity-100 text-[#60606b] hover:text-[#f43f5e] text-xs px-1 transition">✕</button>
      </div>
    `;
  });
}

function toggleConnForm() {
  document.getElementById('connForm').classList.toggle('hidden');
}

async function saveConnection() {
  const alias = document.getElementById('cAlias').value.trim();
  const type = document.getElementById('cType').value;
  const uri = document.getElementById('cURI').value.trim();
  if (!alias || !uri) return;
  await fetch('/api/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias, type, uri })
  });
  document.getElementById('cAlias').value = '';
  document.getElementById('cURI').value = '';
  toggleConnForm();
  await loadConnections();
  if (activeNote) renderFlowDocument(activeNote);
}

async function deleteConnection(alias) {
  if (!confirm(`Remove connection alias '${alias}'?`)) return;
  await fetch(`/api/connections?alias=${encodeURIComponent(alias)}`, { method: 'DELETE' });
  await loadConnections();
  if (activeNote) renderFlowDocument(activeNote);
}

// --- NOTES MANAGEMENT & OBSIDIAN FOLDER TREE ---
async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    notes = await res.json();
    document.getElementById('noteCount').innerText = notes.length;
    renderNoteTree();
  } catch (e) {
    console.error('Failed to load notes', e);
  }
}

// Point 3: Render Expand/Collapse folder hierarchy
function renderNoteTree() {
  const el = document.getElementById('noteList');
  el.innerHTML = '';

  // Group notes into root files and folder buckets
  const rootNotes = [];
  const folderMap = {}; // { [folderName]: [note1, note2] }

  notes.forEach(n => {
    const parts = n.name.split('/');
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join('/');
      if (!folderMap[folder]) folderMap[folder] = [];
      folderMap[folder].push(n);
    } else {
      rootNotes.push(n);
    }
  });

  // Render Folders
  Object.keys(folderMap).sort().forEach(folderName => {
    const isExpanded = expandedFolders.has(folderName);
    const childNotes = folderMap[folderName];

    const folderContainer = document.createElement('div');
    folderContainer.className = 'space-y-0.5';

    // Folder Row Header
    const folderRow = document.createElement('div');
    folderRow.className = 'group flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#15151a] cursor-pointer text-[#8e8e99] hover:text-[#dcdce5] transition';
    folderRow.innerHTML = `
      <div class="flex items-center space-x-1.5 truncate flex-1" onclick="toggleFolder('${folderName}')">
        <span class="text-[10px] w-3 text-center">${isExpanded ? '▼' : '▶'}</span>
        <svg class="w-3.5 h-3.5 text-[#7c6cf0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="truncate font-medium">${escapeHtml(folderName)}</span>
        <span class="text-[10px] text-[#555562]">(${childNotes.length})</span>
      </div>
      <button onclick="createNewNoteInFolder('${folderName}')" title="New Note in ${folderName}" class="opacity-0 group-hover:opacity-100 text-[#8e8e99] hover:text-[#ededf0] p-0.5 rounded hover:bg-[#1f1f26] transition">
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    `;
    folderContainer.appendChild(folderRow);

    // Child Files List
    if (isExpanded) {
      const childList = document.createElement('ul');
      childList.className = 'pl-4 space-y-0.5 border-l border-[#1c1c24] ml-3';
      childNotes.forEach(n => {
        childList.appendChild(createNoteListItem(n));
      });
      folderContainer.appendChild(childList);
    }

    el.appendChild(folderContainer);
  });

  // Render Root Notes
  rootNotes.forEach(n => {
    el.appendChild(createNoteListItem(n));
  });
}

function createNoteListItem(n) {
  const li = document.createElement('div');
  const isActive = activeNote && activeNote.name === n.name;
  const displayName = n.name.split('/').pop();

  li.className = `group flex items-center justify-between rounded px-2 py-1.5 transition ${
    isActive ? 'bg-[#1e1e26] text-[#ededf0] font-medium' : 'text-[#9c9ca8] hover:bg-[#15151a] hover:text-[#dcdce5]'
  }`;

  li.innerHTML = `
    <button onclick="selectNote('${n.name}')" class="truncate flex-1 text-left flex items-center gap-1.5">
      <svg class="w-3 h-3 text-[#555562]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      </svg>
      <span class="truncate">${escapeHtml(displayName)}.md</span>
    </button>
    <button onclick="deleteNote('${n.name}')" title="Delete note" class="opacity-0 group-hover:opacity-100 text-[#60606b] hover:text-[#f43f5e] text-xs px-1 transition">✕</button>
  `;
  return li;
}

function toggleFolder(folderName) {
  if (expandedFolders.has(folderName)) {
    expandedFolders.delete(folderName);
  } else {
    expandedFolders.add(folderName);
  }
  renderNoteTree();
}

function selectNote(name) {
  const cleanName = name.replace(/\.md$/, '').replace(/^\//, '');
  const found = notes.find(n => n.name === cleanName || n.name.endsWith('/' + cleanName) || cleanName.endsWith('/' + n.name));
  if (!found) return;
  activeNote = found;
  cellOutputs = {}; // Reset output cache on note switch
  document.getElementById('activeNoteTitle').innerText = `${found.name}.md`;
  renderNoteTree();
  renderFlowDocument(found);
  if (isRawMode) {
    document.getElementById('rawSourceTextarea').value = found.content;
  }
}

async function createNewNote() {
  const name = prompt('New note name (e.g. runbook or folder/runbook):', 'new-runbook');
  if (!name) return;
  await saveNewNoteWithName(name);
}

async function createNewNoteInFolder(folder) {
  const name = prompt(`New note name inside '${folder}/':`, 'new-runbook');
  if (!name) return;
  await saveNewNoteWithName(`${folder}/${name}`);
}

async function saveNewNoteWithName(name) {
  const cleanName = name.replace(/\.md$/, '').trim().replace(/^\//, '');
  if (!cleanName) return;

  const defaultContent = `# ${cleanName.split('/').pop()}\nDouble click this text to edit.\n\n` +
    "```sh @assert=\"contains:Hello\"\necho \"Hello from " + cleanName + "\"\n```\n";

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cleanName, content: defaultContent })
  });
  const created = await res.json();
  const folder = cleanName.split('/').slice(0, -1).join('/');
  if (folder) expandedFolders.add(folder);
  await loadNotes();
  selectNote(created.name);
}

async function deleteNote(name) {
  if (!confirm(`Delete note '${name}.md'?`)) return;
  await fetch(`/api/notes?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  await loadNotes();
  if (notes.length > 0) {
    selectNote(notes[0].name);
  } else {
    activeNote = null;
    document.getElementById('activeNoteTitle').innerText = '';
    document.getElementById('documentFlow').innerHTML = '';
  }
}

// --- HYBRID FLOW DOCUMENT WITH SEGMENTS & DELETE SUPPORT ---
function getDocumentSegments(content) {
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let segments = [];
  let match;
  let cellIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim().length > 0) {
      segments.push({
        type: 'markdown',
        content: textBefore,
        raw: textBefore,
        segmentIndex: segments.length
      });
    }
    segments.push({
      type: 'code',
      lang: match[1].toLowerCase().trim(),
      metaStr: match[2].trim(),
      code: match[3],
      cellIndex: cellIndex++,
      segmentIndex: segments.length,
      fullMatch: match[0],
      raw: match[0]
    });
    lastIndex = match.index + match[0].length;
  }
  const textAfter = content.substring(lastIndex);
  if (textAfter.trim().length > 0) {
    segments.push({
      type: 'markdown',
      content: textAfter,
      raw: textAfter,
      segmentIndex: segments.length
    });
  }
  return segments;
}

function renderFlowDocument(note) {
  const container = document.getElementById('documentFlow');
  container.innerHTML = '';

  const content = note.content || '';
  const segments = getDocumentSegments(content);

  if (segments.length === 0) {
    container.innerHTML = `
      <div class="text-[#666675] text-sm italic py-12 text-center">
        Empty note. Click "View Source" or add a block below.
      </div>
    `;
    // Add bottom insert block
    container.appendChild(createInsertDivider(0));
    return;
  }

  // Render segments with floating insert dividers in between
  segments.forEach((seg, i) => {
    // Top insert divider before block
    container.appendChild(createInsertDivider(i));

    if (seg.type === 'markdown') {
      container.appendChild(createMarkdownBlock(seg.content, seg.segmentIndex));
    } else if (seg.type === 'code') {
      container.appendChild(createCodeBlockElement(seg));
    }
  });

  // Bottom-most insert divider
  container.appendChild(createInsertDivider(segments.length));
}

// Floating '+' button divider between blocks
function createInsertDivider(insertIndex) {
  const div = document.createElement('div');
  div.className = 'insert-divider';
  div.innerHTML = `
    <div class="insert-divider-line"></div>
    <div class="insert-actions">
      <button onclick="insertBlock(${insertIndex}, 'code')" class="insert-btn" title="Add executable code block">
        <span class="text-[#10b981] font-bold">+</span> Code
      </button>
      <button onclick="insertBlock(${insertIndex}, 'text')" class="insert-btn" title="Add text/markdown section">
        <span class="text-[#7c6cf0] font-bold">+</span> Text
      </button>
    </div>
  `;
  return div;
}

// Inserts a new Code or Markdown block at the given segment position
async function insertBlock(insertIndex, type) {
  if (!activeNote) return;

  const segments = getDocumentSegments(activeNote.content || '');
  let newBlock = '';
  if (type === 'code') {
    newBlock = '```sh\necho "Hello world"\n```';
  } else {
    newBlock = 'New section description...';
  }

  segments.splice(insertIndex, 0, { raw: newBlock });
  activeNote.content = segments.map(s => s.raw.trim()).filter(Boolean).join('\n\n') + '\n';
  await saveActiveNoteContent();
  renderFlowDocument(activeNote);
}

// Deletes a specific block (either code or markdown text) by segment index
async function deleteBlock(segIndex) {
  if (!activeNote) return;

  const segments = getDocumentSegments(activeNote.content || '');
  if (segIndex < 0 || segIndex >= segments.length) return;

  const target = segments[segIndex];
  const desc = target.type === 'code' ? `blok kode (${target.lang})` : 'blok teks';
  if (!confirm(`Hapus ${desc} ini?`)) return;

  segments.splice(segIndex, 1);
  activeNote.content = segments.map(s => s.raw.trim()).filter(Boolean).join('\n\n') + '\n';
  await saveActiveNoteContent();
  renderFlowDocument(activeNote);
}

// Point 5: Support Obsidian links according to https://obsidian.md/id/help/links
// [[target]], [[target|custom display]], [[target#heading]], [[target#heading|custom display]]
function parseObsidianLinks(rawMd) {
  const obsidianLinkRegex = /\[\[([^\|\]#]+)(?:#[^\|\]]+)?(?:\|([^\]]+))?\]\]/g;
  return rawMd.replace(obsidianLinkRegex, (match, target, alias) => {
    const cleanTarget = target.trim().replace(/\.md$/, '');
    const displayText = alias ? alias.trim() : cleanTarget.split('/').pop();
    return `<a href="javascript:void(0)" onclick="selectNote('${cleanTarget}')" class="wikilink" title="${cleanTarget}">${escapeHtml(displayText)}</a>`;
  });
}

// Creates an Obsidian-style rendered Markdown block with double-click inline editing and delete button
function createMarkdownBlock(rawMd, segIdx) {
  const block = document.createElement('div');
  block.className = 'group relative py-0.5 px-2 rounded hover:bg-[#18181c]/50 transition';
  block.setAttribute('data-segment-index', segIdx);

  const trimmedMd = rawMd.trim();
  const processed = parseObsidianLinks(trimmedMd);
  const htmlContent = marked.parse(processed);

  // Preview view
  const previewDiv = document.createElement('div');
  previewDiv.className = 'md-preview cursor-text';
  previewDiv.innerHTML = htmlContent;
  previewDiv.title = 'Double click to edit text';

  // Hover Action Buttons (Delete only, Edit button removed)
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'absolute top-1 right-2 opacity-0 group-hover:opacity-100 transition flex items-center bg-[#141418] px-1.5 py-0.5 rounded border border-[#262630] text-xs shadow-sm z-10';
  actionsDiv.innerHTML = `
    <button onclick="deleteBlock(${segIdx})" class="text-[11px] text-[#60606b] hover:text-[#f43f5e] px-1" title="Delete text block">✕</button>
  `;

  // Inline editor without footer, compact and auto-resizing
  const editorDiv = document.createElement('div');
  editorDiv.className = 'hidden my-1 bg-[#111114] border border-[#2c2c36] rounded p-2';
  editorDiv.innerHTML = `
    <textarea class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-none overflow-hidden m-0 p-0 block" placeholder="Type markdown here...">${escapeHtml(trimmedMd)}</textarea>
  `;

  const ta = editorDiv.querySelector('textarea');

  const autoResize = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(28, ta.scrollHeight)}px`;
  };

  ta.addEventListener('input', autoResize);

  let isSaving = false;
  let outsideClickListener = null;

  const finishEdit = async () => {
    if (editorDiv.classList.contains('hidden') || isSaving) return;
    isSaving = true;
    if (outsideClickListener) {
      document.removeEventListener('pointerdown', outsideClickListener);
      outsideClickListener = null;
    }

    const updatedVal = ta.value.trim();
    editorDiv.classList.add('hidden');
    previewDiv.classList.remove('hidden');
    actionsDiv.classList.remove('hidden');

    if (updatedVal !== trimmedMd) {
      await updateSegmentByIndex(segIdx, updatedVal);
    }
    isSaving = false;
  };

  outsideClickListener = (e) => {
    if (!block.contains(e.target)) {
      finishEdit();
    }
  };

  previewDiv.addEventListener('dblclick', () => {
    previewDiv.classList.add('hidden');
    actionsDiv.classList.add('hidden');
    editorDiv.classList.remove('hidden');
    ta.focus();
    autoResize();
    document.addEventListener('pointerdown', outsideClickListener);
  });

  ta.addEventListener('blur', async () => {
    await finishEdit();
  });

  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ta.blur();
    }
  });

  block.appendChild(actionsDiv);
  block.appendChild(previewDiv);
  block.appendChild(editorDiv);
  return block;
}

// Creates an Executable Fenced Code Block with embedded Run button and collapsible output drawer
function createCodeBlockElement(seg) {
  const connMatch = seg.metaStr.match(/@conn=([^\s]+)/) || seg.metaStr.match(/@([a-zA-Z0-9_-]+)/);
  const assertMatch = seg.metaStr.match(/@assert=("([^"]*)"|([^\s]+))/);
  const conn = connMatch ? (connMatch[1] || connMatch[0].replace(/^@/, '')) : '';
  const assertRule = assertMatch ? (assertMatch[2] || assertMatch[3]) : '';

  const card = document.createElement('div');
  card.className = 'rounded-lg border border-[#222228] bg-[#161619] overflow-hidden my-2 shadow-sm transition hover:border-[#2d2d38]';
  card.id = `code-cell-${seg.cellIndex}`;

  const connBadge = conn ?
    `<span class="text-[10px] font-mono text-[#b8abfa] bg-[#221e3f] border border-[#332b6b] px-1.5 py-0.5 rounded">@conn=${conn}</span>` : '';
  const assertBadge = assertRule ?
    `<span class="text-[10px] font-mono text-[#a1a1aa] bg-[#1d1d24] border border-[#2c2c36] px-1.5 py-0.5 rounded">@assert="${assertRule}"</span>` : '';

  card.innerHTML = `
    <!-- Cell Header -->
    <div class="bg-[#111114] px-3.5 py-2 border-b border-[#202026] flex items-center justify-between text-xs">
      <div class="flex items-center space-x-2">
        <span class="text-[11px] font-mono font-bold uppercase text-[#8e8e99] tracking-wider">${seg.lang}</span>
        ${connBadge}
        ${assertBadge}
      </div>
      <div class="flex items-center space-x-2">
        <span class="text-[10px] text-[#555562] font-mono">Cmd+Enter</span>
        <button onclick="runCell(${seg.cellIndex})" class="flex items-center gap-1.5 bg-[#1e1e28] hover:bg-[#2b2659] text-[#d6d0ff] hover:text-[#ffffff] px-2.5 py-1 rounded text-xs font-medium transition shadow-sm border border-[#2c2c3a]">
          <svg class="w-3 h-3 text-[#10b981]" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <span>Run</span>
        </button>
        <button onclick="deleteBlock(${seg.segmentIndex})" title="Delete code block" class="text-[#60606b] hover:text-[#f43f5e] hover:bg-[#201a1e] px-1.5 py-1 rounded transition text-xs font-bold">
          ✕
        </button>
      </div>
    </div>

    <!-- Code Content -->
    <div class="p-3 bg-[#131316]">
      <textarea id="cell-code-${seg.cellIndex}" class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-none font-normal" rows="${Math.max(1, seg.code.trim().split('\n').length)}">${escapeHtml(seg.code.trim())}</textarea>
    </div>

    <!-- Floating Collapsible Output Drawer -->
    <div id="cell-drawer-${seg.cellIndex}" class="hidden border-t border-[#222228] bg-[#0c0c0e]">
      <div class="px-3.5 py-1.5 border-b border-[#1b1b20] flex items-center justify-between text-xs bg-[#111114]">
        <div id="cell-status-${seg.cellIndex}" class="flex items-center space-x-2"></div>
        <div class="flex items-center space-x-2">
          <button onclick="toggleDrawer(${seg.cellIndex})" id="btn-toggle-drawer-${seg.cellIndex}" class="text-[11px] text-[#8e8e99] hover:text-[#dcdce5] px-1.5 py-0.5 rounded hover:bg-[#1a1a22] transition">
            Collapse ▲
          </button>
          <button onclick="clearOutput(${seg.cellIndex})" title="Clear output" class="text-[11px] text-[#60606b] hover:text-[#f43f5e] px-1 rounded hover:bg-[#1a1a22] transition">✕</button>
        </div>
      </div>
      <div id="cell-body-${seg.cellIndex}" class="p-3.5 overflow-x-auto max-h-72 text-xs code-font text-[#c9c9d4] whitespace-pre-wrap leading-relaxed select-text"></div>
    </div>
  `;

  const ta = card.querySelector(`#cell-code-${seg.cellIndex}`);
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runCell(seg.cellIndex);
    }
  });

  ta.addEventListener('input', () => {
    ta.rows = Math.max(1, ta.value.split('\n').length);
  });

  ta.addEventListener('change', async () => {
    const newCode = ta.value;
    const newFullMatch = "```" + seg.lang + (seg.metaStr ? " " + seg.metaStr : "") + "\n" + newCode + "\n```";
    if (newFullMatch !== seg.raw) {
      await updateSegmentByIndex(seg.segmentIndex, newFullMatch);
    }
  });

  return card;
}

// --- CELL EXECUTION & COLLAPSIBLE DRAWER ---
async function runCell(idx) {
  if (!activeNote) return;

  const codeEl = document.getElementById(`cell-code-${idx}`);
  const drawer = document.getElementById(`cell-drawer-${idx}`);
  const statusEl = document.getElementById(`cell-status-${idx}`);
  const bodyEl = document.getElementById(`cell-body-${idx}`);
  const toggleBtn = document.getElementById(`btn-toggle-drawer-${idx}`);

  drawer.classList.remove('hidden');
  bodyEl.classList.remove('hidden');
  toggleBtn.innerText = 'Collapse ▲';
  statusEl.innerHTML = `<span class="text-[#8e8e99] animate-pulse">Running...</span>`;
  bodyEl.innerHTML = `<span class="text-[#555562]">Executing...</span>`;

  const parsedNote = parseMarkdownBlocks(activeNote.content);
  const blk = parsedNote.code_blocks[idx];
  if (!blk) return;

  const codeToRun = codeEl ? codeEl.value : blk.code;

  const payload = {
    lang: blk.lang,
    conn: blk.conn,
    assert: blk.assert,
    meta: blk.meta,
    code: codeToRun
  };

  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    cellOutputs[idx] = data;

    const isPass = data.success && data.assert_pass;
    const statusBadge = isPass ?
      `<span class="text-[#10b981] font-semibold flex items-center gap-1"><span>✔ PASS</span> <span class="text-[#60606b] font-normal text-[10px]">(${data.duration_ms}ms)</span></span>` :
      `<span class="text-[#f43f5e] font-semibold flex items-center gap-1"><span>✖ FAIL</span> <span class="text-[#60606b] font-normal text-[10px]">(${data.duration_ms}ms)</span></span>`;

    const assertText = data.assert_msg ?
      `<span class="text-[11px] text-[#8e8e99] truncate max-w-sm" title="${escapeHtml(data.assert_msg)}">${escapeHtml(data.assert_msg)}</span>` : '';

    statusEl.innerHTML = `${statusBadge} <span class="text-[#33333d]">|</span> ${assertText}`;
    const outputText = data.output || data.error || '(Process completed with no output)';
    bodyEl.innerHTML = escapeHtml(outputText);

  } catch (err) {
    statusEl.innerHTML = `<span class="text-[#f43f5e] font-semibold">Error</span>`;
    bodyEl.innerHTML = `<span class="text-[#f43f5e]">${escapeHtml(err.message)}</span>`;
  }
}

function toggleDrawer(idx) {
  const bodyEl = document.getElementById(`cell-body-${idx}`);
  const btn = document.getElementById(`btn-toggle-drawer-${idx}`);
  if (bodyEl.classList.contains('hidden')) {
    bodyEl.classList.remove('hidden');
    btn.innerText = 'Collapse ▲';
  } else {
    bodyEl.classList.add('hidden');
    btn.innerText = 'Expand ▼';
  }
}

function clearOutput(idx) {
  const drawer = document.getElementById(`cell-drawer-${idx}`);
  drawer.classList.add('hidden');
  delete cellOutputs[idx];
}

// --- UPDATING SEGMENTS ON EDIT ---
async function updateSegmentByIndex(segIndex, newText) {
  if (!activeNote) return;
  const segments = getDocumentSegments(activeNote.content || '');
  if (segIndex < 0 || segIndex >= segments.length) return;

  if (newText.trim().length === 0) {
    segments.splice(segIndex, 1);
  } else {
    segments[segIndex].raw = newText.trim();
  }
  activeNote.content = segments.map(s => s.raw.trim()).filter(Boolean).join('\n\n') + '\n';
  await saveActiveNoteContent();
  renderFlowDocument(activeNote);
}

async function updateSegmentContent(oldText, newText) {
  if (!activeNote || oldText === newText) {
    renderFlowDocument(activeNote);
    return;
  }
  activeNote.content = activeNote.content.replace(oldText, newText);
  await saveActiveNoteContent();
  renderFlowDocument(activeNote);
}

async function saveActiveNoteContent() {
  if (!activeNote) return;
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: activeNote.name, content: activeNote.content })
  });
  activeNote = await res.json();
  if (isRawMode) {
    const rawTa = document.getElementById('rawSourceTextarea');
    if (rawTa && document.activeElement !== rawTa) {
      rawTa.value = activeNote.content;
    }
  }
}

// --- RESIZABLE SPLIT PANEL & AUTO-SYNC VIEW SOURCE ---
function initResizer() {
  const resizer = document.getElementById('rawResizer');
  const panel = document.getElementById('rawEditorPanel');
  if (!resizer || !panel) return;

  let isResizing = false;

  resizer.addEventListener('mousedown', e => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    const minW = 200;
    const maxW = window.innerWidth * 0.8;
    if (newWidth >= minW && newWidth <= maxW) {
      panel.style.width = `${newWidth}px`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function toggleRawSource() {
  const panel = document.getElementById('rawEditorPanel');
  const resizer = document.getElementById('rawResizer');
  const textarea = document.getElementById('rawSourceTextarea');
  const btn = document.getElementById('btnRawToggle');

  isRawMode = !isRawMode;
  if (isRawMode) {
    panel.classList.remove('hidden');
    if (resizer) resizer.classList.remove('hidden');
    textarea.value = activeNote ? activeNote.content : '';
    btn.innerText = 'Hide Source';
    textarea.focus();
  } else {
    panel.classList.add('hidden');
    if (resizer) resizer.classList.add('hidden');
    btn.innerText = 'View Source';
  }
}

let rawSyncTimer = null;
function onRawInput() {
  if (!activeNote) return;
  const statusEl = document.getElementById('rawSyncStatus');
  if (statusEl) statusEl.innerText = 'syncing...';

  clearTimeout(rawSyncTimer);
  rawSyncTimer = setTimeout(async () => {
    if (!activeNote) return;
    activeNote.content = document.getElementById('rawSourceTextarea').value;
    await saveActiveNoteContent();
    renderFlowDocument(activeNote);
    if (statusEl) statusEl.innerText = 'synced';
  }, 350);
}

async function saveAndExitRaw() {
  if (!activeNote) return;
  activeNote.content = document.getElementById('rawSourceTextarea').value;
  await saveActiveNoteContent();
  renderFlowDocument(activeNote);
}

// Helper client-side markdown blocks extractor
function parseMarkdownBlocks(content) {
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)([^\n]*)\n([\s\S]*?)```/g;
  const metaAttrRegex = /@([a-zA-Z0-9_-]+)=("([^"]*)"|([^\s]+))/g;
  let code_blocks = [];
  let idx = 0;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1].toLowerCase().trim();
    const headerMeta = match[2];
    const code = match[3];

    let meta = {};
    let attrMatch;
    while ((attrMatch = metaAttrRegex.exec(headerMeta)) !== null) {
      const k = attrMatch[1];
      const val = attrMatch[3] || attrMatch[4];
      meta[k] = val;
    }

    // Also support @alias shorthand
    const connShort = headerMeta.match(/@([a-zA-Z0-9_-]+)/);
    const conn = meta.conn || (connShort && connShort[1] !== 'conn' && connShort[1] !== 'assert' ? connShort[1] : '');

    code_blocks.push({
      index: idx++,
      lang: lang,
      conn: conn,
      assert: meta.assert || '',
      meta: meta,
      code: code
    });
  }

  return { code_blocks };
}

// --- GRAPH VIEW ---
function switchView(view) {
  const isNotebook = view === 'notebook';
  document.getElementById('contentContainer').classList.toggle('hidden', !isNotebook);
  document.getElementById('viewGraph').classList.toggle('hidden', isNotebook);

  document.getElementById('tabNotebook').className = isNotebook ?
    'px-2.5 py-1 rounded text-xs font-medium bg-[#1e1e24] text-[#f4f4f7] transition flex items-center gap-1.5' :
    'px-2.5 py-1 rounded text-xs font-medium text-[#8e8e99] hover:text-[#dcdce5] hover:bg-[#18181f] transition flex items-center gap-1.5';

  document.getElementById('tabGraph').className = !isNotebook ?
    'px-2.5 py-1 rounded text-xs font-medium bg-[#1e1e24] text-[#f4f4f7] transition flex items-center gap-1.5' :
    'px-2.5 py-1 rounded text-xs font-medium text-[#8e8e99] hover:text-[#dcdce5] hover:bg-[#18181f] transition flex items-center gap-1.5';

  if (!isNotebook) {
    renderGraph();
  }
}

async function renderGraph() {
  const res = await fetch('/api/graph');
  const data = await res.json();

  const nodes = new vis.DataSet(data.nodes.map(n => ({
    id: n.id,
    label: n.label,
    shape: n.group === 'note' ? 'dot' : 'box',
    size: n.group === 'note' ? 18 : 12,
    color: n.group === 'note' ?
      { background: '#7c6cf0', border: '#6353d8', highlight: { background: '#9d8df7', border: '#7c6cf0' } } :
      { background: '#25252d', border: '#383845', highlight: { background: '#353540', border: '#4d4d5e' } },
    font: { color: '#ededf0', size: 11, face: '-apple-system, BlinkMacSystemFont, sans-serif' }
  })));

  const edges = new vis.DataSet(data.edges.map(e => ({
    from: e.from,
    to: e.to,
    label: e.label,
    arrows: 'to',
    color: { color: e.label === 'wikilink' ? '#3e3e4a' : '#5a4ec7' },
    font: { color: '#737380', size: 9, align: 'middle' },
    dashes: e.label === 'uses'
  })));

  const container = document.getElementById('graphContainer');
  const network = new vis.Network(container, { nodes, edges }, {
    physics: {
      stabilization: false,
      barnesHut: { springLength: 130, springConstant: 0.04, damping: 0.09 }
    },
    interaction: { hover: true, tooltipDelay: 200 }
  });

  network.on('click', params => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0];
      if (!nodeId.startsWith('conn:')) {
        switchView('notebook');
        selectNote(nodeId);
      }
    }
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

init();
