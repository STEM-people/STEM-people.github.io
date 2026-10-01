/*
 * STEM People — application shell.
 *
 * The site is a static single page. All editorial content lives in
 * content/ as Markdown, and content/index.json lists what exists. Nothing
 * here has to change when a new article is published.
 */

import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';

import { createStarfield } from './starfield.js';
import { parseFrontMatter, inferTitle, inferSummary, slugify } from './frontmatter.js';

/*
 * Repository used by the "live" fallback below. If this site is ever moved
 * to another repository, this is the single line that has to change.
 */
const REPO = 'STEM-people/STEM-people.github.io';
const BRANCH = 'main';

const BASE = new URL('./', document.baseURI).href;

const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov'];
const EMBED_HOSTS = ['www.youtube.com', 'youtube.com', 'youtu.be', 'player.vimeo.com'];

const app = {
  site: {},
  sections: [],
  projects: [],
  bodies: new Map(),
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dirOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** Turns a path found in Markdown into a URL that works from any route. */
function resolveAsset(src, fileDir) {
  if (!src) return '';
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('mailto:')) {
    return src;
  }
  if (src.startsWith('/')) return new URL(src.slice(1), BASE).href;
  return new URL(src, new URL(fileDir || '', BASE)).href;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isVideo(src) {
  const clean = src.split('?')[0].toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => clean.endsWith(extension));
}

/* ------------------------------------------------------------------ *
 * Content loading
 * ------------------------------------------------------------------ */

async function fetchJson(path) {
  const response = await fetch(new URL(path, BASE).href, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function fetchText(path) {
  const response = await fetch(new URL(path, BASE).href, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.text();
}

/**
 * Fallback used when content/index.json is missing or has not been rebuilt
 * yet: ask GitHub which Markdown files exist and read their front matter
 * directly. Slower, and rate limited, but it means a file dropped into
 * content/projects/ shows up even before the build workflow has run.
 */
async function listFromGitHub(folder) {
  const url = `https://api.github.com/repos/${REPO}/contents/content/${folder}?ref=${BRANCH}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GitHub listing failed: ${response.status}`);

  const entries = await response.json();

  const markdown = entries.filter(
    (entry) => entry.type === 'file' && /\.(md|markdown)$/i.test(entry.name),
  );

  return Promise.all(
    markdown.map(async (entry) => {
      const text = await fetchText(`content/${folder}/${entry.name}`);
      return { name: entry.name, text };
    }),
  );
}

function entryToSection({ name, text }) {
  const { data, body } = parseFrontMatter(text);
  const base = name.replace(/\.(md|markdown)$/i, '');

  return {
    slug: slugify(data.slug || base),
    file: `content/sections/${name}`,
    title: data.title || inferTitle(body) || base,
    icon: data.icon || '',
    accent: data.accent || '',
    order: Number.isFinite(data.order) ? data.order : 99,
    summary: data.summary || inferSummary(body),
    draft: data.draft === true,
  };
}

function entryToProject({ name, text }) {
  const { data, body } = parseFrontMatter(text);
  const base = name.replace(/\.(md|markdown)$/i, '');
  const firstImage = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/.exec(body);

  return {
    slug: slugify(data.slug || base),
    file: `content/projects/${name}`,
    section: slugify(data.section || 'other'),
    title: data.title || inferTitle(body) || base,
    date: data.date ? String(data.date) : '',
    summary: data.summary || inferSummary(body),
    cover: data.cover || (firstImage ? firstImage[1] : ''),
    tags: Array.isArray(data.tags) ? data.tags : [],
    order: Number.isFinite(data.order) ? data.order : 99,
    draft: data.draft === true,
  };
}

async function loadContentIndex() {
  // ?refresh=1 skips the manifest and reads the repository directly, which
  // shows a just-uploaded file before the build workflow has rebuilt the index.
  const forceLive = new URLSearchParams(window.location.search).has('refresh');

  if (!forceLive) {
    try {
      const manifest = await fetchJson('content/index.json');
      return {
        sections: manifest.sections || [],
        projects: manifest.projects || [],
      };
    } catch (error) {
      console.warn('content/index.json unavailable, asking GitHub instead.', error);
    }
  }

  const [sections, projects] = await Promise.all([
    listFromGitHub('sections'),
    listFromGitHub('projects'),
  ]);

  return {
    sections: sections
      .map(entryToSection)
      .filter((section) => !section.draft)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    projects: projects
      .map(entryToProject)
      .filter((project) => !project.draft)
      .sort((a, b) => a.order - b.order || (b.date || '').localeCompare(a.date || '')),
  };
}

async function loadBody(file) {
  if (app.bodies.has(file)) return app.bodies.get(file);

  const text = await fetchText(file);
  const { body } = parseFrontMatter(text);

  app.bodies.set(file, body);
  return body;
}

/* ------------------------------------------------------------------ *
 * Markdown rendering
 * ------------------------------------------------------------------ */

marked.setOptions({ gfm: true, breaks: false });

function sanitize(html) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'loading', 'target'],
  });
}

/** Rebuilds a lone image into a <figure>, or a <video> when it points at one. */
function upgradeMedia(root, fileDir) {
  for (const image of $$('img', root)) {
    const src = resolveAsset(image.getAttribute('src') || '', fileDir);
    const caption = image.getAttribute('title') || '';
    const alt = image.getAttribute('alt') || '';

    // A paragraph holding nothing but this image becomes the figure itself.
    const parent = image.parentElement;
    const alone =
      parent &&
      parent.tagName === 'P' &&
      parent.childNodes.length === 1;

    const figure = document.createElement('figure');
    figure.className = 'media';

    if (isVideo(src)) {
      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      figure.appendChild(video);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'media__zoom';
      button.setAttribute('aria-label', alt ? `Enlarge: ${alt}` : 'Enlarge image');

      const clone = document.createElement('img');
      clone.src = src;
      clone.alt = alt;
      clone.loading = 'lazy';
      clone.decoding = 'async';

      button.appendChild(clone);
      figure.appendChild(button);
    }

    if (caption) {
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;
      figure.appendChild(figcaption);
    }

    (alone ? parent : image).replaceWith(figure);
  }
}

function upgradeLinks(root, fileDir) {
  for (const link of $$('a[href]', root)) {
    const href = link.getAttribute('href');

    if (/^(https?:)?\/\//i.test(href)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.classList.add('link-external');
      continue;
    }

    if (href.startsWith('#') || href.startsWith('mailto:')) continue;

    link.setAttribute('href', resolveAsset(href, fileDir));
  }
}

function upgradeEmbeds(root) {
  for (const frame of $$('iframe', root)) {
    let host = '';
    try {
      host = new URL(frame.src, BASE).hostname;
    } catch {
      host = '';
    }

    if (!EMBED_HOSTS.includes(host)) {
      frame.remove();
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'embed';
    frame.replaceWith(wrapper);
    wrapper.appendChild(frame);
    frame.loading = 'lazy';
  }
}

/** A paragraph that is only `$$ ... $$` is shown as a display equation. */
function upgradeEquations(root) {
  for (const paragraph of $$('p', root)) {
    const match = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(paragraph.textContent || '');
    if (!match) continue;

    const equation = document.createElement('div');
    equation.className = 'equation';
    equation.textContent = match[1].trim();
    paragraph.replaceWith(equation);
  }
}

function addHeadingAnchors(root) {
  for (const heading of $$('h2, h3', root)) {
    const id = slugify(heading.textContent || '');
    if (id) heading.id = id;
  }
}

function renderMarkdown(body, file) {
  const container = document.createElement('div');
  container.className = 'prose';
  container.innerHTML = sanitize(marked.parse(body));

  const fileDir = dirOf(file || '');

  upgradeMedia(container, fileDir);
  upgradeLinks(container, fileDir);
  upgradeEmbeds(container);
  upgradeEquations(container);
  addHeadingAnchors(container);

  return container;
}

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function projectsOf(sectionSlug) {
  return app.projects.filter((project) => project.section === sectionSlug);
}

function accentOf(sectionSlug) {
  const section = app.sections.find((item) => item.slug === sectionSlug);
  return section?.accent || 'var(--accent)';
}

function projectCard(project) {
  const cover = project.cover ? resolveAsset(project.cover, dirOf(project.file)) : '';
  const section = app.sections.find((item) => item.slug === project.section);

  const thumb = cover && !isVideo(cover)
    ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`
    : `<span class="card__placeholder">${escapeHtml(section?.icon || '✦')}</span>`;

  return `
    <a class="card reveal" href="#/${escapeHtml(project.section)}/${escapeHtml(project.slug)}"
       style="--card-accent: ${escapeHtml(accentOf(project.section))}">
      <span class="card__media">${thumb}</span>
      <span class="card__body">
        <span class="card__eyebrow">
          ${escapeHtml(section?.title || project.section)}
          ${project.date ? `<span class="card__dot"></span>${escapeHtml(formatDate(project.date))}` : ''}
        </span>
        <span class="card__title">${escapeHtml(project.title)}</span>
        <span class="card__summary">${escapeHtml(project.summary)}</span>
        <span class="card__more">Read <span aria-hidden="true">→</span></span>
      </span>
    </a>`;
}

function sectionCard(section) {
  const count = projectsOf(section.slug).length;

  return `
    <a class="tile reveal" href="#/${escapeHtml(section.slug)}"
       style="--card-accent: ${escapeHtml(section.accent || 'var(--accent)')}">
      <span class="tile__icon" aria-hidden="true">${escapeHtml(section.icon || '✦')}</span>
      <span class="tile__title">${escapeHtml(section.title)}</span>
      <span class="tile__summary">${escapeHtml(section.summary)}</span>
      <span class="tile__count">${count} ${count === 1 ? 'entry' : 'entries'}</span>
    </a>`;
}

function renderHome(main) {
  const site = app.site;
  const latest = app.projects.slice(0, 6);

  const stats = (site.stats || [])
    .map(
      (stat) => `
        <div class="stat reveal">
          <span class="stat__value">${escapeHtml(stat.value)}</span>
          <span class="stat__label">${escapeHtml(stat.label)}</span>
        </div>`,
    )
    .join('');

  main.innerHTML = `
    <section class="hero">
      <div class="hero__text">
        <p class="hero__kicker reveal">${escapeHtml(site.heroKicker || '')}</p>
        <h1 class="hero__title reveal">${escapeHtml(site.heroTitle || site.name || '')}</h1>
        <p class="hero__lead reveal">${escapeHtml(site.heroLead || '')}</p>
        <div class="hero__actions reveal">
          <a class="btn btn--primary" href="#work">Browse the work</a>
          <a class="btn" href="mailto:${escapeHtml(site.email || '')}">Get in touch</a>
        </div>
      </div>
      <div class="hero__orbit" aria-hidden="true">
        <span class="orbit orbit--1"><i></i></span>
        <span class="orbit orbit--2"><i></i></span>
        <span class="orbit orbit--3"><i></i></span>
        <span class="orbit__core"></span>
      </div>
    </section>

    ${stats ? `<section class="stats">${stats}</section>` : ''}

    <section class="block" id="work">
      <header class="block__head reveal">
        <h2>Research areas</h2>
        <p>Three fields, one method: observe carefully, measure honestly, publish openly.</p>
      </header>
      <div class="tiles">${app.sections.map(sectionCard).join('')}</div>
    </section>

    <section class="block">
      <header class="block__head reveal">
        <h2>Latest work</h2>
        <p>Field campaigns, published research and hands-on builds.</p>
      </header>
      <div class="cards">${latest.map(projectCard).join('')}</div>
    </section>

    <section class="block">
      <div class="panel reveal">
        <h2>Collaboration</h2>
        <p>${escapeHtml(site.about || '')}</p>
        <div class="panel__actions">
          <a class="btn btn--primary" href="mailto:${escapeHtml(site.email || '')}">
            ${escapeHtml(site.email || '')}
          </a>
          ${
            site.orcid
              ? `<a class="btn" href="https://orcid.org/${escapeHtml(site.orcid)}"
                    target="_blank" rel="noopener noreferrer">ORCID ${escapeHtml(site.orcid)}</a>`
              : ''
          }
        </div>
      </div>
    </section>`;

  document.title = `${site.name || 'STEM People'} — ${site.role || 'STEM Researcher'}`;
}

async function renderSection(main, section) {
  const projects = projectsOf(section.slug);

  main.innerHTML = `
    <article class="page" style="--page-accent: ${escapeHtml(section.accent || 'var(--accent)')}">
      <header class="page__head reveal">
        <p class="page__eyebrow"><a href="#/">Home</a> <span aria-hidden="true">/</span> ${escapeHtml(section.title)}</p>
        <h1><span class="page__icon" aria-hidden="true">${escapeHtml(section.icon || '')}</span>${escapeHtml(section.title)}</h1>
        <p class="page__lead">${escapeHtml(section.summary)}</p>
      </header>
      <div class="page__body reveal" data-body></div>
      <div class="cards">${projects.map(projectCard).join('')}</div>
      ${projects.length === 0 ? '<p class="empty">No entries published in this area yet.</p>' : ''}
    </article>`;

  try {
    const body = await loadBody(section.file);
    $('[data-body]', main).appendChild(renderMarkdown(body, section.file));
  } catch (error) {
    console.error(error);
  }

  document.title = `${section.title} — ${app.site.name || 'STEM People'}`;
}

async function renderProject(main, project) {
  const section = app.sections.find((item) => item.slug === project.section);
  const siblings = projectsOf(project.section);
  const index = siblings.findIndex((item) => item.slug === project.slug);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];

  const tags = project.tags
    .map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  main.innerHTML = `
    <article class="page page--article"
             style="--page-accent: ${escapeHtml(accentOf(project.section))}">
      <header class="page__head reveal">
        <p class="page__eyebrow">
          <a href="#/">Home</a> <span aria-hidden="true">/</span>
          <a href="#/${escapeHtml(project.section)}">${escapeHtml(section?.title || project.section)}</a>
        </p>
        <h1>${escapeHtml(project.title)}</h1>
        <p class="page__meta">
          ${project.date ? `<time datetime="${escapeHtml(project.date)}">${escapeHtml(formatDate(project.date))}</time>` : ''}
        </p>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </header>
      <div class="page__body" data-body>
        <p class="empty">Loading…</p>
      </div>
      <nav class="pager">
        ${previous ? `<a class="pager__link" href="#/${escapeHtml(previous.section)}/${escapeHtml(previous.slug)}"><span>Previous</span>${escapeHtml(previous.title)}</a>` : '<span></span>'}
        ${next ? `<a class="pager__link pager__link--next" href="#/${escapeHtml(next.section)}/${escapeHtml(next.slug)}"><span>Next</span>${escapeHtml(next.title)}</a>` : '<span></span>'}
      </nav>
      <footer class="credit">${escapeHtml(app.site.credit || '')}</footer>
    </article>`;

  const holder = $('[data-body]', main);

  try {
    const body = await loadBody(project.file);
    holder.innerHTML = '';
    holder.appendChild(renderMarkdown(body, project.file));
  } catch (error) {
    console.error(error);
    holder.innerHTML = '<p class="empty">This entry could not be loaded.</p>';
  }

  document.title = `${project.title} — ${app.site.name || 'STEM People'}`;
}

/** A page that exists on its own, outside the section/article structure. */
async function renderStandalone(main, file, fallbackTitle) {
  main.innerHTML = `
    <article class="page page--article">
      <header class="page__head reveal">
        <p class="page__eyebrow"><a href="#/">Home</a></p>
        <h1>${escapeHtml(fallbackTitle)}</h1>
      </header>
      <div class="page__body" data-body><p class="empty">Loading…</p></div>
    </article>`;

  const holder = $('[data-body]', main);

  try {
    const body = await loadBody(file);
    holder.innerHTML = '';
    holder.appendChild(renderMarkdown(body, file));

    const heading = $('h1', holder);
    if (heading) {
      $('.page__head h1', main).textContent = heading.textContent;
      heading.remove();
    }
  } catch (error) {
    console.error(error);
    holder.innerHTML = '<p class="empty">This page could not be loaded.</p>';
  }

  document.title = `${fallbackTitle} — ${app.site.name || 'STEM People'}`;
}

function renderNotFound(main) {
  main.innerHTML = `
    <article class="page">
      <header class="page__head">
        <h1>Lost in space</h1>
        <p class="page__lead">That page does not exist — or it has not been published yet.</p>
        <p><a class="btn btn--primary" href="#/">Back to the start</a></p>
      </header>
    </article>`;

  document.title = `Not found — ${app.site.name || 'STEM People'}`;
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

function buildNav() {
  const nav = $('[data-nav]');

  nav.innerHTML = `
    <a class="nav__item" href="#/" data-route="/">
      <span class="nav__icon" aria-hidden="true">⌂</span>Overview
    </a>
    ${app.sections
      .map((section) => {
        const projects = projectsOf(section.slug);

        return `
          <div class="nav__group" style="--card-accent: ${escapeHtml(section.accent || 'var(--accent)')}">
            <a class="nav__item" href="#/${escapeHtml(section.slug)}" data-route="/${escapeHtml(section.slug)}">
              <span class="nav__icon" aria-hidden="true">${escapeHtml(section.icon || '✦')}</span>
              ${escapeHtml(section.title)}
              ${projects.length ? `<span class="nav__count">${projects.length}</span>` : ''}
            </a>
            ${
              projects.length
                ? `<div class="nav__sub"><div>${projects
                    .map(
                      (project) => `
                        <a class="nav__child" href="#/${escapeHtml(project.section)}/${escapeHtml(project.slug)}"
                           data-route="/${escapeHtml(project.section)}/${escapeHtml(project.slug)}">
                          ${escapeHtml(project.title)}
                        </a>`,
                    )
                    .join('')}</div></div>`
                : ''
            }
          </div>`;
      })
      .join('')}`;
}

function markActiveNav(route) {
  for (const link of $$('[data-route]')) {
    const isActive = link.dataset.route === route;
    link.classList.toggle('is-active', isActive);

    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  // Keep the parent section open and marked while a child is being read.
  for (const group of $$('.nav__group')) {
    const active = $('.is-active', group);
    group.classList.toggle('is-open', Boolean(active));
  }
}

function buildProfile() {
  const site = app.site;

  $('[data-profile]').innerHTML = `
    <div class="profile">
      <span class="profile__ring">
        <img src="${escapeHtml(resolveAsset(site.photo || '', ''))}" alt="${escapeHtml(site.name || '')}">
      </span>
      <div>
        <p class="profile__name">${escapeHtml(site.name || '')}</p>
        <p class="profile__role">${escapeHtml(site.role || '')}</p>
      </div>
    </div>
    <dl class="contact">
      <dt>Email</dt>
      <dd><a href="mailto:${escapeHtml(site.email || '')}">${escapeHtml(site.email || '')}</a></dd>
      ${
        site.orcid
          ? `<dt>ORCID</dt>
             <dd><a href="https://orcid.org/${escapeHtml(site.orcid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.orcid)}</a></dd>`
          : ''
      }
    </dl>`;
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean);

  return { parts, route: `/${parts.join('/')}` };
}

let renderToken = 0;

async function route() {
  const main = $('[data-main]');
  const { parts, route: path } = parseRoute();
  const token = ++renderToken;

  main.classList.add('is-leaving');
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (token !== renderToken) return;

  if (parts.length === 0) {
    renderHome(main);
  } else if (parts[0] === 'privacy') {
    await renderStandalone(main, 'content/privacy.md', 'Privacy');
  } else if (parts.length === 1) {
    const section = app.sections.find((item) => item.slug === parts[0]);
    if (section) await renderSection(main, section);
    else renderNotFound(main);
  } else {
    const project = app.projects.find(
      (item) => item.slug === parts[1] && item.section === parts[0],
    );
    if (project) await renderProject(main, project);
    else renderNotFound(main);
  }

  if (token !== renderToken) return;

  main.classList.remove('is-leaving');
  markActiveNav(parts.length === 0 ? '/' : path);
  trackPageView();
  observeReveals(main);
  closeDrawer();

  // A fresh route starts at the top; an in-page anchor keeps its target.
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ------------------------------------------------------------------ *
 * Interaction: reveals, lightbox, drawer, audio, card glow
 * ------------------------------------------------------------------ */

let revealObserver = null;

function observeReveals(scope) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const element of $$('.reveal', scope)) element.classList.add('is-visible');
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
  }

  for (const element of $$('.reveal', scope)) revealObserver.observe(element);
}

function setupLightbox() {
  const lightbox = $('[data-lightbox]');
  const image = $('img', lightbox);
  const caption = $('figcaption', lightbox);
  let lastFocus = null;

  function open(source, text) {
    lastFocus = document.activeElement;
    image.src = source.src;
    image.alt = source.alt || '';
    caption.textContent = text || '';
    caption.hidden = !text;
    lightbox.hidden = false;
    document.body.classList.add('is-locked');
    $('[data-lightbox-close]', lightbox).focus();
  }

  function close() {
    lightbox.hidden = true;
    image.removeAttribute('src');
    document.body.classList.remove('is-locked');
    lastFocus?.focus?.();
  }

  document.addEventListener('click', (event) => {
    const zoom = event.target.closest?.('.media__zoom');
    if (zoom) {
      event.preventDefault();
      open($('img', zoom), zoom.parentElement.querySelector('figcaption')?.textContent || '');
      return;
    }

    if (event.target.closest?.('[data-lightbox-close]') || event.target === lightbox) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) close();
  });
}

function closeDrawer() {
  document.body.classList.remove('is-drawer-open');
  $('[data-drawer-toggle]')?.setAttribute('aria-expanded', 'false');
}

function setupDrawer() {
  const toggle = $('[data-drawer-toggle]');

  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('is-drawer-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  $('[data-drawer-backdrop]').addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer();
  });
}

function setupAmbientAudio() {
  const button = $('[data-audio-toggle]');
  const audio = $('#ambient-audio');

  if (!app.site.ambientAudio) {
    button.hidden = true;
    return;
  }

  audio.src = resolveAsset(app.site.ambientAudio, '');
  audio.volume = 0.3;

  function paint(playing) {
    button.classList.toggle('is-playing', playing);
    button.setAttribute('aria-pressed', String(playing));
    $('[data-audio-label]', button).textContent = playing ? 'Ambient on' : 'Ambient off';
  }

  button.addEventListener('click', async () => {
    if (audio.paused) {
      try {
        await audio.play();
        localStorage.setItem('stem-ambient', 'on');
        paint(true);
      } catch {
        paint(false);
      }
    } else {
      audio.pause();
      localStorage.setItem('stem-ambient', 'off');
      paint(false);
    }
  });

  paint(false);

  // The ambient track is on unless the visitor turned it off. Browsers block
  // autoplay on a cold load, so it is attempted once immediately and then
  // again on the first interaction anywhere on the page.
  if (localStorage.getItem('stem-ambient') === 'off') return;

  const events = ['pointerdown', 'keydown', 'touchstart', 'click'];

  function stopWaiting() {
    for (const type of events) document.removeEventListener(type, attempt, true);
  }

  async function attempt() {
    try {
      await audio.play();
      paint(true);
      stopWaiting();
      return true;
    } catch {
      // Still blocked. Keep listening: a later gesture usually succeeds.
      return false;
    }
  }

  attempt().then((playing) => {
    if (playing) return;
    for (const type of events) {
      document.addEventListener(type, attempt, true);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Analytics
 *
 * Google Analytics is only loaded after the visitor accepts. Until then
 * Consent Mode is set to denied, so no cookie is written. With no
 * analyticsId in content/site.json nothing here runs at all.
 * ------------------------------------------------------------------ */

let analyticsReady = false;

function setupAnalytics() {
  const banner = $('[data-consent]');
  const id = String(app.site.analyticsId || '').trim();

  if (!/^G-[A-Z0-9]+$/i.test(id)) {
    banner?.remove();
    return;
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });

  function load() {
    if (analyticsReady) return;
    analyticsReady = true;

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(script);

    gtag('js', new Date());
    gtag('config', id, { send_page_view: false });
    trackPageView();
  }

  function decide(accepted) {
    localStorage.setItem('stem-consent', accepted ? 'granted' : 'denied');
    banner.hidden = true;

    if (!accepted) return;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    load();
  }

  const stored = localStorage.getItem('stem-consent');

  if (stored === 'granted') {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    load();
    return;
  }

  if (stored === 'denied') return;

  banner.hidden = false;
  $('[data-consent-accept]', banner).addEventListener('click', () => decide(true));
  $('[data-consent-reject]', banner).addEventListener('click', () => decide(false));
}

function trackPageView() {
  if (!analyticsReady || typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    page_location: window.location.href,
    page_path: window.location.hash.replace(/^#/, '') || '/',
    page_title: document.title,
  });
}

function setupPointerGlow() {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  document.addEventListener(
    'pointermove',
    (event) => {
      const card = event.target.closest?.('.card, .tile, .panel');
      if (!card) return;

      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    },
    { passive: true },
  );
}

function setupSearch() {
  const input = $('[data-search]');
  const results = $('[data-search-results]');

  function clear() {
    results.innerHTML = '';
    results.hidden = true;
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();

    if (query.length < 2) {
      clear();
      return;
    }

    const matches = app.projects
      .filter((project) =>
        [project.title, project.summary, project.tags.join(' '), project.section]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 6);

    if (matches.length === 0) {
      results.innerHTML = '<p class="search__empty">No matches.</p>';
      results.hidden = false;
      return;
    }

    results.innerHTML = matches
      .map(
        (project) => `
          <a href="#/${escapeHtml(project.section)}/${escapeHtml(project.slug)}">
            ${escapeHtml(project.title)}
          </a>`,
      )
      .join('');
    results.hidden = false;
  });

  results.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      input.value = '';
      clear();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  createStarfield($('[data-starfield]'));

  setupLightbox();
  setupDrawer();
  setupPointerGlow();

  try {
    const [site, index] = await Promise.all([
      fetchJson('content/site.json').catch(() => ({})),
      loadContentIndex(),
    ]);

    app.site = site;
    app.sections = index.sections;
    app.projects = index.projects;
  } catch (error) {
    console.error(error);
    $('[data-main]').innerHTML = `
      <article class="page">
        <header class="page__head">
          <h1>Content unavailable</h1>
          <p class="page__lead">
            The site could not read its content index. If you are viewing this
            from your own computer, open the folder with a local web server
            rather than double-clicking index.html.
          </p>
        </header>
      </article>`;
    document.body.classList.add('is-ready');
    return;
  }

  buildProfile();
  buildNav();
  setupSearch();
  setupAmbientAudio();
  setupAnalytics();

  window.addEventListener('hashchange', route);
  await route();

  document.body.classList.add('is-ready');
}

boot();
