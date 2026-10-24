// Run with: node --test tests/frontend
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildFence,
  insertSegment,
  joinSegments,
  parseMeta,
  removeSegment,
  renderWikilinks,
  replaceSegment,
  splitSegments,
} from '../../static/js/markdown.js';
import { escapeHtml, normalizeNoteName, parentFolders } from '../../static/js/util.js';

const NOTE =
  '# Title\nintro\n\n' +
  '```sql @conn=pg_order @assert="contains:ORD-"\nSELECT 1;\n```\n\n' +
  'middle\n\n' +
  '```sh @assert="status == 200"\necho hi\n```\n';

test('escapeHtml escapes text and attribute-breaking characters', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  assert.equal(escapeHtml(42), '42');
});

test('note name helpers', () => {
  assert.equal(normalizeNoteName('/dir/note.md'), 'dir/note');
  assert.deepEqual(parentFolders('a/b/c'), ['a', 'a/b']);
  assert.deepEqual(parentFolders('c'), []);
});

test('parseMeta reads key=value, quoted values and the bare @alias shorthand', () => {
  assert.deepEqual(parseMeta('@conn=pg @assert="contains:a b"'), {
    meta: { conn: 'pg', assert: 'contains:a b' },
    conn: 'pg',
    assert: 'contains:a b',
  });
  assert.equal(parseMeta('@pg_order').conn, 'pg_order');
  assert.equal(parseMeta('@pg_order @assert="x"').assert, 'x');
});

test('parseMeta never mistakes other attributes for a connection alias', () => {
  // Regression: `@assert=...` / `@tool=...` used to show up as "@conn=assert".
  assert.equal(parseMeta('@assert="contains:x"').conn, '');
  assert.equal(parseMeta('@exchange=orders @routing_key=r').conn, '');
  assert.equal(parseMeta('@assert="mention @someone here"').conn, '');
});

test('splitSegments alternates markdown and code with stable indexes', () => {
  const segs = splitSegments(NOTE);
  assert.deepEqual(
    segs.map((s) => [s.type, s.segmentIndex]),
    [['markdown', 0], ['code', 1], ['markdown', 2], ['code', 3]],
  );

  const [, sql, , sh] = segs;
  assert.equal(sql.lang, 'sql');
  assert.equal(sql.conn, 'pg_order');
  assert.equal(sql.assert, 'contains:ORD-');
  assert.equal(sql.cellIndex, 0);
  assert.equal(sh.cellIndex, 1);
  assert.equal(sh.conn, '');
  assert.equal(sh.code.trim(), 'echo hi');
});

test('joinSegments round-trips content (normalised spacing)', () => {
  const once = joinSegments(splitSegments(NOTE));
  assert.equal(joinSegments(splitSegments(once)), once);
  assert.ok(once.endsWith('```\n'));
});

test('insert / replace / remove segments', () => {
  const inserted = insertSegment(NOTE, 4, 'NEW TEXT'); // after the last code block
  assert.equal(splitSegments(inserted)[4].raw.trim(), 'NEW TEXT');
  assert.equal(splitSegments(inserted).length, 5);

  const code = insertSegment(NOTE, 1, '```sh\necho new\n```'); // between intro text and the SQL cell
  assert.equal(splitSegments(code)[1].lang, 'sh');
  assert.equal(splitSegments(code).filter((s) => s.type === 'code').length, 3);

  // Text inserted next to other text merges into one block on re-parse.
  assert.equal(splitSegments(insertSegment(NOTE, 1, 'NEW TEXT')).length, 4);

  const replaced = replaceSegment(NOTE, 2, 'changed');
  assert.equal(splitSegments(replaced)[2].raw.trim(), 'changed');

  assert.equal(splitSegments(replaceSegment(NOTE, 2, '   ')).length, 3, 'blank text removes the block');
  assert.equal(splitSegments(removeSegment(NOTE, 0)).length, 3);
  assert.equal(removeSegment(NOTE, 99), NOTE, 'out of range is a no-op');
});

test('buildFence reproduces a fence', () => {
  assert.equal(buildFence('sh', '@assert="x"', 'echo a'), '```sh @assert="x"\necho a\n```');
  assert.equal(buildFence('sh', '', 'echo a'), '```sh\necho a\n```');
});

test('renderWikilinks supports Obsidian forms and emits no inline JS', () => {
  const html = renderWikilinks('[[a]] [[dir/b|Bee]] [[c#head]] [[d#h|Dee]] [[e.md]]');
  assert.match(html, /data-name="a"[^>]*>a</);
  assert.match(html, /data-name="dir\/b"[^>]*>Bee</);
  assert.match(html, /data-name="c"[^>]*>c</);
  assert.match(html, /data-name="d"[^>]*>Dee</);
  assert.match(html, /data-name="e"[^>]*>e</);
  assert.doesNotMatch(html, /onclick/i);
});

test('renderWikilinks neutralises hostile targets', () => {
  const html = renderWikilinks(`[[x');alert(1);//]] [[<img src=x onerror=1>|"><script>]]`);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /onclick/i);
  assert.match(html, /&#39;\);alert\(1\);/);
});
