# The routing-context-flow language

`context-preload` reads a single Markdown file — by convention
`routing-context-flow.md` — that declares **flows**: named bundles of files,
rules and steps that tell an AI agent what to load for a specific kind of task.

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
default_budget: 60k
root: .
---

## Global

- ignore:
  - node_modules/**
- read order: first the files touched by the task, then tests.
- rules:
  - Never read files outside the selected flow without saying so.

## Flow: review

- description: Review a change without rewriting it.
- triggers: review, pr, diff, check
- read:
  - `src/**/*.ts` | implementation
  - `tests/**/*.test.ts` | existing expectations
- skip:
  - `docs/legacy/**`
- steps:
  1. Read the diff.
  2. Report findings with file:line.
- done when:
  - Every finding has a severity and a proposed fix.
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
| `default_budget` | string | Fallback token budget (`60k`, `120000`, `1.5M`). |
| `root` | string | Directory the paths are relative to. Default: the folder containing the file. |

Synonyms accepted: `version` for `crf`, `default-budget` for `default_budget`.

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
- budget: 60k
- root: .
- rules:
  - Never read the whole repository.
```

| Key | Type | Meaning |
| --- | --- | --- |
| `ignore` | path list | Globs that no flow may ever read. Applied to every expansion. |
| `read order` | text | Free-form guidance on the order in which to read. |
| `budget` | string | Default budget, overridden by a flow budget. |
| `root` | string | Same as the front matter `root`. |
| `rules` | block | Markdown rules valid for every flow. |

`.git/**` is always ignored, with or without an explicit entry.

---

## 4. Flow section

```markdown
## Flow: review
```

The id must match `^[a-z0-9][a-z0-9_-]*$`. It is the value you pass to
`context-preload show <flow>` and the name the agent reports.

Every key is a list item at column 0, `- key: value`. Its content can be:

- **inline** — everything after the colon;
- **nested** — the indented lines that follow, until the next key at column 0
  or the next heading.

| Key | Form | Meaning |
| --- | --- | --- |
| `description` | text | One line: what the flow is for. |
| `triggers` | list / comma list | Phrases that identify the flow from a task description. |
| `priority` | integer | Tie-breaker when several flows match. Higher wins. |
| `includes` | list / comma list | Other flows whose context is merged in first. |
| `read` | path list | Files to read, in order. |
| `optional` | path list | Files to read only if the task needs them. |
| `skip` | path list | Globs removed from this flow, even if `read` matches them. |
| `budget` | string | Soft token budget for this flow. |
| `steps` | ordered list | How to perform the task. |
| `rules` | block | Constraints on how to work. Markdown allowed. |
| `done when` | list | Completion criteria. |

English synonyms are accepted for flow keys: `use when` for `description`,
`trigger` for `triggers`, `extends` for `includes`, `files` for `read`,
`read if needed` for `optional`, `exclude` for `skip`, `rule` for `rules`,
`step` for `steps`, `definition of done` for `done when`. The visual editor
always writes the canonical keys.

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
3. duplicate patterns and duplicate files are removed, first occurrence wins;
4. rules are concatenated (included first, own last);
5. steps and `done when` are concatenated;
6. the **own** budget wins over the included ones.

Cycles are rejected by `validate` and at resolve time.

### 4.4 Budgets

`60k` = 60 000, `1.5M` = 1 500 000, `120000` = 120 000. The CLI estimates
tokens as `bytes / 4` and warns when the estimate exceeds the budget. The
budget is a guideline for the agent, not a hard truncation.

---

## 5. How a flow is chosen

Selection is a decision, not a guess:

1. **Explicit** — the user names the flow (`use context-preload, flow review`)
   or the flow id appears in the request. Use it, after checking it exists.
2. **Inferred** — `context-preload pick "<task>"` ranks flows using triggers,
   description keywords and priority. The skill uses the same rules: a clear
   winner may be used directly.
3. **Interactive** — if nothing matches or two flows are equally plausible,
   ask. `context-preload interactive` prints a numbered menu and a default.
   The skill must ask with the same list, not silently pick one.

Triggers are matched case-insensitively, accent-insensitively and on word
boundaries. Keep them short and specific (`review`, `pr`, `diff`), not generic
(`code`, `file`).

Precedence:

```
explicit flow  >  inferred winner  >  interactive question
```

`priority` only breaks ties among inferred candidates; it never overrides an
explicit choice.

---

## 6. Canonical form

`context-preload` can rewrite any file into a canonical form through the
editor (`serializeFlowFile` in the core). Canonical output:

- starts with the full front matter;
- prints `Global` before flows;
- orders keys as `description`, `triggers`, `priority`, `includes`, `budget`,
  `read`, `optional`, `skip`, `steps`, `rules`, `done when`;
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
| `trigger.duplicate` | warning | Two flows claim the same trigger. |
| `read.duplicate` | warning | Same path listed twice in one flow. |
| `read.missing` | warning | Literal path does not exist. |
| `read.empty` | warning | Glob matches nothing. |
| `flow.read.empty` | warning | Flow reads nothing and includes nothing. |
| `budget.invalid` | warning | Budget not understood. |
| `frontmatter.key`, `global.key`, `flow.key`, `syntax.*` | warning | Ignored or unknown syntax. |

`validate` exits `1` on errors. Add `--strict` to fail on warnings too.

---

## 8. Design tips

- **One flow per real task**, not per folder. `review`, `coding`, `debug`,
  `onboarding`, `release` are good; `src`, `tests`, `docs` are not.
- Keep the *required* set small: 5–15 files. Move the rest to `optional`.
- Prefer globs that describe a surface (`src/api/**/*.ts`) over `src/**`.
- Put the contract (spec, schema, ADR) first in `read`: it anchors the task.
- Use `skip` for generated code, vendored code and legacy folders.
- Put durable constraints in `rules`, one-off steps in `steps`.
- `done when` is what makes a flow verifiable; write criteria you can check.
- Do not duplicate the same file in several flows: extract a `base` flow and
  include it.

---

## 9. Free-text routing files

For a quick start, skip the keys and write prose:

```markdown
When I am doing a review, read these files:
- `docs/language.md`
- `src/**/*.mjs`
- `tests/**/*.test.mjs`

Skip `tests/fixtures/**`. Report only concrete problems, with file and line.
```

The skill reads the matching clause, follows the listed paths and constraints,
then performs the task. Structured flows are optional: they add deterministic
glob expansion, includes, budgets, de-duplication and validation. The CLI only
resolves structured files; `validate` reports a warning when a file has no
flows.

## 10. Multiple routing files

The skill accepts any file path, so you can keep one routing file per project,
team or context:

```
routing-context-flow.md                  # default, discovered upward
.context/routing-context-flow.md         # hidden variant, also discovered
docs/routing-context-flow.backend.md     # explicit path
```

Pass it explicitly with `--file` (CLI) or in the prompt (skill):

```bash
context-preload show review --file docs/routing-context-flow.backend.md
```

Nothing is global or cached: each invocation reads the file you point at.
