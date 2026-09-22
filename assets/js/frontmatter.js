/*
 * Minimal YAML front-matter parser.
 *
 * Shared by the browser (assets/js/app.js) and by Node
 * (scripts/build-content-index.mjs) so that a Markdown file is always
 * read the same way in both places.
 *
 * It deliberately supports only the small YAML subset that a content
 * editor is likely to write:
 *
 *   title: Eclipse 2026
 *   order: 3
 *   draft: false
 *   tags: [optics, sun]
 *   tags:
 *     - optics
 *     - sun
 */

const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseScalar(raw) {
  const value = raw.trim();

  if (value === '') return '';

  // Quoted strings keep their content verbatim.
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
  if (quoted) return quoted[2];

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;

  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  return value;
}

function parseInlineList(raw) {
  const inner = raw.trim().slice(1, -1).trim();
  if (inner === '') return [];

  return inner
    .split(',')
    .map((item) => parseScalar(item))
    .filter((item) => item !== '');
}

export function parseYamlBlock(source) {
  const data = {};
  let listKey = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // "  - value" continues the list opened by the previous key.
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      data[listKey].push(parseScalar(listItem[1]));
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;

    const [, key, raw] = pair;
    listKey = null;

    if (raw.trim() === '') {
      // Either an empty value or the header of a dash list.
      data[key] = [];
      listKey = key;
      continue;
    }

    if (raw.trim().startsWith('[')) {
      data[key] = parseInlineList(raw);
      continue;
    }

    data[key] = parseScalar(raw);
  }

  // A key that opened a list but never received items is an empty string.
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && data[key].length === 0 && key === listKey) {
      data[key] = '';
    }
  }

  return data;
}

export function parseFrontMatter(text) {
  const match = FRONT_MATTER.exec(text);

  if (!match) {
    return { data: {}, body: text };
  }

  return {
    data: parseYamlBlock(match[1]),
    body: text.slice(match[0].length),
  };
}

/**
 * First heading or first sentence of the body, used when the editor did
 * not fill in `title` / `summary`.
 */
export function inferTitle(body) {
  const heading = /^\s{0,3}#\s+(.+)$/m.exec(body);
  return heading ? heading[1].trim() : '';
}

export function inferSummary(body, maxLength = 180) {
  const stripped = body
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, stripped.lastIndexOf(' ', maxLength)).trim() + '…';
}

export function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
