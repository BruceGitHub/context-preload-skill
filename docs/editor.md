# The visual editor

`editor/index.html` is a single, self-contained web page to build and edit
routing files without writing Markdown by hand.

It works **offline** and straight from `file://`: no CDN, no fonts, no build
step at runtime. The CLI can also serve it over a local HTTP server (Node's
built-in `http` module) for environments that cannot open a `file://` page
directly.

## Open it

```bash
context-preload editor                                # serves the blank editor
context-preload editor path/to/routing.md             # serves it with the file loaded
context-preload editor --port 8765                    # fixed port
```

Opening a file creates a temporary HTML copy with the content embedded, because
a browser cannot read local filesystem paths directly. The copy lives in the
system temp directory; the original file is not modified. Use **Download** to
save your changes back to disk.

`editor` prints an address such as `http://127.0.0.1:8765/`, keeps running until
Ctrl+C and launches the browser when stdout is an interactive terminal (skipped
in CI or when output is piped). Use `--port 0` (the default) to pick a free
port. On WSL, the CLI launches Chrome, Edge or Firefox from `/mnt/c` when it
finds one; otherwise copy the URL into a Windows browser: `localhost` is
forwarded to WSL.

Or open `editor/index.html` with your browser. On Linux:

```bash
xdg-open editor/index.html
```

## Master and build

The editor edits the **master** routing file. **Download .md** saves the master;
**Build** downloads the generated `<name>.build.md`, the same file the CLI
produces with:

```bash
context-preload build path/to/routing-context-flow.md
```

## Two modes

### Visual

Forms for the global section and for each flow:

- global: name, description, root, ignore list, read order;
- flow: id, description, includes, read, skip;
- duplicate, reorder and delete flows from the sidebar.

The right pane previews the canonical Markdown live, and structure is validated
as you type (ids, includes, cycles, absolute paths). Path existence is
checked by `context-preload validate`, because the browser cannot read your
repository.

### Free text

Press **Raw** to edit the whole file as plain Markdown. This is useful for
prose drafts:

```markdown
When I am doing a review, read these files:
- `docs/language.md`
- `src/**/*.ts`
- `tests/**/*.test.mjs`

Skip `tests/fixtures/**`. Report only concrete problems, with file and line.
```

To build and use the file with the skill, switch to **Visual** and define
structured `## Flow:` sections. A pure prose file produces `_No flows._` in the
build.

Switching back to **Visual** parses the text. If the file has no structured
flows, or if normalisation would drop free-form prose, the editor warns before
discarding anything. When in doubt, stay in Raw mode and download the file as
written.

## Other features

- **Import** an existing routing file (button or drag & drop), in either mode.
- **Download** the current content with the name you choose.
- **Copy** the Markdown to the clipboard.
- **Autosave** a local draft, restored the next time you open the page.
- **Ctrl/⌘+S** downloads the current file.

## Anatomy

| File | Role |
| --- | --- |
| `editor/template.html` | Layout, styles and placeholders. **Edit this**, not the generated file. |
| `editor/editor.js` | UI logic: forms, modes, import/export, autosave. |
| `editor/index.html` | Generated single file, committed so it works from `file://`. |
| `scripts/build-editor.mjs` | Inlines `src/crf-core.ts` (types stripped) + `editor/editor.js` into the template. |

The core is shared with the CLI, so the preview and the CLI always parse the
same language. If you change `src/crf-core.ts`, rebuild:

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
