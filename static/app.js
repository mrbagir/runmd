let notes = [];
let connections = {};
let activeNote = null;
let isRawMode = false;
let cellOutputs = {}; // Cache cell outputs { [cellIdx]: result }

async function init() {
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
    el.innerHTML += `
      <div class="group flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#16161b] transition">
        <div class="flex items-center space-x-1.5 truncate">
          <span class="font-mono text-xs text-[#b8abfa]">@${c.alias}</span>
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
  if (!confirm(`Remove connection alias '@${alias}'?`)) return;
  await fetch(`/api/connections?alias=${encodeURIComponent(alias)}`, { method: 'DELETE' });
  await loadConnections();
  if (activeNote) renderFlowDocument(activeNote);
}

// --- NOTES MANAGEMENT ---
async function loadNotes() {
  try {
    const res = await fetch('/api/notes');
    notes = await res.json();
    document.getElementById('noteCount').innerText = notes.length;
    renderNoteList();
  } catch (e) {
    console.error('Failed to load notes', e);
  }
}

function renderNoteList() {
  const el = document.getElementById('noteList');
  el.innerHTML = '';
  notes.forEach(n => {
    const isActive = activeNote && activeNote.name === n.name;
    el.innerHTML += `
      <li class="group flex items-center justify-between rounded px-2 py-1.5 transition ${
        isActive ? 'bg-[#1e1e26] text-[#ededf0] font-medium' : 'text-[#9c9ca8] hover:bg-[#15151a] hover:text-[#dcdce5]'
      }">
        <button onclick="selectNote('${n.name}')" class="truncate flex-1 text-left">
          ${n.name}.md
        </button>
        <button onclick="deleteNote('${n.name}')" title="Delete note" class="opacity-0 group-hover:opacity-100 text-[#60606b] hover:text-[#f43f5e] text-xs px-1 transition">✕</button>
      </li>
    `;
  });
}

function selectNote(name) {
  const found = notes.find(n => n.name === name);
  if (!found) return;
  activeNote = found;
  cellOutputs = {}; // Reset output cache on note switch
  document.getElementById('activeNoteTitle').innerText = `${found.name}.md`;
  renderNoteList();
  renderFlowDocument(found);
}

async function createNewNote() {
  const name = prompt('New note name (without .md):', 'new-runbook');
  if (!name) return;
  const cleanName = name.replace(/\.md$/, '').trim();
  if (!cleanName) return;

  const defaultContent = `# ${cleanName}\nDouble click this text to edit.\n\n` +
    "```sh @assert=\"contains:Hello\"\necho \"Hello from " + cleanName + "\"\n```\n";

  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cleanName, content: defaultContent })
  });
  const created = await res.json();
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

// --- HYBRID JUPYTER-STYLE FLOW DOCUMENT ---
// Parses raw markdown into alternating segments: Markdown text blocks and Code blocks
function renderFlowDocument(note) {
  const container = document.getElementById('documentFlow');
  container.innerHTML = '';

  const content = note.content || '';
  // Regex to split markdown content around fenced code blocks
  const codeBlockRegex = /```([a-zA-Z0-9_-]+)([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let segments = [];
  let match;
  let cellIndex = 0;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index);
    if (textBefore.trim().length > 0) {
      segments.push({ type: 'markdown', content: textBefore, segmentIndex: segments.length });
    }
    segments.push({
      type: 'code',
      lang: match[1].toLowerCase().trim(),
      metaStr: match[2].trim(),
      code: match[3],
      cellIndex: cellIndex++,
      segmentIndex: segments.length,
      fullMatch: match[0]
    });
    lastIndex = match.index + match[0].length;
  }
  const textAfter = content.substring(lastIndex);
  if (textAfter.trim().length > 0) {
    segments.push({ type: 'markdown', content: textAfter, segmentIndex: segments.length });
  }

  // If document is empty
  if (segments.length === 0) {
    container.innerHTML = `
      <div class="text-[#666675] text-sm italic py-12 text-center">
        Empty note. Click "View Source" above to write content.
      </div>
    `;
    return;
  }

  // Render each segment
  segments.forEach(seg => {
    if (seg.type === 'markdown') {
      container.appendChild(createMarkdownBlock(seg.content, seg.segmentIndex));
    } else if (seg.type === 'code') {
      container.appendChild(createCodeBlockElement(seg));
    }
  });
}

// Creates an Obsidian-style rendered Markdown block with double-click inline editing
function createMarkdownBlock(rawMd, segIdx) {
  const block = document.createElement('div');
  block.className = 'group relative py-1 px-2 rounded hover:bg-[#18181c]/50 transition';
  block.setAttribute('data-segment-index', segIdx);

  // Render wikilinks [[link]] to clickable anchors
  let processed = rawMd.replace(/\[\[([^\]]+)\]\]/g, (m, p1) => {
    const cleanTarget = p1.trim().replace(/\.md$/, '');
    return `<a href="javascript:void(0)" onclick="selectNote('${cleanTarget}')" class="wikilink">[[${cleanTarget}]]</a>`;
  });

  const htmlContent = marked.parse(processed);

  // Preview view
  const previewDiv = document.createElement('div');
  previewDiv.className = 'md-preview cursor-text';
  previewDiv.innerHTML = htmlContent;
  previewDiv.title = 'Double click to edit text';

  // Inline editor (hidden by default)
  const editorDiv = document.createElement('div');
  editorDiv.className = 'hidden mt-2 mb-3 bg-[#111114] border border-[#2c2c36] rounded-md p-3';
  editorDiv.innerHTML = `
    <textarea class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-y" rows="5">${escapeHtml(rawMd)}</textarea>
    <div class="flex justify-end gap-2 mt-2 pt-2 border-t border-[#1f1f26]">
      <button class="btn-cancel text-xs text-[#8e8e99] hover:text-[#dcdce5] px-2 py-1 rounded">Cancel</button>
      <button class="btn-save text-xs bg-[#2b2659] hover:bg-[#393175] text-[#d6d0ff] px-3 py-1 rounded font-medium">Save</button>
    </div>
  `;

  // Double-click to edit
  previewDiv.addEventListener('dblclick', () => {
    previewDiv.classList.add('hidden');
    editorDiv.classList.remove('hidden');
    const ta = editorDiv.querySelector('textarea');
    ta.focus();
  });

  // Cancel button
  editorDiv.querySelector('.btn-cancel').addEventListener('click', () => {
    editorDiv.classList.add('hidden');
    previewDiv.classList.remove('hidden');
  });

  // Save button
  editorDiv.querySelector('.btn-save').addEventListener('click', async () => {
    const updatedMd = editorDiv.querySelector('textarea').value;
    await updateSegmentContent(rawMd, updatedMd);
  });

  block.appendChild(previewDiv);
  block.appendChild(editorDiv);
  return block;
}

// Creates an Executable Fenced Code Block with embedded Run button and collapsible output drawer
function createCodeBlockElement(seg) {
  // Parse @conn and @assert from meta
  const connMatch = seg.metaStr.match(/@conn=([^\s]+)/);
  const assertMatch = seg.metaStr.match(/@assert=("([^"]*)"|([^\s]+))/);
  const conn = connMatch ? connMatch[1] : '';
  const assertRule = assertMatch ? (assertMatch[2] || assertMatch[3]) : '';

  const card = document.createElement('div');
  card.className = 'rounded-lg border border-[#222228] bg-[#161619] overflow-hidden my-3 shadow-sm transition hover:border-[#2d2d38]';
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
      </div>
    </div>

    <!-- Code Content (Monospace editable) -->
    <div class="p-3 bg-[#131316]">
      <textarea id="cell-code-${seg.cellIndex}" class="w-full bg-transparent text-[#ededf0] code-font text-xs leading-relaxed focus:outline-none resize-none font-normal" rows="${Math.max(1, seg.code.trim().split('\n').length)}">${escapeHtml(seg.code.trim())}</textarea>
    </div>

    <!-- Floating Collapsible Output Drawer (Directly Underneath) -->
    <div id="cell-drawer-${seg.cellIndex}" class="hidden border-t border-[#222228] bg-[#0c0c0e]">
      <!-- Drawer Header: Status, Duration, Toggle, Clear -->
      <div class="px-3.5 py-1.5 border-b border-[#1b1b20] flex items-center justify-between text-xs bg-[#111114]">
        <div id="cell-status-${seg.cellIndex}" class="flex items-center space-x-2"></div>
        <div class="flex items-center space-x-2">
          <button onclick="toggleDrawer(${seg.cellIndex})" id="btn-toggle-drawer-${seg.cellIndex}" class="text-[11px] text-[#8e8e99] hover:text-[#dcdce5] px-1.5 py-0.5 rounded hover:bg-[#1a1a22] transition">
            Collapse ▲
          </button>
          <button onclick="clearOutput(${seg.cellIndex})" title="Clear output" class="text-[11px] text-[#60606b] hover:text-[#f43f5e] px-1 rounded hover:bg-[#1a1a22] transition">✕</button>
        </div>
      </div>
      <!-- Drawer Body: Terminal stdout/stderr -->
      <div id="cell-body-${seg.cellIndex}" class="p-3.5 overflow-x-auto max-h-72 text-xs code-font text-[#c9c9d4] whitespace-pre-wrap leading-relaxed select-text"></div>
    </div>
  `;

  // Cmd+Enter shortcut inside code textarea
  const ta = card.querySelector(`#cell-code-${seg.cellIndex}`);
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runCell(seg.cellIndex);
    }
  });

  // Update height dynamically
  ta.addEventListener('input', () => {
    ta.rows = Math.max(1, ta.value.split('\n').length);
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

  // Reconstruct note code block metadata
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

    // Render Status badge
    const isPass = data.success && data.assert_pass;
    const statusBadge = isPass ?
      `<span class="text-[#10b981] font-semibold flex items-center gap-1"><span>✔ PASS</span> <span class="text-[#60606b] font-normal text-[10px]">(${data.duration_ms}ms)</span></span>` :
      `<span class="text-[#f43f5e] font-semibold flex items-center gap-1"><span>✖ FAIL</span> <span class="text-[#60606b] font-normal text-[10px]">(${data.duration_ms}ms)</span></span>`;

    const assertText = data.assert_msg ?
      `<span class="text-[11px] text-[#8e8e99] truncate max-w-sm" title="${escapeHtml(data.assert_msg)}">${escapeHtml(data.assert_msg)}</span>` : '';

    statusEl.innerHTML = `${statusBadge} <span class="text-[#33333d]">|</span> ${assertText}`;

    // Render Output text
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

// --- REPLACING / UPDATING SEGMENTS ON EDIT ---
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
  await loadNotes();
}

// --- RAW SOURCE MODE TOGGLE ---
function toggleRawSource() {
  const container = document.getElementById('rawEditorContainer');
  const textarea = document.getElementById('rawSourceTextarea');
  const btn = document.getElementById('btnRawToggle');

  isRawMode = !isRawMode;
  if (isRawMode) {
    container.classList.remove('hidden');
    textarea.value = activeNote ? activeNote.content : '';
    btn.innerText = 'Hide Source';
    textarea.focus();
  } else {
    container.classList.add('hidden');
    btn.innerText = 'View Source';
  }
}

async function saveAndExitRaw() {
  if (!activeNote) return;
  activeNote.content = document.getElementById('rawSourceTextarea').value;
  await saveActiveNoteContent();
  toggleRawSource();
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

    code_blocks.push({
      index: idx++,
      lang: lang,
      conn: meta.conn || '',
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
  document.getElementById('viewNotebook').classList.toggle('hidden', !isNotebook);
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
