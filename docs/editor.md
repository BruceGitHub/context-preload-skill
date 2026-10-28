# The visual editor

`editor/index.html` is a single, self-contained web page to build and edit
routing files without writing Markdown by hand.

It works **offline** and straight from `file://`: no server, no CDN, no fonts,
no build step at runtime.

## Open it

```bash
context-preload editor            # prints the path
context-preload editor --open     # opens it in the default browser
```

Or open `editor/index.html` with your browser. On Linux:

```bash
xdg-open editor/index.html
```

## What it does

- **Edit the global section** — name, description, budget, root, ignore list,
  read order, global rules.
- **Edit flows** — id, description, triggers, priority, includes, read,
  optional, skip, steps, rules, done when.
- **Preview the canonical Markdown** live, on the right.
- **Validate structure live** (ids, includes, cycles, budgets, absolute paths).
  Path existence is checked by `context-preload validate`, because the browser
  cannot read your repository.
- **Import** an existing `routing-context-flow.md` (button or drag & drop).
- **Download** the generated file with the name you choose.
- **Copy** the Markdown to the clipboard.
- **Autosave** a local draft, restored the next time you open the page.
- **Duplicate, reorder and delete** flows from the flow list.
- **Ctrl/⌘+S** downloads the current file.

Everything the editor writes is canonical: the same shape described in
[language.md](language.md#6-canonical-form). Importing and exporting without
changes is lossless in terms of model, though comments and prose outside the
recognised blocks are not preserved.

## Anatomy

| File | Role |
| --- | --- |
| `editor/template.html` | Layout, styles and placeholders. **Edit this**, not the generated file. |
| `editor/editor.js` | UI logic: forms, import/export, autosave. |
| `editor/index.html` | Generated single file, committed so it works from `file://`. |
| `scripts/build-editor.mjs` | Inlines `src/crf-core.mjs` + `editor/editor.js` into the template. |

The core is shared with the CLI, so the preview and the CLI always parse the
same language. If you change `src/crf-core.mjs`, rebuild:

```bash
npm run build:editor
```

CI rebuilds the editor and fails if `editor/index.html` is out of date.

## Draft storage

The draft lives in `localStorage` under `context-preload-editor-v1` (one draft
per browser). "New" replaces it after a confirmation. Clearing site data
removes it.

## Limits

- One file at a time; there is no project browser (the page has no filesystem
  access).
- No live path checking (see above).
- No command palette: the editor is deliberately small and dependency-free.
