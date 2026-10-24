// Small pure helpers (no DOM access, so they can be unit-tested in Node).

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for safe use in HTML content *and* quoted attribute values. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** "/dir/note.md" -> "dir/note" (canonical note ID). */
export function normalizeNoteName(name) {
  return String(name).replace(/\.md$/, '').replace(/^\//, '').trim();
}

/** "a/b/c" -> "c" */
export function baseName(name) {
  return String(name).split('/').pop();
}

/** "a/b/c" -> ["a", "a/b"] (every ancestor folder path). */
export function parentFolders(name) {
  const parts = String(name).split('/');
  const folders = [];
  for (let i = 1; i < parts.length; i++) folders.push(parts.slice(0, i).join('/'));
  return folders;
}
