# stem-people.github.io

Personal site of Mery — planetary sciences, astronomy and technology.
Static, no build step, served by GitHub Pages.

## Layout

```
index.html              page shell, hash routing
404.html                sends old paths to the hash route
assets/css/main.css     styles
assets/js/app.js        router, Markdown rendering, navigation, search
assets/js/starfield.js  star canvas
assets/js/frontmatter.js  front-matter parser, shared with the build script
content/                all editorial content (Markdown + site.json)
admin/                  content editor
scripts/                index generator
```

`marked` and `DOMPurify` are loaded from a CDN at pinned versions. There is
nothing to install.

## Content pipeline

Markdown in `content/` is the source of truth. A push to `main` runs
`scripts/build-content-index.mjs`, which regenerates `content/index.json` —
the manifest the site reads to build its navigation.

Regenerate it by hand with:

```sh
node scripts/build-content-index.mjs
```

If the manifest is missing, or the site is opened with `?refresh=1`, the page
falls back to listing `content/` through the GitHub API instead.

## Running it locally

`app.js` is an ES module and fetches its content, so opening `index.html`
directly from the filesystem will not work.

```sh
npx serve .
```

## Repository settings this depends on

- **Actions → General → Workflow permissions**: *Read and write*, otherwise the
  index workflow cannot commit.
- **Collaborators**: write access is needed to use `/admin/`.

## Markdown extras

| Written as | Rendered as |
|---|---|
| `![alt](photo.jpg "caption")` | figure with caption and click-to-zoom |
| `![alt](clip.mp4)` | video player |
| `> text` | callout box |
| `$$ θ ≈ D / d $$` | centred equation |
| `<iframe src="youtube…">` | responsive embed (YouTube and Vimeo only) |

Relative image paths resolve against the folder of the `.md` file.

## Notes

- Analytics is off unless `analyticsId` is set in `content/site.json`, and is
  gated behind a consent notice.
- `prefers-reduced-motion` disables the star canvas, the nebulae and the
  scroll reveals.
