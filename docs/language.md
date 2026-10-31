# The routing-context-flow language

`context-preload` reads a single Markdown file — by convention
`routing-context-flow.md` — that declares **flows**: named bundles of files,
paths and order that tell an AI agent what to load for a specific kind of task.

The file is plain Markdown on purpose:

- humans can read and edit it without tools;
- agents read it natively, without a parser;
- the CLI can validate and expand it deterministically;
- the visual editor can round-trip it.

The language is a small, line-oriented dialect on top of Markdown. Everything
outside the recognised blocks is ignored, so you can add comments and prose
freely.

The structured syntax is **optional**. A routing file can be plain prose; the
skill reads it directly (see [§9](#9-free-text-routing-files)). Structured
flows exist to let the CLI expand globs, validate paths and estimate tokens.

---

## 1. File shape

```markdown
---
crf: 1
name: my-project
description: Context routing for my-project.
root: .
---

## Global

- ignore:
  - node_modules/**
- read order: first the files touched by the task, then tests.

## Flow: review

- description: Review a change without rewriting it.
- read:
  - `src/**/*.ts` | implementation
  - `tests/**/*.test.ts` | existing expectations
- skip:
  - `docs/legacy/**`
```

A document is made of:

1. an optional YAML-ish **front matter** block, delimited by `---`;
2. an optional **`## Global`** section;
3. one or more **`## Flow: <id>`** sections.

Sections are delimited by level-2 headings (`##`). Headings inside fenced code
blocks are ignored. Everything before the first recognised section is
preamble and is ignored.

---

## 2. Front matter

Only flat `key: value` pairs are supported. No nested YAML, no lists.

| Key | Type | Meaning |
| --- | --- | --- |
| `crf` | integer | Language version. Currently `1`. Required in practice. |
| `name` | string | Project name, shown by the CLI and the skill. |
| `description` | string | One-line description. |
| `root` | string | Directory the paths are relative to. Default: the folder containing the file. |

Synonyms accepted: `version` for `crf`.

`root` is resolved relative to the routing file. A root of `..` makes the file
usable from a `docs/` or `.context/` subfolder. It can also be set in the
Global section, which wins if both are present.

---

## 3. Global section

```markdown
## Global

- ignore:
  - node_modules/**
  - dist/**
- read order: first the files touched by the task, then the tests.
- root: .
```

| Key | Type | Meaning |
| --- | --- | --- |
| `ignore` | path list | Globs that no flow may ever read. Applied to every expansion. |
| `read order` | text | Free-form guidance on the order in which to read. |
| `root` | string | Same as the front matter `root`. |

`.git/**` is always ignored, with or without an explicit entry.

---

## 4. Flow section

```markdown
## Flow: review
```

The id must match `^[a-z0-9][a-z0-9_-]*$`. It is the name the agent reports and
uses to identify the flow.

Every key is a list item at column 0, `- key: value`. Its content can be:

- **inline** — everything after the colon;
- **nested** — the indented lines that follow, until the next key at column 0
  or the next heading.

| Key | Form | Meaning |
| --- | --- | --- |
| `description` | text | One line: what the flow is for. |
| `includes` | list / comma list | Other flows whose context is merged in first. |
| `read` | path list | Files to read, in order. |
| `skip` | path list | Globs removed from this flow, even if `read` matches them. |

English synonyms are accepted for flow keys: `use when` for `description`,
`extends` for `includes`, `files` for `read`, `exclude` for `skip`. The visual
editor always writes the canonical keys.

### 4.1 Path lists and notes

```markdown
- read:
  - `src/api/**/*.ts` | public API surface
  - `tests/**/*.test.ts`
  - docs/architecture.md — read this first
```

- Backticks are optional.
- A note can follow `|`, `—`, `–` or `--`.
- Paths are relative to `root` and always use `/`, even on Windows.
- Glob syntax: `*` (one segment), `**` (any depth), `?` (one character),
  `{a,b}` (alternatives), `[abc]` (character class).
- A literal directory is allowed: it is reported as a directory, not expanded.
- An inline value is a **single** entry. To list several, use nested items.
  (This avoids splitting paths that contain commas inside `{a,b}`.)

### 4.2 Skip and ignore

`skip` and `ignore` are applied **after** glob expansion:

1. `ignore` (global) removes files from every flow;
2. `skip` (flow) removes files from that flow;
3. files already matched by a previous entry are removed from later entries
   and reported as `already included`.

A file can therefore be excluded by a broad ignore and re-included by a
narrower literal path only if you also remove it from `ignore`: the filters
are subtractive, there is no "re-include" rule.

### 4.3 Includes

```markdown
## Flow: base
- read:
  - `docs/language.md`

## Flow: review
- includes: base
- read:
  - `src/**/*.ts`
```

When resolving `review`:

1. the included flow is merged first, recursively;
2. the flow's own entries are appended;
3. duplicate patterns and duplicate files are removed, first occurrence wins.

Cycles are rejected by `validate` and at resolve time.

---

## 5. How a flow is chosen

Selection is a decision, not a guess:

1. **Explicit** — the user names the flow (`use context-preload, flow review`)
   or the flow id appears in the request. Use it, after checking it exists.
2. **Inferred** — the skill ranks flows using description keywords and the
   flow id. A clear winner may be used directly.
3. **Interactive** — if nothing matches or two flows are equally plausible,
   ask. The skill must present a numbered list with a default, not silently
   pick one.

Precedence:

```
explicit flow  >  inferred winner  >  interactive question
```

Ties among inferred candidates are broken by flow id; an explicit choice always
wins.

---

## 6. Canonical form

`context-preload` can rewrite any file into a canonical form through the
editor (`serializeFlowFile` in the core). Canonical output:

- starts with the full front matter;
- prints `Global` before flows;
- orders keys as `description`, `includes`, `read`, `skip`;
- prints one entry per nested line, with notes after `|`;
- indents block content by two spaces;
- separates flows with one blank line.

Serialization is idempotent: `parse(serialize(parse(x)))` deep-equals
`parse(x)`, and serializing twice produces the same bytes.

---

## 7. Validation

`context-preload validate` checks structure and paths. Codes reported by the
core:

| Code | Level | Meaning |
| --- | --- | --- |
| `frontmatter.crf` | error | Unsupported `crf` version. |
| `frontmatter.unclosed` | error | `---` opened but never closed. |
| `flow.id` | error | Invalid flow id. |
| `flow.duplicate` | error | Same id declared twice. |
| `include.unknown` | error | `includes` points to a missing flow. |
| `include.cycle` | error | Include loop. |
| `path.absolute` | warning | Absolute path in `read`. |
| `path.escape` | warning | Path walks outside `root`. |
| `read.duplicate` | warning | Same path listed twice in one flow. |
| `read.missing` | warning | Literal path does not exist. |
| `read.empty` | warning | Glob matches nothing. |
| `flow.read.empty` | warning | Flow reads nothing and includes nothing. |
| `frontmatter.key`, `global.key`, `flow.key`, `syntax.*` | warning | Ignored or unknown syntax. |

`validate` exits `1` on errors. Add `--strict` to fail on warnings too.

---

## 8. Design tips

- **One flow per real task**, not per folder. `review`, `coding`, `debug`,
  `onboarding`, `release` are good; `src`, `tests`, `docs` are not.
- Keep the *required* set small: 5–15 files.
- Prefer globs that describe a surface (`src/api/**/*.ts`) over `src/**`.
- Put the contract (spec, schema, ADR) first in `read`: it anchors the task.
- Use `skip` for generated code, vendored code and legacy folders.
- Do not duplicate the same file in several flows: extract a `base` flow and
  include it.

---

## 9. Free-text drafts

The editor's Raw mode can hold prose:

```markdown
When I am doing a review, read these files:
- `docs/language.md`
- `src/**/*.ts`
- `tests/**/*.test.mjs`

Skip `tests/fixtures/**`.
```

A free-text draft is not buildable: `context-preload build` and the skill need
structured `## Flow:` sections. The build of a file with no flows contains
`_No flows._`. `validate` reports a warning when a file has no
flows.

## 10. Multiple routing files

You can keep one master per project, team or context:

```
routing-context-flow.md                  # default master
.context/routing-context-flow.md         # hidden variant
docs/routing-context-flow.backend.md     # explicit master
```

Each master produces its own build:

```bash
context-preload validate --file docs/routing-context-flow.backend.md
context-preload build --file docs/routing-context-flow.backend.md
# → docs/routing-context-flow.backend.build.md
```

Nothing is global or cached: each invocation reads the file you point at.

## 11. Build files

`context-preload build` writes `<name>.build.md` next to the master:

- one `## <id>` section per flow;
- `includes` already merged;
- `read` paths in order, globs preserved;
- global `ignore` and flow `skip` collected under **Do not read**;
- no front matter, no `includes`, no extra syntax.

The skill reads the build file, not the master. If the build is missing, it
stops and asks you to run `context-preload build`.
