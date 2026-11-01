// Markdown document model: splitting a note into text / code segments,
// parsing fence metadata (@conn, @assert, ...), and wikilink rendering.
// Pure functions only (no DOM), mirrored by parser.go on the server.

import { escapeHtml } from './util.js';

// Sources are strings so every use gets its own fresh RegExp (no shared
// lastIndex state).
const FENCE_SRC = '```([a-zA-Z0-9_-]+)([^\\n]*)\\n([\\s\\S]*?)```';
const META_SRC = '@([a-zA-Z0-9_-]+)=("([^"]*)"|([^\\s]+))';
const WIKILINK_SRC = '\\[\\[([^\\|\\]#]+)(?:#[^\\|\\]]+)?(?:\\|([^\\]]+))?\\]\\]';

/**
 * Parse a fence info string such as `@conn=pg @assert="contains:x"`.
 * A bare `@alias` (no "=") is accepted as shorthand for `@conn=alias`.
 */
export function parseMeta(metaStr) {
  const meta = {};
  for (const m of metaStr.matchAll(new RegExp(META_SRC, 'g'))) {
    meta[m[1]] = m[3] ?? m[4] ?? '';
  }

  let conn = meta.conn || '';
  if (!conn) {
    // Remove key=value pairs first so "@x" inside a quoted assert is ignored.
    const rest = metaStr.replace(new RegExp(META_SRC, 'g'), ' ');
    const bare = rest.match(/(?:^|\s)@([a-zA-Z0-9_-]+)(?=\s|$)/);
    if (bare && !['conn', 'assert', 'param'].includes(bare[1].toLowerCase())) {
      conn = bare[1];
    }
  }
  return { meta, conn, assert: meta.assert || '' };
}

/**
 * Split note content into ordered segments:
 *   { type: 'markdown', raw, content, segmentIndex }
 *   { type: 'code', raw, lang, metaStr, meta, conn, assert, code, cellIndex, segmentIndex }
 * Whitespace-only text between blocks is dropped.
 */
export function splitSegments(content) {
  const segments = [];
  let lastIndex = 0;
  let cellIndex = 0;

  const pushMarkdown = (text) => {
    if (text.trim().length > 0) {
      segments.push({ type: 'markdown', raw: text, content: text, segmentIndex: segments.length });
    }
  };

  for (const m of content.matchAll(new RegExp(FENCE_SRC, 'g'))) {
    pushMarkdown(content.slice(lastIndex, m.index));

    const metaStr = m[2].trim();
    const { meta, conn, assert } = parseMeta(metaStr);
    segments.push({
      type: 'code',
      raw: m[0],
      lang: m[1].toLowerCase().trim(),
      metaStr,
      meta,
      conn,
      assert,
      code: m[3],
      cellIndex: cellIndex++,
      segmentIndex: segments.length,
    });
    lastIndex = m.index + m[0].length;
  }
  pushMarkdown(content.slice(lastIndex));
  return segments;
}

/** Inverse of splitSegments: blank-line separated, trailing newline. */
export function joinSegments(segments) {
  return segments.map((s) => s.raw.trim()).filter(Boolean).join('\n\n') + '\n';
}

/** New content with `raw` inserted at segment position `index`. */
export function insertSegment(content, index, raw) {
  const segments = splitSegments(content);
  segments.splice(index, 0, { raw });
  return joinSegments(segments);
}

/** New content with the segment at `index` removed ( = same content if out of range). */
export function removeSegment(content, index) {
  const segments = splitSegments(content);
  if (index < 0 || index >= segments.length) return content;
  segments.splice(index, 1);
  return joinSegments(segments);
}

/** New content with the segment at `index` replaced (empty text removes it). */
export function replaceSegment(content, index, newText) {
  const segments = splitSegments(content);
  if (index < 0 || index >= segments.length) return content;
  if (newText.trim().length === 0) segments.splice(index, 1);
  else segments[index].raw = newText.trim();
  return joinSegments(segments);
}

/** Build a fenced code block string. */
export function buildFence(lang, metaStr, code) {
  return '```' + lang + (metaStr ? ' ' + metaStr : '') + '\n' + code + '\n```';
}

/**
 * Obsidian links -> anchors handled by the delegated click handler:
 * [[target]], [[target|text]], [[target#heading]], [[target#heading|text]].
 * Every interpolated value is escaped; no inline JS is emitted.
 */
export function renderWikilinks(markdown, existingNotes = null) {
  return markdown.replace(new RegExp(WIKILINK_SRC, 'g'), (_match, target, alias) => {
    const clean = target.trim().replace(/\.md$/, '');
    const text = alias ? alias.trim() : clean.split('/').pop();
    const isUnresolved =
      existingNotes &&
      !existingNotes.has(clean) &&
      !existingNotes.has(clean.split('/').pop());

    const classes = isUnresolved
      ? 'wikilink wikilink-unresolved text-[#737380] hover:text-[#dcdce5] underline decoration-dashed'
      : 'wikilink text-[#a78bfa] hover:text-[#c4b5fd] underline';

    const titleAttr = isUnresolved
      ? `Note '${clean}' belum dibuat (klik untuk membuat)`
      : clean;

    return (
      `<a href="#" class="${classes}" data-action="select-note" ` +
      `data-name="${escapeHtml(clean)}" ${isUnresolved ? 'data-unresolved="true"' : ''} title="${escapeHtml(titleAttr)}">${escapeHtml(text)}</a>`
    );
  });
}
