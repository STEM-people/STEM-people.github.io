/*
 * Scans content/sections and content/projects and writes content/index.json,
 * the manifest the website uses to build its navigation.
 *
 * Run it with `node scripts/build-content-index.mjs`. In normal use nobody
 * runs it by hand: the GitHub Action in .github/workflows/build-content-index.yml
 * runs it automatically whenever a Markdown file is added or changed.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFrontMatter,
  inferTitle,
  inferSummary,
  slugify,
} from '../assets/js/frontmatter.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

const SECTIONS_DIR = join(CONTENT, 'sections');
const PROJECTS_DIR = join(CONTENT, 'projects');

async function readMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];

  const names = await readdir(dir);

  const files = names
    .filter((name) => ['.md', '.markdown'].includes(extname(name).toLowerCase()))
    .sort();

  return Promise.all(
    files.map(async (name) => ({
      name,
      text: await readFile(join(dir, name), 'utf8'),
    })),
  );
}

function firstImage(body) {
  const match = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/.exec(body);
  return match ? match[1] : '';
}

function baseName(name) {
  return basename(name, extname(name));
}

function buildSection({ name, text }) {
  const { data, body } = parseFrontMatter(text);
  const slug = slugify(data.slug || baseName(name));

  return {
    slug,
    file: `content/sections/${name}`,
    title: data.title || inferTitle(body) || baseName(name),
    icon: data.icon || '',
    accent: data.accent || '',
    order: Number.isFinite(data.order) ? data.order : 99,
    summary: data.summary || inferSummary(body),
    draft: data.draft === true,
  };
}

function buildProject({ name, text }) {
  const { data, body } = parseFrontMatter(text);
  const slug = slugify(data.slug || baseName(name));

  return {
    slug,
    file: `content/projects/${name}`,
    section: slugify(data.section || 'other'),
    title: data.title || inferTitle(body) || baseName(name),
    date: data.date ? String(data.date) : '',
    summary: data.summary || inferSummary(body),
    cover: data.cover || firstImage(body),
    tags: Array.isArray(data.tags) ? data.tags : [],
    order: Number.isFinite(data.order) ? data.order : 99,
    draft: data.draft === true,
  };
}

function byOrderThenDate(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
  return a.title.localeCompare(b.title);
}

async function main() {
  const [sectionFiles, projectFiles] = await Promise.all([
    readMarkdownFiles(SECTIONS_DIR),
    readMarkdownFiles(PROJECTS_DIR),
  ]);

  const sections = sectionFiles
    .map(buildSection)
    .filter((section) => !section.draft)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  const projects = projectFiles
    .map(buildProject)
    .filter((project) => !project.draft)
    .sort(byOrderThenDate);

  const known = new Set(sections.map((section) => section.slug));

  // A project pointing at a section that no longer exists would otherwise
  // disappear from the site without any warning.
  const orphans = projects.filter((project) => !known.has(project.section));

  for (const orphan of orphans) {
    console.warn(
      `warning: ${orphan.file} has section "${orphan.section}", which does not ` +
        `match any file in content/sections/`,
    );
  }

  const manifest = {
    generated: new Date().toISOString(),
    sections,
    projects,
  };

  await writeFile(
    join(CONTENT, 'index.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  console.log(
    `content/index.json written: ${sections.length} sections, ` +
      `${projects.length} projects.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
